import { Component, lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowSquareOut, MagnifyingGlass, MapPin } from '@phosphor-icons/react';
import { findRoom, requestMessage, resultKey, safeImageUrl, searchRooms, wayfindingRequest } from './api';
import { StudentLookup } from './StudentLookup';
import type { Floor, PublicWayfindingDocument, SearchResult } from './types';
import './wayfinding.css';

const CampusMap = lazy(() => import('./CampusMap').then(module => ({ default: module.CampusMap })));
const statusText = { demo: 'Demonstration only', unverified: 'Not yet verified', verified: 'Staff-verified directions' };

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="status" className="wf-notice">The optional map could not load. Written directions remain available. Check your connection and reload the page to retry the map.</p> : this.props.children;
  }
}

function FloorPlan({ floor, roomId, onSelect }: { floor: Floor; roomId?: string; onSelect: (roomId: string) => void }) {
  const [failed, setFailed] = useState(false);
  const image = floor.image;
  if (!image || !safeImageUrl(image.url)) return <p className="wf-muted">No floor plan is published for this floor. Use the written directions or ask staff.</p>;
  return <figure className="wf-floor-plan">
    {image.demonstration && <p className="wf-notice"><strong>Demonstration plan — not a real campus layout.</strong></p>}
    {failed ? <p role="status" className="wf-notice">The floor-plan image could not load. Written directions are still available. <button type="button" className="wf-button" onClick={() => setFailed(false)}>Retry image</button></p> : <div className="wf-plan-image">
      <img src={image.url} alt={image.alt} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      {floor.rooms.map((room, index) => room.hotspot && <button key={room.id} type="button" className="wf-hotspot" style={{ left: `${room.hotspot.x}%`, top: `${room.hotspot.y}%` }} aria-label={`${room.code}: ${room.name}`} aria-pressed={roomId === room.id} onClick={() => onSelect(room.id)}>{index + 1}</button>)}
    </div>}
    <figcaption>{image.caption}</figcaption>
    <ul className="wf-plan-key" aria-label="Rooms on this floor">{floor.rooms.map((room, index) => <li key={room.id}><button type="button" className="wf-button" aria-pressed={roomId === room.id} onClick={() => onSelect(room.id)}>{room.hotspot ? `${index + 1}. ` : ''}{room.code} · {room.name}</button></li>)}</ul>
  </figure>;
}

