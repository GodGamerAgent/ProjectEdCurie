import { ClerkProvider, Show, SignIn, useAuth, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { FormEvent, MouseEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { Redirect as WouterRedirect, Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { api, jsonBody } from "./api";
import AdminWorkspace from "./AdminWorkspace";
import SignupFieldHints from "./SignupFieldHints";
import { StudentStudy, TeacherStudy } from "./StudyLoop";
import { StudentAssignments } from "./AssignmentPanels";
import RewardsPanel from "./RewardsPanel";
import StudentIntake from "./StudentIntake";

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const routeUrl = (path: string) => `${basePath}${path === "/" ? "/" : path}`;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

type Config = { authEnabled: boolean };
type InstituteBrand = { id: string; displayName: string; hasLogo: boolean };
type Person = { id: string; email: string; role: "admin" | "teacher" | "student" | string; institute: InstituteBrand | null };
type Course = { id: string | number; title: string; description: string; role?: string };
type Resource = { id: string | number; title: string; status: string; extractionStatus?: string; text?: string; hasFile: boolean; version?:number };
type Question = { id: string | number; prompt: string; answer?: string; resourceId?: string | number; conceptId?: string | null; version?:number };
type Assessment = { id: string | number; title: string; status: string; questions: Question[] };
type CourseDetail = { course: Course; resources: Resource[]; assessments: Assessment[]; enrollments: { email: string }[]; concepts: { id: string; name: string; resourceId: string }[] };
type Preferences = { availability: string; feedback: string; hints: string; formats: string[] };
type Onboarding = { state: string; message?: string };

function Panel({ children, className = "", as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" }) {
  const pointer = (event: MouseEvent<HTMLElement>) => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }
  };
  return <Tag className={`panel ${className}`} data-glass="true" onPointerMove={pointer} onPointerLeave={(event) => {
    event.currentTarget.style.setProperty("--mx", "30%");
    event.currentTarget.style.setProperty("--my", "0%");
  }}>{children}</Tag>;
}

function Brand() {
  return <a className="brand" href={routeUrl("/")} aria-label="EdCurie home"><span className="brand-mark" aria-hidden="true">ec</span><span>EdCurie</span></a>;
}

function Header({ authenticated = false, institute = null }: { authenticated?: boolean; institute?: InstituteBrand | null }) {
  return <header className="topbar">
    <div className="brand-group"><Brand />{institute && <div className="institute-brand">{institute.hasLogo && <img src="/api/institute/logo" alt="" />}<span>{institute.displayName}</span></div>}</div>
    <nav className="nav-actions" aria-label="Main navigation">
      {authenticated ? <><a className="nav-link" href={routeUrl("/app")}>Workspace</a><LogoutButton /></> :
        <><a className="nav-link" href="#how-it-works">How it works</a><a className="nav-link" href={routeUrl("/sign-in")}>Sign in</a><a className="button primary small" href={routeUrl("/sign-up")}>Get started</a></>}
    </nav>
  </header>;
}

function LogoutButton() {
  const { signOut } = useClerk();
  return <button className="button small" type="button" onClick={() => void signOut({ redirectUrl: basePath || "/" })}>Sign out</button>;
}

function Landing() {
  return <div className="app-shell">
    <Header />
    <main className="page-wrap">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">EdCurie · Learning, with a reason</div>
          <h1>Understand the<br /><span>why</span> behind it.</h1>
          <p>EdCurie connects classroom material to the moments that make learning stick. Teachers publish the source. Students build understanding from it.</p>
          <div className="hero-actions">
            <a className="button primary" href={routeUrl("/sign-up")}>Continue to EdCurie <span aria-hidden="true">↗</span></a>
            <a className="button" href={routeUrl("/sign-in")}>I already have an account</a>
          </div>
          <div className="hero-note">A learning space built around your courses</div>
        </div>
        <Panel className="orbit-panel">
          <div className="eyebrow">One connected learning loop</div>
          <div className="orbit" aria-label="Course material, questions, and understanding work together">
            <div className="orbit-ring outer" /><div className="orbit-ring inner" />
            <div className="orbit-dot a">SOURCE</div><div className="orbit-dot b">ASK</div>
            <div className="orbit-dot c">RECALL</div><div className="orbit-dot d">GROW</div>
            <div className="orbit-core">EdCurie</div>
          </div>
        </Panel>
      </section>

      <section className="section" aria-labelledby="learning-heading">
        <div className="section-head">
          <div><div className="eyebrow">Built around the classroom</div><h2 id="learning-heading">Learning starts with<br />what your institute teaches.</h2></div>
          <p>Every course begins with material from its teachers. No generic question bank, no invented course content.</p>
        </div>
        <div className="feature-grid">
          <Panel className="feature-card card"><div className="feature-index">01 / TEACH</div><h3>Publish the real source</h3><p>Teachers add notes and course resources, then shape a baseline assessment connected to what students will actually study.</p></Panel>
          <Panel className="feature-card card"><div className="feature-index">02 / LEARN</div><h3>A meaningful start</h3><p>Enrolled students can begin academic onboarding when their course is ready for them.</p></Panel>
          <Panel className="feature-card card"><div className="feature-index">03 / ADAPT</div><h3>Make it yours</h3><p>Set your study availability and choose how you prefer feedback, hints, and explanations.</p></Panel>
        </div>
      </section>

      <section id="how-it-works" className="section">
        <div className="section-head"><div><div className="eyebrow">The first milestone</div><h2>Ready when the institute is.</h2></div></div>
        <div className="steps-row">
          <div className="step"><span className="step-num">STEP 01</span><h3>Set up your institute</h3><p>An administrator approves email domains and invites the teaching team.</p></div>
          <div className="step"><span className="step-num">STEP 02</span><h3>Teachers publish</h3><p>Course materials and a linked baseline assessment prepare the learning space.</p></div>
          <div className="step"><span className="step-num">STEP 03</span><h3>Students begin</h3><p>Enrolled students start onboarding once the course has real, published material.</p></div>
        </div>
      </section>
      <Panel className="final-cta"><div><div className="eyebrow">Learn with EdCurie</div><h2>Bring your course into focus.</h2><p className="muted" style={{ margin: 0 }}>Sign in to continue.</p></div><a className="button primary" href={routeUrl("/sign-in")}>Sign in to EdCurie</a></Panel>
      <footer className="footer"><Brand /><span>Learning, with a reason</span></footer>
    </main>
  </div>;
}

function AuthPage({ kind }: { kind: "sign-in" | "sign-up" }) {
  return <><Show when="signed-in"><WouterRedirect to="/app" /></Show><Show when="signed-out"><div className="app-shell"><Header /><main className="auth-wrap">
    <Panel className="auth-card">
      <div className="eyebrow">EdCurie learning platform</div>
      <h1>{kind === "sign-in" ? "Welcome back." : "Join your institute."}</h1>
      <p className="muted">{kind === "sign-in" ? "Continue with your verified email account." : "Use a verified email. Institute members need an approved institute email."}</p>
      {kind === "sign-in"
        ? <SignIn routing="path" path={routeUrl("/sign-in")} signUpUrl={routeUrl("/sign-up")} forceRedirectUrl={routeUrl("/app")} />
        : <SignupFieldHints path={routeUrl("/sign-up")} signInUrl={routeUrl("/sign-in")} redirectUrl={routeUrl("/app")} />}
    </Panel>
  </main></div></Show></>;
}

function AuthDisabled({ error = "" }: { error?: string }) {
  return <div className="app-shell"><Header /><main className="auth-wrap"><Panel className="auth-card">
    <div className="eyebrow">EdCurie learning platform</div><h1>Sign-in unavailable.</h1>
    <p className="muted">{error || "Authentication is currently disabled for this app."}</p>
  </Panel></main></div>;
}

function LoadingPage() {
  return <main className="page-wrap narrow"><Panel className="main-panel"><div className="eyebrow">EdCurie workspace</div><h2>Opening your workspace</h2><div className="loading-skeleton" aria-label="Loading" /></Panel></main>;
}

function ErrorNotice({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="notice error" role="alert"><div>{error}</div>{retry && <button className="button small" onClick={retry} style={{ marginTop: 12 }}>Try again</button>}</div>;
}

function Workspace() {
  const { isLoaded, isSignedIn } = useAuth();
  const [person, setPerson] = useState<Person | null>(null);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadMe = useCallback(async () => {
    if (!isLoaded) return;
    if (!isSignedIn) { setPerson(null); setLoading(false); return; }
    setLoading(true); setAuthError("");
    try { setPerson(await api<Person>("/api/me")); } catch (error) {
      setPerson(null); setAuthError(error instanceof Error ? error.message : "Unable to load your account.");
    } finally { setLoading(false); }
  }, [isLoaded, isSignedIn]);
  useEffect(() => { void loadMe(); }, [loadMe]);
  if (!isLoaded || loading) return <LoadingPage />;
  if (!isSignedIn) return <div className="app-shell"><Header /><main className="page-wrap narrow"><Panel className="main-panel"><div className="eyebrow">Sign in required</div><h2>Your workspace is private.</h2><p className="muted">Sign in with your verified email account to continue.</p><a className="button primary" href="/sign-in">Sign in</a></Panel></main></div>;
  if (!person) return <div className="app-shell"><Header authenticated /><main className="page-wrap narrow"><Panel className="main-panel"><h2>We could not load your account.</h2><ErrorNotice error={authError || "Your account could not be verified."} retry={() => void loadMe()} /></Panel></main></div>;
  return <div className="app-shell"><Header authenticated institute={person.institute} /><main className="page-wrap">
    <div className="workspace-head"><div><div className="eyebrow">EdCurie workspace · {person.role}</div><h1>Hello.</h1><p>{person.email}</p></div></div>
    {person.role === "admin" ? <AdminWorkspace /> : person.role === "teacher" ? <TeacherWorkspace /> : person.role === "student" ? <StudentWorkspace /> : <Panel className="main-panel"><h2>Access is not assigned yet.</h2><p className="muted">Your account is verified, but it does not have an EdCurie workspace role.</p></Panel>}
  </main></div>;
}

function TeacherWorkspace() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setError("");
    try { const result = await api<{ courses: Course[] }>("/api/courses"); setCourses(result.courses); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load courses."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ course?: Course; id?: string | number }>("/api/courses", { method: "POST", body: jsonBody({ title: title.trim(), description: description.trim() }) });
      setTitle(""); setDescription(""); await refresh();
      if (result.course?.id || result.id) setSelectedId(result.course?.id || result.id || null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create course."); } finally { setBusy(false); }
  };
  return <div className="workspace-grid">
    <nav className="side-nav panel" aria-label="Teacher workspace"><button aria-current={selectedId === null ? "page" : undefined} onClick={() => setSelectedId(null)}>My courses</button>{courses?.map((course) => <button key={course.id} aria-current={selectedId === course.id ? "page" : undefined} onClick={() => setSelectedId(course.id)}>{course.title}</button>)}</nav>
    <Panel className="main-panel">
      {selectedId === null ? <><div className="eyebrow">Teacher workspace</div><h2>Your courses.</h2><p className="muted">Create a course, enroll its students, and publish source material with a baseline assessment.</p>
        {error && <ErrorNotice error={error} retry={() => void refresh()} />}
        <form className="form-grid" onSubmit={create} style={{ margin: "20px 0 24px" }}>
          <div className="field"><label htmlFor="course-title">Course title</label><input id="course-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Course title" /></div>
          <div className="field full"><label htmlFor="course-description">Description</label><textarea id="course-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What will students learn in this course?" /></div>
          <div className="field"><button className="button primary" disabled={busy}>Create course</button></div>
        </form>
        {courses === null ? <div className="stack"><div className="loading-skeleton" /><div className="loading-skeleton" /></div> : courses.length ? <div className="stack">{courses.map((course) => <article key={course.id} className="course-card card"><div className="row"><div><h3>{course.title}</h3><p>{course.description || "No description provided."}</p></div><button className="button small" onClick={() => setSelectedId(course.id)}>Open course</button></div></article>)}</div> : <div className="empty"><span className="empty-mark">EC</span><h3>No courses have been created</h3><p>Create your first course above. It will appear here after the API confirms it.</p></div>}
      </> : <CourseWorkspace courseId={selectedId} onBack={() => setSelectedId(null)} />}
    </Panel>
  </div>;
}

function CourseWorkspace({ courseId, onBack }: { courseId: string | number; onBack: () => void }) {
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrollEmail, setEnrollEmail] = useState("");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceText, setResourceText] = useState("");
  const [resourceFile, setResourceFile] = useState<File | null>(null);
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [questionByAssessment, setQuestionByAssessment] = useState<Record<string, { prompt: string; answer: string; resourceId: string; conceptId: string }>>({});
  const refresh = useCallback(async () => {
    setError("");
    try { const result = await api<CourseDetail>(`/api/courses/${courseId}`); setDetail(result); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load this course."); }
  }, [courseId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "The action could not be completed."); }
    finally { setBusy(false); }
  };
  const enroll = (event: FormEvent) => { event.preventDefault(); void run(async () => { await api(`/api/courses/${courseId}/enrollments`, { method: "POST", body: jsonBody({ email: enrollEmail.trim() }) }); setEnrollEmail(""); }, "Student enrolled."); };
  const upload = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const data = new FormData(); data.set("title", resourceTitle.trim()); data.set("text", resourceText);
      if (resourceFile) data.set("file", resourceFile);
      await api(`/api/courses/${courseId}/resources`, { method: "POST", body: data });
      setResourceTitle(""); setResourceText(""); setResourceFile(null);
      const input = document.getElementById("resource-file") as HTMLInputElement | null;
      if (input) input.value = "";
    }, "Resource saved as a draft.");
  };
  const newAssessment = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => { await api(`/api/courses/${courseId}/assessments`, { method: "POST", body: jsonBody({ title: assessmentTitle.trim() }) }); setAssessmentTitle(""); }, "Assessment draft created.");
  };
  const detailResource = (id: string | number) => detail?.resources.find((resource) => String(resource.id) === String(id));
  if (!detail && !error) return <div><button className="button small quiet" onClick={onBack}>← Courses</button><div className="loading-skeleton" style={{ marginTop: 16 }} /></div>;
  if (!detail) return <><button className="button small quiet" onClick={onBack}>← Courses</button><ErrorNotice error={error} retry={() => void refresh()} /></>;
  return <div>
    <button className="button small quiet" onClick={onBack}>← All courses</button>
    <div className="eyebrow" style={{ marginTop: 22 }}>Course workspace</div><h2>{detail.course.title}</h2><p className="muted">{detail.course.description}</p>
    {error && <ErrorNotice error={error} retry={() => void refresh()} />}{notice && <div className="notice success" role="status">{notice}</div>}
    <div className="divider" />
    <div className="row"><div><h3>Enrolled students</h3><p className="muted">Enroll a student by their institutional email.</p></div></div>
    <form className="form-grid" onSubmit={enroll}><div className="field"><label htmlFor="enroll-email">Student email</label><input id="enroll-email" type="email" required value={enrollEmail} onChange={(e) => setEnrollEmail(e.target.value)} /></div><div className="field" style={{ alignSelf: "end" }}><button className="button primary" disabled={busy}>Enroll student</button></div></form>
    {detail.enrollments.length ? <div className="stack" style={{ marginTop: 13 }}>{detail.enrollments.map((entry) => <div className="course-card row" key={entry.email}>{entry.email}<span className="badge">Enrolled</span></div>)}</div> : <div className="empty" style={{ marginTop: 14 }}><span className="empty-mark">01</span><h3>No students enrolled</h3><p>Enrollment is required before a student can open this course.</p></div>}
    <div className="divider" />
    <h3>Course resources</h3><p className="muted">Add a PDF or text file, or paste course material. Review and publish when ready.</p>
    <form className="form-grid" onSubmit={upload}>
      <div className="field"><label htmlFor="resource-title">Resource title</label><input id="resource-title" required value={resourceTitle} onChange={(e) => setResourceTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="resource-file">Optional PDF or text file</label><input id="resource-file" type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(e) => setResourceFile(e.target.files?.[0] || null)} /></div>
      <div className="field full"><label htmlFor="resource-text">Resource text or excerpt</label><textarea id="resource-text" value={resourceText} onChange={(e) => setResourceText(e.target.value)} placeholder="Paste source material or a reviewable excerpt" /></div>
      <div className="field"><button className="button primary" disabled={busy}>Save resource draft</button></div>
    </form>
    <div className="stack" style={{ marginTop: 17 }}>
      {detail.resources.length ? detail.resources.map((resource) => <ResourceEditor key={resource.id} resource={resource} busy={busy} onEdit={(titleValue, text) => run(() => api(`/api/resources/${resource.id}`, { method: "PATCH", body: jsonBody({ title: titleValue, text }) }), "A new resource version was saved as a draft.")} onPublish={() => run(() => api(`/api/resources/${resource.id}/publish`, { method: "POST" }), "Resource published.")} onArchive={()=>{if(window.confirm("Archive this resource? Students will no longer start new work from it."))void run(()=>api(`/api/resources/${resource.id}/archive`,{method:"POST"}),"Resource archived.");}} />) : <div className="empty"><span className="empty-mark">02</span><h3>No course resources</h3><p>Course materials added above will be listed here for review.</p></div>}
    </div>
    <div className="divider" />
    <h3>Baseline assessment</h3><p className="muted">Create questions tied to resources, then publish the assessment when it is ready.</p>
    <form className="form-grid" onSubmit={newAssessment}><div className="field"><label htmlFor="assessment-title">Assessment title</label><input id="assessment-title" required value={assessmentTitle} onChange={(e) => setAssessmentTitle(e.target.value)} /></div><div className="field" style={{ alignSelf: "end" }}><button className="button primary" disabled={busy}>Create assessment draft</button></div></form>
    <div className="stack" style={{ marginTop: 17 }}>
      {detail.assessments.length ? detail.assessments.map((assessment) => {
        const draft = questionByAssessment[String(assessment.id)] || { prompt: "", answer: "", resourceId: "", conceptId: "" };
        const setDraft = (field: "prompt" | "answer" | "resourceId" | "conceptId", value: string) => setQuestionByAssessment((prev) => ({ ...prev, [String(assessment.id)]: { ...draft, [field]: value } }));
        return <article className="assessment-card" key={assessment.id}>
          <div className="row"><div><h3>{assessment.title}</h3><span className={`badge ${assessment.status.toLowerCase() === "published" ? "green" : "amber"}`}>{assessment.status}</span></div>
            {assessment.status.toLowerCase() !== "published" && <button className="button small success" disabled={busy} onClick={() => void run(() => api(`/api/assessments/${assessment.id}/publish`, { method: "POST" }), "Assessment published.")}>Publish assessment</button>}
          </div>
          {assessment.questions.length ? <div className="question-list" style={{ marginTop: 14 }}>{assessment.questions.map((q) => <QuestionEditor key={q.id} question={q} resources={detail.resources} concepts={detail.concepts} busy={busy} onSave={(data)=>run(()=>api(`/api/questions/${q.id}`,{method:"PATCH",body:jsonBody(data)}),"A new question version was saved.")}/>)}</div> : <div className="empty" style={{ marginTop: 14 }}><span className="empty-mark">Q</span><h3>No questions yet</h3><p>Add questions based on a published or draft resource.</p></div>}
          {assessment.status.toLowerCase() !== "published" && <form className="form-grid" style={{ marginTop: 14 }} onSubmit={(event) => {
            event.preventDefault();
            if (!draft.resourceId) { setError("Select a source resource for this question."); return; }
            void run(async () => {
              await api(`/api/assessments/${assessment.id}/questions`, { method: "POST", body: jsonBody({ prompt: draft.prompt.trim(), answer: draft.answer.trim(), resourceId: draft.resourceId, conceptId: draft.conceptId || null }) });
              setQuestionByAssessment((prev) => ({ ...prev, [String(assessment.id)]: { prompt: "", answer: "", resourceId: "", conceptId: "" } }));
            }, "Question added to assessment.");
          }}>
            <div className="field full"><label htmlFor={`prompt-${assessment.id}`}>Question prompt</label><textarea id={`prompt-${assessment.id}`} required value={draft.prompt} onChange={(e) => setDraft("prompt", e.target.value)} /></div>
            <div className="field"><label htmlFor={`answer-${assessment.id}`}>Expected answer</label><textarea id={`answer-${assessment.id}`} required value={draft.answer} onChange={(e) => setDraft("answer", e.target.value)} /></div>
            <div className="field"><label htmlFor={`source-${assessment.id}`}>Source resource</label><select id={`source-${assessment.id}`} required value={draft.resourceId} onChange={(e) => setDraft("resourceId", e.target.value)}><option value="">Choose a course resource</option>{detail.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.title}</option>)}</select></div>
            <div className="field"><label htmlFor={`concept-${assessment.id}`}>Concept for mastery</label><select id={`concept-${assessment.id}`} value={draft.conceptId} onChange={(e) => setDraft("conceptId", e.target.value)}><option value="">No concept linked</option>{detail.concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}</select></div>
            <div className="field"><button className="button small primary" disabled={busy}>Add question</button></div>
          </form>}
        </article>;
      }) : <div className="empty"><span className="empty-mark">03</span><h3>No baseline assessment</h3><p>Create an assessment draft to author questions for this course.</p></div>}
    </div>
    <TeacherStudy courseId={courseId} resources={detail.resources} assessments={detail.assessments} concepts={detail.concepts} refresh={refresh} />
  </div>;
}

