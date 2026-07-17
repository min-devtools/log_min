import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi";

describe("parseAnsi", () => {
  it("passes plain text through", () => {
    expect(parseAnsi("hello world")).toEqual({ clean: "hello world", spans: [] });
  });

  it("maps a colored segment to a span over the clean text", () => {
    const { clean, spans } = parseAnsi("a \x1b[31mred\x1b[0m tail");
    expect(clean).toBe("a red tail");
    expect(spans).toEqual([{ start: 2, end: 5, cls: "ansi-31" }]);
  });

  it("combines bold with color and honors reset", () => {
    const { clean, spans } = parseAnsi("\x1b[1;32mok\x1b[0m plain \x1b[1mbold\x1b[22mnot");
    expect(clean).toBe("ok plain boldnot");
    expect(spans).toEqual([
      { start: 0, end: 2, cls: "ansi-32 ansi-bold" },
      { start: 9, end: 13, cls: "ansi-bold" },
    ]);
  });

  it("strips 256-color and truecolor codes without styling", () => {
    const { clean, spans } = parseAnsi("\x1b[38;5;196mx\x1b[0m \x1b[38;2;1;2;3my\x1b[0m");
    expect(clean).toBe("x y");
    expect(spans).toEqual([]);
  });

  it("strips non-SGR CSI sequences", () => {
    expect(parseAnsi("a\x1b[2Kb\x1b[1Ac").clean).toBe("abc");
  });

  it("keeps color running across unstyled escape boundaries", () => {
    const { clean, spans } = parseAnsi("\x1b[33mwarn: disk\x1b[39m ok");
    expect(clean).toBe("warn: disk ok");
    expect(spans).toEqual([{ start: 0, end: 10, cls: "ansi-33" }]);
  });
});
