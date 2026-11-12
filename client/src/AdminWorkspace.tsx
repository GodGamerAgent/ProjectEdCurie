import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, jsonBody } from "./api";

type Institute = { id: string; displayName: string; hasLogo: boolean };

export default function AdminWorkspace() {
  const [institutes, setInstitutes] = useState<Institute[]>([]);
  const [selected, setSelected] = useState("");
  const [newName, setNewName] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [invitations, setInvitations] = useState<{ email: string }[]>([]);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoVersion, setLogoVersion] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = institutes.find((item) => item.id === selected);

  const refresh = useCallback(async () => {
    const data = await api<{ institutes: Institute[] }>("/api/admin/institutes");
    setInstitutes(data.institutes);
    return data.institutes;
  }, []);
  const refreshSelected = useCallback(async (id: string) => {
    const [domainData, invitationData] = await Promise.all([
      api<{ domains: string[] }>(`/api/admin/institutes/${id}/domains`),
      api<{ invitations: { email: string }[] }>(`/api/admin/institutes/${id}/invitations`),
    ]);
    setDomains(domainData.domains); setInvitations(invitationData.invitations);
  }, []);
  useEffect(() => { void refresh().catch((e) => setError(e.message)); }, [refresh]);
  useEffect(() => {
    let current = true;
    setName(active?.displayName ?? "");
    setDomains([]); setInvitations([]); setLogo(null);
    if (selected) void Promise.all([
      api<{ domains: string[] }>(`/api/admin/institutes/${selected}/domains`),
      api<{ invitations: { email: string }[] }>(`/api/admin/institutes/${selected}/invitations`),
    ]).then(([domainData, invitationData]) => {
      if (current) { setDomains(domainData.domains); setInvitations(invitationData.invitations); }
    }).catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [selected]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); setMessage(success); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to update institute setup."); }
    finally { setBusy(false); }
  }
  function createInstitute(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const created = await api<Institute>("/api/admin/institutes", { method: "POST", body: jsonBody({ displayName: newName }) });
      await refresh(); setSelected(created.id); setNewName("");
    }, "Institute created.");
  }
  function updateName(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api(`/api/admin/institutes/${selected}`, { method: "PATCH", body: jsonBody({ displayName: name }) });
      await refresh();
    }, "Institute name updated.");
  }
  function addDomain(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api(`/api/admin/institutes/${selected}/domains`, { method: "POST", body: jsonBody({ domain }) });
      setDomain(""); await refreshSelected(selected);
    }, "Domain approved for this institute.");
  }
  function inviteTeacher(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api(`/api/admin/institutes/${selected}/invitations`, { method: "POST", body: jsonBody({ email }) });
      setEmail(""); await refreshSelected(selected);
    }, "Teacher invitation recorded.");
  }
  function uploadLogo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!logo) return;
    void run(async () => {
      const data = new FormData(); data.append("logo", logo);
      await api(`/api/admin/institutes/${selected}/logo`, { method: "POST", body: data });
      setLogo(null); form.reset(); setLogoVersion((v) => v + 1); await refresh();
    }, "Institute logo updated.");
  }
  function removeLogo() {
    void run(async () => {
      await api(`/api/admin/institutes/${selected}/logo`, { method: "DELETE" });
      setLogoVersion((v) => v + 1); await refresh();
    }, "Institute logo removed.");
  }
  return <div className="workspace-grid">
    <nav className="side-nav panel" aria-label="Admin workspace"><button aria-current="page">Institute setup</button><button onClick={() => document.getElementById("teacher-invites")?.scrollIntoView({ behavior: "smooth" })}>Teacher invitations</button></nav>
    <section className="panel main-panel">
      <div className="eyebrow">Platform administration</div><h2>Set up institutes.</h2>
      <p className="muted">Create each institute, approve its email domains, and invite its teachers. The workspace starts empty.</p>
      {error && <div className="notice error" role="alert">{error}</div>}
      {message && <div className="notice success" role="status">{message}</div>}
      <form className="form-grid" onSubmit={createInstitute}>
        <div className="field"><label htmlFor="create-institute">New institute name</label><input id="create-institute" required maxLength={200} value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
        <div className="field" style={{ alignSelf: "end" }}><button className="button primary" disabled={busy}>Create institute</button></div>
      </form>
      {institutes.length > 0 && <div className="field" style={{ marginTop: 24 }}><label htmlFor="select-institute">Select institute to configure</label><select id="select-institute" value={selected} disabled={busy} onChange={(e) => setSelected(e.target.value)}><option value="">Choose an institute</option>{institutes.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></div>}
      {!institutes.length && <div className="empty" style={{ marginTop: 20 }}><h3>No institutes yet</h3><p>Create an institute to configure its access and branding.</p></div>}
      {active && <>
        <div className="divider" />
        <h3>Institute details</h3>
        <form className="form-grid" onSubmit={updateName}>
          <div className="field"><label htmlFor="institute-name">Display name</label><input id="institute-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field" style={{ alignSelf: "end" }}><button className="button" disabled={busy}>Save name</button></div>
        </form>
        <div style={{ marginTop: 20 }}><h3>Optional logo</h3><p className="muted">PNG, JPEG, or WebP up to 512 KB. The logo is shown only to members of this institute.</p>
          {active.hasLogo && <div className="row" style={{ marginBottom: 12 }}><img className="institute-logo-preview" src={`/api/admin/institutes/${selected}/logo?v=${logoVersion}`} alt={`${active.displayName} logo`} /><button className="button small" type="button" disabled={busy} onClick={removeLogo}>Remove logo</button></div>}
          <form className="form-grid" onSubmit={uploadLogo}><div className="field"><label htmlFor="institute-logo">Choose logo</label><input id="institute-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} /></div><div className="field" style={{ alignSelf: "end" }}><button className="button" disabled={busy || !logo}>Upload logo</button></div></form>
        </div>
        <div className="divider" /><h3>Approved domains</h3><p className="muted">Only verified accounts on these domains can join this institute.</p>
        <form className="form-grid" onSubmit={addDomain}><div className="field"><label htmlFor="new-domain">Email domain</label><input id="new-domain" required placeholder="institute.edu" value={domain} onChange={(e) => setDomain(e.target.value)} /></div><div className="field" style={{ alignSelf: "end" }}><button className="button primary" disabled={busy}>Add approved domain</button></div></form>
        <div className="stack" style={{ marginTop: 16 }}>{domains.length ? domains.map((item) => <div className="course-card row" key={item}><span className="mono">{item}</span><span className="badge green">Approved</span></div>) : <p className="muted">No approved domains yet.</p>}</div>
        <div className="divider" /><div id="teacher-invites"><h3>Invite a teacher</h3><p className="muted">The teacher's verified email must belong to this institute.</p>
          <form className="form-grid" onSubmit={inviteTeacher}><div className="field"><label htmlFor="teacher-email">Teacher email</label><input id="teacher-email" type="email" required placeholder="name@institute.edu" value={email} onChange={(e) => setEmail(e.target.value)} /></div><div className="field" style={{ alignSelf: "end" }}><button className="button primary" disabled={busy}>Add invitation</button></div></form>
          <div className="stack" style={{ marginTop: 16 }}>{invitations.length ? invitations.map((item) => <div className="course-card row" key={item.email}><span>{item.email}</span><span className="badge">Invited teacher</span></div>) : <p className="muted">No teacher invitations yet.</p>}</div>
        </div>
      </>}
    </section>
  </div>;
}
