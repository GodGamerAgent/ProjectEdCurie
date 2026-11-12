/** Publishing rules for a course onboarding baseline, shared by the editor and the API. */
export type BaselineDraftQuestion = { id: string; kind: "academic" | "preferences"; prompt: string; answer: string };

const list = (positions: number[]) => positions.length === 1 ? `question ${positions[0]}`
  : `questions ${positions.slice(0, -1).join(", ")} and ${positions[positions.length - 1]}`;

/**
 * Returns one specific message per problem. Positions are 1-based and match the
 * numbering shown in the Baseline questions editor. Learning preference
 * questions are unscored and never need an answer.
 */
export function baselineIssues(questions: BaselineDraftQuestion[]) {
  const issues: string[] = [];
  const blankPrompts = questions.flatMap((q, i) => q.prompt.trim() ? [] : [i + 1]);
  if (blankPrompts.length) issues.push(`Add question text to ${list(blankPrompts)}.`);
  if (!questions.some(q => q.kind === "academic")) issues.push("Add at least one academic question before publishing.");
  if (!questions.some(q => q.kind === "preferences")) {
    issues.push("Add at least one learning preference question before publishing. Learning preference questions are unscored and need no answer.");
  }
  const missing = questions.flatMap((q, i) => q.kind === "academic" && !q.answer.trim() ? [i + 1] : []);
  if (missing.length) issues.push(`Add an expected answer to academic ${list(missing)}.`);
  return issues;
}

/** True when the prompt lists lettered options A–D, so the expected answer is a single letter. */
export function isMultipleChoice(prompt: string) {
  return ["A", "B", "C", "D"].filter(letter => new RegExp(`(^|[\\s(*])${letter}[).:]\\s`, "m").test(prompt)).length >= 2;
}

export type AnswerSuggestion = { id: string; status: "answered" | "needs_review"; answer: string; reason: string };

/**
 * Merges generated answers into the editor's questions by ID. Blank answers are filled;
 * existing answers are kept unless replaceExisting is set. Unknown IDs are ignored.
 */
export function applySuggestions<Q extends BaselineDraftQuestion>(questions: Q[], results: AnswerSuggestion[], replaceExisting: boolean) {
  const byId = new Map(results.map(result => [result.id, result]));
  const filled: number[] = [], kept: number[] = [], review: { position: number; reason: string }[] = [];
  const next = questions.map((question, index) => {
    const result = byId.get(question.id);
    if (!result || question.kind !== "academic") return question;
    if (result.status !== "answered" || !result.answer.trim()) {
      review.push({ position: index + 1, reason: result.reason });
      return question;
    }
    if (question.answer.trim() && !replaceExisting) { kept.push(index + 1); return question; }
    filled.push(index + 1);
    return { ...question, answer: result.answer };
  });
  return { questions: next, filled, kept, review };
}
