import { describe, expect, it } from "vitest";
import { jsonFields, jsonContainerPaths, filterJsonFields, findMarks } from "./jsonTree";

describe("jsonTree helpers", () => {
  const sample = {
    id: 1,
    user: { name: "Alice", tags: ["admin", "beta"] },
    active: true,
  };

  it("flattens a JSON value into fields", () => {
    const fields = jsonFields(sample);
    expect(fields.length).toBeGreaterThan(1);
    expect(fields.some((f) => f.path === "$.user.name")).toBe(true);
    expect(fields.some((f) => f.path === "$.user.tags[0]")).toBe(true);
  });

  it("lists container paths", () => {
    const paths = jsonContainerPaths(sample);
    expect(paths).toEqual(["$", "$.user", "$.user.tags"]);
  });

  it("filters fields by query", () => {
    const fields = jsonFields(sample);
    const filtered = filterJsonFields(fields, "alice");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe("$.user.name");
  });

  it("finds case-insensitive marks", () => {
    const marks = findMarks("Hello world", "l");
    expect(marks).toEqual([[2, 3], [3, 4], [9, 10]]);
  });

  it("finds case-sensitive marks when asked", () => {
    expect(findMarks("Hello world", "H", true)).toEqual([[0, 1]]);
    expect(findMarks("Hello world", "h", true)).toEqual([]);
  });
});
