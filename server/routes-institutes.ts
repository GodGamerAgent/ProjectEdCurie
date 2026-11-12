import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, currentUser, normalizeEmail, requireRole, uuid } from "./access";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024, files: 1 } });
type InviteSender = (email: string) => Promise<void>;
export function instituteRoutes(db: Pool, inviteSender: InviteSender) {
  const router = Router();
  const admin = (_req: Request, res: Response, next: NextFunction) => {
    try { requireRole(currentUser(res), "admin"); next(); } catch (error) { next(error); }
  };
  router.get("/api/admin/institutes", admin, async (_req, res) => {
    const result = await db.query(`SELECT id,display_name AS "displayName",(logo_data IS NOT NULL) AS "hasLogo" FROM institutes ORDER BY created_at`);
    res.json({ institutes: result.rows });
  });
  router.post("/api/admin/institutes", admin, async (req, res) => {
    const name = cleanString(req.body.displayName, "Institute name", 200);
    const result = await db.query(`INSERT INTO institutes (display_name) VALUES ($1) RETURNING id,display_name AS "displayName",(logo_data IS NOT NULL) AS "hasLogo"`, [name]);
    res.status(201).json(result.rows[0]);
  });
  router.patch("/api/admin/institutes/:id", admin, async (req, res) => {
    const id = uuid(String(req.params.id));
    const name = cleanString(req.body.displayName, "Institute name", 200);
    const result = await db.query(`UPDATE institutes SET display_name=$2 WHERE id=$1 RETURNING id,display_name AS "displayName",(logo_data IS NOT NULL) AS "hasLogo"`, [id, name]);
    if (!result.rowCount) throw new HttpError(404, "Institute not found.");
    res.json(result.rows[0]);
  });
  router.post("/api/admin/institutes/:id/logo", admin, upload.single("logo"), async (req, res) => {
    const id = uuid(String(req.params.id));
    const b = req.file?.buffer;
    if (!b) throw new HttpError(400, "Choose a PNG, JPEG, or WebP logo.");
    const png = b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
    const webp = b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
    if (!png && !jpeg && !webp) throw new HttpError(400, "Choose a PNG, JPEG, or WebP logo.");
    const result = await db.query("UPDATE institutes SET logo_data=$2,logo_mime=$3 WHERE id=$1", [id, b, png ? "image/png" : jpeg ? "image/jpeg" : "image/webp"]);
    if (!result.rowCount) throw new HttpError(404, "Institute not found.");
    res.json({ hasLogo: true });
  });
  router.delete("/api/admin/institutes/:id/logo", admin, async (req, res) => {
    const result = await db.query("UPDATE institutes SET logo_data=NULL,logo_mime=NULL WHERE id=$1", [uuid(String(req.params.id))]);
    if (!result.rowCount) throw new HttpError(404, "Institute not found.");
    res.json({ hasLogo: false });
  });
  async function sendLogo(id: string, res: Response) {
    const result = await db.query("SELECT logo_data,logo_mime FROM institutes WHERE id=$1", [id]);
    if (!result.rowCount || !result.rows[0].logo_data) throw new HttpError(404, "Logo not found.");
    res.set({ "Content-Type": result.rows[0].logo_mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
    res.send(result.rows[0].logo_data);
  }
  router.get("/api/admin/institutes/:id/logo", admin, async (req, res) => sendLogo(uuid(String(req.params.id)), res));
  router.get("/api/institute/logo", async (_req, res) => {
    const user = currentUser(res);
    if (user.role === "admin" || !user.instituteId) throw new HttpError(404, "Logo not found.");
    await sendLogo(user.instituteId, res);
  });
  router.get("/api/admin/institutes/:id/domains", admin, async (req, res) => {
    const result = await db.query("SELECT domain FROM approved_domains WHERE institute_id=$1 ORDER BY domain", [uuid(String(req.params.id))]);
    res.json({ domains: result.rows.map((row) => row.domain) });
  });
  router.post("/api/admin/institutes/:id/domains", admin, async (req, res) => {
    const id = uuid(String(req.params.id));
    const domain = cleanString(req.body.domain, "Domain", 253).toLowerCase();
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new HttpError(400, "Enter a valid email domain without @.");
    const institute = await db.query("SELECT 1 FROM institutes WHERE id=$1", [id]);
    if (!institute.rowCount) throw new HttpError(404, "Institute not found.");
    const result = await db.query(`INSERT INTO approved_domains (domain,institute_id) VALUES ($1,$2)
      ON CONFLICT (domain) DO UPDATE SET institute_id=EXCLUDED.institute_id
      WHERE approved_domains.institute_id IS NULL OR approved_domains.institute_id=EXCLUDED.institute_id RETURNING domain`, [domain, id]);
    if (!result.rowCount) throw new HttpError(409, "This domain is already assigned to another institute.");
    res.status(201).json({ domain });
  });
  router.get("/api/admin/institutes/:id/invitations", admin, async (req, res) => {
    const result = await db.query("SELECT email FROM teacher_invitations WHERE institute_id=$1 ORDER BY email", [uuid(String(req.params.id))]);
    res.json({ invitations: result.rows });
  });
  router.post("/api/admin/institutes/:id/invitations", admin, async (req, res) => {
    const user = currentUser(res); const id = uuid(String(req.params.id)); const email = normalizeEmail(req.body.email);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Serialize role assignment with sign-in provisioning and other invitations.
      await client.query("SELECT pg_advisory_xact_lock(938411)");
      const allowed = await client.query("SELECT 1 FROM approved_domains WHERE domain=$1 AND institute_id=$2", [email.split("@")[1], id]);
      if (!allowed.rowCount) throw new HttpError(400, "Approve this domain for the selected institute before inviting a teacher.");
      const existing = await client.query("SELECT institute_id FROM teacher_invitations WHERE email=$1", [email]);
      if (existing.rowCount && existing.rows[0].institute_id) throw new HttpError(409, "This teacher has already been invited.");
      const account = await client.query("SELECT id,role,institute_id FROM users WHERE email=$1", [email]);
      if (account.rowCount && (account.rows[0].role === "admin" || (account.rows[0].institute_id && account.rows[0].institute_id !== id))) throw new HttpError(409, "This account cannot be assigned to this institute.");
      if (!account.rowCount) await inviteSender(email);
      await client.query(`INSERT INTO teacher_invitations (email,invited_by,institute_id) VALUES ($1,$2,$3)
        ON CONFLICT (email) DO UPDATE SET institute_id=EXCLUDED.institute_id,invited_by=EXCLUDED.invited_by
        WHERE teacher_invitations.institute_id IS NULL`, [email, user.id, id]);
      if (account.rowCount) await client.query("UPDATE users SET role='teacher',institute_id=$2 WHERE email=$1 AND role IN ('student','teacher')", [email, id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    res.status(201).json({ email });
  });
  return router;
}
