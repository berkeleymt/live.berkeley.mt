import { lazy, Suspense, useId, useState } from 'react';
import { useSiteText } from '../site/text';
import { MapBoundary } from './MapBoundary';
import { routeBetween } from './routing';
import type { GraphMap, GraphNode, GraphEdge, WayfindingContent } from './types';

const FloorMap = lazy(() => import('./FloorMap').then(module => ({ default: module.FloorMap })));

function Layer({ map, nodes, edges, content }: { map: GraphMap; nodes: GraphNode[]; edges: GraphEdge[]; content: WayfindingContent }) {
  const t = useSiteText();
  const connections = edges.flatMap(edge => {
    const from = nodes.find(node => node.id === edge.from);
    const to = nodes.find(node => node.id === edge.to);
    return from && to ? [{ from, to }] : [];
  });
  const points = nodes.filter((_, index) => index === 0 || index === nodes.length - 1).map((node, index) => ({
    ...node,
    label: content.buildings.flatMap(building => building.floors.flatMap(floor => floor.rooms)).find(room => room.id === node.roomId)?.code ?? t(index ? 'route.endPin' : 'route.startPin'),
  }));
  return <figure className="wf-route-layer"><h4>{map.label}</h4>
    {map.image ? <MapBoundary failureText={t('rooms.mapError')}><Suspense fallback={<p className="wf-map-loading" role="status">{t('map.loadingPlan')}</p>}><FloorMap image={map.image} points={points} segments={connections} /></Suspense></MapBoundary> : <>
      <p className="wf-small">{t('route.noBackground')}</p>
      <div className="wf-route-canvas"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={t('route.overlay', { label: map.label })}>
        {connections.map(({ from, to }) => <line key={`${from.id}-${to.id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />)}
        {nodes.map(node => <circle key={node.id} cx={node.x} cy={node.y} r="1.8"><title>{node.label}</title></circle>)}
      </svg></div>
    </>}
    <figcaption>{map.image?.caption} {map.image?.demonstration && t('route.demoImage')}</figcaption>
  </figure>;
}

export function RoutePlanner({ content, selectedRoom, embedded = false, initialStepFree = false }: { content: WayfindingContent; selectedRoom?: string; embedded?: boolean; initialStepFree?: boolean }) {
  const t = useSiteText();
  const id = useId();
  const [origin, setOrigin] = useState<string | null>(null);
  const [destination, setDestination] = useState<{ room?: string; node: string | null }>({ room: selectedRoom, node: null });
  const [stepFree, setStepFree] = useState(initialStepFree);
  const graph = content.graph;
  if (!graph?.nodes.length) return <section className="wf-panel"><h2>{t('route.title')}</h2><p>{t('route.noGraph')}</p></section>;
  const target = graph.nodes.find(node => node.roomId === selectedRoom);
  const to = destination.room === selectedRoom ? destination.node ?? target?.id ?? '' : target?.id ?? '';
  const targetNode = graph.nodes.find(node => node.id === to);
  const from = origin ?? graph.nodes.find(node => node.mapId === targetNode?.mapId && !node.roomId)?.id ?? '';
  const result = routeBetween(graph, from, to, stepFree);
  const isDemo = result.status === 'found' && result.edges.some(edge => edge.status === 'demo');
  const isMapped = result.status === 'found' && result.edges.some(edge => edge.status === 'mapped');
  const maps = [...graph.maps].sort((a, b) => Number(!!a.image?.demonstration) - Number(!!b.image?.demonstration));
  const options = maps.map(map => <optgroup label={map.label} key={map.id}>{graph.nodes.filter(node => node.mapId === map.id).map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</optgroup>);
  return <section className={`wf-route-planner${embedded ? ' wf-route-embedded' : ' wf-panel'}`} id="route-planner" aria-label={t('route.title')}>{!embedded && <h2>{t('route.title')}</h2>}
    <div className="wf-two-fields">
      <label htmlFor={`${id}-from`}>{t('route.from')}<select id={`${id}-from`} value={from} onChange={event => setOrigin(event.target.value)}><option value="">{t('route.chooseFrom')}</option>{options}</select></label>
      <label htmlFor={`${id}-to`}>{t('route.to')}<select id={`${id}-to`} value={to} onChange={event => setDestination({ room: selectedRoom, node: event.target.value })}><option value="">{t('route.chooseTo')}</option>{options}</select></label>
    </div>
    {target && to !== target.id && <button className="wf-button" onClick={() => setDestination({ room: selectedRoom, node: target.id })}>{t('route.selected', { label: target.label })}</button>}
    {selectedRoom && !target && <p className="wf-notice">{t('route.unmapped')}</p>}
    <label className="wf-checkbox"><input type="checkbox" checked={stepFree} onChange={event => setStepFree(event.target.checked)} />{t('route.stepFree')}</label>
    <div role="status">{!from || !to ? <p>{t('route.chooseBoth')}</p> : result.status !== 'found' ? <p className="wf-notice">{t(stepFree ? 'route.noStepFree' : 'route.noRoute')}</p> : result.edges.length === 0 ? <p>{t('route.samePoint')}</p> : <p>{t(isDemo ? 'route.demoNotice' : isMapped ? 'route.mappedNotice' : 'route.verifiedNotice')}</p>}</div>
    {result.status === 'found' && result.edges.length > 0 && <>
      <div className="wf-route-layers">{maps.filter(map => result.nodes.some(id => graph.nodes.some(node => node.id === id && node.mapId === map.id))).map(map => <Layer key={map.id} map={map} content={content} nodes={result.nodes.flatMap(id => graph.nodes.filter(node => node.id === id && node.mapId === map.id))} edges={result.edges} />)}</div>
      <h3>{t('route.steps')}</h3><ol>{result.edges.map(edge => <li key={edge.id}>{edge.instruction}</li>)}</ol>
    </>}
    <div className="wf-route-refresh"><p className="wf-small">{t('route.reloadHint')}</p><button className="wf-button" onClick={() => window.location.reload()}>{t('route.reload')}</button></div>
  </section>;
}