function ResourceEditor({ resource, busy, onEdit, onPublish,onArchive }: { resource: Resource; busy: boolean; onEdit: (title: string, text: string) => void; onPublish: () => void;onArchive:()=>void }) {
  const [title, setTitle] = useState(resource.title);
  const [text, setText] = useState(resource.text || "");
  const [versions,setVersions]=useState<{id:string;version:number;title:string;status:string;createdAt:string}[]>([]);
  const [preview,setPreview]=useState<{title:string;version:number;text:string}|null>(null);
  const [versionError,setVersionError]=useState("");
  const published = resource.status.toLowerCase() === "published";
  useEffect(() => { setTitle(resource.title); setText(resource.text || ""); }, [resource.title, resource.text]);
  async function loadVersions(){setVersionError("");try{const data=await api<{versions:typeof versions}>(`/api/resources/${resource.id}/versions`);setVersions(data.versions);}catch(e){setVersionError(e instanceof Error?e.message:"Could not load version history.");}}
  async function openVersion(version:{id:string;version:number;title:string}){setVersionError("");try{const data=await api<{text:string;location:string}>(`/api/resources/${resource.id}/excerpt?version=${version.id}&location=Section%201`);setPreview({title:version.title,version:version.version,text:data.text});}catch(e){setVersionError(e instanceof Error?e.message:"Could not open this version.");}}
  return <article className="resource-card">
    <div className="row"><div><h3>{resource.title}</h3><div className="card-actions" style={{ margin: 0 }}><span className={`badge ${published ? "green" : "amber"}`}>{resource.status}</span><span className="badge">Version {resource.version||1}</span>{resource.extractionStatus && <span className="badge">Extraction: {resource.extractionStatus}</span>}</div></div>
      {resource.hasFile && <a className="button small" href={`/api/resources/${resource.id}/file`} target="_blank" rel="noreferrer">Open original</a>}
    </div>
    <button className="button small" type="button" style={{marginTop:12}} onClick={()=>void loadVersions()}>Version history</button>
    {versionError&&<div className="notice error" role="alert">{versionError}</div>}
    {!!versions.length&&<div className="stack" style={{marginTop:10}}>{versions.map((v)=><div key={v.id} className="row"><span>v{v.version} · {v.status} · {v.title}</span><button className="button small" type="button" onClick={()=>void openVersion(v)}>Preview</button></div>)}</div>}
    {preview&&<div className="notice" role="region" aria-label="Resource version preview"><strong>{preview.title} · v{preview.version}</strong><p style={{whiteSpace:"pre-wrap"}}>{preview.text}</p></div>}
    {!published ? <><div className="form-grid" style={{ marginTop: 14 }}>
      <div className="field"><label htmlFor={`resource-edit-title-${resource.id}`}>Title</label><input id={`resource-edit-title-${resource.id}`} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field full"><label htmlFor={`resource-edit-text-${resource.id}`}>Review or add text</label><textarea id={`resource-edit-text-${resource.id}`} value={text} onChange={(e) => setText(e.target.value)} /></div>
    </div><div className="form-actions"><button className="button small" disabled={busy} onClick={() => onEdit(title, text)}>Save edits</button><button className="button small success" disabled={busy} onClick={onPublish}>Publish resource</button></div></> :
      <><p style={{ marginTop: 14 }}>{text || "Published source material is available to enrolled students."}</p><button className="button small" type="button" disabled={busy} onClick={onArchive}>Archive resource</button></>}
  </article>;
}

