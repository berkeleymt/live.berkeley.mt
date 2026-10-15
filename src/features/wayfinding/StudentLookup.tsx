import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { findRoom, requestMessage, wayfindingRequest } from './api';
import type { LookupInfo, LookupResponse, WayfindingContent } from './types';

/** Kept in memory only. IDs/codes never enter URLs, storage, analytics or public files. */
export function StudentLookup({ info, content, onSelectRoom }: { info: LookupInfo; content: WayfindingContent; onSelectRoom: (roomId: string) => void }) {
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
    } catch (cause) { if (!abort.signal.aborted) setError(requestMessage(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="wf-lookup wf-panel" aria-labelledby={`${prefix}-title`}>
    <h2 id={`${prefix}-title`}>Your assigned rooms</h2>
    <p className="wf-muted">{info.sourceLabel}</p>
    {info.mode === 'demo' && <div className="wf-notice">
      <strong>Try a synthetic student</strong>
      {info.demoCredentials?.map(sample => <div key={sample.studentId}>
        <p>Student ID: <code>{sample.studentId}</code><br />Check-in code: <code>{sample.checkInCode}</code></p>
        <button type="button" className="wf-button" disabled={busy} onClick={() => { setStudentId(sample.studentId); setCode(sample.checkInCode); setResult(null); setError(''); }}>Use demo details</button>
      </div>)}
      <p className="wf-small">These are public demonstration credentials, not a real student’s details.</p>
    </div>}
    {info.mode === 'unavailable' ? <p className="wf-notice">Room lookup is not available yet. You can still search the public building list below, or ask the BMT help desk for your assignment.</p> : <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend className="wf-sr-only">Verify your private check-in details</legend>
        <div className="wf-two-fields">
          <label htmlFor={`${prefix}-student`}>Student ID<input id={`${prefix}-student`} value={studentId} onChange={event => { setStudentId(event.target.value); setResult(null); }} required maxLength={64} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby={`${prefix}-privacy`} /></label>
          <label htmlFor={`${prefix}-code`}>Private check-in code<input id={`${prefix}-code`} type="password" value={code} onChange={event => { setCode(event.target.value); setResult(null); }} required maxLength={128} autoComplete="off" spellCheck={false} aria-describedby={`${prefix}-privacy`} /></label>
        </div>
        <p id={`${prefix}-privacy`} className="wf-small wf-muted">Use the code given to you at check-in, not your ContestDojo password. A student ID alone never unlocks an assignment. This page does not store either field.</p>
        <div className="wf-actions"><button className="wf-button wf-primary" type="submit">{busy ? 'Checking details…' : 'Find my rooms'}</button><a href="/help">Need your code?</a></div>
      </fieldset>
    </form>}
    {error && <p role="alert" className="wf-error">{error}</p>}
    {result && <div className="wf-assignments" role="status" aria-live="polite">
      <h3>{result.source.mode === 'demo' ? 'Demo room assignments' : 'Your room assignments'}</h3>
      <ul>{result.assignments.map((assignment, index) => {
        const found = findRoom(content, assignment.roomId);
        return <li key={`${assignment.round}-${index}`}><div><strong>{assignment.round}</strong><span>{found ? `${found.building.name} · ${found.room?.code}` : 'Ask the help desk for directions'}</span></div>{found && <button type="button" className="wf-button" onClick={() => onSelectRoom(assignment.roomId)}>Directions<span className="wf-sr-only"> for {assignment.round}</span></button>}</li>;
      })}</ul>
      <button type="button" className="wf-button" onClick={() => { setResult(null); setCode(''); setStudentId(''); }}>Clear my details</button>
      <p className="wf-small wf-muted">Clear your details before handing this device to someone else. Assignments also clear when you leave this tab.</p>
    </div>}
  </section>;
}
