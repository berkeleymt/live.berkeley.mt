import { useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { ArrowSquareOut, CalendarBlank, ClipboardText, House, IdentificationBadge, List, MapPin, MagnifyingGlass, SignOut, Users, X, Gear, ShieldCheck } from "@phosphor-icons/react";
import { useStaff } from "./context";
import { hasAnyCapability, ROLE_LABELS, type StaffCapability } from "./model";
import "./staff.css";

const navigation = [
  { path: "/admin", label: "Today", icon: House, capabilities: ["access:read"] },
  { path: "/admin/operations", label: "Operations", icon: CalendarBlank, capabilities: ["schedule:write", "updates:read", "updates:write"] },
  { path: "/admin/content", label: "Website content", icon: ClipboardText, capabilities: ["content:write"] },
  { path: "/admin/site-settings", label: "Site settings", icon: Gear, capabilities: ["content:write"] },
  { path: "/admin/rooms", label: "Rooms", icon: MapPin, capabilities: ["rooms:write"] },
  { path: "/admin/roster", label: "Roster", icon: IdentificationBadge, capabilities: ["rooms:write"] },
  { path: "/admin/settings", label: "Settings", icon: Gear, capabilities: ["settings:write"] },
  { path: "/admin/lost-found", label: "Lost & Found", icon: MagnifyingGlass, capabilities: ["found:read", "found:write"] },
  { path: "/admin/people", label: "People", icon: Users, capabilities: ["people:write"] },
  { path: "/admin/access", label: "Access", icon: ShieldCheck, capabilities: ["access:read"] },
] satisfies { path: string; label: string; icon: typeof House; capabilities: StaffCapability[] }[];

export function StaffShell({ children, title, description }: { children?: ReactNode; title?: string; description?: string }) {
  const staff = useStaff();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const user = staff.session?.user;
  const modern = user?.role === 'admin' || user?.role === 'super';
  const active = navigation.find((item) => item.path === "/admin" ? location.pathname === item.path : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`));

  if (staff.status === "loading") return <main className="staff-ui staff-sign-in"><p role="status">Checking your staff session…</p></main>;
  if (staff.status === "error") return <main className="staff-ui staff-sign-in staff-panel"><h1>Staff access is unavailable</h1><p role="alert">{staff.error}</p><button className="staff-button" disabled={staff.busy} onClick={() => void staff.refresh()}>{staff.busy ? "Checking…" : "Try again"}</button><Link to="/">Return to Today</Link></main>;
  if (!user) return <Navigate to={`/staff/sign-in?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;

  if (modern && active && !hasAnyCapability(user, active.capabilities)) return <Navigate to="/admin" replace state={{ permissionChanged: true }} />;

  return <div className="staff-ui staff-layout">
    <a className="staff-skip" href="#staff-main">Skip to workspace</a>
    <aside className="staff-sidebar" aria-label="Staff sidebar">
      <div className="staff-brand-row"><Link className="staff-brand" to="/admin">BMT Live<span>Staff workspace</span></Link>
        <button type="button" className="staff-button staff-menu-toggle" aria-expanded={menuOpen} aria-controls="staff-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X aria-hidden size={20} /> : <List aria-hidden size={20} />}{menuOpen ? "Close menu" : "Menu"}</button>
      </div>
      <nav id="staff-navigation" aria-label="Staff pages" className={`staff-navigation ${menuOpen ? "staff-navigation-open" : ""}`}>
        {navigation.map(({ path, label, icon: Icon, capabilities }) => hasAnyCapability(user, capabilities)
          ? <NavLink key={path} title={label} to={path} end={path === "/admin"} onClick={() => setMenuOpen(false)} className={({ isActive }) => `staff-nav-link${isActive ? " staff-nav-active" : ""}`}><Icon aria-hidden size={20} /><span className="staff-nav-label">{label}</span></NavLink>
          : modern || path === '/admin/people' ? null : <span key={path} className="staff-nav-disabled" aria-disabled="true"><Icon aria-hidden size={20} /><span>{label}<small>Not in your role</small></span></span>)}
        <a className="staff-nav-link staff-lemon-link" title="Lemon timers · separate sign-in · new tab" href="https://lemon.berkeley.mt" target="_blank" rel="noopener noreferrer"><ArrowSquareOut aria-hidden size={20} /><span className="staff-nav-label">Lemon timers<small>Separate sign-in · new tab</small></span></a>
      </nav>
      <div className="staff-account">
        <button className="staff-button staff-account-toggle" aria-expanded={accountOpen} aria-controls="staff-account-details" aria-label={`Account: ${user.email ?? user.name}, ${ROLE_LABELS[user.role]}`} onClick={() => setAccountOpen(!accountOpen)}><StaffAvatar email={user.email ?? user.name} picture={user.picture} /><span>{accountOpen ? 'Close' : 'Account'}</span></button>
        <span className="staff-rail-status" role="status">{staff.connected ? 'Online' : 'Offline'}</span>
        <div id="staff-account-details" className={`staff-account-details${accountOpen ? ' staff-account-open' : ''}`}>
        <div className="staff-identity"><StaffAvatar email={user.email ?? user.name} picture={user.picture} /><div><strong>{user.email ?? user.name}</strong><span>{ROLE_LABELS[user.role]}{user.demo ? " · Demo" : ""}</span></div></div>
        <span role="status">{staff.connected ? 'Connected to Live' : 'Connection interrupted · showing last known access'}</span>
        {staff.session?.expiresAt && <span className="staff-muted">Signed in until {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(staff.session.expiresAt * 1000))}</span>}
        {user.authSource === "owner" && !staff.session?.csrfToken && <p className="staff-muted">Legacy Basic Auth is active. Your browser may retain it after sign-out; close its private window to clear it.</p>}
        <button type="button" className="staff-button" disabled={staff.busy} onClick={() => void staff.logout()}><SignOut aria-hidden size={18} />{staff.busy ? "Please wait…" : "Sign out"}</button>
        {staff.error && <p className="staff-note staff-error" role="alert">{staff.error}</p>}
        </div>
      </div>
    </aside>
    <div className="staff-workspace">
      {staff.session?.demoMode && <div className="staff-demo-banner" role="note"><strong>Demo mode</strong><span>Synthetic staff accounts. Never enter real student information.</span><Link to="/admin/access">Change demo role</Link></div>}
      <header className="staff-page-header"><div><h1>{title ?? active?.label ?? "Staff workspace"}</h1>{description && <p className="staff-muted">{description}</p>}</div><Link to="/" className="staff-public-link">View website <ArrowSquareOut aria-hidden size={16} /></Link></header>
      <main id="staff-main" className="staff-main" tabIndex={-1}>
        {location.state?.permissionChanged && <p className="staff-note" role="status">Your current role cannot open that page. You’re back on Today; ask a Super admin if you need access.</p>}
        {active && !hasAnyCapability(user, active.capabilities) ? <section className="staff-panel"><h2>This page is not in your role</h2><p>Nothing was changed. Ask an administrator if you need access.</p><Link to="/admin/access">View your permissions</Link></section> : children ?? <Outlet />}
      </main>
    </div>
  </div>;
}

export function StaffAvatar({ email, picture }: { email: string; picture?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const safe = picture && /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(picture);
  return <span className="staff-avatar" aria-hidden="true">{safe && failed !== picture ? <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(picture)} /> : email.slice(0, 1).toUpperCase()}</span>;
}

/** Useful around a specific editor; server authorization remains mandatory. */
export function StaffCapabilityGate({ capability, children }: { capability: StaffCapability; children: ReactNode }) {
  const staff = useStaff();
  return staff.can(capability) ? children : <section className="staff-panel"><h2>More access is needed</h2><p>Your account does not have <code>{capability}</code>. Ask an administrator; nothing was changed.</p><Link to="/admin/access">View your permissions</Link></section>;
}
