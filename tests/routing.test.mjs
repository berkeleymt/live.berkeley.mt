import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { routeBetween } from '../src/features/wayfinding/routing.ts';
import { rosterRequest } from '../src/features/wayfinding/rosterApi.ts';
const content = JSON.parse(await readFile(new URL('../content/wayfinding.json',import.meta.url),'utf8'));
test('directed routing respects closure, verification, stairs, missing data and floor transitions', () => {
  const g = structuredClone(content.graph);
  const route = routeBetween(g,'plaza','a101',true);
  assert.equal(route.status,'found'); assert.deepEqual(route.edges.map(e=>e.id),['arrival','enter','left']);
  assert.equal(routeBetween(g,'a101','plaza',false).status,'found');
  assert.deepEqual(routeBetween(g,'a101','a101',true),{status:'found',edges:[],nodes:['a101']});
  assert.equal(routeBetween(null,'a','b',true).status,'missing'); assert.equal(routeBetween(g,'missing','a101',true).status,'missing');
  g.edges.find(e=>e.id==='enter').closed=true; assert.equal(routeBetween(g,'plaza','a101',false).status,'no-route');
  g.edges.find(e=>e.id==='enter').closed=false; g.edges.find(e=>e.id==='enter').stepFree=false;
  assert.equal(routeBetween(g,'plaza','a101',true).status,'no-route'); assert.equal(routeBetween(g,'plaza','a101',false).status,'found');
  g.edges.find(e=>e.id==='enter').stepFree=true; g.edges.find(e=>e.id==='enter').kind='stairs'; assert.equal(routeBetween(g,'plaza','a101',true).status,'no-route');
  g.edges.find(e=>e.id==='enter').kind='elevator'; g.edges.find(e=>e.id==='enter').status='unverified'; assert.equal(routeBetween(g,'plaza','a101',false).status,'no-route');
  g.edges.forEach(e=>e.status='demo'); g.demonstration=false; assert.equal(routeBetween(g,'plaza','a101',false).status,'no-route');
  g.edges.forEach(e=>e.status='verified'); assert.equal(routeBetween(g,'plaza','a101',true).status,'found');
  g.edges.push({...g.edges[0],id:'long',from:'plaza',to:'a101',cost:1000}); assert.equal(routeBetween(g,'plaza','a101',false).edges.length,3);
});
test('ID-only transport never puts private input into URL, cache, referrer or automatic retry', async () => {
  let calls=0;
  await rosterRequest('/rooms/lookup',{method:'POST',body:JSON.stringify({studentId:'001-SYNTHETIC'})},async (url,init)=>{
    calls++; assert.equal(url,'/api/rooms/lookup'); assert.equal(init.cache,'no-store'); assert.equal(init.referrerPolicy,'no-referrer'); assert.equal(init.credentials,'same-origin'); assert.equal(init.method,'POST'); assert.ok(init.signal instanceof AbortSignal); assert.ok(init.body.includes('001-SYNTHETIC')); return Response.json({assignments:[]});
  }); assert.equal(calls,1);
  await assert.rejects(rosterRequest('/rooms/lookup',{},async()=>{calls++; return new Response('private upstream text',{status:502});}),e=>!e.message.includes('private upstream text')); assert.equal(calls,2);
});

test('map-derived routes are not claims of on-site or step-free verification', () => {
  const graph = structuredClone(content.graph);
  graph.edges.forEach(edge => { edge.status = 'mapped'; edge.stepFree = false; });
  graph.demonstration = false;
  assert.equal(routeBetween(graph, 'plaza', 'a101', false).status, 'found');
  assert.equal(routeBetween(graph, 'plaza', 'a101', true).status, 'no-route');
  graph.edges.forEach(edge => { edge.stepFree = true; });
  assert.equal(routeBetween(graph, 'plaza', 'a101', true).status, 'no-route');
  graph.edges[0].closed = true;
  assert.equal(routeBetween(graph, 'plaza', 'a101', false).status, 'no-route');
});

test('all supplied rooms have bounded markers, local source assets and bidirectional floor routes', async () => {
  const buildings = content.buildings.filter(building => building.status === 'mapped');
  assert.deepEqual(buildings.map(building => building.id).sort(), ['dwinelle', 'vlsb', 'wheeler']);
  assert.equal(buildings.flatMap(building => building.floors).length, 7);
  assert.equal(buildings.flatMap(building => building.floors.flatMap(floor => floor.rooms)).length, 60);
  const graph = content.graph;
  for (const building of buildings) for (const floor of building.floors) {
    assert.equal(floor.image.demonstration, false);
    assert.match(floor.image.caption, /Facilities Office/);
    const bytes = await readFile(new URL(`../content${floor.image.url}`, import.meta.url));
    assert.ok(floor.image.url.includes(createHash('sha256').update(bytes).digest('hex')));
    const start = graph.nodes.find(node => node.mapId === floor.id && !node.roomId);
    for (const room of floor.rooms) {
      assert.ok(room.hotspot && [room.hotspot.x, room.hotspot.y].every(value => value >= 0 && value <= 100));
      assert.equal(room.accessibleRoute, null);
      const target = graph.nodes.find(node => node.roomId === room.id);
      assert.equal(target.mapId, floor.id);
      for (const [a, b] of [[start.id, target.id], [target.id, start.id]]) {
        const route = routeBetween(graph, a, b, false);
        assert.equal(route.status, 'found', room.id);
        assert.ok(route.edges.every(edge => edge.status === 'mapped' && !edge.stepFree));
        assert.equal(routeBetween(graph, a, b, true).status, 'no-route', room.id);
      }
    }
  }
  assert.deepEqual(buildings.find(building => building.id === 'vlsb').floors[0].rooms.map(room => room.code), ['2030', '2032', '2038', '2050', '2060', '2062', '2066', '2070']);
  assert.equal(routeBetween(graph, 'wheeler-1-hall-0', 'wheeler-2-to-220', false).status, 'no-route', 'do not infer matching stair flights from montage alignment');
});
