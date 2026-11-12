import { expect, it } from "vitest";
import { availableLanguages, redact, runProgram, runTests, verifySpec } from "../server/code-runner";

const python = availableLanguages().includes("python");
const tests = [
  { name: "a", input: "2 3\n", expected: "5", hidden: false, category: "normal" as const },
  { name: "b", input: "0 0\n", expected: "0", hidden: true, category: "boundary" as const },
  { name: "c", input: "-1 1\n", expected: "0", hidden: true, category: "edge" as const },
];

it("isolates JavaScript programs from secrets, files, processes and the network", async () => {
  process.env.EDCURIE_SECRET_PROBE = "do-not-leak";
  const env = await runProgram("javascript", "console.log(String(process.env.EDCURIE_SECRET_PROBE))", "");
  expect(env).toMatchObject({ verdict: "ok", stdout: "undefined\n" });
  for (const source of ["require('child_process').execSync('id')", "require('fs').writeFileSync('x','1')", "require('fs').readFileSync('/etc/passwd')", "require('net').connect(80,'127.0.0.1')"]) {
    expect((await runProgram("javascript", source, "")).verdict).toBe("runtime_error");
  }
  expect((await runProgram("javascript", "for(;;){}", "")).verdict).toBe("timeout");
}, 30000);

it.skipIf(!python)("runs Python with the same guard and distinct verdicts", async () => {
  const spec = { language: "python" as const, checker: null };
  const right = await runTests(spec, "a,b=map(int,input().split())\nprint(a+b)", tests);
  expect(right).toMatchObject({ verdict: "passed", passed: 3 });
  const wrong = await runTests(spec, "a,b=map(int,input().split())\nprint(a+b if a else 1)", tests);
  expect(wrong).toMatchObject({ verdict: "failed", passed: 2 });
  expect(redact(wrong.results)[1]).toEqual({ name: "b", category: "boundary", hidden: true, verdict: "failed", timeMs: expect.any(Number) });
  expect((await runTests(spec, "print(", tests)).verdict).toBe("compile_error");
  expect((await runTests(spec, "while True: pass", tests.slice(0, 1))).verdict).toBe("timeout");
  for (const source of ["import socket", "import subprocess; subprocess.run(['id'])", "open('/etc/passwd').read()", "open('x','w')"]) {
    expect((await runProgram("python", source, "")).verdict).toBe("runtime_error");
  }
}, 30000);

it.skipIf(!python)("marks a coding spec ready only when its reference solution passes, with an optional checker", async () => {
  const base = { language: "python", statement: "Add", starterCode: "", inputFormat: "a b", outputFormat: "sum", tests };
  expect((await verifySpec({ ...base, referenceSolution: "a,b=map(int,input().split())\nprint(a+b)" })).ready).toBe(true);
  expect((await verifySpec({ ...base, referenceSolution: "print(0)" })).ready).toBe(false);
  const checker = "import json,sys\nd=json.load(sys.stdin)\nprint('OK' if d['actual'].strip() in ('5','05','0') else 'WRONG')";
  expect((await verifySpec({ ...base, tests: tests.map(t => ({ ...t, expected: "" })), referenceSolution: "a,b=map(int,input().split())\nprint(a+b)", checker })).ready).toBe(true);
  await expect(verifySpec({ ...base, tests: tests.slice(0, 2), referenceSolution: "print(1)" })).rejects.toThrow("3 to 30 tests");
}, 30000);
