// Marks what's happening now / up next from the schedule embedded in the page,
// and reloads the page content every minute so new updates show without a refresh.
// Append ?at=2026-04-12T10:00 to preview the page as of a Pacific date-time.
(function () {
  const TZ = "America/Los_Angeles";
  const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  function pacificNow(tz) {
    const at = new URLSearchParams(location.search).get("at");
    if (at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at)) return { date: at.slice(0, 10), now: mins(at.slice(11, 16)) };
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return { date: `${get("year")}-${get("month")}-${get("day")}`, now: Number(get("hour")) * 60 + Number(get("minute")) };
  }

  // Finished rounds fold away so the current one is never further down than the second row;
  // the one just before it stays for context, the rest are behind the "earlier" button.
  let showEarlier = false;
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-earlier]")) { showEarlier = !showEarlier; render(); }
  });

  function render() {
    const raw = document.getElementById("schedule-data");
    if (!raw) return;
    const data = JSON.parse(raw.textContent);
    const events = data.events.map((e, i) => ({ ...e, i })).sort((a, b) => mins(a.start) - mins(b.start));
    const { date, now } = pacificNow(data.timezone || TZ);
    const phase = date < data.date ? "before" : date > data.date ? "after" : "today";
    const current = phase === "today" ? events.find((e) => mins(e.start) <= now && mins(e.end) > now) : null;
    const next = phase === "after" ? null : events.find((e) => mins(e.start) > now || phase === "before");

    setText("sched-status", phase === "before" ? "Upcoming" : phase === "after" ? "Finished" : current ? "Live" : next ? "Live · between rounds" : "Live · all done");
    document.getElementById("live-dot")?.classList.toggle("hidden", phase !== "today");

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

    const rows = [...document.querySelectorAll("[data-event]")];
    const anchor = phase === "today" ? rows.findIndex((r) => r.classList.contains("is-now") || r.querySelector(".next-badge:not(.hidden)")) : -1;
    const folded = Math.max(0, anchor - 1);
    rows.forEach((row, i) => row.classList.toggle("hidden", i < folded && !showEarlier));
    const btn = document.querySelector("[data-earlier]");
    if (btn) {
      btn.classList.toggle("hidden", folded === 0);
      btn.textContent = showEarlier ? "Hide earlier rounds" : `${folded} earlier round${folded === 1 ? "" : "s"}`;
    }
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
      const keep = mine.querySelector("[data-map]")?.parentNode;
      mine.innerHTML = html;
      const slot = keep && mine.querySelector("[data-map]")?.parentNode; if (slot) slot.replaceWith(keep);
      mine.querySelectorAll("script").forEach((old) => { const s = document.createElement("script"); s.textContent = old.textContent; old.replaceWith(s); });
      mine.querySelectorAll("details").forEach((d, i) => { if (open[i]) d.open = true; });
      window.scrollTo(0, y);
      render();
    } catch (_) { /* offline; try again next minute */ }
  }

  // /map/#wheeler opens that building's floor plan.
  function openHash() {
    const el = /^#[\w-]+$/.test(location.hash) && document.querySelector("details" + location.hash);
    if (el) el.open = true;
  }
  openHash();
  window.addEventListener("hashchange", openHash);

  render();
  refresh();
  setInterval(render, 30 * 1000);
  setInterval(refresh, 60 * 1000);
})();
