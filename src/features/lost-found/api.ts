import type { LostFoundReport } from "./types";

const API = import.meta.env.VITE_API_URL?.replace(/\/live\/?$/, "") || "/api";
export class LostFoundRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function lostFoundRequest<T>(path: string, init: RequestInit = {}, transport: (path: string, init?: RequestInit) => Promise<Response> = fetch): Promise<T> {
  const response = await transport(`${API}/lost-found${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const safeErrors: Record<number, string> = {
      401: "Sign in to the staff workspace, then try again.",
      403: "Your account does not have permission for this action.",
      404: "This report could not be found. Refresh the inbox.",
      409: "The report changed or this request key was already used. Refresh before saving again; copy any notes you want to keep.",
      413: "This report is too large. Shorten the description or notes and try again.",
      422: "Check the fields and their length limits, then try again. A usable contact email is required.",
      429: "Too many reports or requests. Wait 30 minutes, or ask a volunteer for help.",
    };
    throw new LostFoundRequestError(safeErrors[response.status] || "The inbox is temporarily unavailable. Please try again.", response.status);
  }
  return response.json() as Promise<T>;
}
export function contactHref(report: Pick<LostFoundReport, "email" | "receipt">): string {
  return `mailto:${encodeURIComponent(report.email)}?subject=${encodeURIComponent(`BMT lost-and-found — receipt ${report.receipt}`)}`;
}
export function requestMessage(error: unknown, fallback: string): string {
  return error instanceof LostFoundRequestError ? error.message : fallback;
}
