import { useCallback, useEffect, useRef, useState } from 'react';
import { useStaff } from '../staff';
import { SiteApiError, siteRequest } from '../site/api';
import { PagePreview } from './PagePreview';
import { blockNames, draftKey, isPageRoute, newSource, parsePagesDocument, readDraft, splitSource, updateMeta, type Page, type PageDraft, type PageMeta, type PagesDocument } from './model';
import './pages.css';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Request failed. Your draft has been retained.';
export function PageEditor() {
  const staff = useStaff();
  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await siteRequest(path, init, staff.request);
    return path === '/api/pages/preview' ? response : parsePagesDocument(response);
  }, [staff.request]);
  const [baseline, setBaseline] = useState<PagesDocument | null>(null);
  const [revision, setRevision] = useState('');
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState('');
  const [backup, setBackup] = useState<PageDraft | null>(null);
  const [latest, setLatest] = useState<PagesDocument | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<{ source: string; page: Page } | null>(null);
  const [livePreview, setLivePreview] = useState(true);
  const [previewStatus, setPreviewStatus] = useState('');
  const [view, setView] = useState<'edit' | 'preview' | 'split'>(() => window.matchMedia?.('(max-width: 900px)').matches ? 'edit' : 'split');
  const source = files[selected] ?? '';
  const textarea = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const dirty = !!baseline && JSON.stringify(files) !== JSON.stringify(baseline.files);
  useEffect(() => {
    const narrow = window.matchMedia?.('(max-width: 900px)');
    const resize = () => { if (narrow?.matches) setView(current => current === 'split' ? 'edit' : current); };
    narrow?.addEventListener('change', resize);
    return () => narrow?.removeEventListener('change', resize);
  }, []);
  let metadata: ReturnType<typeof splitSource>['meta'] | null = null;
  let syntaxError = '';
  try { if (source) metadata = splitSource(source).meta; } catch (cause) { syntaxError = message(cause); }

  useEffect(() => {
    if (!livePreview || !source || syntaxError || backup) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewStatus('Updating preview…');
      try {
        const page = await request('/api/pages/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }), signal: controller.signal }) as Page;
        if (!controller.signal.aborted) { setPreview({ source, page }); setPreviewStatus('Preview up to date'); }
      } catch (cause) { if (!controller.signal.aborted) setPreviewStatus(message(cause)); }
    }, 800);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [source, syntaxError, livePreview, backup, request]);

  const install = useCallback((next: PagesDocument) => {
    setBaseline(next); setRevision(next.revision); setFiles(next.files); setSelected(current => current in next.files ? current : Object.keys(next.files)[0] ?? '');
  }, []);
  const recover = useCallback((next: PagesDocument) => {
    install(next);
    try { const saved = readDraft(sessionStorage); if (saved && JSON.stringify(saved.files) !== JSON.stringify(next.files)) setBackup(saved); } catch { setStorageError(true); }
  }, [install]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      inFlight.current = true; setBusy('Loading pages');
      try {
        const next = await request('/api/pages/editor', { signal: controller.signal }) as PagesDocument;
        if (controller.signal.aborted) return;
        recover(next);
      } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
      finally { inFlight.current = false; if (!controller.signal.aborted) setBusy(''); }
    }
    void load();
    return () => controller.abort();
  }, [request, recover]);
  useEffect(() => {
    if (!baseline || backup) return;
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ revision, files, selected })); else sessionStorage.removeItem(draftKey);
    } catch { setStorageError(true); }
  }, [baseline, backup, dirty, revision, files, selected]);
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } }
    function navigate(event: MouseEvent) {
      const anchor = (event.target as Element)?.closest?.('a');
      if (!dirty || !anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.getAttribute('href')?.startsWith('#')) return;
      if (!window.confirm('Leave this editor? Your public-page draft is retained in this tab, but it is not published.')) { event.preventDefault(); event.stopPropagation(); }
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [dirty, busy]);
  async function run(label: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); }
    catch (cause) { setError(message(cause)); if (cause instanceof SiteApiError && cause.status === 409) setConflict(true); }
    finally { inFlight.current = false; setBusy(''); }
  }
  function edit(value: string) { setFiles(current => ({ ...current, [selected]: value })); setNotice(''); setPreviewStatus(''); }
  function field(key: keyof PageMeta, value: string | number | boolean) {
    try { edit(updateMeta(source, key, value)); } catch (cause) { setError(message(cause)); }
  }
  function select(next: string) {
    if (next === selected || (dirty && !window.confirm('Switch pages? All edits stay in this unpublished draft.'))) return;
    setSelected(next); setPreview(null); setPreviewStatus(''); setError('');
  }
  function insert(before: string, after = '') {
    const input = textarea.current;
    if (!input) return;
    // Never insert prose/shortcodes inside TOML frontmatter.
    const bodyStart = source.indexOf('\n+++\n', 4) + 5;
    const start = Math.max(bodyStart, input.selectionStart);
    const end = Math.max(start, input.selectionEnd);
    edit(source.slice(0, start) + before + source.slice(start, end) + after + source.slice(end));
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + before.length, end + before.length); });
  }
  function create() {
    if (!/^[a-z0-9-]{1,64}$/.test(name)) { setError('Choose a filename with 1–64 lowercase letters, digits or hyphens.'); return; }
    const file = `${name}.md`;
    if (file in files || Object.keys(files).length >= 32) { setError('Choose an unused filename. A publication can contain at most 32 pages.'); return; }
    if (dirty && !window.confirm('Create a page? Existing edits stay in this unpublished draft.')) return;
    setFiles(current => ({ ...current, [file]: newSource(name) })); setSelected(file); setName(''); setPreview(null); setError('');
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ revision, files, selected }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'public-pages-draft.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="page-editor">
    {baseline?.reloadError && <p className="staff-note staff-error" role="alert">Last good pages are live. {baseline.reloadError}</p>}
    {storageError && <p className="staff-note" role="alert">Browser draft storage is unavailable. Keep this tab open and download your draft before leaving.</p>}
    {backup && <section className="staff-note"><h2>Recover an unpublished draft</h2><p>A previous draft is saved in this tab. Its original revision is retained so it cannot overwrite newer work silently.</p><div className="page-editor-actions"><button className="staff-button" disabled={!!busy} onClick={() => { setFiles(backup.files); setRevision(backup.revision); setSelected(backup.selected in backup.files ? backup.selected : Object.keys(backup.files)[0] ?? ''); setConflict(backup.revision !== baseline?.revision); setBackup(null); }}>Restore draft</button><button className="staff-button" disabled={!!busy} onClick={() => { if (window.confirm('Discard the recovered draft?')) setBackup(null); }}>Discard recovered draft</button></div></section>}
    {conflict && <section className="staff-note"><h2>Publication changed</h2><p>Nothing was overwritten. Download your draft, load the current files and reconcile the differences before retrying.</p></section>}
    <div className="page-editor-actions page-publish-bar">
      {baseline && <><label className="page-picker">Page<select value={selected} disabled={!!busy || !!backup} onChange={event => select(event.target.value)}>{Object.keys(files).map(file => <option key={file} value={file}>{file}</option>)}</select></label><div className="page-view-switch" role="group" aria-label="Editor view">{(['edit', 'preview', 'split'] as const).map(mode => <button key={mode} className={`staff-button page-view-${mode}`} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'edit' ? 'Edit' : mode === 'preview' ? 'Preview' : 'Split'}</button>)}</div></>}
      <details className="page-recovery"><summary>More actions</summary><div className="page-editor-actions"><button className="staff-button" disabled={!!busy} onClick={() => void run('Loading current publication', async () => { const next = await request('/api/pages/editor') as PagesDocument; if (!baseline) recover(next); else setLatest(next); })}>Load current publication</button>
      <button className="staff-button" disabled={!baseline} onClick={download}>Download draft</button>
      {baseline && <details className="page-create"><summary>New page</summary><label htmlFor="new-page-name">Filename (without .md)</label><input id="new-page-name" value={name} onChange={event => setName(event.target.value)} placeholder="visitor-information" disabled={!!busy || !!backup} /><button className="staff-button" disabled={!!busy || !!backup} onClick={create}>Create page</button></details>}
      {selected && selected in files && <button className="staff-button" disabled={!!busy || !!backup} onClick={() => { if (window.confirm(`Remove ${selected} from this draft? Publishing will delete the file. Core public destinations return to their legacy view.`)) { const next = { ...files }; delete next[selected]; setFiles(next); setSelected(Object.keys(next)[0] ?? ''); setPreview(null); } }}>Delete page</button>}
      <a href="/admin/site-settings">Site settings & media</a>
      </div></details>
      {baseline && <button className="staff-button staff-primary" disabled={!!busy || !dirty || !!backup || conflict || !staff.can('content:write')} onClick={() => void run('Publishing pages', async () => { const next = await request('/api/pages/editor', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, files }) }) as PagesDocument; install(next); setLatest(null); setConflict(false); setNotice('Pages published. The public site will refresh within 30 seconds.'); })}>Publish all changes</button>}
      <span className="page-publication-state">{dirty ? 'Unpublished changes' : 'Matches publication'}</span>
      {(busy || notice) && <p className="staff-note page-action-message" role="status">{busy ? `${busy}…` : notice}</p>}
      {error && <p className="staff-note staff-error page-action-message" role="alert">{error} Your draft is retained.</p>}
    </div>
    {latest && <section className="staff-note"><h2>Compare the current publication</h2><p>Review every changed or deleted file. Publishing replaces the complete page set; it does not merge other editors’ changes.</p><details><summary>Current Markdown files</summary><pre>{JSON.stringify(latest.files, null, 2)}</pre></details><div className="page-editor-actions"><button className="staff-button" disabled={!!busy} onClick={() => { if (window.confirm('Use the current revision for your entire draft? Confirm that you have reconciled every file above.')) { setBaseline(latest); setRevision(latest.revision); setConflict(false); setLatest(null); } }}>I reconciled my draft — use current revision</button><button className="staff-button" disabled={!!busy} onClick={() => { if (!dirty || window.confirm('Discard your draft and replace it with the current publication?')) { install(latest); setLatest(null); setConflict(false); } }}>Replace draft with current files</button></div></section>}
    {baseline && <div className="page-editor-grid">
      <aside className="staff-panel page-list"><h2>Pages <small>{Object.keys(files).length}/32</small></h2><nav aria-label="Authored pages">{Object.keys(files).sort((a, b) => { try { return Number(splitSource(files[a]).meta.nav_order ?? 0) - Number(splitSource(files[b]).meta.nav_order ?? 0); } catch { return a.localeCompare(b); } }).map(file => <button className="staff-button" key={file} disabled={!!busy || !!backup} aria-pressed={file === selected} onClick={() => select(file)}>{file}</button>)}</nav>
        {!Object.keys(files).length && <p>No authored pages. Existing public pages remain live until you publish.</p>}
        {!Object.keys(baseline.files).length && <button className="staff-button" disabled={!!busy || dirty || !!backup} onClick={() => void run('Preparing existing content', async () => { const next = await request('/api/pages/adopt', { method: 'POST' }) as PagesDocument; setFiles(next.files); setRevision(next.revision); setSelected(Object.keys(next.files)[0] ?? ''); setNotice('Nine public pages are prepared from installed content: Home, Schedule, Updates, Maps, My rooms, Guide, FAQ, Help and Lost & found. Review copy, images, links and navigation on every page, then publish explicitly. Nothing live has changed; legacy fields are retained for rollback.'); })}>Convert existing public pages</button>}
      </aside>
      {selected && selected in files && <section className="staff-panel page-source"><h2 className="page-source-title">{selected}</h2>
        <div className="page-editing-grid" data-view={view}><div className="page-edit-pane"><details><summary>Page details · title, path & navigation</summary><fieldset disabled={!!busy || !!backup} className="page-fields"><legend>Page details</legend><p>These fields edit the TOML frontmatter below. Changing them normalizes frontmatter formatting.</p>
          {metadata ? <><label>Title<input value={String(metadata.title ?? '')} onChange={event => field('title', event.target.value)} /></label><label>Public path<input value={String(metadata.route ?? '')} onChange={event => field('route', event.target.value)} /></label><label>Navigation label<input value={String(metadata.nav_label ?? '')} onChange={event => field('nav_label', event.target.value)} /></label><label>Navigation order<input type="number" min="-1000" max="1000" value={Number(metadata.nav_order ?? 0)} onChange={event => field('nav_order', Number(event.target.value))} /></label><label>Width<select value={String(metadata.layout ?? 'prose')} onChange={event => field('layout', event.target.value)}><option value="prose">Reading width</option><option value="wide">Wide</option></select></label><label className="page-checkbox"><input type="checkbox" checked={metadata.nav_visible === true} onChange={event => field('nav_visible', event.target.checked)} />Show in navigation</label></> : <p role="alert">{syntaxError}</p>}
        </fieldset></details>
        <details className="page-formatting"><summary>Formatting & inserts</summary><div className="page-editor-actions" role="group" aria-label="Formatting and inserts"><button className="staff-button" disabled={!!busy || !!syntaxError || !!backup} onClick={() => insert('**', '**')}>Bold</button><button className="staff-button" disabled={!!busy || !!syntaxError || !!backup} onClick={() => insert('\n\n## ')}>Heading</button><button className="staff-button" disabled={!!busy || !!syntaxError || !!backup} onClick={() => insert('[', '](/guide)')}>Link</button><button className="staff-button" disabled={!!busy || !!syntaxError || !!backup} onClick={() => insert('![Describe the image](/media/replace-with-uploaded-image.png)')}>Image</button><label>Insert live block<select value="" disabled={!!busy || !!syntaxError || !!backup} onChange={event => insert(`\n\n{{ ${event.target.value}() }}\n\n`)}><option value="" disabled>Choose…</option>{blockNames.map(name => <option key={name} value={name}>{name.replaceAll('_', ' ')}</option>)}</select></label><button className="staff-button" disabled={!!busy || !!syntaxError || !!backup} onClick={() => insert('\n\n{{ anchor(id="stable-id") }}\n\n')}>Anchor</button><button className="staff-button" disabled={!!busy || !!syntaxError || !!backup} onClick={() => insert('\n\n{{ button_link(label="Button label", href="/guide") }}\n\n')}>Button link</button></div></details>
        <label htmlFor="page-source">Markdown source</label>
        <textarea id="page-source" ref={textarea} value={source} rows={22} spellCheck={false} disabled={!!busy || !!backup} onChange={event => edit(event.target.value)} aria-describedby="page-source-help" />
        <p id="page-source-help" className="staff-muted">Markdown + safe blocks · 64 KiB maximum. Upload images in Site settings.</p>
        </div><div className="page-preview-pane">
        <div className="page-editor-actions"><label className="page-checkbox"><input type="checkbox" checked={livePreview} onChange={event => setLivePreview(event.target.checked)} />Live preview</label><button className="staff-button" disabled={!!busy || !!syntaxError} onClick={() => void run('Validating preview', async () => { const page = await request('/api/pages/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) }) as Page; setPreview({ source, page }); })}>Validate & preview</button>{typeof metadata?.route === 'string' && isPageRoute(metadata.route) && <a href={metadata.route} target="_blank" rel="noopener noreferrer">View published page</a>}<span>{dirty ? 'Unpublished changes' : 'Matches publication'}</span></div>
        {previewStatus && (previewStatus !== 'Preview up to date' || preview?.source === source) && <p className="page-live-status" role="status">{previewStatus}</p>}
        {preview && (preview.source === source ? <PagePreview page={preview.page} /> : <p role="status">Your source changed. Validate again to update the preview.</p>)}
        </div></div>
      </section>}
    </div>}
  </div>;
}
