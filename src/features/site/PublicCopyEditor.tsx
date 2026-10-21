import { MAX_COPY_KEYS } from './config';
import { mergeDefaultCopy, siteDefaults } from './defaults';

/** Pure draft editor: merging is explicit and never publishes or rewrites installed files. */
export function PublicCopyEditor({ copy, onChange, filter = '' }: { copy: Record<string, string>; onChange: (copy: Record<string, string>) => void; filter?: string }) {
  const merged = mergeDefaultCopy(copy);
  const missing = Object.keys(siteDefaults.copy).filter(key => !Object.hasOwn(copy, key)).length;
  const tooMany = Object.keys(merged).length > MAX_COPY_KEYS;
  return <>
    <p>{missing} default copy keys are not saved in this document. They use bundled defaults until edited or merged. Existing values, intentional blanks and custom keys are preserved. Review and save the draft to publish.</p>
    <button type="button" disabled={!missing || tooMany} onClick={() => onChange(merged)}>Merge missing default copy keys</button>
    {tooMany && <p role="alert">Merging would exceed {MAX_COPY_KEYS} keys. Review custom keys in Raw JSON first; nothing will be dropped automatically.</p>}
    {Object.entries(merged).filter(([key, value]) => `${key} ${value}`.toLowerCase().includes(filter.toLowerCase())).map(([key, value]) => <label className="bmt-site-field" key={key}>{key}<textarea value={value} rows={value.length > 120 ? 4 : 2} onChange={event => onChange({ ...copy, [key]: event.target.value })} /></label>)}
  </>;
}
