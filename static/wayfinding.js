// Wayfinding map. Reads the Figma graph export (static/images/campus.svg): one group per floor
// named "Building (Floor X)" holding "Graph" circles (colour = type) and "Paths" hallway lines,
// plus "Outdoor Paths". Same-named stairs or elevators connect floors; exits join the outdoor paths.
// Routes with Dijkstra, draws on OpenFreeMap tiles via MapLibre, shows the visitor's location.
(function () {
  const root = document.querySelector("[data-wayfinding]");
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TYPE = { FFDD00: "stairs", D000FF: "exit", "00FF00": "elevator", "0000FF": "bath", FF0000: "door", "00EEFF": "info" };
  const COLOR = { door: "#ef4444", stairs: "#eab308", elevator: "#22c55e", exit: "#a21caf", bath: "#3b82f6", info: "#06b6d4", geo: "#94a3b8" };
  const WALK = 1.3, STAIRS = 25, ELEV = 40; // m/s, seconds per floor
  const MPP = +root.dataset.mpp, O_LON = +root.dataset.lon, O_LAT = +root.dataset.lat;
  const R = 6378137, OX = R * O_LON * Math.PI / 180, OY = R * Math.log(Math.tan(Math.PI / 4 + O_LAT * Math.PI / 360));
  const toLngLat = (x, y) => [((OX + MPP * x) / R) * 180 / Math.PI, (2 * Math.atan(Math.exp((OY - MPP * y) / R)) - Math.PI / 2) * 180 / Math.PI];
  const toSvg = (lng, lat) => [(R * lng * Math.PI / 180 - OX) / MPP, (OY - R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / MPP];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const norm = (s) => (s || "").replace(/_\d+$/, "");
  const nodoor = (s) => s.replace(/\s*\(Door(?: \d+)?\)$/, "");
  const disp = (n) => nodoor(norm(n)).replace(/\s*\[(\d+)\]/, " $1");
  const ordOf = (f) => (/^-?\d+$/.test(f) ? +f : f === "B" ? -1 : f.toUpperCase().charCodeAt(0) - 64);

  // ---- SVG -> layers ----
  function parseD(d) {
    const out = []; let cur = null, pos = null;
    (d.match(/[MLHVC][^MLHVC]*/g) || []).forEach((s) => {
      const c = s[0], v = (s.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
      if (c === "M") { pos = [v[0], v[1]]; cur = [pos]; out.push(cur); }
      else if (!cur) return;
      else if (c === "L") for (let i = 0; i + 1 < v.length; i += 2) { pos = [v[i], v[i + 1]]; cur.push(pos); }
      else if (c === "H") { pos = [v[0], pos[1]]; cur.push(pos); }
      else if (c === "V") { pos = [pos[0], v[0]]; cur.push(pos); }
      else for (let i = 0; i + 5 < v.length; i += 6) {
        const p0 = pos, p1 = [v[i], v[i + 1]], p2 = [v[i + 2], v[i + 3]], p3 = [v[i + 4], v[i + 5]];
        for (let k = 1; k <= 14; k++) { const t = k / 14, u = 1 - t; cur.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
        pos = p3;
      }
    });
    return out;
  }
  function parseSVG(txt) {
    const doc = new DOMParser().parseFromString(txt, "image/svg+xml");
    if (doc.getElementsByTagName("parsererror").length || doc.documentElement.nodeName !== "svg") throw new Error("not an SVG");
    const rootEl = doc.documentElement, L = { O: { key: "O", bld: "", fl: "", paths: [], links: [], pts: [] } }, warn = [];
    function ctx(el) {
      let f = null, place = "", g = el.parentNode;
      while (g && g !== rootEl && g.nodeType === 1) {
        if (g.nodeName === "g") {
          const id = norm(g.getAttribute("id")), m = id.match(/^(.*?)\s*\(Floor ([^)]+)\)$/);
          if (m && !f) f = { bld: m[1].trim(), fl: m[2].trim(), key: id };
          else if (!m && !place && id && !/^(Graph|Outdoors?|General)$/.test(id)) place = id;
        }
        g = g.parentNode;
      }
      return { f, place };
    }
    const lay = (f) => (f ? (L[f.key] = L[f.key] || { key: f.key, bld: f.bld, fl: f.fl, paths: [], links: [], pts: [] }) : L.O);
    doc.querySelectorAll("circle[id]").forEach((c) => {
      const x = ctx(c), fill = (c.getAttribute("fill") || "").replace("#", "").toUpperCase(), t = TYPE[fill] || "other";
      if (t === "other") warn.push(`Unknown colour #${fill} on "${c.getAttribute("id")}"`);
      lay(x.f).pts.push({ n: c.getAttribute("id"), x: +c.getAttribute("cx"), y: +c.getAttribute("cy"), t, place: x.place || (x.f ? x.f.bld : "") });
    });
    doc.querySelectorAll("path[id]").forEach((p) => {
      const x = ctx(p), id = norm(p.getAttribute("id")), pl = parseD(p.getAttribute("d") || "");
      if (/^Outdoor Paths/.test(id)) L.O.paths.push(...pl);
      else if (/^Paths/.test(id)) { if (x.f) lay(x.f).paths.push(...pl); else warn.push("A Paths layer outside a floor group was ignored"); }
      else if (/^Links/.test(id)) { if (x.f) lay(x.f).links.push(...pl); }
    });
    Object.values(L).forEach((l) => { if (l.key !== "O" && !l.paths.length) { l.pts.forEach((p) => L.O.pts.push({ ...p, place: l.bld })); delete L[l.key]; } });
    if (!L.O.paths.length) warn.push("No Outdoor Paths found, so buildings can't be linked");
    return { L, warn };
  }

  // ---- layers -> graph ----
  function makeModel(L) {
    const G = { n: {}, a: {} }, W = [], layers = Object.values(L), LO = L.O;
    const addN = (id, o) => { if (!G.n[id]) { G.n[id] = o; G.a[id] = []; } };
    function addE(a, b, t, m, one, w) {
      if (a === b) return;
      const A = G.n[a], B = G.n[b];
      if (m === undefined) m = dist([A.x, A.y], [B.x, B.y]) * MPP;
      if (w === undefined) w = t === "stairs" ? STAIRS : t === "elev" ? ELEV : m / WALK;
      G.a[a].push({ to: b, t, m, w }); if (!one) G.a[b].push({ to: a, t, m, w });
    }
    const proj = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], q = dx * dx + dy * dy, t = q ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / q)) : 0; return [a[0] + t * dx, a[1] + t * dy]; };
    function nearest(d, p, ex) {
      let b = { d: 1e9 };
      d.paths.forEach((pl, pi) => { if (pi === ex) return; pl.slice(1).forEach((c, si) => { const q = proj(p, pl[si], c), dd = dist(p, q); if (dd < b.d) b = { d: dd, q, pi, si }; }); });
      return b;
    }
    function build(d, extra) {
      const f = d.key, K = (p) => f + ":" + p[0].toFixed(1) + "," + p[1].toFixed(1);
      const circAt = (p) => { let h = null, hd = 14; d.pts.forEach((c) => { const x = dist(p, [c.x, c.y]); if (x < hd) { hd = x; h = c; } }); return h; };
      const touched = new Set(), spl = {}, snap = {}, weld = [];
      d.links.forEach((pl) => pl.forEach((p) => { const c = circAt(p); if (c) touched.add(c.n); }));
      const addSplit = (r) => { const k = r.pi + "_" + r.si; (spl[k] = spl[k] || []).push(r.q); };
      d.pts.forEach((c) => { if (touched.has(c.n)) return; const r = nearest(d, [c.x, c.y]); if (r.q) { snap[c.n] = r; addSplit(r); } });
      d.links.forEach((pl) => [pl[0], pl[pl.length - 1]].forEach((p) => { if (!circAt(p)) { const r = nearest(d, p); if (r.q && r.d < 12) addSplit(r); } }));
      (extra || []).forEach((p) => { const r = nearest(d, p); if (r.q && r.d < 40) addSplit(r); });
      d.paths.forEach((pl, pi) => [pl[0], pl[pl.length - 1]].forEach((p) => { const r = nearest(d, p, pi); if (r.q && r.d < 8 && r.d > 0.05) { addSplit(r); weld.push([p, r.q]); } }));
      const node = (p) => { const id = K(p); addN(id, { f, x: p[0], y: p[1], k: "geo", names: [] }); return id; };
      d.paths.forEach((pl, pi) => pl.slice(1).forEach((c, si) => {
        const a = pl[si], qs = (spl[pi + "_" + si] || []).slice().sort((u, v) => dist(a, u) - dist(a, v)), seq = [a, ...qs, c];
        seq.forEach(node); for (let i = 0; i < seq.length - 1; i++) addE(K(seq[i]), K(seq[i + 1]), "walk");
      }));
      weld.forEach((w) => { node(w[0]); node(w[1]); addE(K(w[0]), K(w[1]), "walk"); });
      d.pts.forEach((c) => { const id = f + "|" + c.n; addN(id, { f, x: c.x, y: c.y, k: c.t, name: c.n, names: [] }); if (snap[c.n]) { const s = K(snap[c.n].q); addE(id, s, "walk"); G.n[s].names.push(c); } });
      d.links.forEach((pl) => {
        const ch = pl.map((p, i) => { const c = circAt(p); if (c) return f + "|" + c.n; if (i === 0 || i === pl.length - 1) { const r = nearest(d, p); if (r.q && r.d < 12) return K(r.q); } return node(p); });
        for (let i = 0; i < ch.length - 1; i++) addE(ch[i], ch[i + 1], "walk");
      });
      return K;
    }
    const floors = layers.filter((l) => l.key !== "O"), exitPts = [];
    floors.forEach((l) => l.pts.forEach((c) => { if (c.t === "exit") exitPts.push([c.x, c.y]); }));
    floors.forEach((l) => {
      build(l); const seen = {};
      l.pts.forEach((c) => { const k = norm(c.n); if (seen[k]) W.push(`Duplicate name "${k}" on ${l.bld} Floor ${l.fl}`); seen[k] = 1; });
    });
    const KO = build(LO, exitPts);
    floors.forEach((l) => l.pts.forEach((c) => {
      if (c.t !== "exit") return;
      const r = nearest(LO, [c.x, c.y]);
      if (r.q && r.d < 40) addE(l.key + "|" + c.n, KO(r.q), "walk", r.d * MPP, !/Entrance/i.test(c.n)); else W.push(`"${norm(c.n)}" is not near an outdoor path`);
    }));
    const ORD = {}, byB = {};
    floors.forEach((l) => (byB[l.bld] = byB[l.bld] || []).push(l));
    Object.values(byB).forEach((ls) => {
      ls.sort((a, b) => ordOf(a.fl) - ordOf(b.fl));
      const idx = {}, nm = {};
      ls.forEach((l, i) => { idx[l.key] = i; ORD[l.key] = ordOf(l.fl); l.pts.forEach((c) => { if (c.t === "stairs" || c.t === "elevator") (nm[norm(c.n)] = nm[norm(c.n)] || []).push({ l, c }); }); });
      Object.values(nm).forEach((a) => { for (let i = 0; i < a.length - 1; i++) { const dd = idx[a[i + 1].l.key] - idx[a[i].l.key], st = a[i].c.t === "stairs"; addE(a[i].l.key + "|" + a[i].c.n, a[i + 1].l.key + "|" + a[i + 1].c.n, st ? "stairs" : "elev", 0, false, (st ? STAIRS : ELEV) * dd); } });
    });
    const DEST = {};
    layers.forEach((l) => l.pts.forEach((c) => {
      const nm = nodoor(norm(c.n)), key = (l.bld || c.place || "") + "|" + nm, id = l.key + "|" + c.n;
      const d = (DEST[key] = DEST[key] || { key, nm, bld: l.bld, fls: new Set(), cat: c.t === "door" ? "Rooms" : c.t === "bath" ? "Bathrooms" : "Other places", ids: [] });
      d.ids.push(id); d.fls.add(l.fl);
    }));
    Object.values(DEST).forEach((d) => { const fl = [...d.fls].filter(Boolean); d.label = disp(d.nm); d.sub = d.bld ? d.bld + (fl.length === 1 ? ", Floor " + fl[0] : "") : "Outdoors"; });
    const places = {};
    LO.pts.forEach((c) => { if (c.place) (places[c.place] = places[c.place] || []).push(c); });
    Object.keys(places).forEach((p) => { const cs = places[p], en = cs.filter((c) => c.t === "exit"); DEST["B|" + p] = { key: "B|" + p, label: p, sub: "", cat: "Buildings", ids: (en.length ? en : cs).map((c) => "O|" + c.n) }; });
    Object.keys(byB).forEach((b) => { const ids = []; byB[b].forEach((l) => l.pts.forEach((c) => { if (/Entrance/i.test(c.n)) ids.push(l.key + "|" + c.n); })); if (ids.length) DEST["B|" + b] = { key: "B|" + b, label: b, sub: "", cat: "Buildings", ids }; });
    const U = {};
    Object.keys(G.a).forEach((a) => G.a[a].forEach((e) => { (U[a] = U[a] || []).push(e.to); (U[e.to] = U[e.to] || []).push(a); }));
    const sn = new Set(), cc = [];
    Object.keys(G.n).forEach((k) => { if (sn.has(k)) return; const c = [], st = [k]; while (st.length) { const u = st.pop(); if (sn.has(u)) continue; sn.add(u); c.push(u); (U[u] || []).forEach((v) => st.push(v)); } cc.push(c); });
    cc.sort((a, b) => b.length - a.length).slice(1).forEach((c) => { const nm = c.filter((k) => k.includes("|")).map((k) => disp(G.n[k].name)); if (nm.length) W.push("Not connected to the main network: " + nm.slice(0, 6).join(", ")); });
    return { L, G, W, DEST, ORD, byB };
  }
  function route(M, src, dst, stepFree) {
    const G = M.G, dd = {}, pr = {}, done = {}, q = [], T = new Set(dst);
    src.forEach((s) => { dd[s] = 0; q.push([0, s]); });
    while (q.length) {
      q.sort((a, b) => a[0] - b[0]);
      const [d, u] = q.shift();
      if (done[u]) continue; done[u] = 1;
      if (T.has(u)) { const p = [u]; while (pr[p[0]]) p.unshift(pr[p[0]]); return { p, s: d }; }
      for (const e of G.a[u]) { if (stepFree && e.t === "stairs") continue; const nd = d + e.w; if (nd < (dd[e.to] === undefined ? 1e18 : dd[e.to])) { dd[e.to] = nd; pr[e.to] = u; q.push([nd, e.to]); } }
    }
    return null;
  }
  const best = (M, u, v) => M.G.a[u].filter((x) => x.to === v).sort((a, b) => a.w - b.w)[0];
  function steps(M, p, fromLabel, toLabel) {
    const G = M.G, S = [], N = (i) => G.n[p[i]];
    let acc = 0, hd = null, ps = [], f = N(0).f;
    const r = (m) => (m > 100 ? Math.round(m / 10) * 10 : Math.max(5, Math.round(m / 5) * 5));
    const walk = () => { const w = acc >= 3 || ps.length ? "Walk about " + r(acc) + " m" + (ps.length ? ", passing " + [...new Set(ps)].join(" and ") : "") : ""; acc = 0; ps = []; return w; };
    const pos = (i) => [N(i).x, N(i).y];
    S.push({ f, t: "Start at " + fromLabel, at: pos(0) });
    for (let i = 0; i < p.length - 1; i++) {
      const a = N(i), b = N(i + 1), ed = best(M, p[i], p[i + 1]);
      if (ed.t === "stairs" || ed.t === "elev") {
        const w = walk(), k = ed.t === "elev" ? "the elevator" : "the stairs", up = M.ORD[b.f] > M.ORD[a.f];
        if (w) S.push({ f: a.f, t: w + " to " + k, at: pos(i) });
        S.push({ f: a.f, to: b.f, t: "Take " + k + " " + (up ? "up" : "down") + " to Floor " + M.L[b.f].fl, at: pos(i) });
        f = b.f; hd = null; continue;
      }
      if ((a.f === "O") !== (b.f === "O")) {
        const w = walk(), inn = b.f !== "O", nm = disp(inn ? b.name : a.name);
        if (w) S.push({ f: a.f, t: w, at: pos(i) });
        S.push({ f: a.f, to: b.f, t: (inn ? "Go in through " : "Leave through ") + nm, at: pos(i) });
        f = b.f; hd = null; acc += ed.m; continue;
      }
      const v = [b.x - a.x, b.y - a.y];
      if (Math.hypot(v[0], v[1]) > 4) {
        if (hd) { const ang = Math.atan2(hd[0] * v[1] - hd[1] * v[0], hd[0] * v[0] + hd[1] * v[1]) * 180 / Math.PI; if (Math.abs(ang) >= 35) { const w = walk(), d = ang > 0 ? "right" : "left"; S.push({ f, t: w ? w + ", then turn " + d : "Turn " + d, at: pos(i) }); } }
        hd = v;
      }
      acc += ed.m;
      if (i + 1 < p.length - 1) (b.names || []).forEach((c) => { const n = disp(c.n); if (c.t === "info" && n !== fromLabel && n !== toLabel) ps.push(n); });
    }
    const w = walk(), Lp = p.length - 1;
    if (w) S.push({ f: N(Lp).f, t: w + " to " + toLabel, at: pos(Lp) });
    S.push({ f: N(Lp).f, t: "You're there: " + toLabel, at: pos(Lp) });
    return S;
  }

  // ---- UI ----
  const fromSel = $("[data-from]"), toSel = $("[data-to]"), floorsEl = $("[data-floors]"), stepsEl = $("[data-steps]"), summary = $("[data-summary]"), status = $("[data-status]"), stepFree = $("[data-stepfree]");
  let M, map, ST = { from: "", to: "", sel: {}, r: null, me: null };
  const MY = "me";
  const show = (msg) => { status.classList.toggle("hidden", !msg); status.textContent = msg || ""; };
  const findDest = (q) => {
    if (!q) return "";
    if (M.DEST[q]) return q;
    const n = q.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
    const d = Object.values(M.DEST).find((d) => (d.nm || d.label).toLowerCase() === n || d.label.toLowerCase() === n) || Object.values(M.DEST).find((d) => d.cat === "Buildings" && (d.label.toLowerCase().startsWith(n) || n.startsWith(d.label.toLowerCase().split(" ")[0])));
    return d ? d.key : "";
  };
  function fill() {
    const cats = ["Rooms", "Bathrooms", "Other places", "Buildings"];
    const opts = '<option value="">Choose a place</option>' + cats.map((c) => { const ds = Object.values(M.DEST).filter((x) => x.cat === c).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })); return ds.length ? `<optgroup label="${c}">` + ds.map((x) => `<option value="${esc(x.key)}">${esc(x.label)}${x.sub && x.cat !== "Rooms" ? " (" + esc(x.sub) + ")" : ""}</option>`).join("") + "</optgroup>" : ""; }).join("");
    fromSel.innerHTML = `<option value="${MY}">My location</option>` + opts; toSel.innerHTML = opts;
    Object.keys(M.byB).forEach((b) => { const ls = M.byB[b]; ST.sel[b] = (ls.find((l) => l.pts.some((c) => /Main Entrance/.test(c.n))) || ls[0]).key; });
    floorsEl.innerHTML = Object.keys(M.byB).map((b) => `<span class="flex items-center gap-1.5"><span class="text-gray-500">${esc(b.replace(" Hall", ""))}</span><span class="inline-flex rounded-lg border border-gray-200 overflow-hidden">` + M.byB[b].map((l) => `<button type="button" data-floor="${esc(l.key)}" data-b="${esc(b)}" class="px-2.5 py-1 hover:bg-gray-50">${esc(l.fl)}</button>`).join("") + "</span></span>").join("");
  }
  const visible = (f) => f === "O" || Object.values(ST.sel).includes(f);
  function nodeFeature(id, n) { return { type: "Feature", id, properties: { k: id, t: n.k, name: n.name ? disp(n.name) : "", vis: visible(n.f) ? 1 : 0 }, geometry: { type: "Point", coordinates: toLngLat(n.x, n.y) } }; }
  function draw() {
    if (!map || !map.getSource("paths")) return;
    const paths = [], nodes = [];
    Object.values(M.L).forEach((l) => { if (!visible(l.key)) return; l.paths.forEach((pl) => paths.push({ type: "Feature", properties: { o: l.key === "O" ? 1 : 0 }, geometry: { type: "LineString", coordinates: pl.map((p) => toLngLat(p[0], p[1])) } })); });
    Object.entries(M.G.n).forEach(([id, n]) => { if (n.k !== "geo" && visible(n.f)) nodes.push(nodeFeature(id, n)); });
    map.getSource("paths").setData({ type: "FeatureCollection", features: paths });
    map.getSource("nodes").setData({ type: "FeatureCollection", features: nodes });
    const segs = [], ends = [];
    if (ST.r) {
      const p = ST.r.p;
      for (let i = 0; i < p.length - 1; i++) { const a = M.G.n[p[i]], b = M.G.n[p[i + 1]]; if (a.f !== b.f && a.f !== "O" && b.f !== "O") continue; segs.push({ type: "Feature", properties: { vis: visible(a.f) && visible(b.f) ? 1 : 0 }, geometry: { type: "LineString", coordinates: [toLngLat(a.x, a.y), toLngLat(b.x, b.y)] } }); }
      const a = M.G.n[p[0]], b = M.G.n[p[p.length - 1]];
      if (ST.from === MY && ST.me) segs.push({ type: "Feature", properties: { vis: 0 }, geometry: { type: "LineString", coordinates: [ST.me, toLngLat(a.x, a.y)] } });
      ends.push({ type: "Feature", properties: { end: "from" }, geometry: { type: "Point", coordinates: toLngLat(a.x, a.y) } }, { type: "Feature", properties: { end: "to" }, geometry: { type: "Point", coordinates: toLngLat(b.x, b.y) } });
    }
    map.getSource("route").setData({ type: "FeatureCollection", features: segs });
    map.getSource("ends").setData({ type: "FeatureCollection", features: ends });
    floorsEl.querySelectorAll("[data-floor]").forEach((b) => { const on = ST.sel[b.dataset.b] === b.dataset.floor; b.classList.toggle("bg-teal-500", on); b.classList.toggle("text-white", on); b.classList.toggle("hover:bg-gray-50", !on); });
  }
  function fitTo(ids, pad) {
    const pts = ids.map((i) => M.G.n[i]).filter(Boolean).map((n) => toLngLat(n.x, n.y));
    if (!pts.length) return;
    const b = pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [180, 90, -180, -90]);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad || 60, maxZoom: 19, duration: 600 });
  }
  function fromIds() {
    if (ST.from !== MY) return M.DEST[ST.from] ? M.DEST[ST.from].ids : null;
    if (!ST.me) return null;
    const p = toSvg(ST.me[0], ST.me[1]); let bi = null, bd = 1e9;
    Object.entries(M.G.n).forEach(([id, n]) => { if (n.f !== "O") return; const d = dist(p, [n.x, n.y]); if (d < bd) { bd = d; bi = id; } });
    return bd * MPP < 250 ? [bi] : null;
  }
  function compute(fit) {
    ST.r = null; stepsEl.classList.add("hidden"); summary.textContent = "";
    const src = fromIds(), to = M.DEST[ST.to];
    if (ST.from === MY && !ST.me) show(navigator.geolocation ? "Tap the location button on the map, or pick where you are" : "Pick where you are");
    else if (ST.from === MY && !src) show("You're not near the tournament buildings, pick a start instead");
    else show("");
    if (src && to) {
      const r = route(M, src, to.ids, stepFree.checked);
      if (!r) { summary.textContent = stepFree.checked ? "No step-free route found" : "No route found"; }
      else {
        let m = 0; for (let i = 0; i < r.p.length - 1; i++) m += best(M, r.p[i], r.p[i + 1]).m;
        const fromLabel = ST.from === MY ? "your location" : M.DEST[ST.from].label;
        r.st = steps(M, r.p, fromLabel, to.label); ST.r = r;
        r.p.forEach((id) => { const n = M.G.n[id]; if (n.f !== "O") ST.sel[M.L[n.f].bld] = n.f; });
        summary.textContent = `About ${Math.max(1, Math.round(r.s / 60))} min, ${m > 100 ? Math.round(m / 10) * 10 : Math.round(m)} m`;
        stepsEl.classList.remove("hidden");
        stepsEl.innerHTML = r.st.map((s, i) => `<li><button type="button" data-step="${i}" class="w-full text-left px-4 py-2.5 flex gap-3 hover:bg-gray-50"><span class="text-gray-400 w-5 shrink-0">${i + 1}</span><span>${esc(s.t)}</span></button></li>`).join("");
        if (fit) fitTo(r.p);
      }
    }
    draw();
    const h = [ST.from && ST.from !== MY ? "from=" + encodeURIComponent(M.DEST[ST.from].label) : "", ST.to ? "to=" + encodeURIComponent(to.label) : ""].filter(Boolean).join("&");
    history.replaceState(null, "", location.pathname + location.search + (h ? "#" + h : ""));
  }
  function render(fit) { fromSel.value = ST.from; toSel.value = ST.to; compute(fit); }

  function initMap() {
    map = new maplibregl.Map({ container: $("[data-map]"), style: "https://tiles.openfreemap.org/styles/positron", center: toLngLat(7400, 4200), zoom: 16, minZoom: 14, maxZoom: 20, attributionControl: { compact: true }, pitchWithRotate: false, dragRotate: false });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true, fitBoundsOptions: { maxZoom: 18 } });
    map.addControl(geo, "top-right");
    geo.on("geolocate", (e) => { ST.me = [e.coords.longitude, e.coords.latitude]; if (ST.from === MY) compute(false); });
    geo.on("error", () => { if (ST.from === MY) show("Location unavailable, pick where you are"); });
    map.on("load", () => {
      ["paths", "nodes", "route", "ends"].forEach((s) => map.addSource(s, { type: "geojson", data: { type: "FeatureCollection", features: [] } }));
      map.addLayer({ id: "paths", type: "line", source: "paths", paint: { "line-color": ["case", ["==", ["get", "o"], 1], "#9ca3af", "#cbd5e1"], "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1, 19, 4], "line-opacity": 0.8 } });
      map.addLayer({ id: "route-hidden", type: "line", source: "route", filter: ["==", ["get", "vis"], 0], paint: { "line-color": "#0d9488", "line-width": 3, "line-dasharray": [1, 2], "line-opacity": 0.5 } });
      map.addLayer({ id: "route", type: "line", source: "route", filter: ["==", ["get", "vis"], 1], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0d9488", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 3, 19, 7] } });
      map.addLayer({ id: "nodes", type: "circle", source: "nodes", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 2, 19, ["case", ["==", ["get", "t"], "door"], 4, 6]], "circle-color": ["match", ["get", "t"], "door", COLOR.door, "stairs", COLOR.stairs, "elevator", COLOR.elevator, "exit", COLOR.exit, "bath", COLOR.bath, "info", COLOR.info, COLOR.geo], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
      map.addLayer({ id: "labels", type: "symbol", source: "nodes", minzoom: 17.5, filter: ["match", ["get", "t"], ["door", "exit", "info"], true, false], layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#374151", "text-halo-color": "#fff", "text-halo-width": 1 } });
      map.addLayer({ id: "ends", type: "circle", source: "ends", paint: { "circle-radius": 8, "circle-color": ["case", ["==", ["get", "end"], "to"], "#0d9488", "#fff"], "circle-stroke-color": "#0d9488", "circle-stroke-width": 3 } });
      map.on("click", "nodes", (e) => { const id = e.features[0].properties.k, n = M.G.n[id]; if (!n || !n.name) return; const key = Object.keys(M.DEST).find((k) => M.DEST[k].ids.includes(id)); if (!key) return; if (!ST.to || ST.to === key) { ST.to = key; } else if (ST.from === MY && !ST.me) { ST.from = key; } else { ST.to = key; } render(false); });
      map.on("mouseenter", "nodes", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "nodes", () => (map.getCanvas().style.cursor = ""));
      draw();
      if (ST.r) fitTo(ST.r.p); else fitTo(Object.keys(M.G.n).filter((k) => M.G.n[k].f === "O"), 20);
    });
  }

  fromSel.addEventListener("change", () => { ST.from = fromSel.value; compute(true); });
  toSel.addEventListener("change", () => { ST.to = toSel.value; compute(true); });
  stepFree.addEventListener("change", () => compute(true));
  $("[data-swap]").addEventListener("click", () => { if (ST.from === MY) return; [ST.from, ST.to] = [ST.to, ST.from]; render(true); });
  floorsEl.addEventListener("click", (e) => { const b = e.target.closest("[data-floor]"); if (!b) return; ST.sel[b.dataset.b] = b.dataset.floor; draw(); });
  stepsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]"); if (!b || !ST.r) return;
    const s = ST.r.st[+b.dataset.step], f = s.to || s.f;
    if (f !== "O") ST.sel[M.L[f].bld] = f;
    draw(); map.flyTo({ center: toLngLat(s.at[0], s.at[1]), zoom: 18.5, duration: 700 });
    stepsEl.querySelectorAll("[data-step]").forEach((x) => x.classList.toggle("bg-teal-50", x === b));
  });

  async function start() {
    try {
      const txt = await (await fetch(root.dataset.svg, { cache: "no-cache" })).text();
      const { L, warn } = parseSVG(txt); M = makeModel(L); M.W.push(...warn);
      if (M.W.length && /debug/.test(location.search)) console.warn("campus.svg checks:\n" + M.W.join("\n"));
    } catch (e) { show("The map isn't available right now"); return; }
    fill();
    const h = new URLSearchParams(location.hash.slice(1));
    ST.to = findDest(h.get("to") || "");
    ST.from = h.get("from") ? findDest(h.get("from")) || MY : MY;
    if (!ST.to) { const saved = localStorage.getItem("rooms-id"); if (saved) fetch(`/api/rooms?id=${encodeURIComponent(saved)}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.rooms && !ST.to) { const k = d.rooms.map(findDest).find(Boolean); if (k) { ST.to = k; render(true); } } }).catch(() => {}); }
    render(false);
    const go = () => (window.maplibregl ? initMap() : setTimeout(go, 50));
    go();
  }
  start();
})();