function QuestionEditor({question,resources,concepts,busy,onSave}:{question:Question;resources:Resource[];concepts:{id:string;name:string}[];busy:boolean;onSave:(data:{prompt:string;answer:string;conceptId:string|null;resourceId:string})=>void}) {
  const [prompt,setPrompt]=useState(question.prompt),[answer,setAnswer]=useState(question.answer||""),[conceptId,setConceptId]=useState(question.conceptId||""),[resourceId,setResourceId]=useState(String(question.resourceId||""));
  const [versions,setVersions]=useState<{version:number;prompt:string;answer:string;createdAt:string}[]>([]),[error,setError]=useState("");
  useEffect(()=>{setPrompt(question.prompt);setAnswer(question.answer||"");setConceptId(question.conceptId||"");setResourceId(String(question.resourceId||""));},[question.prompt,question.answer,question.conceptId,question.resourceId]);
  async function showHistory(){setError("");try{const data=await api<{versions:typeof versions}>(`/api/questions/${question.id}/versions`);setVersions(data.versions);}catch(e){setError(e instanceof Error?e.message:"Could not load question history.");}}
  return <article className="question">
    <form className="form-grid" onSubmit={(event)=>{event.preventDefault();onSave({prompt,answer,conceptId:conceptId||null,resourceId});}}>
      <div className="field full"><label htmlFor={`question-prompt-${question.id}`}>Question · version {question.version||1}</label><textarea id={`question-prompt-${question.id}`} required value={prompt} onChange={(e)=>setPrompt(e.target.value)}/></div>
      <div className="field"><label htmlFor={`question-answer-${question.id}`}>Expected answer</label><textarea id={`question-answer-${question.id}`} required value={answer} onChange={(e)=>setAnswer(e.target.value)}/></div>
      <div className="field"><label htmlFor={`question-concept-${question.id}`}>Concept</label><select id={`question-concept-${question.id}`} value={conceptId} onChange={(e)=>setConceptId(e.target.value)}><option value="">No concept linked</option>{concepts.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="field"><label htmlFor={`question-source-${question.id}`}>Source material</label><select id={`question-source-${question.id}`} required value={resourceId} onChange={(e)=>setResourceId(e.target.value)}>{resources.map((r)=><option key={r.id} value={r.id}>{r.title} · v{r.version||1}</option>)}</select></div>
      <div className="field"><button className="button small" disabled={busy}>Save as new version</button></div>
    </form>
    <span className="badge">Source: {resources.find((r)=>String(r.id)===resourceId)?.title||"Not linked"}</span>
    <button className="button small" type="button" style={{marginLeft:8}} onClick={()=>void showHistory()}>Question history</button>
    {error&&<div className="notice error" role="alert">{error}</div>}
    {versions.length>0&&<ul>{versions.map((v)=><li key={v.version}>v{v.version}: {v.prompt} — expected answer: {v.answer}</li>)}</ul>}
  </article>;
}

function StudentWorkspace() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setError("");
    try { const result = await api<{ courses: Course[] }>("/api/courses"); setCourses(result.courses); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load your courses."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <div className="workspace-grid">
    <nav className="side-nav panel" aria-label="Student workspace"><button aria-current={selectedId === null ? "page" : undefined} onClick={() => setSelectedId(null)}>My learning</button><button aria-current={selectedId === "preferences" ? "page" : undefined} onClick={() => setSelectedId("preferences")}>Preferences</button>{courses?.map((course) => <button key={course.id} aria-current={selectedId === course.id ? "page" : undefined} onClick={() => setSelectedId(course.id)}>{course.title}</button>)}</nav>
    <Panel className="main-panel">
      {error && <ErrorNotice error={error} retry={() => void refresh()} />}
      {selectedId === "preferences" ? <PreferencesView /> : selectedId !== null ? <StudentCourse courseId={selectedId} /> :
        <><div className="eyebrow">Student workspace</div><h2>Your learning space.</h2><p className="muted">Your enrolled courses and onboarding status will appear here.</p>
          {courses === null ? <div className="stack"><div className="loading-skeleton" /><div className="loading-skeleton" /></div> : courses.length ? <div className="stack">{courses.map((course) => <StudentCourseCard key={course.id} course={course} onOpen={() => setSelectedId(course.id)} />)}</div> : <div className="empty"><span className="empty-mark">EC</span><h3>No courses are connected to your account</h3><p>When a teacher enrolls you in a course, it will appear here.</p></div>}
        </>}
    </Panel>
  </div>;
}

function StudentCourseCard({ course, onOpen }: { course: Course; onOpen: () => void }) {
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [error, setError] = useState("");
  const check = useCallback(async () => {
    setError("");
    try { setOnboarding(await api<Onboarding>(`/api/courses/${course.id}/onboarding`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to check onboarding readiness."); }
  }, [course.id]);
  useEffect(() => { void check(); }, [check]);
  return <article className="course-card card">
    <div className="row"><div><h3>{course.title}</h3><p>{course.description}</p></div><button className="button small" onClick={onOpen}>Open course</button></div>
    {error ? <div className="notice error" style={{ marginTop: 12 }} role="alert">{error} <button className="button small" onClick={() => void check()}>Retry</button></div> :
      onboarding && <div className="notice" style={{ marginTop: 12 }}><span className={`badge ${onboarding.state.toLowerCase() === "ready" ? "green" : "amber"}`}>{onboarding.state}</span>{onboarding.message && <p style={{ margin: "9px 0 0" }}>{onboarding.message}</p>}</div>}
  </article>;
}

function StudentCourse({ courseId }: { courseId: string | number }) {
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [questions, setQuestions] = useState<{ id: string | number; prompt: string }[] | null>(null);
  const [assessmentSessionId, setAssessmentSessionId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [assessmentError, setAssessmentError] = useState("");
  const [assessmentNotice, setAssessmentNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [baselineResult, setBaselineResult] = useState<{ score: number; total: number } | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [courseResult, state, baseline] = await Promise.all([
        api<CourseDetail>(`/api/courses/${courseId}`),
        api<Onboarding>(`/api/courses/${courseId}/onboarding`),
        api<{result: {score:number;total:number}|null}>(`/api/courses/${courseId}/assessment/result`),
      ]);
      setDetail(courseResult); setOnboarding(state); setBaselineResult(baseline.result); setQuestions(null); setAssessmentSessionId(""); setAnswers({}); setSubmitted(false); setAssessmentNotice("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to open course."); }
    finally { setLoading(false); }
  }, [courseId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const start = async () => {
    setStarting(true); setError(""); setAssessmentError(""); setAssessmentNotice("");
    try {
      const result = await api<{ sessionId:string; questions: { id: string | number; prompt: string }[]; answers:Record<string,string> }>(`/api/courses/${courseId}/assessment/start`, { method: "POST" });
      setQuestions(result.questions);
      setAssessmentSessionId(result.sessionId);
      setAnswers(Object.fromEntries(result.questions.map((question) => [String(question.id), result.answers[String(question.id)] || ""])));
      setSubmitted(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The baseline assessment could not be started.");
      try { setOnboarding(await api<Onboarding>(`/api/courses/${courseId}/onboarding`)); } catch { /* preserve the start error */ }
    } finally { setStarting(false); }
  };
  const submitAssessment = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!questions) return;
    setSubmitting(true); setAssessmentError(""); setAssessmentNotice("");
    try {
      const result = await api<{score:number;total:number}>(`/api/courses/${courseId}/assessment/submit`, {
        method: "POST",
        body: jsonBody({ sessionId:assessmentSessionId, answers: Object.fromEntries(questions.map((question) => [String(question.id), answers[String(question.id)] || ""])) }),
      });
      setSubmitted(true);
      setBaselineResult(result);
      setAssessmentNotice(`Baseline result: ${result.score} out of ${result.total}. Objective answers are matched exactly, ignoring case and extra spaces.`);
    } catch (e) {
      setAssessmentError(e instanceof Error ? e.message : "Your responses could not be submitted. Your answers are still here; try again.");
    } finally { setSubmitting(false); }
  };
  if (loading) return <div className="stack"><div className="loading-skeleton" /><div className="loading-skeleton" /></div>;
  if (error && !detail) return <ErrorNotice error={error} retry={() => void refresh()} />;
  if (!detail) return null;
  const published = detail.resources.filter((resource) => resource.status.toLowerCase() === "published");
  const ready = onboarding?.state.toLowerCase() === "ready";
  return <div>
    <div className="eyebrow">Course · student view</div><h2>{detail.course.title}</h2><p className="muted">{detail.course.description}</p>
    {error && <ErrorNotice error={error} retry={() => void refresh()} />}
    <div className="student-top">
      <div><h3>Course resources</h3><p className="muted">Only published materials are visible to students.</p>
        {published.length ? <div className="stack">{published.map((resource) => <article className="resource-card" key={resource.id}><div className="row"><div><h3>{resource.title}</h3><span className="badge green">Published</span></div>{resource.hasFile && <a className="button small" href={`/api/resources/${resource.id}/file`} target="_blank" rel="noreferrer">Open resource</a>}</div>{resource.text && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{resource.text}</p>}</article>)}</div> :
          <div className="empty"><span className="empty-mark">01</span><h3>No published resources</h3><p>The course has no material available to students yet.</p></div>}
      </div>
      <aside className="status-card" aria-label="Onboarding status"><div className="eyebrow">Academic onboarding</div><h3>{ready ? "Baseline ready" : "Not ready yet"}</h3>
        {onboarding?.message && <p>{onboarding.message}</p>}
        {onboarding ? <button className={`button ${ready ? "primary" : ""}`} disabled={starting} onClick={ready ? () => void start() : () => void refresh()}>{starting ? "Opening assessment…" : ready ? "Begin baseline assessment" : "Retry readiness check"}</button> :
          <button className="button" onClick={() => void refresh()}>Check readiness</button>}
      </aside>
    </div>
    {baselineResult && <div className="notice success" role="status" style={{marginTop:20}}>Latest baseline result: {baselineResult.score} / {baselineResult.total}</div>}
    {questions && <section aria-labelledby="baseline-title" style={{ marginTop: 30 }}>
      <div className="eyebrow">Baseline assessment</div><h3 id="baseline-title">Assessment questions</h3>
      {assessmentNotice && <div className="notice success" role="status">{assessmentNotice}</div>}
      {assessmentError && <div className="notice error" role="alert">{assessmentError}<button className="button small" type="button" disabled={submitting} style={{ marginTop: 12 }} onClick={() => void submitAssessment()}>Retry submission</button></div>}
      {questions.length ? <form onSubmit={(event) => void submitAssessment(event)}>
        {questions.map((question, index) => <div className="assessment-question" key={question.id}>
          <label className="field-label" htmlFor={`student-answer-${question.id}`}><span className="badge">Question {index + 1}</span></label>
          <p style={{ margin: "12px 0 0" }}>{question.prompt}</p>
          <div className="field" style={{ marginTop: 12 }}><label htmlFor={`student-answer-${question.id}`}>Your response</label>
            <textarea id={`student-answer-${question.id}`} required value={answers[String(question.id)] || ""} disabled={submitted || submitting}
              onBlur={(event) => void api("/api/assessment-sessions/"+assessmentSessionId+"/answers",{method:"PUT",body:jsonBody({answers:{[String(question.id)]:event.currentTarget.value}})}).catch((e)=>setAssessmentError(e.message))}
              onChange={(event) => setAnswers((previous) => ({ ...previous, [String(question.id)]: event.target.value }))} /></div>
        </div>)}
        <button className="button primary" type="submit" disabled={submitting || submitted}>{submitting ? "Submitting…" : submitted ? "Submitted" : "Submit assessment"}</button>
      </form> : <div className="empty" style={{ marginTop: 14 }}><h3>No questions were returned</h3><p>Refresh readiness and try again, or contact your course teacher.</p></div>}
    </section>}
    {onboarding?.state.toLowerCase() !== "unenrolled" && <StudentIntake courseId={courseId}/>}
    {onboarding?.state.toLowerCase() !== "unenrolled" && <StudentStudy key={String(courseId)} courseId={courseId} baselineReady={Boolean(ready&&baselineResult)} />}
    {onboarding?.state.toLowerCase() !== "unenrolled" && <StudentAssignments courseId={courseId}/>}
    {onboarding?.state.toLowerCase() !== "unenrolled" && <RewardsPanel courseId={courseId}/>}
  </div>;
}

function PreferencesView() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [draft, setDraft] = useState<Preferences>({ availability: "", feedback: "", hints: "", formats: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const formatOptions = ["diagrams", "code traces", "worked examples", "proofs", "analogies"];
  const refresh = useCallback(async () => {
    setError("");
    try {
      const data = await api<Preferences>("/api/preferences");
      const saved: Preferences = {
        availability: typeof data.availability === "string" ? data.availability : "",
        feedback: typeof data.feedback === "string" ? data.feedback : "",
        hints: typeof data.hints === "string" ? data.hints : "",
        formats: Array.isArray(data.formats) ? data.formats.filter((format): format is string => typeof format === "string") : [],
      };
      setPreferences(saved);
      setDraft(saved);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load preferences."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const persist = async (values: Preferences, successMessage: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await api<Preferences | undefined>("/api/preferences", { method: "PUT", body: jsonBody(values) });
      const normalized: Preferences = {
        availability: typeof saved?.availability === "string" ? saved.availability : values.availability,
        feedback: typeof saved?.feedback === "string" ? saved.feedback : values.feedback,
        hints: typeof saved?.hints === "string" ? saved.hints : values.hints,
        formats: Array.isArray(saved?.formats) ? saved.formats.filter((format): format is string => typeof format === "string") : values.formats,
      };
      setPreferences(normalized); setDraft(normalized);
      setNotice(successMessage);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save preferences."); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void persist({ ...draft, formats: [...draft.formats] }, "Your preferences have been saved.");
  };
  const reset = () => {
    void persist({ availability: "", feedback: "", hints: "", formats: [] }, "Your preferences have been reset.");
  };
  const setFormat = (format: string, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      formats: checked ? [...current.formats.filter((item) => item !== format), format] : current.formats.filter((item) => item !== format),
    }));
  };
  return <div><div className="eyebrow">Personal settings</div><h2>Make the space yours.</h2><p className="muted">Preferences stay editable even when your institute is preparing the academic onboarding materials.</p>
    {error && <ErrorNotice error={error} retry={() => void refresh()} />}{notice && <div className="notice success" role="status">{notice}</div>}
    {!preferences && !error ? <div className="loading-skeleton" /> : preferences && <form onSubmit={save}>
      <div className="form-grid" style={{ marginTop: 18 }}>
        <div className="field full"><label htmlFor="pref-availability">When are you usually available to study?</label><textarea id="pref-availability" value={draft.availability} onChange={(event) => setDraft({ ...draft, availability: event.target.value })} placeholder="For example: weekday evenings, Saturday mornings" /><span className="subtle">Optional. Describe the times that work for you.</span></div>
        <div className="field"><label htmlFor="pref-feedback">How would you like feedback?</label><select id="pref-feedback" value={draft.feedback} onChange={(event) => setDraft({ ...draft, feedback: event.target.value })}>
          <option value="">No preference</option><option value="gentle">Gentle and encouraging</option><option value="balanced">Balanced and explanatory</option><option value="direct">Direct and concise</option>
          {draft.feedback && !["gentle", "balanced", "direct"].includes(draft.feedback) && <option value={draft.feedback}>{draft.feedback}</option>}
        </select><span className="subtle">Optional. You can change this at any time.</span></div>
        <div className="field"><label htmlFor="pref-hints">When should hints appear?</label><select id="pref-hints" value={draft.hints} onChange={(event) => setDraft({ ...draft, hints: event.target.value })}>
          <option value="">No preference</option><option value="when I ask">Only when I ask</option><option value="after I try">After I have tried first</option><option value="early">Offer a small hint early</option>
          {draft.hints && !["when I ask", "after I try", "early"].includes(draft.hints) && <option value={draft.hints}>{draft.hints}</option>}
        </select><span className="subtle">Optional. Hints are always available on request.</span></div>
        <fieldset className="field full" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Formats you would like to try</legend><p className="subtle">Optional. Select any that sound useful.</p>
          <div className="preferences-group">
            {formatOptions.map((format) => <label className="choice" key={format}><input type="checkbox" checked={draft.formats.includes(format)} onChange={(event) => setFormat(format, event.target.checked)} /><span>{format.replace(/\b\w/g, (letter) => letter.toUpperCase())}</span></label>)}
          </div>
        </fieldset>
      </div>
      <div className="form-actions"><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</button><button type="button" className="button" disabled={busy} onClick={reset}>{busy ? "Saving…" : "Reset preferences"}</button></div>
    </form>}
  </div>;
}

const clerkAppearance = {
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: routeUrl("/"),
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#8fb7ff",
    colorForeground: "#f4f2ff",
    colorMutedForeground: "#c0bfd4",
    colorDanger: "#ffb5bd",
    colorBackground: "#201f3c",
    colorInput: "rgba(8,12,30,.72)",
    colorInputForeground: "#ffffff",
    colorNeutral: "#f4f2ff",
    fontFamily: "Manrope, sans-serif",
    borderRadius: "16px",
  },
  elements: {
    rootBox: { width: "100%", display: "flex", justifyContent: "center" },
    cardBox: { width: "100%", maxWidth: "440px", borderRadius: "24px", background: "rgba(28,29,61,.92)", border: "1px solid rgba(255,255,255,.2)", boxShadow: "0 24px 48px rgba(3,5,20,.25)" },
    card: { background: "transparent", boxShadow: "none", border: "0" },
    footer: { background: "transparent", boxShadow: "none", border: "0" },
    headerTitle: { color: "#f4f2ff", fontFamily: "Manrope, sans-serif" },
    headerSubtitle: { color: "#c0bfd4" },
    socialButtonsBlockButtonText: { color: "#f4f2ff" },
    formFieldLabel: { color: "#f4f2ff" },
    footerActionLink: { color: "#b7cfff" },
    footerActionText: { color: "#c0bfd4" },
    dividerText: { color: "#c0bfd4" },
    identityPreviewEditButton: { color: "#b7cfff" },
    formFieldSuccessText: { color: "#9de2c3" },
    alertText: { color: "#ffe8e9" },
    logoBox: { marginBottom: "12px" },
    logoImage: { maxHeight: "34px" },
    socialButtonsBlockButton: { color: "#f4f2ff", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.2)" },
    formButtonPrimary: { color: "#070c14", background: "#8fb7ff", borderRadius: "999px" },
    formFieldInput: { color: "#ffffff", background: "rgba(8,12,30,.72)", border: "1px solid rgba(255,255,255,.25)" },
    footerAction: { color: "#c0bfd4" },
    dividerLine: { background: "rgba(255,255,255,.22)" },
    alert: { background: "rgba(255,181,189,.12)", border: "1px solid rgba(255,181,189,.4)" },
    otpCodeFieldInput: { color: "#ffffff", background: "rgba(8,12,30,.72)" },
    formFieldRow: { color: "#f4f2ff" },
    main: { color: "#f4f2ff" },
  },
};

function HomeRoute() {
  return <>
    <Show when="signed-in"><WouterRedirect to="/app" /></Show>
    <Show when="signed-out"><Landing /></Show>
  </>;
}

function AppWorkspaceRoute() {
  return <>
    <Show when="signed-in"><Workspace /></Show>
    <Show when="signed-out"><WouterRedirect to="/" /></Show>
  </>;
}

function AuthenticatedRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={routeUrl("/sign-in")}
    signUpUrl={routeUrl("/sign-up")}
    localization={{
      signIn: { start: { title: "Welcome back", subtitle: "Sign in to EdCurie." } },
      signUp: { start: { title: "Join your institute", subtitle: "Create your EdCurie account." } },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sign-in/*?" component={() => <AuthPage kind="sign-in" />} />
      <Route path="/sign-up/*?" component={() => <AuthPage kind="sign-up" />} />
      <Route path="/app" component={AppWorkspaceRoute} />
      <Route component={HomeRoute} />
    </Switch>
  </ClerkProvider>;
}

function DisabledAuthRoutes({ error = "" }: { error?: string }) {
  return <Switch>
    <Route path="/" component={Landing} />
    <Route path="/sign-in/*?" component={() => <AuthDisabled error={error} />} />
    <Route path="/sign-up/*?" component={() => <AuthDisabled error={error} />} />
    <Route path="/app" component={() => <AuthDisabled error={error} />} />
    <Route component={Landing} />
  </Switch>;
}

function ConfiguredApp() {
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState("");
  const [location] = useLocation();
  useEffect(() => {
    let active = true;
    api<Config>("/api/config").then((value) => { if (active) setConfig(value); }).catch((error) => {
      if (active) setConfigError(error instanceof Error ? error.message : "Unable to load application configuration.");
    });
    return () => { active = false; };
  }, []);
  if (!config && !configError) return location === "/" ? <Landing /> : <LoadingPage />;
  if (configError) return location === "/" ? <Landing /> : <DisabledAuthRoutes error={`Unable to load authentication configuration: ${configError}`} />;
  if (!config?.authEnabled) return <DisabledAuthRoutes />;
  return <AuthenticatedRoutes />;
}

export default function App() {
  return <WouterRouter base={basePath}><ConfiguredApp /></WouterRouter>;
}
