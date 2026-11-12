# EdCurie MVP — independent QA handoff

Branch `claude/mvp-verification`, based on the Replit checkpoint `b2e87357046d5bb9a32deb008ad293925a71adb9`. Date: 2026-11-12.

Scope of this branch: new regression tests (`tests/qa-regression.test.ts`) and this file. No application code, schema, migrations, dependency manifests or deployment configuration were changed.

## How this was verified

- **Database isolation.** All database tests ran only through `npm run test:isolated`. That script runs `initdb` on a fresh temporary cluster on a random `127.0.0.1` port, creates `edcurie_test`, applies the checked-in migrations, runs the suite and deletes the cluster. `foundation.test.ts` refuses any other URL. `qa-regression.test.ts` applies the same guard. It then creates its own throwaway database (`edcurie_test_qa_<random>`) on that same cluster, applies the Drizzle migrations to it, and drops it afterwards. This lets it run in parallel with `foundation.test.ts`, which asserts empty tables. The shared development and production databases were never contacted, and no `DATABASE_URL` or `GROQ_API_KEY` was set in the environment.
- **Running locally on macOS.** Use `brew install postgresql@16`. Prefix commands with `PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`. Set a short `TMPDIR` such as `/tmp/x`, because a long `TMPDIR` exceeds the Unix-socket path limit and `pg_ctl` fails to start.
- **Baseline result.** On the untouched checkpoint, `npm run test:isolated` gave 2 files and 16 tests, all passing.
- **Result with this branch.** 3 files and 25 tests: 20 pass, and 5 fail. Each failure is a confirmed defect listed below. The failing tests sit in the `QA: confirmed defects` block. Their expectations describe the correct behaviour and must not be weakened; they turn green once the application is fixed. `npx tsc --noEmit` passes.
- **Groq.** Every Groq test uses a **mocked** `fetch`. No live Groq call was made, so live provider behaviour is **unverified**.
- **Browser.** **No signed-in browser verification was performed.** No Clerk login, real NST account or real course material was used. All findings come from the API, using a test identity resolver injected through `createApi`.

## Confirmed issues (send to Codex)

### 1. Repeat practice sessions launder hint use into independent mastery — **important** (close to demo-blocking)
- **Where:** `server/routes-study.ts`, the `POST /api/concepts/:id/practice` handler.
- **Reproduction:** test `keeps hint use on a practice problem from being laundered into independent evidence via a second session`.
- **What happens:** the handler only skips problems the student has already *submitted*. Each call while a session is still open inserts a new `practice_sessions` row for the same problem, with `hint_count=0`. The student can:
  1. Open session A and session B.
  2. Use all three hints in A and answer A wrongly, which reveals the answer as the walkthrough.
  3. Answer B with that answer and no hints.

  B is recorded as `assisted=false`. Mastery takes the latest attempt per problem, so `independent_correct` rises to 1.
- **How it's reachable:** through the UI. The practice button in `client/src/StudyLoop.tsx:260` stays enabled while a session is open, and clicking it clears the hints on screen.
- **Expected:** hints are used for the problem → evidence stays assisted, and `independent_correct` stays 0.
- **Actual:** `independent_correct` = 1.
- **Suggested minimal fix:** inside the existing advisory-lock transaction, return the student's open (unsubmitted) `practice` session for this concept instead of inserting a new one. Include the prompt and the hints already shown, as `POST /api/practice/:id/twin` does. Fix 2 needs the same change.

### 2. XP and attempts can be farmed by opening several sessions for one problem — **important**
- **Where:** same handler as fix 1. The XP is awarded in `POST /api/practice/:id/answer`, keyed `practice:${sessionId}`.
- **Reproduction:** test `awards practice XP and attempts at most once per problem, however many sessions are opened`.
- **Expected:** one problem gives 10 XP and 1 attempt.
- **Actual:** four sessions for one problem give 40 XP and 4 `study_attempts` rows. The leaderboard and the "errors" counts used in planning are both inflated.
- **Suggested minimal fix:** fix 1 resolves this. For extra protection, key the practice XP by problem (`practice:${problemId}`) rather than by session.

### 3. A submitted baseline can be retaken, which duplicates baseline evidence — **important**
- **Where:** `server/routes-courses.ts`, the `POST /api/courses/:id/assessment/start` handler.
- **Reproduction:** test `does not let a student retake a submitted baseline and duplicate baseline evidence`.
- **What happens:** after submission, no session is active, so the handler opens a new session and the student can submit again.
- **How it's reachable:** the student UI still shows "Begin baseline assessment" after submission (`client/src/App.tsx:455`).
- **Expected:** still 1 `baseline_submissions` row and 1 `study_attempts` row with `kind='baseline'`.
- **Actual:** 2 of each. There is no unique constraint on `baseline_submissions(assessment_id,user_id)`.
- **Suggested minimal fix:** in `start`, if the student already has a `submitted` assessment session or a `baseline_submissions` row for this course, return 409 or the existing result instead of creating a session. Optionally hide the button in the UI when a result exists. A unique index would be a schema change, so that decision is Codex's.

