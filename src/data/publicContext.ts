import { useOutletContext } from 'react-router-dom';
import type { useLiveData } from './useLiveData';
import type { useSite } from '../features/site/useSite';
import type { SiteConfig } from '../features/site/config';
import { siteDefaults } from '../features/site/defaults';
import { publicNavigation } from './publicNavigation';

export interface PublicContext {
  pages?: ReturnType<typeof import('../features/pages/usePages').usePages>;
  site: ReturnType<typeof useSite>;
  live: ReturnType<typeof useLiveData>;
}
export function usePublicData() { return useOutletContext<PublicContext>(); }
export function destinationLinks(content: SiteConfig) {
  return publicNavigation(content.navigation, siteDefaults.navigation);
}
export function destinationLabel(content: SiteConfig, path: string) {
  return destinationLinks(content).find(link => link.href === path)?.label ?? content.branding.shortTitle;
}
