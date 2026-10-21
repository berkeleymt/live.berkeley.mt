import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { MapBoundary } from './MapBoundary';
import { ArrowSquareOut, MagnifyingGlass, MapPin } from '@phosphor-icons/react';
import { useSiteText } from '../site/text';
import { publicWayfindingError } from './publicErrors';
import { findRoom, resultKey, roomLabel, safeImageUrl, searchRooms, wayfindingRequest } from './api';
import { IdLookup } from './IdLookup';
import { RoutePlanner } from './RoutePlanner';
import type { Floor, PublicWayfindingDocument, SearchResult, WayfindingContent } from './types';
import './wayfinding.css';

const CampusMap = lazy(() => import('./CampusMap').then(module => ({ default: module.CampusMap })));
const FloorMap = lazy(() => import('./FloorMap').then(module => ({ default: module.FloorMap })));

function FloorPlan({ floor, roomId, onSelect }: { floor: Floor; roomId?: string; onSelect: (roomId: string) => void }) {
  const t = useSiteText();
  const image = floor.image;
  if (!image || !safeImageUrl(image.url)) return <p className="wf-muted">{t('rooms.noFloorPlan')}</p>;
  return <figure className="wf-floor-plan">
    {image.demonstration && <p className="wf-notice"><strong>{t('rooms.demoPlan')}</strong></p>}
    <MapBoundary failureText={t('rooms.floorPlanError')}><Suspense fallback={<p className="wf-map-loading" role="status">{t('map.loadingPlan')}</p>}><FloorMap image={image} selectedId={roomId} onSelect={onSelect} points={floor.rooms.flatMap(room => room.hotspot ? [{ id: room.id, label: room.code, ...room.hotspot }] : [])} /></Suspense></MapBoundary>
    <figcaption>{image.caption}</figcaption>
    <details><summary>{t('rooms.floorKey')}</summary><ul className="wf-plan-key" aria-label={t('rooms.floorKey')}>{floor.rooms.map(room => <li key={room.id}><button type="button" className="wf-button" aria-pressed={roomId === room.id} onClick={() => onSelect(room.id)}>{roomLabel(room)}</button></li>)}</ul></details>
  </figure>;
}

