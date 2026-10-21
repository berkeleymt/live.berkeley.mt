export interface SiteLink { id: string; label: string; href: string }
export interface GuideSection { id: string; title: string; markdown: string; imageUrl: string; imageAlt: string }
export type HelpKind = 'emergency' | 'wifi' | 'infoDesk' | 'restroom' | 'help';
export interface HelpBlock { id: string; kind: HelpKind; title: string; markdown: string }
export interface SiteConfig {
  schemaVersion: 1;
  branding: { title: string; shortTitle: string; caption: string; logoUrl: string; logoAlt: string; homeUrl: string };
  hero: { imageUrl: string; imageAlt: string; location: string };
  navigation: SiteLink[];
  copy: Record<string, string>;
  guide: { title: string; intro: string; notice: string; sections: GuideSection[] };
  help: HelpBlock[];
  usefulLinks: SiteLink[];
}
export interface SiteDocument { revision: string; content: SiteConfig }
export interface EditorDocument extends SiteDocument { reloadError: string | null }
export interface MediaAsset { url: string; bytes: number; revision?: string; previousRevision?: string }
export interface MediaList { assets: MediaAsset[]; truncated: boolean }

export const MAX_COPY_KEYS = 500;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const safeId = (value: string) => /^[a-z0-9-]{1,64}$/.test(value);
const knownPaths = new Set(['', '/', '/schedule', '/updates', '/guide', '/help', '/faq', '/map', '/directions', '/rooms', '/lookup', '/lost-found', '/lost-and-found', '/staff/sign-in', '/admin', '/classic']);
export function isHttpsUrl(value: string): boolean {
  if (bytes(value) > 2048 || /[\s\\]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
export function isImageUrl(value: string): boolean {
  return value === '' || isHttpsUrl(value)
    || ['/bmt-logo.svg', '/favicon.svg', '/bg-doodles.png', '/campus-map.png'].includes(value)
    || /^\/(media|demo-guide)\/[a-zA-Z0-9_-]{1,100}\.(png|jpe?g|webp)$/.test(value);
}
export function isLinkUrl(value: string): boolean {
  if (isHttpsUrl(value)) return true;
  const [path, anchor, extra] = value.split('#');
  return extra === undefined && knownPaths.has(path) && (!!path || !!anchor)
    && (anchor === undefined || anchor === '' || safeId(anchor));
}

function object(value: unknown, fields?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  const result = value as Record<string, unknown>;
  if (fields && Object.keys(result).some(key => !fields.includes(key))) throw new Error('Unknown field; check the schemaVersion 1 field names.');
  return result;
}
function string(value: unknown, label: string, max = 200, required = true): string {
  if (typeof value !== 'string' || bytes(value) > max || value.includes('\0') || (required && !value.trim())) {
    throw new Error(`${label} ${required ? 'is required and ' : ''}must be text of at most ${max} bytes.`);
  }
  return value;
}
function list<T extends { id: string }>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Expected a list with at most ${max} items.`);
  const result = value.map(parse);
  if (result.some(item => !safeId(item.id)) || new Set(result.map(item => item.id)).size !== result.length) {
    throw new Error('IDs must be unique within each list: 1–64 lowercase letters, digits or hyphens.');
  }
  return result;
}
function image(value: unknown, description: unknown): { imageUrl: string; imageAlt: string } {
  const imageUrl = string(value, 'Image URL', 2048, false);
  if (!isImageUrl(imageUrl)) throw new Error('Images must use HTTPS, /media/<image>, /demo-guide/<image>, or a known bundled asset.');
  return { imageUrl, imageAlt: string(description, 'Image description', 500, !!imageUrl) };
}
function link(value: unknown): SiteLink {
  const item = object(value, ['id', 'label', 'href']);
  const href = string(item.href, 'Link URL', 2048);
  if (!isLinkUrl(href)) throw new Error('Links must use HTTPS or a known site route/anchor.');
  return { id: string(item.id, 'Link ID', 64), label: string(item.label, 'Link label'), href };
}

/** Runtime validation for both JSON editing and public API responses; the server remains authoritative. */
export function parseSiteConfig(value: unknown): SiteConfig {
  const root = object(value, ['schemaVersion', 'branding', 'hero', 'navigation', 'copy', 'guide', 'help', 'usefulLinks']);
  if (root.schemaVersion !== 1) throw new Error('Unsupported site schemaVersion; expected 1.');
  const brand = object(root.branding, ['title', 'shortTitle', 'caption', 'logoUrl', 'logoAlt', 'homeUrl']);
  const logo = image(brand.logoUrl, brand.logoAlt);
  const homeUrl = string(brand.homeUrl, 'Brand home URL', 2048);
  if (!isLinkUrl(homeUrl)) throw new Error('Brand home URL must use HTTPS or a known site route.');
  const hero = object(root.hero, ['imageUrl', 'imageAlt', 'location']);
  const guide = object(root.guide, ['title', 'intro', 'notice', 'sections']);
  const copyObject = object(root.copy);
  if (Object.keys(copyObject).length > MAX_COPY_KEYS) throw new Error(`Use at most ${MAX_COPY_KEYS} copy keys.`);
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(copyObject)) {
    if (!/^[a-zA-Z0-9.]{1,100}$/.test(key)) throw new Error('Copy keys must contain letters, digits and dots only (at most 100 characters).');
    copy[key] = string(value, `Copy ${key}`, 4000, false);
  }
  const config: SiteConfig = {
    schemaVersion: 1,
    branding: {
      title: string(brand.title, 'Brand title'), shortTitle: string(brand.shortTitle, 'Short title', 120),
      caption: string(brand.caption, 'Brand caption', 500, false), logoUrl: logo.imageUrl, logoAlt: logo.imageAlt, homeUrl,
    },
    hero: { ...image(hero.imageUrl, hero.imageAlt), location: string(hero.location, 'Location', 200, false) },
    navigation: list(root.navigation, 20, link), copy,
    guide: {
      title: string(guide.title, 'Guide title'), intro: string(guide.intro, 'Guide introduction', 4000, false),
      notice: string(guide.notice, 'Guide notice', 4000, false),
      sections: list(guide.sections, 60, value => {
        const item = object(value, ['id', 'title', 'markdown', 'imageUrl', 'imageAlt']);
        return { id: string(item.id, 'Section ID', 64), title: string(item.title, 'Section title'), markdown: string(item.markdown, 'Section Markdown', 30000), ...image(item.imageUrl, item.imageAlt) };
      }),
    },
    help: list(root.help, 30, value => {
      const item = object(value, ['id', 'kind', 'title', 'markdown']);
      if (!['emergency', 'wifi', 'infoDesk', 'restroom', 'help'].includes(String(item.kind))) throw new Error('Choose a valid help category.');
      return { id: string(item.id, 'Help ID', 64), kind: item.kind as HelpKind, title: string(item.title, 'Help title'), markdown: string(item.markdown, 'Help Markdown', 10000) };
    }),
    usefulLinks: list(root.usefulLinks, 40, link),
  };
  if (bytes(JSON.stringify(config, null, 2) + '\n') > 512 * 1024) throw new Error('Site content must be at most 512 KiB.');
  return config;
}

export function parseSiteDocument(value: unknown): SiteDocument {
  const document = object(value);
  const revision = string(document.revision, 'Revision', 64);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) throw new Error('The server returned an invalid site revision.');
  return { revision, content: parseSiteConfig(document.content) };
}

/** Substitutions remain plain text; no HTML interpretation or arbitrary template evaluation. */
export function formatSiteText(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match);
}
export function searchGuide(sections: GuideSection[], query: string): GuideSection[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sections.filter(section => terms.every(term => `${section.title}\n${section.markdown}`.toLocaleLowerCase().includes(term)));
}
