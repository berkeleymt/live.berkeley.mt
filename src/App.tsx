import { useEffect, useState } from "react";
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
import {
  SafeSiteMarkdown,
  SiteImage,
  siteText,
  useSite,
} from "./features/site";
import type { SiteConfig } from "./features/site/config";
import type { Announcement, LiveData } from "./data/types";
import "./today.css";

function Updates({
  announcements,
  timeZone,
  site,
}: {
  announcements: Announcement[];
  timeZone: string;
  site: SiteConfig;
}) {
  const [all, setAll] = useState(false);
  const t = (key: string) => siteText(site, key);
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
      {!sorted.length && <p className="empty-copy">{t("updates.empty")}</p>}
      {visible.map((item) => (
        <article
          key={item.id}
          className={`update ${item.priority === "urgent" ? "update-urgent" : ""}`}
        >
          <div className="update-meta">
            {item.priority === "urgent" && (
              <strong>{t("updates.urgent")}</strong>
            )}
            {item.pinned && <span>{t("updates.pinned")}</span>}
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
          {siteText(site, "updates.older", {
            count: sorted.length - visible.length,
          })}
          <ArrowRight aria-hidden size={16} />
        </button>
      )}
    </>
  );
}
function Today({
  data,
  stale,
  site,
}: {
  data: LiveData;
  stale: boolean;
  site: SiteConfig;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const { event, schedule, delays, announcements } = data;
  const t = (key: string) => siteText(site, key);
  const { phase, current, next, events } = scheduleState(
    schedule,
    delays,
    event,
    now,
  );
  const headline =
    phase === "unpublished"
      ? t("hero.unpublished")
      : phase === "before"
        ? t("hero.before")
        : current
          ? current.title
          : next
            ? t("hero.nextPrefix") + next.title
            : t("hero.after");
  const summary =
    phase === "unpublished"
      ? t("hero.unpublishedSummary")
      : phase === "before"
        ? event.subtitle
        : current
          ? `${formatTime(current.startTime)} – ${formatTime(current.endTime)} · ${current.location}`
          : next
            ? `${formatTime(next.startTime)} · ${next.location}`
            : siteText(site, "hero.afterSummary", { eventTitle: event.title });
  useEffect(() => {
    document.title = `${event.title} · Live`;
  }, [event.title]);
  return (
    <div className="today-page">
      <a href="#main" className="skip-link">
        {t("a11y.skip")}
      </a>
      <header className="site-header">
        <div className="page-width header-inner">
          <a href={site.branding.homeUrl} className="brand">
            <img
              src={site.branding.logoUrl}
              width="40"
              height="40"
              alt={site.branding.logoAlt}
            />
            <span>
              {site.branding.title}
              <span className="brand-caption">{site.branding.caption}</span>
            </span>
          </a>
          <a href="/staff/sign-in" className="staff-link">
            {t("staff.signIn")}
            <ArrowUpRight aria-hidden size={16} />
          </a>
        </div>
      </header>
      <nav className="section-nav" aria-label={t("a11y.navigation")}>
        <div className="page-width">
          {site.navigation.map((link) => (
            <a key={link.id} href={link.href}>
              {link.label}
            </a>
          ))}
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
            {t("status.stale")}
          </p>
        )}
        <section
          id="today"
          className="today-hero"
          aria-labelledby="event-heading"
        >
          <div className="event-heading">
            <p className="eyebrow">
              {eventDateLabel(event.date)} · {site.hero.location}
            </p>
            <h1 id="event-heading">
              {event.title} <span>{t("brand.live")}</span>
            </h1>
          </div>
          {site.hero.imageUrl && (
            <SiteImage
              key={site.hero.imageUrl}
              src={site.hero.imageUrl}
              alt={site.hero.imageAlt}
              unavailable={t("guide.imageUnavailable")}
            />
          )}
          <div className="hero-grid">
            <div className="now-block">
              <p className="eyebrow">
                {t(
                  phase === "before"
                    ? "hero.beforeLabel"
                    : phase === "after"
                      ? "hero.afterLabel"
                      : current
                        ? "hero.nowLabel"
                        : "hero.overviewLabel",
                )}
              </p>
              <h2>{headline}</h2>
              <p>{summary}</p>
              {current?.delay && (
                <p className="hero-delay">
                  {t("status.timeUpdated")}
                  {current.delay.reason ? ` · ${current.delay.reason}` : ""}
                </p>
              )}
              <a className="primary-link" href="#schedule">
                {t("hero.scheduleAction")}
                <ArrowRight aria-hidden size={18} />
              </a>
            </div>
            <aside className="next-block" aria-label={t("a11y.next")}>
              <Clock size={24} aria-hidden />
              <p className="eyebrow">
                {t(phase === "before" ? "hero.firstLabel" : "hero.nextLabel")}
              </p>
              {next ? (
                <>
                  <h3>{next.title}</h3>
                  <p className="next-time">
                    {formatTime(next.startTime)}{" "}
                    <span>{t("status.timeZone")}</span>
                  </p>
                  <p>{next.location}</p>
                </>
              ) : (
                <>
                  <h3>
                    {t(
                      phase === "unpublished"
                        ? "hero.noDetails"
                        : "hero.noMoreEvents",
                    )}
                  </h3>
                  <p>{t("hero.nextEmpty")}</p>
                </>
              )}
            </aside>
          </div>
        </section>
        <div className="quick-links">
          <a href="/rooms">
            <MapPin size={22} aria-hidden />
            <span>
              <strong>{t("quick.mapTitle")}</strong>
              <span>{t("quick.mapDescription")}</span>
            </span>
            <ArrowRight size={18} aria-hidden />
          </a>
          {event.travelUrl && (
            <a href={event.travelUrl}>
              <ArrowUpRight size={22} aria-hidden />
              <span>
                <strong>{t("quick.travelTitle")}</strong>
                <span>{t("quick.travelDescription")}</span>
              </span>
              <ArrowUpRight size={18} aria-hidden />
            </a>
          )}
          <a href="/lost-found">
            <WarningCircle size={22} aria-hidden />
            <span>
              <strong>{t("quick.helpTitle")}</strong>
              <span>{t("quick.helpDescription")}</span>
            </span>
            <ArrowRight size={18} aria-hidden />
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
                <p className="eyebrow">{t("schedule.eyebrow")}</p>
                <h2 id="schedule-heading">{t("schedule.title")}</h2>
              </div>
              <span>{t("schedule.timeZone")}</span>
            </div>
            {!events.length && (
              <p className="empty-copy">{t("schedule.empty")}</p>
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
                          <span className="now-label">
                            {t("hero.nowLabel")}
                          </span>
                        )}
                      </div>
                      <p className="agenda-location">
                        <MapPin aria-hidden size={15} />
                        {item.location}
                      </p>
                      {changed && (
                        <p className="time-change">
                          {t("status.timeWas")}{" "}
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
                          <summary>{t("schedule.details")}</summary>
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
                <p className="eyebrow">{t("updates.eyebrow")}</p>
                <h2 id="updates-heading">{t("updates.title")}</h2>
              </div>
              <Megaphone size={22} aria-hidden />
            </div>
            <p className="refresh-status">
              {t(stale ? "status.reconnecting" : "status.refresh")}
            </p>
            <Updates
              announcements={announcements}
              timeZone={event.timeZone}
              site={site}
            />
            <div className="subscribe-panel">
              <EmailSubscribe site={site} />
            </div>
          </section>
        </div>
        <section
          id="map"
          className="content-section"
          aria-labelledby="map-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t("map.eyebrow")}</p>
              <h2 id="map-heading">{t("map.title")}</h2>
            </div>
            <a
              href={
                site.usefulLinks.find((l) => l.id === "campus-map")?.href ??
                "https://www.berkeley.edu/map/"
              }
            >
              {t("map.externalLabel")}
              <ArrowUpRight aria-hidden size={16} />
            </a>
          </div>
          <p className="section-intro">{t("map.intro")}</p>
          <a className="primary-link" href="/rooms">
            {t("quick.mapDescription")}
            <ArrowRight aria-hidden size={18} />
          </a>
        </section>
        <section
          id="help"
          className="content-section help-section"
          aria-labelledby="help-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t("help.eyebrow")}</p>
              <h2 id="help-heading">{t("help.title")}</h2>
            </div>
          </div>
          <div className="help-grid">
            {site.help.map((item) => (
              <article key={item.id}>
                <h3>{item.title}</h3>
                <SafeSiteMarkdown
                  imageUnavailable={t("guide.imageUnavailable")}
                >
                  {item.markdown}
                </SafeSiteMarkdown>
              </article>
            ))}
          </div>
          {!!event.faqs.length && (
            <div className="faq-section">
              <h3>{t("help.faqTitle")}</h3>
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
        <span>{t("footer.credit")}</span>
        <div>
          <a href={event.eventUrl}>
            {t("footer.website")}
            <ArrowUpRight aria-hidden size={14} />
          </a>
          <a href="/classic">{t("footer.classic")}</a>
          <a href="/admin">{t("footer.staff")}</a>
        </div>
      </footer>
    </div>
  );
}
export default function App() {
  const { data, stale, error, refresh } = useLiveData();
  const site = useSite();
  const t = (key: string) => siteText(site.content, key);
  if (data?.event && site.document)
    return (
      <>
        <Today data={data} stale={stale || site.stale} site={site.content} />
        {site.stale && (
          <button className="text-button" onClick={site.refresh}>
            {t("loading.retry")}
          </button>
        )}
      </>
    );
  return (
    <main className="today-page loading-page">
      <img
        src={site.content.branding.logoUrl}
        alt={site.content.branding.logoAlt}
        width="56"
        height="56"
      />
      <h1>{t("loading.title")}</h1>
      <p role="status">
        {t(error || site.error ? "loading.failure" : "loading.pending")}
      </p>
      {(error || site.error) && (
        <button
          className="primary-link"
          onClick={() => {
            refresh();
            site.refresh();
          }}
        >
          {t("loading.retry")}
        </button>
      )}
      <a href="/classic">{t("loading.classic")}</a>
    </main>
  );
}
