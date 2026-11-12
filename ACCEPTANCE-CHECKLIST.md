# EdCurie implementation and continuation checklist

Updated: 2026-11-12

**Current checkpoint:** the learning loop now includes immutable source/question history, citation-validated Groq lessons with source-grounded comprehension checks, bounded three-level prerequisite diagnosis, targeted topic suggestions, explicitly teacher-linked twin practice, resumable hints, and attempt-based evidence. Weekly teacher timetables, date exceptions, private student weekly availability, and private one-off commitments are also implemented. Comprehension and hinted work are assisted; hint-free practice on distinct problems can develop into “Demonstrated understanding” after at least three successful questions. Baseline results remain separate; a repeated question does not increase independent practice evidence. Isolation and authorization checks pass. The Groq key has been supplied, but live Groq and real NST login have not been verified. No fixtures were added to development or production.

**Next unfinished implementation task: feasibility scoring and study-plan scheduling.** Use the class timetable, private availability, commitments, workload estimates, and deadline to explain feasibility and propose sessions. Keep the deadline fixed during replanning.

**Linked-twin manual walkthrough:** in the assigned teacher's course, create two distinct practice questions for the same concept, then use **Link an independent twin** to pair them. As an enrolled student with a completed baseline, submit the original, choose **Solve linked twin**, and answer without hints. Verify the independent count increases once. With another authorized student or fresh teacher-authored pair, request a hint on the twin and verify only assisted evidence increases. Refresh to verify **Resume linked twin** retains used hints. Use real accounts/material only; fixtures belong exclusively in `npm run test:isolated`.

Status meanings: **Implemented** = feature exists in this project; **Partial** = a working slice exists, but the brief requires more; **Not started** = not implemented; **Pending live test** = code/test exists, but real account/provider verification remains outstanding.

## Original 22 study features

| # | Feature | Screen / behavior present | Server / persistence | Verification and remaining work |
|---|---|---|---|---|
| 1 | Granular concept mastery | Student concept list shows independent/assisted counts and evidence-based status; teacher sees course progress | Unique teacher-authored practice problem outcomes are deduplicated; baseline, comprehension, and assisted attempts cannot independently demonstrate mastery | **Implemented for practice mastery / partial for retention.** Needs another look after two latest independent errors; demonstration requires 3 distinct questions and >=80% of the latest five, including a correct most-recent attempt. FSRS retention remains. |
| 2 | Learning preferences and study habits | Student Preferences view; lesson format chooser | Preferences persist; selected preferences are passed to Groq | **Partial.** Test preference isolation/reset and comparable outcomes before adapting formats; active duration is not implemented. |
| 3 | Goals and milestones | Student saves a course goal, deadline, and availability before baseline | Per-student/course record persists across refresh | **Partial.** One goal only; no milestones, target scores, multiple scopes, feasibility calculation. |
| 4 | Intelligent intake | Baseline assessment is available after course gate | Assessment question snapshot, answer autosave, deterministic objective score | **Partial.** Does not collect background/confidence/target-assessment data or adapt intake. |
| 5 | Feasibility and difficulty score | No feasibility screen | None | **Not started.** |
| 6 | Learning, practice, and revision phases | Student can request lesson and start teacher-approved practice | Lesson and practice attempts persist | **Partial.** No structured phased plan or revision allocation. |
| 7 | Curriculum adaptation | Concept statuses are visible | Attempts inform basic concept status | **Partial.** No schedule/curriculum adaptation. |
| 8 | Scheduled interactive delivery | No scheduled delivery | None | **Not started.** |
| 9 | Early and on-demand access | Student can open a concept and start its lesson/practice after baseline | Current enrollment and publication are checked server-side | **Partial.** No scheduled-session completion linkage or missed-session flow. |
| 10 | Active comprehension checks | Each source-grounded lesson has one or two multiple-choice checks and feedback; previous answers persist | Options and source citations persist; answer key stays server-side until submission; each response is saved once as assisted comprehension evidence | **Implemented for source-grounded checks; pending live Groq and real-course verification.** Invalid or uncited checks are rejected. |
| 11 | Prerequisite DAG diagnosis | Teacher can author a prerequisite DAG; student receives a diagnostic chain after an incorrect practice response | Same-course edges are checked and cycles rejected; diagnostic path is bounded to three distinct prerequisite levels, and answers persist as diagnostic evidence | **Partial.** Bounded multi-level flow is implemented/tested. Error categories and teacher diagnosis/review tools remain. |
| 12 | Dynamic schedule recalibration | No schedule view | None | **Not started.** |
| 13 | Adaptive mocks | No mock workspace | None | **Not started.** |
| 14 | Explanation-format adaptation | Student selects direct, intuition, analogy, formal reasoning, or code trace | Format selection passed as a bounded option to Groq | **Partial / pending live test.** No outcome-based suggestion; live response awaits key/material. |
| 15 | Click-first tutoring | Student has explicit lesson, practice, source, hint, and comprehension-check actions | Actions are authorized and persisted server-side | **Partial.** No persistent multi-turn chat or resumable tutor conversation. |
| 16 | Socratic hints and twin problems | Teacher pairs original and twin in **Link an independent twin**; student opens/resumes it only after submitting the original | Explicit same-concept link; reserved twins excluded from ordinary practice/diagnostics; previous exposure rejected; hints and results persisted; only hint-free twin evidence is independent | **Linked-twin workflow implemented and isolated-tested.** Automatic generation and multi-question micro-practice remain partial. Live signed-in walkthrough pending. |
| 17 | FSRS retrieval | No review vault | None | **Not started.** |
| 18 | Classroom-grounded solutions | Concept-specific published excerpt supplies citations; student can open the authorized source section | Server validates citations and persists resource/question version snapshots for lessons and assessment sessions | **Implemented for this loop / pending live test.** Teacher version-history screens are available. |
| 19 | Voice | No voice mode | None | **Not started.** |
| 20 | Test and assignment diagnosis | Objective baseline only | Deterministic normalized exact-match grading; saved result | **Partial.** No assignments, imports, rubrics, uncertain grading or teacher correction. |
| 21 | Targeted micro-practice | Student sees up to five focus topics based on incorrect/absent evidence and can start a teacher-approved problem | Published same-course source and question are required; used and twin-reserved problems are excluded | **Partial.** Single-question sessions only; no generated multi-question set or teacher-reviewed error categories. |
| 22 | Break reminders | No reminder/timer | None | **Not started.** |

