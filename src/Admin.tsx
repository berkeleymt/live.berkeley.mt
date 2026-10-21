import { useState, useEffect, useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { PencilSimple, Trash, Timer, Plus, X, Check } from "@phosphor-icons/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LiveData, ScheduleEvent, Announcement, DelayNotice } from "./data/types";
import { useStaff } from "./features/staff";
import { SchedulePlanner } from "./components/SchedulePlanner";
import { PublishingPanel } from "./components/PublishingPanel";

const API = import.meta.env.VITE_API_URL?.replace(/\/live$/, "") ?? "/api";

// ── Helpers ──

type OperationApi = (method: string, path: string, body?: unknown, expected?: string) => Promise<boolean>;

function failure(error: unknown) {
  return error instanceof TypeError || (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name))
    ? "The server did not confirm this action. Your draft is kept. Refresh and check whether it was saved before retrying; do not submit it twice."
    : error instanceof Error ? error.message : "Could not save. Your draft is kept.";
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
  if (!Number.isInteger(mins) || mins < 0 || mins >= 24 * 60) return "";
  return `${Math.floor(mins / 60)}`.padStart(2, "0") + ":" + `${mins % 60}`.padStart(2, "0");
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
    if (h < 1 || h > 12 || m > 59) return null;
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
  const { request } = useStaff();
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const latest = useRef<LiveData | null>(null);
  const loading = useRef<Promise<boolean> | null>(null);
  const saving = useRef(false);

  const refresh = useCallback((): Promise<boolean> => {
    if (loading.current) return loading.current;
    const load = async () => {
      try {
        const res = await request(`${API}/live?include_future=true`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`Could not refresh (HTTP ${res.status}).`);
        const next: LiveData = await res.json();
        latest.current = next;
        setData(next);
        setError(null);
        return true;
      } catch (e) {
        setError(failure(e));
        return false;
      } finally { loading.current = null; }
    };
    loading.current = load();
    return loading.current;
  }, [request]);

  const mutate = useCallback<OperationApi>(async (method, path, body, expected) => {
    if (saving.current) return false;
    saving.current = true;
    setPending(true);
    try {
      const revision = expected ?? latest.current?.operationRevision;
      const res = await request(`${API}${path}`, {
        method, headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(revision ? { "If-Match": `"${revision}"` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(res.status === 401 ? "Your staff session needs authentication. Drafts are kept; sign in again before retrying." : `Save failed (HTTP ${res.status}). ${detail || "Keep your draft, refresh and reconcile before retrying."}`);
      }
      // A pre-save read must not become the post-save revision.
      if (loading.current) await loading.current;
      // Only this editor's snapshots supply revisions. EventEditor/public requests never change them.
      await refresh();
      toast.success(path.startsWith('/publishing/') ? 'Publishing action completed. Review the loaded and remote status below.' : 'Saved and loaded by this server.');
      return true;
    } catch (e) {
      const message = failure(e);
      setError(message);
      toast.error(message);
      return false;
    } finally {
      saving.current = false;
      setPending(false);
    }
  }, [refresh, request]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { data, error, refresh, mutate, pending };
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

function useDraftWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

// ── Cell ──

function Cell({
  value, onSave, className = "", placeholder = "", mono = false, width, format, disabled = false, label = "Edit value",
}: {
  value: string; onSave: (v: string) => Promise<boolean>; className?: string; label?: string;
  placeholder?: string; mono?: boolean; width?: string;
  format?: (v: string) => string; disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const armed = useRef(false);
  const saver = useRef(onSave);
  useDraftWarning(dirty);

  const display = format ? format(value) : value;
  const shown = focused || dirty ? draft : display;

  const save = async (callback: typeof onSave) => {
    if (saving) return;
    setSaving(true);
    const ok = await callback(draft);
    setSaving(false);
    setFailed(!ok);
    if (ok) setDirty(false);
  };
  const commit = () => {
    setFocused(false);
    if (!armed.current) return;
    armed.current = false;
    if (dirty) void save(saver.current);
  };
  const cancel = () => {
    armed.current = false;
    setFocused(false); setDraft(value); setDirty(false); setFailed(false);
    ref.current?.blur();
  };

  return (
    <span className={width === "w-full" ? "block w-full" : "inline-block"}>
    <input
      aria-label={label}
      aria-invalid={failed || undefined}
      ref={ref}
      value={shown}
      onChange={e => { setDraft(e.target.value); setDirty(true); }}
      disabled={saving}
      onFocus={() => {
        if (disabled) { ref.current?.blur(); return; }
        setFocused(true);
        armed.current = true;
        if (!dirty) { setDraft(display); saver.current = onSave; }
      }}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); ref.current?.blur(); }
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
    {failed && <span className="block text-sm text-danger" role="alert">
      Draft kept. Current value: {display || "(empty)"}. Refresh and compare before retrying.
      <button type="button" className="btn-sm" disabled={saving} onClick={() => {
        if (window.confirm("Save this draft against the refreshed value shown here?")) void save(onSave);
      }}>Retry reviewed draft</button>
      <button type="button" className="btn-sm" onClick={cancel}>Discard draft</button>
    </span>}
    </span>
  );
}

function ChoiceCell({ value, label, choices, onSave }: {
  value: string; label: string; choices: string[]; onSave: (value: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  useDraftWarning(draft !== null);
  async function save(next: string) {
    if (inFlight.current) return;
    inFlight.current = true; setDraft(next); setFailed(false);
    const ok = await onSave(next);
    inFlight.current = false;
    if (ok) setDraft(null);
    setFailed(!ok);
  }
  return <span>
    <label>{label} <select value={draft ?? value} aria-invalid={failed || undefined} onChange={e => { void save(e.target.value); }}>
      {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </select></label>
    {failed && <span className="block text-danger" role="alert">Selection kept. Current published value: {value}.
      <button type="button" className="btn-sm" onClick={() => { if (draft !== null && window.confirm("Save this selection against the refreshed publication?")) void save(draft); }}>Retry reviewed selection</button>
      <button type="button" className="btn-sm" onClick={() => { setDraft(null); setFailed(false); }}>Discard selection</button>
    </span>}
  </span>;
}

// ── Schedule ──

const emptyScheduleRow = { title: "", startTime: "", endTime: "", location: "", category: "general" as ScheduleEvent["category"], description: "" };

function ScheduleSection({ events, delays, api, undo }: {
  events: ScheduleEvent[]; delays: DelayNotice[]; api: OperationApi; undo: OperationApi;
}) {
  const newApi = useRef(api);
  const delayApi = useRef(api);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [delayEvent, setDelayEvent] = useState<ScheduleEvent | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState(emptyScheduleRow);
  const [delayFor, setDelayFor] = useState<string | null>(null);
  const [delayInput, setDelayInput] = useState("");
  const [delayEndInput, setDelayEndInput] = useState("");
  const [delayReason, setDelayReason] = useState("");
  useDraftWarning((adding && Boolean(newRow.title || newRow.startTime || newRow.endTime || newRow.location)) || Boolean(delayFor && (delayInput || delayEndInput || delayReason)));
  const visibleEvents = [...events];
  for (const retained of [editingId ? editingEvent : null, delayFor ? delayEvent : null]) {
    if (retained && !visibleEvents.some(item => item.id === retained.id)) visibleEvents.push(retained);
  }

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
    const event = events.find(item => item.id === id);
    if (!event) { toast.error("This event was removed. Your draft is kept; re-add the event deliberately if needed."); return false; }
    const { id: _id, ...input } = event;
    void _id;
    return api("PUT", `/schedule/${id}`, { ...input, [field]: value });
  };
  const saveTime = async (id: string, field: string, input: string) => {
    const t = parseTime(input);
    if (t) return update(id, field, t);
    toast.error("Use a valid time such as 14:30 or 2:30 PM. Draft kept.");
    return false;
  };
  const remove = async (ev: ScheduleEvent) => {
    if (!await api("DELETE", `/schedule/${ev.id}`)) return;
    setEditingId(null);
    toast(`Deleted "${ev.title}"`, {
      action: { label: "Undo", onClick: async () => { const { id: _id, ...input } = ev; void _id; await undo("POST", "/schedule", input); } },
    });
  };
  const removeDelay = async (d: DelayNotice) => {
    if (!await api("DELETE", `/delays/${d.id}`)) return;
    toast(`Removed delay for "${d.eventTitle}"`, {
      action: { label: "Undo", onClick: async () => { await undo("POST", "/delays", { eventId: d.eventId, newTime: d.newTime ?? undefined, newEndTime: d.newEndTime ?? undefined, reason: d.reason }); } },
    });
  };

  const openDelay = (ev: ScheduleEvent) => {
    delayApi.current = api;
    setDelayEvent(ev);
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
    if (!ev) { toast.error("This event was removed. Your delay draft is kept; refresh and review the schedule."); return; }
    const resolvedStart = delayInput ? resolveDelay(delayInput, ev.startTime) : null;
    const resolvedEnd = delayEndInput ? resolveDelay(delayEndInput, ev.endTime) : null;
    if ((delayInput && !resolvedStart) || (delayEndInput && !resolvedEnd)) { toast.error("Enter valid delayed times within the same day. Draft kept."); return; }
    if ((resolvedStart || ev.startTime) >= (resolvedEnd || ev.endTime)) { toast.error("The delayed end must be after the delayed start. Draft kept."); return; }
    if (!await delayApi.current("POST", "/delays", {
      eventId: delayFor,
      newTime: resolvedStart || undefined,
      newEndTime: resolvedEnd || undefined,
      reason: delayReason || undefined,
    })) return;
    const deltaMins = resolvedStart ? toMinutes(resolvedStart) - toMinutes(ev.startTime) : (resolvedEnd ? toMinutes(resolvedEnd) - toMinutes(ev.endTime) : 0);
    setLastDelay({ eventId: delayFor, deltaMins, reason: delayReason });
    setDelayFor(null);
    setDelayInput("");
    setDelayEndInput("");
    setDelayReason("");
  };
  const applyDelayToNext = async () => {
    if (!lastDelay) return;
    const idx = events.findIndex(e => e.id === lastDelay.eventId);
    const next = events[idx + 1];
    if (!next) return;
    const newTime = fromMinutes(toMinutes(next.startTime) + lastDelay.deltaMins);
    const newEndTime = fromMinutes(toMinutes(next.endTime) + lastDelay.deltaMins);
    if (!newTime || !newEndTime) { toast.error("This delay would cross midnight. Adjust it manually."); return; }
    if (!await api("POST", "/delays", { eventId: next.id, newTime, newEndTime, reason: lastDelay.reason || undefined })) return;
    setLastDelay({ ...lastDelay, eventId: next.id });
  };

  const addNew = async () => {
    if (!newRow.title || !newRow.startTime || !newRow.endTime) return;
    const startTime = parseTime(newRow.startTime), endTime = parseTime(newRow.endTime);
    if (!startTime || !endTime || startTime >= endTime) { toast.error("Use valid start/end times, ending after the start. Draft kept."); return; }
    if (!await newApi.current("POST", "/schedule", { ...newRow, startTime, endTime })) return;
    setNewRow(emptyScheduleRow);
    setAdding(false);
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
        <button onClick={() => { if (!adding) { newApi.current = api; setNewRow(emptyScheduleRow); } setAdding(!adding); }} className="btn-sm text-sm">
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>
      {(adding || delayFor) && <p className="text-sm text-secondary-label mb-2">Drafts keep the revision from when you opened them. After a conflict, refresh and compare before <button type="button" className="underline" onClick={() => {
        if (window.confirm("Use the refreshed publication as the base for open schedule/delay drafts?")) { newApi.current = api; delayApi.current = api; }
      }}>using the reviewed revision</button>.</p>}
      {events.length === 0 && <p className="text-sm text-tertiary-label">No schedule entries yet. Add the first event above.</p>}
      <div className="space-y-1">
        {visibleEvents.map(ev => {
          const evDelays = byEvent.get(ev.id) ?? [];
          const isEditing = editingId === ev.id;
          return (
            <div key={ev.id}>
              {!events.some(item => item.id === ev.id) && <p role="alert" className="editor-error">This event was removed from the publication. Its open draft is retained here until you close it.</p>}
              <div className={`group card px-4 py-3 relative ${isEditing ? "editing-card" : ""}`}>
                <div className="min-w-0">
                  <Cell label={`Title for ${ev.title}`} value={ev.title} onSave={v => update(ev.id, "title", v)} className="font-semibold text-lg" width="w-full" disabled={!isEditing} />
                  <div className="flex items-center gap-0 text-sm text-tertiary-label mt-0.5">
                    <Cell label={`Start time for ${ev.title}`} value={ev.startTime} onSave={v => saveTime(ev.id, "startTime", v)} format={fmt} mono className="text-sm" disabled={!isEditing} />
                    <span className="shrink-0">–</span>
                    <Cell label={`End time for ${ev.title}`} value={ev.endTime} onSave={v => saveTime(ev.id, "endTime", v)} format={fmt} mono className="text-sm" disabled={!isEditing} />
                    <span className="shrink-0 mx-0.5">·</span>
                    <Cell label={`Location for ${ev.title}`} value={ev.location} onSave={v => update(ev.id, "location", v)} className="text-sm" width="w-full" disabled={!isEditing} />
                  </div>
                  <div hidden={!isEditing} className="mt-2 space-y-2 text-sm">
                    <ChoiceCell label={`Category for ${ev.title}`} value={ev.category} choices={["general", "individual", "team", "ceremony"]} onSave={value => update(ev.id, "category", value)} />
                    <Cell label={`Description for ${ev.title}`} value={ev.description ?? ""} onSave={v => update(ev.id, "description", v)} placeholder="Description (optional)" width="w-full" />
                  </div>
                  {evDelays.length > 0 && (
                    <div className="mt-0.5">
                      {evDelays.map(d => (
                        <div key={d.id} className="flex items-center gap-1.5 text-sm">
                          <span className="text-danger font-medium tabular-nums">
                            → {fmt(d.newTime ?? d.originalTime)}–{fmt(d.newEndTime ?? d.originalEndTime ?? ev.endTime)}
                          </span>
                          {d.reason && <span className="text-tertiary-label">— {d.reason}</span>}
                          <button aria-label={`Remove delay for ${d.eventTitle}`} onClick={() => removeDelay(d)} className="text-danger/60 hover:text-danger px-1 rounded hover:bg-danger/10"><X size={14} weight="bold" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className={`absolute -right-2 -top-2 flex items-center gap-0.5 transition-opacity ${isEditing ? "" : "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"}`}>
                  <button onClick={() => remove(ev)} className="w-7 h-7 rounded-full bg-white shadow-md border border-danger/50 flex items-center justify-center text-danger hover:bg-red-50 transition-colors" title="Delete"><Trash size={14} /></button>
                  <IconSwap id={isEditing ? "editing" : "idle"}>
                    {isEditing ? (
                      <button onClick={() => setEditingId(null)} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-green-600 hover:border-green-300 transition-colors" title="Done"><Check size={14} weight="bold" /></button>
                    ) : (
                      <button onClick={() => { setEditingEvent(ev); setEditingId(ev.id); }} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-tertiary-label hover:text-label hover:border-black/20 transition-colors" title="Edit"><PencilSimple size={14} /></button>
                    )}
                  </IconSwap>
                  <button onClick={() => openDelay(ev)} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-tertiary-label hover:text-label hover:border-black/20 transition-colors" title="Add delay"><Timer size={14} /></button>
                </div>
              </div>

              {/* Delay input */}
              {delayFor === ev.id && (() => {
                const resolvedStart = delayInput ? resolveDelay(delayInput, ev.startTime) : null;
                const resolvedEnd = delayEndInput ? resolveDelay(delayEndInput, ev.endTime) : null;
                const canSubmit = Boolean((resolvedStart || resolvedEnd) && (!delayInput || resolvedStart) && (!delayEndInput || resolvedEnd) && (resolvedStart || ev.startTime) < (resolvedEnd || ev.endTime));
                return (
                  <div className="ml-4 mt-1 card px-4 py-3 border-l-4 border-danger rounded-l-none bg-red-50/50 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-danger font-medium shrink-0">Start</span>
                      <input aria-label={`Delayed start for ${ev.title}`} ref={delayRef} value={delayInput} onChange={e => handleStartChange(e.target.value)} onKeyDown={delayKey}
                        placeholder={`+15m or ${fmt(ev.startTime)}`}
                        className="bg-transparent outline-none tabular-nums text-base font-semibold w-[14ch] h-[36px] border-b border-danger/30 focus:border-danger placeholder:font-normal placeholder:text-tertiary-label/50"
                      />
                      <span className={`text-sm text-danger/70 shrink-0 w-[10ch] tabular-nums ${resolvedStart ? "" : "invisible"}`}>→ {resolvedStart ? fmt(resolvedStart) : ""}</span>
                      <span className="text-sm text-danger font-medium shrink-0">End</span>
                      <input aria-label={`Delayed end for ${ev.title}`} value={delayEndInput} onChange={e => handleEndChange(e.target.value)} onKeyDown={delayKey}
                        placeholder={`+15m or ${fmt(ev.endTime)}`}
                        className="bg-transparent outline-none tabular-nums text-base font-semibold w-[14ch] h-[36px] border-b border-danger/30 focus:border-danger placeholder:font-normal placeholder:text-tertiary-label/50"
                      />
                      <span className={`text-sm text-danger/70 shrink-0 w-[10ch] tabular-nums ${resolvedEnd ? "" : "invisible"}`}>→ {resolvedEnd ? fmt(resolvedEnd) : ""}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input aria-label={`Delay reason for ${ev.title}`} value={delayReason} onChange={e => setDelayReason(e.target.value)} onKeyDown={delayKey}
                        placeholder="reason (optional)"
                        className="bg-transparent outline-none text-sm flex-1 min-w-0 h-[36px] border-b border-danger/30 focus:border-danger placeholder:text-tertiary-label/50"
                      />
                      <button onClick={submitDelay} disabled={!canSubmit} className="btn-sm text-danger min-h-[36px] disabled:opacity-30">Add</button>
                      <button aria-label="Cancel delay draft" onClick={() => setDelayFor(null)} className="btn-sm min-h-[36px]"><X size={16} weight="bold" /></button>
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
              <input aria-label="New event title" ref={titleRef} value={newRow.title} onChange={e => setNewRow(r => ({ ...r, title: e.target.value }))} onKeyDown={newRowKey}
                autoFocus placeholder="New event title..." className="bg-transparent outline-none font-semibold text-lg w-full placeholder:text-tertiary-label/50" />
              <div className="flex items-center gap-1 text-sm text-tertiary-label mt-0.5">
                <input aria-label="New event start time" value={newRow.startTime} onChange={e => setNewRow(r => ({ ...r, startTime: e.target.value }))} onKeyDown={newRowKey}
                  placeholder="start" className="bg-transparent outline-none tabular-nums w-[5ch] placeholder:text-tertiary-label/50" />
                <span>–</span>
                <input aria-label="New event end time" value={newRow.endTime} onChange={e => setNewRow(r => ({ ...r, endTime: e.target.value }))} onKeyDown={newRowKey}
                  placeholder="end" className="bg-transparent outline-none tabular-nums w-[5ch] placeholder:text-tertiary-label/50" />
                <span className="mx-0.5">·</span>
                <input aria-label="New event location" value={newRow.location} onChange={e => setNewRow(r => ({ ...r, location: e.target.value }))} onKeyDown={newRowKey}
                  placeholder="location" className="bg-transparent outline-none flex-1 min-w-0 placeholder:text-tertiary-label/50" />
              </div>
              <label className="block mt-2 text-sm">Category <select aria-label="New event category" value={newRow.category} onChange={e => setNewRow(row => ({ ...row, category: e.target.value as ScheduleEvent["category"] }))}>
                <option value="general">General</option><option value="individual">Individual</option><option value="team">Team</option><option value="ceremony">Ceremony</option>
              </select></label>
              <input aria-label="New event description" value={newRow.description} onChange={e => setNewRow(row => ({ ...row, description: e.target.value }))} onKeyDown={newRowKey} placeholder="Description (optional)" className="w-full mt-2 bg-transparent text-sm" />
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

function AnnouncementsSection({ announcements, api, undo }: {
  announcements: Announcement[]; api: OperationApi; undo: OperationApi;
}) {
  const draftApi = useRef(api);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [scheduleInput, setScheduleInput] = useState("");
  useDraftWarning(adding && Boolean(title || body || scheduleInput));
  const visibleAnnouncements = [...announcements];
  if (editingId && editingAnnouncement && !visibleAnnouncements.some(item => item.id === editingId)) visibleAnnouncements.push(editingAnnouncement);
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
      const date = new Date(scheduleInput);
      if (!Number.isFinite(date.getTime())) { toast.error("Choose a valid schedule date and time. Draft kept."); return; }
      scheduledAt = date.toISOString();
    }
    if (!await draftApi.current("POST", "/announcements", { title, body, priority, scheduledAt })) return;
    setTitle(""); setBody(""); setPriority("normal"); setScheduleInput("");
    setAdding(false);
  };
  const update = async (a: Announcement, field: string, value: string | boolean | null) => {
    return api("PUT", `/announcements/${a.id}`, {
      title: a.title, body: a.body, priority: a.priority,
      pinned: a.pinned ?? false, scheduledAt: a.scheduledAt, [field]: value,
    });
  };
  const remove = async (a: Announcement) => {
    if (!await api("DELETE", `/announcements/${a.id}`)) return;
    setEditingId(null);
    toast(`Deleted "${a.title}"`, {
      action: { label: "Undo", onClick: async () => { await undo("POST", "/announcements", { title: a.title, body: a.body, priority: a.priority, pinned: a.pinned, scheduledAt: a.scheduledAt }); } },
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
        <button onClick={() => { setAdding(!adding); if (!adding) { draftApi.current = api; setTitle(""); setBody(""); setPriority("normal"); setScheduleInput(""); } }} className="btn-sm text-sm">
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {adding && (
        <div className="card px-4 py-4 mb-3 border border-dashed border-tertiary-label/30 space-y-3">
          <div className="flex gap-2">
            <input aria-label="New announcement title" ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} onKeyDown={onKey}
              autoFocus placeholder="Announcement title..." className="bg-transparent outline-none font-semibold text-lg flex-1 placeholder:text-tertiary-label/50" />
            <select aria-label="New announcement priority" value={priority} onChange={e => setPriority(e.target.value as "normal" | "urgent")}
              className={`bg-transparent outline-none text-sm ${priority === "urgent" ? "text-danger font-semibold" : "text-tertiary-label"}`}>
              <option value="normal">normal</option>
              <option value="urgent">urgent</option>
            </select>
          </div>
          <div className="flex gap-2 items-end">
            <textarea aria-label="New announcement body" value={body} onChange={e => setBody(e.target.value)} onKeyDown={onKey} onInput={autoGrow}
              placeholder="Body text..." rows={1}
              className="bg-transparent outline-none text-base flex-1 resize-none placeholder:text-tertiary-label/50" />
            <button onClick={add} disabled={!title || !body}
              className="btn-sm opacity-60 disabled:opacity-20 transition-opacity shrink-0" title="Post (Cmd+Enter)">
              {scheduleInput ? "Schedule" : "Post"}
            </button>
          </div>
          <label className="block text-sm text-tertiary-label">Schedule date and time (optional, your browser's zone: {Intl.DateTimeFormat().resolvedOptions().timeZone})
            <input type="datetime-local" value={scheduleInput} onChange={e => setScheduleInput(e.target.value)} onKeyDown={onKey}
              className="block w-full mt-1 bg-transparent outline-none tabular-nums" />
          </label>
          <p className="text-sm text-secondary-label">Leave empty to post now. Ctrl/Cmd+Enter to submit. Scheduled posts stay private until due.</p>
          <p className="text-sm text-secondary-label">Drafts keep their original revision. After a conflict, refresh and compare before <button type="button" className="underline" onClick={() => {
            if (window.confirm("Use the refreshed publication as the base for this announcement draft?")) draftApi.current = api;
          }}>using the reviewed revision</button>.</p>
        </div>
      )}

      <div className="space-y-1">
        {visibleAnnouncements.map(a => (
          <div key={a.id} className={`group card px-4 py-3 relative ${
            editingId === a.id ? "editing-card" :
            a.priority === "urgent" ? "border-l-4 border-danger rounded-l-none" :
            isFuture(a) ? "border-l-4 border-berkeley-blue/40 rounded-l-none opacity-70" : ""
          }`}>
            <div className="min-w-0">
              {!announcements.some(item => item.id === a.id) && <p role="alert" className="editor-error">This announcement was removed. Its open draft is retained until you close it.</p>}
              <div className="flex items-center gap-2">
                <Cell label={`Title for ${a.title}`} value={a.title} onSave={v => update(a, "title", v)} className={`font-semibold text-lg ${a.priority === "urgent" ? "text-danger" : ""}`} width="w-full" disabled={editingId !== a.id} />
                {a.pinned && <span className="text-sm shrink-0">Pinned</span>}
                {isFuture(a) && <span className="text-xs font-medium text-berkeley-blue bg-berkeley-blue/10 px-2 py-0.5 rounded-full shrink-0">Scheduled</span>}
              </div>
              <div hidden={editingId !== a.id}>
                <Cell label={`Body for ${a.title}`} value={a.body} onSave={v => update(a, "body", v)} className="text-sm text-secondary-label mt-1" width="w-full" />
              </div>
              {editingId !== a.id && (
                <div className="text-sm text-secondary-label mt-1 prose-sm">
                  <Markdown remarkPlugins={[remarkGfm]} skipHtml>{a.body}</Markdown>
                </div>
              )}
              {editingId === a.id && <div className="flex flex-wrap gap-3 items-center mt-2 text-sm">
                <ChoiceCell label={`Priority for ${a.title}`} value={a.priority} choices={["normal", "urgent"]} onSave={value => update(a, "priority", value)} />
                <button type="button" className="btn-sm" onClick={() => { void update(a, "pinned", !a.pinned); }}>{a.pinned ? "Unpin" : "Pin"}</button>
                {isFuture(a) && <button type="button" className="btn-sm" onClick={() => { if (window.confirm("Publish this scheduled announcement now?")) void update(a, "scheduledAt", null); }}>Publish now</button>}
              </div>}
              <p className="text-xs text-tertiary-label mt-1.5">
                {isFuture(a)
                  ? <>Publishes {new Date(a.scheduledAt!).toLocaleString()}</>
                  : new Date(a.scheduledAt ?? a.timestamp).toLocaleString()
                }
              </p>
            </div>
            <div className={`absolute -right-2 -top-2 flex items-center gap-0.5 transition-opacity ${editingId === a.id ? "" : "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"}`}>
              <button onClick={() => remove(a)} className="w-7 h-7 rounded-full bg-white shadow-md border border-danger/50 flex items-center justify-center text-danger hover:bg-red-50 transition-colors" title="Delete"><Trash size={14} /></button>
              <IconSwap id={editingId === a.id ? "editing" : "idle"}>
                {editingId === a.id ? (
                  <button onClick={() => setEditingId(null)} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-green-600 hover:border-green-300 transition-colors" title="Done"><Check size={14} weight="bold" /></button>
                ) : (
                  <button onClick={() => { setEditingAnnouncement(a); setEditingId(a.id); }} className="w-7 h-7 rounded-full bg-white shadow-md border border-black/10 flex items-center justify-center text-tertiary-label hover:text-label hover:border-black/20 transition-colors" title="Edit"><PencilSimple size={14} /></button>
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
  const { can } = useStaff();
  const { data, error, refresh, mutate, pending } = useAdminData();
  const scopedApi: OperationApi = (method, path, body) => mutate(method, path, body, data?.operationRevision);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === ".") { e.preventDefault(); refresh(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [refresh]);

  if (error && !data) return (
    <div className="max-w-4xl mx-auto px-6 py-12 text-center">
      <h1 className="text-xl font-bold text-danger mb-2">Connection Error</h1>
      <p className="text-secondary-label mb-4">{error}</p>
      <button type="button" className="btn-secondary" onClick={() => { void refresh(); }}>Retry loading staff data</button>
    </div>
  );

  if (!data) return (
    <div className="max-w-4xl mx-auto px-6 py-12 text-center">
      <p className="text-secondary-label">Loading...</p>
    </div>
  );

  return (
    <div className="staff-operations">
      <p className="staff-muted">Manage the schedule and live updates. Preview timing changes before publishing.</p>
      {error && <p role="alert" className="editor-error mb-4">{error} Existing editors and failed drafts are kept below.</p>}
      <div className="flex flex-wrap gap-3 items-center mb-6">
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => { void refresh(); }}>Refresh published values</button>
        <span role="status" className="text-sm text-secondary-label">{pending ? "Waiting for server confirmation…" : "Refresh does not discard open drafts."}</span>
      </div>
      <div className="space-y-12">
        {can('schedule:write') && <SchedulePlanner events={data.schedule} onPublish={refresh} />}
        <fieldset disabled={pending} className="space-y-12 min-w-0">
          <legend className="sr-only">Schedule, delays and announcements</legend>
          {can('schedule:write') && <ScheduleSection events={data.schedule} delays={data.delays} api={scopedApi} undo={mutate} />}
          <fieldset disabled={!can('updates:write')} className="min-w-0"><legend className="sr-only">Updates editor</legend><AnnouncementsSection announcements={data.announcements} api={scopedApi} undo={mutate} /></fieldset>
        </fieldset>
        {can('publishing:write') && <details className="staff-publishing-details"><summary>Publication history & recovery</summary><PublishingPanel request={mutate} disabled={pending} revision={data.operationRevision} /></details>}
      </div>
    </div>
  );
}
