import type { GraphEdge, RouteGraph } from './types';
export type RouteResult = { status: 'found'; edges: GraphEdge[]; nodes: string[] } | { status: 'missing' | 'no-route' };
/** Directed Dijkstra; mapped routes never imply on-site or step-free verification. */
export function routeBetween(graph: RouteGraph | null | undefined, from: string, to: string, stepFree: boolean): RouteResult {
  if (!graph || graph.nodes.length > 1500 || graph.edges.length > 5000 || !graph.nodes.some(n => n.id === from) || !graph.nodes.some(n => n.id === to)) return { status: 'missing' };
  const pending = new Set(graph.nodes.map(n => n.id));
  const dist = new Map([[from, 0]]); const previous = new Map<string, GraphEdge>();
  const adjacency = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (e.closed || !Number.isFinite(e.cost) || e.cost <= 0 || (stepFree && (!e.stepFree || e.kind === 'stairs' || e.status === 'mapped')) || !(e.status === 'verified' || e.status === 'mapped' || (graph.demonstration && e.status === 'demo'))) continue;
    adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e]);
  }
  while (pending.size) {
    let node = ''; let best = Infinity;
    for (const id of pending) { const distance = dist.get(id) ?? Infinity; if (distance < best) { best = distance; node = id; } }
    if (!node) break;
    if (node === to) {
      const edges: GraphEdge[] = []; let cursor = to;
      while (cursor !== from) { const e = previous.get(cursor); if (!e || edges.length >= graph.nodes.length) return { status: 'no-route' }; edges.unshift(e); cursor = e.from; }
      return { status: 'found', edges, nodes: [from, ...edges.map(e => e.to)] };
    }
    pending.delete(node);
    for (const e of adjacency.get(node) ?? []) { if (pending.has(e.to) && best + e.cost < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, best + e.cost); previous.set(e.to, e); } }
  }
  return { status: 'no-route' };
}
