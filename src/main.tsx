import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initPersistence } from "./lib/persist";
import { initLogEvents } from "./lib/logmin";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/views.css";

void initPersistence();
void initLogEvents();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
