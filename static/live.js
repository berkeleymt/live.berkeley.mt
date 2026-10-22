// Marks what's happening now / up next from the schedule embedded in the page,
// and reloads the page content every minute so new updates show without a refresh.
// Append ?at=2026-04-12T10:00 to preview the page as of a Pacific date-time.
(function () {
  const TZ = "America/Los_Angeles";
  const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const t12 = (t) => { const [h, m] = t.split(":").map(Number); return `${(h + 11) % 12 + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  function pacificNow(tz) {
    const at = new URLSearchParams(location.search).get("at");
    if (at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at)) return { date: at.slice(0, 10), now: mins(at.slice(11, 16)) };
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return { date: `${get("year")}-${get("month")}-${get("day")}`, now: Number(get("hour")) * 60 + Number(get("minute")) };
  }

  function render() {
    const raw = document.getElementById("schedule-data");
    if (!raw) return;
    const data = JSON.parse(raw.textContent);
    const events = data.events.map((e, i) => ({ ...e, i })).sort((a, b) => mins(a.start) - mins(b.start));
    const { date, now } = pacificNow(data.timezone || TZ);
    const phase = date < data.date ? "before" : date > data.date ? "after" : "today";
    const current = phase === "today" ? events.find((e) => mins(e.start) <= now && mins(e.end) > now) : null;
    const next = phase === "after" ? null : events.find((e) => mins(e.start) > now || phase === "before");
    const meta = (e) => `${t12(e.start)} to ${t12(e.end)}${e.location ? ", " + e.location : ""}`;

    if (phase === "today") {
      if (current) {
        setText("now-label", "Happening now"); setText("now-title", current.title); setText("now-meta", meta(current));
      } else {
        setText("now-label", next ? "Between events" : "That's a wrap"); setText("now-title", data.title);
        setText("now-meta", next ? "Nothing scheduled right now." : "Thanks for coming! Scores and photos follow on berkeley.mt.");
      }
    } else if (phase === "after") {
      setText("now-label", "Event complete"); setText("now-meta", "Thanks for being part of " + data.title + ". The schedule and updates stay available.");
    }
    setText("next-label", phase === "before" ? "First on the schedule" : next ? "Up next" : "Later today");
    setText("next-title", next ? next.title : "No more scheduled events");
    setText("next-meta", next ? meta(next) : "Keep an eye on live updates.");

    document.querySelectorAll("[data-event]").forEach((row) => {
      const e = data.events[Number(row.dataset.event)];
      const isNow = !!current && Number(row.dataset.event) === current.i;
      const isNext = !!next && Number(row.dataset.event) === next.i && phase === "today";
      const isPast = phase === "after" || (phase === "today" && mins(e.end) <= now);
      row.classList.toggle("is-now", isNow);
      row.classList.toggle("is-past", isPast);
      row.querySelector(".now-badge")?.classList.toggle("hidden", !isNow);
      row.querySelector(".next-badge")?.classList.toggle("hidden", !isNext);
    });
    markNow(current, next, now, phase);
  }

  // Compare server HTML with the last server HTML (never with the live DOM, which
  // the user has interacted with), so unchanged content never gets swapped in.
  let lastHtml = null;
  async function refresh() {
    try {
      const res = await fetch(location.pathname, { cache: "no-store" });
      if (!res.ok) return;
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const fresh = doc.getElementById("content-wrapper");
      const mine = document.getElementById("content-wrapper");
      if (!fresh || !mine) return;
      const html = fresh.innerHTML;
      if (lastHtml === null || html === lastHtml) { lastHtml = html; return; }
      lastHtml = html;
      const open = [...mine.querySelectorAll("details")].map((d) => d.open);
      const y = window.scrollY;
      mine.innerHTML = html;
      mine.querySelectorAll("details").forEach((d, i) => { if (open[i]) d.open = true; });
      window.scrollTo(0, y);
      initPlans();
      initPoi();
      mine.querySelectorAll(".sched, article .prose").forEach(linkRooms);
      openHash();
      showMine();
      render();
    } catch (_) { /* offline; try again next minute */ }
  }

  // /map/#wheeler opens that building's card; /map/#dwinelle-155 also switches to the floor
  // with room 155, highlights it and zooms in. Floor plans are inline SVGs (building shortcode)
  // whose room shapes are named by room number (Figma layer names become ids).
  const ROOM_ID = /^(\d+[A-Z]*)(?:[\s_(\u2028].*)?$/;
  const roomOf = (el, root) => { for (; el && el !== root; el = el.parentNode) { const m = el.id && ROOM_ID.exec(el.id); if (m) return m[1]; } return null; };
  const findRoom = (svg, room) => svg.querySelector(`[id="${room}"]`) || [...svg.querySelectorAll("[id]")].find((e) => roomOf(e, svg) === room);
  const plans = () => [...document.querySelectorAll(".floorplan")].filter((fp) => fp.querySelector("svg"));
  const captionOf = (fp) => (fp.closest(".building") || fp).querySelector(".floorplan-room");

  function showFloor(fp) {
    const b = fp.closest(".building");
    if (!b) return;
    b.querySelectorAll(".floorplan").forEach((p) => p.classList.toggle("hidden", p !== fp));
    b.querySelectorAll(".floor-tabs [data-floor]").forEach((t) => t.setAttribute("aria-selected", t.dataset.floor === fp.dataset.floor));
    fp.view && fp.view.apply();
  }

  // Zoom and pan: CSS transform on the SVG inside its clipping viewport.
  function viewer(fp, onPick) {
    const vp = fp.querySelector(".floorplan-viewport"), svg = vp.querySelector("svg");
    const st = { s: 1, x: 0, y: 0 };
    const clamp = () => {
      const W = vp.clientWidth, H = vp.clientHeight;
      st.s = Math.min(6, Math.max(1, st.s));
      st.x = Math.min(0, Math.max(W - W * st.s, st.x));
      st.y = Math.min(0, Math.max(H - H * st.s, st.y));
    };
    const apply = () => { clamp(); svg.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.s})`; };
    const zoomAt = (f, px, py) => { const s0 = st.s; st.s = Math.min(6, Math.max(1, s0 * f)); const k = st.s / s0; st.x = px - (px - st.x) * k; st.y = py - (py - st.y) * k; apply(); };
    const reset = () => { st.s = 1; st.x = 0; st.y = 0; apply(); };
    // Center on an element's bounding box (SVG user units), zooming so it is comfortably big.
    const center = (el) => {
      const vb = svg.viewBox.baseVal, W = vp.clientWidth, H = vp.clientHeight;
      if (!vb || !vb.width || !W) return;
      const b = el.getBBox(), k = W / vb.width;
      const cx = (b.x - vb.x + b.width / 2) * k, cy = (b.y - vb.y + b.height / 2) * k;
      st.s = Math.min(3, Math.max(1.75, (0.3 * W) / Math.max(1, b.width * k)));
      st.x = W / 2 - cx * st.s; st.y = H / 2 - cy * st.s;
      svg.style.transition = "transform 0.35s ease"; apply();
      setTimeout(() => (svg.style.transition = ""), 400);
    };
    fp.querySelector('[data-zoom="in"]').onclick = () => zoomAt(1.5, vp.clientWidth / 2, vp.clientHeight / 2);
    fp.querySelector('[data-zoom="out"]').onclick = () => zoomAt(1 / 1.5, vp.clientWidth / 2, vp.clientHeight / 2);
    fp.querySelector('[data-zoom="reset"]').onclick = reset;
    vp.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const r = vp.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY / 200), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    vp.addEventListener("dblclick", (e) => { const r = vp.getBoundingClientRect(); if (st.s > 1.01) reset(); else zoomAt(2.5, e.clientX - r.left, e.clientY - r.top); });
    // Pointer capture retargets the click to the viewport, so taps are detected on pointerup.
    const ptrs = new Map(); let moved = false, start = null, downTarget = null;
    const mid = () => { const p = [...ptrs.values()]; return p.length < 2 ? null : { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) }; };
    vp.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; vp.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); start = mid(); if (ptrs.size === 1) { moved = false; downTarget = e.target; } vp.classList.add("panning"); });
    vp.addEventListener("pointermove", (e) => {
      const prev = ptrs.get(e.pointerId); if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY }; ptrs.set(e.pointerId, cur);
      if (ptrs.size === 1) { if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 2) moved = true; st.x += cur.x - prev.x; st.y += cur.y - prev.y; apply(); }
      else { const m = mid(); if (start && m) { const r = vp.getBoundingClientRect(); zoomAt(m.d / start.d, m.x - r.left, m.y - r.top); st.x += m.x - start.x; st.y += m.y - start.y; apply(); } start = mid(); moved = true; }
    });
    vp.addEventListener("pointerup", (e) => { ptrs.delete(e.pointerId); start = mid(); if (!ptrs.size) { vp.classList.remove("panning"); if (!moved && downTarget) onPick(downTarget); downTarget = null; } });
    vp.addEventListener("pointercancel", (e) => { ptrs.delete(e.pointerId); start = mid(); downTarget = null; if (!ptrs.size) vp.classList.remove("panning"); });
    return { apply, center, reset };
  }

  function clearHighlight() {
    document.querySelectorAll(".room-hl").forEach((h) => h.remove());
    document.querySelectorAll(".floorplan-room").forEach((c) => (c.textContent = "Tap a room to see its number."));
  }

  function highlight(fp, room, zoom) {
    clearHighlight();
    const svg = fp.querySelector("svg");
    const target = findRoom(svg, room);
    if (!target) return false;
    showFloor(fp);
    const NS = "http://www.w3.org/2000/svg";
    let hl;
    if (target.tagName === "path" && target.getAttribute("d")) {
      hl = document.createElementNS(NS, "path");
      hl.setAttribute("d", target.getAttribute("d"));
    } else {
      const b = target.getBBox();
      hl = document.createElementNS(NS, "rect");
      for (const [k, v] of Object.entries({ x: b.x, y: b.y, width: b.width, height: b.height, rx: 4 })) hl.setAttribute(k, v);
    }
    hl.setAttribute("class", "room-hl");
    svg.appendChild(hl);
    const cap = captionOf(fp);
    cap.textContent = `Room ${room}, floor ${fp.dataset.floor}. `;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "font-medium text-teal-700 hover:underline"; btn.textContent = "Center on it";
    btn.onclick = () => { showFloor(fp); fp.view.center(target); };
    cap.appendChild(btn);
    eventsAt(fp.dataset.building, room).forEach((e) => {
      const line = document.createElement("div");
      line.className = "text-xs text-gray-500"; line.textContent = `${e.title}, ${t12(e.start)} to ${t12(e.end)}`;
      cap.appendChild(line);
    });
    if (zoom) fp.view.center(target);
    return true;
  }

  function initPlans() {
    plans().forEach((fp) => {
      if (fp.view) return;
      const svg = fp.querySelector("svg");
      fp.view = viewer(fp, (target) => {
        const room = roomOf(target, svg);
        if (!room) return;
        highlight(fp, room, false);
        history.replaceState(null, "", `#${fp.dataset.building}-${room}`);
      });
      svg.querySelectorAll("[id]").forEach((e) => { if (roomOf(e, svg)) e.classList.add("room-pick"); });
    });
    document.querySelectorAll(".building .floor-tabs [data-floor]").forEach((t) => {
      t.onclick = () => { const fp = t.closest(".building").querySelector(`.floorplan[data-floor="${t.dataset.floor}"]`); if (fp) showFloor(fp); };
    });
  }
  initPlans();

  function openHash() {
    const m = /^#([a-z]+)(?:-(\d+[a-z]*))?$/i.exec(location.hash);
    clearHighlight();
    if (!m) return;
    const det = document.getElementById(m[1].toLowerCase());
    if (det && det.tagName === "DETAILS") det.open = true;
    if (!m[2]) return;
    const room = m[2].toUpperCase();
    // A room drawn on several floors (155 spans C and D) resolves to the floor currently shown.
    const cands = plans().filter((p) => p.dataset.building === m[1].toLowerCase()).sort((a, b) => a.classList.contains("hidden") - b.classList.contains("hidden"));
    const fp = cands.find((p) => findRoom(p.querySelector("svg"), room));
    if (fp && highlight(fp, room, true)) fp.scrollIntoView({ block: "center" });
  }
  // Your rooms on the map. Find my rooms remembers the student ID; here each of their rooms is
  // outlined with its round name, and #round-<name> outlines every room a round uses.
  const myBox = document.getElementById("my-rooms");
  const BUILDINGS = { DWINELLE: "dwinelle", WHEELER: "wheeler", VLSB: "vlsb", VALLEY: "vlsb", PAULEY: "pauley" };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const parseRoom = (s) => {
    const b = BUILDINGS[s.split(" ")[0].toUpperCase()];
    const n = (s.replace(/\(.*$/, "").trim().split(/\s+/).pop().match(/^\d+[A-Z]*$/i) || [])[0];
    return { b, n: n && n.toUpperCase(), href: b ? `#${b}${n ? "-" + n.toUpperCase() : ""}` : "" };
  };
  const planFor = (b, n) => plans().filter((p) => p.dataset.building === b).sort((a, c) => a.classList.contains("hidden") - c.classList.contains("hidden")).find((p) => findRoom(p.querySelector("svg"), n));
  const bboxOf = (fp, el) => { const hidden = fp.classList.contains("hidden"); if (hidden) fp.classList.remove("hidden"); const b = el.getBBox(); if (hidden) fp.classList.add("hidden"); return b; };

  function markRoom(room, label, cls = "room-mine") {
    const { b, n } = parseRoom(room);
    const fp = b && n && planFor(b, n);
    if (!fp) return null;
    const svg = fp.querySelector("svg"), target = findRoom(svg, n), NS = "http://www.w3.org/2000/svg";
    const box = bboxOf(fp, target);
    let m;
    if (target.tagName === "path" && target.getAttribute("d")) { m = document.createElementNS(NS, "path"); m.setAttribute("d", target.getAttribute("d")); }
    else { m = document.createElementNS(NS, "rect"); for (const [k, v] of Object.entries({ x: box.x, y: box.y, width: box.width, height: box.height, rx: 4 })) m.setAttribute(k, v); }
    m.setAttribute("class", cls);
    const t = document.createElementNS(NS, "text");
    // Label sits just above the room so the room number stays readable.
    const fs = Math.max(9, Math.min(12, box.height / 3));
    t.setAttribute("x", box.x + box.width / 2); t.setAttribute("y", box.y - 3); t.setAttribute("font-size", fs); t.setAttribute("text-anchor", "middle"); t.setAttribute("class", `${cls}-label`);
    t.textContent = label;
    svg.append(m, t);
    return fp;
  }
  const clearMarks = () => document.querySelectorAll(".room-mine, .room-mine-label").forEach((e) => e.remove());

  // "Dwinelle 155" style mentions in the schedule and updates, linked to the map.
  const ROOM_RE = /\b(Dwinelle|Wheeler|VLSB|Valley Life Sciences Building|Pauley Ballroom)(?: Hall)? (\d{1,4}[A-Z]?)\b/g;
  const roomRefs = (text) => [...String(text || "").matchAll(ROOM_RE)].map((m) => ({ b: BUILDINGS[m[1].split(" ")[0].toUpperCase()], n: m[2].toUpperCase(), text: m[0] }));
  function linkRooms(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentNode.closest("a, script, style")) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.nodeValue, refs = roomRefs(text);
      if (!refs.length) return;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of text.matchAll(ROOM_RE)) {
        frag.append(text.slice(last, m.index));
        const a = document.createElement("a");
        a.href = `/map/#${BUILDINGS[m[1].split(" ")[0].toUpperCase()]}-${m[2].toUpperCase()}`; a.className = "underline decoration-dotted hover:text-teal-700"; a.title = "Show on the map"; a.textContent = m[0];
        frag.append(a); last = m.index + m[0].length;
      }
      frag.append(text.slice(last));
      node.replaceWith(frag);
    });
  }
  document.querySelectorAll(".sched, article .prose").forEach(linkRooms);

  let schedCache = null;
  const sched = () => { if (schedCache === null) { const raw = document.getElementById("schedule-data"); schedCache = raw ? JSON.parse(raw.textContent) : false; } return schedCache; };
  const eventsAt = (building, room) => (sched() ? sched().events : []).filter((e) => roomRefs(e.location).some((r) => r.b === building && r.n === room));

  function markNow(current, next, now, phase) {
    document.querySelectorAll(".room-now, .room-next, .room-now-label, .room-next-label").forEach((e) => e.remove());
    if (phase !== "today" || !plans().length) return;
    if (current) roomRefs(current.location).forEach((r) => markRoom(`${r.b} ${r.n}`, "Now", "room-now"));
    if (next && mins(next.start) - now <= 15) roomRefs(next.location).forEach((r) => markRoom(`${r.b} ${r.n}`, "Soon", "room-next"));
  }

  function roomRow(label, room, right) {
    return `<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 border-t border-teal-100 first:border-0">
      <span class="text-sm uppercase text-gray-500">${label}</span><span class="flex items-baseline gap-3"><span class="font-semibold">${esc(room)}</span>${right}</span></div>`;
  }
  const showLink = (room) => { const p = parseRoom(room); return p.href && planFor(p.b, p.n) ? `<a class="text-sm font-medium text-teal-700 hover:underline whitespace-nowrap" href="${p.href}">Show on map</a>` : ""; };
  function card(title, rows, foot) {
    myBox.innerHTML = `<div class="bg-teal-50 border border-teal-200 rounded-xl p-4 flex flex-col gap-1">
      <p class="uppercase text-xs text-gray-500 flex flex-wrap gap-2 items-center"><i class="bi bi-person-badge"></i><span>${title}</span><a class="ml-auto normal-case text-teal-700 hover:underline" href="/rooms/">Not you? Change ID</a></p>
      <div>${rows}</div>${foot ? `<p class="text-sm text-gray-600 pt-1">${foot}</p>` : ""}</div>`;
    myBox.classList.remove("hidden");
  }

  let myRooms = null;
  async function loadMine() {
    const id = localStorage.getItem("rooms-id");
    if (!myBox || !id) return null;
    let d = null;
    try {
      const res = await fetch(`/api/rooms?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (res.status === 200) d = await res.json();
      else if (res.status === 404 || res.status === 400) { localStorage.removeItem("rooms-id"); localStorage.removeItem("rooms-result"); return null; }
    } catch (_) { /* offline: fall back to the remembered answer */ }
    if (!d) { try { d = JSON.parse(localStorage.getItem("rooms-result")); } catch (_) { d = null; } }
    if (!d || d.id !== id || !d.rooms.some(Boolean)) return null;
    localStorage.setItem("rooms-result", JSON.stringify(d));
    return d;
  }

  function showMine() {
    if (!myRooms) return;
    clearMarks();
    const rows = myRooms.columns.map((label, i) => myRooms.rooms[i] ? roomRow(`<a class="hover:underline" href="#round-${slugOf(label)}" title="Every room this round uses">${esc(label)}</a>`, myRooms.rooms[i], showLink(myRooms.rooms[i])) : "").join("");
    card(`Your rooms, student ${esc(myRooms.id)}`, rows, "They are outlined on the floor plans below. Tap a round name to see every room it uses.");
    const first = myRooms.columns.map((label, i) => myRooms.rooms[i] && markRoom(myRooms.rooms[i], label)).find(Boolean);
    if (first && !/-/.test(location.hash)) { first.closest("details").open = true; showFloor(first); }
  }

  async function showRound(slug) {
    let d = null;
    try { const res = await fetch("/api/rooms/summary"); if (res.ok) d = await res.json(); } catch (_) { /* handled below */ }
    const i = d ? d.columns.findIndex((c) => slugOf(c) === slug) : -1;
    if (i < 0) { if (myBox) card("Round rooms", "", "The list of rooms isn't available right now. Please try again in a moment."); return; }
    clearMarks();
    const rooms = Object.entries(d.rooms[i]);
    const rows = rooms.map(([room, n]) => roomRow(`${n} student${n === 1 ? "" : "s"}`, room, showLink(room))).join("");
    card(`${esc(d.columns[i])}, ${rooms.length} room${rooms.length === 1 ? "" : "s"}`, rows, myRooms ? `<a class="font-medium text-teal-700 hover:underline" href="#myRooms">Back to your rooms</a>` : "");
    const first = rooms.map(([room]) => markRoom(room, String(d.rooms[i][room]))).find(Boolean);
    if (first) { first.closest("details").open = true; showFloor(first); }
    myBox.scrollIntoView({ block: "start" });
  }

  function openExtraHash() {
    const h = location.hash;
    if (h === "#myRooms" && myBox) { showMine(); if (myRooms) myBox.scrollIntoView({ block: "start" }); }
    else if (h.startsWith("#round-") && myBox) showRound(h.slice(7).toLowerCase());
  }

  // Points of interest come from layer names in the floor plans: anything containing "bathroom",
  // "elevator", "stair" or "exit", or named "POI <Name>" in Figma. The legend is skipped.
  const POI_WORDS = [["Bathrooms", /bathroom|restroom|toilet/i], ["Elevators", /elevator|\blift/i], ["Stairs", /stair/i], ["Exits", /\bexit/i], ["Water", /water|fountain/i], ["Info desk", /info desk|information desk|help desk/i], ["First aid", /first.?aid|medical/i], ["Lunch", /lunch|food/i], ["Lost and found", /lost/i], ["Quiet room", /quiet/i], ["Accessible entrance", /accessible|wheelchair|ramp/i]];
  const POI_ORDER = POI_WORDS.map(([n]) => n);
  const poiCat = (id) => {
    const m = /^POI[\s_:-]+(.+?)[\s_]*\d*$/i.exec(id);
    if (m) { const name = m[1].trim(); const known = POI_WORDS.find(([, re]) => re.test(name)); return known ? known[0] : name[0].toUpperCase() + name.slice(1); }
    const hit = POI_WORDS.find(([, re]) => re.test(id));
    return hit ? hit[0] : null;
  };
  function poiIndex(fp) {
    if (fp.pois) return fp.pois;
    const svg = fp.querySelector("svg"), pois = [];
    const valid = (el) => !el.closest('[id^="Legend"], defs, mask') && el.tagName !== "mask" && poiCat(el.id);
    const matches = [...svg.querySelectorAll("[id]")].filter(valid);
    const disjoint = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    const add = (cat, el) => {
      const box = bboxOf(fp, el);
      if (!box.width || !box.height) return;
      el.dataset.poi = cat;
      // The same spot is often drawn twice (yellow area plus icon); keep the first.
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      if (pois.some((p) => p.cat === cat && cx >= p.box.x && cx <= p.box.x + p.box.width && cy >= p.box.y && cy <= p.box.y + p.box.height)) return;
      pois.push({ cat, el, box });
    };
    matches.forEach((el) => {
      // Containers whose children are named too are handled through the children.
      if (matches.some((m) => m !== el && el.contains(m)) || el.parentNode.closest("[data-poi]")) return;
      const cat = poiCat(el.id), kids = [...el.children].filter((k) => k.tagName !== "mask" && k.tagName !== "defs");
      // A group of separate shapes ("Gendered Bathrooms", "Stair Labels") is one POI per shape.
      const boxes = kids.length > 1 ? kids.map((k) => bboxOf(fp, k)) : [];
      const separate = boxes.length > 1 && boxes.every((a, i) => boxes.every((b, j) => i === j || disjoint(a, b)));
      if (separate) { el.dataset.poi = cat; kids.forEach((k) => add(cat, k)); } else add(cat, el);
    });
    return (fp.pois = pois);
  }
  const poiState = (() => { try { return JSON.parse(localStorage.getItem("map-poi") || "{}"); } catch (_) { return {}; } })();
  const savePoi = () => localStorage.setItem("map-poi", JSON.stringify(poiState));

  function applyPoi(building) {
    const on = poiState[building.dataset.building] || {};
    building.classList.toggle("stepfree", !!on["Step-free"]);
    building.querySelectorAll(".poi-chip").forEach((c) => c.setAttribute("aria-pressed", !!on[c.dataset.cat]));
    building.querySelectorAll(".poi-mark").forEach((m) => m.remove());
    building.querySelectorAll(".floorplan").forEach((fp) => {
      const svg = fp.querySelector("svg"), NS = "http://www.w3.org/2000/svg";
      poiIndex(fp).forEach((p) => {
        const stepfree = on["Step-free"] && (p.cat === "Elevators" || p.cat === "Accessible entrance");
        if (!on[p.cat] && !stepfree) return;
        const r = document.createElementNS(NS, "rect");
        for (const [k, v] of Object.entries({ x: p.box.x - 4, y: p.box.y - 4, width: p.box.width + 8, height: p.box.height + 8, rx: 6 })) r.setAttribute(k, v);
        r.setAttribute("class", "poi-mark" + (stepfree && !on[p.cat] ? " stepfree" : ""));
        svg.appendChild(r);
      });
    });
  }

  function initPoi() {
    document.querySelectorAll(".building").forEach((b) => {
      const wrap = b.querySelector(".poi-chips");
      if (!wrap || wrap.childElementCount) return;
      const cats = new Set();
      b.querySelectorAll(".floorplan").forEach((fp) => poiIndex(fp).forEach((p) => cats.add(p.cat)));
      if (!cats.size) return;
      const sorted = [...cats].sort((x, y) => (POI_ORDER.indexOf(x) + 1 || 99) - (POI_ORDER.indexOf(y) + 1 || 99) || x.localeCompare(y));
      const chip = (cat, cls, icon, title) => { const c = document.createElement("button"); c.type = "button"; c.className = "poi-chip " + cls; c.dataset.cat = cat; c.title = title || `Show ${cat.toLowerCase()} on the plan`; c.innerHTML = `<i class="bi ${icon}"></i>${esc(cat)}`; return c; };
      const icons = { Bathrooms: "bi-badge-wc", Elevators: "bi-box-arrow-in-down", Stairs: "bi-ladder", Exits: "bi-door-open", Water: "bi-droplet", "Info desk": "bi-info-circle", "First aid": "bi-bandaid", Lunch: "bi-egg-fried", "Lost and found": "bi-search", "Quiet room": "bi-volume-mute", "Accessible entrance": "bi-universal-access" };
      sorted.forEach((cat) => wrap.appendChild(chip(cat, "", icons[cat] || "bi-geo-alt")));
      if (cats.has("Elevators") || cats.has("Accessible entrance")) wrap.appendChild(chip("Step-free", "stepfree", "bi-universal-access", "Fade out stairs and show elevators and accessible entrances"));
      wrap.classList.remove("hidden"); wrap.classList.add("flex");
      wrap.addEventListener("click", (e) => {
        const c = e.target.closest(".poi-chip"); if (!c) return;
        const on = (poiState[b.dataset.building] = poiState[b.dataset.building] || {});
        on[c.dataset.cat] = !on[c.dataset.cat]; savePoi(); applyPoi(b);
      });
      applyPoi(b);
    });
  }
  initPoi();

  // Search: rooms come from the floor plans' ids, buildings from the building cards.
  const q = document.getElementById("map-q"), sug = document.getElementById("map-suggest");
  if (q) {
    const index = [];
    document.querySelectorAll("details.building, details[id]").forEach((d) => {
      const name = d.querySelector("summary")?.textContent.trim().replace(/\s+/g, " ");
      if (name) index.push({ text: name, hint: "Building", hash: `#${d.id}`, keys: [name.toLowerCase(), d.id] });
    });
    plans().forEach((fp) => {
      const seen = new Set(), svg = fp.querySelector("svg"), bname = fp.closest("details").querySelector("summary").textContent.trim().split(" (")[0];
      svg.querySelectorAll("[id]").forEach((e) => {
        const r = roomOf(e, svg);
        if (!r || seen.has(r)) return;
        seen.add(r);
        const hash = `#${fp.dataset.building}-${r}`, dup = index.find((it) => it.hash === hash);
        if (dup) dup.hint = dup.hint.replace("Floor", "Floors") + ` and ${fp.dataset.floor}`;
        else index.push({ text: `${bname} ${r}`, hint: `Floor ${fp.dataset.floor}`, hash, keys: [r.toLowerCase(), `${fp.dataset.building} ${r}`.toLowerCase()] });
      });
    });
    const matches = (term) => {
      const t = term.trim().toLowerCase().replace(/\s+/g, " ");
      if (!t) return [];
      const score = (it) => it.keys.some((k) => k === t) ? 0 : it.keys.some((k) => k.startsWith(t)) ? 1 : it.keys.some((k) => k.includes(t)) ? 2 : 9;
      return index.map((it) => [score(it), it]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].text.localeCompare(b[1].text, undefined, { numeric: true })).slice(0, 8).map(([, it]) => it);
    };
    let items = [], active = -1;
    const render = () => {
      sug.innerHTML = items.map((it, i) => `<li role="option" aria-selected="${i === active}" data-i="${i}" class="flex justify-between gap-4 px-4 py-2 cursor-pointer aria-selected:bg-teal-50 hover:bg-teal-50"><span class="font-medium">${esc(it.text)}</span><span class="text-sm text-gray-500">${esc(it.hint)}</span></li>`).join("");
      sug.classList.toggle("hidden", !items.length);
    };
    const go = (it) => { if (!it) return; items = []; render(); q.value = it.text; q.blur(); if (location.hash === it.hash) { openHash(); openExtraHash(); } else location.hash = it.hash; };
    q.addEventListener("input", () => { items = matches(q.value); active = items.length ? 0 : -1; render(); });
    q.addEventListener("focus", () => { items = matches(q.value); active = items.length ? 0 : -1; render(); });
    q.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && items.length) { active = (active + 1) % items.length; render(); e.preventDefault(); }
      else if (e.key === "ArrowUp" && items.length) { active = (active - 1 + items.length) % items.length; render(); e.preventDefault(); }
      else if (e.key === "Escape") { items = []; render(); }
    });
    q.form.addEventListener("submit", (e) => { e.preventDefault(); go(items[active] || matches(q.value)[0]); });
    sug.addEventListener("pointerdown", (e) => { const li = e.target.closest("li"); if (li) { e.preventDefault(); go(items[+li.dataset.i]); } });
    document.addEventListener("pointerdown", (e) => { if (!q.form.contains(e.target)) { items = []; render(); } });
  }

  openHash();
  window.addEventListener("hashchange", () => { openHash(); openExtraHash(); });
  loadMine().then((d) => { myRooms = d; showMine(); openExtraHash(); });

  render();
  refresh();
  setInterval(render, 30 * 1000);
  setInterval(refresh, 60 * 1000);
})();
