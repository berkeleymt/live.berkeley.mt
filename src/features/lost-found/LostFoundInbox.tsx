import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { contactHref, LostFoundRequestError, lostFoundRequest, requestMessage } from "./api";
import type { LostFoundReport, ReportPage, ReportStatus } from "./types";
import "./lost-found.css";
import { useStaff } from '../staff';

const statuses: ReportStatus[] = ["new", "found", "contacted", "resolved"];
const labels: Record<ReportStatus, string> = { new: "New", found: "Found", contacted: "Contacted", resolved: "Resolved" };
const when = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) + " Pacific";
interface Filters { q: string; kind: string; status: string; offset: number }
const initialFilters: Filters = { q: "", kind: "", status: "", offset: 0 };

/** Backend permissions remain authoritative. `canWrite` only controls affordances. */
export function LostFoundInbox({ canWrite = false }: { canWrite?: boolean }) {
  const { request } = useStaff();
  const [page, setPage] = useState<ReportPage | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [queryDraft, setQueryDraft] = useState(initialFilters);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const onEditing = useCallback((value: boolean) => setEditing(value), []);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: "20", offset: String(filters.offset) });
    if (filters.q) query.set("q", filters.q);
    if (filters.kind) query.set("kind", filters.kind);
    if (filters.status) query.set("status", filters.status);
    void lostFoundRequest<ReportPage>(`/staff?${query}`, { signal: controller.signal }, request).then((next) => {
      if (controller.signal.aborted) return;
      setPage(next);
      setSelected(null);
      setEditing(false);
      setBusy(false);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setError(requestMessage(error, "Could not load the private inbox. Check your connection and retry."));
      setBusy(false);
    });
    return () => controller.abort();
  }, [filters, refresh, request]);
  function reload(next = filters) {
    setBusy(true);
    setError("");
    setMessage("");
    setFilters(next);
    setRefresh((value) => value + 1);
  }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); reload({ ...queryDraft, q: queryDraft.q.trim(), offset: 0 }); }
  function saved(report: LostFoundReport) {
    setPage((current) => current && { ...current, reports: current.reports.map((item) => item.id === report.id ? report : item) });
    setEditing(false);
    setMessage("Status and private notes saved. No email was sent by this website. Refresh to reapply your filters.");
  }
  return <section className="lf-inbox" aria-labelledby="lf-inbox-heading">
    <header className="lf-inbox-header"><div><h1 id="lf-inbox-heading">Lost & found</h1><p>Private reports · for authorized tournament staff only</p></div><button type="button" className="btn-secondary" disabled={busy || editing} onClick={() => reload()}>{busy ? "Loading…" : "Refresh inbox"}</button></header>
    <p className="lf-muted">Match identifying details with the owner before returning an item. Opening an email draft does not send it. Mark “Contacted” only after you have actually reached out.</p>
    {!canWrite && <p className="lf-privacy">Your role can view reports. Updating status and notes requires lost-and-found write access.</p>}
    {page?.demoMode && <p className="lf-privacy">Demo mode is enabled. Reports labeled “Synthetic demo” are fictional; never email their example.invalid addresses.</p>}
    <form className="lf-filters" onSubmit={search}>
      <fieldset disabled={busy || editing}>
        <div><label htmlFor="lf-search">Search reports</label><input id="lf-search" className="input" type="search" maxLength={100} placeholder="Item, location, contact, or receipt" value={queryDraft.q} onChange={(e) => setQueryDraft((value) => ({ ...value, q: e.target.value }))} /></div>
        <div><label htmlFor="lf-kind-filter">Report type</label><select id="lf-kind-filter" className="input" value={queryDraft.kind} onChange={(e) => setQueryDraft((value) => ({ ...value, kind: e.target.value }))}><option value="">All types</option><option value="lost">Lost</option><option value="found">Found</option></select></div>
        <div><label htmlFor="lf-status-filter">Status</label><select id="lf-status-filter" className="input" value={queryDraft.status} onChange={(e) => setQueryDraft((value) => ({ ...value, status: e.target.value }))}><option value="">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{labels[status]}</option>)}</select></div>
        <button type="submit" className="btn-secondary">Apply filters</button>
        <button type="button" className="btn-secondary" onClick={() => { setQueryDraft(initialFilters); reload(initialFilters); }}>Clear filters</button>
      </fieldset>
    </form>
    {editing && <p className="lf-hint" role="status">Save or discard this report’s changes before searching, refreshing, or moving to another report.</p>}
    {error && <div className="lf-error" role="alert"><p>{error}</p><button type="button" className="btn-secondary" disabled={busy || editing} onClick={() => reload()}>Retry loading inbox</button></div>}
    {message && <p className="lf-success" role="status">{message}</p>}
    {busy && <p role="status">Loading private reports…</p>}
    {!busy && !error && page && <>
      <p className="lf-count">{page.total === 0 ? "No matching reports" : page.reports.length === 0 ? `${page.total} matching reports; none on this page` : `${page.offset + 1}–${page.offset + page.reports.length} of ${page.total} reports`}</p>
      {page.reports.length === 0 ? <div className="lf-empty"><h2>No reports on this page</h2><p>{filters.q || filters.kind || filters.status ? "Try clearing the filters or search for another item." : "New public submissions will appear here. Refresh the inbox to check again."}</p></div> : <ul className="lf-report-list" aria-label="Private lost-and-found reports">
        {page.reports.map((report) => <li key={report.id}>
          <button type="button" className="lf-report-summary" aria-expanded={selected === report.id} aria-controls={`report-${report.id}`} disabled={editing} onClick={() => { if (editing) return; setSelected(selected === report.id ? null : report.id); setMessage(""); }}>
            <span className="lf-report-type">{report.kind === "lost" ? "Lost" : "Found"}{report.synthetic && <span className="lf-demo-label">Synthetic demo</span>}</span>
            <span className="lf-report-item">{report.description}</span>
            <span className="lf-report-meta">{report.location} · {report.occurredAt}</span>
            <span className="lf-status-label">{labels[report.status]} · {selected === report.id ? "Close report" : "Open report"}</span>
          </button>
          {selected === report.id && <div id={`report-${report.id}`} className="lf-report-detail"><ReportEditor key={`${report.id}-${report.revision}`} report={report} canWrite={canWrite} onSaved={saved} onEditing={onEditing} /></div>}
        </li>)}
      </ul>}
      <nav className="lf-pagination" aria-label="Inbox pagination"><button type="button" className="btn-secondary" disabled={busy || editing || page.offset === 0} onClick={() => reload({ ...filters, offset: Math.max(0, page.offset - page.limit) })}>Previous page</button><span>20 reports per page</span><button type="button" className="btn-secondary" disabled={busy || editing || page.offset + page.limit >= page.total || page.offset + page.limit > 10_000} onClick={() => reload({ ...filters, offset: page.offset + page.limit })}>Next page</button></nav>
    </>}
  </section>;
}

