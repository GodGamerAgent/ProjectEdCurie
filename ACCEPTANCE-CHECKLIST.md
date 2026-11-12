# EdCurie implementation and continuation checklist

Updated: 2026-11-12

**Release candidate:** the teacher-to-student study loop is implemented and exercised in the isolated API suite with a test identity resolver and mocked Groq. The Codex integration branch starts from Replit's handoff commit `b2e87357046d5bb9a32deb008ad293925a71adb9`. Signed-in Replit screens and real provider calls still need the owner walkthrough.

| Status | Evidence |
|---|---|
| **Implemented** | Clerk verified-email role resolution, teacher resource and baseline publishing, course enrollment, the student onboarding gate, cited lessons and comprehension checks, progressive hints, linked twins, and assigned-teacher progress. The integration branch fixes concurrent baseline starts, baseline resume after a source is unpublished, completed-baseline retakes, practice hint resume and duplicate XP, student access to withdrawn sources, and malformed Groq JSON handling. Adaptive mocks also support optional time limits, with saved answers and deadlines that survive refresh. |
| **Automated-tested** | `npm run build` and `npm run test:isolated` pass locally. The isolated suite applies the checked-in migrations to disposable PostgreSQL and runs 26 tests across three files, including nine from the independent QA review. Adaptive mock checks cover a fixed deadline, rejected late saves, partial scoring after timeout, and repeat submission. Additional local API checks exercised concurrent starts, archived source access and baseline resume, hint restoration, and null Groq payloads. |
| **Live-verified** | Replit reported its Preview served HTTP 200 and rendered the public landing and sign-in pages at the handoff. |
| **Blocked on owner live check** | Use real NST teacher/student sessions and the configured Groq key to run the walkthrough below. The isolated resolver and mocked Groq do not exercise those services. |
| **Implemented, live check pending** | Teachers can generate objective question drafts from a published concept resource, review/edit each with its supporting quote, and approve it into a draft assessment. Only subsequent teacher publication makes it eligible for baselines/adaptive mocks. Provider calls are mocked in automated tests. |
| **Deferred** | Milestone-driven study phases and other work outside the critical demo. |

AI question drafting requires additive migration `0030_teacher_ai_question_drafts.sql`. Drafts persist privately, source quotes are checked against the provided excerpt, and accepting a draft is idempotent. Teachers must verify semantic correctness; a valid quote alone does not prove the answer. The provider reads only the first 12,000 source characters.

Timed mocks require additive migration `0029_timed_adaptive_mocks.sql`. Existing mocks stay untimed. It was applied only to disposable test databases. Replit reports development is at `0028_pale_arclight.sql`. The dependency lock uses public npm URLs with the same package versions and integrity hashes, so local checkouts can run `npm ci`.

**Linked-twin manual walkthrough:** in the assigned teacher's course, create two distinct practice questions for the same concept, then use **Link an independent twin** to pair them. As an enrolled student with a completed baseline, submit the original, choose **Solve linked twin**, and answer without hints. Verify the independent count increases once. With another authorized student or fresh teacher-authored pair, request a hint on the twin and verify only assisted evidence increases. Refresh to verify **Resume linked twin** retains used hints. Use real accounts/material only; fixtures belong exclusively in `npm run test:isolated`.

**MVP timing:** aim to freeze and verify the Preview by **7:30 p.m. IST**, then hand it over with any remaining live-test blockers by **8:00 p.m. IST tonight**.

## Exact owner walkthrough for the MVP

Use real institute accounts and course material in Preview. Do not create demo records in the shared development or production database.

1. Sign in as an assigned NST teacher and open or create the intended course.
2. Enroll the real NST student by the verified institutional email.
3. Upload/paste a resource, save it, and publish it.
4. Add a concept linked to that resource.
5. Create a baseline assessment. Add at least one question with a prompt, expected answer, the published resource, and the concept; then publish the assessment.
6. Add two teacher-approved practice problems for the same concept. Link the second as the first problem's independent twin and confirm the link in the teacher list.
7. Sign in as the enrolled student and start the baseline. Enter a response and move focus out of the field to save it. Refresh, select **Resume baseline assessment**, confirm the saved response is there, then complete and submit the assessment. Refresh to confirm the completed score stays visible and the baseline cannot be started again.
8. Open the concept and request a lesson. Confirm it includes a citation to the published material; open the cited source excerpt and answer the comprehension check.
9. Start the original practice problem and submit an answer. Open the linked twin follow-up and answer without requesting a hint.
10. Confirm the twin increases independent attempts by one and increases independent correct evidence if the answer was correct. Refresh and check both the student concept and assigned teacher’s progress view. If testing the assisted path, use a fresh teacher-approved twin and request a hint before answering; only assisted evidence should increase.
11. Confirm the original and twin show different prompts. The **Demonstrated understanding** badge requires at least three distinct independent questions, at least 80% correct on the latest five, and a correct most-recent attempt. Two questions can demonstrate persistence without reaching that badge.

