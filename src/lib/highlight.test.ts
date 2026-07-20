import { describe, expect, it } from "vitest";
import { lineTokens } from "./highlight";

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
