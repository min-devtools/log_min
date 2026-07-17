import { useEffect } from "react";
import Editor from "@monaco-editor/react";
import { MONACO_THEME, retintMonaco } from "../lib/monaco";
import { useApp } from "../store";

/** Read-only Monaco JSON viewer (folding, search, selection).
 * Default export so React.lazy can code-split Monaco out of the main bundle. */
export default function JsonEditor({ value }: { value: string }) {
  const theme = useApp((s) => s.theme);
  // re-read the CSS vars after the app theme's stylesheet swap lands
  useEffect(() => {
    const raf = requestAnimationFrame(retintMonaco);
    return () => cancelAnimationFrame(raf);
  }, [theme]);
  return (
    <Editor
      language="json"
      theme={MONACO_THEME}
      value={value}
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        fontSize: 12,
        lineHeight: 20,
        fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        lineNumbers: "off",
        glyphMargin: false,
        folding: true,
        stickyScroll: { enabled: false },
        lineDecorationsWidth: 6,
        renderLineHighlight: "none",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        padding: { top: 8 },
        wordWrap: "off",
        contextmenu: false,
        occurrencesHighlight: "off",
      }}
    />
  );
}