function Directions({ content, selection, accessible, setAccessible, selectRoom }: { content: WayfindingContent; selection: SearchResult; accessible: boolean; setAccessible: (value: boolean) => void; selectRoom: (id: string) => void }) {
  const t = useSiteText();
  const [showMap, setShowMap] = useState(false);
  const [planning, setPlanning] = useState(false);
  const { building, floor, room } = selection;
  const activeFloor = floor ?? building.floors[0];
  const route = room ? (accessible ? room.accessibleRoute : room.route) : undefined;
  const entrance = route ? building.entrances.find(item => item.id === route.entranceId) : undefined;
  return <>
    <div className="wf-place-heading"><MapPin size={24} aria-hidden /><div><p className="wf-muted">{building.name}{floor ? ` · ${floor.name}` : ''}</p><h3>{room ? roomLabel(room) : floor?.name ?? building.name}</h3></div></div>
    {room && !!content.graph?.nodes.length && <div className="wf-view-choice" role="group" aria-label={t('rooms.directions')}><button className="wf-button" aria-pressed={!planning} onClick={() => setPlanning(false)}>{t('map.floorView')}</button><button className="wf-button" aria-pressed={planning} onClick={() => setPlanning(true)}>{t('route.title')}</button></div>}
    {planning && room ? <RoutePlanner content={content} selectedRoom={room.id} embedded initialStepFree={accessible} /> : <>
    {activeFloor && <>{building.floors.length > 1 && <div className="wf-floor-tabs" role="group" aria-label={t('rooms.floors')}>{building.floors.map(item => <button type="button" key={item.id} className="wf-button" aria-pressed={activeFloor.id === item.id} onClick={() => selectRoom(item.id)}>{item.name}</button>)}</div>}<FloorPlan key={`${activeFloor.id}-${activeFloor.image?.url}`} floor={activeFloor} roomId={room?.id} onSelect={selectRoom} /></>}
    <div className={`wf-verification wf-${building.status}`}><strong>{t(`rooms.status.${building.status}`)}</strong><p>{building.verificationNote}</p></div>
    <fieldset className="wf-route-choice"><legend>{t('rooms.preference')}</legend>
      <label><input type="radio" name="room-route" checked={!accessible} onChange={() => setAccessible(false)} />{t('rooms.standard')}</label>
      <label><input type="radio" name="room-route" checked={accessible} onChange={() => setAccessible(true)} />{t('rooms.stepFree')}</label>
    </fieldset>
    {room && (route && entrance ? <div className="wf-directions">
      <h4>{t('rooms.findEntrance')}</h4><p><strong>{entrance.name}</strong> · {t(entrance.accessible ? 'rooms.markedStepFree' : 'rooms.mayHaveStairs')}</p><p className="wf-muted">{entrance.notes}</p>
      <ol>{entrance.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      <h4>{t('rooms.continue', { code: room.code })}</h4><ol>{route.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
    </div> : <p className="wf-notice" role="status">{t(accessible ? 'rooms.noStepFree' : 'rooms.noStandard')}</p>)}
    {!room && <>
      <h4>{t('rooms.entrances')}</h4>
      {building.entrances.filter(item => !accessible || item.accessible).length ? <ul className="wf-entrances">{building.entrances.filter(item => !accessible || item.accessible).map(item => <li key={item.id}><strong>{item.name}</strong>{item.accessible && <> · {t('rooms.markedStepFree')}</>}<p>{item.notes}</p><ol>{item.steps.map((step, index) => <li key={index}>{step}</li>)}</ol></li>)}</ul> : <p className="wf-notice">{t(accessible ? 'rooms.noAccessibleEntrances' : 'rooms.noEntrances')}</p>}
    </>}
    </>}
    <details className="wf-map-section"><summary>{t('rooms.campus')}</summary>
      <p className="wf-small wf-muted">{building.status === 'demo' ? t('rooms.demoMarker') : t('rooms.coordinates', { latitude: building.coordinates[0].toFixed(5), longitude: building.coordinates[1].toFixed(5) })}</p>
      <button type="button" className="wf-button" onClick={() => setShowMap(value => !value)} aria-expanded={showMap}>{t(showMap ? 'rooms.hideMap' : 'rooms.showMap')}</button>
      {showMap && <MapBoundary failureText={t('rooms.mapError')}><Suspense fallback={<p role="status">{t('map.loading')}</p>}><CampusMap building={building} entrance={entrance} /></Suspense></MapBoundary>}
      <p className="wf-small wf-muted">{t('rooms.mapPrivacy')}</p>
    </details>
  </>;
}

export function RoomLookup() {
  const t = useSiteText();
  const [document, setDocument] = useState<PublicWayfindingDocument | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    wayfindingRequest<PublicWayfindingDocument>('', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setDocument(value); }).catch(cause => { if (!controller.signal.aborted) setError(publicWayfindingError(cause, 'rooms')); });
    return () => controller.abort();
  }, [attempt]);
  if (error) return <div className="wf-error" role="alert"><p>{t(error)}</p><button className="wf-button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>{t('rooms.retry')}</button></div>;
  if (!document) return <p role="status">{t('rooms.loading')}</p>;
  return <div className="wf-page wf-lookup-only">
    {document.contentWarning && <p className="wf-error" role="status">{t('rooms.contentWarning')}</p>}
    <IdLookup info={document.lookup} content={document.content} directionsHref />
  </div>;
}

