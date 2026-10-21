import seed from '../../../content/site.json?raw';
import { formatSiteText, parseSiteConfig } from './config';
import type { SiteConfig } from './config';

/** Bundled public defaults, sourced from the same human-editable document. Never put private data here. */
export const siteDefaults: SiteConfig = parseSiteConfig(JSON.parse(seed));
/** Explicit editor migration only: no read-time mutation, no loss of unknown keys or blank overrides. */
export function mergeDefaultCopy(copy: SiteConfig['copy']): SiteConfig['copy'] {
  return { ...siteDefaults.copy, ...copy };
}
export function siteText(content: SiteConfig, key: string, values: Record<string, string | number> = {}): string {
  return formatSiteText(content.copy[key] ?? siteDefaults.copy[key] ?? key, values);
}
