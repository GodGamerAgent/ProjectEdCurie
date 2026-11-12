import type { Request } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import type { Pool } from "pg";

export type AppUser = { id: string; email: string; role: "admin" | "teacher" | "student" };
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function authConfigured() {
  return Boolean(process.env.EDCURIE_BOOTSTRAP_ADMIN_EMAIL && process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
}

export function verifiedIdentityResolver(db: Pool) {
  return async (req: Request): Promise<AppUser> => {
    if (!authConfigured()) throw new HttpError(503, "Institutional sign-in is not configured yet.");
    const auth = getAuth(req);
    if (!auth.userId) throw new HttpError(401, "Please sign in.");
    const identity = await clerkClient.users.getUser(auth.userId);
    const primary = identity.emailAddresses.find((e) => e.id === identity.primaryEmailAddressId);
    return provisionVerifiedIdentity(db, auth.userId, primary?.emailAddress ?? "", primary?.verification?.status === "verified", process.env.EDCURIE_BOOTSTRAP_ADMIN_EMAIL!);
  };
}

// Only call with identity facts fetched from the trusted authentication provider.
export async function provisionVerifiedIdentity(db: Pool, providerId: string, address: string, verified: boolean, bootstrapAddress: string): Promise<AppUser> {
    if (!verified || !address) throw new HttpError(403, "A verified institutional email is required.");
    const email = address.trim().toLowerCase();
    const bootstrap = bootstrapAddress.trim().toLowerCase();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Serialize first-admin bootstrap and role provisioning.
      await client.query("SELECT pg_advisory_xact_lock(938411)");
      const existing = await client.query("SELECT id, email, role FROM users WHERE provider_id=$1", [providerId]);
      if (existing.rowCount) {
        const user = existing.rows[0] as AppUser;
        if (user.email !== email) throw new HttpError(403, "The verified account email changed; contact an administrator.");
        if (user.role !== "admin") {
          const permitted = await client.query("SELECT 1 FROM approved_domains WHERE domain=$1", [email.split("@")[1]]);
          if (!permitted.rowCount) throw new HttpError(403, "Your email domain has not been approved.");
          const invitation = await client.query("SELECT 1 FROM teacher_invitations WHERE email=$1", [email]);
          if (invitation.rowCount && user.role !== "teacher") {
            await client.query("UPDATE users SET role='teacher' WHERE id=$1", [user.id]);
            user.role = "teacher";
          }
        }
        await client.query("COMMIT");
        return user;
      }
      const adminExists = await client.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1");
      const isBootstrap = !adminExists.rowCount && email === bootstrap;
      if (!isBootstrap) {
        const allowed = await client.query("SELECT 1 FROM approved_domains WHERE domain=$1", [email.split("@")[1]]);
        if (!allowed.rowCount) throw new HttpError(403, "Your email domain has not been approved.");
      }
      const invitation = await client.query("SELECT 1 FROM teacher_invitations WHERE email=$1", [email]);
      const role = isBootstrap ? "admin" : invitation.rowCount ? "teacher" : "student";
      const inserted = await client.query("INSERT INTO users (provider_id,email,role) VALUES ($1,$2,$3) RETURNING id,email,role", [providerId, email, role]);
      await client.query("COMMIT");
      return inserted.rows[0] as AppUser;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
}
