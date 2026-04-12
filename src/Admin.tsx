import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from "react";
import { toast } from "sonner";
import type { LiveData, ScheduleEvent, Announcement, DelayNotice } from "./data/types";

const API = import.meta.env.VITE_API_URL?.replace(/\/live$/, "") ?? "/api";

// ── Helpers ──

async function api(method: string, path: string, body?: unknown) {
  await fetch(`${API}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** "14:30" → "2:30 PM" */
function fmt(t: string) {
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function toMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(mins: number) {
  return `${Math.floor(mins / 60) % 24}`.padStart(2, "0") + ":" + `${mins % 60}`.padStart(2, "0");
}

/** Parse flexible time input ("2:30 PM", "14:30", "230p") → "HH:mm" or null */
function parseTime(input: string): string | null {
  const s = input.trim().toLowerCase();
  const pad = (n: number) => n.toString().padStart(2, "0");

  // 24h — "14:30"
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const [h, m] = [parseInt(m24[1]), parseInt(m24[2])];
    if (h <= 23 && m <= 59) return `${pad(h)}:${pad(m)}`;
  }
  // 12h — "2:30 pm", "2:30pm", "230p"
  const m12 = s.match(/^(\d{1,2}):?(\d{2})\s*(a|p|am|pm)$/);
  if (m12) {
    let h = parseInt(m12[1]);
    const m = parseInt(m12[2]);
    const pm = m12[3].startsWith("p");
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    if (h <= 23 && m <= 59) return `${pad(h)}:${pad(m)}`;
  }
  return null;
}

/** Parse "+15m", "+1h", "+1h30m", or absolute time → "HH:mm" */
function resolveDelay(input: string, baseTime: string): string | null {
  const s = input.trim().toLowerCase();
  // "+15", "+15m"
  const dm = s.match(/^\+(\d+)\s*(m|min)?$/);
  if (dm) return fromMinutes(toMinutes(baseTime) + parseInt(dm[1]));
  // "+1h", "+1h30m"
  const dh = s.match(/^\+(\d+)\s*h\s*(?:(\d+)\s*m?)?$/);
  if (dh) return fromMinutes(toMinutes(baseTime) + parseInt(dh[1]) * 60 + (dh[2] ? parseInt(dh[2]) : 0));
  return parseTime(s);
}

// ── Data hook ──

function useAdminData() {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/live`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { data, error, refresh };
}

// ── Cell ──

function Cell({
  value, onSave, className = "", placeholder = "", mono = false, width, format, disabled = false,
}: {
  value: string; onSave: (v: string) => void; className?: string;
  placeholder?: string; mono?: boolean; width?: string;
  format?: (v: string) => string; disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  const display = format ? format(value) : value;
  const shown = focused ? draft : display;

  const commit = () => { setFocused(false); if (draft !== value) onSave(draft); };
  const cancel = () => { setFocused(false); setDraft(value); ref.current?.blur(); };

  return (
    <input
      ref={ref}
      value={shown}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => {
        if (disabled) { ref.current?.blur(); return; }
        setFocused(true);
        setDraft(display);
      }}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); ref.current?.blur(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
      }}
      readOnly={disabled}
      tabIndex={disabled ? -1 : undefined}
      placeholder={placeholder}
      style={{ fieldSizing: width ? undefined : "content" as never }}
      className={[
        "border border-transparent rounded px-0.5 bg-transparent outline-none transition-colors",
        mono && "tabular-nums",
        width ?? "",
        disabled
          ? "cursor-default"
          : "cursor-pointer hover:bg-black/5 focus:bg-white focus:border-berkeley-blue/30 focus:ring-2 focus:ring-berkeley-blue/20 focus:cursor-text",
        className,
      ].filter(Boolean).join(" ")}
    />
  );
}

// ── Section header ──

function SectionHeader({ title, editing, onToggle }: { title: string; editing: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-lg font-bold">{title}</h2>
      <button onClick={onToggle} className="btn-sm text-[13px]">{editing ? "Done" : "Edit"}</button>
    </div>
  );
}

// ── Schedule ──

const emptyScheduleRow = { title: "", startTime: "", endTime: "", location: "", category: "general" as const, description: "" };