## Platform and operations

| Area | Status | Verification / next work |
|---|---|---|
| EdCurie branding and institute context | **Implemented** | Existing Foundation; real signed-in layouts still require an owner browser session for visual verification. |
| Clerk authentication, verified email, bootstrap admin, scoped roles | **Implemented in Foundation** | Earlier isolated checks covered bootstrap and access; the actual NST account/sign-in is not re-tested in this run. |
| Institute setup, domains, teacher invitations, enrollment | **Partial** | Foundation routes/UI exist. Delivery, invitation lifecycle, multiple memberships, and actual institute login need live verification/completion. |
| Teacher course/resource/baseline publishing | **Implemented for basic workflow** | Isolated tests cover resource gate, publication and baseline. Real teacher upload remains untested. |
| Resource extraction and durable storage | **Partial** | PDF/text upload and manual text recovery exist; extraction jobs, retries, archival, and content version history remain. |
| Teacher timetable and class events | **Partial** | Teacher can add and cancel recurring weekly course events with IANA timezone/date range and exceptions for a specific date. Conflict checking covers overlapping same-course events in the same timezone; no one-off events, room/session metadata, or multiple sections yet. |
| Student availability and commitments | **Partial** | Per-course weekly windows and private, one-off absolute-time commitments persist. Availability intervals reject overlap; commitment overlap is surfaced. Scheduler does not use them yet. |
| Teacher analytics and error categories | **Partial** | Basic concept progress counts only; no detailed timeline, filters, or supported error taxonomy. |
| XP and leaderboard | **Not started** | No ledger or student opt-in leaderboard. |
| Groq setup and reliability | **Partial** | The key has been supplied. Server-only access, bounded excerpt/citation validation, timeout, one transient retry, per-user rate cap and metadata exist. Optional `GROQ_MODEL` defaults to `qwen/qwen3.8-27b`. Live provider behavior is **not verified**; this twin workflow requires no AI calls. |
| Consistency and authorization | **Partial** | Baseline sessions, practice, twin follow-ups, and comprehension answers persist and guard duplicate submissions; teacher/student scope and publication are checked on server. |
| Current isolated checks | **Passed** | `npm run build`; `npm run test:isolated` (2 test files, 13 tests). Tests cover learning-loop authorization, focused practice, evidence, checks, and timetable/availability/commitment privacy and validation. Provider responses are simulated; no live Groq call was made. |
| Preview / direct development URL | **Passed** | Workflow restarted cleanly after the learning, diagnosis, and timetable migrations. Direct URL and Preview returned HTTP 200; public homepage rendered. Signed-in schedule and study screens remain unverified with real NST accounts. |
| Signed-in browser flow | **Pending owner verification** | Do not use a test-login bypass. Sign in with actual NST teacher/student accounts after owner-controlled verification. |

## Remaining implementation order

1. Add transparent workload/difficulty feasibility scoring and timezone-aware, deadline-preserving personalized study plans from the new timetable/availability data.
2. Add scheduled study sessions, early starts, completion tracking, and replanning without changing deadlines.
3. Expand assessments/assignments, imports, grading evidence, error categories, and teacher correction.
4. Add FSRS revision, adaptive mocks, and teacher analytics.
5. Complete intake, goal milestones, curriculum adaptation, preference feedback, and tutor controls.
6. Add XP, opt-in leaderboard, voice, active-time and break reminders.
7. Extend isolated tests and manual desktop/mobile/keyboard verification for each feature; retain zero invented development/production records.
