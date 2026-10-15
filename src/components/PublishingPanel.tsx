import { useCallback, useEffect, useRef, useState } from "react";
import { useStaff } from '../features/staff';

const API = import.meta.env.VITE_API_URL?.replace(/\/live$/, "") ?? "/api";

type PublicationStatus = {
  mode: "git" | "sqlite";
  revision?: string;
  head?: string | null;
  branch?: string;
  dirty?: boolean | null;
  locked?: boolean | null;
  healthy?: boolean;
  issues?: { kind: string; message: string }[];
  lastFailure?: string | null;
  lastPush?: { ok: boolean; revision: string; verifiedAt?: string; error?: string } | null;
  history?: { revision: string; date: string; message: string }[];
};
type Request = (method: string, path: string, body?: unknown, expected?: string) => Promise<boolean>;

export function PublishingPanel({ request, disabled, revision }: {
  request: Request; disabled: boolean; revision?: string;
}) {
  const { request: transport } = useStaff();
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await transport(`${API}/publishing`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Cannot load publication status (HTTP ${response.status}). Sign in as authorized staff and retry.`);
      setStatus(await response.json());
      setConfirmed(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Cannot load publication status. Retry shortly.");
    } finally { setBusy(false); inFlight.current = false; }
  }, [transport]);
  useEffect(() => { void load(); }, [load, revision]);

  async function act(kind: "push" | "restore") {
    if (inFlight.current || disabled || !status) return;
    const expected = kind === "restore" ? status.head : status.revision;
    if (!expected || (kind === "restore" && (!target || !confirmed))) return;
    inFlight.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const ok = await request("POST", `/publishing/${kind}`, kind === "restore" ? { revision: target } : undefined, expected);
      if (!ok) {
        setError(kind === "push" ? "Push was not confirmed. Local publication is unchanged; do not assume a remote backup exists. Refresh status before retrying." : "Restore was not confirmed. Selection is kept; refresh and check the public revision before retrying.");
      } else {
        setMessage(kind === "push" ? "The server verified this revision at origin after pushing. This is a point-in-time check, not continuous remote monitoring." : "Restore completed locally. It does not reset branch history or push to the remote.");
        setConfirmed(false);
      }
    } finally {
      setBusy(false); inFlight.current = false;
    }
    // Reload diagnostics after failures too; keep the failure message visible.
    if (!inFlight.current) {
      inFlight.current = true;
      setBusy(true);
      try {
        const response = await transport(`${API}/publishing`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error("Status could not be refreshed. Use Refresh publication status.");
        setStatus(await response.json());
        setConfirmed(false);
      } catch (error) {
        setError(current => `${current} ${error instanceof Error ? error.message : "Status is unavailable."}`.trim());
      } finally { setBusy(false); inFlight.current = false; }
    }
  }

  async function download() {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await transport(`${API}/publishing/export`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Export failed (HTTP ${response.status}). Nothing downloaded.`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "operations.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Downloaded the published schedule, delays and all updates (including scheduled updates). This export contains no subscribers, staff accounts or student records. Handle scheduled editorial drafts as staff-only until published.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Export failed. Retry shortly.");
    } finally { setBusy(false); inFlight.current = false; }
  }

  const locked = disabled || busy;
  return <section className="event-editor" aria-labelledby="publishing-heading">
    <h2 id="publishing-heading">Schedule & update publishing</h2>
    <p>Local publication and remote backup are separate actions. In the complete Git demo, each commit versions schedule, delays, updates, event details, site/guide copy and room directions together. Private reports, accounts and rosters are never exported. Uploaded media needs a separate backup.</p>
    {error && <p className="editor-error" role="alert">{error}</p>}
    <p role="status">{busy ? "Checking with the server…" : message || (!status ? "Publication status not loaded." : "")}</p>
    <div className="editor-actions">
      <button type="button" className="btn-secondary" disabled={locked} onClick={() => { void load(); }}>Refresh publication status</button>
      <button type="button" className="btn-secondary" disabled={locked} onClick={() => { void download(); }}>Download operations.json</button>
    </div>
    {status?.mode === "sqlite" && <p>SQLite mode (default). Changes remain in this server's database. To migrate, download the JSON, validate and commit it in a dedicated content checkout, then configure LIVE_CONTENT_REPO. Git history and remote backup are not enabled here.</p>}
    {status?.mode === "git" && <>
      <dl className="text-sm space-y-2 my-4">
        <div><dt className="font-semibold">Published locally</dt><dd className="break-all">{status.revision}</dd></div>
        <div><dt className="font-semibold">Checkout HEAD · {status.branch}</dt><dd className="break-all">{status.head ?? "Unavailable"}</dd></div>
      </dl>
      {status.healthy ? <p>The committed local publication is current and the checkout is clean. Other public pages update on their next refresh.</p> : <div className="editor-caution">
        <p>Publishing is blocked or awaiting a valid commit. The public page keeps its last valid committed snapshot.</p>
        <ul>{status.issues?.map(issue => <li key={issue.kind}>{issue.message}</li>)}</ul>
        <p>Keep browser drafts. Review and commit file/index edits on the server; never reset, discard edits or switch branches to clear this warning. A clean invalid HEAD can be repaired with a confirmed restore below.</p>
      </div>}
      {status.lastFailure && <p className="editor-caution">Last failed save: {status.lastFailure}</p>}
      <h3>Remote backup</h3>
      <p>{status.lastPush?.ok
        ? `Verified revision ${status.lastPush.revision.slice(0, 12)} at origin on ${status.lastPush.verifiedAt}. ${status.lastPush.revision !== status.revision ? "The current local publication has not been verified remotely." : "Remote changes after that check are not monitored."}`
        : status.lastPush ? "The last push failed or was not verified. Do not assume remote backup succeeded." : "No remote backup has been verified in this server session. Local Git history alone is not a remote backup."}</p>
      <button type="button" className="btn-secondary" disabled={locked || Boolean(error) || !status.healthy} onClick={() => { void act("push"); }}>Push current publication to origin & verify</button>
      <h3>Restore from local history</h3>
      <p>A restore validates operations.json and creates a new commit on the same branch. It replaces the schedule, delays, updates and any bundled editorial documents, may make old scheduled announcements visible if their time has passed, and does not retract email already sent. Email deduplication still applies to previously sent announcement IDs.</p>
      <label className="block my-3">Revision to restore
        <select className="block w-full min-w-0 mt-1" value={target} disabled={locked} onChange={e => { setTarget(e.target.value); setConfirmed(false); }}>
          <option value="">Select a previous publication…</option>
          {status.history?.map(item => <option key={item.revision} value={item.revision}>{item.revision.slice(0, 8)} · {item.date.slice(0, 10)} · {item.message.slice(0, 80)}</option>)}
        </select>
      </label>
      {status.history?.length === 0 && <p>No operation-file history available.</p>}
      <label className="flex items-start gap-2 my-3"><input type="checkbox" checked={confirmed} disabled={locked || !target} onChange={e => setConfirmed(e.target.checked)} />I reviewed the selected revision and understand this replaces the current schedule, delays and announcements.</label>
      <button type="button" className="btn-secondary" disabled={locked || Boolean(error) || !confirmed || !target || status.dirty !== false || status.locked !== false || !status.head} onClick={() => { void act("restore"); }}>Restore selected revision locally</button>
      <p className="text-sm text-secondary-label mt-3">Identical content is a no-op (no empty commit). History shows the latest 15 changes to operations.json. Only valid commits in this branch's history can be restored.</p>
    </>}
  </section>;
}
