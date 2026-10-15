import { useState } from "react";
import { ArrowSquareOut, CheckCircle, MinusCircle, SignIn } from "@phosphor-icons/react";
import { useStaff } from "./context";
import { CAPABILITY_LABELS, ROLE_LABELS, type StaffCapability } from "./model";

export function StaffAccess() {
  const staff = useStaff();
  const [notice, setNotice] = useState<string | null>(null);
  const user = staff.session?.user;
  if (!user) return <p role="status">Sign in to see your permissions.</p>;

  async function switchRole(id: string, label: string) {
    setNotice(null);
    if (await staff.demoLogin(id)) setNotice(`Now signed in as ${label}. Permissions were updated by the server.`);
  }

  return <div className="staff-access">
    <section className="staff-panel" aria-labelledby="staff-access-heading">
      <h2 id="staff-access-heading">Your staff access</h2>
      <p><strong>{user.name}</strong> · {ROLE_LABELS[user.role]}{user.demo ? " · Synthetic demo account" : ""}</p>
      <p className="staff-muted">These permissions come from the server, not the menu. To change a real account, ask the administrator to update the private staff account file and restart BMT Live.</p>
      <ul className="staff-permissions" aria-label="Your permissions">
        {(Object.entries(CAPABILITY_LABELS) as [StaffCapability, string][]).map(([capability, label]) => <li key={capability}>
          {staff.can(capability) ? <CheckCircle size={20} aria-hidden /> : <MinusCircle size={20} aria-hidden />}
          <span>{label}<code>{capability}</code></span><strong>{staff.can(capability) ? "Allowed" : "Not allowed"}</strong>
        </li>)}
      </ul>
    </section>
    {staff.session?.demoMode && <section className="staff-panel staff-demo-box" aria-labelledby="staff-demo-heading">
      <p className="staff-demo-label">Demo mode only</p><h2 id="staff-demo-heading">Try another role</h2>
      <p>Switch synthetic accounts to test a permission boundary. The server replaces this session; the previous cookie stops working. No production account or shared Lemon login is created.</p>
      {notice && <p className="staff-note" role="status">{notice}</p>}
      {staff.error && <p className="staff-note staff-error" role="alert">{staff.error}</p>}
      <div className="staff-demo-choices">{staff.session.demoAccounts.map((account) => <button key={account.id} type="button" className="staff-button" disabled={staff.busy || user.id === account.id} onClick={() => void switchRole(account.id, account.name)}><SignIn size={18} aria-hidden />{ROLE_LABELS[account.role]}{user.id === account.id ? " · Current role" : ""}</button>)}</div>
      {staff.busy && <p role="status">Switching your staff account…</p>}
    </section>}
    <section className="staff-panel" aria-labelledby="staff-lemon-heading"><h2 id="staff-lemon-heading">Lemon is a separate workspace</h2><p>Open Lemon for room timers and proctor controls. Sign in there with your Lemon account. BMT Live does not share credentials, cookies or timer controls with Lemon.</p><p className="staff-muted">Shared sign-in is a future integration that needs an agreed identity provider and credentials. It is not enabled in this demo.</p><a className="staff-button" href="https://lemon.berkeley.mt" target="_blank" rel="noopener noreferrer"><ArrowSquareOut size={18} aria-hidden />Open Lemon (new tab)</a></section>
  </div>;
}
