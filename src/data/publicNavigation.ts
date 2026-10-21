import type { SiteLink } from '../features/site/config.ts';

export const publicPaths = ['/', '/schedule', '/updates', '/map', '/rooms', '/guide', '/faq', '/help', '/lost-found'] as const;

/** Keep authored labels/order; fill missing core destinations for older schema-v1 documents. */
export function publicNavigation(authored: SiteLink[], defaults: SiteLink[]): SiteLink[] {
  const links = authored.map(link => ({ ...link, href: publicDestination(link.href) }));
  for (const link of defaults) {
    if (links.some(existing => existing.href === link.href)) continue;
    let id = link.id;
    let suffix = 0;
    while (links.some(existing => existing.id === id)) id = `${link.id.slice(0, 48)}-public-${++suffix}`;
    links.push({ ...link, id });
  }
  return links;
}

const legacyDestinations: Record<string, string> = {
  today: '/',
  schedule: '/schedule',
  updates: '/updates',
  map: '/map',
  help: '/help',
  faq: '/faq',
};

/** Keep saved/editor-authored navigation working when sections move to their own pages. */
export function publicDestination(href: string): string {
  const fragment = /^\/?#([a-z-]+)$/.exec(href)?.[1];
  return fragment && Object.hasOwn(legacyDestinations, fragment)
    ? legacyDestinations[fragment]
    : href;
}
