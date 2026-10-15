import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import "@fontsource-variable/ibm-plex-sans";
import "./index.css";
import { SiteRoutes } from "./SiteRoutes.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SiteRoutes />
      <Toaster position="bottom-center" richColors />
    </BrowserRouter>
  </StrictMode>,
);
