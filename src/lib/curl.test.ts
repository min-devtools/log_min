import { describe, expect, it } from "vitest";
import { parseCurl } from "./curl";

describe("parseCurl", () => {
  it("ignores non-curl text", () => {
    expect(parseCurl("https://host/log")).toBeNull();
    expect(parseCurl("curly text")).toBeNull();
  });

  it("extracts url and -H headers", () => {
    const parsed = parseCurl(
      `curl -H 'Authorization: Bearer abc' -H "X-Env: prod" https://host/app.log`,
    );
    expect(parsed).toEqual({
      url: "https://host/app.log",
      headers: { Authorization: "Bearer abc", "X-Env": "prod" },
    });
  });

  it("handles line continuations, --url, -X and data flags", () => {
    const parsed = parseCurl(
      "curl -X GET \\\n  --url 'https://h/x.log?token=1' \\\n  --data-raw '{\"a\":1}' \\\n  --header 'Accept: text/plain'",
    );
    expect(parsed).toEqual({
      url: "https://h/x.log?token=1",
      headers: { Accept: "text/plain" },
    });
  });

  it("maps -b to Cookie header, skips cookie-jar filenames", () => {
    expect(parseCurl("curl -b 'a=1; b=2' --cookie 'c=3' https://h/l.log")?.headers.Cookie).toBe(
      "a=1; b=2; c=3",
    );
    expect(parseCurl("curl -b cookies.txt https://h/l.log")?.headers.Cookie).toBeUndefined();
  });

  it("maps -u to basic auth and rejects non-http urls", () => {
    expect(parseCurl("curl -u me:pw https://h/l.log")?.headers.Authorization).toBe(
      `Basic ${btoa("me:pw")}`,
    );
    expect(parseCurl("curl ftp://h/l.log")).toBeNull();
  });
});
