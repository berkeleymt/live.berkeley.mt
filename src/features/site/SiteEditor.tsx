import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, DownloadSimple, Plus, UploadSimple } from '@phosphor-icons/react';
import { parseSiteConfig, parseSiteDocument } from './config';
import type { EditorDocument, GuideSection, HelpBlock, MediaAsset, MediaList, SiteConfig, SiteDocument, SiteLink } from './config';
import { SiteApiError, siteRequest as baseRequest } from './api';
import { useStaff } from '../staff';
import { GuideContent, SiteImage } from './GuidePage';
import { siteDefaults } from './defaults';
import { PublicCopyEditor } from './PublicCopyEditor';
import { publicNavigation } from '../../data/publicNavigation';
import { publicationBase } from '../../data/publication';
import { ContentComparison } from '../../components/ContentComparison';
import './site.css';

const draftKey = 'bmt-site-public-draft-v1';
const serialize = (content: SiteConfig) => JSON.stringify(content, null, 2) + '\n';
const tabs = ['Branding', 'Navigation', 'Public copy', 'Guide', 'Help', 'Useful links', 'Images', 'Raw JSON', 'Preview'] as const;
export type SiteSection = typeof tabs[number];
type Tab = SiteSection;
interface Backup { revision: string; raw: string }
function readBackup(): Backup | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
    if (value && typeof value === 'object' && 'revision' in value && 'raw' in value && typeof value.revision === 'string' && typeof value.raw === 'string') return { revision: value.revision, raw: value.raw };
  } catch { /* Browser storage may be disabled; in-memory drafts still work. */ }
  return null;
}
function download(raw: string, filename: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Field({ label, value, onChange, multiline = false, hint }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; hint?: string }) {
  const id = useId();
  return <div className="bmt-site-field"><label htmlFor={id}>{label}</label>{multiline ? <textarea id={id} value={value} rows={4} onChange={event => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} /> : <input id={id} value={value} onChange={event => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
function MoveButtons({ name, index, count, move, remove }: { name: string; index: number; count: number; move: (to: number) => void; remove: () => void }) {
  return <div className="bmt-site-item-actions"><button type="button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index - 1)}><ArrowUp aria-hidden size={18} /></button><button type="button" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => move(index + 1)}><ArrowDown aria-hidden size={18} /></button><button type="button" onClick={remove} aria-label={`Remove ${name}`}>Remove</button></div>;
}
function reorder<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
function LinksEditor({ links, onChange }: { links: SiteLink[]; onChange: (value: SiteLink[]) => void }) {
  return <><p>HTTPS links or known routes such as /schedule, /updates, /map, /rooms, /help, /faq, /guide and /lost-found. Old homepage anchors still work. IDs stay stable when labels change. Core public destinations stay reachable; edit their labels here.</p>{links.map((link, index) => <div className="bmt-site-editor-item" key={index}><h3>Link {index + 1}</h3><div className="bmt-site-fields-row">{(['id', 'label', 'href'] as const).map(key => <Field key={key} label={key === 'href' ? 'Destination URL' : key === 'id' ? 'Stable ID' : 'Label'} value={link[key]} onChange={value => onChange(links.map((item, i) => i === index ? { ...item, [key]: value } : item))} />)}</div><MoveButtons name={link.label || `link ${index + 1}`} index={index} count={links.length} move={to => onChange(reorder(links, index, to))} remove={() => onChange(links.filter((_, i) => i !== index))} /></div>)}<button type="button" className="bmt-site-secondary" onClick={() => onChange([...links, { id: `link-${crypto.randomUUID().slice(0, 8)}`, label: 'New link', href: '/guide' }])}><Plus aria-hidden size={18} />Add link</button></>;
}

/** Mount only inside the staff workspace; all endpoints also enforce authorization on the server. */
export function SiteEditor({ section }: { section?: SiteSection } = {}) {
  const { request } = useStaff();
  const siteRequest = useCallback((path: string, options?: RequestInit) => baseRequest(path, options, request), [request]);
  const [baseline, setBaseline] = useState<SiteDocument | null>(null);
  const [raw, setRaw] = useState('');
  const [selectedTab, setTab] = useState<Tab>('Branding');
  const tab = section ?? selectedTab;
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<SiteDocument | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaTruncated, setMediaTruncated] = useState(false);
  const [copyFilter, setCopyFilter] = useState('');
  const uploadInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const comparison = useRef<HTMLDivElement>(null);
  const reviewRequested = useRef(false);
  useEffect(() => { if (error || conflict) feedback.current?.focus(); }, [error, conflict]);
  useEffect(() => { if (latest && reviewRequested.current) { comparison.current?.focus(); reviewRequested.current = false; } }, [latest]);
  const dirty = !!baseline && raw !== serialize(baseline.content);
  let content: SiteConfig | null = null;
  let validationError: string | null = null;
  try { if (raw) content = parseSiteConfig(JSON.parse(raw)); } catch (cause) { validationError = cause instanceof Error ? cause.message : 'Invalid JSON.'; }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    async function load() {
      inFlight.current = true; setBusy('Loading site content');
      try {
        const response = await siteRequest('/api/site/editor', { signal: controller.signal }) as EditorDocument;
        const next = parseSiteDocument(response);
        if (!mounted.current || controller.signal.aborted) return;
        setBaseline(next); setRaw(serialize(next.content)); setReloadError(response.reloadError ?? null);
        const saved = readBackup(); if (saved && saved.raw !== serialize(next.content)) setBackup(saved);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Cannot load the editor.'); }
      finally { inFlight.current = false; if (mounted.current) setBusy(null); }
    }
    void load();
    return () => { mounted.current = false; controller.abort(); };
  }, [siteRequest]);
  useEffect(() => {
    if (!baseline) return;
    try { if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ revision: baseline.revision, raw })); else sessionStorage.removeItem(draftKey); } catch { /* No secrets; storage is optional public-draft recovery. */ }
    function warn(event: BeforeUnloadEvent) { if (dirty) { event.preventDefault(); event.returnValue = ''; } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [baseline, dirty, raw]);

  // Parse structure without validation while typing, so incomplete field edits do not lock the form.
  let editable: SiteConfig | null = null;
  try { if (raw) editable = JSON.parse(raw) as SiteConfig; } catch { /* Raw mode reports syntax errors below. */ }
  // Only structurally-valid drafts can drive the form; value validation is deferred to save.
  function update(change: (current: SiteConfig) => SiteConfig) {
    if (!editable) return;
    setRaw(serialize(change(editable))); setNotice(null);
  }
  async function run(label: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError(null); setNotice(null);
    try { await action(); }
    catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Request failed. Your draft was retained.');
        if (cause instanceof SiteApiError && cause.status === 409) setConflict(true);
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(null); }
  }
  async function loadLatest(keepDraft: boolean) {
    await run('Loading latest version', async () => {
      const response = await siteRequest('/api/site/editor') as EditorDocument;
      const next = parseSiteDocument(response);
      if (!mounted.current) return;
      setReloadError(response.reloadError ?? null);
      if (keepDraft) { reviewRequested.current = true; setLatest(next); setNotice('Latest version loaded below. Your draft is unchanged.'); }
      else { setBaseline(next); setRaw(serialize(next.content)); setLatest(null); setConflict(false); setNotice('Latest version loaded.'); }
    });
  }
  async function save() {
    if (!baseline || !content || !dirty || busy) return;
    await run('Saving public content', async () => {
      const current = parseSiteDocument(await siteRequest('/api/site/editor'));
      const revision = publicationBase(baseline, current);
      if (!revision) { setLatest(current); throw new SiteApiError(409, 'This content changed since you opened it. Review the differences below. Your draft is safe.'); }
      const input = { revision, content };
      const saved = parseSiteDocument(await siteRequest('/api/site/editor', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
      if (!mounted.current) return;
      setBaseline(saved); setRaw(serialize(saved.content)); setConflict(false); setLatest(null); setReloadError(null); setNotice('Published. Visitors can see your changes.');
    });
  }
  async function loadMedia() {
    await run('Loading images', async () => {
      const result = await siteRequest('/api/site/media') as MediaList;
      if (!Array.isArray(result.assets)) throw new Error('The server returned an invalid image list.');
      if (mounted.current) { setAssets(result.assets); setMediaTruncated(result.truncated); setMediaLoaded(true); }
    });
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Choose a PNG, JPEG or WebP of 5 MiB or less. SVG and HTML are not accepted.'); return; }
    await run('Uploading image', async () => {
      const asset = await siteRequest('/api/site/media', { method: 'POST', headers: { 'Content-Type': file.type }, body: file }) as MediaAsset;
      if (mounted.current) {
        setAssets(previous => [asset, ...previous.filter(item => item.url !== asset.url)]);
        // Only advance our CAS base for an append-only upload made from this exact bundle.
        // Never silently rebase over another editor's public-document changes.
        if (asset.revision && asset.previousRevision) setBaseline(current => current && current.revision === asset.previousRevision ? { ...current, revision: asset.revision! } : current);
        setNotice(`Image uploaded: ${asset.url}. Choose it for a field below or copy its URL. Save the content draft to publish its use.`);
      }
    });
    if (uploadInput.current) uploadInput.current.value = '';
  }

  // Raw JSON may have a malformed shape; don't render unsafe property accesses until structure is checked.
  const structured = editable && hasEditableShape(editable) ? editable : null;
  const panelId = useId();
  return <section className="bmt-site bmt-site-editor" aria-labelledby={`${panelId}-title`}>
    <header className="bmt-site-editor-header"><div><h2 id={`${panelId}-title`}>{section ?? 'Public site content'}</h2><p>Changes appear on the public website when you publish.</p></div><span className={dirty ? 'bmt-site-unsaved' : ''} role="status">{busy ?? (dirty ? 'Unpublished changes' : baseline ? 'All changes saved' : 'Not loaded')}</span></header>
    {error && !baseline && <div className="bmt-site-error" role="alert"><p>{error}</p><button type="button" disabled={!!busy} onClick={() => void loadLatest(false)}>Retry loading</button></div>}
    {reloadError && <p className="bmt-site-error" role="alert">The file on disk is invalid or unreadable: {reloadError} Public visitors still see the last valid version. Repair the file before saving.</p>}
    {backup && <div className="bmt-site-notice"><p>A previous unsaved draft is available in this tab. It may be based on an older version.</p><button type="button" disabled={!!busy || dirty} onClick={() => { setRaw(backup.raw); setConflict(backup.revision !== baseline?.revision); setBackup(null); }}>Restore draft</button><button type="button" onClick={() => download(backup.raw, 'site-recovered-draft.json')}>Download previous draft</button><button type="button" onClick={() => setBackup(null)}>Dismiss</button></div>}
    {baseline && <>
      {!section && <div className="bmt-site-editor-tabs" aria-label="Content editor sections">{tabs.map(value => <button type="button" key={value} aria-pressed={value === tab} onClick={() => setTab(value)}>{value}</button>)}</div>}
      {validationError && <p className="bmt-site-error" role="alert">Draft validation: {validationError} Fix the field or use Raw JSON. Nothing has been saved.</p>}
      <fieldset disabled={!!busy} className="bmt-site-panel"><legend>{tab}</legend>
        {tab === 'Raw JSON' ? <><p>This is the same schema as content/site.json. Formatting and values are preserved until a structured edit or save.</p><textarea className="bmt-site-json" aria-label="Site content JSON" spellCheck={false} rows={24} value={raw} onChange={event => { setRaw(event.target.value); setNotice(null); }} /></> : tab === 'Images' ? <>
          <p>Uploads are public. Use only licensed, non-sensitive images; remove private EXIF/location metadata before uploading. PNG, JPEG or WebP, at most 5 MiB. SVG and HTML cannot be uploaded. Remote-first mode publishes hash-named images in Git. Local/file modes keep uploads outside Git and require a separate backup.</p>
          <label className="bmt-site-upload"><UploadSimple aria-hidden size={18} />Upload an image<input ref={uploadInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void upload(event.target.files?.[0])} /></label>
          <button type="button" className="bmt-site-secondary" onClick={() => void loadMedia()}>{mediaLoaded ? 'Refresh image library' : 'Load image library'}</button>
          {mediaLoaded && !assets.length && <p>No images uploaded yet. Existing bundled assets and HTTPS URLs can also be used in image fields.</p>}
          {mediaTruncated && <p>Showing up to 200 images. Existing image URLs remain usable even when not listed.</p>}
          <div className="bmt-site-media-grid">{assets.map(asset => <article key={asset.url}><SiteImage key={asset.url} src={asset.url} alt="Uploaded image preview" /><input aria-label="Image URL" readOnly value={asset.url} onFocus={event => event.target.select()} /><small>{Math.ceil(asset.bytes / 1024)} KiB</small>{structured && <label>Use this image for<select defaultValue="" onChange={event => { const target = event.target.value; if (target === 'logo') update(c => ({ ...c, branding: { ...c.branding, logoUrl: asset.url } })); else if (target === 'hero') update(c => ({ ...c, hero: { ...c.hero, imageUrl: asset.url } })); else if (target.startsWith('section:')) update(c => ({ ...c, guide: { ...c.guide, sections: c.guide.sections.map(section => section.id === target.slice(8) ? { ...section, imageUrl: asset.url } : section) } })); event.target.value = ''; }}><option value="">Choose a field…</option><option value="logo">Brand logo</option><option value="hero">Today hero image</option>{structured.guide.sections.map(section => <option key={section.id} value={`section:${section.id}`}>Guide: {section.title}</option>)}</select></label>}</article>)}</div>
        </> : !structured ? <p>The JSON structure is incomplete. Repair it in Raw JSON before using the structured editor.</p> : tab === 'Preview' ? <><p className="bmt-site-notice">Draft preview — not saved. This uses the public guide renderer. Today’s schedule/status is not simulated here.</p><div className="bmt-site-brand-preview"><SiteImage key={structured.branding.logoUrl} src={structured.branding.logoUrl} alt={structured.branding.logoAlt} /><h3>{structured.branding.title}</h3><p>{structured.branding.caption}</p></div><SiteImage key={structured.hero.imageUrl} src={structured.hero.imageUrl} alt={structured.hero.imageAlt} /><GuideContent content={structured} preview /></> : tab === 'Branding' ? <>
          <div className="bmt-site-fields-row">{(['title', 'shortTitle', 'caption', 'homeUrl', 'logoUrl', 'logoAlt'] as const).map(key => <Field key={key} label={{ title: 'Public brand title', shortTitle: 'Short page title', caption: 'Brand caption', homeUrl: 'Brand home URL', logoUrl: 'Logo image URL', logoAlt: 'Logo description' }[key]} value={structured.branding[key]} onChange={value => update(c => ({ ...c, branding: { ...c.branding, [key]: value } }))} />)}</div>
          <h3>Today hero imagery</h3><p>Leave the image URL blank for a text-only hero. Add an accurate description for any image.</p><div className="bmt-site-fields-row">{(['location', 'imageUrl', 'imageAlt'] as const).map(key => <Field key={key} label={{ location: 'Location label', imageUrl: 'Hero image URL', imageAlt: 'Hero image description' }[key]} value={structured.hero[key]} onChange={value => update(c => ({ ...c, hero: { ...c.hero, [key]: value } }))} />)}</div>
        </> : tab === 'Navigation' ? <><p>Up to 20 saved links. Remove custom links first if adding missing destinations would exceed that limit.</p><button type="button" disabled={publicNavigation(structured.navigation, siteDefaults.navigation).length > 20} onClick={() => update(c => ({ ...c, navigation: publicNavigation(c.navigation, siteDefaults.navigation) }))}>Add missing public destinations / migrate old anchors</button><LinksEditor links={structured.navigation} onChange={value => update(c => ({ ...c, navigation: value }))} /></> : tab === 'Useful links' ? <LinksEditor links={structured.usefulLinks} onChange={value => update(c => ({ ...c, usefulLinks: value }))} /> : tab === 'Public copy' ? <>
          <Field label="Filter public copy keys" value={copyFilter} onChange={setCopyFilter} hint="Keys correspond to screen labels. Keep the {placeholders} shown in defaults: substitutions are plain text, never HTML. See docs/site-content.md for supported values. Blank overrides stay blank." />
          <PublicCopyEditor copy={structured.copy} filter={copyFilter} onChange={copy => update(c => ({ ...c, copy }))} />
        </> : tab === 'Guide' ? <>
          <Field label="Guide title" value={structured.guide.title} onChange={value => update(c => ({ ...c, guide: { ...c.guide, title: value } }))} /><Field label="Guide introduction" value={structured.guide.intro} multiline onChange={value => update(c => ({ ...c, guide: { ...c.guide, intro: value } }))} /><Field label="Guide notice / demo disclosure" value={structured.guide.notice} multiline onChange={value => update(c => ({ ...c, guide: { ...c.guide, notice: value } }))} />
          {structured.guide.sections.map((section, index) => <div className="bmt-site-editor-item" key={index}><h3>Section {index + 1}</h3>{(['id', 'title', 'markdown', 'imageUrl', 'imageAlt'] as const).map(key => <Field key={key} label={{ id: 'Stable section ID', title: 'Section title', markdown: 'Section Markdown', imageUrl: 'Section image URL', imageAlt: 'Image description' }[key]} value={section[key]} multiline={key === 'markdown'} hint={key === 'markdown' ? 'Markdown only; raw HTML is not rendered. Use HTTPS links or known site routes.' : undefined} onChange={value => update(c => ({ ...c, guide: { ...c.guide, sections: c.guide.sections.map((item, i) => i === index ? { ...item, [key]: value } : item) } }))} />)}<MoveButtons name={section.title || `section ${index + 1}`} index={index} count={structured.guide.sections.length} move={to => update(c => ({ ...c, guide: { ...c.guide, sections: reorder(c.guide.sections, index, to) } }))} remove={() => update(c => ({ ...c, guide: { ...c.guide, sections: c.guide.sections.filter((_, i) => i !== index) } }))} /></div>)}
          <button type="button" className="bmt-site-secondary" onClick={() => { const section: GuideSection = { id: `section-${crypto.randomUUID().slice(0, 8)}`, title: 'New guide section', markdown: 'Draft content — review before publishing.', imageUrl: '', imageAlt: '' }; update(c => ({ ...c, guide: { ...c.guide, sections: [...c.guide.sections, section] } })); }}><Plus aria-hidden size={18} />Add guide section</button>
        </> : tab === 'Help' ? <>
          {structured.help.map((block, index) => <div className="bmt-site-editor-item" key={index}><h3>Help block {index + 1}</h3><Field label="Stable help ID" value={block.id} onChange={value => update(c => ({ ...c, help: c.help.map((item, i) => i === index ? { ...item, id: value } : item) }))} /><label>Category<select value={block.kind} onChange={event => { const kind = event.target.value as HelpBlock['kind']; update(c => ({ ...c, help: c.help.map((item, i) => i === index ? { ...item, kind } : item) })); }}>{(['emergency', 'wifi', 'infoDesk', 'restroom', 'help'] as const).map(kind => <option value={kind} key={kind}>{kind}</option>)}</select></label><Field label="Help title" value={block.title} onChange={value => update(c => ({ ...c, help: c.help.map((item, i) => i === index ? { ...item, title: value } : item) }))} /><Field label="Help Markdown" value={block.markdown} multiline onChange={value => update(c => ({ ...c, help: c.help.map((item, i) => i === index ? { ...item, markdown: value } : item) }))} /><MoveButtons name={block.title || `help block ${index + 1}`} index={index} count={structured.help.length} move={to => update(c => ({ ...c, help: reorder(c.help, index, to) }))} remove={() => update(c => ({ ...c, help: c.help.filter((_, i) => i !== index) }))} /></div>)}
          <button type="button" className="bmt-site-secondary" onClick={() => update(c => ({ ...c, help: [...c.help, { id: `help-${crypto.randomUUID().slice(0, 8)}`, kind: 'help', title: 'New help block', markdown: 'Draft content — review before publishing.' }] }))}><Plus aria-hidden size={18} />Add help block</button>
        </> : null}
      </fieldset>
      {latest && <div className="bmt-site-conflict" ref={comparison} tabIndex={-1}>
        <h3>Review published changes</h3><ContentComparison draft={editable ?? raw} published={latest.content} />
        <div className="bmt-site-actions">
          <button type="button" onClick={() => download(serialize(latest.content), 'site-latest.json')}>Download published version</button>
          <button type="button" disabled={!!busy} onClick={() => { if (window.confirm('Discard your draft and use the published version?')) { setRaw(serialize(latest.content)); setBaseline(latest); setLatest(null); setConflict(false); setError(null); setNotice('Published version loaded.'); } }}>Use published version</button>
          <button type="button" disabled={!!busy || !content} onClick={() => { if (window.confirm('Keep your reviewed draft? Publishing next will replace the differing fields shown above.')) { setBaseline(latest); setLatest(null); setConflict(false); setError(null); setNotice('Draft kept. Review your changes, then publish.'); } }}>Keep my reviewed draft</button>
        </div>
      </div>}
      <div className="bmt-site-savebar editor-savebar" ref={feedback} tabIndex={-1}>
        <p className={error || reloadError ? 'editor-save-error' : 'editor-save-status'} role={error ? 'alert' : 'status'}>{busy ?? error ?? reloadError ?? notice ?? (validationError ? 'Fix the highlighted fields before publishing.' : dirty ? 'Unpublished changes' : 'All changes saved')}</p>
        <div className="editor-save-actions">
          <button type="button" className="bmt-site-primary" disabled={!!busy || !dirty || !content || !!reloadError || conflict} onClick={() => void save()}>{busy === 'Saving public content' ? 'Publishing…' : 'Save public content'}</button>
          {(conflict || error) && <button type="button" disabled={!!busy} onClick={() => { if (latest) comparison.current?.focus(); else void loadLatest(true); }}>Review published changes</button>}
          <button type="button" className="bmt-site-secondary" disabled={!!busy} onClick={() => download(raw, 'site-draft.json')}><DownloadSimple aria-hidden size={18} />Download draft</button>
          <button type="button" disabled={!!busy} onClick={() => { if (!dirty || window.confirm('Discard unsaved changes and reload the published version?')) void loadLatest(false); }}>Reload published version</button>
        </div>
      </div>
    </>}
  </section>;
}

/** Structural check, not value validation: supports editing temporarily empty IDs/titles. */
function hasEditableShape(value: SiteConfig): boolean {
  if (!value || typeof value !== 'object' || !value.branding || !value.hero || !value.guide || !value.copy || typeof value.copy !== 'object' || Array.isArray(value.copy)) return false;
  const strings = (record: object, keys: string[]) => keys.every(key => typeof (record as Record<string, unknown>)[key] === 'string');
  return strings(value.branding, ['title', 'shortTitle', 'caption', 'logoUrl', 'logoAlt', 'homeUrl']) && strings(value.hero, ['imageUrl', 'imageAlt', 'location']) && strings(value.guide, ['title', 'intro', 'notice'])
    && Object.values(value.copy).every(item => typeof item === 'string')
    && Array.isArray(value.navigation) && value.navigation.every(item => !!item && strings(item, ['id', 'label', 'href']))
    && Array.isArray(value.usefulLinks) && value.usefulLinks.every(item => !!item && strings(item, ['id', 'label', 'href']))
    && Array.isArray(value.guide.sections) && value.guide.sections.every(item => !!item && strings(item, ['id', 'title', 'markdown', 'imageUrl', 'imageAlt']))
    && Array.isArray(value.help) && value.help.every(item => !!item && strings(item, ['id', 'kind', 'title', 'markdown']));
}
