import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import Settings from "./Settings";

const root = document.getElementById("root") as HTMLElement;
const isSettings = getCurrentWindow().label === "settings";

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {isSettings ? <Settings /> : <App />}
  </React.StrictMode>,
);
