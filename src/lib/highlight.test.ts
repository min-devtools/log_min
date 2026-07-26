import { describe, expect, it } from "vitest";
import { lineMatches, lineTokens, searchMarks } from "./highlight";

describe("lineTokens", () => {
  it("keeps guessed tokens and fills the gaps with ANSI colors", () => {
    // ansi covers "ERROR request id=4"; tokenizer claims "id" and "42"
    const ansi = [{ start: 0, end: 18, cls: "ansi-31" }];

    expect(lineTokens("ERROR request id=42", ansi, true)).toEqual([
      { start: 0, end: 14, cls: "ansi-31" },
      { start: 14, end: 16, cls: "tok-key" },
      { start: 16, end: 17, cls: "ansi-31" },
      { start: 17, end: 19, cls: "tok-num" },
    ]);
  });

  it("uses ANSI colors alone when the tokenizer finds nothing", () => {
    const ansi = [{ start: 0, end: 5, cls: "ansi-32" }];

    expect(lineTokens("plain words only", ansi, true)).toEqual(ansi);
  });

  it("uses guessed tokens alone when the line has no ANSI spans", () => {
    expect(lineTokens("id=42", undefined, true)).toEqual([
      { start: 0, end: 2, cls: "tok-key" },
      { start: 3, end: 5, cls: "tok-num" },
    ]);
  });

  it("returns nothing when syntax is off", () => {
    expect(lineTokens("ERROR id=42", [{ start: 0, end: 5, cls: "ansi-31" }], false)).toEqual([]);
  });
});

describe("lineMatches", () => {
  it("substring: case-insensitive by default, sensitive on demand", () => {
    expect(lineMatches("GET /Orders 200", "orders", false, false)).toBe(true);
    expect(lineMatches("GET /Orders 200", "orders", true, false)).toBe(false);
  });

  it("regex mode matches and never throws on bad patterns", () => {
    expect(lineMatches("req=42", String.raw`req=\d+`, false, true)).toBe(true);
    expect(lineMatches("req=42", "(", false, true)).toBe(false);
  });

  it("empty query never matches", () => {
    expect(lineMatches("anything", "", false, false)).toBe(false);
  });
});

describe("searchMarks", () => {
  it("finds every substring occurrence", () => {
    expect(searchMarks("ab AB ab", "ab", false, false)).toEqual([[0, 2], [3, 5], [6, 8]]);
    expect(searchMarks("ab AB ab", "ab", true, false)).toEqual([[0, 2], [6, 8]]);
  });

  it("regex mode marks each match and survives zero-width patterns", () => {
    expect(searchMarks("a1 b22", String.raw`\d+`, false, true)).toEqual([[1, 2], [4, 6]]);
    expect(searchMarks("abc", "x*", false, true)).toEqual([]);
    expect(searchMarks("abc", "(", false, true)).toEqual([]);
  });
});
