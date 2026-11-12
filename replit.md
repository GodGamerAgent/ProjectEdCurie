# EdCurie

## Run

This is a single React/Vite and Express application using the Replit PostgreSQL database. The Replit workflow runs `npm run dev` on port 5000. Run `npm run db:migrate` to apply the checked-in Drizzle migrations to the development database. The application does not create tables or seed records at startup. For Replit-managed production databases, use the Publish flow to apply schema changes; do not run development migrations against production.

`npm run build` checks the frontend build and TypeScript. `npm run test:isolated` starts a temporary local PostgreSQL instance, applies the migrations there, runs the foundation tests, and removes the temporary instance afterward. It does not use the development or production database.

## Institutional sign-in setup

1. Replit-managed Clerk has been provisioned for this project. Configure its email sign-in and verification in the Replit Auth settings, and confirm that an actual NST email address can receive and complete the verification flow. The development and published environments have separate identity stores.
2. In Replit Secrets, set `EDCURIE_BOOTSTRAP_ADMIN_EMAIL` to the first administrator's actual institutional email. Never put that address or credentials in source code. Without this secret and the provisioned Clerk keys, app sign-in remains unavailable.
3. Sign in as that administrator using the verified primary email. The server creates the first administrator only when the verified email matches the configured bootstrap email and no administrator already exists.
4. In the administrator workspace, approve the real NST email domain or domains, then invite teachers using their exact institutional addresses. Teacher roles are granted only for explicitly invited addresses. Students also need an approved verified email and a teacher must enroll them in a course.
5. Test sign-in with a real NST account in each environment. A domain match alone never verifies ownership. Live NST sign-in has not yet been verified.

Course resources, assessment eligibility, and file downloads are checked against server-side teacher assignments or student enrollments. Resources are stored in PostgreSQL; PDF and text uploads are limited to 8 MB. A teacher can review extracted page-labelled text or supply manual text after an extraction failure. Publishing a usable resource and a baseline with at least one valid question linked to published usable material in the same course opens onboarding for an enrolled student.

No Groq key is needed for this foundation milestone. AI tutoring and AI question drafting are later work.
