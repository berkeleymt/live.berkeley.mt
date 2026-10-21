import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useLiveData } from '../data/useLiveData';
import { publicDestination } from '../data/publicNavigation';
import { destinationLabel, destinationLinks, usePublicData, type PublicContext } from '../data/publicContext';
import { SiteImage, siteText, useSite } from '../features/site';
import { SiteTextContext } from '../features/site/text';
import type { SiteLink } from '../features/site/config';
import { usePages } from '../features/pages/usePages';
import { pageNavigation } from '../features/pages/model';
import '../today.css';
import '../public.css';

const DocumentNavigationContext = createContext<string[]>(['/lost-found']);
function requiresDocumentNavigation(to: string, pathname: string, reportRoutes: string[]) {
  return reportRoutes.includes(pathname) || reportRoutes.includes(to.split(/[?#]/, 1)[0]);
}
export function PublicLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const to = publicDestination(href);
  const reportRoutes = useContext(DocumentNavigationContext);
  // Enter/leave reports with document navigation, so Back and shell links retain the private-draft beforeunload guard.
  const { pathname } = useLocation();
  return to.startsWith('/') && !to.startsWith('//') && !requiresDocumentNavigation(to, pathname, reportRoutes)
    ? <Link to={to} className={className}>{children}</Link>
    : <a href={to} className={className}>{children}</a>;
}
function NavigationLink({ link }: { link: SiteLink }) {
  const { pathname } = useLocation();
  const reportRoutes = useContext(DocumentNavigationContext);
  return !requiresDocumentNavigation(link.href, pathname, reportRoutes) && link.href.startsWith('/') && !link.href.startsWith('//')
    ? <NavLink to={link.href} end>{link.label}</NavLink>
    : <a href={link.href} aria-current={link.href === pathname ? 'page' : undefined}>{link.label}</a>;
}

/** Pure shell also used by static-render tests. Only PublicFrame starts network loops. */
export function PublicLayout({ context, children }: { context: PublicContext; children: ReactNode }) {
  const { site, live, pages } = context;
  const { content } = site;
  const { pathname, hash, key } = useLocation();
  const main = useRef<HTMLElement>(null);
  const focused = useRef('');
  const t = (name: string) => siteText(content, name);
  const links = pageNavigation(pages?.document, destinationLinks(content));
  const authored = Object.values(pages?.document?.pages ?? {}).find(page => page.meta.route === pathname);
  const reportRoutes = ['/lost-found', ...Object.values(pages?.document?.pages ?? {}).filter(page => page.parts.some(part => part.kind === 'block' && part.name === 'report_form')).map(page => page.meta.route)];
  const documentNavigation = reportRoutes.includes(pathname);
  const title = authored?.meta.title ?? destinationLabel(content, pathname);
  useEffect(() => { document.title = `${title} · ${content.branding.shortTitle}`; }, [title, content.branding.shortTitle]);
  useEffect(() => {
    // Once per location, never on a polling update or when someone has started typing.
    if (focused.current === key || (pages && !pages.document)) return;
    let anchor: HTMLElement | null = null;
    try { anchor = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null; } catch { /* malformed saved fragment */ }
    if (hash && !anchor && !site.document) return; // Deep guide links wait for published content.
    focused.current = key;
    const target = anchor ?? main.current?.querySelector<HTMLElement>('h1') ?? main.current;
    target?.setAttribute('tabindex', '-1');
    target?.focus({ preventScroll: true });
    if (anchor) anchor.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [key, hash, site.document, pages]);
  return <SiteTextContext.Provider value={content}><DocumentNavigationContext.Provider value={reportRoutes}><div className="public-hub" data-authored-report={documentNavigation ? '' : undefined}>
    <a className="skip-link" href="#main">{t('a11y.skip')}</a>
    <header className="public-header"><div className="public-width public-header-inner">
      <PublicLink href="/" className="public-brand"><SiteImage src={content.branding.logoUrl} alt={content.branding.logoAlt} unavailable={t('guide.imageUnavailable')} /><span>{content.branding.shortTitle}<small>{content.branding.caption}</small></span></PublicLink>
    </div></header>
    <nav className="public-nav public-width" aria-label={t('a11y.navigation')} onClick={event => { if ((event.target as HTMLElement).closest('a')) (event.target as HTMLElement).closest('details')?.removeAttribute('open'); }}>
      {links.slice(0, 3).map(link => <NavigationLink key={link.id} link={link} />)}
      {links.length > 3 && <details className="public-more" key={key} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary>{links.slice(3).find(link => link.href === pathname)?.label ?? t('nav.more')}</summary><div>{links.slice(3).map(link => <NavigationLink key={link.id} link={link} />)}</div></details>}
    </nav>
    <main className={`public-width public-main${authored?.meta.layout === 'wide' ? ' public-main-wide' : ''}`}  id="main" ref={main} tabIndex={-1}>
      {live.data?.event.notice && <p className="public-notice">{live.data.event.notice}</p>}
      {!site.document && <div className="public-notice" role="status"><p>{t(site.error ? 'hub.siteError' : 'hub.sitePending')}</p>{site.error && <button onClick={site.refresh}>{t('loading.retry')}</button>}</div>}
      {site.stale && <div className="public-notice" role="status"><p>{t('guide.stale')}</p><button onClick={site.refresh}>{t('loading.retry')}</button></div>}
      {children}
    </main>
    <footer className="public-width public-footer">
      <p>{t('footer.credit')}</p>
      <div className="public-footer-tools"><PublicLink href={live.data?.event.eventUrl || content.branding.homeUrl}>{t('footer.website')}</PublicLink><PublicLink href="/classic">{t('footer.classic')}</PublicLink><PublicLink href="/admin">{t('footer.staff')}</PublicLink></div>
    </footer>
  </div></DocumentNavigationContext.Provider></SiteTextContext.Provider>;
}

/** A page publication must never unmount a memory-only private report draft. */
export function PublicFrameContent({ context }: { context: PublicContext }) {
  const { pathname, search, hash } = useLocation();
  const document = context.pages?.document;
  const [held, setHeld] = useState({ pathname, document });
  const reportOpen = held.pathname === pathname && !!held.document && (pathname === '/lost-found' || Object.values(held.document.pages).some(page => page.meta.route === pathname && page.parts.some(part => part.kind === 'block' && part.name === 'report_form')));
  // Adjust before children render, rather than letting an effect unmount/remount the form.
  if (!reportOpen && (held.pathname !== pathname || held.document !== document)) setHeld({ pathname, document });
  const safeContext = reportOpen && context.pages ? { ...context, pages: { ...context.pages, document: held.document ?? null } } : context;
  const changed = reportOpen && document?.revision !== held.document?.revision;
  return <PublicLayout context={safeContext}>
    {changed && <p className="public-notice" role="status">This page changed. Your report stays open here. <a href={`${pathname}${search}${hash}`}>Reload the page after finishing your report</a>.</p>}
    <Outlet context={safeContext} />
  </PublicLayout>;
}

export function PublicFrame() {
  const site = useSite();
  const live = useLiveData();
  const pages = usePages();
  return <PublicFrameContent context={{ site, live, pages }} />;
}

export function LiveStatus() {
  const { site, live } = usePublicData();
  const t = (key: string) => siteText(site.content, key);
  if (live.data && !live.stale) return null;
  return <div className="public-notice" role="status">
    <p>{t(live.data ? 'status.stale' : live.error ? 'hub.liveError' : 'hub.livePending')}</p>
    {live.lastReceived && <p>{siteText(site.content, 'hub.lastReceived', { time: new Date(live.lastReceived).toLocaleTimeString() })}</p>}
    {(live.error || live.stale) && <button onClick={live.refresh}>{t('loading.retry')}</button>}
  </div>;
}

export function PageHeading({ path, intro }: { path: string; intro?: string }) {
  const { site } = usePublicData();
  return <header className="public-page-heading"><h1>{destinationLabel(site.content, path)}</h1>{intro && <p>{intro}</p>}</header>;
}
