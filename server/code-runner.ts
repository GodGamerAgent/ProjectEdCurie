import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HttpError } from "./auth";

/*
 * Runs untrusted student, teacher, and AI-generated programs in a separate
 * operating-system process with:
 * - an empty environment (no secrets, database URL or API keys),
 * - a fresh temporary working directory that is removed afterwards,
 * - CPU-time, file-size and (Python) address-space limits through ulimit,
 * - a wall-clock timeout that kills the whole process group,
 * - capped stdout/stderr,
 * - a language-level guard: Node's permission model (reads only the work
 *   directory; no child processes, workers, writes, native addons or network)
 *   and a Python audit hook that blocks network, subprocesses, ctypes and file
 *   access outside the interpreter and the work directory.
 * This is process isolation, not a container or VM.
 */

export type Language = "python" | "javascript";
export type Verdict = "passed" | "failed" | "compile_error" | "runtime_error" | "timeout" | "output_limit" | "skipped";
export type TestCase = { name: string; input: string; expected: string; hidden: boolean; category: "normal" | "boundary" | "edge" };
export type CodingSpec = {
  language: Language; statement: string; starterCode: string; inputFormat: string; outputFormat: string;
  tests: TestCase[]; referenceSolution: string; checker: string | null;
};
export type ProcessResult = { verdict: Exclude<Verdict, "passed" | "failed"> | "ok"; stdout: string; stderr: string; timeMs: number };
export type TestResult = {
  name: string; category: TestCase["category"]; hidden: boolean; verdict: Verdict; timeMs: number;
  input?: string; expected?: string; stdout?: string; stderr?: string;
};

const COMPILE_EXIT = 97;
const OUTPUT_LIMIT = 64 * 1024;
const WALL_MS = Number(process.env.CODE_RUNNER_TIMEOUT_MS) || 3000;
const CPU_SECONDS = Math.max(1, Math.ceil(WALL_MS / 1000));
const MAX_CONCURRENT = 2;

const pythonGuard = String.raw`
import sys, os
_work = os.path.realpath(sys.argv[1])
_allowed = tuple({os.path.realpath(p) for p in (sys.base_prefix, sys.prefix, sys.base_exec_prefix, sys.exec_prefix, _work) if p})
_blocked_events = {"socket.connect", "socket.bind", "socket.getaddrinfo", "socket.gethostbyname", "socket.sendto",
  "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork", "os.forkpty", "os.kill",
  "os.killpg", "os.putenv", "os.unsetenv", "ctypes.dlopen", "ctypes.dlsym", "os.chdir", "os.remove", "os.rename",
  "os.rmdir", "os.mkdir", "os.symlink", "os.link", "os.chmod", "os.chown", "shutil.rmtree", "webbrowser.open"}
_blocked_modules = {"ctypes", "_ctypes", "_posixsubprocess", "multiprocessing", "_multiprocessing", "socket", "_socket", "ssl", "_ssl"}
def _guard(event, args):
    if event in _blocked_events:
        raise PermissionError("Blocked by the EdCurie runner: " + event)
    if event == "import" and args and args[0] in _blocked_modules:
        raise PermissionError("Blocked by the EdCurie runner: import " + str(args[0]))
    if event == "open" and args:
        target, mode = args[0], (args[1] if len(args) > 1 else "r")
        if isinstance(target, int):
            return
        if isinstance(mode, str) and any(flag in mode for flag in "wax+"):
            raise PermissionError("Blocked by the EdCurie runner: file write")
        real = os.path.realpath(os.fsdecode(target))
        if not real.startswith(_allowed):
            raise PermissionError("Blocked by the EdCurie runner: file access")
with open(os.path.join(_work, sys.argv[2]), encoding="utf-8") as _f:
    _source = _f.read()
try:
    _code = compile(_source, "solution.py", "exec")
except (SyntaxError, ValueError) as _error:
    import traceback
    sys.stderr.write("".join(traceback.format_exception_only(type(_error), _error)))
    sys.stderr.flush()
    os._exit(${COMPILE_EXIT})
sys.addaudithook(_guard)
sys.argv = ["solution.py"]
sys.setrecursionlimit(5000)
del _f, _source
exec(_code, {"__name__": "__main__", "__builtins__": __builtins__})
`;

