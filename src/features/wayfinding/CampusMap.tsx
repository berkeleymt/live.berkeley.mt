import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import type { Building, Entrance } from './types';

/** Optional map; no geolocation API and no dependency on tiles for written directions. */
export function CampusMap({ building, entrance }: { building: Building; entrance?: Entrance }) {
  return <div className="wf-campus-map" aria-label={`Campus map centered on ${building.name}`}>
    <MapContainer key={building.id} center={building.coordinates} zoom={17} minZoom={14} maxZoom={19} scrollWheelZoom={false} className="wf-leaflet">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      <CircleMarker center={building.coordinates} radius={12} pathOptions={{ className: 'wf-building-marker', weight: 3, fillOpacity: 0.2 }}>
        <Tooltip permanent direction="top">{building.name}{building.status === 'demo' ? ' (fictional)' : ''}</Tooltip>
      </CircleMarker>
      {entrance && <CircleMarker center={entrance.coordinates} radius={7} pathOptions={{ className: 'wf-entrance-marker', weight: 3, fillOpacity: 0.8 }}>
        <Tooltip permanent direction="bottom">{entrance.name}</Tooltip>
      </CircleMarker>}
    </MapContainer>
  </div>;
}