function Directions({ selection, accessible, setAccessible, selectRoom }: { selection: SearchResult; accessible: boolean; setAccessible: (value: boolean) => void; selectRoom: (id: string) => void }) {
  const [showMap, setShowMap] = useState(false);
  const { building, floor, room } = selection;
  const route = room ? (accessible ? room.accessibleRoute : room.route) : undefined;
  const entrance = route ? building.entrances.find(item => item.id === route.entranceId) : undefined;
  return <>
    <div className="wf-place-heading"><MapPin size={24} aria-hidden /><div><p className="wf-muted">{building.name}{floor ? ` · ${floor.name}` : ''}</p><h3>{room ? `${room.code} · ${room.name}` : floor?.name ?? building.name}</h3></div></div>
    <div className={`wf-verification wf-${building.status}`}><strong>{statusText[building.status]}</strong><p>{building.verificationNote}</p></div>
    <fieldset className="wf-route-choice"><legend>Route preference</legend>
      <label><input type="radio" name="room-route" checked={!accessible} onChange={() => setAccessible(false)} />Standard route</label>
      <label><input type="radio" name="room-route" checked={accessible} onChange={() => setAccessible(true)} />Step-free route</label>
    </fieldset>
    {room && (route && entrance ? <div className="wf-directions">
      <h4>1. Find the entrance</h4><p><strong>{entrance.name}</strong> · {entrance.accessible ? 'Marked step-free' : 'May include stairs'}</p><p className="wf-muted">{entrance.notes}</p>
      <ol>{entrance.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      <h4>2. Continue to {room.code}</h4><ol>{route.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
    </div> : <p className="wf-notice" role="status">No {accessible ? 'step-free' : 'standard'} route is published for this room. Do not assume the standard route is accessible. Ask the BMT help desk for assistance.</p>)}
    {!room && <>
      <h4>Entrances</h4>
      {building.entrances.filter(item => !accessible || item.accessible).length ? <ul className="wf-entrances">{building.entrances.filter(item => !accessible || item.accessible).map(item => <li key={item.id}><strong>{item.name}</strong>{item.accessible && ' · Marked step-free'}<p>{item.notes}</p><ol>{item.steps.map((step, index) => <li key={index}>{step}</li>)}</ol></li>)}</ul> : <p className="wf-notice">{accessible ? 'No step-free entrances have been published. Ask staff for an accessible route.' : 'Entrance directions are not published yet. Ask staff before setting off.'}</p>}
      {!floor && <><h4>Floors and rooms</h4>{building.floors.length ? building.floors.map(item => <section key={item.id} className="wf-floor-summary"><h4>{item.name}</h4><ul className="wf-plan-key">{item.rooms.map(candidate => <li key={candidate.id}><button type="button" className="wf-button" onClick={() => selectRoom(candidate.id)}>{candidate.code} · {candidate.name}</button></li>)}</ul></section>) : <p className="wf-muted">Tournament rooms have not been added yet. Try the Demo Learning Center to explore the room-finding flow.</p>}</>}
    </>}
    {floor && <><h4>Floor plan</h4><FloorPlan key={`${floor.id}-${floor.image?.url}`} floor={floor} roomId={room?.id} onSelect={selectRoom} /></>}
    <div className="wf-map-section"><h4>Building on campus</h4>
      <p className="wf-small wf-muted">{building.status === 'demo' ? 'Fictional building marker for the demo. Not an actual campus destination.' : `Approximate location: ${building.coordinates[0].toFixed(5)}, ${building.coordinates[1].toFixed(5)}. Use the entrance instructions, not the building center, for access.`}</p>
      <button type="button" className="wf-button" onClick={() => setShowMap(value => !value)} aria-expanded={showMap}>{showMap ? 'Hide campus map' : 'Show campus map'}</button>
      {showMap && <MapBoundary><Suspense fallback={<p role="status">Loading campus map…</p>}><CampusMap building={building} entrance={entrance} /></Suspense></MapBoundary>}
      <p className="wf-small wf-muted">Optional map tiles need a connection. Your location is never requested. Written directions remain available if the map is blank.</p>
    </div>
  </>;
}

export function RoomFinder() {
  const prefix = useId();
  const [document, setDocument] = useState<PublicWayfindingDocument | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('room') ?? '');
  const [accessible, setAccessible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const details = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    wayfindingRequest<PublicWayfindingDocument>('', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setDocument(value); setLoading(false); } }).catch(cause => { if (!controller.signal.aborted) { setError(requestMessage(cause)); setLoading(false); } });
    return () => controller.abort();
  }, [attempt]);
  function retry() { setError(''); setLoading(true); setAttempt(value => value + 1); }
  function select(id: string) { setSelectedId(id); requestAnimationFrame(() => details.current?.focus()); }
  const content = document?.content;
  const results = content ? searchRooms(content, query) : [];
  let selection: SearchResult | undefined;
  if (content) {
    selection = findRoom(content, selectedId);
    if (!selection) for (const building of content.buildings) {
      if (building.id === selectedId) selection = { building };
      const floor = building.floors.find(item => item.id === selectedId); if (floor) selection = { building, floor };
    }
  }
  return <main className="wf-page">
    <header className="wf-header"><p className="wf-eyebrow">BMT · November 14, 2026</p><h1>{content?.title ?? 'Find your room'}</h1><p>{content?.intro ?? 'Building directions and private room lookup.'}</p></header>
    {loading && <p role="status" className="wf-panel">Loading rooms and directions…</p>}
    {error && <div role="alert" className="wf-error"><p>{error}</p><button type="button" className="wf-button" onClick={retry}>Retry loading rooms</button></div>}
    {content && document && <>
      {content.notice && <p className="wf-notice">{content.notice}</p>}
      {document.contentWarning && <p className="wf-error" role="status">{document.contentWarning}</p>}
      <StudentLookup info={document.lookup} content={content} onSelectRoom={select} />
      <section className="wf-search-section" aria-labelledby={`${prefix}-search-title`}>
        <h2 id={`${prefix}-search-title`}>Browse buildings and rooms</h2>
        <label htmlFor={`${prefix}-search`}>Building, floor or room</label>
        <div className="wf-search-input"><MagnifyingGlass size={22} aria-hidden /><input id={`${prefix}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Try Dwinelle, ground floor or A101" maxLength={120} autoComplete="off" /></div>
        <div className="wf-browse-grid"><div className="wf-results">
          <p className="wf-small wf-muted" role="status">{results.length === 100 ? 'Showing the first 100 matches. Refine your search.' : `${results.length} ${query.trim() ? 'matches' : 'buildings'}`}</p>
          {!results.length && <div className="wf-panel"><p>No rooms or buildings match that search.</p><button type="button" className="wf-button" onClick={() => setQuery('')}>Clear search</button><p className="wf-small">If your assigned room is missing, ask the BMT help desk.</p></div>}
          <ul aria-label="Matching places">{results.map(result => <li key={resultKey(result)}><button type="button" aria-pressed={selectedId === resultKey(result)} className="wf-result" onClick={() => select(resultKey(result))}>
            <strong>{result.room ? `${result.room.code} · ${result.room.name}` : result.floor?.name ?? result.building.name}</strong>
            {(result.floor || result.room) && <span>{result.building.name}{result.room ? ` · ${result.floor?.name}` : ''}</span>}
            <span className="wf-small">{statusText[result.building.status]}</span>
          </button></li>)}</ul>
        </div>
        <section className="wf-detail wf-panel" aria-labelledby={`${prefix}-directions`}>
          <h2 ref={details} tabIndex={-1} id={`${prefix}-directions`}>Directions</h2>
          {selection ? <Directions key={selection.building.id} selection={selection} accessible={accessible} setAccessible={setAccessible} selectRoom={select} /> : <div className="wf-empty"><MapPin size={32} aria-hidden /><h3>Choose a building or room</h3><p>{selectedId ? 'That room is no longer listed. Search again or ask the help desk.' : 'See its entrance, route and floor plan here. Choose a step-free route when you need one.'}</p></div>}
        </section></div>
      </section>
      <footer className="wf-help"><h2>Before you set off</h2><p>{content.helpText}</p><div className="wf-actions"><a href="/help">Ask for help</a><a href={content.travelUrl} target="_blank" rel="noopener noreferrer">Plan transit with TakeTransit <ArrowSquareOut size={18} aria-hidden /></a></div></footer>
    </>}
  </main>;
}
