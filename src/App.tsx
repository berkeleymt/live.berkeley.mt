import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { eventDateLabel, scheduleState } from './data/schedule';
import { formatTime, timeZoneLabel, toMins } from './data/utils';
import { publicDestination } from './data/publicNavigation';
import { EmailSubscribe } from './components/InfoCard';
import { LiveStatus, PageHeading, PublicLink } from './components/PublicFrame';
import { destinationLinks, usePublicData } from './data/publicContext';
import { GuideContent, SafeSiteMarkdown, SiteImage, siteText } from './features/site';
import { RoomFinder } from './features/wayfinding';
import type { Announcement } from './data/types';

function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function LiveMarkdown({ children }: { children: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    h1: ({ children }) => <h4>{children}</h4>,
    h2: ({ children }) => <h4>{children}</h4>,
    a: ({ href, children }) => <a href={href ? publicDestination(href) : undefined}>{children}</a>,
  }}>{children}</Markdown>;
}

export function UpdateList({ announcements, limit }: { announcements: Announcement[]; limit?: number }) {
  const Heading = limit ? 'h3' : 'h2';
  const { site, live } = usePublicData();
  const [all, setAll] = useState(false);
  const t = (key: string) => siteText(site.content, key);
  const sorted = [...announcements].sort((a, b) =>
    Number(b.priority === 'urgent') - Number(a.priority === 'urgent') ||
    Number(!!b.pinned) - Number(!!a.pinned) ||
    Date.parse(b.scheduledAt ?? b.timestamp) - Date.parse(a.scheduledAt ?? a.timestamp));
  const visible = limit ? sorted.slice(0, limit) : all ? sorted : sorted.filter((item, index) => index < 5 || item.pinned || item.priority === 'urgent');
  return <>
    {!sorted.length && <p>{t('updates.empty')}</p>}
    {visible.map(item => <article key={item.id} className={`public-update ${item.priority === 'urgent' ? 'public-urgent' : ''}`}>
      <div className="public-meta">{item.priority === 'urgent' && <strong>{t('updates.urgent')}</strong>}{item.pinned && <span>{t('updates.pinned')}</span>}
        <time dateTime={item.scheduledAt ?? item.timestamp}>{new Intl.DateTimeFormat('en-US', { timeZone: live.data?.event.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(item.scheduledAt ?? item.timestamp))}</time>
      </div>
      <Heading>{item.title}</Heading>
      <div className="prose-copy"><LiveMarkdown>{item.body}</LiveMarkdown></div>
    </article>)}
    {!limit && sorted.length > visible.length && <button onClick={() => setAll(true)}>{siteText(site.content, 'updates.older', { count: sorted.length - visible.length })}</button>}
  </>;
}

export function NowNext() {
  const { live, site } = usePublicData();
  const now = useNow();
  if (!live.data) return null;
  const { schedule, delays, event } = live.data;
  const { phase, current, next } = scheduleState(schedule, delays, event, now);
  const t = (key: string) => siteText(site.content, key);
  if (phase === 'before' && next) return <section className="public-now" aria-labelledby="now-heading"><div>
    <p className="public-meta">{eventDateLabel(event.date)} · {t('hero.firstLabel')}</p><h2 id="now-heading">{next.title}</h2>
    <p>{formatTime(next.startTime)} · {next.location}</p>
    {next.delay && <p className="time-change">{t('status.timeUpdated')}{next.delay.reason && ` · ${next.delay.reason}`}</p>}
    <PublicLink href="/schedule">{t('hero.scheduleAction')}</PublicLink>
  </div></section>;
  const headline = phase === 'unpublished' ? t('hero.unpublished') : phase === 'before' ? t('hero.before') : current?.title ?? (next ? t('hero.nextPrefix') + next.title : t('hero.after'));
  const summary = phase === 'unpublished' ? t('hero.unpublishedSummary') : phase === 'before' ? event.subtitle : current ? `${formatTime(current.startTime)} – ${formatTime(current.endTime)} · ${current.location}` : next ? `${formatTime(next.startTime)} · ${next.location}` : siteText(site.content, 'hero.afterSummary', { eventTitle: event.title });
  return <section className="public-now" aria-labelledby="now-heading">
    <div><p className="public-meta">{t(phase === 'before' ? 'hero.beforeLabel' : phase === 'after' ? 'hero.afterLabel' : current ? 'hero.nowLabel' : 'hero.overviewLabel')}</p><h2 id="now-heading">{headline}</h2><p>{summary}</p>
      {current?.delay && <p className="time-change">{t('status.timeUpdated')}{current.delay.reason && ` · ${current.delay.reason}`}</p>}
      <PublicLink href="/schedule">{t('hero.scheduleAction')}</PublicLink>
    </div>
    {next && <aside aria-label={t('a11y.next')}><p className="public-meta">{t(phase === 'before' ? 'hero.firstLabel' : 'hero.nextLabel')}</p><h3>{next?.title ?? t(phase === 'unpublished' ? 'hero.noDetails' : 'hero.noMoreEvents')}</h3>
      {next ? <><p>{formatTime(next.startTime)} · {timeZoneLabel(event.timeZone, event.date)}</p><p>{next.location}</p>{next.delay && <p className="time-change">{t('status.timeUpdated')}{next.delay.reason && ` · ${next.delay.reason}`}</p>}</> : <p>{t('hero.nextEmpty')}</p>}
    </aside>}
  </section>;
}

export default function App() {
  const { site, live } = usePublicData();
  const { hash, search } = useLocation();
  const legacy = publicDestination(`/${hash}`);
  const t = (key: string) => siteText(site.content, key);
  if (hash && legacy !== `/${hash}`) return <Navigate to={`${legacy}${search}`} replace />;
  const announcements = live.data?.announcements ?? [];
  const urgent = announcements.filter(item => item.priority === 'urgent');
  return <>
    <header className="public-page-heading"><p className="public-meta">{live.data ? `${eventDateLabel(live.data.event.date)} · ${live.data.event.timeZone}` : site.content.branding.caption}</p><h1>{live.data?.event.title ?? t('hub.title')}</h1><p>{t('hub.intro')}</p></header>
    <LiveStatus />
    {!!urgent.length && <section className="public-section" aria-label={t('updates.urgent')}><h2>{t('updates.urgent')}</h2><UpdateList announcements={urgent} limit={1} /><PublicLink href="/updates">{t('hub.allUpdates')}</PublicLink></section>}
    <NowNext />
    <section className="public-section" aria-labelledby="destinations-heading"><h2 id="destinations-heading">{t('hub.destinations')}</h2><ul className="public-destinations">{destinationLinks(site.content).filter(link => link.href !== '/').map((link, index) => <li key={`${link.id}-${index}`}><PublicLink href={link.href}>{link.label}</PublicLink></li>)}</ul></section>
    {live.data && <section className="public-section"><h2>{t('hub.latest')}</h2><UpdateList announcements={announcements.filter(item => item.priority !== 'urgent')} limit={2} /><PublicLink href="/updates">{t('hub.allUpdates')}</PublicLink></section>}
    {live.data?.event.travelUrl && <p className="public-section"><PublicLink href={live.data.event.travelUrl}>{t('quick.travelTitle')} · {t('quick.travelDescription')}</PublicLink></p>}
    {site.document && site.content.hero.imageUrl && <div className="public-cover"><SiteImage key={site.content.hero.imageUrl} src={site.content.hero.imageUrl} alt={site.content.hero.imageAlt} unavailable={t('guide.imageUnavailable')} /></div>}
  </>;
}

export function SchedulePage() {
  const { live } = usePublicData();
  return <><PageHeading path="/schedule" intro={live.data ? `${eventDateLabel(live.data.event.date)} · ${live.data.event.timeZone}` : undefined} /><ScheduleBlock /></>;
}

export function ScheduleBlock() {
  const { site, live } = usePublicData();
  const now = useNow();
  const t = (key: string) => siteText(site.content, key);
  const data = live.data;
  const state = data ? scheduleState(data.schedule, data.delays, data.event, now) : null;
  return <><LiveStatus /><p className="public-meta">{data ? `${eventDateLabel(data.event.date)} · ${timeZoneLabel(data.event.timeZone, data.event.date)}` : ''}</p>
    {state && <>
      {state.current && <a href={`#event-${state.current.id}`}>{t('schedule.jump')}</a>}
      {!state.events.length && <p>{t('schedule.empty')}</p>}
      <ol className="public-agenda">{state.events.map(item => {
        const original = data!.schedule.find(entry => entry.id === item.id)!;
        const changed = item.startTime !== original.startTime || item.endTime !== original.endTime;
        const active = state.phase === 'today' && toMins(item.startTime) <= state.minutes && toMins(item.endTime) > state.minutes;
        const completed = state.phase === 'after' || (state.phase === 'today' && toMins(item.endTime) <= state.minutes);
        return <li id={`event-${item.id}`} key={item.id} className={active ? 'public-active-event' : ''}>
          <div className="public-agenda-time"><span>{formatTime(item.startTime)}</span><span>{formatTime(item.endTime)}</span></div>
          <div>{(active || completed) && <p className="public-meta">{t(active ? 'hero.nowLabel' : 'schedule.completed')}</p>}<h2>{item.title}</h2><p>{item.location}</p>
            {changed && <p className="time-change">{t('status.timeWas')} <s>{formatTime(original.startTime)} – {formatTime(original.endTime)}</s></p>}
            {item.delay?.reason && <p className="time-change">{item.delay.reason}</p>}
            {item.description && <details><summary>{t('schedule.details')}</summary><p>{item.description}</p></details>}
          </div>
        </li>;
      })}</ol>
    </>}
  </>;
}

export function UpdatesPage() {
  const { site, live } = usePublicData();
  return <><PageHeading path="/updates" /><LiveStatus />{live.data && <><p className="public-meta">{siteText(site.content, live.stale ? 'status.reconnecting' : 'status.refresh')}</p><UpdateList announcements={live.data.announcements} /></>}<div className="subscribe-panel"><EmailSubscribe site={site.content} /></div></>;
}

export function HelpPage() {
  const { site } = usePublicData();
  return <><PageHeading path="/help" />
    <nav className="public-destinations" aria-label={siteText(site.content, 'hub.helpLinks')}>{destinationLinks(site.content).filter(link => ['/guide', '/faq', '/lost-found'].includes(link.href)).map(link => <PublicLink key={link.href} href={link.href}>{link.label}</PublicLink>)}</nav>
    {site.document && <div className="bmt-site public-help">{site.content.help.map(item => <section key={item.id} id={item.id}><h2>{item.title}</h2><SafeSiteMarkdown>{item.markdown}</SafeSiteMarkdown></section>)}</div>}
  </>;
}

export function FaqPage() {
  const { site, live } = usePublicData();
  const [query, setQuery] = useState('');
  const t = (key: string) => siteText(site.content, key);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const faqs = live.data?.event.faqs ?? [];
  const matches = faqs.filter(faq => terms.every(term => `${faq.question} ${faq.answer}`.toLocaleLowerCase().includes(term)));
  return <><PageHeading path="/faq" /><LiveStatus />{live.data && <>
    <label className="public-search" htmlFor="faq-search">{t('faq.search')}<input id="faq-search" type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {!matches.length && <p role="status">{t(faqs.length ? 'faq.empty' : 'faq.notPublished')}</p>}
    <div className="public-faq">{matches.map(faq => <details key={faq.question}><summary>{faq.question}</summary><div className="prose-copy"><LiveMarkdown>{faq.answer}</LiveMarkdown></div></details>)}</div>
    <PublicLink href="/help">{siteText(site.content, 'help.title')}</PublicLink>
  </>}</>;
}

export function PublicGuidePage() {
  const { site } = usePublicData();
  return site.document ? <GuideContent content={site.content} embedded /> : <PageHeading path="/guide" />;
}

export function MapPage() {
  const { site } = usePublicData();
  const campusMap = site.content.usefulLinks.find(link => link.id === 'campus-map');
  return <><PageHeading path="/map" intro={site.document ? siteText(site.content, 'map.intro') : undefined} />
    {site.document && campusMap && <PublicLink href={campusMap.href}>{campusMap.label}</PublicLink>}
    <RoomFinder embedded mapOnly />
  </>;
}