export function RoomFinder({ embedded = false, mapOnly = false, composed = false, title }: { embedded?: boolean; mapOnly?: boolean; composed?: boolean; title?: string }) {
  const t = useSiteText();
  const Container = embedded ? 'div' : 'main';
  const prefix = useId();
  const [document, setDocument] = useState<PublicWayfindingDocument | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('room') ?? '');
  const [accessible, setAccessible] = useState(false);
  const [browsing, setBrowsing] = useState(!selectedId);
  const search = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState(0);
  const details = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    wayfindingRequest<PublicWayfindingDocument>('', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setDocument(value); setLoading(false); } }).catch(cause => { if (!controller.signal.aborted) { setError(publicWayfindingError(cause, 'rooms')); setLoading(false); } });
    return () => controller.abort();
  }, [attempt]);
  function retry() { setError(''); setLoading(true); setAttempt(value => value + 1); }
  useEffect(() => {
    const restore = () => { const id = new URLSearchParams(window.location.search).get('room') ?? ''; setSelectedId(id); setBrowsing(!id); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  function select(id: string) {
    setSelectedId(id); setBrowsing(false);
    const url = new URL(window.location.href); url.searchParams.set('room', id);
    window.history.replaceState(window.history.state, '', url);
    // Only an explicit selection moves focus; data refresh never does.
    requestAnimationFrame(() => details.current?.focus());
  }
  const content = document?.content;
  const results = content ? searchRooms(content, query).sort((a, b) => Number(a.building.status === 'demo') - Number(b.building.status === 'demo')) : [];
  let selection: SearchResult | undefined;
  if (content) {
    selection = findRoom(content, selectedId);
    if (!selection) for (const building of content.buildings) {
      if (building.id === selectedId) selection = { building };
      const floor = building.floors.find(item => item.id === selectedId); if (floor) selection = { building, floor };
    }
  }
  return <Container className="wf-page">
    {!mapOnly && <header className="wf-header"><h1>{title ?? content?.title ?? t('rooms.title')}</h1><p>{content?.intro ?? t('rooms.intro')}</p></header>}
    {loading && <p role="status" className="wf-panel">{t('rooms.loading')}</p>}
    {error && <div role="alert" className="wf-error"><p>{t(error)}</p><button type="button" className="wf-button" onClick={retry}>{t('rooms.retry')}</button></div>}
    {content && document && <>
      {content.notice && <p className="wf-notice">{content.notice}</p>}
      {document.contentWarning && <p className="wf-error" role="status">{t('rooms.contentWarning')}</p>}
      {!mapOnly && <IdLookup info={document.lookup} content={content} onSelectRoom={select} />}
      {selection && <section className="wf-detail wf-panel" aria-labelledby={`${prefix}-directions`}>
        <div className="wf-selection-bar"><h2 ref={details} tabIndex={-1} id={`${prefix}-directions`}>{t('rooms.directions')}</h2><button type="button" className="wf-button" aria-expanded={browsing} aria-controls={`${prefix}-browse`} onClick={() => { setBrowsing(true); requestAnimationFrame(() => search.current?.focus()); }}>{t('rooms.change')}</button></div>
        <Directions key={selection.room?.id ?? selection.floor?.id ?? selection.building.id} content={content} selection={selection} accessible={accessible} setAccessible={setAccessible} selectRoom={select} />
      </section>}
      <details id={`${prefix}-browse`} className="wf-search-section" open={browsing || !selection} onToggle={event => setBrowsing(event.currentTarget.open)}>
        <summary id={`${prefix}-search-title`}>{t('rooms.browse')}</summary>
        <label htmlFor={`${prefix}-search`}>{t('rooms.search')}</label>
        <div className="wf-search-input"><MagnifyingGlass size={22} aria-hidden /><input ref={search} id={`${prefix}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('rooms.searchPlaceholder')} maxLength={120} autoComplete="off" /></div>
        <div className="wf-results">
          <p className="wf-small wf-muted" role="status">{results.length === 100 ? t('rooms.firstMatches', { count: 100 }) : t(query.trim() ? 'rooms.matches' : 'rooms.buildings', { count: results.length })}</p>
          {!results.length && <div className="wf-panel"><p>{t('rooms.empty')}</p><button type="button" className="wf-button" onClick={() => setQuery('')}>{t('rooms.clear')}</button><p className="wf-small">{t('rooms.missing')}</p></div>}
          <ul aria-label={t('rooms.matchesLabel')}>{results.map(result => <li key={resultKey(result)}><button type="button" aria-pressed={selectedId === resultKey(result)} className="wf-result" onClick={() => select(resultKey(result))}>
            <strong>{result.room ? roomLabel(result.room) : result.floor?.name ?? result.building.name}</strong>
            {(result.floor || result.room) && <span>{result.building.name}{result.room ? ` · ${result.floor?.name}` : ''}</span>}
            <span className="wf-small">{t(`rooms.status.${result.building.status}`)}</span>
          </button></li>)}</ul>
        </div>
        {!selection && selectedId && <p role="status">{t('rooms.removed')}</p>}
      </details>
      {!selection?.room && <details className="wf-general-route"><summary>{t('route.title')}</summary><RoutePlanner content={content} /></details>}
      {!composed && <footer className="wf-help"><h2>{t('rooms.before')}</h2><p>{content.helpText}</p><div className="wf-actions"><a href="/help">{t('rooms.help')}</a><a href={content.travelUrl} target="_blank" rel="noopener noreferrer">{t('rooms.transit')} <ArrowSquareOut size={18} aria-hidden /></a></div></footer>}
    </>}
  </Container>;
}
