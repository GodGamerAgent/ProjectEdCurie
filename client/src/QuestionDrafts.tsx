import { useCallback, useEffect, useState } from "react";
import { api, jsonBody } from "./api";

type Draft = { id: string; prompt: string; answer: string; sourceQuote: string; sourceTitle: string; sourceVersion: number; conceptName: string };
export default function QuestionDrafts({ assessmentId, concepts, refresh }: {
  assessmentId: string | number; concepts: { id: string; name: string }[]; refresh: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [conceptId, setConceptId] = useState("");
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const data = await api<{ drafts: Draft[] }>(`/api/assessments/${assessmentId}/ai-drafts`);
    setDrafts(data.drafts);
  }, [assessmentId]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  async function generate() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ count: number }>(`/api/assessments/${assessmentId}/ai-drafts`, { method: "POST", body: jsonBody({ conceptId, count }) });
      await load(); setNotice(`${result.count} draft question(s) saved for review. Students cannot see these yet.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate questions."); }
    finally { setBusy(false); }
  }
  async function review(draft: Draft, action: "accept" | "discard") {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/ai-question-drafts/${draft.id}/review`, { method: "POST", body: jsonBody({ action, prompt: draft.prompt, answer: draft.answer }) });
      await load(); await refresh();
      setNotice(action === "accept" ? "Question approved and added. Publish the assessment after reviewing all its questions." : "Draft discarded.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the review."); }
    finally { setBusy(false); }
  }
  function edit(id: string, field: "prompt" | "answer", value: string) {
    setDrafts(previous => previous.map(d => d.id === id ? { ...d, [field]: value } : d));
  }
  return <section className="resource-card" aria-label="AI question drafts" style={{ marginTop: 16 }}>
    <h4>Draft questions with AI</h4>
    <p className="muted">Choose a concept with a published resource. AI uses its first 12,000 characters. Check every question and source quote before approving; you control publication. Unsaved edits are lost on refresh.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!concepts.length ? <p>Add a concept linked to a resource to enable drafting.</p> : <div className="form-grid">
      <div className="field"><label htmlFor={`draft-concept-${assessmentId}`}>Concept</label><select id={`draft-concept-${assessmentId}`} value={conceptId} disabled={busy} onChange={e => setConceptId(e.target.value)}><option value="">Choose a concept</option>{concepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="field"><label htmlFor={`draft-count-${assessmentId}`}>Questions</label><select id={`draft-count-${assessmentId}`} value={count} disabled={busy} onChange={e => setCount(Number(e.target.value))}>{[1,2,3].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
      <div><button type="button" className="button small" disabled={busy || !conceptId} onClick={() => void generate()}>{busy ? "Working…" : "Generate draft questions"}</button></div>
    </div>}
    {drafts.map(d => <article className="question-card" key={d.id} style={{ marginTop: 20 }}>
      <h4>{d.conceptName} · Pending teacher review</h4>
      <p className="muted">Source: {d.sourceTitle} · version {d.sourceVersion}</p>
      <blockquote style={{ whiteSpace: "pre-wrap" }}>{d.sourceQuote}</blockquote>
      <div className="field"><label htmlFor={`ai-prompt-${d.id}`}>Review question and options</label><textarea id={`ai-prompt-${d.id}`} rows={8} maxLength={5000} disabled={busy} value={d.prompt} onChange={e => edit(d.id, "prompt", e.target.value)} /></div>
      <div className="field"><label htmlFor={`ai-answer-${d.id}`}>Expected answer (exact text used for grading)</label><input id={`ai-answer-${d.id}`} maxLength={5000} disabled={busy} value={d.answer} onChange={e => edit(d.id, "answer", e.target.value)} /></div>
      <div className="row" style={{ marginTop: 12 }}><button type="button" className="button small success" disabled={busy || !d.prompt.trim() || !d.answer.trim()} onClick={() => void review(d, "accept")}>Approve and add to assessment</button><button type="button" className="button small" disabled={busy} onClick={() => void review(d, "discard")}>Discard draft</button></div>
    </article>)}
  </section>;
}
