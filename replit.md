# EdCurie

## Run

This is a single React/Vite and Express application using the Replit PostgreSQL database. The Replit workflow runs `npm run dev` on port 5000. Run `npm run db:migrate` to apply the checked-in Drizzle migrations to the development database. The application does not create tables or seed records at startup. For Replit-managed production databases, use the Publish flow to apply schema changes; do not run development migrations against production.

`npm run build` checks the frontend build and TypeScript. `npm run test:isolated` starts a temporary local PostgreSQL instance, applies the migrations there, runs the foundation tests, and removes the temporary instance afterward. It does not use the development or production database.

## First administrator and institute setup

1. Replit-managed Clerk must have a supported email sign-in method that verifies the actual primary email address. The development and published environments have separate identity stores.
2. In Replit Secrets, set `EDCURIE_BOOTSTRAP_ADMIN_EMAIL` to the first platform administrator's email. It may be a personal email; no institute or approved domain is required. Never put the address or credentials in source code. Without this secret and the provisioned Clerk keys, app sign-in remains unavailable.
3. Sign in as that administrator and complete Clerk's primary-email verification. The server grants the first administrator role only when the verified email matches the configured bootstrap email and no administrator already exists. If another account already holds that role, setup reports a conflict rather than creating a second administrator.
4. In the administrator workspace, create each institute with its display name and optional logo, then approve its actual email domains and invite teachers using their exact addresses. There is no preconfigured institute or example domain. Teacher roles are granted only to explicitly invited addresses. Students also need an approved verified email and enrollment in a course at their institute.
5. Verify sign-in with a real institute account in each environment. A domain match alone never verifies ownership. Live institute sign-in remains unverified until tested with a real account.

The institute migration is additive and does not delete legacy records. Previously existing domains, invitations, users, and courses are left unassigned rather than being guessed into an institute; they cannot grant institute-scoped access until deliberately associated. Adding an existing unassigned domain to an institute assigns that domain, and verified students on it can be associated on their next sign-in. A legacy teacher must be explicitly invited again for the correct institute, which also associates any existing unassigned invitation. Existing unassigned courses require an explicit administrator migration before they can be used; do not bulk-assign them without checking their ownership.

Course resources, assessment eligibility, and file downloads are checked against server-side teacher assignments or student enrollments. Resources are stored in PostgreSQL; PDF and text uploads are limited to 8 MB. A teacher can review extracted page-labelled text or supply manual text after an extraction failure. Publishing a usable resource and a baseline with at least one valid question linked to published usable material in the same course opens onboarding for an enrolled student.

No Groq key is needed for this foundation milestone. AI tutoring and AI question drafting are later work.