const nodeGuard = String.raw`
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path");
const file = path.join(process.argv[2], process.argv[3]);
const source = fs.readFileSync(file, "utf8");
try { new vm.Script(source, { filename: "solution.js" }); }
catch (error) {
  const lines = String(error && error.stack || error).split("\n");
  const end = lines.findIndex(line => /^\s+at /.test(line));
  process.stderr.write(lines.slice(0, end < 0 ? 8 : end).join("\n") + "\n");
  process.exit(${COMPILE_EXIT});
}
const deny = () => { throw new Error("Network access is blocked by the EdCurie runner."); };
for (const name of ["net", "tls", "http", "https", "http2", "dgram", "dns"]) {
  const mod = require(name);
  for (const key of ["connect", "createConnection", "request", "get", "createSocket", "lookup", "resolve", "createServer"]) {
    if (typeof mod[key] === "function") mod[key] = deny;
  }
}
globalThis.fetch = deny; globalThis.WebSocket = undefined; globalThis.EventSource = undefined;
process.argv = [process.argv[0], file];
require(file);
`;

let pythonCommand: string | null | undefined;
function python() {
  if (pythonCommand !== undefined) return pythonCommand;
  for (const candidate of [process.env.CODE_RUNNER_PYTHON, "python3", "python"].filter(Boolean) as string[]) {
    const probe = spawnSync(candidate, ["-c", "import sys; print(sys.version_info[:2] >= (3, 8))"], { encoding: "utf8", timeout: 4000, env: {} });
    if (probe.status === 0 && probe.stdout.trim() === "True") return (pythonCommand = candidate);
  }
  return (pythonCommand = null);
}
export function availableLanguages(): Language[] {
  return [...(python() ? ["python" as const] : []), "javascript"];
}

let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(task: () => Promise<T>) {
  if (active >= MAX_CONCURRENT) await new Promise<void>(resolve => waiting.push(resolve));
  active++;
  try { return await task(); }
  finally { active--; waiting.shift()?.(); }
}

