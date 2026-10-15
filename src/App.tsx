import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  MapPin,
  Megaphone,
  WarningCircle,
} from "@phosphor-icons/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLiveData } from "./data/useLiveData";
import { eventDateLabel, scheduleState } from "./data/schedule";
import { formatTime } from "./data/utils";
import { EmailSubscribe } from "./components/InfoCard";
import type { Announcement, LiveData } from "./data/types";
import "./today.css";

const CampusMap = lazy(() =>
  import("./components/MapCard").then((module) => ({
    default: module.MapCardExpanded,
  })),
);

function Updates({
  announcements,
  timeZone,
}: {
  announcements: Announcement[];
  timeZone: string;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...announcements].sort(
    (a, b) =>
      Number(b.priority === "urgent") - Number(a.priority === "urgent") ||
      Number(!!b.pinned) - Number(!!a.pinned) ||
      Date.parse(b.scheduledAt ?? b.timestamp) -
        Date.parse(a.scheduledAt ?? a.timestamp),
  );
  const visible = all
    ? sorted
    : sorted.filter(
        (item, index) => index < 5 || item.pinned || item.priority === "urgent",
      );
  return (
    <>
      {sorted.length === 0 && (
        <p className="empty-copy">
          No updates yet. New announcements will appear here automatically.
        </p>
      )}
      {visible.map((item) => (
        <article
          key={item.id}
          className={`update ${item.priority === "urgent" ? "update-urgent" : ""}`}
        >
          <div className="update-meta">
            {item.priority === "urgent" && <strong>Urgent</strong>}
            {item.pinned && <span>Pinned</span>}
            <time dateTime={item.scheduledAt ?? item.timestamp}>
              {new Intl.DateTimeFormat("en-US", {
                timeZone,
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              }).format(new Date(item.scheduledAt ?? item.timestamp))}
            </time>
          </div>
          <h3>{item.title}</h3>
          <div className="prose-copy">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml>
              {item.body}
            </Markdown>
          </div>
        </article>
      ))}
      {sorted.length > visible.length && (
        <button className="text-button" onClick={() => setAll(true)}>
          Show {sorted.length - visible.length} older updates{" "}
          <ArrowRight aria-hidden size={16} />
        </button>
      )}
    </>
  );
}

