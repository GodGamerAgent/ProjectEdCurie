import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, uniqueIndex, jsonb, customType, integer, boolean } from "drizzle-orm/pg-core";

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const institutes = pgTable("institutes", {
  id: uuid("id").defaultRandom().primaryKey(),
  displayName: text("display_name").notNull(),
  logoData: bytes("logo_data"),
  logoMime: text("logo_mime"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: text("provider_id").notNull().unique(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
  instituteId: uuid("institute_id").references(() => institutes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const domains = pgTable("approved_domains", {
  domain: text("domain").primaryKey(),
  instituteId: uuid("institute_id").references(() => institutes.id)
});
export const invitations = pgTable("teacher_invitations", {
  email: text("email").primaryKey(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  instituteId: uuid("institute_id").references(() => institutes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const courses = pgTable("courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  instituteId: uuid("institute_id").references(() => institutes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const courseTeachers = pgTable("course_teachers", {
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" })
}, (table) => [uniqueIndex("course_teachers_unique").on(table.courseId, table.userId)]);
export const enrollments = pgTable("enrollments", {
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  email: text("email").notNull()
}, (table) => [uniqueIndex("enrollments_unique").on(table.courseId, table.email)]);
export const resources = pgTable("resources", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  text: text("text").notNull().default(""),
  status: text("status").notNull().default("draft"),
  extractionStatus: text("extraction_status").notNull().default("pending"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  fileData: bytes("file_data"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const resourceVersions = pgTable("resource_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  resourceId: uuid("resource_id").notNull().references(() => resources.id),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  status: text("status").notNull(),
  extractionStatus: text("extraction_status").notNull(),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  fileData: bytes("file_data"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex("resource_versions_resource_version_unique").on(table.resourceId,table.version)]);
export const concepts = pgTable("concepts", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  name: text("name").notNull(),
  resourceId: uuid("resource_id").notNull().references(() => resources.id),
  learningMinutes: integer("learning_minutes").notNull().default(30),
  practiceMinutes: integer("practice_minutes").notNull().default(20),
  revisionMinutes: integer("revision_minutes").notNull().default(10),
  difficulty: integer("difficulty").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const conceptPrerequisites = pgTable("concept_prerequisites", {
  conceptId: uuid("concept_id").notNull().references(() => concepts.id),
  prerequisiteId: uuid("prerequisite_id").notNull().references(() => concepts.id)
}, (table) => [uniqueIndex("concept_prerequisites_unique").on(table.conceptId, table.prerequisiteId)]);
export const assessments = pgTable("assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const questions = pgTable("questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assessmentId: uuid("assessment_id").notNull().references(() => assessments.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").notNull().references(() => resources.id),
  prompt: text("prompt").notNull(),
  answer: text("answer").notNull(),
  conceptId: uuid("concept_id").references(() => concepts.id),
  version: integer("version").notNull().default(1),
  resourceVersionId: uuid("resource_version_id").references(() => resourceVersions.id)
});
export const questionVersions = pgTable("question_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  questionId: uuid("question_id").notNull().references(() => questions.id),
  version: integer("version").notNull(),
  prompt: text("prompt").notNull(),
  answer: text("answer").notNull(),
  resourceVersionId: uuid("resource_version_id").references(() => resourceVersions.id),
  conceptId: uuid("concept_id").references(() => concepts.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex("question_versions_question_version_unique").on(table.questionId,table.version)]);
export const preferences = pgTable("student_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  availability: text("availability").notNull().default(""),
  feedback: text("feedback").notNull().default(""),
  hints: text("hints").notNull().default(""),
  formats: jsonb("formats").$type<string[]>().notNull().default([])
});
export const baselineSubmissions = pgTable("baseline_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  answers: jsonb("answers").$type<Record<string, string>>().notNull(),
  score: integer("score"),
  total: integer("total"),
  details: jsonb("details").$type<{ questionId: string; conceptId: string | null; correct: boolean }[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const assessmentSessions = pgTable("assessment_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
  questions: jsonb("questions").$type<{id:string;prompt:string;answer:string;conceptId:string|null}[]>().notNull(),
  answers: jsonb("answers").$type<Record<string,string>>().notNull().default({}),
  status: text("status").notNull().default("active"),
  score: integer("score"),
  total: integer("total"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex("assessment_sessions_one_active_per_course").on(table.userId,table.courseId).where(sql`${table.status}='active'`)]);
export const studyGoals = pgTable("study_goals", {
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  goal: text("goal").notNull(),
  deadline: text("deadline").notNull(),
  availability: text("availability").notNull().default("")
}, (table) => [uniqueIndex("study_goals_unique").on(table.userId, table.courseId)]);
export const practiceProblems = pgTable("practice_problems", {
  id: uuid("id").defaultRandom().primaryKey(),
  conceptId: uuid("concept_id").notNull().references(() => concepts.id),
  questionId: uuid("question_id").notNull().references(() => questions.id),
  questionVersionId: uuid("question_version_id").references(() => questionVersions.id),
  prompt: text("prompt").notNull(),
  answer: text("answer").notNull(),
  hints: jsonb("hints").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const practiceSessions = pgTable("practice_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  problemId: uuid("problem_id").notNull().references(() => practiceProblems.id),
  kind: text("kind").notNull().default("practice"),
  hintCount: integer("hint_count").notNull().default(0),
  diagnosticDepth: integer("diagnostic_depth").notNull().default(0),
  submitted: boolean("submitted").notNull().default(false),
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const tutorLessons = pgTable("tutor_lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  conceptId: uuid("concept_id").notNull().references(() => concepts.id),
  resourceVersionId: uuid("resource_version_id").references(() => resourceVersions.id),
  explanation: text("explanation").notNull(),
  citations: jsonb("citations").$type<{resourceId:string;title:string;location:string}[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const lessonChecks = pgTable("lesson_checks", {
  id: uuid("id").defaultRandom().primaryKey(),
  lessonId: uuid("lesson_id").notNull().references(() => tutorLessons.id),
  prompt: text("prompt").notNull(),
  options: jsonb("options").$type<string[]>().notNull(),
  correctOption: integer("correct_option").notNull(),
  citations: jsonb("citations").$type<{resourceId:string;resourceVersionId:string;location:string}[]>().notNull(),
  selectedOption: integer("selected_option"),
  correct: boolean("correct"),
  answeredAt: timestamp("answered_at",{withTimezone:true})
});
export const studyAttempts = pgTable("study_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  conceptId: uuid("concept_id").notNull().references(() => concepts.id),
  sessionId: uuid("session_id").references(() => practiceSessions.id),
  lessonCheckId: uuid("lesson_check_id").references(() => lessonChecks.id),
  problemId: uuid("problem_id").references(() => practiceProblems.id),
  reviewSessionId: uuid("review_session_id"),
  kind: text("kind").notNull(),
  correct: boolean("correct").notNull(),
  assisted: boolean("assisted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, table => [uniqueIndex("study_attempts_lesson_check_unique").on(table.lessonCheckId),uniqueIndex("study_attempts_review_session_unique").on(table.reviewSessionId)]);
export const practiceTwinLinks = pgTable("practice_twin_links", {
  originalProblemId: uuid("original_problem_id").primaryKey().references(() => practiceProblems.id),
  twinProblemId: uuid("twin_problem_id").notNull().unique().references(() => practiceProblems.id),
  linkedBy: uuid("linked_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const practiceTwinSessions = pgTable("practice_twin_sessions", {
  originalSessionId: uuid("original_session_id").primaryKey().references(() => practiceSessions.id),
  twinSessionId: uuid("twin_session_id").notNull().unique().references(() => practiceSessions.id)
});
export const practiceDiagnosticSessions = pgTable("practice_diagnostic_sessions", {
  diagnosticSessionId: uuid("diagnostic_session_id").primaryKey().references(() => practiceSessions.id),
  parentSessionId: uuid("parent_session_id").notNull().unique().references(() => practiceSessions.id)
});
export const classTimetableEvents = pgTable("class_timetable_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  teacherId: uuid("teacher_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  startsOn: text("starts_on").notNull(),
  endsOn: text("ends_on").notNull(),
  timezone: text("timezone").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at",{withTimezone:true}).defaultNow().notNull()
});
export const classTimetableExceptions = pgTable("class_timetable_exceptions", {
  eventId: uuid("event_id").notNull().references(() => classTimetableEvents.id),
  exceptionDate: text("exception_date").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at",{withTimezone:true}).defaultNow().notNull()
},table=>[uniqueIndex("class_timetable_exception_unique").on(table.eventId,table.exceptionDate)]);
export const studentAvailability = pgTable("student_availability", {
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  timezone: text("timezone").notNull(),
  sessionMinutes: integer("session_minutes").notNull().default(30),
  intervals: jsonb("intervals").$type<{weekday:number;startTime:string;endTime:string}[]>().notNull().default([])
},table=>[uniqueIndex("student_availability_user_course_unique").on(table.userId,table.courseId)]);
export const studentCommitments = pgTable("student_commitments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").references(() => courses.id),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at",{withTimezone:true}).notNull(),
  endsAt: timestamp("ends_at",{withTimezone:true}).notNull(),
  timezone: text("timezone").notNull(),
  createdAt: timestamp("created_at",{withTimezone:true}).defaultNow().notNull()
});
export const studyPlans = pgTable("study_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  requestKey: uuid("request_key").notNull().unique(),
  version: integer("version").notNull(),
  deadline: text("deadline").notNull(),
  feasibilityScore: integer("feasibility_score").notNull(),
  requiredMinutes: integer("required_minutes").notNull(),
  capacityMinutes: integer("capacity_minutes").notNull(),
  explanation: text("explanation").notNull(),
  createdAt: timestamp("created_at",{withTimezone:true}).defaultNow().notNull()
});
export const studyBlocks = pgTable("study_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => studyPlans.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  conceptId: uuid("concept_id").notNull().references(() => concepts.id),
  phase: text("phase").notNull(),
  startsAt: timestamp("starts_at",{withTimezone:true}).notNull(),
  endsAt: timestamp("ends_at",{withTimezone:true}).notNull(),
  state: text("state").notNull().default("planned"),
  explanation: text("explanation").notNull(),
  startedAt: timestamp("started_at",{withTimezone:true}),
  completedAt: timestamp("completed_at",{withTimezone:true})
});
export const reviewCards = pgTable("review_cards", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  conceptId: uuid("concept_id").notNull().references(() => concepts.id),
  problemId: uuid("problem_id").notNull().references(() => practiceProblems.id),
  card: jsonb("card").notNull(),
  dueAt: timestamp("due_at",{withTimezone:true}).notNull(),
  lastReviewedAt: timestamp("last_reviewed_at",{withTimezone:true})
},table=>[uniqueIndex("review_cards_user_problem_unique").on(table.userId,table.problemId)]);
export const reviewSessions = pgTable("review_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  cardId: uuid("card_id").notNull().references(() => reviewCards.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  prompt: text("prompt").notNull(),
  expectedAnswer: text("expected_answer").notNull(),
  selectedAnswer: text("selected_answer"),
  correct: boolean("correct"),
  result: jsonb("result"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
  answeredAt: timestamp("answered_at",{withTimezone:true})
},table=>[uniqueIndex("review_sessions_one_active_per_card").on(table.cardId).where(sql`${table.status}='active'`)]);
export const reviewEvents = pgTable("review_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().unique().references(() => reviewSessions.id),
  cardId: uuid("card_id").notNull().references(() => reviewCards.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  rating: integer("rating").notNull(),
  correct: boolean("correct").notNull(),
  previousDueAt: timestamp("previous_due_at",{withTimezone:true}).notNull(),
  nextDueAt: timestamp("next_due_at",{withTimezone:true}).notNull(),
  reviewLog: jsonb("review_log").notNull(),
  createdAt: timestamp("created_at",{withTimezone:true}).defaultNow().notNull()
});
export const aiGenerations = pgTable("ai_generations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  conceptId: uuid("concept_id").notNull().references(() => concepts.id),
  model: text("model").notNull(),
  status: text("status").notNull(),
  durationMs: integer("duration_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  errorCategory: text("error_category"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
