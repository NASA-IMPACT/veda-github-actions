import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TzProvider } from "./TzContext";
import { ChangesProvider } from "./ChangesContext";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TzProvider>
      <ChangesProvider>
        <App />
      </ChangesProvider>
    </TzProvider>
  </React.StrictMode>,
);
