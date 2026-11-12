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


## Demo setup

On the Replit development workspace, pull GitHub main, run `npm ci` and `npm run db:migrate`, then stop and restart the `npm run dev` workflow. Migration `0032_demo_workflow.sql` adds the demo workflow and places existing active resources in topics named after them. It preserves the existing accounts, enrollments, and resource files. The new course baseline has its own academic and learning preference questions, so publish it before demonstrating onboarding.

Apply migration `0033_pdf_ai_configuration.sql` for topic deletion and AI settings. Set `GROQ_API_KEY` in Replit Secrets. The default generation model is `qwen/qwen3.8-27b`. Voice uses Groq Whisper independently of the chat model.

In the admin workspace, **AI provider settings** accepts a model ID, API base URL, and PDF input mode. For a custom provider, set `AI_PROVIDER_BASE_URL` and `AI_PROVIDER_API_KEY` in Replit Secrets and enter the matching HTTPS URL in the admin form. For Google, use `https://generativelanguage.googleapis.com/v1beta/openai` with a Google AI Studio key. Choose `gemini-3.8-flash` and **Original PDF file** to send the full PDF through Google's document API. Choose **Page images** for Groq Qwen or Google Gemma. EdCurie sends the original pages visually and saves progress after each page. Other providers need to accept PDF attachments in Chat Completions to use **Original PDF file**. Select **Process with AI** on the saved resource to retry processing.

See [the demo checklist](ACCEPTANCE-CHECKLIST.md) for the live walkthrough. The isolated suite uses temporary PostgreSQL and mocked Groq and Whisper replies. It does not seed the Replit database.


## Resource processing modes, question bank and coding runner

Pull the branch, then run `npm ci` and `npm run db:migrate`, and restart the `npm run dev` workflow. Migrations `0034_resource_processing_modes.sql` and `0035_code_submissions.sql` are additive. They add the processing mode and summary to resources, the `demo_resource_questions` bank and `demo_code_submissions`. They copy summaries and extracted problems of already-processed resources into the new columns. Older resources show **Processing mode not set**; choose a mode on the card to reprocess them. Their original uploads are kept.

Coding questions run in a separate process per test: empty environment, temporary directory, CPU/file-size limits through `ulimit`, a 3-second wall clock (`CODE_RUNNER_TIMEOUT_MS`), capped output, and a language guard (Node's `--permission` model; a Python audit hook that blocks network, subprocesses, ctypes and file access outside the interpreter and work directory). This is process isolation, not a container. JavaScript uses the app's own Node. Python needs `python3` 3.8 or later on the PATH; `.replit` adds the `python-3.12` module (set `CODE_RUNNER_PYTHON` to use another interpreter). Without Python, only JavaScript is offered. No secret is needed. Hidden tests, reference solutions, checkers, answers and AI-proposed answers are never sent to students.
