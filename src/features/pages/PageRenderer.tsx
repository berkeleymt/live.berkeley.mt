import { useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Navigate, useLocation } from 'react-router-dom';
import { NowNext, ScheduleBlock, UpdateList } from '../../App';
import { LiveStatus } from '../../components/PublicFrame';
import { usePublicData } from '../../data/publicContext';
import { publicDestination } from '../../data/publicNavigation';
import { RoomFinder, RoomLookup } from '../wayfinding/RoomFinder';
import { EmailSubscribe } from '../../components/InfoCard';
import { LostFoundPage } from '../lost-found';
import { SiteImage } from '../site';
import { isImageUrl } from '../site/config';
import { isPageLink, type BlockName, type Page } from './model';
import './pages.css';

function Announcements() {
  const { live } = usePublicData();
  return <><LiveStatus />{live.data && <UpdateList announcements={live.data.announcements} />}</>;
}
function CurrentEvents() { return <><LiveStatus /><NowNext /></>; }
function UrgentUpdates() {
  const { live } = usePublicData();
  const urgent = live.data?.announcements.filter(item => item.priority === 'urgent') ?? [];
  return urgent.length ? <UpdateList announcements={urgent} /> : null;
}
function Subscribe() {
  const { site } = usePublicData();
  return <div className="subscribe-panel"><EmailSubscribe site={site.content} /></div>;
}
// Registry contains components, not arbitrary template evaluation or page-sized legacy wrappers.
const blocks: Record<BlockName, () => ReactNode> = {
  now_next: CurrentEvents,
  announcements: Announcements,
  urgent_updates: UrgentUpdates,
  subscribe: Subscribe,
  schedule: ScheduleBlock,
  room_lookup: RoomLookup,
  map: () => <RoomFinder embedded mapOnly composed />,
  report_form: () => <LostFoundPage helpHref="/help" embedded formOnly />,
};
export function PageRenderer({ page, preview = false }: { page: Page; preview?: boolean }) {
  const [query, setQuery] = useState('');
  const prefix = preview ? 'preview-' : '';
  const hasOutline = page.headings.length >= 4 && page.body.length > 1200;
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible = (index: number) => {
    const part = page.parts[index];
    return part.kind !== 'markdown' || terms.every(term => part.source.toLocaleLowerCase().includes(term));
  };
  const contents = <nav aria-label="On this page"><ol>{page.headings.filter(h => visible(h.part)).map(h => <li key={h.id}><a href={`#${prefix}${h.id}`}>{h.title}</a></li>)}</ol></nav>;
  return <article className={`authored-page authored-${page.meta.layout === 'wide' ? 'wide' : 'reading'}`}>
    <header className="public-page-heading"><h1>{page.meta.title}</h1></header>
    <div className="authored-layout">
      {hasOutline && <aside className="authored-contents">
        <div className="authored-desktop-toc"><h2>On this page</h2>{contents}</div>
        <details className="authored-mobile-toc"><summary>On this page</summary>{contents}</details>
      </aside>}
      <div className="authored-body">
        {terms.length > 0 && !page.parts.some((part, index) => part.kind === 'markdown' && visible(index)) && <p role="status">No matching text. <button onClick={() => setQuery('')}>Clear search</button></p>}
        {page.parts.map((part, index) => {
          if (!visible(index)) return null;
          if (part.kind === 'button') return isPageLink(part.href) ? <p key={`button-${index}`} className="authored-action"><a href={publicDestination(part.href)} className="public-action" target={preview ? '_blank' : undefined} rel="noopener noreferrer">{part.label}<span aria-hidden>→</span></a></p> : null;
          if (part.kind === 'anchor') return <span key={`anchor-${part.id}`} id={`${prefix}${part.id}`} className="authored-anchor" />;
          if (part.kind === 'block') {
            if (preview) return <section key={`block-${part.name}`} className="authored-preview-block"><strong>{part.name.replaceAll('_', ' ')}</strong><p>Live block · disabled in preview</p></section>;
            const Block = blocks[part.name];
            return Block ? <div key={`block-${part.name}`} className={`authored-live-block authored-block-${part.name}`}><Block /></div> : null;
          }
          return <div key={index} className="authored-prose"><Markdown remarkPlugins={[remarkGfm]} skipHtml
            urlTransform={(url, key) => key === 'src' ? (isImageUrl(url) ? url : '') : (isPageLink(url) ? url : '')}
            components={{
              h1: ({ node, children }) => <h2 id={`${prefix}section-${index}-${node?.position?.start.line}`}>{children}</h2>,
              h2: ({ node, children }) => <h2 id={`${prefix}section-${index}-${node?.position?.start.line}`}>{children}</h2>,
              h3: ({ node, children }) => <h3 id={`${prefix}section-${index}-${node?.position?.start.line}`}>{children}</h3>,
              h4: ({ node, children }) => <h4 id={`${prefix}section-${index}-${node?.position?.start.line}`}>{children}</h4>,
              h5: ({ node, children }) => <h5 id={`${prefix}section-${index}-${node?.position?.start.line}`}>{children}</h5>,
              h6: ({ node, children }) => <h6 id={`${prefix}section-${index}-${node?.position?.start.line}`}>{children}</h6>,
              a: ({ href, children }) => href ? <a href={preview && href.startsWith('#') ? `#preview-${href.slice(1)}` : publicDestination(href)} target={preview && !href.startsWith('#') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
              img: ({ src, alt }) => typeof src === 'string' && src ? <SiteImage key={src} src={src} alt={alt ?? ''} /> : null,
            }}>{part.source}</Markdown></div>;
        })}
        {page.headings.length > 1 && <details className="authored-tools"><summary>Search & print</summary><label htmlFor={`${prefix}page-search`}>Search this page</label><input id={`${prefix}page-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} />{!preview && <button type="button" onClick={() => { setQuery(''); requestAnimationFrame(() => requestAnimationFrame(() => window.print())); }}>Print page</button>}</details>}
      </div>
    </div>
  </article>;
}

export function AuthoredRoute({ fallback }: { fallback?: ReactNode }) {
  const { pages } = usePublicData();
  const { pathname, hash, search } = useLocation();
  // Old homepage fragments remain redirects even after Home becomes an authored page.
  const legacy = publicDestination(`/${hash}`);
  if (pathname === '/' && hash && legacy !== `/${hash}`) return <Navigate to={`${legacy}${search}`} replace />;
  if (!pages?.document) return <section className="public-notice" role={pages?.error ? 'alert' : 'status'}><h1>{pages?.error ? 'Published pages could not load' : 'Loading published pages…'}</h1>{pages?.error && <><p>No example page is being shown as current content.</p><button onClick={pages.refresh}>Try again</button></>}</section>;
  const page = Object.values(pages.document.pages).find(page => page.meta.route === pathname);
  return <>{pages.error && <p className="public-notice" role="status">Showing last good pages. <button onClick={pages.refresh}>Retry</button></p>}{page ? <PageRenderer key={pathname} page={page} /> : fallback ?? <section><h1>Page not found</h1><p>This page is not published.</p><a href="/">Return home</a></section>}</>;
}
