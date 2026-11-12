import { describe, expect, it } from "vitest";
import { passwordSuggestions } from "../client/src/SignupFieldHints";

describe("password suggestions", () => {
  it("starts with every suggestion unmet", () => {
    expect(passwordSuggestions("")).toEqual([false, false, false, false]);
  });
  it("marks only the matching suggestions as met", () => {
    expect(passwordSuggestions("A")).toEqual([false, true, false, false]);
    expect(passwordSuggestions("A2")).toEqual([false, true, true, false]);
    expect(passwordSuggestions("A2!")).toEqual([false, true, true, true]);
    expect(passwordSuggestions("A2!abcdefghijkl")).toEqual([true, true, true, true]);
    expect(passwordSuggestions("A2abcdefghijklmn")).toEqual([true, true, true, false]);
  });
});
