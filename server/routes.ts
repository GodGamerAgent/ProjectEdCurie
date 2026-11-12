import { demoContentRoutes } from "./routes-demo-content";
import { demoLearningRoutes } from "./routes-demo-learning";
import express, { type Request } from "express";
import { clerkClient } from "@clerk/express";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { HttpError, authConfigured, type AppUser } from "./auth";
import { qwen } from "./demo-ai";
import { currentUser, requireRole } from "./access";
import { courseRoutes } from "./routes-courses";
import { materialRoutes } from "./routes-materials";
import { instituteRoutes } from "./routes-institutes";
import { planningRoutes } from "./routes-planning";

type Resolver = (req: Request) => Promise<AppUser>;
type InviteSender = (email: string) => Promise<void>;
export function createApi(db: Pool, resolveUser: Resolver, inviteSender: InviteSender = async (email) => {
  await clerkClient.invitations.createInvitation({ emailAddress: email });
}) {
  const app = express();
  app.use((_req,res,next)=>{res.locals.requestId=randomUUID();res.setHeader("X-Request-ID",res.locals.requestId);next();});
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/config", (_req, res) => res.json({ authEnabled: authConfigured() }));
  app.use("/api", async (req, res, next) => {
    try { res.locals.user = await resolveUser(req); next(); } catch (error) { next(error); }
  });
  app.get("/api/me", async (_req, res) => {
    const user = currentUser(res);
    let institute = null;
    if (user.role !== "admin" && user.instituteId) {
      const result = await db.query(`SELECT id,display_name AS "displayName",(logo_data IS NOT NULL) AS "hasLogo" FROM institutes WHERE id=$1`, [user.instituteId]);
      institute = result.rows[0] ?? null;
    }
    res.json({ id: user.id, email: user.email, role: user.role, institute });
  });
  app.get("/api/admin/ai/status",async(_req,res)=>{
    requireRole(currentUser(res),"admin");
    res.json({configured:Boolean(process.env.GROQ_API_KEY),model:qwen});
  });
  app.use(instituteRoutes(db, inviteSender));
  app.use(courseRoutes(db));
  app.use(materialRoutes(db));
  app.use(planningRoutes(db));
  app.use(demoContentRoutes(db));
  app.use(demoLearningRoutes(db));
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const requestId=String(res.locals.requestId||"unknown");
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message,requestId });
    if (error instanceof Error && "code" in error && error.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "File is too large.",requestId });
    console.error(`Request ${requestId} failed unexpectedly: ${error instanceof Error?error.name:"unknown error"}: ${error instanceof Error?error.message:"no message"}`);
    return res.status(500).json({ error: "Something went wrong. Please try again.",requestId });
  });
  return app;
}
