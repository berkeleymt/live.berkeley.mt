import type { SearchResult, WayfindingContent } from './types';

export class WayfindingApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type WayfindingTransport = (path: string, init?: RequestInit) => Promise<Response>;
/** One user-triggered request, finite timeout, no retry/queue of private credentials. */
export async function wayfindingRequest<T>(path: string, init: RequestInit = {}, transport: WayfindingTransport = fetch): Promise<T> {
  const timeout = AbortSignal.timeout(12_000);
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await transport(`/api/wayfinding${path}`, {
    ...init, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer',
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    headers,
  });
  if (!response.ok) {
    let message = response.status === 401 ? 'Sign in to the staff workspace and try again.'
      : response.status === 429 ? 'Too many attempts. Wait 10 minutes, or ask the BMT help desk.'
      : response.status === 409 ? 'Directions changed. Keep your draft and load the latest version before saving again.'
      : 'The request could not be completed. Please try again or ask the BMT help desk.';
    // Only our structured, bounded validation messages; never show upstream/HTML errors.
    if ([403, 409, 422].includes(response.status)) {
      const value: unknown = await response.json().catch(() => null);
      if (value && typeof value === 'object') {
        const detail = 'message' in value ? value.message : 'error' in value ? value.error : null;
        if (typeof detail === 'string' && detail.length < 1500) message = detail;
      }
    }
    throw new WayfindingApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}
export function requestMessage(error: unknown): string {
  return error instanceof WayfindingApiError ? error.message : 'The request could not be confirmed. Check your connection and try again. If you were saving, load the latest version first.';
}
export function searchRooms(content: WayfindingContent, query: string): SearchResult[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (value: string) => words.every(word => value.toLocaleLowerCase().includes(word));
  const results: SearchResult[] = [];
  for (const building of content.buildings) {
    const buildingText = [building.name, ...building.aliases].join(' ');
    if (matches(buildingText)) results.push({ building });
    if (!words.length) continue;
    for (const floor of building.floors) {
      if (matches(`${buildingText} ${floor.name}`)) results.push({ building, floor });
      for (const room of floor.rooms) {
        if (matches(`${buildingText} ${floor.name} ${room.code} ${room.name}`)) results.push({ building, floor, room });
      }
    }
  }
  return results.slice(0, 100);
}
export function findRoom(content: WayfindingContent, roomId: string): SearchResult | undefined {
  for (const building of content.buildings) for (const floor of building.floors) {
    const room = floor.rooms.find(candidate => candidate.id === roomId);
    if (room) return { building, floor, room };
  }
}
export function resultKey(result: SearchResult): string { return result.room?.id ?? result.floor?.id ?? result.building.id; }
export function safeImageUrl(value: string): boolean {
  if (/^\/(demo-maps|media)\/[a-zA-Z0-9/_.-]+$/.test(value) && !value.includes('..')) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
