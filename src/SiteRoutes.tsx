import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import App from "./App";

const ClassicApp = lazy(() => import("./ClassicApp"));
const Admin = lazy(() => import("./Admin"));

export function SiteRoutes() {
  return (
    <Suspense
      fallback={
        <p className="p-8" role="status">
          Loading…
        </p>
      }
    >
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/classic" element={<ClassicApp />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Suspense>
  );
}
