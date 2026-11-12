# EdCurie implementation and continuation checklist

Updated: 2026-11-12

**Current checkpoint:** the existing Foundation and study loop are preserved. Teachers can explicitly pair a practice problem with a different, same-concept twin. The student submits the original before starting the linked twin. Hint-free twin answers count as independent evidence; any hint on the twin makes its evidence assisted. Hints on the original do not affect the twin's classification. Pairings, sessions, consumed hints, results, and mastery evidence are persisted. Concurrent starts/submissions are retry-safe. The Groq key has been supplied, but live Groq has not been verified. No test fixtures were added to development or production.

**Next unfinished implementation task: active comprehension checks.** Add persistent, source-grounded checks to lessons, student answer/feedback controls, server grading and isolation tests. Do not mark lesson opening or time spent as mastery. Live Groq/account checks do not block implementing this next task. The current request was limited to the linked-twin workflow; broader features below remain unfinished.

**Linked-twin manual walkthrough:** in the assigned teacher's course, create two distinct practice questions for the same concept, then use **Link an independent twin** to pair them. As an enrolled student with a completed baseline, submit the original, choose **Solve linked twin**, and answer without hints. Verify the independent count increases once. With another authorized student or fresh teacher-authored pair, request a hint on the twin and verify only assisted evidence increases. Refresh to verify **Resume linked twin** retains used hints. Use real accounts/material only; fixtures belong exclusively in `npm run test:isolated`.

Status meanings: **Implemented** = feature exists in this project; **Partial** = a working slice exists, but the brief requires more; **Not started** = not implemented; **Pending live test** = code/test exists, but real account/provider verification remains outstanding.

## Original 22 study features

| # | Feature | Screen / behavior present | Server / persistence | Verification and remaining work |
|---|---|---|---|---|
| 1 | Granular concept mastery | Student concept list shows independent/assisted counts and status; teacher sees course progress | Attempts saved; status is currently a simple independent-correct percentage or “Assisted evidence only” | **Partial.** Isolated attempt/progress test passes. Add conservative evidence/recency levels and retention status. |
| 2 | Learning preferences and study habits | Student Preferences view; lesson format chooser | Preferences persist; selected preferences are passed to Groq | **Partial.** Test preference isolation/reset and comparable outcomes before adapting formats; active duration is not implemented. |
| 3 | Goals and milestones | Student saves a course goal, deadline, and availability before baseline | Per-student/course record persists across refresh | **Partial.** One goal only; no milestones, target scores, multiple scopes, feasibility calculation. |
| 4 | Intelligent intake | Baseline assessment is available after course gate | Assessment question snapshot, answer autosave, deterministic objective score | **Partial.** Does not collect background/confidence/target-assessment data or adapt intake. |
| 5 | Feasibility and difficulty score | No feasibility screen | None | **Not started.** |
| 6 | Learning, practice, and revision phases | Student can request lesson and start teacher-approved practice | Lesson and practice attempts persist | **Partial.** No structured phased plan or revision allocation. |
| 7 | Curriculum adaptation | Concept statuses are visible | Attempts inform basic concept status | **Partial.** No schedule/curriculum adaptation. |
| 8 | Scheduled interactive delivery | No scheduled delivery | None | **Not started.** |
| 9 | Early and on-demand access | Student can open a concept and start its lesson/practice after baseline | Current enrollment and publication are checked server-side | **Partial.** No scheduled-session completion linkage or missed-session flow. |
| 10 | Active comprehension checks | No checks inside generated lessons | None | **Not started.** |
| 11 | Prerequisite DAG diagnosis | Teacher can add prerequisites; student sees prerequisite names; a wrong answer may trigger one prerequisite diagnostic | Same-course edges are checked and cycles rejected; diagnostic answer is recorded | **Partial.** No full graph traversal, bounded multi-level diagnostics, or categorized diagnosis. |
| 12 | Dynamic schedule recalibration | No schedule view | None | **Not started.** |
| 13 | Adaptive mocks | No mock workspace | None | **Not started.** |
| 14 | Explanation-format adaptation | Student selects direct, intuition, analogy, formal reasoning, or code trace | Format selection passed as a bounded option to Groq | **Partial / pending live test.** No outcome-based suggestion; live response awaits key/material. |
| 15 | Click-first tutoring | Student has explicit lesson, practice, source, and hint actions | Actions are authorized and persisted server-side | **Partial.** No persistent multi-turn chat, comprehension checks, or session resume for tutoring. |
| 16 | Socratic hints and twin problems | Teacher pairs original and twin in **Link an independent twin**; student opens/resumes it only after submitting the original | Explicit same-concept link; reserved twins excluded from ordinary practice/diagnostics; previous exposure rejected; hints and results persisted; only hint-free twin evidence is independent | **Linked-twin workflow implemented and isolated-tested.** Automatic generation and multi-question micro-practice remain partial. Live signed-in walkthrough pending. |
| 17 | FSRS retrieval | No review vault | None | **Not started.** |
| 18 | Classroom-grounded solutions | Concept-specific published excerpt supplies citations; student can open the authorized source section | Server validates citations and persists resource/question version snapshots for lessons and assessment sessions | **Implemented for this loop / pending live test.** Teacher version-history screens are available. |
| 19 | Voice | No voice mode | None | **Not started.** |
| 20 | Test and assignment diagnosis | Objective baseline only | Deterministic normalized exact-match grading; saved result | **Partial.** No assignments, imports, rubrics, uncertain grading or teacher correction. |
| 21 | Targeted micro-practice | A teacher-approved concept problem and optional prerequisite diagnostic are available | Student-specific sessions and attempts persist | **Partial.** One at a time; no categorized weakness selection or batch of targeted questions. |
| 22 | Break reminders | No reminder/timer | None | **Not started.** |