function ScheduleSection({ events, delays, onUpdate }: {
  events: ScheduleEvent[]; delays: DelayNotice[]; onUpdate: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState(emptyScheduleRow);
  const [delayFor, setDelayFor] = useState<string | null>(null);
  const [delayInput, setDelayInput] = useState("");
  const [delayReason, setDelayReason] = useState("");
  const [lastDelay, setLastDelay] = useState<{ eventId: string; deltaMins: number; reason: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const delayRef = useRef<HTMLInputElement>(null);

  const update = async (id: string, field: string, value: string) => {
    await api("PUT", `/schedule/${id}`, { [field]: value });
    onUpdate();
  };
  const saveTime = (id: string, field: string, input: string) => {
    const t = parseTime(input);
    if (t) update(id, field, t);
  };
  const remove = async (ev: ScheduleEvent) => {
    await api("DELETE", `/schedule/${ev.id}`);
    setEditingId(null);
    onUpdate();
    toast(`Deleted "${ev.title}"`, {
      action: { label: "Undo", onClick: async () => { await api("POST", "/schedule", ev); onUpdate(); } },
    });
  };
  const removeDelay = async (d: DelayNotice) => {
    await api("DELETE", `/delays/${d.id}`);
    onUpdate();
    toast(`Removed delay for "${d.eventTitle}"`, {
      action: { label: "Undo", onClick: async () => { await api("POST", "/delays", { eventId: d.eventId, newTime: d.newTime, reason: d.reason }); onUpdate(); } },
    });
  };

  const openDelay = (ev: ScheduleEvent) => {
    setDelayFor(ev.id);
    setDelayInput("");
    setDelayReason("");
    setTimeout(() => delayRef.current?.focus(), 0);
  };
  const submitDelay = async () => {
    if (!delayFor || !delayInput) return;
    const ev = events.find(e => e.id === delayFor);
    if (!ev) return;
    const resolved = resolveDelay(delayInput, ev.startTime);
    if (!resolved) return;
    await api("POST", "/delays", { eventId: delayFor, newTime: resolved, reason: delayReason || undefined });
    setLastDelay({ eventId: delayFor, deltaMins: toMinutes(resolved) - toMinutes(ev.startTime), reason: delayReason });
    setDelayFor(null);
    setDelayInput("");
    setDelayReason("");
    onUpdate();
  };
  const applyDelayToNext = async () => {
    if (!lastDelay) return;
    const idx = events.findIndex(e => e.id === lastDelay.eventId);
    const next = events[idx + 1];
    if (!next) return;
    const newTime = fromMinutes(toMinutes(next.startTime) + lastDelay.deltaMins);
    await api("POST", "/delays", { eventId: next.id, newTime, reason: lastDelay.reason || undefined });
    setLastDelay({ ...lastDelay, eventId: next.id });
    onUpdate();
  };

  const addNew = async () => {
    if (!newRow.title || !newRow.startTime || !newRow.endTime) return;
    await api("POST", "/schedule", newRow);
    setNewRow(emptyScheduleRow);
    setAdding(false);
    onUpdate();
  };

  const delayKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); submitDelay(); }
    if (e.key === "Escape") { e.preventDefault(); setDelayFor(null); }
  };
  const newRowKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); addNew(); }
    if (e.key === "Escape") { e.preventDefault(); setAdding(false); }
  };

  // Index delays by event
  const byEvent = new Map<string, DelayNotice[]>();
  for (const d of delays) byEvent.set(d.eventId, [...(byEvent.get(d.eventId) ?? []), d]);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">Schedule</h2>
        <button onClick={() => { setAdding(!adding); setNewRow(emptyScheduleRow); }} className="btn-sm text-[13px]">
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>
      <div className="space-y-1">
        {events.map(ev => {
          const evDelays = byEvent.get(ev.id) ?? [];
          const isEditing = editingId === ev.id;
          return (
            <div key={ev.id}>
              <div className="group card px-3 py-2 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <Cell value={ev.title} onSave={v => update(ev.id, "title", v)} className="font-semibold text-[15px]" width="w-full" disabled={!isEditing} />
                  <div className="flex items-center gap-0 text-[13px] text-tertiary-label mt-0.5">
                    <Cell value={ev.startTime} onSave={v => saveTime(ev.id, "startTime", v)} format={fmt} mono className="text-[13px]" disabled={!isEditing} />
                    <span className="shrink-0">–</span>
                    <Cell value={ev.endTime} onSave={v => saveTime(ev.id, "endTime", v)} format={fmt} mono className="text-[13px]" disabled={!isEditing} />
                    <span className="shrink-0 mx-0.5">·</span>
                    <Cell value={ev.location} onSave={v => update(ev.id, "location", v)} className="text-[13px]" width="w-full" disabled={!isEditing} />
                  </div>
                  {evDelays.length > 0 && (
                    <div className="mt-0.5">
                      {evDelays.map(d => (
                        <div key={d.id} className="flex items-center gap-1.5 text-[13px]">
                          <span className="text-danger font-medium">Delayed → {fmt(d.newTime)}</span>
                          {d.reason && <span className="text-tertiary-label">— {d.reason}</span>}
                          <button onClick={() => removeDelay(d)} className="text-danger/60 hover:text-danger text-[16px] px-1 rounded hover:bg-danger/10">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openDelay(ev)} className="btn-sm min-w-[36px] min-h-[36px] flex items-center justify-center" title="Add delay">⏱</button>
                  {isEditing ? (
                    <>
                      <button onClick={() => remove(ev)} className="btn-sm btn-danger min-w-[36px] min-h-[36px] flex items-center justify-center" title="Delete">×</button>
                      <button onClick={() => setEditingId(null)} className="btn-sm min-h-[36px]">Done</button>
                    </>
                  ) : (
                    <button onClick={() => setEditingId(ev.id)} className="btn-sm min-h-[36px]" title="Edit event">Edit</button>
                  )}
                </div>
              </div>

              {/* Delay input */}
              {delayFor === ev.id && (() => {
                const resolved = delayInput ? resolveDelay(delayInput, ev.startTime) : null;
                return (
                  <div className="ml-4 mt-1 card px-3 py-2.5 flex items-center gap-2 border-l-4 border-danger rounded-l-none bg-red-50/50">
                    <span className="text-[13px] text-danger font-medium shrink-0">Delay</span>
                    <input ref={delayRef} value={delayInput} onChange={e => setDelayInput(e.target.value)} onKeyDown={delayKey}
                      placeholder="+15m or 2:30 PM"
                      className="bg-transparent outline-none tabular-nums text-[14px] font-semibold w-[14ch] h-[32px] border-b border-danger/30 focus:border-danger placeholder:font-normal placeholder:text-tertiary-label/50"
                    />
                    {resolved && <span className="text-[12px] text-danger/70 shrink-0">→ {fmt(resolved)}</span>}
                    <input value={delayReason} onChange={e => setDelayReason(e.target.value)} onKeyDown={delayKey}
                      placeholder="reason (optional)"
                      className="bg-transparent outline-none text-[13px] flex-1 min-w-0 h-[32px] border-b border-danger/30 focus:border-danger placeholder:text-tertiary-label/50"
                    />
                    <button onClick={submitDelay} disabled={!resolved} className="btn-sm text-danger min-h-[36px] disabled:opacity-30">Add</button>
                    <button onClick={() => setDelayFor(null)} className="btn-sm min-h-[36px]">×</button>
                  </div>
                );
              })()}

              {/* Apply delay to next event */}
              {lastDelay?.eventId === ev.id && (() => {
                const next = events[events.findIndex(e => e.id === ev.id) + 1];
                if (!next || lastDelay.deltaMins <= 0) return null;
                return (
                  <div className="ml-4 mt-1 flex items-center gap-2 text-[13px] text-tertiary-label min-h-[36px]">
                    <button onClick={applyDelayToNext} className="text-danger/70 hover:text-danger underline underline-offset-2 py-1">
                      Apply +{lastDelay.deltaMins}m to {next.title} too?
                    </button>
                    <button onClick={() => setLastDelay(null)} className="text-tertiary-label/50 hover:text-tertiary-label py-1">dismiss</button>
                  </div>
                );
              })()}
            </div>
          );
        })}

        {/* Add new event */}
        {adding && (
          <div className="card px-3 py-2 flex items-center gap-2 border border-dashed border-tertiary-label/30">
            <div className="flex-1 min-w-0">
              <input ref={titleRef} value={newRow.title} onChange={e => setNewRow(r => ({ ...r, title: e.target.value }))} onKeyDown={newRowKey}
                autoFocus placeholder="New event title..." className="bg-transparent outline-none font-semibold text-[15px] w-full placeholder:text-tertiary-label/50" />
              <div className="flex items-center gap-1 text-[13px] text-tertiary-label mt-0.5">
                <input value={newRow.startTime} onChange={e => setNewRow(r => ({ ...r, startTime: e.target.value }))} onKeyDown={newRowKey}
                  placeholder="start" className="bg-transparent outline-none tabular-nums w-[5ch] placeholder:text-tertiary-label/50" />
                <span>–</span>
                <input value={newRow.endTime} onChange={e => setNewRow(r => ({ ...r, endTime: e.target.value }))} onKeyDown={newRowKey}
                  placeholder="end" className="bg-transparent outline-none tabular-nums w-[5ch] placeholder:text-tertiary-label/50" />
                <span className="mx-0.5">·</span>
                <input value={newRow.location} onChange={e => setNewRow(r => ({ ...r, location: e.target.value }))} onKeyDown={newRowKey}
                  placeholder="location" className="bg-transparent outline-none flex-1 min-w-0 placeholder:text-tertiary-label/50" />
              </div>
            </div>
            <button onClick={addNew} disabled={!newRow.title || !newRow.startTime || !newRow.endTime}
              className="btn-sm opacity-60 disabled:opacity-20 transition-opacity" title="Add (Enter)">+</button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Announcements ──

function AnnouncementsSection({ announcements, onUpdate }: {
  announcements: Announcement[]; onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const titleRef = useRef<HTMLInputElement>(null);

  const add = async () => {
    if (!title || !body) return;
    await api("POST", "/announcements", { title, body, priority });
    setTitle(""); setBody(""); setPriority("normal");
    titleRef.current?.focus();
    onUpdate();
  };
  const remove = async (a: Announcement) => {
    await api("DELETE", `/announcements/${a.id}`);
    onUpdate();
    toast(`Deleted "${a.title}"`, {
      action: { label: "Undo", onClick: async () => { await api("POST", "/announcements", { title: a.title, body: a.body, priority: a.priority }); onUpdate(); } },
    });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
    if (e.key === "Escape") (e.target as HTMLElement).blur();
  };
  const autoGrow = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    t.style.height = "auto";
    t.style.height = t.scrollHeight + "px";
  };

  return (
    <section>
      <SectionHeader title="Announcements" editing={editing} onToggle={() => setEditing(!editing)} />

      {editing && (
        <div className="card px-3 py-3 mb-3 border border-dashed border-tertiary-label/30 space-y-2">
          <div className="flex gap-2">
            <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} onKeyDown={onKey}
              placeholder="Announcement title..." className="bg-transparent outline-none font-semibold text-[15px] flex-1 placeholder:text-tertiary-label/50" />
            <select value={priority} onChange={e => setPriority(e.target.value as "normal" | "urgent")}
              className={`bg-transparent outline-none text-[13px] ${priority === "urgent" ? "text-danger font-semibold" : "text-tertiary-label"}`}>
              <option value="normal">normal</option>
              <option value="urgent">urgent</option>
            </select>
          </div>
          <div className="flex gap-2 items-end">
            <textarea value={body} onChange={e => setBody(e.target.value)} onKeyDown={onKey} onInput={autoGrow}
              placeholder="Body text..." rows={1}
              className="bg-transparent outline-none text-[14px] flex-1 resize-none placeholder:text-tertiary-label/50" />
            <button onClick={add} disabled={!title || !body}
              className="btn-sm opacity-60 disabled:opacity-20 transition-opacity shrink-0" title="Post (Cmd+Enter)">Post</button>
          </div>
          <p className="text-[11px] text-tertiary-label">Cmd+Enter to post</p>
        </div>
      )}

      <div className="space-y-1">
        {announcements.map(a => (
          <div key={a.id} className={`group card px-3 py-2 flex items-start gap-3 ${a.priority === "urgent" ? "border-l-4 border-danger rounded-l-none" : ""}`}>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-[15px] ${a.priority === "urgent" ? "text-danger" : ""}`}>
                {a.title}
                {a.pinned && <span className="ml-1 text-[11px]">📌</span>}
              </p>
              <p className="text-[13px] text-secondary-label mt-0.5 line-clamp-2">{a.body}</p>
              <p className="text-[11px] text-tertiary-label mt-1">{new Date(a.timestamp).toLocaleString()}</p>
            </div>
            {editing && <button onClick={() => remove(a)} className="btn-sm btn-danger shrink-0">×</button>}
          </div>
        ))}
      </div>

      {announcements.length === 0 && !editing && (
        <p className="text-[13px] text-tertiary-label">No announcements</p>
      )}
    </section>
  );
}

// ── Main ──

export default function Admin() {
  const { data, error, refresh } = useAdminData();

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === ".") { e.preventDefault(); refresh(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [refresh]);

  if (error) return (
    <div className="max-w-2xl mx-auto px-4 py-12 text-center">
      <h1 className="text-xl font-bold text-danger mb-2">Connection Error</h1>
      <p className="text-secondary-label mb-4">{error}</p>
      <p className="text-[13px] text-tertiary-label">
        Make sure the server is running: <code className="bg-bg px-2 py-0.5 rounded">cd server && cargo run</code>
      </p>
    </div>
  );

  if (!data) return (
    <div className="max-w-2xl mx-auto px-4 py-12 text-center">
      <p className="text-secondary-label">Loading...</p>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-20">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">BmMT Admin</h1>
          <p className="text-[13px] text-tertiary-label mt-0.5">
            Press Edit to modify · <kbd>.</kbd> to refresh
          </p>
        </div>
        <a href="/" className="btn-secondary text-[13px]">← Live Site</a>
      </div>
      <div className="space-y-10">
        <ScheduleSection events={data.schedule} delays={data.delays} onUpdate={refresh} />
        <AnnouncementsSection announcements={data.announcements} onUpdate={refresh} />
      </div>
    </div>
  );
}
