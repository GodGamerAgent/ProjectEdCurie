import TeacherDemo from "./TeacherDemo";
import StudentDemo from "./StudentDemo";
import { ClerkProvider, Show, SignIn, useAuth, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { FormEvent, MouseEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { Redirect as WouterRedirect, Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { api, jsonBody } from "./api";
import AdminWorkspace from "./AdminWorkspace";
import SignupFieldHints from "./SignupFieldHints";
import Markdown from "./Markdown";
import MarkdownEditor from "./MarkdownEditor";

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
            <div className="orbit-dot c">PRACTICE</div><div className="orbit-dot d">GROW</div>
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
          <Panel className="feature-card card"><div className="feature-index">03 / ADAPT</div><h3>Make it yours</h3><p>Share how you prefer to learn, then study or practice with a tutor using your course material.</p></Panel>
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
      <p className="muted">{kind === "sign-in" ? "Continue with your verified email account." : "Use a verified email. Institute members need an approved institute email; the first administrator must use the configured verified admin email."}</p>
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
          <MarkdownEditor className="full" label="Description" compact rows={3} value={description} onChange={setDescription} maxLength={2000} placeholder="What will students learn in this course?" />
          <div className="field"><button className="button primary" disabled={busy}>Create course</button></div>
        </form>
        {courses === null ? <div className="stack"><div className="loading-skeleton" /><div className="loading-skeleton" /></div> : courses.length ? <div className="stack">{courses.map((course) => <article key={course.id} className="course-card card"><div className="row"><div><h3>{course.title}</h3>{course.description ? <Markdown text={course.description} /> : <p>No description provided.</p>}</div><button className="button small" onClick={() => setSelectedId(course.id)}>Open course</button></div></article>)}</div> : <div className="empty"><span className="empty-mark">EC</span><h3>No courses have been created</h3><p>Create your first course above. It will appear here after the API confirms it.</p></div>}
      </> : <TeacherDemo key={selectedId} courseId={String(selectedId)} onBack={() => setSelectedId(null)} />}
    </Panel>
  </div>;
}

function StudentWorkspace() {
  const [courses,setCourses]=useState<Course[] | null>(null);
  const [selected,setSelected]=useState<Course | null>(null);
  const [error,setError]=useState("");
  useEffect(() => { void api<{courses:Course[]}>("/api/courses").then(data=>setCourses(data.courses)).catch(e=>setError(e.message)); },[]);
  return <Panel className="main-panel">
    {selected ? <StudentDemo key={selected.id} courseId={String(selected.id)} onBack={()=>setSelected(null)} /> : <>
      <h2>My courses</h2>
      {error && <ErrorNotice error={error} />}
      {!courses && !error && <p role="status">Loading courses…</p>}
      {courses?.length===0 && <p>Your enrolled courses will appear here.</p>}
      <div className="stack">{courses?.map(course=><article className="course-card row" key={course.id}>
        <div><h3>{course.title}</h3>{course.description && <Markdown text={course.description} />}</div>
        <button className="button small" onClick={()=>setSelected(course)}>Open course</button>
      </article>)}</div>
    </>}
  </Panel>;
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
