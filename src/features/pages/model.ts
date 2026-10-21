import { parse, stringify } from 'smol-toml';
import { isLinkUrl } from '../site/config';
import type { SiteLink } from '../site/config';

export const blockNames = ['now_next', 'announcements', 'urgent_updates', 'subscribe', 'schedule', 'room_lookup', 'map', 'report_form'] as const;
export type BlockName = typeof blockNames[number];
export interface PageMeta { title: string; route: string; nav_label: string; nav_order: number; nav_visible: boolean; layout: 'prose' | 'wide' }
export type PagePart = { kind: 'markdown'; source: string } | { kind: 'block'; name: BlockName } | { kind: 'anchor'; id: string } | { kind: 'button'; label: string; href: string };
export interface Page { meta: PageMeta; body: string; parts: PagePart[]; headings: { id: string; title: string; part: number }[] }
export interface PagesDocument { revision: string; files: Record<string, string>; pages: Record<string, Page>; reloadError: string | null }
export interface PageDraft { revision: string; files: Record<string, string>; selected: string }
export const draftKey = 'bmt-page-draft-v1';
export function isPageRoute(route: string): boolean {
  return ['/', '/schedule', '/updates', '/map', '/rooms', '/guide', '/faq', '/help', '/lost-found'].includes(route) || /^\/(pages|guide|help)\/[a-z0-9-]{1,64}$/.test(route);
}
export function isPageLink(value: string): boolean {
  const [path, anchor, extra] = value.split('#');
  return isLinkUrl(value) || (extra === undefined && (isPageRoute(path) || (path === '' && !!anchor)) && (anchor === undefined || anchor === '' || /^[a-z0-9-]{1,128}$/.test(anchor)));
}
export function splitSource(source: string) {
  const normalized = source.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('+++\n')) throw new Error('Start with +++ on its own line, followed by TOML frontmatter.');
  const end = normalized.indexOf('\n+++\n', 4);
  if (end < 0) throw new Error('Close TOML frontmatter with +++ and a newline.');
  const front = normalized.slice(4, end);
  if (new TextEncoder().encode(front).length > 4096) throw new Error('Frontmatter must be at most 4 KiB.');
  return { meta: parse(front), body: normalized.slice(end + 5) };
}
export function updateMeta(source: string, field: keyof PageMeta, value: string | number | boolean): string {
  const { meta, body } = splitSource(source);
  return `+++\n${stringify({ ...meta, [field]: value })}+++\n${body}`;
}
export function newSource(name: string): string {
  return `+++\n${stringify({ title: 'New page', route: `/pages/${name}`, nav_label: 'New page', nav_order: 100, nav_visible: false, layout: 'prose' })}+++\n\nWrite your page here.\n`;
}
export function readDraft(storage: Pick<Storage, 'getItem'>): PageDraft | null {
  try {
    const draft = JSON.parse(storage.getItem(draftKey) ?? 'null') as PageDraft | null;
    if (draft && typeof draft.revision === 'string' && typeof draft.selected === 'string' && draft.files && typeof draft.files === 'object' && Object.keys(draft.files).length <= 32 && Object.entries(draft.files).every(([name, source]) => /^[a-z0-9-]{1,64}\.md$/.test(name) && typeof source === 'string')) return draft;
  } catch { /* Keep in-memory editing available when storage is disabled. */ }
  return null;
}
/** Validate the transport shape before replacing last-good data; the server owns Markdown validation. */
export function parsePagesDocument(value: unknown): PagesDocument {
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const text = (item: unknown): item is string => typeof item === 'string';
  const bad = () => { throw new Error('Invalid page publication. The last good pages have been retained.'); };
  if (!record(value) || !text(value.revision) || !record(value.files) || !record(value.pages) || !(value.reloadError === null || text(value.reloadError))) return bad();
  const names = Object.keys(value.files);
  if (names.length > 32 || Object.keys(value.pages).length !== names.length) return bad();
  let total = 0;
  const routes = new Set<string>();
  for (const name of names) {
    const source = value.files[name]; const page = value.pages[name];
    if (!/^[a-z0-9-]{1,64}\.md$/.test(name) || !text(source)) return bad();
    const bytes = new TextEncoder().encode(source).length; total += bytes;
    if (bytes > 65536 || total > 524288 || !record(page) || !text(page.body) || !record(page.meta) || !Array.isArray(page.parts) || page.parts.length > 128 || !Array.isArray(page.headings) || page.headings.length > 128) return bad();
    const meta = page.meta;
    if (!text(meta.title) || !text(meta.route) || !isPageRoute(meta.route) || routes.has(meta.route) || !text(meta.nav_label) || !Number.isInteger(meta.nav_order) || typeof meta.nav_visible !== 'boolean' || !['prose', 'wide'].includes(String(meta.layout))) return bad();
    routes.add(meta.route);
    for (const part of page.parts) {
      if (!record(part)) return bad();
      if (part.kind === 'markdown' && text(part.source)) continue;
      if (part.kind === 'block' && blockNames.includes(part.name as BlockName)) continue;
      if (part.kind === 'anchor' && text(part.id) && /^[a-z0-9-]{1,128}$/.test(part.id)) continue;
      if (part.kind === 'button' && text(part.label) && part.label.trim() && part.label.length <= 100 && text(part.href) && isPageLink(part.href)) continue;
      return bad();
    }
    for (const heading of page.headings) if (!record(heading) || !text(heading.id) || !/^section-\d+-\d+$/.test(heading.id) || !text(heading.title) || !Number.isInteger(heading.part) || Number(heading.part) < 0 || Number(heading.part) >= page.parts.length) return bad();
  }
  return value as unknown as PagesDocument;
}
export function pageNavigation(document: PagesDocument | null | undefined, fallback: SiteLink[]): SiteLink[] {
  if (!document) return fallback;
  const pages = Object.entries(document.pages);
  const authored = new Set(pages.map(([, page]) => page.meta.route));
  const links = fallback.filter(link => !authored.has(link.href)).map((link, index) => ({ ...link, order: (index + 1) * 10 }));
  for (const [name, { meta }] of pages) {
    if (meta.nav_visible) links.push({ id: name, href: meta.route, label: meta.nav_label || meta.title, order: meta.nav_order });
  }
  return links.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
