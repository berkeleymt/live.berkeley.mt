import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { MapBoundary } from './MapBoundary';
import { requestMessage, WayfindingApiError, wayfindingRequest } from './api';
import type { WayfindingTransport } from './api';
import { parseWayfinding } from './validation';
import type { Building, Entrance, Floor, FloorImage, Room, RoomRoute, WayfindingContent, WayfindingDocument } from './types';
import './wayfinding.css';

const serialize = (value: WayfindingContent) => `${JSON.stringify(value, null, 2)}\n`;
const uid = (kind: string) => `${kind}-${crypto.randomUUID().slice(0, 8)}`;
const FloorMap = lazy(() => import('./FloorMap').then(module => ({ default: module.FloorMap })));
const lines = (value: string) => value.split('\n');
function Field({ label, value, onChange, multiline = false, max = 1500, hint }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; max?: number; hint?: string }) {
  const id = useId();
  return <label htmlFor={id}>{label}{multiline ? <textarea id={id} value={value} rows={3} maxLength={max} onChange={event => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} /> : <input id={id} value={value} maxLength={max} onChange={event => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />}{hint && <span className="wf-small wf-muted" id={`${id}-hint`}>{hint}</span>}</label>;
}
function Coordinates({ value, onChange }: { value: [number, number]; onChange: (value: [number, number]) => void }) {
  const prefix = useId();
  return <div className="wf-two-fields">{(['Latitude', 'Longitude'] as const).map((label, index) => <label key={label} htmlFor={`${prefix}-${index}`}>{label}<input id={`${prefix}-${index}`} type="number" step="any" value={value[index]} min={index ? -180 : -90} max={index ? 180 : 90} onChange={event => { const next: [number, number] = [...value]; next[index] = Number(event.target.value); onChange(next); }} /></label>)}</div>;
}
function RouteFields({ value, entrances, onChange, accessible = false }: { value: RoomRoute; entrances: Entrance[]; onChange: (route: RoomRoute) => void; accessible?: boolean }) {
  const id = useId();
  return <><label htmlFor={id}>{accessible ? 'Step-free entrance' : 'Entrance'}<select id={id} value={value.entranceId} onChange={event => onChange({ ...value, entranceId: event.target.value })}><option value="">Choose an entrance</option>{entrances.filter(item => !accessible || item.accessible).map(entrance => <option key={entrance.id} value={entrance.id}>{entrance.name}</option>)}</select></label><Field label="Steps from entrance to room" value={value.steps.join('\n')} multiline max={6000} hint="One concise step per line. At most 12 steps, 500 bytes per step." onChange={steps => onChange({ ...value, steps: lines(steps) })} /></>;
}
function RoomFields({ room, entrances, image, onChange }: { room: Room; entrances: Entrance[]; image: FloorImage | null; onChange: (value: Room) => void }) {
  const prefix = useId();
  const [placing, setPlacing] = useState(false);
  return <>
    <p className="wf-small wf-muted">Stable room ID: <code>{room.id}</code>. Private imports reference this ID; do not rename it after assigning students.</p>
    <div className="wf-two-fields"><Field label="Room code" value={room.code} max={40} onChange={code => onChange({ ...room, code })} /><Field label="Room name" value={room.name} max={120} onChange={name => onChange({ ...room, name })} /></div>
    <h4>Standard directions</h4><RouteFields value={room.route} entrances={entrances} onChange={route => onChange({ ...room, route })} />
    <label className="wf-checkbox"><input type="checkbox" checked={!!room.accessibleRoute} onChange={event => onChange({ ...room, accessibleRoute: event.target.checked ? { entranceId: entrances.find(e => e.accessible)?.id ?? '', steps: ['Confirm the step-free route on site before publishing.'] } : null })} />Publish a separate step-free route</label>
    {room.accessibleRoute && <RouteFields value={room.accessibleRoute} entrances={entrances} accessible onChange={accessibleRoute => onChange({ ...room, accessibleRoute })} />}
    <label className="wf-checkbox"><input type="checkbox" checked={!!room.hotspot} disabled={!image} onChange={event => onChange({ ...room, hotspot: event.target.checked ? { x: 50, y: 50 } : null })} />Mark room on the floor plan{!image && ' (add a floor image first)'}</label>
    {room.hotspot && image && <><button type="button" className="wf-button" aria-expanded={placing} onClick={() => setPlacing(value => !value)}>{placing ? 'Close position map' : 'Position marker on map'}</button>{placing && <><p>Click or tap inside the floor plan to place this room. You can also use the percentage fields below. This changes the room marker, not the route network.</p><MapBoundary failureText="The map could not load. Use the position fields below or reload the page."><Suspense fallback={<p role="status">Loading floor plan…</p>}><FloorMap image={image} points={[{ id: room.id, label: room.code, ...room.hotspot }]} selectedId={room.id} onPlacePoint={hotspot => onChange({ ...room, hotspot })} /></Suspense></MapBoundary></>}</>}
    {room.hotspot && <div className="wf-two-fields">{(['x', 'y'] as const).map(axis => <label key={axis} htmlFor={`${prefix}-${axis}`}>{axis === 'x' ? 'Left-to-right position (%)' : 'Top-to-bottom position (%)'}<input id={`${prefix}-${axis}`} type="number" min={0} max={100} step="0.1" value={room.hotspot?.[axis]} onChange={event => onChange({ ...room, hotspot: { ...room.hotspot!, [axis]: Number(event.target.value) } })} /></label>)}</div>}
  </>;
}
function download(value: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'wayfinding-draft.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Place inside the authenticated staff shell. API capability checks are mandatory too. */
export function RoomEditor({ canWrite = true, request = fetch }: { canWrite?: boolean; request?: WayfindingTransport }) {
  const prefix = useId();
  const [baseline, setBaseline] = useState<WayfindingDocument | null>(null);
  const [draft, setDraft] = useState<WayfindingContent | null>(null);
  const [raw, setRaw] = useState('');
  const [rawMode, setRawMode] = useState(false);
  const [buildingId, setBuildingId] = useState('');
  const [busy, setBusy] = useState('Loading directions…');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<WayfindingDocument | null>(null);
  const [removal, setRemoval] = useState<{ label: string; action: () => void } | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const draftText = rawMode ? raw : draft ? serialize(draft) : '';
  const dirty = !!baseline && draftText !== serialize(baseline.content);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort; inFlight.current = true;
    wayfindingRequest<WayfindingDocument>('/editor', { signal: abort.signal }, request).then(value => {
      if (!abort.signal.aborted) { setBaseline(value); setDraft(value.content); setBuildingId(value.content.buildings[0]?.id ?? ''); }
    }).catch(cause => { if (!abort.signal.aborted) setError(requestMessage(cause)); }).finally(() => { inFlight.current = false; if (!abort.signal.aborted) setBusy(''); });
    return () => controller.current?.abort();
  }, [request]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(value: WayfindingContent) { setDraft(value); setNotice(''); }
  function changeBuilding(value: Building) { if (draft) change({ ...draft, buildings: draft.buildings.map(item => item.id === value.id ? value : item) }); }
  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; const abort = new AbortController(); controller.current = abort; setBusy(label); setError(''); setNotice('');
    try { await action(abort.signal); }
    catch (cause) { if (!abort.signal.aborted) { setError(cause instanceof WayfindingApiError ? requestMessage(cause) : cause instanceof Error && ['Error', 'SyntaxError'].includes(cause.name) ? cause.message : requestMessage(cause)); if (cause instanceof WayfindingApiError && cause.status === 409) setConflict(true); } }
    finally { inFlight.current = false; if (!abort.signal.aborted) setBusy(''); }
  }
  function save() {
    void run('Saving directions…', async signal => {
      if (!baseline || !draft) return;
      const content = parseWayfinding(rawMode ? JSON.parse(raw) : draft);
      const saved = await wayfindingRequest<WayfindingDocument>('/editor', { method: 'PUT', body: JSON.stringify({ revision: baseline.revision, content }), signal }, request);
      if (signal.aborted) return;
      setBaseline(saved); setDraft(saved.content); setRaw(serialize(saved.content)); setConflict(false); setLatest(null); setNotice('Directions saved. Visitors will see the changes when they refresh.');
    });
  }
  function loadLatest() {
    void run('Loading latest directions…', async signal => {
      const value = await wayfindingRequest<WayfindingDocument>('/editor', { signal }, request);
      if (signal.aborted) return;
      if (!baseline) { setBaseline(value); setDraft(value.content); setBuildingId(value.content.buildings[0]?.id ?? ''); }
      else { setLatest(value); setNotice('Latest version loaded below. Your draft has not been replaced.'); }
    });
  }
  function toggleRaw() {
    setError(''); setNotice('');
    if (rawMode) {
      try { const content = parseWayfinding(JSON.parse(raw)); setDraft(content); setRawMode(false); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the JSON syntax.'); }
    } else if (draft) { setRaw(serialize(draft)); setRawMode(true); }
  }
  const building = draft?.buildings.find(item => item.id === buildingId);
  function changeFloor(floor: Floor) { if (building) changeBuilding({ ...building, floors: building.floors.map(item => item.id === floor.id ? floor : item) }); }
  function confirmRemoval(label: string, action: () => void) {
    setRemoval({ label, action });
    requestAnimationFrame(() => confirmation.current?.focus());
  }
  return <section className="wf-editor" aria-labelledby={`${prefix}-title`}>
    <header className="wf-header"><h1 id={`${prefix}-title`}>Rooms & directions</h1><p>Manage building entrances, floor plans and room directions. Student assignments stay in the private roster.</p></header>
    <p className="wf-notice">Use floor-plan guidance for supplied drawings. Mark directions staff verified only after an on-site review; step-free routes need a separate accessibility check.</p>
    {!canWrite && <p className="wf-notice">Your role can review directions, but cannot save changes.</p>}
    {busy && <p role="status">{busy}</p>}
    {error && <div role="alert" className="wf-error"><p>{error}</p>{!baseline && <button type="button" className="wf-button" disabled={!!busy} onClick={loadLatest}>Retry loading editor</button>}</div>}
    {notice && <p role="status" className="wf-notice">{notice}</p>}
    {draft && <>
      <div className="wf-actions wf-editor-actions"><span>{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span><div className="wf-actions"><button type="button" className="wf-button" onClick={() => download(draftText)}>Download draft JSON</button><button type="button" className="wf-button" disabled={!!busy || !!removal} onClick={loadLatest}>Load latest version</button><button type="button" className="wf-button wf-primary" disabled={!!busy || !!removal || !canWrite || conflict || !dirty} onClick={save}>{busy === 'Saving directions…' ? 'Saving…' : 'Save directions'}</button></div></div>
      {conflict && <div className="wf-error" role="alert"><strong>Save paused: another editor or file changed these directions.</strong><p>Download your draft, load the latest version, then start from that version and reapply your changes. Nothing has been overwritten.</p></div>}
      {latest && <div className="wf-panel"><h2>Latest saved version</h2><p>Your current draft is still above. Download it before replacing it if you want to keep your edits.</p><details><summary>View latest JSON</summary><pre>{serialize(latest.content)}</pre></details><button type="button" className="wf-button" onClick={() => confirmRemoval('Replace the current draft with the latest saved directions? Unsaved edits will be discarded.', () => { setBaseline(latest); setDraft(latest.content); setRaw(serialize(latest.content)); setConflict(false); setLatest(null); setBuildingId(latest.content.buildings[0]?.id ?? ''); setError(''); setNotice('Latest saved version loaded. Reapply any changes from your downloaded draft.'); })}>Start from latest version</button></div>}
      <fieldset disabled={!!busy || !canWrite || !!removal} className="wf-editor-fields">
        <legend className="wf-sr-only">Edit public room directions</legend>
        <button type="button" className="wf-button" onClick={toggleRaw}>{rawMode ? 'Use JSON in form' : 'Edit raw JSON'}</button>
        {rawMode ? <><label htmlFor={`${prefix}-json`}>Public directions JSON<textarea id={`${prefix}-json`} className="wf-json" value={raw} onChange={event => setRaw(event.target.value)} rows={28} maxLength={512000} spellCheck={false} /></label><p className="wf-small wf-muted">Content only; the server revision is kept separately. Save validates all fields and references. Unknown fields are rejected to prevent accidental roster publication.</p></> : <>
          <details className="wf-editor-group"><summary>Interactive route network</summary>
            <p>Public geometry only. Add maps, positioned nodes and directed edges with “Edit raw JSON”; the server checks bounds, references and verification metadata. Each reverse direction needs its own edge. No graph is required for existing written directions. Graph costs are relative weights, not walking times.</p>
            <p>{draft.graph ? `${draft.graph.maps.length} map layers · ${draft.graph.nodes.length} nodes · ${draft.graph.edges.length} directed segments. ${draft.graph.demonstration ? 'Demonstration only; not campus directions.' : 'Production graph: only verified, open edges are routed.'}` : 'No interactive network published. Written directions remain available.'}</p>
            {draft.graph?.edges.map(edge => <details className="wf-editor-group" key={edge.id}><summary>{edge.id} · {edge.closed ? 'Closed' : edge.status}</summary>
              <p>{edge.from} → {edge.to} · {edge.kind}</p>
              <label className="wf-checkbox"><input type="checkbox" checked={edge.closed} onChange={event => change({ ...draft, graph: { ...draft.graph!, edges: draft.graph!.edges.map(e => e.id === edge.id ? { ...e, closed: event.target.checked } : e) } })} />Close this directed segment</label>
              <Field label="Route instruction" value={edge.instruction} max={500} onChange={instruction => change({ ...draft, graph: { ...draft.graph!, edges: draft.graph!.edges.map(e => e.id === edge.id ? { ...e, instruction } : e) } })} />
              <Field label="Verification evidence / limitations" value={edge.verificationNote} max={500} onChange={verificationNote => change({ ...draft, graph: { ...draft.graph!, edges: draft.graph!.edges.map(e => e.id === edge.id ? { ...e, verificationNote } : e) } })} />
            </details>)}
          </details>
          <details className="wf-editor-group"><summary>Page introduction and help</summary>
            <Field label="Page title" value={draft.title} max={120} onChange={title => change({ ...draft, title })} />
            <Field label="Introduction" value={draft.intro} max={1000} multiline onChange={intro => change({ ...draft, intro })} />
            <Field label="Public notice" value={draft.notice} multiline onChange={notice => change({ ...draft, notice })} />
            <Field label="Help text" value={draft.helpText} max={1000} multiline onChange={helpText => change({ ...draft, helpText })} />
            <Field label="TakeTransit link" value={draft.travelUrl} max={1000} onChange={travelUrl => change({ ...draft, travelUrl })} />
          </details>
          <div className="wf-actions"><label htmlFor={`${prefix}-building`}>Building<select id={`${prefix}-building`} value={buildingId} onChange={event => setBuildingId(event.target.value)}><option value="">Choose a building</option>{draft.buildings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="wf-button" onClick={() => { const newBuilding: Building = { id: uid('building'), name: 'New building', aliases: [], coordinates: [37.871, -122.26], status: 'unverified', verificationNote: 'Location, entrances and room directions need an on-site check before use.', entrances: [], floors: [] }; change({ ...draft, buildings: [...draft.buildings, newBuilding] }); setBuildingId(newBuilding.id); }}>Add building</button></div>
          {!draft.buildings.length && <p className="wf-notice">No buildings yet. Add a building, its entrances, then floors and rooms.</p>}
          {building && <div className="wf-building-editor">
            <div className="wf-two-fields"><Field label="Building name" value={building.name} max={120} onChange={name => changeBuilding({ ...building, name })} /><Field label="Search aliases (one per line)" value={building.aliases.join('\n')} multiline onChange={value => changeBuilding({ ...building, aliases: lines(value).filter(Boolean) })} /></div>
            <Coordinates value={building.coordinates} onChange={coordinates => changeBuilding({ ...building, coordinates })} />
            <label htmlFor={`${prefix}-verification`}>Verification status<select id={`${prefix}-verification`} value={building.status} onChange={event => changeBuilding({ ...building, status: event.target.value as Building['status'] })}><option value="demo">Demonstration only</option><option value="unverified">Not yet verified</option><option value="mapped">Guidance from a supplied floor plan</option><option value="verified">Staff verified on site</option></select></label>
            <Field label="Verification note" value={building.verificationNote} multiline hint="For verified directions, record who checked all routes and entrances, when, and any limitations. Never mark a fictional layout as verified." onChange={verificationNote => changeBuilding({ ...building, verificationNote })} />
            <h2>Entrances</h2>
            {building.entrances.map((entrance, index) => {
              const update = (value: Entrance) => changeBuilding({ ...building, entrances: building.entrances.map(item => item.id === entrance.id ? value : item) });
              return <details key={entrance.id} className="wf-editor-group"><summary>{entrance.name || `Entrance ${index + 1}`}</summary><Field label="Entrance name" value={entrance.name} max={120} onChange={name => update({ ...entrance, name })} /><Coordinates value={entrance.coordinates} onChange={coordinates => update({ ...entrance, coordinates })} /><label className="wf-checkbox"><input type="checkbox" checked={entrance.accessible} onChange={event => update({ ...entrance, accessible: event.target.checked })} />Entrance supports a step-free route</label><Field label="Access notes" value={entrance.notes} max={1000} multiline onChange={notes => update({ ...entrance, notes })} /><Field label="Steps to reach entrance (one per line)" value={entrance.steps.join('\n')} max={6000} multiline onChange={value => update({ ...entrance, steps: lines(value) })} /><button type="button" className="wf-button" onClick={() => confirmRemoval(`Remove ${entrance.name}? Rooms that use this entrance will need a replacement route.`, () => changeBuilding({ ...building, entrances: building.entrances.filter(item => item.id !== entrance.id) }))}>Remove entrance</button></details>;
            })}
            <button type="button" className="wf-button" onClick={() => changeBuilding({ ...building, entrances: [...building.entrances, { id: uid('entrance'), name: 'New entrance', coordinates: building.coordinates, accessible: false, notes: 'Not yet verified. Ask staff before using this entrance.', steps: ['Add the checked entrance directions here.'] }] })}>Add entrance</button>
            <h2>Floors and rooms</h2>
            {building.floors.map(floor => <details key={floor.id} className="wf-editor-group"><summary>{floor.name} · {floor.rooms.length} rooms</summary>
              <Field label="Floor name" value={floor.name} max={120} onChange={name => changeFloor({ ...floor, name })} />
              <label className="wf-checkbox"><input type="checkbox" checked={!!floor.image} onChange={event => changeFloor({ ...floor, image: event.target.checked ? { url: '', alt: '', caption: '', demonstration: false } : null, rooms: event.target.checked ? floor.rooms : floor.rooms.map(room => ({ ...room, hotspot: null })) })} />Include a floor-plan image</label>
              {floor.image && <><Field label="Image URL" value={floor.image.url} max={1000} hint="Use an approved HTTPS image or /media/ asset. /demo-maps/ images must stay marked demonstration." onChange={url => changeFloor({ ...floor, image: { ...floor.image!, url } })} /><Field label="Image alt text" value={floor.image.alt} max={500} onChange={alt => changeFloor({ ...floor, image: { ...floor.image!, alt } })} /><Field label="Image caption" value={floor.image.caption} max={500} onChange={caption => changeFloor({ ...floor, image: { ...floor.image!, caption } })} /><label className="wf-checkbox"><input type="checkbox" checked={floor.image.demonstration} onChange={event => changeFloor({ ...floor, image: { ...floor.image!, demonstration: event.target.checked } })} />Demonstration image, not a real floor plan</label></>}
              {floor.rooms.map(room => <details key={room.id} className="wf-editor-group"><summary>{room.code} · {room.name}</summary><RoomFields room={room} entrances={building.entrances} image={floor.image} onChange={value => changeFloor({ ...floor, rooms: floor.rooms.map(item => item.id === room.id ? value : item) })} /><button type="button" className="wf-button" onClick={() => confirmRemoval(`Remove ${room.code}? Private imports referencing this room will stop returning assignments until repaired.`, () => changeFloor({ ...floor, rooms: floor.rooms.filter(item => item.id !== room.id) }))}>Remove room</button></details>)}
              <div className="wf-actions"><button type="button" className="wf-button" onClick={() => changeFloor({ ...floor, rooms: [...floor.rooms, { id: uid('room'), code: 'NEW', name: 'New room', route: { entranceId: building.entrances[0]?.id ?? '', steps: ['Add checked directions before publishing.'] }, accessibleRoute: null, hotspot: null }] })}>Add room</button><button type="button" className="wf-button" onClick={() => confirmRemoval(`Remove ${floor.name} and its ${floor.rooms.length} rooms?`, () => changeBuilding({ ...building, floors: building.floors.filter(item => item.id !== floor.id) }))}>Remove floor</button></div>
            </details>)}
            <div className="wf-actions"><button type="button" className="wf-button" onClick={() => changeBuilding({ ...building, floors: [...building.floors, { id: uid('floor'), name: 'New floor', image: null, rooms: [] }] })}>Add floor</button><button type="button" className="wf-button" onClick={() => confirmRemoval(`Remove ${building.name}, all its floors and rooms? This can affect private room lookups.`, () => { change({ ...draft, buildings: draft.buildings.filter(item => item.id !== building.id) }); setBuildingId(''); })}>Remove building</button></div>
          </div>}
        </>}
      </fieldset>
      {removal && <div ref={confirmation} tabIndex={-1} className="wf-notice" role="alert"><p>{removal.label}</p><div className="wf-actions"><button type="button" className="wf-button" onClick={() => setRemoval(null)}>Cancel</button><button type="button" className="wf-button" onClick={() => { removal.action(); setRemoval(null); }}>Confirm change to draft</button></div></div>}
      <p className="wf-small wf-muted">Changes only go live after Save directions succeeds. Direct file edits are picked up on the next public request. Use the publishing workflow separately for Git history.</p>
    </>}
  </section>;
}
