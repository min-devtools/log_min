import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { useState } from "react";
import { useApp } from "../../store";
import { useFonts } from "../../lib/useFonts";
import { THEMES, themeBase } from "../../lib/themes";
import { FONT_SIZE_STEP } from "../../lib/fontScale";
import { EDITOR_LABELS, loadEditorApp, saveEditorApp, type EditorApp } from "../../lib/editor";

export function SettingsView({ active }: { active: boolean }) {
  const theme = useApp((s) => s.theme);
  const compact = useApp((s) => s.compact);
  const uiFontSize = useApp((s) => s.uiFontSize);
  const uiFont = useApp((s) => s.uiFont);
  const editorFont = useApp((s) => s.editorFont);
  const { setTheme, toggleCompact, setUiFontSize, setUiFont, setEditorFont } = useApp.getState();
  const fontList = useFonts();
  const [editorApp, setEditorApp] = useState<EditorApp>(loadEditorApp);

  return (
    <section className={`content settings-view ${active ? "active" : ""}`}>
      <div className="settings-shell">
        <div className="settings-header">
          <h2>Settings</h2>
          <p style={{ margin: 0, color: "var(--text-3)", fontSize: "0.9231rem" }}>Appearance, fonts and keyboard shortcuts for this workspace.</p>
        </div>

        <section className="settings-card">
          <h3>Appearance</h3>
          <div className="settings-row">
            <span className="settings-icon"><Icon name={themeBase(theme) === "dark" ? "moon" : "sun"} size={15} /></span>
            <div className="settings-copy"><strong>Theme</strong><span>Palette applies across the workspace and payload views.</span></div>
            <div className="settings-control">
              <select className="settings-select" value={theme} onChange={(event) => setTheme(event.target.value)}><optgroup label="Dark">{THEMES.filter((item) => item.base === "dark").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup><optgroup label="Light">{THEMES.filter((item) => item.base === "light").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup></select>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="braces" size={15} /></span>
            <div className="settings-copy"><strong>Interface font size</strong><span>Scales all interface text in 0.5px steps. Current: {uiFontSize}px.</span></div>
            <div className="settings-control" style={{ gap: 6 }}>
              <ToolButton iconOnly title="Decrease interface font (⌘−)" onClick={() => setUiFontSize(uiFontSize - FONT_SIZE_STEP)}>−</ToolButton>
              <ToolButton onClick={() => setUiFontSize(0)}>{uiFontSize}px</ToolButton>
              <ToolButton iconOnly title="Increase interface font (⌘+)" onClick={() => setUiFontSize(uiFontSize + FONT_SIZE_STEP)}>+</ToolButton>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="rows" size={15} /></span>
            <div className="settings-copy"><strong>Interface font family</strong><span>Applied across the workspace and saved on this device.</span></div>
            <div className="settings-control"><select className="settings-select" value={uiFont} style={uiFont ? { fontFamily: `"${uiFont}"` } : undefined} onChange={(event) => setUiFont(event.target.value)}><option value="">Design default</option>{fontList.map((font) => <option key={font} value={font} style={{ fontFamily: `"${font}"` }}>{font}</option>)}</select></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="braces" size={15} /></span>
            <div className="settings-copy"><strong>Log font family</strong><span>Applied to log lines and stack traces.</span></div>
            <div className="settings-control"><select className="settings-select" value={editorFont} style={editorFont ? { fontFamily: `"${editorFont}"` } : undefined} onChange={(event) => setEditorFont(event.target.value)}><option value="">Design default</option>{fontList.map((font) => <option key={font} value={font} style={{ fontFamily: `"${font}"` }}>{font}</option>)}</select></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="rows" size={15} /></span>
            <div className="settings-copy"><strong>Compact density</strong><span>Tighter table rows and narrower side panels.</span></div>
            <div className="settings-control"><label className="switch"><input type="checkbox" checked={compact} onChange={toggleCompact} /><span /></label></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="code" size={15} /></span>
            <div className="settings-copy"><strong>Open stack frames in</strong><span>Clicking a file:line in a stack trace opens it here. ⌥click always copies the path.</span></div>
            <div className="settings-control">
              <select
                className="settings-select"
                value={editorApp}
                onChange={(event) => {
                  const app = event.target.value as EditorApp;
                  saveEditorApp(app);
                  setEditorApp(app);
                }}
              >
                {Object.entries(EDITOR_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <h3>Shortcuts</h3>
          <div className="shortcut-grid">
            <div className="shortcut-row"><span>Command palette</span><span className="kbd">⌘K</span></div>
            <div className="shortcut-row"><span>New source</span><span className="kbd">⌘N</span></div>
            <div className="shortcut-row"><span>Toggle follow</span><span className="kbd">⌘↵</span></div>
            <div className="shortcut-row"><span>Find in buffer</span><span className="kbd">⌘F</span></div>
            <div className="shortcut-row"><span>Next / prev error</span><span className="kbd">F8 / ⇧F8</span></div>
            <div className="shortcut-row"><span>Clear buffer</span><span className="kbd">⌃L</span></div>
            <div className="shortcut-row"><span>Copy selected lines</span><span className="kbd">⌘C</span></div>
            <div className="shortcut-row"><span>Toggle sidebar</span><span className="kbd">⌘B</span></div>
            <div className="shortcut-row"><span>Toggle right panel</span><span className="kbd">⌘R</span></div>
            <div className="shortcut-row"><span>Close tab</span><span className="kbd">⌘W</span></div>
            <div className="shortcut-row"><span>Switch tab 1…9</span><span className="kbd">⌘1…9</span></div>
            <div className="shortcut-row"><span>Increase font</span><span className="kbd">⌘+</span></div>
            <div className="shortcut-row"><span>Decrease font</span><span className="kbd">⌘−</span></div>
            <div className="shortcut-row"><span>Open settings</span><span className="kbd">⌘,</span></div>
          </div>
        </section>

        <section className="settings-card">
          <h3>Data</h3>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="database" size={15} /></span>
            <div className="settings-copy"><strong>Sources</strong><span>Stored in Tauri app-data (log.json). Right-click a source in the sidebar to edit or remove it. Log lines live in memory only — 200 000 per source, oldest evicted first.</span></div>
            <div className="settings-control" />
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="check" size={15} /></span>
            <div className="settings-copy"><strong>Nothing auto-runs</strong><span>Saved commands are restored on launch but never started automatically — press ▶ when you mean it.</span></div>
            <div className="settings-control" />
          </div>
        </section>

        <div className="settings-credit">
          <button
            type="button"
            className="settings-github"
            onClick={() => openUrl("https://github.com/min-devtools/log_min")}
          >
            <Icon name="github" size={15} /> View on GitHub
          </button>
          <strong>LogMin</strong>
          <button
            type="button"
            className="settings-credit-link"
            onClick={() => openUrl("https://www.linkedin.com/in/ngthminh-dev/")}
          >
            Created by @ngthminhdev
          </button>
        </div>
      </div>
    </section>
  );
}
