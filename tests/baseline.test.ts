import { expect, it } from "vitest";
import { applySuggestions, baselineIssues, isMultipleChoice } from "../shared/baseline";

const q = (id: string, kind: "academic" | "preferences", prompt: string, answer = "") => ({ id, kind, prompt, answer });

it("names the missing question type and the academic question without an answer", () => {
  expect(baselineIssues([q("a", "academic", "2+2?", "4"), q("p", "preferences", "How do you study?")])).toEqual([]);
  expect(baselineIssues([q("a", "academic", "2+2?", "4")])).toEqual([
    "Add at least one learning preference question before publishing. Learning preference questions are unscored and need no answer."]);
  expect(baselineIssues([q("p", "preferences", "How do you study?")])).toEqual(["Add at least one academic question before publishing."]);
  expect(baselineIssues([q("a", "academic", "2+2?", "4"), q("p", "preferences", "Study?"), q("b", "academic", "3+3?", "  ")]))
    .toEqual(["Add an expected answer to academic question 3."]);
  expect(baselineIssues([q("a", "academic", "1?"), q("p", "preferences", "Study?"), q("b", "academic", "2?"), q("c", "academic", "3?")]))
    .toEqual(["Add an expected answer to academic questions 1, 3 and 4."]);
  expect(baselineIssues([q("a", "academic", " ", "4"), q("p", "preferences", "Study?")])).toEqual(["Add question text to question 1."]);
});

it("fills blank answers by question ID and keeps existing answers unless replacement is chosen", () => {
  const draft = [q("a", "academic", "2+2?"), q("p", "preferences", "Study?"), q("b", "academic", "3+3?", "6"), q("c", "academic", "Which is best?")];
  const results = [
    { id: "b", status: "answered" as const, answer: "SIX", reason: "" },
    { id: "zz", status: "answered" as const, answer: "wrong field", reason: "" },
    { id: "c", status: "needs_review" as const, answer: "", reason: "Ambiguous." },
    { id: "a", status: "answered" as const, answer: "4", reason: "" },
  ];
  const kept = applySuggestions(draft, results, false);
  expect(kept.questions.map(x => x.answer)).toEqual(["4", "", "6", ""]);
  expect(kept).toMatchObject({ filled: [1], kept: [3], review: [{ position: 4, reason: "Ambiguous." }] });
  expect(applySuggestions(draft, results, true).questions.map(x => x.answer)).toEqual(["4", "", "SIX", ""]);
});

it("detects multiple-choice prompts", () => {
  expect(isMultipleChoice("Next term of 3, 7, 11?\n\nA) 15 B) 19 C) 23 D) 27")).toBe(true);
  expect(isMultipleChoice("Pick one:\nA. red\nB. blue")).toBe(true);
  expect(isMultipleChoice("What is the 5th term of 2, 4, 6?")).toBe(false);
});
