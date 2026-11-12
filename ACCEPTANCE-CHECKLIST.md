# EdCurie implementation and continuation checklist

Updated: 2026-11-12

**Current checkpoint:** the existing Foundation is preserved. The first study loop is implemented in the existing app and covered with isolated tests: assigned teacher publishes usable material and an objective baseline; an enrolled student completes a resumable baseline; the student can request a cited Groq lesson; and a teacher-authored practice answer updates independent/assisted concept evidence. Real Groq has not been configured or called. There are no synthetic users or academic records in development or production.

**Resume here:** set `GROQ_API_KEY` in Replit Tools → Secrets, use the existing NST teacher to publish actual material and at least two different practice problems linked to a baseline concept, then use the actual NST student to complete the baseline and exercise lesson, citation, hint, independent practice and mastery. Do not create fixture records in the shared development database. After live verification, proceed with resource/question version history and remaining features below, in dependency order. The safe automated test command is `npm run test:isolated`.

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
| 16 | Socratic hints and twin problems | Teacher creates twin problems with three hints; student can request hints, reveal a supported teacher answer after exhausting hints, and try an unused problem | Hint use and independent/assisted attempts persist; answer is not returned before submission | **Partial.** Teacher must author additional variations for a fresh subsequent question; no generated questions or two-to-three item micro-practice. |
| 17 | FSRS retrieval | No review vault | None | **Not started.** |
| 18 | Classroom-grounded solutions | Concept-specific published excerpt supplies citations; student can open the authorized source section | Server limits source, validates cited resource/location, stores lesson and metadata | **Implemented for this loop / pending live test.** No immutable resource-version snapshots yet. |
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
| Groq setup and reliability | **Partial** | Server secret only; bounded excerpt/citation validation, timeout, one transient retry, per-user rate cap and metadata. Missing key stops live calls. Add `GROQ_API_KEY` in Tools → Secrets; optional `GROQ_MODEL` defaults to `qwen/qwen3.8-27b`. Live provider behavior is **not verified**. |
| Consistency and authorization | **Partial** | Baseline session snapshots/resume and duplicate-submit guard; practice submission is transactional. Broader operation idempotency and historical resource snapshots remain. |
| Current isolated checks | **Passed** | `npm run build`; `npm run test:isolated` (2 test files, 11 tests), using a disposable PostgreSQL database and mocked Groq response. These do not prove live provider, email delivery, or real NST account access. |
| Preview / direct development URL | **Pending final runtime check** | After the final server and migration changes, restart `Start application`, inspect logs, and check the Preview and direct development URL. |
| Signed-in browser flow | **Pending owner verification** | Do not use a test-login bypass. Sign in with actual NST teacher/student accounts after owner-controlled verification. |

## Remaining implementation order

1. Complete real-account verification of resource publication, baseline, source-cited lesson, independent practice, and teacher progress; configure Groq first.
2. Add immutable resource/question versions and safer edit/archive/history workflows; broaden explicit request validation and idempotency.
3. Expand assessments, imports, grading evidence, diagnosis, and teacher correction.
4. Add complete goals/intake, workload feasibility, timetable/availability, study plans, early access, and recalibration.
5. Add revision/FSRS and adaptive mocks.
6. Add XP, opt-in leaderboard, voice, active-time and break reminders.
7. Extend isolated tests and manual desktop/mobile/keyboard verification for each feature; retain zero invented development/production records.