## Platform and operations

| Area | Status | Verification / next work |
|---|---|---|
| EdCurie branding and institute context | **Implemented** | Existing Foundation; real signed-in layouts still require an owner browser session for visual verification. |
| Clerk authentication, verified email, bootstrap admin, scoped roles | **Implemented in Foundation** | Earlier isolated checks covered bootstrap and access; the actual NST account/sign-in is not re-tested in this run. |
| Institute setup, domains, teacher invitations, enrollment | **Partial** | Foundation routes/UI exist. Delivery, invitation lifecycle, multiple memberships, and actual institute login need live verification/completion. |
| Teacher course/resource/baseline publishing | **Implemented for basic workflow** | Isolated tests cover resource gate, publication and baseline. Real teacher upload remains untested. |
| Resource extraction and durable storage | **Partial** | PDF/text upload and manual text recovery exist; extraction jobs, retries, archival, and content version history remain. |
| Teacher timetable and class events | **Not started** | No UI or persistence. |
| Teacher analytics and error categories | **Partial** | Basic concept progress counts only; no detailed timeline, filters, or supported error taxonomy. |
| XP and leaderboard | **Not started** | No ledger or student opt-in leaderboard. |
| Groq setup and reliability | **Partial** | The key has been supplied. Server-only access, bounded excerpt/citation validation, timeout, one transient retry, per-user rate cap and metadata exist. Optional `GROQ_MODEL` defaults to `qwen/qwen3.8-27b`. Live provider behavior is **not verified**; this twin workflow requires no AI calls. |
| Consistency and authorization | **Partial** | Baseline session snapshots/resume and duplicate-submit guard; practice submission is transactional. Broader operation idempotency and historical resource snapshots remain. |
| Current isolated checks | **Passed** | `npm run build`; `npm run test:isolated` (2 test files, 12 tests). Linked-twin coverage includes teacher/student permissions, same-course pairing, hint-free vs hinted mastery, preserved hints on resume, concurrent retries, answer-key protection, and publication revocation. Existing provider checks use simulated Groq results; the twin workflow does not call AI. |
| Preview / direct development URL | **Passed** | Workflow restarted cleanly after the additive twin migration. Direct URL and Preview returned HTTP 200; the public homepage rendered. Signed-in twin screens remain unverified with real NST accounts. |
| Signed-in browser flow | **Pending owner verification** | Do not use a test-login bypass. Sign in with actual NST teacher/student accounts after owner-controlled verification. |

## Remaining implementation order

1. Implement persistent lesson comprehension checks; keep real-account/provider verification separate and pending until actual materials/accounts are used.
2. Continue remaining diagnosis, targeted micro-practice, and conservative attempt-based mastery. Resource/question version history and explicit teacher-linked twins are already present.
3. Expand assessments, imports, grading evidence, diagnosis, and teacher correction.
4. Add complete goals/intake, workload feasibility, timetable/availability, study plans, early access, and recalibration.
5. Add revision/FSRS and adaptive mocks.
6. Add XP, opt-in leaderboard, voice, active-time and break reminders.
7. Extend isolated tests and manual desktop/mobile/keyboard verification for each feature; retain zero invented development/production records.