For the timed mock check, select **5 minutes** under **Adaptive mock**, save one answer, and refresh. **Start or resume mock** should restore the answer and remaining time. After expiry, select **View timed result**. The saved answer should be graded and unanswered questions should count as incorrect.

Status meanings: **Implemented** = feature exists in this project; **Partial** = a working slice exists, but the brief requires more; **Not started** = not implemented; **Pending live test** = code/test exists, but real account/provider verification remains outstanding.

## Original 22 study features

| # | Feature | Screen / behavior present | Server / persistence | Verification and remaining work |
|---|---|---|---|---|
| 1 | Granular concept mastery | Student concept list shows independent/assisted counts and evidence-based status; teacher sees course progress | Unique teacher-authored question outcomes, including hint-free FSRS review, feed mastery; baseline, comprehension, and assisted attempts cannot independently demonstrate mastery | **Implemented for distinct-question practice/review / partial for retention.** Needs another look after two latest independent errors; demonstration requires 3 distinct questions and >=80% of the latest five, including a correct most-recent attempt. |
| 2 | Learning preferences and study habits | Student Preferences and explanation-format chooser; private intake; students rate each lesson | Focus blocks are recorded once and recent totals join private intake context for cited lessons; helpful ratings inform a suggestion after enough feedback | **Partial / isolated-tested.** No duration capture if a page closes mid-session; style suggestions remain student-controlled. |
| 3 | Goals and milestones | Student saves a course goal/deadline and up to 20 dated milestones with optional target scores and completion toggles | Course-scoped milestones persist privately; a milestone grants XP once when completed | **Partial.** Milestones do not yet allocate/replan study phases or check target scores automatically. |
| 4 | Intelligent intake | Student can save/delete prior background, confidence, target assessment/date, and goals before the baseline | Course-scoped student data is authorization-checked and passed as untrusted personalization context to the cited lesson provider | **Partial / isolated-tested.** No intake-driven baseline branching or target-assessment diagnostics. |
| 5 | Feasibility and difficulty score | Student sees teacher-estimated workload, private availability, class/commitment conflicts, deadline, and a 1–10 feasibility score | Course concepts have teacher-managed phase estimates and difficulty; capacity is calculated from actual schedule windows | **Implemented as a transparent first score / partial.** Needs evidence-driven workload ranges and broader accommodations. |
| 6 | Learning, practice, and revision phases | Plan assigns learning, practice, and revision blocks by concept | Blocks persist with estimates, schedule, status, and explanation; a review vault schedules recall with FSRS | **Implemented as initial phased plans.** Revision allocation can be made more evidence-adaptive. |
| 7 | Curriculum adaptation | Topics with errors are prioritized in focused practice and study plans; new evidence can trigger automatic replanning | Distinct outcomes and prerequisite edges inform ordering | **Partial.** No completion-driven prerequisite mastery or advanced pacing model yet. |
| 8 | Scheduled interactive delivery | Students see a course study plan with start-early and completion controls | Timezone-aware blocks use class events, exceptions, private availability, and commitments | **Implemented as initial planning flow.** No automatic push/email delivery or notifications. |
| 9 | Early and on-demand access | Student can start a scheduled block before its time and open the related concept | Session start/completion state persists and is owner-scoped | **Partial.** No missed-session prompt or rescheduling automation yet. |
| 10 | Active comprehension checks | Each source-grounded lesson has one or two multiple-choice checks and feedback; previous answers persist | Options and source citations persist; answer key stays server-side until submission; each response is saved once as assisted comprehension evidence | **Implemented for source-grounded checks; pending live Groq and real-course verification.** Invalid or uncited checks are rejected. |
| 11 | Prerequisite DAG diagnosis | Teacher can author a prerequisite DAG; student receives a diagnostic chain after an incorrect practice response | Same-course edges are checked and cycles rejected; diagnostic path is bounded to three distinct prerequisite levels, and answers persist as diagnostic evidence | **Partial.** Bounded flow and assignment error categories are implemented/tested. Extend teacher-facing prerequisite diagnosis. |
| 12 | Dynamic schedule recalibration | Opening a plan detects missed sessions/new evidence and recalculates remaining blocks | Replans preserve the first deadline, completed phases, and prior plan history; repeat reads do not create extra versions | **Partial.** Refresh-driven triggers work; no push notification or unattended scheduler. |
| 13 | Adaptive mocks | Student can start/resume a mock, save answers, submit, review score, and read teacher feedback | Current published, source-linked questions are prioritized by evidence; teacher-estimated difficulty adjusts to the last mock score; authorized teachers can review and comment; scores stay separate from mastery | **Partial.** Difficulty adaptation, optional time limits and teacher review are isolated-tested. Teacher-reviewed AI drafts feed the published assessment question pool. Live Groq drafting remains unverified. |
| 14 | Explanation-format adaptation | Student selects direct, intuition, analogy, formal reasoning, or code trace and rates each explanation | Lesson feedback persists per student; after two ratings for a style, the highest helpful-rate style is suggested without overriding student choice | **Partial / isolated-tested.** Live provider behavior and longer-term usefulness remain unverified. |
| 15 | Click-first tutoring | Student has lessons, practice, sources, hints, checks, and a persistent follow-up conversation per lesson | Student/tutor messages and cited responses persist; each follow-up is authorized, source-validated, and rate-limited | **Partial / isolated-tested.** Conversation is implemented; live Groq behavior, streaming, and broader teacher controls remain. |
| 16 | Socratic hints and twin problems | Teacher pairs original and twin; student completes the original and follows the linked twin | Explicit same-concept link; reserved twins excluded; prior exposure rejected; only hint-free twin evidence is independent | **End-to-end isolated-tested with the teacher-to-student flow.** Live signed-in NST walkthrough and automatic twin generation remain pending. |
| 17 | FSRS retrieval | Student Review Vault lists due questions, starts recall, and reveals the expected answer only after submission | FSRS-7 state, due dates, review logs, sessions, and outcomes persist; answer retries are idempotent; hint-free review updates distinct-question mastery | **Implemented and isolated-tested.** Live timing/interaction walkthrough with an NST account remains. |
| 18 | Classroom-grounded solutions | Concept-specific published excerpt supplies citations; student can open the authorized source section | Server validates citations and persists resource/question version snapshots for lessons and assessment sessions | **Implemented for this loop / pending live test.** Teacher version-history screens are available. |
| 19 | Voice | Student can read a lesson aloud and dictate a practice answer through supported browser speech APIs | Dictated text goes through the same authorized answer route; no audio is stored by EdCurie | **Partial / pending browser test.** Availability depends on browser speech support and microphone permission; no streamed tutor conversation. |
| 20 | Test and assignment diagnosis | Teacher links an assignment to a concept, selects a structured error category, and can mark reviewed work as evidence; students submit text/PDF/plain text, confidence, and reflection | Evidence persists separately and influences future topic prioritization; it never increases distinct independent question mastery; teacher feedback remains hidden until review | **Partial / isolated-tested.** Structured categories and optional verified evidence work. No OCR/scanned PDF extraction, automated grading, or richer diagnosis. |
| 21 | Targeted micro-practice | Student sees up to five focus topics based on incorrect/absent evidence and can start a teacher-approved problem | Published same-course source and question are required; used and twin-reserved problems are excluded | **Partial.** Focused practice offers up to three distinct teacher-approved questions in sequence, saving each submission. Generated questions remain deferred. |
| 22 | Break reminders | Student can run configurable focus/break timers with in-page end reminders | Timer settings persist in browser storage; completed focus duration is recorded with an idempotency key; no background notification | **Partial.** Timer works only while the workspace stays open; breaks do not count as study time; no push reminders. |

