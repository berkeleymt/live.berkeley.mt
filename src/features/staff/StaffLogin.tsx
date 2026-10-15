import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, SignIn } from "@phosphor-icons/react";
import { useStaff } from "./context";
import { ROLE_LABELS, staffReturnPath } from "./model";
import "./staff.css";

export function StaffLogin() {
  const staff = useStaff();
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const passwordEnabled = staff.session?.passwordLoginEnabled || staff.session?.ownerLoginEnabled;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await staff.login(username, password)) setPassword("");
  }

  if (staff.session?.user) return <Navigate to={staffReturnPath(params.get("returnTo"))} replace />;

  return <main className="staff-ui staff-sign-in">
    <Link to="/" className="staff-back"><ArrowLeft aria-hidden size={18} /> Public Today page</Link>
    <section className="staff-panel" aria-labelledby="staff-login-heading">
      <p className="staff-eyebrow">BMT Live · Staff workspace</p>
      <h1 id="staff-login-heading">Sign in to help run the day</h1>
      <p className="staff-muted">November 14, 2026 · Berkeley Math Tournament</p>
      {staff.status === "loading" && <p role="status">Checking staff access…</p>}
      {staff.error && <p className="staff-note staff-error" role="alert">{staff.error}</p>}
      {staff.status === "error" && <button className="staff-button" disabled={staff.busy} onClick={() => void staff.refresh()}>{staff.busy ? "Checking…" : "Retry connection"}</button>}
      {staff.status === "ready" && <>
        {passwordEnabled ? <form className="staff-form" onSubmit={submit} aria-busy={staff.busy}>
          <label htmlFor="staff-username">Username</label>
          <input id="staff-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={128} value={username} onChange={(event) => setUsername(event.target.value)} disabled={staff.busy} />
          <label htmlFor="staff-password">Password</label>
          <input id="staff-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} disabled={staff.busy} />
          {staff.session?.ownerLoginEnabled && <p className="staff-muted">Owner fallback: use username <code>owner</code> with the configured admin password.</p>}
          <button className="staff-button staff-primary" type="submit" disabled={staff.busy}><SignIn aria-hidden size={18} />{staff.busy ? "Signing in…" : "Sign in"}</button>
          <p className="staff-muted">Need an account or a reset? Ask your BMT Live administrator. Passwords cannot be reset by email here.</p>
        </form> : !staff.session?.demoMode && <div className="staff-note">
          <strong>Staff access has not been configured.</strong>
          <p>Ask an administrator to import private staff accounts or configure the owner fallback. There is no default password.</p>
          <button className="staff-button" disabled={staff.busy} onClick={() => void staff.refresh()}>Check again</button>
        </div>}
        {staff.session?.demoMode && <section className="staff-demo-box" aria-labelledby="demo-sign-in-heading">
          <p className="staff-demo-label">Demo mode · Synthetic accounts</p>
          <h2 id="demo-sign-in-heading">Try a staff role</h2>
          <p>No password needed in this demo. Actions affect this workspace. Do not enter real student information.</p>
          <div className="staff-demo-choices">
            {staff.session.demoAccounts.map((account) => <button key={account.id} className="staff-button" disabled={staff.busy} onClick={() => void staff.demoLogin(account.id)}>
              <SignIn aria-hidden size={18} /> Try {ROLE_LABELS[account.role].toLowerCase()}
            </button>)}
          </div>
          {staff.busy && <p role="status">Signing in…</p>}
        </section>}
      </>}
    </section>
    <p className="staff-muted">Lemon timers use a separate sign-in. <a href="https://lemon.berkeley.mt" target="_blank" rel="noopener noreferrer">Open Lemon (new tab)</a>. BMT Live does not share its passwords or sessions.</p>
  </main>;
}
