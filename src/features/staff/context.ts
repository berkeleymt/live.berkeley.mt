import { createContext, useContext } from "react";
import type { StaffCapability, StaffSession } from "./model";

export interface StaffContextValue {
  session: StaffSession | null;
  status: "loading" | "ready" | "error";
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  demoLogin: (accountId: string) => Promise<boolean>;
  logout: () => Promise<boolean>;
  can: (capability: StaffCapability) => boolean;
  /** Same-origin fetch with session cookies, CSRF token and a 12-second timeout. */
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

export const StaffContext = createContext<StaffContextValue | null>(null);

export function useStaff(): StaffContextValue {
  const value = useContext(StaffContext);
  if (!value) throw new Error("useStaff must be used inside StaffProvider");
  return value;
}
