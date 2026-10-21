import { WayfindingApiError } from './api';
import { RosterApiError } from './rosterApi';

/** Only status selects public copy. Never interpolate server/provider/error.message text. */
export function publicWayfindingError(error: unknown, mode: 'rooms' | 'lookup' | 'legacy'): string {
  const status = error instanceof WayfindingApiError || error instanceof RosterApiError ? error.status : 0;
  if (status === 429) return mode === 'lookup' ? 'lookup.rateLimited' : 'legacy.rateLimited';
  if (mode === 'lookup') {
    if (status === 404 || status === 422) return 'lookup.notFound';
    if (status === 503) return 'lookup.unavailable';
  }
  if (mode === 'legacy') {
    if (status === 403) return 'legacy.notFound';
    if (status === 422) return 'legacy.invalid';
    if (status === 503) return 'lookup.legacyUnavailable';
  }
  return `${mode}.error`;
}