## Platform and operations

| Area | Status | Verification / next work |
|---|---|---|
| EdCurie branding and institute context | **Implemented** | Existing Foundation; real signed-in layouts still require an owner browser session for visual verification. |
| Clerk authentication, verified email, bootstrap admin, scoped roles | **Implemented in Foundation** | Earlier isolated checks covered bootstrap and access; the actual NST account/sign-in is not re-tested in this run. |
| Owner sign-in setup | **Needs owner configuration/live check** | Preview currently uses a Clerk development instance. Confirm a supported provider verifies the actual NST email, sign in with the configured bootstrap admin email first if no administrator exists, configure the institute and approve the real NST domain, then invite a teacher and test with a real enrolled student. No role or verification bypass is supported. |
| Institute setup, domains, teacher invitations, enrollment | **Partial** | Foundation routes/UI exist. Delivery, invitation lifecycle, multiple memberships, and actual institute login need live verification/completion. |
| Teacher course/resource/baseline publishing | **Implemented for basic workflow** | Isolated tests cover resource gate, publication and baseline. Real teacher upload remains untested. |
| Resource extraction and durable storage | **Partial** | PDF/text upload and manual text recovery exist; extraction jobs, retries, archival, and content version history remain. |
| Teacher timetable and class events | **Partial** | Teacher can add/cancel recurring weekly course events with IANA timezone/date range and date exceptions. Same-time same-course conflicts are checked; no one-off events, room/session metadata, or multiple sections yet. |
| Student availability and commitments | **Partial** | Per-course weekly windows and private one-off absolute-time commitments persist. Availability intervals reject overlap; personal commitments remain private and the planner excludes them from session windows. |
| Teacher analytics and error categories | **Partial** | Teacher view includes 7/30/90-day activity, concept evidence, structured error categories, assignment outcomes, schedule completion, and per-learner timelines filtered by activity/date window. No custom date range or cohort comparisons. |
| XP and leaderboard | **Partial** | Idempotent XP awards cover practice, comprehension, reviews, and completed study blocks. Students choose a display name and opt in per course; leaderboard responses never include emails. More award types and anti-gaming limits remain. |
| Groq setup and reliability | **Partial** | The key has been supplied. Server-only access, bounded excerpt/citation validation, timeout, one transient retry, per-user rate cap and metadata exist. Optional `GROQ_MODEL` defaults to `qwen/qwen3.8-27b`. Use the administrator AI status to confirm the active model before testing. Live provider behavior is **not verified**; this twin workflow requires no AI calls. |
| Consistency and authorization | **Partial** | Baseline sessions, practice, twin follow-ups, and comprehension answers persist and guard duplicate submissions; teacher/student scope and publication are checked on server. |
| Current isolated checks | **Passed** | `npm run build`; `npm run test:isolated` (3 test files, 26 tests on the integration branch). Coverage includes the full publish→baseline→cited lesson→twin→mastery demo and adaptive mock prioritization/difficulty/teacher review. Groq was mocked, not called live. |
| Preview / direct development URL | **Passed** | Additive schema changes are applied; workflow starts cleanly; landing and Clerk sign-in pages render; direct URL returns HTTP 200. |
| Signed-in browser flow | **Pending owner verification** | Clerk sign-in UI renders, but no real NST login was performed. With real teacher/student accounts, run the exact MVP walkthrough above; do not use a test-login bypass. |

## Remaining implementation order

1. Live-test teacher-reviewed AI question drafting from real published material.
2. Connect dated milestones to study-plan phases and add target-score checks.
3. Extend the existing focused practice set and prerequisite completion pacing when there is evidence of a gap.
4. Add more XP award types and anti-gaming limits; background schedule and break reminders.
5. Extend resource extraction for scanned files, and timetable support for one-off events/sections.
6. Continue isolated workflow tests and real-account/manual responsive verification; keep development and production free of fixtures.

## Teacher AI drafting walkthrough

1. Use a published real resource and its linked concept; open a draft baseline assessment.
2. Select the concept under **Draft questions with AI**, request 1–3 questions, and review the source quote, prompt/options and answer.
3. Refresh to confirm pending drafts persist. Edit if needed, then approve one and discard another.
4. Confirm approval adds the question but leaves the assessment in draft; publish explicitly.
5. An enrolled student can then use the question in their baseline or an adaptive mock. Provider errors must show an actionable message, with manual question authoring still available.
