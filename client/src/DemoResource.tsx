import { useEffect, useState, type FormEvent } from "react";
import { api, jsonBody } from "./api";
import ResourceReview from "./ResourceReview";
import MarkdownEditor from "./MarkdownEditor";
export type Resource = { id: string; title: string; status: string; extractionStatus?: string; text?: string; hasFile: boolean; version?:number };

export function ResourceEditor({ resource, busy, refresh, onPublish, onArchive }: {
  resource: Resource;
  busy: boolean;
  refresh: () => Promise<void>;
  onPublish: () => void;
  onArchive: () => void;
}) {
  const [title, setTitle] = useState(resource.title);
  const [text, setText] = useState(resource.text || "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<{ id: string; version: number; title: string; status: string }[]>([]);
  const [preview, setPreview] = useState<{ title: string; version: number; text: string } | null>(null);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const published = resource.status === "published";
  const changed = title !== resource.title || text !== (resource.text || "");

  useEffect(() => {
    setTitle(resource.title);
    setText(resource.text || "");
  }, [resource.title, resource.text, resource.version]);

  async function loadVersions() {
    setError("");
    try {
      const data = await api<{ versions: typeof versions }>(`/api/resources/${resource.id}/versions`);
      setVersions(data.versions);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load version history."); }
  }

  async function openVersion(versionId: string) {
    setError("");
    try {
      setPreview(await api(`/api/resources/${resource.id}/versions/${versionId}`));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open this version."); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSaveMessage("");
    try {
      await api(`/api/resources/${resource.id}`, { method: "PATCH", body: jsonBody({ title, text }) });
      await refresh();
      if (versions.length) await loadVersions();
      setSaveMessage("Edits saved as a new draft.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save edits.");
    } finally { setSaving(false); }
  }

  return <article className="resource-card">
    <div className="row">
      <div><h3>{resource.title}</h3><div className="card-actions">
        <span className={`badge ${published ? "green" : "amber"}`}>{resource.status}</span>
        <span className="badge">Version {resource.version || 1}</span>
        {resource.extractionStatus && <span className="badge">Extraction: {resource.extractionStatus}</span>}
      </div></div>
      {resource.hasFile && <a className="button small" href={`/api/resources/${resource.id}/file`} target="_blank" rel="noreferrer">Open original</a>}
    </div>
    <div className="card-actions">
      <button className="button small primary" type="button" onClick={() => { setError(""); setEditing(true); }}>Review and edit</button>
      <button className="button small" type="button" onClick={() => void loadVersions()}>Version history</button>
      {!published && <button className="button small success" type="button" disabled={busy || saving || changed || !resource.text?.trim()} onClick={onPublish}>Publish resource</button>}
      <button className="button small" type="button" disabled={busy || saving} onClick={onArchive}>Delete resource</button>
    </div>
    {changed && !editing && <p className="muted">You have unsaved edits. Reopen the review to save them.</p>}
    {error && !editing && <p className="notice error" role="alert">{error}</p>}
    {versions.length > 0 && <div className="stack" style={{marginTop:10}}>
      {versions.map(version => <div key={version.id} className="row">
        <span>v{version.version} · {version.status} · {version.title}</span>
        <button className="button small" type="button" onClick={() => void openVersion(version.id)}>Preview version {version.version}</button>
      </div>)}
    </div>}
    {preview && <ResourceReview title={`${preview.title} · v${preview.version}`} text={preview.text} onClose={() => setPreview(null)} />}
    {editing && <ResourceReview title="Review course resource" text={text} showPreview={false} onClose={() => setEditing(false)}>
      <form className="stack" onSubmit={save}>
        <div className="field"><label htmlFor={`resource-edit-title-${resource.id}`}>Title</label>
          <input id={`resource-edit-title-${resource.id}`} value={title} maxLength={200} required disabled={saving} onChange={event => { setSaveMessage(""); setTitle(event.target.value); }} />
        </div>
        <MarkdownEditor label="Resource Markdown (source material)" value={text} rows={22} maxLength={500000} required disabled={saving}
          onChange={value => { setSaveMessage(""); setText(value); }} />
        {published && <p className="muted">Saving edits creates a draft. Publish it again to make it available to students.</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        {saveMessage && <p className="notice success" role="status">{saveMessage}</p>}
        <div className="card-actions"><button className="button small primary" disabled={busy || saving || !changed || !title.trim() || !text.trim()}>{saving ? "Saving…" : "Save edits"}</button></div>
      </form>
    </ResourceReview>}
  </article>;
}
