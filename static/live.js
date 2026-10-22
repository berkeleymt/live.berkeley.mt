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

  // /map/#wheeler opens that building's floor plan; /map/#dwinelle-155 also highlights room 155.
  // Floor plans are inline SVGs whose room shapes are named by room number (Figma layer names).
  const ROOM_ID = /^(\d+[A-Z]*)(?:[\s_(\u2028].*)?$/;
  const roomOf = (el, root) => { for (; el && el !== root; el = el.parentNode) { const m = el.id && ROOM_ID.exec(el.id); if (m) return m[1]; } return null; };
  const findRoom = (svg, room) => svg.querySelector(`[id="${room}"]`) || [...svg.querySelectorAll("[id]")].find((e) => roomOf(e, svg) === room);
  const plans = () => [...document.querySelectorAll(".floorplan")].filter((fp) => fp.querySelector("svg"));

  function clearHighlight() {
    document.querySelectorAll(".room-hl").forEach((h) => h.remove());
    plans().forEach((p) => (p.querySelector(".floorplan-room").textContent = "Tap a room to see its number."));
  }

  function highlight(fp, room) {
    clearHighlight();
    const svg = fp.querySelector("svg");
    const target = findRoom(svg, room);
    if (!target) return false;
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
    fp.querySelector(".floorplan-room").textContent = `Room ${room}, floor ${fp.dataset.floor}.`;
    return true;
  }

  function initPlans() {
    plans().forEach((fp) => {
      const svg = fp.querySelector("svg");
      svg.querySelectorAll("[id]").forEach((e) => { if (roomOf(e, svg)) e.classList.add("room-pick"); });
      svg.addEventListener("click", (e) => {
        const room = roomOf(e.target, svg);
        if (!room) return;
        highlight(fp, room);
        history.replaceState(null, "", `#${fp.dataset.building}-${room}`);
      });
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
    const fp = plans().find((p) => p.dataset.building === m[1].toLowerCase() && findRoom(p.querySelector("svg"), room));
    if (fp && highlight(fp, room)) fp.scrollIntoView({ block: "center" });
  }
  openHash();
  window.addEventListener("hashchange", openHash);

  render();
  refresh();
  setInterval(render, 30 * 1000);
  setInterval(refresh, 60 * 1000);
})();
