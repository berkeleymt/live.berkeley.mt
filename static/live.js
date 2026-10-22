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
      openHash();
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
  openHash();
  window.addEventListener("hashchange", openHash);

  render();
  refresh();
  setInterval(render, 30 * 1000);
  setInterval(refresh, 60 * 1000);
})();
