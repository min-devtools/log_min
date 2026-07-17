import { describe, expect, it } from "vitest";
import { LiveFilter } from "./liveFilter";
import { Ring } from "./ring";
import type { LogLevel, LogLine } from "./types";

const mk = (raw: string, level?: LogLevel): LogLine => ({ seq: 0, raw, stream: "out", level });
const opts = (query: string, levels: LogLevel[] = []) => ({
  query,
  caseSensitive: false,
  regex: false,
  levels: new Set(levels),
});

describe("LiveFilter", () => {
  it("filters by text and appends incrementally per batch", () => {
    const ring = new Ring();
    const f = new LiveFilter();
    ring.push([mk("alpha"), mk("beta"), mk("alpha two")]);
    expect(f.update(ring, opts("alpha"))).toEqual([0, 2]);
    ring.push([mk("gamma"), mk("ALPHA THREE")]);
    expect(f.update(ring, opts("alpha"))).toEqual([0, 2, 4]);
  });

  it("rescans when options change", () => {
    const ring = new Ring();
    const f = new LiveFilter();
    ring.push([mk("a", "err"), mk("b", "warn"), mk("c", "err")]);
    expect(f.update(ring, opts("", ["err"]))).toEqual([0, 2]);
    expect(f.update(ring, opts("", ["warn"]))).toEqual([1]);
    expect(f.update(ring, opts("b", ["warn"]))).toEqual([1]);
  });

  it("prunes matches evicted from the ring", () => {
    const ring = new Ring();
    ring.setCap(100);
    const f = new LiveFilter();
    ring.push(Array.from({ length: 100 }, (_, i) => mk(i === 0 ? "hit early" : `line ${i}`)));
    expect(f.update(ring, opts("hit"))).toEqual([0]);
    // overflow the cap so seq 0 is evicted
    ring.push(Array.from({ length: 60 }, () => mk("noise")));
    ring.push([mk("hit late")]);
    const idxs = f.update(ring, opts("hit"));
    expect(idxs).toHaveLength(1);
    expect(ring.at(idxs[0])?.raw).toBe("hit late");
  });

  it("recovers after the buffer is cleared", () => {
    const ring = new Ring();
    const f = new LiveFilter();
    ring.push([mk("hit"), mk("miss")]);
    expect(f.update(ring, opts("hit"))).toEqual([0]);
    ring.clear();
    f.reset(); // seqs restart — a same-size refill is otherwise undetectable
    ring.push([mk("nothing"), mk("hit again")]);
    expect(f.update(ring, opts("hit"))).toEqual([1]);
  });

  it("matches nothing on an invalid regex", () => {
    const ring = new Ring();
    const f = new LiveFilter();
    ring.push([mk("hit")]);
    expect(f.update(ring, { query: "(", caseSensitive: false, regex: true, levels: new Set() })).toEqual([]);
  });
});
