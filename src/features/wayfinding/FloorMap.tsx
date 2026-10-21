import { useEffect, useMemo, useState } from 'react';
import { CRS, DomEvent, divIcon, latLngBounds } from 'leaflet';
import { ImageOverlay, MapContainer, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { useSiteText } from '../site/text';
import { safeImageUrl } from './api';
import type { FloorImage } from './types';
import 'leaflet/dist/leaflet.css';

export interface MapPoint { id: string; label: string; x: number; y: number }
interface Props {
  image: FloorImage;
  points: MapPoint[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  segments?: { from: MapPoint; to: MapPoint }[];
  onPlacePoint?: (point: { x: number; y: number }) => void;
}

function MapTools({ width, height, selected, onPlacePoint }: { width: number; height: number; selected?: MapPoint; onPlacePoint?: Props['onPlacePoint'] }) {
  const t = useSiteText();
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const selectedX = selected?.x;
  const selectedY = selected?.y;
  useMapEvents({ zoomend: () => setZoom(map.getZoom()), click: event => {
    const x = event.latlng.lng / width * 100;
    const y = (1 - event.latlng.lat / height) * 100;
    if (x >= 0 && x <= 100 && y >= 0 && y <= 100) onPlacePoint?.({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  } });
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      map.setMinZoom(map.getBoundsZoom([[0, 0], [height, width]]) - 0.5);
    });
    observer.observe(map.getContainer());
    map.getContainer().setAttribute('aria-label', t('map.indoorKeyboard'));
    return () => observer.disconnect();
  }, [map, t, width, height]);
  useEffect(() => {
    if (selectedX !== undefined && selectedY !== undefined) map.panTo([height * (1 - selectedY / 100), width * selectedX / 100], { animate: false });
  }, [map, width, height, selectedX, selectedY]);
  return <div className="wf-map-tools" ref={element => { if (element) { DomEvent.disableClickPropagation(element); DomEvent.disableScrollPropagation(element); } }}>
    <button type="button" onClick={() => map.zoomIn()} disabled={zoom >= map.getMaxZoom()} aria-label={t('map.zoomIn')} title={t('map.zoomIn')}>+</button>
    <button type="button" onClick={() => map.zoomOut()} disabled={zoom <= map.getMinZoom()} aria-label={t('map.zoomOut')} title={t('map.zoomOut')}>−</button>
    <button type="button" onClick={() => map.fitBounds([[0, 0], [height, width]], { padding: [16, 16], animate: false })}>{t('map.fit')}</button>
  </div>;
}

function RoomMarker({ point, width, height, selected, onSelect }: { point: MapPoint; width: number; height: number; selected: boolean; onSelect?: (id: string) => void }) {
  const icon = useMemo(() => {
    const label = document.createElement('span');
    label.textContent = point.label;
    return divIcon({ html: label, className: `wf-map-room${selected ? ' wf-map-room-selected' : ''}`, iconSize: [48, 48], iconAnchor: [24, 24] });
  }, [point.label, selected]);
  return <Marker position={[height * (1 - point.y / 100), width * point.x / 100]} icon={icon} title={point.label} alt={point.label} keyboard eventHandlers={{ click: () => onSelect?.(point.id) }}><Tooltip direction="top">{point.label}</Tooltip></Marker>;
}

function RoomMarkers({ points, width, height, selectedId, onSelect }: { points: MapPoint[]; width: number; height: number; selectedId?: string; onSelect?: Props['onSelect'] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const visible: MapPoint[] = [];
  const pixels: { x: number; y: number }[] = [];
  const ordered = [...points].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
  for (const point of ordered) {
    const pixel = map.project([height * (1 - point.y / 100), width * point.x / 100], zoom);
    if (pixels.some(other => Math.abs(other.x - pixel.x) < 52 && Math.abs(other.y - pixel.y) < 52)) continue;
    visible.push(point); pixels.push(pixel);
  }
  return visible.map(point => <RoomMarker key={point.id} point={point} width={width} height={height} selected={point.id === selectedId} onSelect={onSelect} />);
}

export function FloorMap({ image, points, selectedId, onSelect, segments = [], onPlacePoint }: Props) {
  const t = useSiteText();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ url: string; width: number; height: number; failed: boolean } | null>(null);
  useEffect(() => {
    if (!safeImageUrl(image.url)) return;
    const source = new Image();
    source.referrerPolicy = 'no-referrer';
    source.onload = () => setLoaded({ url: image.url, width: source.naturalWidth, height: source.naturalHeight, failed: !source.naturalWidth || !source.naturalHeight });
    source.onerror = () => setLoaded({ url: image.url, width: 0, height: 0, failed: true });
    source.src = image.url;
    return () => { source.onload = null; source.onerror = null; };
  }, [image.url, attempt]);
  if (!safeImageUrl(image.url) || (loaded?.url === image.url && loaded.failed)) return <div className="wf-notice" role="status"><p>{t('rooms.floorPlanError')}</p><button className="wf-button" type="button" onClick={() => { setLoaded(null); setAttempt(value => value + 1); }}>{t('rooms.retryImage')}</button></div>;
  if (!loaded || loaded.url !== image.url) return <p role="status" className="wf-map-loading">{t('map.loadingPlan')}</p>;
  const { width, height } = loaded;
  const bounds = latLngBounds([0, 0], [height, width]);
  const position = (point: MapPoint): [number, number] => [height * (1 - point.y / 100), width * point.x / 100];
  return <div className="wf-indoor-map" role="region" aria-label={image.alt}>
    <MapContainer key={image.url} crs={CRS.Simple} bounds={bounds} boundsOptions={{ padding: [16, 16] }} minZoom={-5} maxZoom={2} zoomSnap={0.25} zoomDelta={0.5} maxBounds={bounds.pad(0.5)} maxBoundsViscosity={1} zoomControl={false} attributionControl={false} scrollWheelZoom={false} className="wf-floor-canvas">
      <ImageOverlay url={image.url} bounds={bounds} alt={image.alt} />
      {segments.map(({ from, to }, index) => <Polyline key={`${from.id}-${to.id}-${index}`} positions={[position(from), position(to)]} pathOptions={{ className: 'wf-indoor-route', weight: 6, opacity: 0.9 }} />)}
      <RoomMarkers points={points} width={width} height={height} selectedId={selectedId} onSelect={onSelect} />
      <MapTools width={width} height={height} selected={points.find(point => point.id === selectedId)} onPlacePoint={onPlacePoint} />
    </MapContainer>
    <p className="wf-map-hint">{t('map.gestures')}</p>
  </div>;
}
