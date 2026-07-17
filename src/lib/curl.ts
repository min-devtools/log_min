/** extract URL + headers from a pasted curl command (null if it isn't one) */
export function parseCurl(text: string): { url: string; headers: Record<string, string> } | null {
  if (!/^\s*curl\s/.test(text)) return null;
  const joined = text.replace(/\\\r?\n/g, " ");
  const args: string[] = [];
  const re = /'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g;
  for (let m = re.exec(joined); m; m = re.exec(joined)) {
    args.push(m[1] ?? (m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3]));
  }
  // value-taking flags we ignore — skip their value so it isn't mistaken for the URL
  const skipValue = new Set([
    "-X", "--request", "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode",
    "-o", "--output", "-e", "--referer", "-m", "--max-time",
    "--connect-timeout", "--retry", "-F", "--form",
  ]);
  let url = "";
  const headers: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "-H" || a === "--header") {
      const h = args[++i] ?? "";
      const colon = h.indexOf(":");
      if (colon > 0) headers[h.slice(0, colon).trim()] = h.slice(colon + 1).trim();
    } else if (a === "--url") {
      url = args[++i] ?? "";
    } else if (a === "-A" || a === "--user-agent") {
      headers["User-Agent"] = args[++i] ?? "";
    } else if (a === "-u" || a === "--user") {
      headers["Authorization"] = `Basic ${btoa(args[++i] ?? "")}`;
    } else if (a === "-b" || a === "--cookie") {
      // curl: value with '=' is a cookie string, without is a cookie-jar filename (skip)
      const c = args[++i] ?? "";
      if (c.includes("=")) headers["Cookie"] = headers["Cookie"] ? `${headers["Cookie"]}; ${c}` : c;
    } else if (skipValue.has(a)) {
      i++;
    } else if (!a.startsWith("-") && !url) {
      url = a;
    }
  }
  return /^https?:\/\//.test(url) ? { url, headers } : null;
}
