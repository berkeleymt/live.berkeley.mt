import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useStaff } from '../staff';
import { LostFoundRequestError, lostFoundRequest, requestMessage } from './api';
import type { LostFoundReport, DeliveryState } from './types';

const labels: Record<DeliveryState, string> = {
  queued: 'Queued — not yet accepted', not_configured: 'Not configured — no email being sent',
  sending: 'Attempt in progress — acceptance not confirmed', retry_wait: 'Waiting for a limited retry',
  accepted: 'Provider accepted — inbox delivery unverified', failed: 'Not sent — staff follow-up needed',
  uncertain: 'Acceptance uncertain — do not resend without checking', handled: 'Manual follow-up recorded — not proof of delivery',
};
const diagnostics: Record<string, string> = {
  provider_accepted: 'Postmark acknowledged the message. This is not a delivery confirmation.',
  connection_failed: 'Connection failed before submission. A limited retry may be scheduled.',
  provider_rate_limited: 'The provider rate-limited this attempt.',
  provider_rejected: 'The provider rejected the request. Ask a Super admin to check sender configuration and provider activity.',
  transport_unknown: 'The connection timed out or failed after submission may have begun.',
  provider_result_unknown: 'The provider response does not establish whether the message was accepted.',
  invalid_acknowledgement: 'The provider did not return a usable acknowledgement.',
  interrupted_attempt: 'The server restarted during an attempt. The provider may have accepted it.',
  staff_action: 'Staff recorded an action; see the delivery history below.',
};
const when = (value: string | number) => new Date(value).toLocaleString(undefined, { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' Pacific';

export function LostFoundDelivery({ report, canWrite, configured, disabled, onSaved, onEditing }: {
  report: LostFoundReport; canWrite: boolean; configured: boolean; disabled: boolean;
  onSaved: (report: LostFoundReport) => void; onEditing: (editing: boolean) => void;
}) {
  const { request } = useStaff();
  const [note, setNote] = useState('');
  const [action, setAction] = useState('handled');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<string | null>(null);
  const inFlight = useRef(false);
  const delivery = report.delivery;
  useEffect(() => {
    onEditing(Boolean(note) || busy || uncertain);
    return () => onEditing(false);
  }, [note, busy, uncertain, onEditing]);
  useEffect(() => {
    if (!note && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [note, uncertain]);
  if (!delivery) return <section className="lf-mail"><h2>Confirmation email</h2><p>Not requested by this legacy report. No automatic email was queued. Use the contact draft for manual follow-up.</p></section>;
  const actionable = ['not_configured', 'failed', 'uncertain', 'retry_wait'].includes(delivery.state);
  const canRetry = configured && !report.synthetic && delivery.attempts < 10;
  const prefix = `lf-mail-${report.id}`;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !canWrite || disabled || !delivery) return;
    inFlight.current = true; setBusy(true); setError('');
    const body = attempt.current ?? JSON.stringify({ idempotencyKey: crypto.randomUUID(), revision: delivery.revision, action, note, confirmDuplicateRisk: confirm });
    attempt.current = body;
    try {
      const updated = await lostFoundRequest<LostFoundReport>(`/staff/${report.id}/mail`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Staff-Request': '1' }, body }, request);
      attempt.current = null; setUncertain(false); setNote(''); onSaved(updated);
    } catch (error) {
      const rejected = error instanceof LostFoundRequestError && [400,401,403,404,409,413,422,429].includes(error.status);
      if (rejected) attempt.current = null;
      setUncertain(!rejected);
      setError(requestMessage(error, 'Could not confirm this staff action. Retry the same action to avoid recording it twice.'));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="lf-mail" aria-labelledby={`${prefix}-heading`}>
    <h2 id={`${prefix}-heading`}>Confirmation email</h2>
    <p><strong>{labels[delivery.state] ?? 'Unknown email state — ask a Super admin'}</strong></p>
    <p className="lf-hint">This is separate from report status and manual contact. Refresh the inbox for a newer snapshot. Provider acceptance never proves inbox delivery.</p>
    <dl className="lf-details">
      <div><dt>Attempts</dt><dd>{delivery.attempts} · up to 5 automatically, 10 total</dd></div>
      <div><dt>Last email-state change</dt><dd>{when(delivery.updatedAt)}</dd></div>
      {delivery.nextAttempt !== null && <div><dt>Next eligible attempt</dt><dd>{when(delivery.nextAttempt * 1000)}</dd></div>}
      {delivery.providerId && <div><dt>Provider message ID (private)</dt><dd><code>{delivery.providerId}</code></dd></div>}
    </dl>
    {delivery.diagnostic && <p>{diagnostics[delivery.diagnostic] ?? 'Unrecognized diagnostic. Ask a Super admin to inspect the private outbox.'}</p>}
    {delivery.state === 'uncertain' && <p className="lf-privacy">Check Postmark activity by receipt, recipient and attempt time before any retry. A crash, timeout or server error may follow successful acceptance. Prefer manual follow-up when in doubt; retrying can duplicate email.</p>}
    {delivery.state === 'sending' && <p className="lf-hint">If this remains in progress after the request timeout, ask the operator to check private storage and restart the single server process. Interrupted attempts become uncertain, never automatically resent.</p>}
    {canWrite && actionable && <form className="lf-form" onSubmit={save} aria-busy={busy}>
      <fieldset disabled={disabled || busy || uncertain}>
        <label htmlFor={`${prefix}-action`}>Delivery action</label>
        <select id={`${prefix}-action`} className="input" value={action} onChange={e => setAction(e.target.value)}>
          <option value="handled">Record manual follow-up (no email sent)</option>
          <option value="retry" disabled={!canRetry}>Queue a reviewed retry</option>
        </select>
        {!canRetry && <p className="lf-hint">Retry is unavailable: mail configuration, synthetic data, or the attempt limit requires manual handling.</p>}
        <label htmlFor={`${prefix}-note`}>Provider check or manual follow-up note</label>
        <textarea id={`${prefix}-note`} className="input" required minLength={5} maxLength={500} rows={3} value={note} onChange={e => setNote(e.target.value)} />
        <p className="lf-hint">5–500 characters. Record what you checked or how you followed up. Do not paste provider response bodies, tokens, or unrelated visitor details.</p>
        {action === 'retry' && delivery.state === 'uncertain' && <label className="lf-checkbox"><input type="checkbox" required checked={confirm} onChange={e => setConfirm(e.target.checked)} />I checked provider activity and understand retrying may duplicate this email.</label>}
      </fieldset>
      {error && <p className="lf-error" role="alert">{error}</p>}
      <div className="lf-actions">
        <button type="button" className="btn-secondary" disabled={busy || uncertain} onClick={() => { setNote(''); setConfirm(false); setAction('handled'); setError(''); }}>Discard delivery changes</button>
        <button type="submit" className="btn-primary" disabled={disabled || busy || (action === 'retry' && !canRetry)}>{busy ? 'Recording…' : uncertain ? 'Retry same staff action' : action === 'retry' ? 'Queue reviewed retry' : 'Record manual follow-up'}</button>
      </div>
      {uncertain && <p className="lf-hint">Editing is paused until this action is confirmed. The retry button reuses the original request key and payload.</p>}
    </form>}
    <details className="lf-history"><summary>Delivery actions · latest 20</summary>{delivery.history.length ? <ol>{delivery.history.map((entry, i) => <li key={`${entry.at}-${i}`}><p>{entry.action === 'retry' ? 'Retry queued' : 'Manual follow-up recorded'} · {when(entry.at)} · {entry.actor}</p><p className="lf-note-text">{entry.note}</p></li>)}</ol> : <p>No staff delivery actions recorded.</p>}</details>
  </section>;
}

export function LostFoundMailSettings() {
  const { request, can } = useStaff();
  const [settings, setSettings] = useState<{ status: string; from: string | null; replyTo: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function load() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await request('/api/settings/lost-found-mail', { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error();
      setSettings(await response.json());
    } catch { setError('Could not load mail configuration. Check your Super access and retry.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!can('settings:write')) return null;
  return <section className="lf-mail">
    <button className="btn-secondary" type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading configuration…' : 'View Super mail configuration'}</button>
    {error && <p role="alert">{error}</p>}
    {settings && <><h2>Receipt mail configuration</h2><p>Status: {settings.status}. This checks configuration syntax only, not sender verification or deliverability.</p><dl className="lf-details"><div><dt>Explicit sender</dt><dd>{settings.from ?? 'Not configured'}</dd></div><div><dt>Explicit reply-to</dt><dd>{settings.replyTo ?? 'Not configured'}</dd></div></dl><p>Deployment-owned: LIVE_LOST_FOUND_MAIL_ENABLED, POSTMARK_SERVER_TOKEN, LIVE_LOST_FOUND_MAIL_FROM and LIVE_LOST_FOUND_MAIL_REPLY_TO. Sender and reply-to must be approved berkeley.mt addresses. Demo mode never sends. Tokens are not returned here. See docs/lost-found.md for setup and recovery; configuring mail does not automatically send old reports.</p></>}
  </section>;
}
