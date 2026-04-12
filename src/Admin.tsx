import { useState, useEffect, useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { PencilSimple, Trash, Timer, Plus, X, Check } from "@phosphor-icons/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LiveData, ScheduleEvent, Announcement, DelayNotice } from "./data/types";

const API = import.meta.env.VITE_API_URL?.replace(/\/live$/, "") ?? "/api";

// ── Helpers ──

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) window.location.reload();
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
      const res = await fetch(`${API}/live?include_future=true`);
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

// ── Animated icon swap ──

function IconSwap({ children, id }: { children: ReactNode; id: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={id}
        initial={{ opacity: 0, scale: 0.8, filter: "blur(2px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.8, filter: "blur(2px)" }}
        transition={{ duration: 0.12 }}
        className="inline-flex items-center justify-center"
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
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
  const [delayEndInput, setDelayEndInput] = useState("");
  const [delayReason, setDelayReason] = useState("");

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && editingId) { setEditingId(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingId]);
  const [lastDelay, setLastDelay] = useState<{ eventId: string; deltaMins: number; reason: string } | null>(null);
  const endManuallyEdited = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const delayRef = useRef<HTMLInputElement>(null);

  // Index delays by event
  const byEvent = new Map<string, DelayNotice[]>();
  for (const d of delays) byEvent.set(d.eventId, [...(byEvent.get(d.eventId) ?? []), d]);

  const handleStartChange = (value: string) => {
    setDelayInput(value);
    if (endManuallyEdited.current) return;
    const ev = events.find(e => e.id === delayFor);
    if (!ev) return;
    const resolved = value ? resolveDelay(value, ev.startTime) : null;
    if (resolved) {
      const delta = toMinutes(resolved) - toMinutes(ev.startTime);
      setDelayEndInput(fromMinutes(toMinutes(ev.endTime) + delta));
    } else {
      setDelayEndInput("");
    }
  };
  const handleEndChange = (value: string) => {
    endManuallyEdited.current = true;
    setDelayEndInput(value);
  };

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
      action: { label: "Undo", onClick: async () => { await api("POST", "/delays", { eventId: d.eventId, newTime: d.newTime ?? undefined, newEndTime: d.newEndTime ?? undefined, reason: d.reason }); onUpdate(); } },
    });
  };

  const openDelay = (ev: ScheduleEvent) => {
    const existing = (byEvent.get(ev.id) ?? [])[0];
    setDelayFor(ev.id);
    setDelayInput(existing?.newTime ?? "");
    setDelayEndInput(existing?.newEndTime ?? "");
    setDelayReason(existing?.reason ?? "");
    endManuallyEdited.current = !!existing;
    setTimeout(() => delayRef.current?.focus(), 0);
  };
  const submitDelay = async () => {
    if (!delayFor || (!delayInput && !delayEndInput)) return;
    const ev = events.find(e => e.id === delayFor);
    if (!ev) return;
    const resolvedStart = delayInput ? resolveDelay(delayInput, ev.startTime) : null;
    const resolvedEnd = delayEndInput ? resolveDelay(delayEndInput, ev.endTime) : null;
    if (delayInput && !resolvedStart) return;
    if (delayEndInput && !resolvedEnd) return;
    await api("POST", "/delays", {
      eventId: delayFor,
      newTime: resolvedStart || undefined,
      newEndTime: resolvedEnd || undefined,
      reason: delayReason || undefined,
    });
    const deltaMins = resolvedStart ? toMinutes(resolvedStart) - toMinutes(ev.startTime) : (resolvedEnd ? toMinutes(resolvedEnd) - toMinutes(ev.endTime) : 0);
    setLastDelay({ eventId: delayFor, deltaMins, reason: delayReason });
    setDelayFor(null);
    setDelayInput("");
    setDelayEndInput("");
    setDelayReason("");
    onUpdate();
  };
  const applyDelayToNext = async () => {
    if (!lastDelay) return;
    const idx = events.findIndex(e => e.id === lastDelay.eventId);
    const next = events[idx + 1];
    if (!next) return;
    const newTime = fromMinutes(toMinutes(next.startTime) + lastDelay.deltaMins);
    const newEndTime = fromMinutes(toMinutes(next.endTime) + lastDelay.deltaMins);
    await api("POST", "/delays", { eventId: next.id, newTime, newEndTime, reason: lastDelay.reason || undefined });
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

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-2xl font-bold">Schedule</h2>
        <button onClick={() => { setAdding(!adding); setNewRow(emptyScheduleRow); }} className="btn-sm text-sm">
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>
      <div className="space-y-1">
        {events.map(ev => {
          const evDelays = byEvent.get(ev.id) ?? [];
          const isEditing = editingId === ev.id;
          return (
            <div key={ev.id}>
              <div className={`group card px-4 py-3 relative ${isEditing ? "editing-card" : ""}`}>
                <div className="min-w-0">
                  <Cell value={ev.title} onSave={v => update(ev.id, "title", v)} className="font-semibold text-lg" width="w-full" disabled={!isEditing} />
                  <div className="flex items-center gap-0 text-sm text-tertiary-label mt-0.5">
                    <Cell value={ev.startTime} onSave={v => saveTime(ev.id, "startTime", v)} format={fmt} mono className="text-sm" disabled={!isEditing} />
                    <span className="shrink-0">–</span>
                    <Cell value={ev.endTime} onSave={v => saveTime(ev.id, "endTime", v)} format={fmt} mono className="text-sm" disabled={!isEditing} />
                    <span className="shrink-0 mx-0.5">·</span>
                    <Cell value={ev.location} onSave={v => update(ev.id, "location", v)} className="text-sm" width="w-full" disabled={!isEditing} />
                  </div>
                  {evDelays.length > 0 && (
                    <div className="mt-0.5">
                      {evDelays.map(d => (
                        <div key={d.id} className="flex items-center gap-1.5 text-sm">
                          <span className="text-danger font-medium tabular-nums">
                            → {fmt(d.newTime ?? d.originalTime)}–{fmt(d.newEndTime ?? d.originalEndTime ?? ev.endTime)}
                          </span>
                          {d.reason && <span className="text-tertiary-label">— {d.reason}</span>}
                          <button onClick={() => removeDelay(d)} className="text-danger/60 hover:text-danger px-1 rounded hover:bg-danger/10"><X size={14} weight="bold" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className={`absolute -right-2 -top-2 flex items-center gap-0.5 transition-opacity ${isEditing ? "" : "opacity-0 group-hover:opacity-100"}`}>
                  <button onClick={() => remove(ev)} className="w-7 h-7 rounded-full bg-white shadow-md border border-danger/50 flex items-center justify-center text-danger hover:bg-red-50 transition-colors" title="Delete"><Trash size={14} /></button>
                  <IconSwap id={isEditing ? "editing" : "idle"}>
                    {isEditing ? (
                      <button onClick={() => setEditingId(null)} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-green-600 hover:border-green-300 transition-colors" title="Done"><Check size={14} weight="bold" /></button>
                    ) : (
                      <button onClick={() => setEditingId(ev.id)} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-tertiary-label hover:text-label hover:border-black/20 transition-colors" title="Edit"><PencilSimple size={14} /></button>
                    )}
                  </IconSwap>
                  <button onClick={() => openDelay(ev)} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-tertiary-label hover:text-label hover:border-black/20 transition-colors" title="Add delay"><Timer size={14} /></button>
                </div>
              </div>

              {/* Delay input */}
              {delayFor === ev.id && (() => {
                const resolvedStart = delayInput ? resolveDelay(delayInput, ev.startTime) : null;
                const resolvedEnd = delayEndInput ? resolveDelay(delayEndInput, ev.endTime) : null;
                const canSubmit = (resolvedStart || resolvedEnd) ? true : false;
                return (
                  <div className="ml-4 mt-1 card px-4 py-3 border-l-4 border-danger rounded-l-none bg-red-50/50 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-danger font-medium shrink-0">Start</span>
                      <input ref={delayRef} value={delayInput} onChange={e => handleStartChange(e.target.value)} onKeyDown={delayKey}
                        placeholder={`+15m or ${fmt(ev.startTime)}`}
                        className="bg-transparent outline-none tabular-nums text-base font-semibold w-[14ch] h-[36px] border-b border-danger/30 focus:border-danger placeholder:font-normal placeholder:text-tertiary-label/50"
                      />
                      <span className={`text-sm text-danger/70 shrink-0 w-[10ch] tabular-nums ${resolvedStart ? "" : "invisible"}`}>→ {resolvedStart ? fmt(resolvedStart) : ""}</span>
                      <span className="text-sm text-danger font-medium shrink-0">End</span>
                      <input value={delayEndInput} onChange={e => handleEndChange(e.target.value)} onKeyDown={delayKey}
                        placeholder={`+15m or ${fmt(ev.endTime)}`}
                        className="bg-transparent outline-none tabular-nums text-base font-semibold w-[14ch] h-[36px] border-b border-danger/30 focus:border-danger placeholder:font-normal placeholder:text-tertiary-label/50"
                      />
                      <span className={`text-sm text-danger/70 shrink-0 w-[10ch] tabular-nums ${resolvedEnd ? "" : "invisible"}`}>→ {resolvedEnd ? fmt(resolvedEnd) : ""}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input value={delayReason} onChange={e => setDelayReason(e.target.value)} onKeyDown={delayKey}
                        placeholder="reason (optional)"
                        className="bg-transparent outline-none text-sm flex-1 min-w-0 h-[36px] border-b border-danger/30 focus:border-danger placeholder:text-tertiary-label/50"
                      />
                      <button onClick={submitDelay} disabled={!canSubmit} className="btn-sm text-danger min-h-[36px] disabled:opacity-30">Add</button>
                      <button onClick={() => setDelayFor(null)} className="btn-sm min-h-[36px]"><X size={16} weight="bold" /></button>
                    </div>
                  </div>
                );
              })()}

              {/* Apply delay to next event */}
              {lastDelay?.eventId === ev.id && (() => {
                const next = events[events.findIndex(e => e.id === ev.id) + 1];
                if (!next || lastDelay.deltaMins <= 0) return null;
                return (
                  <div className="ml-4 mt-1 flex items-center gap-2 text-sm text-tertiary-label min-h-[36px]">
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
          <div className="card px-4 py-3 flex items-center gap-3 border border-dashed border-tertiary-label/30">
            <div className="flex-1 min-w-0">
              <input ref={titleRef} value={newRow.title} onChange={e => setNewRow(r => ({ ...r, title: e.target.value }))} onKeyDown={newRowKey}
                autoFocus placeholder="New event title..." className="bg-transparent outline-none font-semibold text-lg w-full placeholder:text-tertiary-label/50" />
              <div className="flex items-center gap-1 text-sm text-tertiary-label mt-0.5">
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
              className="btn-sm opacity-60 disabled:opacity-20 transition-opacity" title="Add (Enter)"><Plus size={16} weight="bold" /></button>
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
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [scheduleInput, setScheduleInput] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && editingId) { setEditingId(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingId]);

  const add = async () => {
    if (!title || !body) return;
    let scheduledAt: string | undefined;
    if (scheduleInput) {
      const t = parseTime(scheduleInput);
      if (!t) return;
      const [h, m] = t.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      scheduledAt = d.toISOString().replace(/\.\d{3}Z$/, "Z");
    }
    await api("POST", "/announcements", { title, body, priority, scheduledAt });
    setTitle(""); setBody(""); setPriority("normal"); setScheduleInput("");
    titleRef.current?.focus();
    onUpdate();
  };
  const update = async (a: Announcement, field: string, value: string) => {
    await api("PUT", `/announcements/${a.id}`, {
      title: field === "title" ? value : a.title,
      body: field === "body" ? value : a.body,
      priority: field === "priority" ? value : a.priority,
      pinned: a.pinned ?? false,
      scheduledAt: a.scheduledAt,
    });
    onUpdate();
  };
  const remove = async (a: Announcement) => {
    await api("DELETE", `/announcements/${a.id}`);
    setEditingId(null);
    onUpdate();
    toast(`Deleted "${a.title}"`, {
      action: { label: "Undo", onClick: async () => { await api("POST", "/announcements", { title: a.title, body: a.body, priority: a.priority, scheduledAt: a.scheduledAt }); onUpdate(); } },
    });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
    if (e.key === "Escape") { (e.target as HTMLElement).blur(); setAdding(false); }
  };
  const autoGrow = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    t.style.height = "auto";
    t.style.height = t.scrollHeight + "px";
  };

  const isFuture = (a: Announcement) => a.scheduledAt && new Date(a.scheduledAt) > new Date();

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-2xl font-bold">Announcements</h2>
        <button onClick={() => { setAdding(!adding); if (!adding) { setTitle(""); setBody(""); setPriority("normal"); setScheduleInput(""); } }} className="btn-sm text-sm">
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {adding && (
        <div className="card px-4 py-4 mb-3 border border-dashed border-tertiary-label/30 space-y-3">
          <div className="flex gap-2">
            <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} onKeyDown={onKey}
              autoFocus placeholder="Announcement title..." className="bg-transparent outline-none font-semibold text-lg flex-1 placeholder:text-tertiary-label/50" />
            <select value={priority} onChange={e => setPriority(e.target.value as "normal" | "urgent")}
              className={`bg-transparent outline-none text-sm ${priority === "urgent" ? "text-danger font-semibold" : "text-tertiary-label"}`}>
              <option value="normal">normal</option>
              <option value="urgent">urgent</option>
            </select>
          </div>
          <div className="flex gap-2 items-end">
            <textarea value={body} onChange={e => setBody(e.target.value)} onKeyDown={onKey} onInput={autoGrow}
              placeholder="Body text..." rows={1}
              className="bg-transparent outline-none text-base flex-1 resize-none placeholder:text-tertiary-label/50" />
            <button onClick={add} disabled={!title || !body}
              className="btn-sm opacity-60 disabled:opacity-20 transition-opacity shrink-0" title="Post (Cmd+Enter)">
              {scheduleInput ? "Schedule" : "Post"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-sm text-tertiary-label">{scheduleInput ? "Cmd+Enter to schedule" : "Cmd+Enter to post"}</p>
            <span className="text-tertiary-label/30">|</span>
            <input value={scheduleInput} onChange={e => setScheduleInput(e.target.value)} onKeyDown={onKey}
              placeholder="Schedule for... (e.g. 2:30 PM)"
              className="bg-transparent outline-none text-sm text-tertiary-label flex-1 placeholder:text-tertiary-label/50 tabular-nums" />
            {scheduleInput && (() => {
              const t = parseTime(scheduleInput);
              return t ? <span className="text-sm text-berkeley-blue font-medium shrink-0">at {fmt(t)}</span>
                       : <span className="text-sm text-danger/60 shrink-0">invalid time</span>;
            })()}
          </div>
        </div>
      )}

      <div className="space-y-1">
        {announcements.map(a => (
          <div key={a.id} className={`group card px-4 py-3 relative ${
            editingId === a.id ? "editing-card" :
            a.priority === "urgent" ? "border-l-4 border-danger rounded-l-none" :
            isFuture(a) ? "border-l-4 border-berkeley-blue/40 rounded-l-none opacity-70" : ""
          }`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Cell value={a.title} onSave={v => update(a, "title", v)} className={`font-semibold text-lg ${a.priority === "urgent" ? "text-danger" : ""}`} width="w-full" disabled={editingId !== a.id} />
                {a.pinned && <span className="text-sm shrink-0">📌</span>}
                {isFuture(a) && <span className="text-xs font-medium text-berkeley-blue bg-berkeley-blue/10 px-2 py-0.5 rounded-full shrink-0">Scheduled</span>}
              </div>
              {editingId === a.id ? (
                <Cell value={a.body} onSave={v => update(a, "body", v)} className="text-sm text-secondary-label mt-1" width="w-full" />
              ) : (
                <div className="text-sm text-secondary-label mt-1 prose-sm">
                  <Markdown remarkPlugins={[remarkGfm]} skipHtml>{a.body}</Markdown>
                </div>
              )}
              <p className="text-xs text-tertiary-label mt-1.5">
                {isFuture(a)
                  ? <>Publishes {new Date(a.scheduledAt!).toLocaleString()}</>
                  : new Date(a.scheduledAt ?? a.timestamp).toLocaleString()
                }
              </p>
            </div>
            <div className={`absolute -right-2 -top-2 flex items-center gap-0.5 transition-opacity ${editingId === a.id ? "" : "opacity-0 group-hover:opacity-100"}`}>
              <button onClick={() => remove(a)} className="w-7 h-7 rounded-full bg-white shadow-md border border-danger/50 flex items-center justify-center text-danger hover:bg-red-50 transition-colors" title="Delete"><Trash size={14} /></button>
              <IconSwap id={editingId === a.id ? "editing" : "idle"}>
                {editingId === a.id ? (
                  <button onClick={() => setEditingId(null)} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-green-600 hover:border-green-300 transition-colors" title="Done"><Check size={14} weight="bold" /></button>
                ) : (
                  <button onClick={() => setEditingId(a.id)} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-tertiary-label hover:text-label hover:border-black/20 transition-colors" title="Edit"><PencilSimple size={14} /></button>
                )}
              </IconSwap>
            </div>
          </div>
        ))}
      </div>

      {announcements.length === 0 && !adding && (
        <p className="text-sm text-tertiary-label">No announcements</p>
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
    <div className="max-w-4xl mx-auto px-6 py-12 text-center">
      <h1 className="text-xl font-bold text-danger mb-2">Connection Error</h1>
      <p className="text-secondary-label mb-4">{error}</p>
      <p className="text-sm text-tertiary-label">
        Make sure the server is running: <code className="bg-bg px-2 py-0.5 rounded">cd server && cargo run</code>
      </p>
    </div>
  );

  if (!data) return (
    <div className="max-w-4xl mx-auto px-6 py-12 text-center">
      <p className="text-secondary-label">Loading...</p>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 pb-24 text-base">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">BmMT Admin</h1>
          <p className="text-sm text-tertiary-label mt-1">
            Press Edit to modify · <kbd>.</kbd> to refresh
          </p>
        </div>
        <a href="/" className="btn-secondary">← Live Site</a>
      </div>
      <div className="space-y-12">
        <ScheduleSection events={data.schedule} delays={data.delays} onUpdate={refresh} />
        <AnnouncementsSection announcements={data.announcements} onUpdate={refresh} />
      </div>
    </div>
  );
}
