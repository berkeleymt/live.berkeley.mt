import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StaffContext } from "./context";
import { useLocation } from "react-router-dom";
import { canStaff, type StaffSession } from "./model";

export function StaffProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const onStaffPage = pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/staff/sign-in';
  const [connected, setConnected] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
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
    // Public bundle mutations can include fetch, push and remote confirmation.
    // All requests remain bounded; no mutation is automatically retried.
    const publicMutation = init.method && init.method !== 'GET' && /^\/api\/(publishing|content|site|schedule|delays|announcements|wayfinding\/editor|pages\/editor)(\/|$)/.test(path);
    // A roster sync can perform three sequential 20-second provider reads.
    // Do not truncate rosterRequest's 70-second budget when transports compose.
    const rosterSync = path === '/api/roster/sync' && init.method === 'POST';
    const timeout = AbortSignal.timeout(publicMutation ? 90_000 : rosterSync ? 70_000 : 12_000);
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
    if (response.status === 401 && sessionRef.current?.user && !path.endsWith('-login') && path !== '/api/staff/login') {
      setError('Your session ended or your access was removed. Sign in again or ask a Super admin.');
      const anonymous = { ...sessionRef.current, user: null, csrfToken: null, expiresAt: null };
      sessionRef.current = anonymous;
      setSession(anonymous);
    }
    return response;
  }, []);

  const perform = useCallback(async (path: string, body?: object, background = false): Promise<boolean> => {
    // No automatic retries for credentials or mutations. Double presses cannot overlap.
    if (inFlight.current) {
      if (!background) setError('Staff access is already checking a request. Try again in a moment.');
      return false;
    }
    inFlight.current = true;
    if (!background) { setBusy(true); setError(null); }
    try {
      const response = await request(path, body === undefined ? { headers: document.visibilityState === 'visible' && window.location.pathname.startsWith('/admin') ? { 'X-Staff-Presence': '1' } : {} } : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The request was not accepted. Try again.");
      if (typeof data.demoMode !== "boolean" || !Array.isArray(data.demoAccounts)) throw new Error("Staff access is not available on this server yet. Ask an administrator to check the deployment.");
      if (sessionRef.current?.user && !data.user && path !== '/api/staff/logout') setError('Your session ended or your access was removed. Sign in again or ask a Super admin.');
      else if (background) setError(previous => previous?.startsWith('Could not reach staff access.') ? null : previous);
      setConnected(true);
      setLastChecked(Date.now());
      sessionRef.current = data as StaffSession;
      setSession(data as StaffSession);
      setStatus("ready");
      return true;
    } catch (cause) {
      if (body === undefined) setConnected(false);
      setError(cause instanceof Error && cause.name !== "TimeoutError" && cause.name !== "TypeError" && cause.name !== "SyntaxError"
        ? cause.message
        : "Could not reach staff access. Check your connection, then try again.");
      if (!sessionRef.current) setStatus("error");
      return false;
    } finally {
      inFlight.current = false;
      if (!background) setBusy(false);
    }
  }, [request]);

  const refresh = useCallback(async () => { await perform("/api/staff/session"); }, [perform]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      // One auth request in flight, no background presence; retry only reads, never credentials.
      if (!onStaffPage || document.visibilityState === 'visible') {
        const ok = await perform('/api/staff/session', undefined, true);
        failures = ok ? 0 : Math.min(failures + 1, 6);
      }
      if (!stopped && onStaffPage) timer = setTimeout(() => void poll(), failures ? Math.random() * Math.min(60_000, 1000 * 2 ** failures) : 5000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [perform, onStaffPage]);

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
    session, status, busy, error, refresh, request, connected, lastChecked,
    googleLogin: useCallback((credential: string) => perform('/api/staff/google-login', { credential }), [perform]),
    login: (username, password) => perform("/api/staff/login", { username, password }),
    demoLogin: (accountId) => perform("/api/staff/demo", { accountId }),
    logout: () => perform("/api/staff/logout", {}),
    can: (capability) => canStaff(session?.user, capability),
  }}>{children}</StaffContext.Provider>;
}
