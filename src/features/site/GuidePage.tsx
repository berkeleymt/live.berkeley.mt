import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, MagnifyingGlass, Printer } from '@phosphor-icons/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isImageUrl, isLinkUrl, searchGuide } from './config';
import type { SiteConfig } from './config';
import { siteText } from './defaults';
import { useSite } from './useSite';
import './site.css';

export function SiteImage({ src, alt, unavailable = 'Image unavailable' }: { src: string; alt: string; unavailable?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || !isImageUrl(src)) return null;
  if (failed) return <span className="bmt-site-image-error" role="status">{unavailable}: {alt}</span>;
  return <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

/** No raw HTML, unsafe URL schemes, arbitrary local paths, or rehype-raw. */
export function SafeSiteMarkdown({ children, imageUnavailable }: { children: string; imageUnavailable?: string }) {
  return <div className="bmt-site-prose"><Markdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={(url, key) => key === 'src' ? (isImageUrl(url) ? url : '') : (isLinkUrl(url) ? url : '')}
    components={{
      h1: ({ children }) => <h3>{children}</h3>,
      h2: ({ children }) => <h3>{children}</h3>,
      a: ({ href, children }) => href ? <a href={href} rel={href.startsWith('https:') ? 'noopener noreferrer' : undefined}>{children}</a> : <span>{children}</span>,
      img: ({ src, alt }) => typeof src === 'string' && src ? <SiteImage key={src} src={src} alt={alt ?? ''} unavailable={imageUnavailable} /> : null,
    }}>{children}</Markdown></div>;
}

/** Shared real renderer used by the public page and the editor preview. */
export function GuideContent({ content, preview = false }: { content: SiteConfig; preview?: boolean }) {
  const [query, setQuery] = useState('');
  const sections = searchGuide(content.guide.sections, query);
  const t = (key: string, values?: Record<string, string | number>) => siteText(content, key, values);
  return <div className={`bmt-site bmt-site-guide ${preview ? 'bmt-site-preview' : ''}`}>
    {!preview && <a className="bmt-site-skip" href="#guide-main">{t('a11y.skip')}</a>}
    {!preview && <header className="bmt-site-guide-header">
      <a href={isLinkUrl(content.branding.homeUrl) ? content.branding.homeUrl : undefined} className="bmt-site-brand">
        <SiteImage key={content.branding.logoUrl} src={content.branding.logoUrl} alt={content.branding.logoAlt} unavailable={t('guide.imageUnavailable')} />
        <span>{content.branding.title}<small>{content.branding.caption}</small></span>
      </a>
      <a href="/" className="bmt-site-back"><ArrowLeft aria-hidden size={18} />{t('guide.back')}</a>
    </header>}
    <main id={preview ? undefined : 'guide-main'} tabIndex={preview ? undefined : -1}>
      <div className="bmt-site-guide-heading">
        <div><h1>{content.guide.title}</h1><p>{content.guide.intro}</p></div>
        {!preview && <button type="button" className="bmt-site-secondary bmt-site-print" onClick={() => { setQuery(''); requestAnimationFrame(() => requestAnimationFrame(() => window.print())); }}><Printer aria-hidden size={18} />{t('guide.print')}</button>}
      </div>
      {content.guide.notice && <p className="bmt-site-notice">{content.guide.notice}</p>}
      <div className="bmt-site-guide-layout">
        <aside className="bmt-site-toc">
          <div className="bmt-site-guide-search"><label htmlFor={preview ? 'guide-preview-search' : 'guide-search'}>{t('guide.search')}</label>
            <div><MagnifyingGlass aria-hidden size={18} /><input id={preview ? 'guide-preview-search' : 'guide-search'} type="search" value={query} placeholder={t('guide.searchPlaceholder')} onChange={event => setQuery(event.target.value)} /></div>
          </div>
          <nav aria-label={t('guide.contents')}><h2>{t('guide.contents')}</h2><ol>{sections.map(section => <li key={section.id}><a href={`#${preview ? 'preview-' : ''}guide-${section.id}`}>{section.title}</a></li>)}</ol></nav>
        </aside>
        <div className="bmt-site-guide-body">
          {query.trim() && <p className="bmt-site-search-results" role="status">{t('guide.results', { count: sections.length })}</p>}
          {sections.length === 0 && <div className="bmt-site-empty"><p>{content.guide.sections.length ? t('guide.empty') : t('guide.notPublished')}</p>{query && <button type="button" className="bmt-site-secondary" onClick={() => setQuery('')}>{t('guide.clear')}</button>}</div>}
          {sections.map(section => <section key={section.id} id={`${preview ? 'preview-' : ''}guide-${section.id}`} aria-labelledby={`${preview ? 'preview-' : ''}heading-${section.id}`}>
            <h2 id={`${preview ? 'preview-' : ''}heading-${section.id}`}>{section.title}</h2>
            <SafeSiteMarkdown imageUnavailable={t('guide.imageUnavailable')}>{section.markdown}</SafeSiteMarkdown>
            <SiteImage key={section.imageUrl} src={section.imageUrl} alt={section.imageAlt} unavailable={t('guide.imageUnavailable')} />
          </section>)}
          {content.help.length > 0 && <section aria-label={t('guide.help')}><h2>{t('guide.help')}</h2><div className="bmt-site-help-grid">{content.help.map(block => <article key={block.id} className={block.kind === 'emergency' ? 'bmt-site-emergency' : ''}><h3>{block.title}</h3><SafeSiteMarkdown imageUnavailable={t('guide.imageUnavailable')}>{block.markdown}</SafeSiteMarkdown></article>)}</div></section>}
          {content.usefulLinks.length > 0 && <section><h2>{t('guide.links')}</h2><ul className="bmt-site-useful-links">{content.usefulLinks.map(link => <li key={link.id}><a href={isLinkUrl(link.href) ? link.href : undefined}>{link.label}{link.href.startsWith('https://') && <ArrowUpRight aria-hidden size={16} />}</a></li>)}</ul></section>}
        </div>
      </div>
    </main>
    {!preview && <footer className="bmt-site-guide-footer">{t('footer.credit')}<a href="/">{t('guide.back')}</a></footer>}
  </div>;
}

export function GuidePage() {
  const { content, document, loading, error, stale, refresh } = useSite();
  useEffect(() => { window.document.title = `${content.guide.title} · ${content.branding.shortTitle}`; }, [content.guide.title, content.branding.shortTitle]);
  if (!document) return <main className="bmt-site bmt-site-load"><h1>{content.guide.title}</h1><p role={error ? 'alert' : 'status'}>{siteText(content, loading ? 'guide.loading' : 'guide.error')}</p>{error && <button type="button" className="bmt-site-primary" onClick={refresh}>{siteText(content, 'loading.retry')}</button>}<a href="/">{siteText(content, 'guide.back')}</a></main>;
  return <>{stale && <div className="bmt-site bmt-site-stale" role="alert">{siteText(content, 'guide.stale')} <button type="button" onClick={refresh}>{siteText(content, 'loading.retry')}</button></div>}<GuideContent content={content} /></>;
}
