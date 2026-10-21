import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStaff } from '../staff';
import { checkedTime, rosterMessage, rosterRequest } from './rosterApi';
import type { ProviderSettings, RosterMapping, RosterStatus } from './rosterApi';
import './wayfinding.css';

export function ContestDojoSettings() {
  const staff = useStaff(); const [value, setValue] = useState<ProviderSettings | null>(null);
  const [token, setToken] = useState(''); const [replace, setReplace] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  async function run(save = false) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice(''); const abort = new AbortController(); controller.current = abort;
    try {
      if (save && value) { await rosterRequest('/settings/contestdojo', { method: 'PUT', signal: abort.signal, body: JSON.stringify({ revision: value.revision, eventId: value.eventId.trim(), ...(replace ? { token: token.trim() } : {}), autoSync: value.autoSync }) }, staff.request); setToken(''); setReplace(false); }
      const data = await rosterRequest<ProviderSettings>('/settings/contestdojo', { signal: abort.signal }, staff.request); if (!abort.signal.aborted) { setValue(data); setToken(''); setReplace(false); if (save) setNotice('Settings saved. Visit Roster to sync and check room mappings.'); }
    } catch (e) { if (!abort.signal.aborted) setError(rosterMessage(e)); } finally { lock.current = false; if (!abort.signal.aborted) setBusy(false); }
  }
  useEffect(() => { const hide = () => { if (document.visibilityState === 'hidden') { setToken(''); setReplace(false); } }; document.addEventListener('visibilitychange', hide); return () => { controller.current?.abort(); document.removeEventListener('visibilitychange', hide); }; }, []);
  return <section className="wf-editor" translate="no"><h2>ContestDojo settings</h2><p>Super admin only. Secrets remain in private server storage and are never returned by this page. <Link to="/admin/roster">Open roster diagnostics</Link></p>
    {!value && <button className="wf-button" disabled={busy} onClick={() => void run()}>Load provider settings</button>}
    {error && <p role="alert" className="wf-error">{error} Your draft is retained. Reload before retrying an uncertain save.</p>}{notice && <p role="status" className="wf-notice">{notice}</p>}
    {value && <form onSubmit={e => { e.preventDefault(); void run(true); }}><p>{value.demo ? 'Sandbox: synthetic roster only; no provider requests.' : 'Provider: https://api.contestdojo.com (read only)'}</p>{!value.enabled && <p className="wf-notice">An operator must first provision LIVE_CONTESTDOJO_DB outside public and Git directories.</p>}
      <fieldset disabled={busy || !value.enabled}><legend>Provider connection</legend>
        <label>Event ID<input value={value.eventId} maxLength={128} onChange={e => setValue({ ...value, eventId: e.target.value })} /></label>
        <p className="wf-small">Changing event hides the old event’s public assignments and resets mappings until a successful sync. Old private rows remain for diagnosis.</p>
        <p>Token: {value.tokenConfigured ? 'Configured (redacted)' : 'Not configured'}</p>
        <label className="wf-checkbox"><input type="checkbox" checked={replace} onChange={e => { setReplace(e.target.checked); setToken(''); }} />Replace or remove the token</label>
        {replace && <label>New API token (empty removes it)<input type="password" autoComplete="new-password" value={token} maxLength={4096} onChange={e => setToken(e.target.value)} /></label>}
        <label className="wf-checkbox"><input type="checkbox" checked={value.autoSync} disabled={!value.autoAllowed} onChange={e => setValue({ ...value, autoSync: e.target.checked })} />Sync automatically around once per minute{!value.autoAllowed && ' (disabled by operator or sandbox)'}</label>
        <button className="wf-button wf-primary">{busy ? 'Saving…' : 'Save settings'}</button>
      </fieldset><button className="wf-button" type="button" disabled={busy} onClick={() => void run()}>Reload settings (discard form changes)</button>
    </form>}
  </section>;
}
export function RosterWorkspace() {
  const staff = useStaff(); const [status, setStatus] = useState<RosterStatus | null>(null); const [draft, setDraft] = useState<RosterMapping | null>(null); const [aliases, setAliases] = useState('{}'); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [clear, setClear] = useState(''); const lock = useRef(false); const controller = useRef<AbortController | null>(null);
  const dirty = !!status && !!draft && (JSON.stringify(status.mapping) !== JSON.stringify(draft) || JSON.stringify(status.mapping.roomAliases, null, 2) !== aliases);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(action: 'load' | 'sync' | 'mapping' | 'clear', offset = 0) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice(''); const abort = new AbortController(); controller.current = abort;
    try {
      if (action !== 'load') await rosterRequest(`/roster/${action}`, { method: 'POST', signal: abort.signal, body: JSON.stringify(action === 'mapping' ? { revision: status?.revision, mapping: { ...draft, roomAliases: JSON.parse(aliases) as unknown } } : action === 'clear' ? { confirm: clear } : {}) }, staff.request);
      const next = await rosterRequest<RosterStatus>(`/roster?offset=${offset}`, { signal: abort.signal }, staff.request);
      if (!abort.signal.aborted) { setStatus(next); setDraft(next.mapping); setAliases(JSON.stringify(next.mapping.roomAliases, null, 2)); setClear(''); setNotice(action === 'load' ? 'Status refreshed.' : action === 'mapping' ? 'Mapping saved. Stored rows reinterpreted without a provider fetch.' : action === 'clear' ? 'Local snapshot cleared. Auto-sync may repopulate it.' : 'Sync completed. Review diagnostics below.'); }
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof SyntaxError ? 'Room aliases must be a JSON object of normalized label → public room ID.' : rosterMessage(e)); }
    finally { lock.current = false; if (!abort.signal.aborted) setBusy(false); }
  }
  function column(label: string, value: string, change: (value: string) => void) { return <label>{label}<select value={value} onChange={e => change(e.target.value)}><option value="">None</option>{value && !status?.columns.includes(value) && <option value={value}>{value} (missing)</option>}{status?.columns.map(c => <option key={c} value={c}>{c}</option>)}</select></label>; }
  return <section className="wf-editor" translate="no"><h2>Private roster</h2><p>Imported columns are private. Only room assignments joined to the public schedule and map leave this workspace. Do not copy roster rows into public content.</p>
    {staff.can('settings:write') ? <Link to="/admin/settings">ContestDojo settings</Link> : <p>Ask a Super admin to configure the provider or replace its token.</p>}
    <div className="wf-actions"><button className="wf-button" disabled={busy} onClick={() => void run('load')}>{status ? 'Reload status (discard mapping draft)' : 'Load roster status'}</button><button className="wf-button wf-primary" disabled={busy || dirty || !status?.configured || status.syncing} onClick={() => void run('sync')}>Sync now</button></div>
    {busy && <p role="status">Working… keep this page open. Sync can take up to one minute.</p>}{error && <p role="alert" className="wf-error">{error} Draft retained. Reload status before retrying an uncertain action.</p>}{notice && <p role="status" className="wf-notice">{notice}</p>}
    {status && draft && <>
      <p className="wf-notice">{status.mode === 'demo' ? 'Synthetic sandbox. No provider network requests.' : status.configured ? 'Configured private source.' : 'Provider not configured.'} {status.stale && 'Snapshot is stale or has not been checked.'} {!status.eventMatches && 'Snapshot is from a different event: public lookup is disabled.'}</p>
      <p>{status.count} rows · {status.missingIds} missing IDs · {status.ambiguousIds} duplicate IDs (lookup blocked for duplicates) · {status.unmatchedRoomCount} unmatched room labels.</p>
      <p>Last attempt: {checkedTime(status.attemptedAt)} · Last successful sync: {checkedTime(status.syncedAt)} · Auto-sync: {status.autoSync ? 'on' : 'off'} · Earliest retry: {checkedTime(status.nextAttempt)}</p>
      {status.error && <p className="wf-error">{status.error}</p>}<ul>{status.notes.map(n => <li key={n}>{n}</li>)}</ul>
      {!!status.missingColumns.length && <p className="wf-error">Missing mapped columns: {status.missingColumns.join(', ')}</p>}
      <details><summary>Unmatched room labels (first 100)</summary><ul>{status.unmatchedRooms.map(r => <li key={r}>{r}</li>)}</ul></details>
      <fieldset disabled={busy}><legend>Column mappings {dirty ? '· unsaved' : ''}</legend><p>Multiple tests may share a column. None intentionally omits a test. Only the chosen ID column is used; leading zeros are preserved.</p>
        {column('Student ID', draft.idColumn, idColumn => setDraft({ ...draft, idColumn }))}
        <details><summary>Private display fields</summary><p className="wf-small">Tests is optional: when set, its cell must contain exact public schedule IDs separated by commas or semicolons; blank/unknown values suppress assignments. Leave None if participation is already indicated by per-test room cells.</p>{['name','tests','school','org','team','contact'].map(key => <div key={key}>{column(key, draft.fields[key] ?? '', value => setDraft({ ...draft, fields: { ...draft.fields, [key]: value } }))}</div>)}</details>
        {status.schedule.map(t => <div key={t.id}>{column(`${t.title} (${t.id}) room column`, draft.roomColumns[t.id] ?? '', value => setDraft({ ...draft, roomColumns: { ...draft.roomColumns, [t.id]: value } }))}</div>)}
        {Object.keys(draft.roomColumns).some(id => !status.schedule.some(t => t.id === id)) && <button type="button" className="wf-button" onClick={() => setDraft({ ...draft, roomColumns: Object.fromEntries(Object.entries(draft.roomColumns).filter(([id]) => status.schedule.some(t => t.id === id))) })}>Remove mappings for deleted schedule items</button>}
        <label>Room aliases (JSON object)<textarea rows={5} value={aliases} maxLength={100000} spellCheck={false} onChange={e => setAliases(e.target.value)} /></label><p className="wf-small">Use normalized uppercase source labels without trailing section parentheses as keys, stable public room IDs as values. Exact room IDs and unambiguous “building name + room code” match automatically. <Link to="/admin/rooms">Review public rooms</Link>.</p>
        <button className="wf-button wf-primary" disabled={!dirty} onClick={() => void run('mapping')}>Save mapping</button>
      </fieldset>
      <details><summary>Mapped private view (50 per page)</summary><div className="wf-table-scroll"><table><thead><tr><th>ID</th>{Object.keys(status.mapping.fields).map(k => <th key={k}>{k}</th>)}</tr></thead><tbody>{status.rows.map((row,i) => <tr key={i}><td>{row[status.mapping.idColumn] || 'Missing ID'}</td>{Object.entries(status.mapping.fields).map(([k,c]) => <td key={k}>{row[c] || '—'}</td>)}</tr>)}</tbody></table></div></details>
      <details><summary>Private imported rows (50 per page)</summary><p>Raw source columns, not edited by mappings. Never publish this view.</p><div className="wf-table-scroll"><table><thead><tr>{status.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{status.rows.map((row, i) => <tr key={i}>{status.columns.map(c => <td key={c}>{row[c]}</td>)}</tr>)}</tbody></table></div><div className="wf-actions"><button className="wf-button" disabled={busy || dirty || !status.offset} onClick={() => void run('load', Math.max(0,status.offset-50))}>Previous 50</button><button className="wf-button" disabled={busy || dirty || status.offset+50>=status.count} onClick={() => void run('load',status.offset+50)}>Next 50</button></div></details>
      <details><summary>Clear local snapshot</summary><p>This does not change ContestDojo. Automatic sync can repopulate the snapshot; disable it in Settings first if needed.</p><label>Type CLEAR to confirm<input value={clear} onChange={e => setClear(e.target.value)} /></label><button className="wf-button" disabled={busy || clear !== 'CLEAR'} onClick={() => void run('clear')}>Clear local snapshot</button></details>
    </>}
  </section>;
}
