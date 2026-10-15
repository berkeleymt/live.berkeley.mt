import React, { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Polygon, Popup, Tooltip, CircleMarker, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { LatLngTuple } from "leaflet";
import type { VenueLocation } from "../data/types";

interface MapCardProps {
  venues: VenueLocation[];
}

// ── Building footprints from OpenStreetMap ──

interface BuildingFootprint {
  name: string;
  altName?: string;
  shortName: string;
  description: string;
  labelPos?: LatLngTuple;
  outer: LatLngTuple[];
  inner?: LatLngTuple[]; // courtyard cutout
}

const BUILDINGS: BuildingFootprint[] = [
  {
    name: "Dwinelle Hall",
    shortName: "Dwinelle",
    description: "Individual & Team rounds",
    outer: [
      [37.8709891, -122.2602104], [37.8709176, -122.2605201], [37.8709327, -122.2605262],
      [37.8709457, -122.2605315], [37.8709510, -122.2605155], [37.8711331, -122.2605818],
      [37.8711558, -122.2605014], [37.8712802, -122.2605503], [37.8711906, -122.2609103],
      [37.8711045, -122.2612564], [37.8706159, -122.2610713], [37.8706371, -122.2609921],
      [37.8706534, -122.2609314], [37.8706583, -122.2609339], [37.8706916, -122.2607890],
      [37.8704956, -122.2607329], [37.8703428, -122.2606891], [37.8703338, -122.2607421],
      [37.8702920, -122.2607361], [37.8702851, -122.2607837], [37.8701502, -122.2607559],
      [37.8702486, -122.2600039], [37.8703150, -122.2600175], [37.8703824, -122.2600314],
      [37.8703753, -122.2600825], [37.8704181, -122.2600914], [37.8703934, -122.2602785],
      [37.8704622, -122.2602991], [37.8705862, -122.2603335], [37.8706230, -122.2603437],
      [37.8706510, -122.2603515], [37.8707654, -122.2603826], [37.8708069, -122.2602012],
      [37.8708472, -122.2602143], [37.8708533, -122.2601901], [37.8708598, -122.2601647],
      [37.8709261, -122.2601881],
    ],
    inner: [
      [37.8707700, -122.2609769], [37.8710298, -122.2610700],
      [37.8711058, -122.2607374], [37.8708504, -122.2606420],
    ],
  },
  {
    name: "Wheeler Hall",
    shortName: "Wheeler",
    description: "Individual & Team rounds",
    labelPos: [37.8718, -122.2588],
    outer: [
      [37.8716292, -122.2589210], [37.8715958, -122.2590670], [37.8714710, -122.2596137],
      [37.8713758, -122.2595788], [37.8713860, -122.2595339], [37.8710957, -122.2594275],
      [37.8710882, -122.2594605], [37.8709857, -122.2594229], [37.8710221, -122.2592635],
      [37.8711124, -122.2588677], [37.8711455, -122.2587223], [37.8712677, -122.2587671],
      [37.8712570, -122.2588140], [37.8715361, -122.2589162], [37.8715423, -122.2588892],
    ],
  },
  {
    name: "Valley Life Sciences",
    altName: "Building (VLSB)",
    shortName: "VLSB",
    description: "Individual & Team rounds",
    labelPos: [37.8720, -122.2628],
    outer: [
      [37.8715200, -122.2627897], [37.8716519, -122.2628408], [37.8716776, -122.2627331],
      [37.8717708, -122.2623431], [37.8717938, -122.2622466], [37.8719032, -122.2617976],
      [37.8719334, -122.2616744], [37.8717970, -122.2616215], [37.8718379, -122.2614198],
      [37.8717787, -122.2613945], [37.8717317, -122.2613478], [37.8717074, -122.2613381],
      [37.8717104, -122.2613220], [37.8716716, -122.2613070], [37.8716320, -122.2612938],
      [37.8716283, -122.2613086], [37.8715923, -122.2612955], [37.8715453, -122.2613050],
      [37.8714771, -122.2612805], [37.8714255, -122.2614819], [37.8712918, -122.2614301],
      [37.8712601, -122.2615695], [37.8711727, -122.2619539], [37.8711552, -122.2620310],
      [37.8711439, -122.2620781], [37.8710461, -122.2624872], [37.8710192, -122.2625999],
      [37.8711527, -122.2626498], [37.8711061, -122.2628484], [37.8712173, -122.2628903],
      [37.8712434, -122.2629004], [37.8714712, -122.2629896],
    ],
    inner: [
      [37.8715848, -122.2620921], [37.8714514, -122.2620458], [37.8714816, -122.2619063],
      [37.8713853, -122.2618729], [37.8714157, -122.2617322], [37.8717590, -122.2618513],
      [37.8717307, -122.2619820], [37.8716171, -122.2619426],
    ],
  },
  {
    name: "Pauley Ballroom",
    altName: "(MLK Student Union)",
    shortName: "MLK",
    description: "Pauley Ballroom — Opening & Awards ceremonies",
    labelPos: [37.8688, -122.2597],
    outer: [
      [37.8689012, -122.2593391], [37.8690994, -122.2593781], [37.8694345, -122.2594441],
      [37.8694323, -122.2594729], [37.8694185, -122.2595796], [37.8694049, -122.2596911],
      [37.8693928, -122.2597892], [37.8694042, -122.2597912], [37.8693785, -122.2600352],
      [37.8690444, -122.2599592], [37.8690395, -122.2599969], [37.8689078, -122.2599286],
      [37.8689193, -122.2598581], [37.8689273, -122.2598091], [37.8689120, -122.2598060],
      [37.8688482, -122.2597882], [37.8688231, -122.2597695], [37.8687865, -122.2597486],
      [37.8687864, -122.2597420], [37.8687825, -122.2595870], [37.8688044, -122.2594121],
      [37.8688598, -122.2594135], [37.8688912, -122.2594146],
    ],
  },
];

// ── Parking garages ──

interface ParkingGarage {
  num: number;
  name: string;
  pos: LatLngTuple;
}

const PARKING: ParkingGarage[] = [
  { num: 1, name: "Telegraph-Channing Garage", pos: [37.86757, -122.26009] },
  { num: 2, name: "Underhill Parking Garage", pos: [37.86666, -122.25486] },
  { num: 3, name: "Allston Way Garage", pos: [37.86965, -122.26916] },
  { num: 4, name: "RSF Garage", pos: [37.8681, -122.2627] },
  { num: 5, name: "Lower Hearst Structure", pos: [37.87521, -122.26143] },
  { num: 6, name: "Stadium Parking Garage", pos: [37.87233, -122.25284] },
  { num: 7, name: "Center Street Garage", pos: [37.8703, -122.2688] },
  { num: 8, name: "UNEX Lot", pos: [37.8730, -122.2700] },
];

// ── Points of interest ──

const BART_STATION: LatLngTuple = [37.86980, -122.26820];
const CHECK_IN: LatLngTuple = [37.8704, -122.2606];


// ── Campus boundary (Hearst → Gayley/Piedmont → Bancroft → Oxford, from OSM) ──

const CAMPUS_BOUNDARY: LatLngTuple[] = [
  // NW corner: Hearst & Oxford (OSM node 53055195)
  [37.8741493, -122.2663119],
  // Hearst Ave (W → E)
  [37.8742, -122.2654],
  [37.8743, -122.2645],
  [37.8745, -122.2637],
  [37.8747, -122.2630],
  [37.8748, -122.2622],
  [37.8749, -122.2615],
  [37.8749, -122.2607],
  [37.8750, -122.2602],
  [37.8751, -122.2596],
  [37.8752, -122.2590],
  [37.8752, -122.2585],
  [37.8753, -122.2580],
  [37.8754, -122.2573],
  // NE corner: Hearst & Gayley (OSM node 53021369)
  [37.8755233, -122.2568235],
  // Gayley Rd / Piedmont Ave (N → S)
  [37.8750, -122.2562],
  [37.8746, -122.2559],
  [37.8743, -122.2558],
  [37.8739, -122.2555],
  [37.8735, -122.2551],
  [37.8731, -122.2547],
  [37.8728, -122.2541],
  [37.8726, -122.2538],
  [37.8723, -122.2533],
  [37.8720, -122.2530],
  [37.8718, -122.2529],
  [37.8715, -122.2528],
  [37.8713, -122.2526],
  [37.8710, -122.2527],
  [37.8707, -122.2526],
  [37.8703, -122.2524],
  [37.8700, -122.2523],
  [37.8697, -122.2522],
  [37.8693, -122.2522],
  // SE corner: Bancroft & Piedmont (OSM node 53055618)
  [37.8691718, -122.2521538],
  // Bancroft Way (E → W)
  [37.8692, -122.2535],
  [37.8693, -122.2541],
  [37.8692, -122.2546],
  [37.8692, -122.2551],
  [37.8691, -122.2559],
  [37.8690, -122.2569],
  [37.8690, -122.2573],
  [37.8689, -122.2579],
  [37.8688, -122.2584],
  [37.8688, -122.2592],
  [37.8687, -122.2597],
  [37.8686, -122.2602],
  [37.8686, -122.2610],
  [37.8685, -122.2615],
  [37.8684, -122.2623],
  [37.8682, -122.2630],
  [37.8681, -122.2638],
  [37.8680, -122.2646],
  [37.8680, -122.2654],
  // SW corner: Bancroft & Oxford/Fulton intersection
  [37.8678, -122.2659],
  // Oxford St / Fulton St (S → N)
  [37.8680, -122.2658],
  [37.8687, -122.2662],
  [37.8689, -122.2662],
  [37.8693, -122.2658],
  [37.8695, -122.2658],
  [37.8697, -122.2658],
  [37.8699, -122.2657],
  [37.8702, -122.2658],
  [37.8706, -122.2659],
  [37.8710, -122.2659],
  [37.8715, -122.2660],
  [37.8719, -122.2660],
  [37.8723, -122.2661],
  [37.8727, -122.2661],
  [37.8731, -122.2661],
  [37.8734, -122.2662],
  [37.8737, -122.2662],
  [37.8740, -122.2663],
];

// ── Styles ──

const MAP_CENTER: LatLngTuple = [37.8704, -122.2608];
const BUILDING_STYLE = {
  color: "#1d4ed8",
  weight: 2,
  fillColor: "#3b82f6",
  fillOpacity: 0.12,
};
const BUILDING_HOVER_STYLE = {
  fillOpacity: 0.3,
};
const CAMPUS_STYLE = {
  color: "#16a34a",
  weight: 1.5,
  fillColor: "#86efac",
  fillOpacity: 0.08,
  dashArray: "6 4",
};

// ── Custom icons ──

const invisibleIcon = L.divIcon({ className: "", iconSize: [0, 0] });

function parkingIcon(num: number) {
  return L.divIcon({
    className: "parking-marker",
    html: `<span>${num}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

const bartIcon = L.divIcon({
  className: "bart-marker",
  html: `<span>BART</span>`,
  iconSize: [40, 20],
  iconAnchor: [20, 10],
});

const checkInIcon = L.divIcon({
  className: "checkin-marker",
  html: `<span>★</span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

// ── User location ──

function useUserLocation() {
  const [pos, setPos] = useState<LatLngTuple | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => { setPos([p.coords.latitude, p.coords.longitude]); setError(""); },
      () => setError("Location unavailable. You can still browse the campus map."),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { pos, error };
}

function UserLocationMarker() {
  const { pos, error } = useUserLocation();
  const map = useMap();

  useEffect(() => {
    if (pos) map.setView(pos, map.getZoom(), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos !== null]);

  if (!pos) return <div role="status" className="absolute bottom-7 left-3 right-3 z-[1000] rounded bg-white p-3 text-sm text-berkeley-blue shadow-md">{error || (!navigator.geolocation ? "Location is not supported in this browser." : "Finding your location…")}</div>;
  return (
    <>
      <CircleMarker
        center={pos}
        radius={24}
        pathOptions={{ color: "transparent", fillColor: "#007AFF", fillOpacity: 0.1 }}
      />
      <CircleMarker
        center={pos}
        radius={7}
        pathOptions={{ color: "#fff", weight: 2.5, fillColor: "#007AFF", fillOpacity: 1 }}
      />
    </>
  );
}

// ── Compact card (static preview) ──

export function MapCardCompact({ venues }: MapCardProps) {
  return (
    <div className="h-full relative overflow-hidden">
      <img
        src="/campus-map.png"
        alt="BmMT 2026 Campus Map"
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[20px] leading-none">📍</span>
          <p className="text-[18px] font-bold text-white tracking-tight">Map</p>
        </div>
        <p className="text-[13px] text-white/70 leading-tight mt-0.5">
          {venues.length} locations
        </p>
      </div>
    </div>
  );
}

// ── Expanded card (interactive Leaflet map) ──

const LABEL_MIN_ZOOM = 15;

function ZoomAwareBuildings({ parkingIcons }: { parkingIcons: L.DivIcon[] }) {
  const [zoom, setZoom] = useState(16);
  useMapEvents({
    zoomend: (e) => setZoom(e.target.getZoom()),
  });
  const showLabels = zoom >= LABEL_MIN_ZOOM;

  return (
    <>
      {/* Building footprints */}
      {BUILDINGS.map((b) => (
        <React.Fragment key={b.shortName}>
        <Polygon
          positions={b.inner ? [b.outer, b.inner] : b.outer}
          pathOptions={BUILDING_STYLE}
          eventHandlers={{
            mouseover: (e) => e.target.setStyle(BUILDING_HOVER_STYLE),
            mouseout: (e) => e.target.setStyle({ fillOpacity: BUILDING_STYLE.fillOpacity }),
          }}
        >
          {showLabels && !b.labelPos && (
            <Tooltip permanent direction="center" className="building-label">
              {b.name}{b.altName ? <><br />{b.altName}</> : ""}
            </Tooltip>
          )}
          <Popup>
            <div className="text-center">
              <strong className="text-[14px]">{b.name}</strong>
              <br />
              <span className="text-[12px] text-gray-600">{b.description}</span>
            </div>
          </Popup>
        </Polygon>
        {showLabels && b.labelPos && (
          <Marker position={b.labelPos} icon={invisibleIcon} interactive={false}>
            <Tooltip permanent direction="center" className="building-label">
              {b.name}{b.altName ? <><br />{b.altName}</> : ""}
            </Tooltip>
          </Marker>
        )}
        </React.Fragment>
      ))}

      {/* Parking garages */}
      {PARKING.map((p, i) => (
        <Marker key={`parking-${p.num}`} position={p.pos} icon={parkingIcons[i]}>
          <Popup>
            <div className="text-center">
              <strong className="text-[13px]">{p.name}</strong>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* BART station */}
        <Marker position={BART_STATION} icon={bartIcon}>
          <Popup>
            <strong className="text-[13px]">Downtown Berkeley BART</strong>
          </Popup>
        </Marker>

        {/* Check-in */}
        <Marker position={CHECK_IN} icon={checkInIcon}>
          <Popup>
            <div className="text-center">
              <strong className="text-[13px]">Check In Here</strong>
              <br />
              <span className="text-[12px] text-gray-600">Dwinelle Hall plaza</span>
            </div>
          </Popup>
        </Marker>
    </>
  );
}

export function MapCardExpanded() {
  const parkingIcons = useMemo(() => PARKING.map((p) => parkingIcon(p.num)), []);
  const [locating, setLocating] = useState(false);

  return (
    <div className="h-full relative">
      <button type="button" onClick={() => setLocating(!locating)} aria-pressed={locating} className="absolute top-3 right-3 z-[1000] rounded bg-white px-3 py-2 text-sm text-berkeley-blue shadow-md min-h-11">
        {locating ? "Stop locating" : "Use my location"}
      </button>
      <MapContainer
        center={MAP_CENTER}
        zoom={16}
        minZoom={14}
        maxZoom={19}
        className="w-full h-full"
        zoomControl
        attributionControl
        scrollWheelZoom={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        />

        {/* Campus boundary */}
        <Polygon positions={CAMPUS_BOUNDARY} pathOptions={CAMPUS_STYLE} />

        <ZoomAwareBuildings parkingIcons={parkingIcons} />
        {locating && <UserLocationMarker />}
      </MapContainer>
    </div>
  );
}
