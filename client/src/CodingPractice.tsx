import { lazy, Suspense, useEffect, useState } from "react";
import { api, jsonBody } from "./api";
import Markdown from "./Markdown";

const CodeEditor = lazy(() => import("./CodeEditor"));

export type StudentCoding = {
  language: string; statement: string; inputFormat: string; outputFormat: string; starterCode: string;
  samples: { name: string; input: string; expected: string }[]; hiddenTests: number;
};
type Result = { name: string; category: string; hidden: boolean; verdict: string; timeMs: number; input?: string; expected?: string; stdout?: string; stderr?: string };
type Report = { verdict: string; passed: number; total: number; results: Result[] };

const verdicts: Record<string, { label: string; tone: string; help: string }> = {
  passed: { label: "Passed", tone: "green", help: "" },
  failed: { label: "Wrong answer", tone: "red", help: "The program ran but printed a different output." },
  compile_error: { label: "Compile error", tone: "red", help: "The code could not be parsed. Fix the syntax error shown below." },
  runtime_error: { label: "Runtime error", tone: "red", help: "The program crashed while running. Read the error message below." },
  timeout: { label: "Time limit exceeded", tone: "amber", help: "The program ran longer than the time limit. Look for an infinite loop or a slow algorithm." },
  output_limit: { label: "Output limit exceeded", tone: "amber", help: "The program printed too much output." },
  skipped: { label: "Not run", tone: "", help: "Skipped after an earlier test exceeded the time limit." },
};

function ResultView({ report, submitted }: { report: Report; submitted: boolean }) {
  const summary = verdicts[report.verdict] ?? verdicts.failed;
  const firstError = report.results.find(result => result.stderr?.trim() && (result.verdict === "compile_error" || result.verdict === "runtime_error"));
  return <section className="stack run-report" aria-live="polite">
    <div className={`notice ${report.verdict === "passed" ? "success" : report.verdict === "timeout" ? "warn" : "error"}`}>
      <strong>{submitted ? (report.verdict === "passed" ? "Accepted · all tests passed" : `Not accepted · ${summary.label}`) : summary.label}</strong>
      {" "}· {report.passed}/{report.total} {submitted ? "tests (including hidden)" : "sample tests"} passed.
      {summary.help && <div>{summary.help}</div>}
    </div>
    {firstError && <pre className="run-output error-output">{firstError.stderr}</pre>}
    <div className="test-results">
      {report.results.map(result => <details key={result.name} className="test-result" open={!result.hidden && result.verdict !== "passed" && result.verdict !== "compile_error"}>
        <summary><span className={`badge ${verdicts[result.verdict]?.tone ?? "red"}`}>{verdicts[result.verdict]?.label ?? result.verdict}</span>
          {" "}{result.name}{result.hidden ? " · hidden" : ""} · {result.category} · {result.timeMs} ms</summary>
        {result.hidden ? <p className="muted">Hidden test: its input and expected output stay private.</p> : <div className="io-grid">
          <div><span className="field-label">Input</span><pre className="run-output">{result.input || "(empty)"}</pre></div>
          <div><span className="field-label">Expected</span><pre className="run-output">{result.expected}</pre></div>
          <div><span className="field-label">Your output</span><pre className="run-output">{result.stdout || "(no output)"}</pre></div>
          {result.stderr?.trim() && result.verdict !== "compile_error" && <div><span className="field-label">Errors</span><pre className="run-output error-output">{result.stderr}</pre></div>}
        </div>}
      </details>)}
    </div>
  </section>;
}

/** In-app IDE: edit starter code, run the visible tests, then submit for verification against hidden tests on the server. */
export default function CodingPractice({ path, questionId, coding, onBack }: { path: string; questionId: string; coding: StudentCoding; onBack: () => void }) {
  const storageKey = `edcurie-code-${questionId}`;
  const [code, setCode] = useState(() => { try { return localStorage.getItem(storageKey) ?? coding.starterCode; } catch { return coding.starterCode; } });
  const [busy, setBusy] = useState<"" | "run" | "submit">("");
  const [report, setReport] = useState<{ report: Report; submitted: boolean } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { try { localStorage.setItem(storageKey, code); } catch { /* storage unavailable */ } }, [storageKey, code]);
  async function execute(kind: "run" | "submit") {
    setBusy(kind); setError("");
    try { setReport({ report: await api<Report>(`${path}/questions/${questionId}/${kind}`, { method: "POST", body: jsonBody({ code }) }), submitted: kind === "submit" }); }
    catch (e) { setError(e instanceof Error ? e.message : "The runner is unavailable."); }
    finally { setBusy(""); }
  }
  return <section className="stack ide">
    <div className="row"><h3>Coding exercise · {coding.language === "python" ? "Python 3" : "JavaScript (Node.js)"}</h3><button className="button small" onClick={onBack}>Back to questions</button></div>
    <div className="ide-layout">
      <div className="ide-problem stack">
        <Markdown text={coding.statement} />
        <div><span className="field-label">Input</span><Markdown text={coding.inputFormat} /></div>
        <div><span className="field-label">Output</span><Markdown text={coding.outputFormat} /></div>
        {coding.samples.map(sample => <div key={sample.name} className="io-grid">
          <div><span className="field-label">{sample.name} · input</span><pre className="run-output">{sample.input || "(empty)"}</pre></div>
          <div><span className="field-label">Expected output</span><pre className="run-output">{sample.expected}</pre></div>
        </div>)}
        <p className="muted">Submitting also runs {coding.hiddenTests} hidden test{coding.hiddenTests === 1 ? "" : "s"}, including boundary and edge cases.</p>
      </div>
      <div className="ide-editor stack">
        <Suspense fallback={<p className="muted">Loading code editor…</p>}>
          <CodeEditor label="Your solution" language={coding.language} value={code} onChange={setCode} minHeight={340} />
        </Suspense>
        <div className="card-actions">
          <button className="button small" disabled={!!busy || !code.trim()} onClick={() => void execute("run")}>{busy === "run" ? "Running…" : "Run sample tests"}</button>
          <button className="button small primary" disabled={!!busy || !code.trim()} onClick={() => void execute("submit")}>{busy === "submit" ? "Verifying…" : "Submit solution"}</button>
          <button className="button small quiet" disabled={!!busy} onClick={() => { if (confirm("Replace your code with the starter code?")) setCode(coding.starterCode); }}>Reset to starter code</button>
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
        {report && <ResultView report={report.report} submitted={report.submitted} />}
      </div>
    </div>
  </section>;
}
