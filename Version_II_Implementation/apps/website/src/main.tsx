import React from "react";
import ReactDOM from "react-dom/client";
import AdminSignIn from "./AdminSignIn";
import App from "./App";
import "./style.css";

function VersionTwoApp() {
  return window.location.pathname === "/admin" ? <AdminSignIn /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VersionTwoApp />
  </React.StrictMode>,
);
