import React from "react";
import ReactDOM from "react-dom/client";
import AdminSignIn from "./Admin/AdminSignIn";
import App from "./Site/App";
import "./style.css";
import "./Site/legacy-style.css";
import "./Site/site-design-compat.css";
import "./Admin/legacy-admin.css";
import "./Admin/admin-design-compat.css";

function VersionTwoApp() {
  return window.location.pathname === "/admin" ? <AdminSignIn /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VersionTwoApp />
  </React.StrictMode>,
);
