import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EventEditor } from './EventEditor';
import { PageEditor } from '../features/pages/PageEditor';
import { usePages } from '../features/pages/usePages';
import { SiteEditor, type SiteSection } from '../features/site/SiteEditor';

const sections = ['Event details', 'FAQ', 'Guide', 'Help', 'Branding', 'Navigation', 'Useful links', 'Images', 'Public copy', 'Raw JSON', 'Preview'] as const;
type Section = typeof sections[number];
const page: Partial<Record<Section, string>> = { FAQ: '/faq', Guide: '/guide', Help: '/help' };

export function ContentWorkspace() { return <PageEditor />; }

export function SiteSettingsWorkspace() {
  const pages = usePages();
  const authored = new Set(Object.values(pages.document?.pages ?? {}).map(page => page.meta.route));
  const [section, setSection] = useState<Section>('Event details');
  const eventSection = section === 'Event details' || section === 'FAQ';
  return <div className="content-workspace">
    <p className="staff-note">Structured event information and shared presentation settings. Authored pages, including FAQ, Guide and Help, are edited in <a href="/admin/content">Website content</a>; their old fields remain read-only compatibility data. Navigation labels for authored destinations come from page frontmatter.</p>
    <div className="staff-section-bar">
      <nav className="staff-sections" aria-label="Content sections">
        {sections.slice(0, 4).filter(name => !authored.has(page[name] ?? '')).map(name => <button key={name} type="button" aria-pressed={section === name} onClick={() => setSection(name)}>{name}</button>)}
        <label className="staff-section-select"><span>More content</span><select aria-label="More content sections" value={sections.slice(4).includes(section as SiteSection) ? section : ''} onChange={event => { if (event.target.value) setSection(event.target.value as Section); }}>
          <option value="" disabled>Choose a section…</option>{sections.slice(4).map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
      </nav>
      <Link to={page[section] ?? '/'} target="_blank" rel="noopener noreferrer">View public page ↗</Link>
    </div>
    <div hidden={!eventSection}><EventEditor section={section === 'FAQ' ? 'FAQ' : 'Event details'} onPublish={() => {}} /></div>
    <div hidden={eventSection}><SiteEditor section={eventSection ? 'Branding' : section} /></div>
  </div>;
}
