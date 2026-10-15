export class SiteApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = 'SiteApiError'; this.status = status; }
}

/** Same-origin only. Staff Basic/session credentials are managed by sign-in, never stored by this module. */
export async function siteRequest(path: string, options: RequestInit = {}, transport: (path: string, init?: RequestInit) => Promise<Response> = fetch): Promise<unknown> {
  const response = await transport(path, {
    ...options, credentials: 'same-origin', cache: 'no-store',
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: { ...options.headers, ...(options.method && options.method !== 'GET' ? { 'X-Site-Editor': '1' } : {}) },
  });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 2000);
    throw new SiteApiError(response.status, message || `Request failed (${response.status}).`);
  }
  return response.json();
}
