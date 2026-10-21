import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSiteText } from '../site/text';
import { publicWayfindingError } from './publicErrors';
import { findRoom, wayfindingRequest } from './api';
import type { LookupInfo, LookupResponse, WayfindingContent } from './types';

/** Kept in memory only. IDs/codes never enter URLs, storage, analytics or public files. */
export function StudentLookup({ info, content, onSelectRoom }: { info: LookupInfo; content: WayfindingContent; onSelectRoom: (roomId: string) => void }) {
  const t = useSiteText();
  const prefix = useId();
  const [studentId, setStudentId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LookupResponse | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  // Shared-device privacy: forget results as soon as this tab is hidden.
  useEffect(() => {
    const forget = () => {
      if (document.visibilityState === 'hidden') { controller.current?.abort(); setResult(null); setCode(''); setStudentId(''); }
    };
    document.addEventListener('visibilitychange', forget);
    return () => document.removeEventListener('visibilitychange', forget);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || info.mode === 'unavailable') return;
    inFlight.current = true; setBusy(true); setError(''); setResult(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await wayfindingRequest<LookupResponse>('/lookup', { method: 'POST', body: JSON.stringify({ studentId: studentId.trim(), checkInCode: code.trim() }), signal: abort.signal });
      if (!abort.signal.aborted) { setResult(response); setCode(''); setStudentId(''); }
    } catch (cause) { if (!abort.signal.aborted) setError(publicWayfindingError(cause, 'legacy')); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="wf-lookup wf-panel" aria-labelledby={`${prefix}-title`}>
    <h2 id={`${prefix}-title`}>{t('lookup.title')}</h2>
    <p className="wf-muted">{t(info.mode === 'private_import' ? 'lookup.source.privateImport' : `lookup.source.${info.mode}`)}</p>
    {info.mode === 'demo' && <div className="wf-notice">
      <strong>{t('lookup.tryDemo')}</strong>
      {info.demoCredentials?.map(sample => <div key={sample.studentId}>
        <p>{t('lookup.studentId')}: <code>{sample.studentId}</code><br />{t('lookup.checkInCode')}: <code>{sample.checkInCode}</code></p>
        <button type="button" className="wf-button" disabled={busy} onClick={() => { setStudentId(sample.studentId); setCode(sample.checkInCode); setResult(null); setError(''); }}>{t('lookup.useDemo')}</button>
      </div>)}
      <p className="wf-small">{t('lookup.demoCredentials')}</p>
    </div>}
    {info.mode === 'unavailable' ? <p className="wf-notice">{t('lookup.legacyUnavailable')}</p> : <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend className="wf-sr-only">{t('lookup.legacyLegend')}</legend>
        <div className="wf-two-fields">
          <label htmlFor={`${prefix}-student`}>{t('lookup.studentId')}<input id={`${prefix}-student`} value={studentId} onChange={event => { setStudentId(event.target.value); setResult(null); }} required maxLength={64} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby={`${prefix}-privacy`} /></label>
          <label htmlFor={`${prefix}-code`}>{t('lookup.privateCode')}<input id={`${prefix}-code`} type="password" value={code} onChange={event => { setCode(event.target.value); setResult(null); }} required maxLength={128} autoComplete="off" spellCheck={false} aria-describedby={`${prefix}-privacy`} /></label>
        </div>
        <p id={`${prefix}-privacy`} className="wf-small wf-muted">{t('lookup.legacyPrivacy')}</p>
        <div className="wf-actions"><button className="wf-button wf-primary" type="submit">{t(busy ? 'lookup.legacyBusy' : 'lookup.submit')}</button><a href="/help">{t('lookup.needCode')}</a></div>
      </fieldset>
    </form>}
    {error && <p role="alert" className="wf-error">{t(error)}</p>}
    {result && <div className="wf-assignments" role="status" aria-live="polite">
      <h3>{t(result.source.mode === 'demo' ? 'lookup.demoResults' : 'lookup.results')}</h3>
      <ul>{result.assignments.map((assignment, index) => {
        const found = findRoom(content, assignment.roomId);
        return <li key={`${assignment.round}-${index}`}><div><strong>{assignment.round}</strong><span>{found ? `${found.building.name} · ${found.room?.code}` : t('lookup.askDirections')}</span></div>{found && <button type="button" className="wf-button" onClick={() => onSelectRoom(assignment.roomId)} aria-label={t('lookup.directions', { round: assignment.round })}>{t('rooms.directions')}</button>}</li>;
      })}</ul>
      <button type="button" className="wf-button" onClick={() => { setResult(null); setCode(''); setStudentId(''); }}>{t('lookup.clear')}</button>
      <p className="wf-small wf-muted">{t('lookup.legacyClearHint')}</p>
    </div>}
  </section>;
}