### 4. Archived resources are still served to students as source excerpts — **important**
- **Where:** `server/routes-materials.ts`, the `GET /api/resources/:id/excerpt` handler. A related cause is `POST /api/resources/:id/archive`.
- **Reproduction:** test `stops serving source excerpts to students once the teacher archives the resource`.
- **What happens:** archiving sets only `resources.status='archived'`. `resource_versions.status` stays `published`, and the excerpt route checks only the version's status for students.
- **What already works:** after archiving, `/file` returns 404 and onboarding returns `no_resource`.
- **Expected:** the excerpt returns 404 for the student.
- **Actual:** 200, with the full text.
- **Related symptom (not separately tested):** `GET /api/concepts/:id/lessons` still lists lessons that cite the archived material.
- **Suggested minimal fix:** in the excerpt handler, add `if (!access.teacher && resource.status === "archived") throw new HttpError(404, ...)`. Alternatively, have the archive route also mark the resource's versions as archived.

### 5. A Groq message whose content is `null` becomes a 500 — **optional** (graceful-error gap; MOCKED provider)
- **Where:** `server/routes-study.ts`, in `groqLesson` and `groqTutorReply`.
- **Reproduction:** test `maps a provider message whose content is JSON null to a 502 ...`.
- **What happens:** `JSON.parse("null")` succeeds, and then `parsed.explanation` (or `parsed.answer`) throws a `TypeError`. This is not an `HttpError`, so the student sees the generic "Something went wrong" message. The `ai_generations` row is marked with the category `failed` instead of a status code. The same happens for any non-object JSON value with properties that are accessed.
- **Expected:** `groqLesson` throws an `HttpError` with status 502, and both the lesson and follow-up routes return 502.
- **Actual:** `TypeError`, then 500 and 500.
- **Suggested minimal fix:** after each `JSON.parse`, add `if (!parsed || typeof parsed !== "object") throw new HttpError(502, "Groq returned an invalid lesson. Please try again.")`, and the matching check in `groqTutorReply`.

## Verified as working (tests pass)

| Priority item | Result | Evidence |
|---|---|---|
| 1. Unauthenticated and wrong-role access | Pass | QA sweep of 25 endpoints. Every endpoint returns 401 without a user. Student-only endpoints return 403 for teacher/admin, and teacher-only endpoints return 403 for student/admin. |
| 2. Cross-institute and cross-course access | Pass | The sweep includes corrupted cross-institute enrollment and assignment rows, which still return 403. QA cross-reference test. Foundation isolation tests. |
| 3. Unenrolled student | Pass | Sweep: every student, shared and course endpoint returns 403 for an unenrolled student in the same institute. |
| 4. Draft resources not opening onboarding | Pass | Foundation `blocks the no-resource and draft-resource states...` and `rechecks source publication...`. The QA archive test confirms onboarding drops to `no_resource`. |
| 5. Published resource without a baseline stays blocked | Pass | Foundation `requires published material and a published baseline...`. |
| 6. Invalid or cross-course question/resource references | Pass | QA test covers: a concept using another course's resource, a cross-course prerequisite, a question's concept or resource in another course (create and PATCH), a practice problem built on another course's question, a twin of a different concept, and a resource version id from another resource on `/excerpt` (404). |
| 7. Baseline resume and duplicate submit | Resume and retry: pass. Retake: **fail (issue 3)**. | Foundation covers resume and retry. A QA test of a concurrent double "Start" returned the same session in both runs. Note that `start` takes no lock: the partial unique index prevents two active sessions, but a true race would return 500 to one request rather than the session. **Not fully proven.** |
| 8. Citation validity and authorized source retrieval | Pass, except archived excerpts (**issue 4**) | Foundation plus QA mocked-Groq tests: uncited explanations or checks give 502, and an excerpt with a foreign version gives 404. |
| 9. Hints mark work as assisted | Twin path: pass. Practice path: **fail (issue 1)**. | Foundation twin test. |
| 10. Distinct linked twins and independent evidence | Pass | Foundation twin test, plus the QA same-course different-concept twin rejection. |
| 11. Repeat submissions not farming mastery or XP | Same-session retries: pass. Multi-session: **fail (issues 1–2)**. | |
| 12. Progress persistence and assigned-teacher visibility | Pass | Foundation progress checks. The QA sweep confirms an unassigned teacher in the same institute and a teacher from another institute both get 403 on `/progress` and `/analytics`. |
| 13. Missing key, Groq errors and malformed responses | Pass, except null content (**issue 5**) | QA unit tests (MOCKED): missing key gives 503; 401 gives 503; 429 twice gives 429; network failure twice gives 503; a non-JSON body gives 502; a missing `choices` gives 502; non-JSON content gives 502; a bad citation gives 502; a single 503 is retried and then succeeds. |

## Observations not raised as defects (product decisions)

- **Review vault after a walkthrough.** After three hints and a wrong answer, the walkthrough reveals the expected answer. The FSRS card is graded *Again* and comes due soon. A hint-free review is then stored as independent evidence (`kind='review'`) for the same problem and becomes its latest attempt. This matches the checklist's statement that hint-free FSRS review updates mastery. Product should confirm that recalling a revealed answer should count as independent mastery.
- **Mock results include past enrollees.** `GET /api/courses/:id/mocks/results` lists completed mocks for any user in that course, including students who are no longer enrolled. This is low risk because there is currently no unenroll route.

## Not verified

- Live Groq requests, latency and model output quality.
- Signed-in Clerk flows and the owner walkthrough with real NST teacher/student accounts and real material.
- Browser UI, responsive layout and speech features.
- Production and Preview database state.
