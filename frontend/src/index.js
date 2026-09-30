import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import "./index.css";
import App from "./App";
import { registerServiceWorker } from "./serviceWorkerRegistration";
import { initErrorReporting } from "./lib/errorReporting";

// Before anything renders, so start-up crashes are reported too (only when a DSN is configured).
initErrorReporting();

const AXIOS_UNWRAP_INTERCEPTOR_KEY = "__cashflowLiteAxiosUnwrapInterceptorInstalled";

if (!globalThis[AXIOS_UNWRAP_INTERCEPTOR_KEY]) {
  axios.interceptors.response.use((response) => {
    const payload = response?.data;
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      Object.prototype.hasOwnProperty.call(payload, "data") &&
      Object.prototype.hasOwnProperty.call(payload, "success")
    ) {
      response.data = payload.data;
    }
    return response;
  });

  globalThis[AXIOS_UNWRAP_INTERCEPTOR_KEY] = true;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

// Lets the till reopen and keep billing without a connection (production builds only).
registerServiceWorker();