function ReportEditor({ report, canWrite, onSaved, onEditing }: {
  report: LostFoundReport;
  canWrite: boolean;
  onSaved: (report: LostFoundReport) => void;
  onEditing: (editing: boolean) => void;
}) {
  const { request } = useStaff();
  const [status, setStatus] = useState(report.status);
  const [notes, setNotes] = useState(report.notes);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<string | null>(null);
  const inFlight = useRef(false);
  const dirty = notes !== report.notes || status !== report.status;
  useEffect(() => {
    onEditing(dirty || busy || uncertain);
    return () => onEditing(false);
  }, [dirty, busy, uncertain, onEditing]);
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uncertain]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !canWrite || (!dirty && !uncertain)) return;
    inFlight.current = true; setBusy(true); setError("");
    const body = attempt.current || JSON.stringify({ idempotencyKey: crypto.randomUUID(), revision: report.revision, status, notes });
    attempt.current = body;
    try {
      const updated = await lostFoundRequest<LostFoundReport>(`/staff/${report.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body }, request);
      attempt.current = null; setUncertain(false); onSaved(updated);
    } catch (error) {
      const rejection = error instanceof LostFoundRequestError && [400, 401, 403, 404, 409, 413, 422, 429].includes(error.status);
      if (rejection) attempt.current = null;
      setUncertain(!rejection);
      setError(requestMessage(error, "Could not confirm the update. Retry the same update; your notes and request key are still here."));
    } finally { inFlight.current = false; setBusy(false); }
  }
  const prefix = `lf-edit-${report.id}`;
  return <>
    <dl className="lf-details">
      <div><dt>Item description</dt><dd className="lf-note-text">{report.description}</dd></div>
      <div><dt>Where and when</dt><dd>{report.location}<br />{report.occurredAt}</dd></div>
      <div><dt>Contact</dt><dd>{report.name || "Name not provided"}<br />{report.email}</dd></div>
      <div><dt>Receipt</dt><dd><code className="lf-receipt">{report.receipt}</code></dd></div>
      <div><dt>Reported</dt><dd>{when(report.createdAt)}</dd></div>
      <div><dt>Last updated</dt><dd>{when(report.updatedAt)}</dd></div>
    </dl>
    {report.synthetic ? <p className="lf-hint">Synthetic fixture: contact action disabled. Submit your own report to demonstrate real email-draft handling.</p> : <a className="lf-contact" href={contactHref(report)}>Open email draft to contact reporter</a>}
    <p className="lf-hint">Uses your email app. Nothing is sent automatically, and changing status does not send a message.</p>
    <form className="lf-form" onSubmit={save} aria-busy={busy}>
      <fieldset disabled={busy || uncertain || !canWrite}>
        <label htmlFor={`${prefix}-status`}>Report status</label><select id={`${prefix}-status`} className="input" value={status} onChange={(e) => { setStatus(e.target.value as ReportStatus); setError(""); }}>{statuses.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select>
        <p className="lf-hint">New → Found when an item is located; Contacted after you reach out; Resolved after return or closure. You can correct a status later.</p>
        <label htmlFor={`${prefix}-notes`}>Private staff notes</label><textarea id={`${prefix}-notes`} className="input" rows={4} maxLength={4000} value={notes} onChange={(e) => { setNotes(e.target.value); setError(""); }} /><p className="lf-hint">Up to 4000 characters. Private notes and every status change are retained in the staff audit history.</p>
      </fieldset>
      {error && <p className="lf-error" role="alert">{error}</p>}
      {uncertain && <p className="lf-hint">Editing and discard are paused until this update is confirmed. Retry keeps the same request key.</p>}
      {canWrite && <div className="lf-actions"><button type="button" className="btn-secondary" disabled={busy || uncertain || !dirty} onClick={() => { setNotes(report.notes); setStatus(report.status); setError(""); attempt.current = null; }}>Discard changes</button><button type="submit" className="btn-primary" disabled={busy || (!dirty && !uncertain)}>{busy ? "Saving…" : uncertain ? "Retry same update" : "Save status and notes"}</button></div>}
    </form>
    <details className="lf-history"><summary>Status history · latest 20 changes</summary>{report.history.length ? <ol>{report.history.map((entry) => <li key={entry.revision}><p>{labels[entry.fromStatus || "new"]} → {labels[entry.status]} · {when(entry.at)} · {entry.actor}</p>{entry.notes && <p className="lf-note-text">{entry.notes}</p>}</li>)}</ol> : <p>No staff changes yet. This report was submitted with status New.</p>}</details>
  </>;
}
export default LostFoundInbox;
