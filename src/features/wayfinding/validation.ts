import type { WayfindingContent } from './types';
import { safeImageUrl } from './api';

/** Structural guard for raw JSON editing. Server validation is authoritative. */
export function parseWayfinding(value: unknown): WayfindingContent {
  function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const result = value as Record<string, unknown>;
    if (Object.keys(result).some(key => !keys.includes(key))) throw new Error(`${label} contains an unknown field. Never add student information to public directions.`);
    return result;
  }
  function text(value: unknown, label: string, max: number, optional = false) {
    if (typeof value !== 'string' || (!optional && !value.trim()) || new TextEncoder().encode(value).length > max) throw new Error(`${label} needs text up to ${max} bytes.`);
  }
  function list(value: unknown, max: number, label: string): unknown[] {
    if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be a list with at most ${max} entries.`);
    return value;
  }
  function coords(value: unknown) {
    if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'number' || !Number.isFinite(v)) || Math.abs(value[0]) > 90 || Math.abs(value[1]) > 180) throw new Error('Coordinates must be [latitude, longitude] within the geographic range.');
  }
  function steps(value: unknown) {
    const entries = list(value, 12, 'Direction steps');
    if (!entries.length) throw new Error('Each route needs at least one direction step.');
    entries.forEach(item => text(item, 'Direction step', 500));
  }
  const seen = new Set<string>();
  function identifier(value: unknown, local = seen): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value) || local.has(value)) throw new Error('IDs must be unique, 1–64 characters, with only letters, numbers, hyphens or underscores.');
    local.add(value); return value;
  }
  const content = object(value, ['title', 'intro', 'notice', 'helpText', 'travelUrl', 'buildings', 'graph'], 'Directions');
  text(content.title, 'Title', 120); text(content.intro, 'Introduction', 1000); text(content.notice, 'Notice', 1500, true); text(content.helpText, 'Help text', 1000);
  text(content.travelUrl, 'TakeTransit URL', 1000);
  if (!String(content.travelUrl).startsWith('https://') || !safeImageUrl(String(content.travelUrl))) throw new Error('The transit link must be a safe HTTPS URL.');
  let roomCount = 0;
  for (const value of list(content.buildings, 50, 'Buildings')) {
    const building = object(value, ['id', 'name', 'aliases', 'coordinates', 'status', 'verificationNote', 'entrances', 'floors'], 'Building');
    identifier(building.id); text(building.name, 'Building name', 120); coords(building.coordinates);
    list(building.aliases, 12, 'Building aliases').forEach(alias => text(alias, 'Alias', 100));
    if (!['demo', 'unverified', 'mapped', 'verified'].includes(String(building.status))) throw new Error('Choose demo, unverified, mapped or verified for the building status.');
    text(building.verificationNote, 'Verification note', 1500);
    const entrances = new Map<string, boolean>(); const entranceIds = new Set<string>();
    for (const value of list(building.entrances, 12, 'Entrances')) {
      const entrance = object(value, ['id', 'name', 'coordinates', 'accessible', 'notes', 'steps'], 'Entrance');
      const id = identifier(entrance.id, entranceIds); text(entrance.name, 'Entrance name', 120); coords(entrance.coordinates); text(entrance.notes, 'Entrance notes', 1000); steps(entrance.steps);
      if (typeof entrance.accessible !== 'boolean') throw new Error('Entrance accessible must be true or false.');
      entrances.set(id, entrance.accessible);
    }
    function route(value: unknown, accessible = false) {
      const route = object(value, ['entranceId', 'steps'], 'Route');
      if (typeof route.entranceId !== 'string' || !entrances.has(route.entranceId) || (accessible && !entrances.get(route.entranceId))) throw new Error('Choose an existing entrance; a step-free route needs an accessible entrance.');
      steps(route.steps);
    }
    for (const value of list(building.floors, 20, 'Floors')) {
      const floor = object(value, ['id', 'name', 'image', 'rooms'], 'Floor');
      identifier(floor.id); text(floor.name, 'Floor name', 120);
      if (floor.image != null) {
        const image = object(floor.image, ['url', 'alt', 'caption', 'demonstration'], 'Floor image');
        text(image.url, 'Image URL', 1000); text(image.alt, 'Image alt text', 500); text(image.caption, 'Image caption', 500);
        if (!safeImageUrl(String(image.url))) throw new Error('Use a safe HTTPS, /media/ or /demo-maps/ image URL.');
        if (typeof image.demonstration !== 'boolean' || (String(image.url).startsWith('/demo-maps/') && !image.demonstration)) throw new Error('Demo floor plans must be marked demonstration.');
      }
      for (const value of list(floor.rooms, 100, 'Rooms')) {
        const room = object(value, ['id', 'code', 'name', 'route', 'accessibleRoute', 'hotspot'], 'Room');
        identifier(room.id); text(room.code, 'Room code', 40); text(room.name, 'Room name', 120); route(room.route);
        if (++roomCount > 1000) throw new Error('At most 1,000 rooms can be published.');
        if (room.accessibleRoute != null) route(room.accessibleRoute, true);
        if (room.hotspot != null) {
          const marker = object(room.hotspot, ['x', 'y'], 'Room marker');
          if (!floor.image || [marker.x, marker.y].some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100)) throw new Error('Room markers need an image and x/y percentages from 0 to 100.');
        }
      }
    }
  }
  if (content.graph != null) {
    const graph = object(content.graph, ['demonstration','maps','nodes','edges'], 'Route graph');
    if (typeof graph.demonstration !== 'boolean') throw new Error('Graph demonstration must be true or false.');
    const maps = new Set<string>(); const nodes = new Set<string>(); const edges = new Set<string>();
    for (const v of list(graph.maps, 40, 'Graph maps')) {
      const m = object(v, ['id','label','floorId','image'], 'Graph map'); identifier(m.id, maps); text(m.label,'Map label',120);
      if (m.floorId != null && (typeof m.floorId !== 'string' || !seen.has(m.floorId))) throw new Error('Map floor must reference a published floor.');
      if (m.image != null) {
        const i = object(m.image, ['url','alt','caption','demonstration'], 'Graph image'); text(i.url,'Image URL',1000); text(i.alt,'Alt text',500); text(i.caption,'Caption',500);
        if (!safeImageUrl(String(i.url)) || typeof i.demonstration !== 'boolean' || (String(i.url).startsWith('/demo-maps/') && !i.demonstration) || (i.demonstration && !graph.demonstration)) throw new Error('Use a safe image URL and retain demonstration labels.');
      }
    }
    for (const v of list(graph.nodes, 1500, 'Graph nodes')) {
      const n = object(v, ['id','label','mapId','roomId','x','y'], 'Graph node'); identifier(n.id,nodes); text(n.label,'Node label',120);
      if (!maps.has(String(n.mapId)) || (n.roomId != null && !seen.has(String(n.roomId))) || [n.x,n.y].some(x => typeof x !== 'number' || !Number.isFinite(x) || x<0 || x>100)) throw new Error('Nodes need known maps/rooms and x/y percentages from 0 to 100.');
    }
    for (const v of list(graph.edges, 5000, 'Graph edges')) {
      const e = object(v, ['id','from','to','kind','cost','stepFree','closed','status','verificationNote','instruction'], 'Graph edge'); identifier(e.id,edges); text(e.verificationNote,'Verification note',500); text(e.instruction,'Instruction',500);
      if (!nodes.has(String(e.from)) || !nodes.has(String(e.to)) || e.from===e.to || !['path','stairs','elevator','entrance'].includes(String(e.kind)) || typeof e.cost!=='number' || !Number.isInteger(e.cost) || e.cost<1 || e.cost>100000 || typeof e.closed!=='boolean' || typeof e.stepFree!=='boolean' || (e.stepFree && (e.kind==='stairs' || e.status==='mapped')) || !['demo','unverified','mapped','verified'].includes(String(e.status)) || (e.status==='demo' && !graph.demonstration)) throw new Error('Edges need distinct known nodes, positive bounded costs and honest verification/accessibility metadata.');
    }
  }
  return value as WayfindingContent;
}
