import { useState } from 'react';
import { createPortal } from 'react-dom';
import { PageRenderer } from './PageRenderer';
import type { Page } from './model';

/** A document boundary prevents staff typography from leaking into public previews. */
export function PagePreview({ page }: { page: Page }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [phone, setPhone] = useState(false);
  return <section className="page-preview-frame" aria-label="Public preview">
    <div className="page-editor-actions"><span>Live blocks are inactive.</span><label>Width<select value={phone ? 'phone' : 'fit'} onChange={event => setPhone(event.target.value === 'phone')}><option value="fit">Fit workspace</option><option value="phone">Phone · 390px</option></select></label></div>
    <iframe title="Page preview" className={phone ? 'page-preview-phone' : ''} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page preview</title></head><body></body></html>'}
      onLoad={event => {
        const target = event.currentTarget.contentDocument;
        if (!target) return;
        document.querySelectorAll('link[rel="stylesheet"], style').forEach(style => target.head.append(style.cloneNode(true)));
        setContainer(target.body);
      }} />
    {container && createPortal(<div className="public-hub public-preview"><PageRenderer page={page} preview /></div>, container)}
  </section>;
}
