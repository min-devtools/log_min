export interface AnsiSpan {
  start: number;
  end: number;
  cls: string;
}

const RE_CSI = /\x1b\[[0-9;]*[A-Za-z]/g; // eslint-disable-line no-control-regex

/**
 * Strip ANSI escape sequences and keep SGR colors as display spans over the
 * clean text. Handles 0 reset, 1/22 bold, 30–37/90–97 fg, 39 default.
 * ponytail: fg + bold only — bg, 256-color and truecolor render unstyled.
 */
export function parseAnsi(raw: string): { clean: string; spans: AnsiSpan[] } {
  let clean = "";
  const spans: AnsiSpan[] = [];
  let fg: number | null = null;
  let bold = false;
  let spanStart = 0;
  let last = 0;

  const closeSpan = () => {
    if ((fg !== null || bold) && clean.length > spanStart) {
      const cls = `${fg !== null ? `ansi-${fg}` : ""}${bold ? " ansi-bold" : ""}`.trim();
      spans.push({ start: spanStart, end: clean.length, cls });
    }
  };

  RE_CSI.lastIndex = 0;
  for (let m = RE_CSI.exec(raw); m; m = RE_CSI.exec(raw)) {
    clean += raw.slice(last, m.index);
    last = m.index + m[0].length;
    if (!m[0].endsWith("m")) continue; // cursor/erase sequences — strip only
    closeSpan();
    spanStart = clean.length;
    const params = m[0].slice(2, -1);
    const codes = params === "" ? [0] : params.split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) {
        fg = null;
        bold = false;
      } else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) fg = c;
      else if (c === 39) fg = null;
      else if (c === 38 || c === 48) {
        // extended color: 38;5;n or 38;2;r;g;b — consume args, render unstyled
        const skip = codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
        i += skip;
        if (c === 38) fg = null;
      }
    }
  }
  clean += raw.slice(last);
  closeSpan();
  return { clean, spans };
}