function Today({ data, stale }: { data: LiveData; stale: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const { event, schedule, delays, announcements, venues, info } = data;
  const { phase, current, next, events } = scheduleState(
    schedule,
    delays,
    event,
    now,
  );
  const headline =
    phase === "unpublished"
      ? "Schedule coming soon"
      : phase === "before"
        ? "See you at Berkeley."
        : current
          ? current.title
          : next
            ? "Up next: " + next.title
            : "That’s a wrap.";
  const summary =
    phase === "unpublished"
      ? "The event schedule has not been published yet. Check back for updates."
      : phase === "before"
        ? event.subtitle
        : current
          ? `${formatTime(current.startTime)} – ${formatTime(current.endTime)} · ${current.location}`
          : next
            ? `${formatTime(next.startTime)} · ${next.location}`
            : `Thanks for being part of ${event.title}. The schedule and updates remain available below.`;
  useEffect(() => {
    document.title = `${event.title} · Live`;
  }, [event.title]);

  return (
    <div className="today-page">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="page-width header-inner">
          <a href={event.eventUrl} className="brand">
            <img src="/bmt-logo.svg" width="40" height="40" alt="" />
            <span>
              Berkeley Math Tournament
              <span className="brand-caption">Tournament day companion</span>
            </span>
          </a>
          <a href="/admin" className="staff-link">
            Staff sign in <ArrowUpRight aria-hidden size={16} />
          </a>
        </div>
      </header>
      <nav className="section-nav" aria-label="On this page">
        <div className="page-width">
          <a href="#today">Today</a>
          <a href="#schedule">Schedule</a>
          <a href="#updates">Live updates</a>
          <a href="#map">Campus map</a>
          <a href="#help">Help & FAQ</a>
        </div>
      </nav>
      <main id="main" className="page-width" tabIndex={-1}>
        {event.notice && (
          <p className="page-notice">
            <WarningCircle size={20} aria-hidden />
            <span>{event.notice}</span>
          </p>
        )}
        {stale && (
          <p role="alert" className="connection-warning">
            Updates are interrupted. Showing the last received information;
            times may have changed. Reconnecting automatically.
          </p>
        )}
        <section
          id="today"
          className="today-hero"
          aria-labelledby="event-heading"
        >
          <div className="event-heading">
            <p className="eyebrow">
              {eventDateLabel(event.date)} · Berkeley, CA
            </p>
            <h1 id="event-heading">
              {event.title} <span>Live</span>
            </h1>
          </div>
          <div className="hero-grid">
            <div className="now-block">
              <p className="eyebrow">
                {phase === "before"
                  ? "Before you arrive"
                  : phase === "after"
                    ? "Event complete"
                    : current
                      ? "Scheduled now"
                      : "Your day at a glance"}
              </p>
              <h2>{headline}</h2>
              <p>{summary}</p>
              {current?.delay && (
                <p className="hero-delay">
                  Time updated
                  {current.delay.reason ? ` · ${current.delay.reason}` : ""}
                </p>
              )}
              <a className="primary-link" href="#schedule">
                View the schedule <ArrowRight aria-hidden size={18} />
              </a>
            </div>
            <aside className="next-block" aria-label="Next event">
              <Clock size={24} aria-hidden />
              <p className="eyebrow">
                {phase === "before" ? "First on the schedule" : "Up next"}
              </p>
              {next ? (
                <>
                  <h3>{next.title}</h3>
                  <p className="next-time">
                    {formatTime(next.startTime)} <span>Pacific</span>
                  </p>
                  <p>{next.location}</p>
                </>
              ) : (
                <>
                  <h3>
                    {phase === "unpublished"
                      ? "Details to follow"
                      : "No more scheduled events"}
                  </h3>
                  <p>Keep an eye on live updates for announcements.</p>
                </>
              )}
            </aside>
          </div>
        </section>
        <div className="quick-links">
          <a href="#map">
            <MapPin size={22} aria-hidden />
            <span>
              <strong>Find your building</strong>
              <span>Campus map & venue details</span>
            </span>
            <ArrowRight aria-hidden size={18} />
          </a>
          {event.travelUrl && (
            <a href={event.travelUrl}>
              <ArrowUpRight size={22} aria-hidden />
              <span>
                <strong>Getting here & going home</strong>
                <span>Plan your trip with TakeTransit</span>
              </span>
              <ArrowUpRight aria-hidden size={18} />
            </a>
          )}
          <a href="#help">
            <WarningCircle size={22} aria-hidden />
            <span>
              <strong>Need a hand?</strong>
              <span>Wi-Fi, help & common questions</span>
            </span>
            <ArrowRight aria-hidden size={18} />
          </a>
        </div>
        <div className="day-grid">
          <section
            id="schedule"
            className="content-section"
            aria-labelledby="schedule-heading"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Plan your day</p>
                <h2 id="schedule-heading">Schedule</h2>
              </div>
              <span>All times Pacific</span>
            </div>
            {events.length === 0 && (
              <p className="empty-copy">
                The schedule will appear here when it is ready.
              </p>
            )}
            <ol className="agenda">
              {events.map((item) => {
                const original = schedule.find(
                  (entry) => entry.id === item.id,
                )!;
                const changed =
                  item.startTime !== original.startTime ||
                  item.endTime !== original.endTime;
                return (
                  <li
                    key={item.id}
                    className={current?.id === item.id ? "agenda-current" : ""}
                  >
                    <div className="agenda-time">
                      <span>{formatTime(item.startTime)}</span>
                      <span>{formatTime(item.endTime)}</span>
                    </div>
                    <div className="agenda-body">
                      <div className="agenda-title">
                        <h3>{item.title}</h3>
                        {current?.id === item.id && (
                          <span className="now-label">Scheduled now</span>
                        )}
                      </div>
                      <p className="agenda-location">
                        <MapPin aria-hidden size={15} />
                        {item.location}
                      </p>
                      {changed && (
                        <p className="time-change">
                          Time updated · was{" "}
                          <s>
                            {formatTime(original.startTime)} –{" "}
                            {formatTime(original.endTime)}
                          </s>
                        </p>
                      )}
                      {item.delay?.reason && (
                        <p className="time-change">{item.delay.reason}</p>
                      )}
                      {item.description && (
                        <details className="event-details">
                          <summary>Event details</summary>
                          <p>{item.description}</p>
                        </details>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
          <section
            id="updates"
            className="content-section updates-section"
            aria-labelledby="updates-heading"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">From the organizers</p>
                <h2 id="updates-heading">Live updates</h2>
              </div>
              <Megaphone size={22} aria-hidden />
            </div>
            <p className="refresh-status">
              {stale
                ? "Reconnecting · updates may be out of date"
                : "Refreshes automatically every 5 seconds"}
            </p>
            <Updates announcements={announcements} timeZone={event.timeZone} />
            <div className="subscribe-panel">
              <EmailSubscribe />
            </div>
          </section>
        </div>
        <section
          id="map"
          className="content-section map-section"
          aria-labelledby="map-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Around campus</p>
              <h2 id="map-heading">Find your building</h2>
            </div>
            <a href="https://www.berkeley.edu/map/">
              UC Berkeley map <ArrowUpRight aria-hidden size={16} />
            </a>
          </div>
          <p className="section-intro">
            Use the map for campus orientation. Room assignments come from your
            coach; indoor and step-free routes are not yet available here.
          </p>
          <div className="map-layout">
            <div className="campus-map">
              <Suspense
                fallback={<p className="empty-copy">Loading campus map…</p>}
              >
                <CampusMap />
              </Suspense>
            </div>
            <div className="venue-list">
              {venues.map((venue) => (
                <details key={venue.id}>
                  <summary>{venue.name}</summary>
                  <p>{venue.description}</p>
                  {venue.floor && <p>{venue.floor}</p>}
                </details>
              ))}
            </div>
          </div>
        </section>
        <section
          id="help"
          className="content-section help-section"
          aria-labelledby="help-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">A little help</p>
              <h2 id="help-heading">Good to know</h2>
            </div>
          </div>
          <dl className="help-grid">
            {info.map((item) => (
              <div key={item.id}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
          {event.faqs.length > 0 && (
            <div className="faq-section">
              <h3>Frequently asked questions</h3>
              {event.faqs.map((faq, index) => (
                <details key={index}>
                  <summary>{faq.question}</summary>
                  <div className="prose-copy">
                    <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                      {faq.answer}
                    </Markdown>
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </main>
      <footer className="page-width site-footer">
        <span>Berkeley Math Tournament · Student-run at UC Berkeley</span>
        <div>
          <a href={event.eventUrl}>
            BMT website <ArrowUpRight aria-hidden size={14} />
          </a>
          <a href="/classic">Classic view</a>
          <a href="/admin">Staff tools</a>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  const { data, stale, error, refresh } = useLiveData();
  if (data?.event) return <Today data={data} stale={stale} />;
  return (
    <main className="today-page loading-page">
      <img
        src="/bmt-logo.svg"
        alt="Berkeley Math Tournament"
        width="56"
        height="56"
      />
      <h1>BMT Live</h1>
      <p role="status">
        {error
          ? "We couldn’t load the live page. Check your connection and try again."
          : data
            ? "Event details are not available. The server needs the matching content update."
            : "Loading your tournament day…"}
      </p>
      {error || data ? (
        <>
          <button className="primary-link" onClick={refresh}>
            Try again
          </button>
          <a href="/classic">Open classic view</a>
        </>
      ) : (
        <div className="loading-skeleton" aria-hidden>
          <div />
          <div />
          <div />
        </div>
      )}
    </main>
  );
}
