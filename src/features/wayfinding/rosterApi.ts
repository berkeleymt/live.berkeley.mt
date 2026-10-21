import type { WayfindingTransport } from './api';
export interface RosterMapping { idColumn: string; fields: Record<string, string>; roomColumns: Record<string, string>; roomAliases: Record<string, string> }
export interface RosterStatus { revision: number; mode: string; configured: boolean; syncing: boolean; autoSync: boolean; stale: boolean; eventMatches: boolean; count: number; checkedAt: number | null; syncedAt: number | null; attemptedAt: number | null; nextAttempt: number; error: string | null; notes: string[]; columns: string[]; mapping: RosterMapping; missingIds: number; ambiguousIds: number; unmatchedRooms: string[]; unmatchedRoomCount: number; missingColumns: string[]; rows: Record<string,string>[]; offset: number; schedule: {id: string; title: string}[] }
export interface ProviderSettings { enabled: boolean; demo: boolean; revision: number; eventId: string; tokenConfigured: boolean; autoSync: boolean; autoAllowed: boolean }
export interface RoomLookupStatus { mode: 'demo' | 'contestdojo' | 'legacy' | 'unavailable'; available: boolean; checkedAt: number | null; stale: boolean; demoId: string | null }
export interface PublicAssignments { assignments: {scheduleId: string; round: string; startTime: string; endTime: string; roomId: string | null; status: 'matched' | 'unmatched'}[]; checkedAt: number | null; stale: boolean; demo: boolean }
export class RosterApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
/** In-memory POST only, bounded request, never retries private input automatically. */
export async function rosterRequest<T>(path: string, init: RequestInit = {}, transport: WayfindingTransport = fetch): Promise<T> {
  const timeout = AbortSignal.timeout(path.endsWith('/sync') ? 70_000 : 12_000);
  const response = await transport(`/api${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', ...init.headers }, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  if (!response.ok) {
    // Public lookup never consumes response messages; UI selects canonical copy by status.
    if (path.startsWith('/rooms/')) throw new RosterApiError(response.status, 'Room lookup could not be confirmed.');
    const value: unknown = await response.json().catch(() => null);
    const message = value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' && value.message.length < 1500 ? value.message : 'Request could not be confirmed. Refresh status before retrying.';
    throw new RosterApiError(response.status, response.status === 401 ? 'Sign in again to continue.' : message);
  }
  return response.json() as Promise<T>;
}
export const rosterMessage = (e: unknown) => e instanceof Error && e.name === 'Error' ? e.message : 'Request could not be confirmed. Check your connection, then refresh status.';
export const checkedTime = (t: number | null) => t ? new Date(t * 1000).toLocaleString() : 'Not yet checked';
