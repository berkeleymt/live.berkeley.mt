import { lazy, Suspense } from "react";
import { Link, Navigate, Routes, Route, useLocation } from "react-router-dom";
import App, { FaqPage, HelpPage, MapPage, PublicGuidePage, SchedulePage, UpdatesPage } from "./App";
import { PublicFrame } from "./components/PublicFrame";
import { destinationLabel, usePublicData } from "./data/publicContext";
import {
  StaffProvider,
  StaffShell,
  StaffLogin,
  StaffAccess,
  StaffCapabilityGate,
  useStaff,
} from "./features/staff";
import { ContestDojoSettings, RosterWorkspace } from './features/wayfinding/RosterWorkspace';
import { StaffPeople } from './features/staff/StaffPeople';
import { AuthoredRoute } from './features/pages/PageRenderer';
import { ContentWorkspace, SiteSettingsWorkspace } from './components/ContentWorkspace';
import { useSiteText } from './features/site/text';
import { RoomFinder, RoomEditor } from "./features/wayfinding";
import {
  LostFoundPage,
  LostFoundInbox,
} from "./features/lost-found";
import { useLiveData } from "./data/useLiveData";
import "./integration.css";

const ClassicApp = lazy(() => import("./ClassicApp"));
const Admin = lazy(() => import("./Admin"));
function PublicRooms() {
  const { site } = usePublicData();
  return <RoomFinder embedded title={destinationLabel(site.content, '/rooms')} />;
}
function Alias({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}
function Reports() {
  return <LostFoundPage helpHref="/help" />;
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
function StaffToday() {
  const staff = useStaff();
  const { data, error, refresh } = useLiveData();
  return (
    <section className="staff-home">
      <h2>Keep visitors informed</h2>
      <p>
        Publish announcements, update the schedule and help visitors find their way.
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
          {data.event.notice && <p className="staff-note">{data.event.notice}</p>}
        </>
      )}
      <div className="staff-home-grid">
        {staff.can("updates:read") && (
          <Link className="staff-home-card" to="/admin/operations">
            <strong>Schedule & updates</strong><span>Adjust round times and publish announcements.</span><span className="staff-home-action">Open operations →</span>
          </Link>
        )}
        {staff.can("found:read") && (
          <Link className="staff-home-card" to="/admin/lost-found">
            <strong>Lost & found</strong><span>Review private reports and help return belongings.</span><span className="staff-home-action">Open inbox →</span>
          </Link>
        )}
        {staff.can("content:write") && (
          <Link className="staff-home-card" to="/admin/content">
            <strong>Website content</strong><span>Edit the visitor guide, FAQ and practical information.</span><span className="staff-home-action">Edit website →</span>
          </Link>
        )}
        {staff.can('rooms:write') && <Link className="staff-home-card" to="/admin/rooms"><strong>Rooms & directions</strong><span>Update building details, room maps and routes.</span><span className="staff-home-action">Manage rooms →</span></Link>}
      </div>
      <Link to="/admin/access">Your account & permissions</Link>
    </section>
  );
}
function RouteLoading() {
  const t = useSiteText();
  return <p className="p-8" role="status">{t('loading.route')}</p>;
}
function NotFound() {
  const t = useSiteText();
  return <main className="today-page loading-page"><h1>{t('loading.notFound')}</h1><Link to="/">{t('loading.home')}</Link></main>;
}
export function SiteRoutes() {
  return (
    <StaffProvider>
      <Suspense
        fallback={
          <RouteLoading />
        }
      >
        <Routes>
          <Route path="/classic" element={<ClassicApp />} />
          <Route element={<PublicFrame />}>
            <Route path="/" element={<AuthoredRoute fallback={<App />} />} />
            <Route path="/schedule" element={<AuthoredRoute fallback={<SchedulePage />} />} />
            <Route path="/updates" element={<AuthoredRoute fallback={<UpdatesPage />} />} />
            <Route path="/map" element={<AuthoredRoute fallback={<MapPage />} />} />
            <Route path="/guide" element={<AuthoredRoute fallback={<PublicGuidePage />} />} />
            <Route path="/faq" element={<AuthoredRoute fallback={<FaqPage />} />} />
            <Route path="/help" element={<AuthoredRoute fallback={<HelpPage />} />} />
            <Route path="/rooms" element={<AuthoredRoute fallback={<PublicRooms />} />} />
            <Route path="/lost-found" element={<AuthoredRoute fallback={<Reports />} />} />
            <Route path="/pages/:slug" element={<AuthoredRoute />} />
            <Route path="/guide/:slug" element={<AuthoredRoute />} />
            <Route path="/help/:slug" element={<AuthoredRoute />} />
          </Route>
          <Route path="/lost-and-found" element={<Alias to="/lost-found" />} />
          <Route path="/directions" element={<Alias to="/map" />} />
          <Route path="/lookup" element={<Alias to="/rooms" />} />
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
            <Route path="site-settings" element={<StaffCapabilityGate capability="content:write"><SiteSettingsWorkspace /></StaffCapabilityGate>} />
            <Route path="access" element={<StaffAccess />} />
            <Route path="people" element={<StaffPeople />} />
            <Route path="roster" element={<StaffCapabilityGate capability="rooms:write"><RosterWorkspace /></StaffCapabilityGate>} />
            <Route path="settings" element={<StaffCapabilityGate capability="settings:write"><ContestDojoSettings /></StaffCapabilityGate>} />
          </Route>
          <Route
            path="*"
            element={
              <NotFound />
            }
          />
        </Routes>
      </Suspense>
    </StaffProvider>
  );
}