export async function runProgram(language: Language, source: string, stdin: string): Promise<ProcessResult> {
  if (!availableLanguages().includes(language)) throw new HttpError(503, `The ${language} runner is not installed on this server.`);
  return slot(async () => {
    const work = await realpath(await mkdtemp(path.join(tmpdir(), "edcurie-run-")));
    try {
      const python3 = python();
      const [main, guard] = language === "python" ? ["solution.py", "guard.py"] : ["solution.js", "guard.cjs"];
      await writeFile(path.join(work, main), source, { mode: 0o400 });
      await writeFile(path.join(work, guard), language === "python" ? pythonGuard : nodeGuard, { mode: 0o400 });
      const command = language === "python"
        ? [python3!, "-I", "-S", "-B", path.join(work, guard), work, main]
        : [process.execPath, "--permission", `--allow-fs-read=${work}`, "--max-old-space-size=128", "--stack-size=2000", path.join(work, guard), work, main];
      const memory = language === "python" ? "ulimit -v 524288 2>/dev/null;" : "";
      const script = `ulimit -t ${CPU_SECONDS} 2>/dev/null; ulimit -f 1024 2>/dev/null; ulimit -c 0 2>/dev/null; ${memory} exec "$@"`;
      return await new Promise<ProcessResult>(resolve => {
        const started = performance.now();
        const child = spawn("/bin/sh", ["-c", script, "edcurie-runner", ...command], {
          cwd: work, detached: true, stdio: ["pipe", "pipe", "pipe"],
          env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", HOME: work, PYTHONIOENCODING: "utf-8", PYTHONHASHSEED: "0" },
        });
        let stdout = "", stderr = "", overflow = false, timedOut = false;
        const kill = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
        const timer = setTimeout(() => { timedOut = true; kill(); }, WALL_MS);
        const collect = (target: "out" | "err") => (chunk: Buffer) => {
          if (target === "out") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
          if (stdout.length + stderr.length > OUTPUT_LIMIT) { overflow = true; kill(); }
        };
        child.stdout.on("data", collect("out"));
        child.stderr.on("data", collect("err"));
        child.stdin.on("error", () => {});
        child.stdin.end(stdin);
        child.on("close", (code, signal) => {
          clearTimeout(timer);
          const timeMs = Math.round(performance.now() - started);
          const clean = (text: string) => text.replaceAll(work + path.sep, "").replaceAll(work, ".").slice(0, 8000);
          const verdict: ProcessResult["verdict"] = overflow ? "output_limit"
            : timedOut || signal === "SIGXCPU" || code === 152 ? "timeout"
            : code === COMPILE_EXIT ? "compile_error"
            : code === 0 ? "ok" : "runtime_error";
          resolve({ verdict, stdout: clean(stdout).slice(0, OUTPUT_LIMIT), stderr: clean(stderr), timeMs });
        });
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}

export const normalizeOutput = (text: string) => text.replace(/\r\n/g, "\n").split("\n").map(line => line.trimEnd()).join("\n").trim();

async function check(spec: Pick<CodingSpec, "language" | "checker">, test: TestCase, stdout: string) {
  if (!spec.checker) return normalizeOutput(stdout) === normalizeOutput(test.expected);
  const verdict = await runProgram(spec.language, spec.checker, JSON.stringify({ input: test.input, expected: test.expected, actual: stdout }));
  return verdict.verdict === "ok" && /^OK\b/.test(verdict.stdout.trim());
}

export async function runTests(spec: Pick<CodingSpec, "language" | "checker">, source: string, tests: TestCase[]) {
  const results: TestResult[] = [];
  for (const test of tests) {
    const run = await runProgram(spec.language, source, test.input);
    const verdict: Verdict = run.verdict === "ok" ? (await check(spec, test, run.stdout) ? "passed" : "failed") : run.verdict;
    results.push({ name: test.name, category: test.category, hidden: test.hidden, verdict, timeMs: run.timeMs,
      input: test.input, expected: test.expected, stdout: run.stdout, stderr: run.stderr });
    // A compile error fails every test; after a timeout the remaining tests are not run, to bound server time.
    if (verdict === "compile_error" || verdict === "timeout") {
      const rest = verdict === "compile_error" ? verdict : "skipped";
      for (const other of tests.slice(results.length)) results.push({ name: other.name, category: other.category, hidden: other.hidden, verdict: rest, timeMs: 0, input: other.input, expected: other.expected });
      break;
    }
  }
  const passed = results.filter(result => result.verdict === "passed").length;
  const order: Verdict[] = ["compile_error", "timeout", "runtime_error", "output_limit", "failed"];
  const overall: Verdict = passed === results.length ? "passed" : order.find(v => results.some(r => r.verdict === v)) ?? "failed";
  return { verdict: overall, passed, total: results.length, results };
}

/** Removes inputs, expected outputs and program output from hidden tests. */
export function redact(results: TestResult[]) {
  return results.map(result => result.hidden
    ? { name: result.name, category: result.category, hidden: true, verdict: result.verdict, timeMs: result.timeMs }
    : result);
}

const str = (value: unknown, label: string, max: number, required = true) => {
  if (typeof value !== "string" || value.length > max || value.includes("\u0000") || (required && !value.trim())) {
    throw new HttpError(400, `${label} is required and must be at most ${max} characters.`);
  }
  return value;
};

export function validateSpec(value: unknown): CodingSpec {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const language = body.language;
  if (language !== "python" && language !== "javascript") throw new HttpError(400, "Choose Python or JavaScript for a coding question.");
  if (!Array.isArray(body.tests) || body.tests.length < 3 || body.tests.length > 30) throw new HttpError(400, "A coding question needs 3 to 30 tests.");
  const names = new Set<string>();
  const tests = body.tests.map((item, index): TestCase => {
    const test = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const name = typeof test.name === "string" && test.name.trim() ? test.name.trim().slice(0, 120) : `Test ${index + 1}`;
    if (names.has(name)) throw new HttpError(400, `Test names must be distinct (${name}).`);
    names.add(name);
    const category = test.category;
    if (category !== "normal" && category !== "boundary" && category !== "edge") throw new HttpError(400, `${name}: choose normal, boundary or edge.`);
    if (typeof test.hidden !== "boolean") throw new HttpError(400, `${name}: mark the test as visible or hidden.`);
    return { name, category, hidden: test.hidden, input: str(test.input, `${name} input`, 20000, false), expected: str(test.expected, `${name} expected output`, 20000, false) };
  });
  if (!tests.some(test => !test.hidden)) throw new HttpError(400, "Include at least one visible sample test.");
  if (!tests.some(test => test.hidden)) throw new HttpError(400, "Include at least one hidden test.");
  for (const category of ["normal", "boundary", "edge"] as const) {
    if (!tests.some(test => test.category === category)) throw new HttpError(400, `Include at least one ${category} test.`);
  }
  const checker = typeof body.checker === "string" && body.checker.trim() ? str(body.checker, "Checker", 20000) : null;
  if (!checker && tests.some(test => !test.expected.trim())) throw new HttpError(400, "Every test needs an expected output unless the question uses a checker.");
  return {
    language,
    statement: str(body.statement, "Problem statement", 20000),
    starterCode: str(body.starterCode ?? "", "Starter code", 20000, false),
    inputFormat: str(body.inputFormat, "Input format", 4000),
    outputFormat: str(body.outputFormat, "Output format", 4000),
    tests,
    referenceSolution: str(body.referenceSolution, "Reference solution", 20000),
    checker,
  };
}

/** Validates a spec and runs the reference solution against every test. */
export async function verifySpec(value: unknown) {
  const spec = validateSpec(value);
  const report = await runTests(spec, spec.referenceSolution, spec.tests);
  return { spec, ready: report.verdict === "passed", report: { ...report, checkedAt: new Date().toISOString() } };
}
