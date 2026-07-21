import { createElement, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "../ui/Icon";

// Parse "v1.0.0-alpha.2" -> { nums: [1,0,0], pre: "alpha.2" }
function parse(v: string): { nums: number[]; pre: string } {
  const [core, pre = ""] = v.replace(/^v/, "").split("-");
  const nums = core.split(".").map((n) => parseInt(n, 10) || 0);
  return { nums, pre };
}

// Compare prerelease per semver: no-prerelease > prerelease; dot fields,
// numeric fields numerically. Returns -1 | 0 | 1.
function cmpPre(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const as = a.split("."), bs = b.split(".");
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i], y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { const d = +x - +y; if (d) return d < 0 ? -1 : 1; }
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < 3; i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return cmpPre(a.pre, b.pre) > 0;
}

// Fetch latest GitHub release once on mount; if newer than the built version,
// render a download icon next to the version. Offline/error -> render nothing.
export function UpdateBadge({ repo }: { repo: string }) {
  const [rel, setRel] = useState<{ version: string; url: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.tag_name) return;
        const version = String(d.tag_name).replace(/^v/, "");
        if (isNewer(version, __APP_VERSION__)) setRel({ version, url: d.html_url });
      })
      .catch(() => {}); // ponytail: offline is not an error worth surfacing
    return () => { alive = false; };
  }, [repo]);

  if (!rel) return null;
  return createElement(
    "span",
    {
      style: { cursor: "pointer", display: "inline-flex", alignItems: "center", color: "var(--accent)" },
      title: `v${rel.version} available — download`,
      onClick: () => openUrl(rel.url),
    },
    createElement(Icon, { name: "download", size: 13 }),
  );
}
