import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RequestsProvider } from "./RequestsContext";
import "./styles.css";
import "./request.css";

// RequestsProvider wraps everything because the staged-requests cart lives in the header (App)
// while requests are added from inside the Submit tab — both need the same store.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RequestsProvider>
      <App />
    </RequestsProvider>
  </React.StrictMode>,
);
