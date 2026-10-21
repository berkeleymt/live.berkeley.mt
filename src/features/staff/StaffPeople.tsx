import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useStaff } from './context';
import { ROLE_LABELS, type ProductionStaffRole } from './model';
import { StaffAvatar } from './StaffShell';

export interface StaffPerson {
  email: string; role: ProductionStaffRole; picture: string | null;
  fixed: boolean; online: boolean; addedBy: string;
}

export function StaffPeople() {
  const staff = useStaff();
  const allowed = staff.can('people:write');
  const [people, setPeople] = useState<StaffPerson[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProductionStaffRole>('admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const { request, refresh } = staff;
  const load = useCallback(async (signal?: AbortSignal) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    try {
      const response = await request('/api/staff/people', { signal });
      if (response.status === 401 || response.status === 403) await refresh();
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load People. Retry when connected.');
      if (!signal?.aborted) { setPeople(body.accounts); setError(previous => previous?.startsWith('Could not refresh People.') ? null : previous); }
      return true;
    } catch {
      if (!signal?.aborted) setError('Could not refresh People. The list may be out of date; retry when connected.');
      return false;
    } finally { inFlight.current = false; }
  }, [request, refresh]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      if (document.visibilityState === 'visible') failures = await load(controller.signal) ? 0 : Math.min(failures + 1, 6);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), failures ? Math.random() * Math.min(60_000, 1000 * 2 ** failures) : 10_000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [allowed, load]);

  async function change(method: string, target: string, nextRole?: ProductionStaffRole) {
    if (inFlight.current) { setNotice('A refresh is in progress. Try the action again in a moment.'); return; }
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    let confirmed = false;
    try {
      const response = await request(`/api/staff/people${method === 'POST' ? '' : `/${encodeURIComponent(target)}`}`, {
        method, headers: { 'Content-Type': 'application/json' },
        ...(method === 'DELETE' ? {} : { body: JSON.stringify(method === 'POST' ? { email: target, role: nextRole } : { role: nextRole }) }),
      });
      if (response.status === 401 || response.status === 403) await refresh();
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? 'Change was not accepted. Refresh before retrying.'); }
      setNotice(method === 'DELETE' ? `${target} removed. Their sessions no longer work.` : `${target} saved. Access updates on their next request.`);
      confirmed = true;
      if (method === 'POST') setEmail('');
    } catch (cause) {
      setError(cause instanceof Error && cause.name === 'Error' ? cause.message : 'Change could not be confirmed. Refresh People before retrying; do not assume it was saved.');
    } finally { inFlight.current = false; setBusy(false); }
    // Never retry a write automatically; reconcile from the server after a confirmed write.
    if (confirmed) void load();
  }
  function add(event: FormEvent) { event.preventDefault(); void change('POST', email, role); }
  if (!allowed) return <Navigate to="/admin" replace state={{ permissionChanged: true }} />;
  return <div className="staff-access">
    <section className="staff-panel" aria-labelledby="people-add-heading">
      <h2 id="people-add-heading">Authorize a Live account</h2>
      <p>Admin runs daily operations. Super admin also manages People and protected settings. Use the email address the person signs in to Google with. This does not grant Lemon access.</p>
      <form className="staff-form" onSubmit={add} aria-busy={busy}>
        <label htmlFor="people-email">Google account email</label><input id="people-email" type="email" required maxLength={254} autoComplete="off" autoCapitalize="none" value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
        <label htmlFor="people-role">Role</label><select id="people-role" value={role} onChange={event => setRole(event.target.value as ProductionStaffRole)} disabled={busy}><option value="admin">Admin</option><option value="super">Super admin</option></select>
        <button type="submit" className="staff-button staff-primary" disabled={busy}>{busy ? 'Saving…' : 'Add account'}</button>
      </form>
      {staff.session?.demoMode && <p className="staff-note">Demo accounts and People changes are synthetic and reset on restart. There is no real Google sign-in here.</p>}
      {notice && <p role="status" className="staff-note">{notice}</p>}
      {error && <p role="alert" className="staff-note staff-error">{error}</p>}
    </section>
    <section className="staff-panel" aria-labelledby="people-list-heading">
      <h2 id="people-list-heading">Authorized accounts{people ? ` (${people.length})` : ''}</h2>
      <p className="staff-muted">Connected means a staff page was visible within 30 seconds, not that the person is available. Your own account and environment-configured Supers are protected.</p>
      <button type="button" className="staff-button" disabled={busy} onClick={() => { setError(null); void load(); }}>Refresh People</button>
      {!people && !error && <p role="status">Loading accounts…</p>}
      {people?.length === 0 && <p>No accounts returned. Ask the server operator to check the bootstrap configuration.</p>}
      <ul className="staff-people-list">{people?.map(person => <PersonRow key={`${person.email}:${person.role}`} person={person} own={person.email === staff.session?.user?.email} busy={busy} change={change} />)}</ul>
    </section>
  </div>;
}

function PersonRow({ person, own, busy, change }: { person: StaffPerson; own: boolean; busy: boolean; change: (method: string, email: string, role?: ProductionStaffRole) => Promise<void> }) {
  const [role, setRole] = useState(person.role);
  const [removing, setRemoving] = useState(false);
  const protectedAccount = own || person.fixed;
  return <li className="staff-person">
    <div className="staff-identity"><StaffAvatar email={person.email} picture={person.picture} /><div><strong>{person.email}</strong><span>{ROLE_LABELS[person.role]} · {person.online ? 'Connected' : 'Not connected'}</span><small>{own ? 'You · ' : ''}{person.fixed ? 'Environment-protected Super' : `Added by ${person.addedBy}`}</small></div></div>
    {!protectedAccount && <div className="staff-person-actions staff-form"><label>Role for {person.email}<select value={role} onChange={event => setRole(event.target.value as ProductionStaffRole)} disabled={busy}><option value="admin">Admin</option><option value="super">Super admin</option></select></label><button className="staff-button" disabled={busy || role === person.role} onClick={() => void change('PATCH', person.email, role)}>Save role</button><button className="staff-button" disabled={busy} onClick={() => setRemoving(true)}>Remove account</button></div>}
    {!protectedAccount && removing && <div className="staff-note" role="group" aria-label={`Confirm removal of ${person.email}`}><p>Remove {person.email}? Their active sessions stop working immediately. Adding them again will require a new sign-in.</p><button className="staff-button" disabled={busy} onClick={async () => { await change('DELETE', person.email); setRemoving(false); }}>Confirm removal</button><button className="staff-button" disabled={busy} onClick={() => setRemoving(false)}>Cancel</button></div>}
  </li>;
}
