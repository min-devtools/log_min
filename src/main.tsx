import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initPersistence } from "./lib/persist";
import { initLogEvents, initOpenedFileEvents } from "./lib/logmin";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/views.css";

async function initRuntime(): Promise<void> {
  // Open-With files must land after persisted sources are restored, otherwise
  // the store load could overwrite the new transient source.
  await initPersistence();
  await Promise.all([initLogEvents(), initOpenedFileEvents()]);
}

void initRuntime().catch((err) => console.error("runtime init failed", err));

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 24 }}>
        <div style={{ display: "grid", gap: 12, maxWidth: 560, textAlign: "center" }}>
          <strong>Something broke in the UI.</strong>
          <pre style={{ textAlign: "left", whiteSpace: "pre-wrap", userSelect: "text", font: "0.85rem/1.5 var(--font-mono)", color: "var(--red)" }}>
            {String(this.state.error)}
          </pre>
          <button className="tool-btn" style={{ justifySelf: "center" }} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
