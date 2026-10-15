import { lazy, Suspense } from "react";
import { Link, Navigate, Outlet, Routes, Route } from "react-router-dom";
import App from "./App";
import {
  StaffProvider,
  StaffShell,
  StaffLogin,
  StaffAccess,
  StaffCapabilityGate,
  useStaff,
} from "./features/staff";
import { GuidePage, SiteEditor, useSite, siteText } from "./features/site";
import { RoomFinder, RoomEditor } from "./features/wayfinding";
import {
  LostFoundPage,
  LostFoundInbox,
  defaultLostFoundCopy,
} from "./features/lost-found";
import { EventEditor } from "./components/EventEditor";
import { useLiveData } from "./data/useLiveData";
import "./integration.css";

const ClassicApp = lazy(() => import("./ClassicApp"));
const Admin = lazy(() => import("./Admin"));
function PublicFrame() {
  const { content, error, refresh } = useSite();
  return (
    <div className="public-feature">
      <header className="site-header">
        <div className="page-width header-inner">
          <Link to="/" className="brand">
            <img src={content.branding.logoUrl} width="36" height="36" alt="" />
            <span>
              {content.branding.shortTitle}
              <span className="brand-caption">{content.branding.caption}</span>
            </span>
          </Link>
          <Link to="/staff/sign-in" className="staff-link">
            {siteText(content, "staff.signIn")}
          </Link>
        </div>
      </header>
      <nav
        className="section-nav"
        aria-label={siteText(content, "a11y.navigation")}
      >
        <div className="page-width">
          {content.navigation.map((link) => (
            <a key={link.id} href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </nav>
      {error && (
        <p role="alert" className="page-width">
          {error}
          <button onClick={refresh}>
            {siteText(content, "loading.retry")}
          </button>
        </p>
      )}
      <Outlet />
      <footer className="page-width site-footer">
        {siteText(content, "footer.credit")}
        <Link to="/">{siteText(content, "guide.back")}</Link>
      </footer>
    </div>
  );
}
function Reports() {
  const { content } = useSite();
  const copy = Object.fromEntries(
    Object.entries(defaultLostFoundCopy).map(([key, value]) => [
      key,
      content.copy[`lostFound.${key}`] ?? value,
    ]),
  );
  return <LostFoundPage copy={copy} />;
}
function Inbox() {
  const staff = useStaff();
  return <LostFoundInbox canWrite={staff.can("found:write")} />;
}
function RoomsEditor() {
  const staff = useStaff();
  return (
    <RoomEditor canWrite={staff.can("rooms:write")} request={staff.request} />
  );
}
function ContentWorkspace() {
  return (
    <div className="content-workspace">
      <EventEditor onPublish={() => {}} />
      <SiteEditor />
    </div>
  );
}
function StaffToday() {
  const staff = useStaff();
  const { data, error, refresh } = useLiveData();
  return (
    <section className="staff-panel">
      <h2>Run the public information desk</h2>
      <p>
        Keep visitors informed here. Competition timers stay in Lemon; trip
        planning stays in TakeTransit.
      </p>
      {error && (
        <p role="alert">
          {error}
          <button className="staff-button" onClick={refresh}>
            Retry
          </button>
        </p>
      )}
      {!data && !error && <p role="status">Loading publication…</p>}
      {data && (
        <>
          <p>
            <strong>{data.event.title}</strong> · {data.event.date}
          </p>
          <p className="staff-note">{data.event.notice}</p>
          <dl className="source-list">
            <div>
              <dt>Public information</dt>
              <dd>
                {data.operationRevision
                  ? `Git publication ${data.operationRevision.slice(0, 12)}`
                  : "SQLite operations + file-backed editorial content"}
              </dd>
            </div>
            <div>
              <dt>Staff identity</dt>
              <dd>
                {staff.session?.demoMode
                  ? "Synthetic demo roles · no SSO"
                  : "BMT Live local accounts · separate Lemon sign-in"}
              </dd>
            </div>
            <div>
              <dt>Student lookup</dt>
              <dd>
                {staff.session?.demoMode
                  ? "Synthetic demo roster; try DEMO-1001 / DEMO-CHECKIN-2026"
                  : "See Rooms for configured provider status; no live ContestDojo connection is implied"}
              </dd>
            </div>
            <div>
              <dt>Email delivery</dt>
              <dd>
                {staff.session?.demoMode
                  ? "Disabled in sandbox; subscriptions still persist locally"
                  : "Requires operator-provisioned Postmark configuration"}
              </dd>
            </div>
          </dl>
        </>
      )}
      <div className="workspace-actions">
        {staff.can("updates:read") && (
          <Link className="staff-button" to="/admin/operations">
            Schedule & updates
          </Link>
        )}
        {staff.can("found:read") && (
          <Link className="staff-button" to="/admin/lost-found">
            Process lost & found
          </Link>
        )}
        {staff.can("content:write") && (
          <Link className="staff-button" to="/admin/content">
            Edit site & guide
          </Link>
        )}
        <Link className="staff-button" to="/admin/access">
          Permissions & demo roles
        </Link>
      </div>
    </section>
  );
}
export function SiteRoutes() {
  return (
    <StaffProvider>
      <Suspense
        fallback={
          <p className="p-8" role="status">
            Loading…
          </p>
        }
      >
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/classic" element={<ClassicApp />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route element={<PublicFrame />}>
            <Route path="/rooms" element={<RoomFinder />} />
            <Route path="/lost-found" element={<Reports />} />
          </Route>
          <Route
            path="/lost-and-found"
            element={<Navigate to="/lost-found" replace />}
          />
          <Route path="/staff/sign-in" element={<StaffLogin />} />
          <Route path="/admin" element={<StaffShell />}>
            <Route index element={<StaffToday />} />
            <Route path="operations" element={<Admin />} />
            <Route
              path="content"
              element={
                <StaffCapabilityGate capability="content:write">
                  <ContentWorkspace />
                </StaffCapabilityGate>
              }
            />
            <Route
              path="rooms"
              element={
                <StaffCapabilityGate capability="rooms:write">
                  <RoomsEditor />
                </StaffCapabilityGate>
              }
            />
            <Route
              path="lost-found"
              element={
                <StaffCapabilityGate capability="found:read">
                  <Inbox />
                </StaffCapabilityGate>
              }
            />
            <Route path="access" element={<StaffAccess />} />
          </Route>
          <Route
            path="*"
            element={
              <main className="today-page loading-page">
                <h1>Page not found</h1>
                <Link to="/">Return to Today</Link>
              </main>
            }
          />
        </Routes>
      </Suspense>
    </StaffProvider>
  );
}
