import express, { type Request } from "express";
import { clerkClient } from "@clerk/express";
import type { Pool } from "pg";
import { HttpError, authConfigured, type AppUser } from "./auth";
import { cleanString, currentUser, normalizeEmail, requireRole } from "./access";
import { courseRoutes } from "./routes-courses";
import { materialRoutes } from "./routes-materials";

type Resolver = (req: Request) => Promise<AppUser>;
type InviteSender = (email: string) => Promise<void>;
export function createApi(db: Pool, resolveUser: Resolver, inviteSender: InviteSender = async (email) => {
  await clerkClient.invitations.createInvitation({ emailAddress: email });
}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/config", (_req, res) => res.json({ authEnabled: authConfigured() }));
  app.use("/api", async (req, res, next) => {
    try { res.locals.user = await resolveUser(req); next(); } catch (error) { next(error); }
  });
  app.get("/api/me", (_req, res) => res.json(currentUser(res)));
  app.get("/api/admin/domains", async (_req, res) => {
    requireRole(currentUser(res), "admin");
    const result = await db.query("SELECT domain FROM approved_domains ORDER BY domain");
    res.json({ domains: result.rows.map((x) => x.domain) });
  });
  app.post("/api/admin/domains", async (req, res) => {
    requireRole(currentUser(res), "admin");
    const domain = cleanString(req.body.domain, "Domain", 253).toLowerCase();
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new HttpError(400, "Enter a valid email domain without @.");
    await db.query("INSERT INTO approved_domains (domain) VALUES ($1) ON CONFLICT DO NOTHING", [domain]);
    res.status(201).json({ domain });
  });
  app.get("/api/admin/invitations", async (_req, res) => {
    requireRole(currentUser(res), "admin");
    const result = await db.query("SELECT email FROM teacher_invitations ORDER BY email");
    res.json({ invitations: result.rows });
  });
  app.post("/api/admin/invitations", async (req, res) => {
    const user = currentUser(res); requireRole(user, "admin");
    const email = normalizeEmail(req.body.email);
    const allowed = await db.query("SELECT 1 FROM approved_domains WHERE domain=$1", [email.split("@")[1]]);
    if (!allowed.rowCount) throw new HttpError(400, "Approve this email domain before inviting a teacher.");
    const existing = await db.query("SELECT 1 FROM teacher_invitations WHERE email=$1", [email]);
    if (existing.rowCount) throw new HttpError(409, "This teacher has already been invited.");
    const account = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    if (!account.rowCount) await inviteSender(email);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO teacher_invitations (email,invited_by) VALUES ($1,$2)", [email, user.id]);
      if (account.rowCount) await client.query("UPDATE users SET role='teacher' WHERE email=$1 AND role='student'", [email]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    res.status(201).json({ email });
  });
  app.get("/api/preferences", async (_req, res) => {
    const user = currentUser(res); requireRole(user, "student");
    const result = await db.query("SELECT availability,feedback,hints,formats FROM student_preferences WHERE user_id=$1", [user.id]);
    res.json(result.rows[0] ?? { availability: "", feedback: "", hints: "", formats: [] });
  });
  app.put("/api/preferences", async (req, res) => {
    const user = currentUser(res); requireRole(user, "student");
    const { availability = "", feedback = "", hints = "", formats = [] } = req.body;
    if ([availability, feedback, hints].some((v) => typeof v !== "string" || v.length > 2000) || !Array.isArray(formats) || formats.length > 10 || formats.some((x) => typeof x !== "string" || x.length > 100)) throw new HttpError(400, "Invalid preferences.");
    await db.query(`INSERT INTO student_preferences (user_id,availability,feedback,hints,formats) VALUES ($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET availability=$2,feedback=$3,hints=$4,formats=$5::jsonb`, [user.id, availability, feedback, hints, JSON.stringify(formats)]);
    res.json({ availability, feedback, hints, formats });
  });
  app.use(courseRoutes(db));
  app.use(materialRoutes(db));
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error instanceof Error && "code" in error && error.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "File must be 8 MB or smaller." });
    console.error("Request failed:", error instanceof Error ? error.message : "unknown error");
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  });
  return app;
}
