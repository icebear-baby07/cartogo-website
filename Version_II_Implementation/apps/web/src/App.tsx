import { useEffect, useState } from "react";
import { ApiHealthSchema, ApiReadinessSchema } from "@cartogo/contracts";

export default function App() {
  const [apiStatus, setApiStatus] = useState("Checking API...");
  const [mongoStatus, setMongoStatus] = useState("Checking MongoDB...");

  useEffect(() => {
    let active = true;

    fetch("/api/health")
      .then(async (response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return ApiHealthSchema.parse(await response.json());
      })
      .then((health) => {
        if (active) setApiStatus(`${health.service}: ${health.status}`);
      })
      .catch(() => {
        if (active) setApiStatus("API unavailable");
      });

    fetch("/api/health/ready")
      .then(async (response) => ApiReadinessSchema.parse(await response.json()))
      .then((readiness) => {
        if (active) {
          setMongoStatus(
            readiness.dependencies.mongodb === "ok"
              ? "MongoDB: connected"
              : "MongoDB: unavailable",
          );
        }
      })
      .catch(() => {
        if (active) setMongoStatus("MongoDB: status unavailable");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="page">
      <section className="card" aria-labelledby="page-title">
        <p className="eyebrow">Isolated migration workspace</p>
        <h1 id="page-title">carTOGO Version II</h1>
        <p>
          React and TypeScript frontend, with an Express API. The official
          Cartogo application remains unchanged.
        </p>
        <output className="api-status" aria-live="polite">
          {apiStatus}
        </output>
        <output className="api-status" aria-live="polite">
          {mongoStatus}
        </output>
      </section>
    </main>
  );
}
