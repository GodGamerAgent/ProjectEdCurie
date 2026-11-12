import type { Request } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import type { Pool } from "pg";

export type AppUser = { id: string; email: string; role: "admin" | "teacher" | "student"; instituteId?: string | null };
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
  if (!verified || !address) throw new HttpError(403, "A verified primary email is required.");
  const email = address.trim().toLowerCase();
  const bootstrap = bootstrapAddress.trim().toLowerCase();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(938411)");
    const existing = await client.query('SELECT id,email,role,institute_id AS "instituteId" FROM users WHERE provider_id=$1', [providerId]);
    const user = existing.rows[0] as AppUser | undefined;
    if (user && user.email !== email) throw new HttpError(403, "The verified account email changed; contact an administrator.");
    if (user?.role === "admin") { await client.query("COMMIT"); return user; }
    const admin = await client.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (email === bootstrap && admin.rowCount) {
      throw new HttpError(409, "A different account already holds the platform administrator role. Contact the existing administrator to resolve setup.");
    }
    if (email === bootstrap && !admin.rowCount) {
      if (!user && (await client.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount) {
        throw new HttpError(409, "This verified email is already linked to another sign-in account. Contact an administrator.");
      }
      const result = user
        ? await client.query(`UPDATE users SET role='admin',institute_id=NULL WHERE id=$1 RETURNING id,email,role,institute_id AS "instituteId"`, [user.id])
        : await client.query(`INSERT INTO users (provider_id,email,role) VALUES ($1,$2,'admin') RETURNING id,email,role,institute_id AS "instituteId"`, [providerId, email]);
      await client.query("COMMIT");
      return result.rows[0] as AppUser;
    }
    const domain = email.split("@")[1];
    const allowed = await client.query("SELECT institute_id FROM approved_domains WHERE domain=$1 AND institute_id IS NOT NULL", [domain]);
    if (!allowed.rowCount) throw new HttpError(403, "Your email domain has not been approved for an institute.");
    const instituteId = allowed.rows[0].institute_id as string;
    if (user?.instituteId && user.instituteId !== instituteId) throw new HttpError(403, "Your account is associated with a different institute. Contact an administrator.");
    const invitation = await client.query("SELECT 1 FROM teacher_invitations WHERE email=$1 AND institute_id=$2", [email, instituteId]);
    if (user?.role === "teacher" && !user.instituteId && !invitation.rowCount) {
      throw new HttpError(403, "Your teacher account is not assigned to this institute. Contact an administrator.");
    }
    const role = user?.role === "teacher" || invitation.rowCount ? "teacher" : "student";
    const conflicting = !user && await client.query("SELECT 1 FROM users WHERE email=$1", [email]);
    if (conflicting && conflicting.rowCount) throw new HttpError(409, "This verified email is already linked to another sign-in account. Contact an administrator.");
    const result = user
      ? await client.query(`UPDATE users SET role=$2,institute_id=$3 WHERE id=$1 RETURNING id,email,role,institute_id AS "instituteId"`, [user.id, role, instituteId])
      : await client.query(`INSERT INTO users (provider_id,email,role,institute_id) VALUES ($1,$2,$3,$4) RETURNING id,email,role,institute_id AS "instituteId"`, [providerId, email, role, instituteId]);
    await client.query("COMMIT");
    return result.rows[0] as AppUser;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
