import { createContext, useContext } from "react";
import type { StaffCapability, StaffSession } from "./model";

export interface StaffContextValue {
  session: StaffSession | null;
  status: "loading" | "ready" | "error";
  busy: boolean;
  connected?: boolean;
  lastChecked?: number | null;
  error: string | null;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  demoLogin: (accountId: string) => Promise<boolean>;
  googleLogin: (credential: string) => Promise<boolean>;
  logout: () => Promise<boolean>;
  can: (capability: StaffCapability) => boolean;
  /** Same-origin fetch with cookies/CSRF; 12s timeout, 90s for public publication writes. */
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

export const StaffContext = createContext<StaffContextValue | null>(null);

export function useStaff(): StaffContextValue {
  const value = useContext(StaffContext);
  if (!value) throw new Error("useStaff must be used inside StaffProvider");
  return value;
}
