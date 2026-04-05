import { useState, useEffect, useCallback } from "react";
import type { LiveData, ScheduleEvent, DelayNotice, Announcement } from "./data/types";

const API = import.meta.env.VITE_API_URL?.replace(/\/live$/, "") ?? "/api";

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

// ── Helpers ──

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
}

// ── Schedule Section ──

function ScheduleSection({ events, onUpdate }: { events: ScheduleEvent[]; onUpdate: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<ScheduleEvent>>({});
  const [adding, setAdding] = useState(false);

  const startEdit = (ev: ScheduleEvent) => {
    setEditing(ev.id);
    setForm(ev);
  };

  const save = async () => {
    if (!editing) return;
    await fetch(`${API}/schedule/${editing}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setEditing(null);
    onUpdate();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this event?")) return;
    await fetch(`${API}/schedule/${id}`, { method: "DELETE" });
    onUpdate();
  };

  const addNew = async () => {
    await fetch(`${API}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setAdding(false);
    setForm({});
    onUpdate();
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Schedule</h2>
        <button onClick={() => { setAdding(true); setForm({ category: "general" }); }} className="btn-primary">
          + Add Event
        </button>
      </div>

      {(adding || editing) && (
        <div className="card mb-4 p-4 border-2 border-berkeley-blue">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Title" value={form.title ?? ""} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="input col-span-2" />
            <input placeholder="Start (HH:mm)" value={form.startTime ?? ""} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className="input" />
            <input placeholder="End (HH:mm)" value={form.endTime ?? ""} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} className="input" />
            <input placeholder="Location" value={form.location ?? ""} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="input" />
            <select value={form.category ?? "general"} onChange={e => setForm(f => ({ ...f, category: e.target.value as ScheduleEvent["category"] }))} className="input">
              <option value="general">General</option>
              <option value="team">Team</option>
              <option value="individual">Individual</option>
              <option value="ceremony">Ceremony</option>
            </select>
            <textarea placeholder="Description" value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input col-span-2" rows={2} />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={editing ? save : addNew} className="btn-primary">{editing ? "Save" : "Create"}</button>
            <button onClick={() => { setEditing(null); setAdding(false); }} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {events.map(ev => (
          <div key={ev.id} className="card p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[15px]">{ev.title}</p>
              <p className="text-[13px] text-tertiary-label tabular-nums">
                {formatTime(ev.startTime)} – {formatTime(ev.endTime)} · {ev.location}
              </p>
            </div>
            <button onClick={() => startEdit(ev)} className="btn-sm">Edit</button>
            <button onClick={() => remove(ev.id)} className="btn-sm btn-danger">Delete</button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Delays Section ──

function DelaysSection({ delays, events, onUpdate }: { delays: DelayNotice[]; events: ScheduleEvent[]; onUpdate: () => void }) {
  const [adding, setAdding] = useState(false);
  const [eventId, setEventId] = useState("");
  const [newTime, setNewTime] = useState("");
  const [reason, setReason] = useState("");

  const add = async () => {
    await fetch(`${API}/delays`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, newTime, reason: reason || undefined }),
    });
    setAdding(false);
    setEventId("");
    setNewTime("");
    setReason("");
    onUpdate();
  };

  const remove = async (id: string) => {
    await fetch(`${API}/delays/${id}`, { method: "DELETE" });
    onUpdate();
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Delays</h2>
        <button onClick={() => setAdding(true)} className="btn-primary">+ Add Delay</button>
      </div>

      {adding && (
        <div className="card mb-4 p-4 border-2 border-danger">
          <div className="grid grid-cols-2 gap-3">
            <select value={eventId} onChange={e => setEventId(e.target.value)} className="input col-span-2">
              <option value="">Select event...</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.title} ({formatTime(ev.startTime)})</option>
              ))}
            </select>
            <input placeholder="New time (HH:mm)" value={newTime} onChange={e => setNewTime(e.target.value)} className="input" />
            <input placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} className="input" />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={add} className="btn-primary" disabled={!eventId || !newTime}>Create Delay</button>
            <button onClick={() => setAdding(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {delays.length === 0 ? (
        <p className="text-tertiary-label text-[14px]">No active delays.</p>
      ) : (
        <div className="space-y-2">
          {delays.map(d => (
            <div key={d.id} className="card p-3 flex items-center gap-3 border-l-4 border-danger">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[15px]">{d.eventTitle}</p>
                <p className="text-[13px] tabular-nums">
                  <span className="text-danger line-through">{formatTime(d.originalTime)}</span>
                  <span className="text-tertiary-label mx-1">→</span>
                  <span className="font-semibold">{formatTime(d.newTime)}</span>
                </p>
                {d.reason && <p className="text-[12px] text-tertiary-label">{d.reason}</p>}
              </div>
              <button onClick={() => remove(d.id)} className="btn-sm btn-danger">Remove</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Announcements Section ──

function AnnouncementsSection({ announcements, onUpdate }: { announcements: Announcement[]; onUpdate: () => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");

  const add = async () => {
    await fetch(`${API}/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, priority }),
    });
    setAdding(false);
    setTitle("");
    setBody("");
    setPriority("normal");
    onUpdate();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this announcement?")) return;
    await fetch(`${API}/announcements/${id}`, { method: "DELETE" });
    onUpdate();
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Announcements</h2>
        <button onClick={() => setAdding(true)} className="btn-primary">+ Post</button>
      </div>

      {adding && (
        <div className="card mb-4 p-4 border-2 border-berkeley-blue">
          <div className="space-y-3">
            <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} className="input w-full" />
            <textarea placeholder="Body (markdown supported)" value={body} onChange={e => setBody(e.target.value)} className="input w-full" rows={3} />
            <select value={priority} onChange={e => setPriority(e.target.value)} className="input">
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={add} className="btn-primary" disabled={!title || !body}>Post</button>
            <button onClick={() => setAdding(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {announcements.map(a => (
          <div key={a.id} className={`card p-3 flex items-start gap-3 ${a.priority === "urgent" ? "border-l-4 border-danger" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={`font-semibold text-[15px] ${a.priority === "urgent" ? "text-danger" : ""}`}>
                  {a.title}
                </p>
                {a.pinned && <span className="text-[11px]">📌</span>}
              </div>
              <p className="text-[13px] text-secondary-label mt-0.5 line-clamp-2">{a.body}</p>
              <p className="text-[11px] text-tertiary-label mt-1">{new Date(a.timestamp).toLocaleString()}</p>
            </div>
            <button onClick={() => remove(a.id)} className="btn-sm btn-danger shrink-0">Delete</button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Main Admin Page ──

export default function Admin() {
  const { data, error, refresh } = useAdminData();

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-danger mb-2">Connection Error</h1>
        <p className="text-secondary-label mb-4">{error}</p>
        <p className="text-[13px] text-tertiary-label">
          Make sure the server is running: <code className="bg-bg px-2 py-0.5 rounded">cd server && cargo run</code>
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-secondary-label">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-20">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">BmMT Admin</h1>
          <p className="text-[13px] text-tertiary-label mt-0.5">
            Changes sync to the live site in real time.
          </p>
        </div>
        <a href="/" className="btn-secondary text-[13px]">← Live Site</a>
      </div>

      <div className="space-y-10">
        <ScheduleSection events={data.schedule} onUpdate={refresh} />
        <DelaysSection delays={data.delays} events={data.schedule} onUpdate={refresh} />
        <AnnouncementsSection announcements={data.announcements} onUpdate={refresh} />
      </div>
    </div>
  );
}
