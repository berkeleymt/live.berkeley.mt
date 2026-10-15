import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StaffContext } from "./context";
import { canStaff, type StaffSession } from "./model";

export function StaffProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StaffSession | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sessionRef = useRef<StaffSession | null>(null);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!path.startsWith("/api/") || /[\\\r\n]/.test(path)) throw new Error("Staff requests must use a same-origin /api/ path.");
    const headers = new Headers(init.headers);
    headers.set("X-Staff-Request", "1");
    const csrf = sessionRef.current?.csrfToken;
    if (csrf) headers.set("X-Staff-CSRF", csrf);
    const timeout = AbortSignal.timeout(12_000);
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
    if (response.status === 401 && sessionRef.current) {
      const anonymous = { ...sessionRef.current, user: null, csrfToken: null, expiresAt: null };
      sessionRef.current = anonymous;
      setSession(anonymous);
    }
    return response;
  }, []);

  const perform = useCallback(async (path: string, body?: object): Promise<boolean> => {
    // No automatic retries for credentials or mutations. Double presses cannot overlap.
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await request(path, body === undefined ? undefined : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The request was not accepted. Try again.");
      if (typeof data.demoMode !== "boolean" || !Array.isArray(data.demoAccounts)) throw new Error("Staff access is not available on this server yet. Ask an administrator to check the deployment.");
      sessionRef.current = data as StaffSession;
      setSession(data as StaffSession);
      setStatus("ready");
      return true;
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TimeoutError" && cause.name !== "TypeError" && cause.name !== "SyntaxError"
        ? cause.message
        : "Could not reach staff access. Check your connection, then try again.");
      if (!sessionRef.current) setStatus("error");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [request]);

  const refresh = useCallback(async () => { await perform("/api/staff/session"); }, [perform]);
  useEffect(() => { void refresh(); }, [refresh]);

  // A closed or idle tab must not keep displaying a valid session after its fixed expiry.
  useEffect(() => {
    if (!session?.expiresAt) return;
    const remaining = Math.max(0, session.expiresAt * 1000 - Date.now());
    const timer = window.setTimeout(() => {
      const previous = sessionRef.current;
      if (previous?.expiresAt === session.expiresAt) {
        const anonymous = { ...previous, user: null, csrfToken: null, expiresAt: null };
        sessionRef.current = anonymous;
        setSession(anonymous);
        setError("Your staff session ended. Sign in again to continue.");
      }
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [session?.expiresAt]);

  return <StaffContext.Provider value={{
    session, status, busy, error, refresh, request,
    login: (username, password) => perform("/api/staff/login", { username, password }),
    demoLogin: (accountId) => perform("/api/staff/demo", { accountId }),
    logout: () => perform("/api/staff/logout", {}),
    can: (capability) => canStaff(session?.user, capability),
  }}>{children}</StaffContext.Provider>;
}
