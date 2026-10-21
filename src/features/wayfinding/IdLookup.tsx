import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { StudentLookup } from './StudentLookup';
import { findRoom } from './api';
import { useSiteText } from '../site/text';
import { publicWayfindingError } from './publicErrors';
import { rosterRequest } from './rosterApi';
import type { RoomLookupStatus, PublicAssignments } from './rosterApi';
import type { LookupInfo, WayfindingContent } from './types';

export function IdLookup({ info, content, onSelectRoom, directionsHref = false }: { info: LookupInfo; content: WayfindingContent; onSelectRoom?: (id: string) => void; directionsHref?: boolean }) {
  const t = useSiteText();
  const id = useId();
  const [status, setStatus] = useState<RoomLookupStatus | null>(null);
  const [retry, setRetry] = useState(0);
  const [studentId, setStudentId] = useState('');
  const [result, setResult] = useState<PublicAssignments | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const navigate = (room: string) => { if (onSelectRoom) onSelectRoom(room); else window.location.assign(`/map?room=${encodeURIComponent(room)}`); };
  const controller = useRef<AbortController | null>(null);
  function forget() { controller.current?.abort(); setStudentId(''); setResult(null); setError(''); }
  useEffect(() => {
    const abort = new AbortController();
    rosterRequest<RoomLookupStatus>('/rooms/status', { signal: abort.signal }).then(value => { if (!abort.signal.aborted) setStatus(value); }).catch(e => { if (!abort.signal.aborted) setError(publicWayfindingError(e, 'lookup')); });
    return () => abort.abort();
  }, [retry]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') forget(); };
    document.addEventListener('visibilitychange', hide);
    return () => { controller.current?.abort(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setResult(null); setError('');
    const abort = new AbortController(); controller.current = abort;
    try { const value = await rosterRequest<PublicAssignments>('/rooms/lookup', { method: 'POST', body: JSON.stringify({ studentId }), signal: abort.signal }); if (!abort.signal.aborted) { setResult(value); setStudentId(''); requestAnimationFrame(() => resultHeading.current?.focus()); } }
    catch (e) { if (!abort.signal.aborted) setError(publicWayfindingError(e, 'lookup')); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (status?.mode === 'legacy') return <StudentLookup info={info} content={content} onSelectRoom={navigate} />;
  return <section className="wf-panel wf-lookup" translate="no" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className={result ? 'wf-sr-only' : undefined}>{t('lookup.title')}</h2>
    {!status && !error && <p role="status">{t('lookup.checking')}</p>}
    {error && <p role="alert" className="wf-error">{t(error)}</p>}
    {!status && error && <button className="wf-button" onClick={() => { setError(''); setRetry(v => v+1); }}>{t('lookup.retry')}</button>}
    {status && !status.available && <p className="wf-notice">{t('lookup.unavailable')} <button className="wf-button" onClick={() => setRetry(v => v+1)}>{t('lookup.checkAgain')}</button></p>}
    {status?.available && !result && <>
      {status.mode === 'demo' && <p className="wf-notice"><strong>{t('lookup.demoTitle')}</strong> {t('lookup.demoBody', { id: 'DEMO-1001' })}</p>}
      <form onSubmit={submit}><fieldset disabled={busy}><legend className="wf-sr-only">{t('lookup.legend')}</legend>
        <label htmlFor={`${id}-student`}>{t('lookup.studentId')}<input ref={input} id={`${id}-student`} value={studentId} onChange={e => { setStudentId(e.target.value); setResult(null); }} maxLength={128} autoComplete="off" autoCapitalize="characters" spellCheck={false} required aria-describedby={`${id}-privacy`} /></label>
        <p id={`${id}-privacy`} className="wf-small">{t('lookup.privacy')}</p>
        <button className="wf-button wf-primary">{t(busy ? 'lookup.busy' : 'lookup.submit')}</button>
      </fieldset></form>
    </>}
    {result && <div role="status" className="wf-assignments"><div className="wf-selection-bar"><h3 ref={resultHeading} tabIndex={-1}>{t(result.demo ? 'lookup.demoResults' : 'lookup.results')}</h3><button type="button" className="wf-button" onClick={() => { forget(); requestAnimationFrame(() => input.current?.focus()); }}>{t('lookup.changeId')}</button></div>
      <p className={result.stale ? 'wf-notice' : 'wf-small'}>{result.stale && <>{t('lookup.stale')} </>}{t('lookup.checkedAt', { time: result.checkedAt ? new Date(result.checkedAt * 1000).toLocaleString() : t('lookup.notChecked') })}</p>
      {!result.assignments.length && <p>{t('lookup.empty')}</p>}
      <ul>{result.assignments.map(a => { const room = a.roomId ? findRoom(content, a.roomId) : undefined; return <li key={a.scheduleId}><div><strong>{a.round}</strong><span>{t('lookup.scheduled', { start: a.startTime, end: a.endTime })} · <a href="/schedule">{t('lookup.delays')}</a></span><span>{room ? `${room.building.name} · ${room.room?.code}` : t('lookup.unmatched')}</span></div>{room && a.roomId && (directionsHref ? <a className="wf-button" href={`/map?room=${encodeURIComponent(a.roomId)}`}>{t('lookup.directions', { round: a.round })}</a> : <button className="wf-button" onClick={() => navigate(a.roomId!)}>{t('lookup.directions', { round: a.round })}</button>)}</li>; })}</ul>
    </div>}
    {studentId && <button className="wf-button" onClick={forget}>{t('lookup.clear')}</button>}
    <p className="wf-small wf-muted">{t('lookup.clearHint')} <a href="/help">{t('rooms.help')}</a></p>
  </section>;
}
