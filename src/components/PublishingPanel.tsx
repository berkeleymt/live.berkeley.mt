import { useCallback, useEffect, useRef, useState } from "react";
import { useStaff } from '../features/staff';

const API = import.meta.env.VITE_API_URL?.replace(/\/live$/, "") ?? "/api";

type PublicationStatus = {
  mode: "git" | "sqlite" | "remote";
  remoteRevision?: string | null;
  pendingRevision?: string | null;
  checkedAt?: string | null;
  digest?: string;
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
  const { request: transport, can } = useStaff();
  const [configuration, setConfiguration] = useState<string | null>(null);
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

  async function act(kind: "push" | "restore" | "sync" | "archive") {
    if (inFlight.current || disabled || !status) return;
    const expected = kind === "restore" ? status.head : status.mode === 'remote' && kind !== 'sync' ? status.pendingRevision : status.revision;
    if (kind === 'archive' && !window.confirm('Retain this draft in server Git history and clear the pending slot? Download its JSON first. This does not publish or merge the draft.')) return;
    if (!expected || (kind === "restore" && (!target || !confirmed))) return;
    inFlight.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const ok = await request("POST", `/publishing/${kind}`, kind === "restore" ? { revision: target } : undefined, expected);
      if (!ok) {
        setError(status.mode === 'remote' ? 'Remote publication was not confirmed. Keep browser drafts and refresh status before retrying. A retained draft may need an authorized external merge if branch rules or another commit block it.' : kind === "push" ? "Push was not confirmed. Local publication is unchanged; do not assume a remote backup exists. Refresh status before retrying." : "Restore was not confirmed. Selection is kept; refresh and check the public revision before retrying.");
      } else {
        setMessage(status.mode === 'remote' ? kind === 'archive' ? 'Draft retained in server Git history, not published. Reconcile your downloaded draft with the latest content before saving again.' : kind === 'sync' ? 'Remote checked. The loaded revision below is the last validated public bundle.' : 'Remote confirmed and the complete validated bundle loaded. Public pages update on their next refresh.' : kind === "push" ? "The server verified this revision at origin after pushing. This is a point-in-time check, not continuous remote monitoring." : "Restore completed locally. It does not reset branch history or push to the remote.");
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

  async function showConfiguration() {
    if (inFlight.current || disabled || !can('settings:write')) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await transport(`${API}/settings/publication`);
      if (!response.ok) throw new Error('Publication configuration is available only to Super admins. Refresh your session and retry.');
      const value = await response.json();
      setConfiguration(`${value.configuration} ${value.protection ?? ''}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Configuration unavailable. Retry shortly.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function download(pending = false) {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await transport(`${API}/publishing/${pending ? 'pending' : 'export'}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Export failed (HTTP ${response.status}). Nothing downloaded.`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = pending ? 'retained-publication.json' : 'operations.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(pending ? 'Downloaded the retained draft JSON, not a live publication. Media bytes stay in the retained Git commit; ask a Super to export those for an external merge.' : "Downloaded the loaded schedule, delays, updates and bundled editorial documents. This JSON is not a complete media backup or a ready-to-import remote bundle. It contains no subscribers, staff accounts or student records. Handle scheduled editorial drafts as staff-only until published.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Export failed. Retry shortly.");
    } finally { setBusy(false); inFlight.current = false; }
  }

  const locked = disabled || busy;
  return <section className="event-editor" aria-labelledby="publishing-heading">
    <h2 id="publishing-heading">Public content publishing</h2>
    <p>{status?.mode === 'remote' ? 'GitHub-authoritative mode: staff saves and direct file commits use one validated bundle for schedule, updates, event details, site, directions and media. Only a remote-confirmed valid bundle becomes live. No application rebuild is needed for content-only changes.' : 'Compatibility mode: local publication and remote backup are separate actions. Git commits include schedule, updates and bundled editorial documents; uploaded media needs a separate backup.'} Private reports, accounts and rosters are never exported.</p>
    {error && <p className="editor-error" role="alert">{error}</p>}
    <p role="status">{busy ? "Checking with the server…" : message || (!status ? "Publication status not loaded." : "")}</p>
    <div className="editor-actions">
      <button type="button" className="btn-secondary" disabled={locked} onClick={() => { void load(); }}>Refresh publication status</button>
      <button type="button" className="btn-secondary" disabled={locked} onClick={() => { void download(); }}>Download operations.json</button>
    </div>
    {status?.mode === "sqlite" && <p>SQLite mode (default). Changes remain in this server's database. To migrate, download the JSON, validate and commit it in a dedicated content checkout, then configure LIVE_CONTENT_REPO. Git history and remote backup are not enabled here.</p>}
    {status?.mode === 'remote' && <>
      <dl className="text-sm space-y-2 my-4">
        <div><dt className="font-semibold">Loaded publicly · last valid bundle</dt><dd className="break-all">{status.revision}</dd></div>
        <div><dt className="font-semibold">Last observed remote · {status.branch}</dt><dd className="break-all">{status.remoteRevision ?? 'Not reached in this session'}</dd></div>
        <div><dt className="font-semibold">Remote checked</dt><dd>{status.checkedAt ?? 'Not yet checked'}</dd></div>
        <div><dt className="font-semibold">Retained draft · not confirmed live</dt><dd className="break-all">{status.pendingRevision ?? 'None'}</dd></div>
      </dl>
      <p>{status.healthy ? 'The last remote check validated and loaded this revision. The server polls with backoff; this is not a guarantee that GitHub is reachable now.' : 'The public site keeps its last valid loaded bundle. A different remote revision is not live until validated; a retained draft is never proof of publication.'}</p>
      {!!status.issues?.length && <ul className="editor-caution">{status.issues.map(issue => <li key={issue.kind}>{issue.message}</li>)}</ul>}
      <div className="editor-actions">
        <button type="button" className="btn-secondary" disabled={locked} onClick={() => { void act('sync'); }}>Fetch and validate remote</button>
        {status.pendingRevision && <>
          <button type="button" className="btn-secondary" disabled={locked} onClick={() => { void download(true); }}>Download retained draft JSON</button>
          <button type="button" className="btn-secondary" disabled={locked || status.dirty !== false} onClick={() => { void act('push'); }}>Retry retained publication</button>
          <button type="button" className="btn-secondary" disabled={locked} onClick={() => { void act('archive'); }}>Archive draft without publishing</button>
        </>}
      </div>
      <p>Keep unsaved browser drafts. Branch protection, required checks or a competing remote commit may require a Super to merge the retained draft externally. Live never force-pushes, changes branches or bypasses those rules. Archiving preserves the commit but does not merge it.</p>
      {can('settings:write') && <><button type="button" className="btn-secondary" disabled={locked} onClick={() => { void showConfiguration(); }}>View Super publication configuration</button>{configuration && <p>{configuration}</p>}</>}
    </>}
    {(status?.mode === "git" || status?.mode === 'remote') && <>
      {status.mode === 'git' && <>
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
      </>}
      <h3>{status.mode === 'remote' ? 'Restore and publish a previous bundle' : 'Restore from local history'}</h3>
      <p>A restore validates the selected bundle and creates a new forward commit. It replaces public content, may make old scheduled announcements visible if their time has passed, and does not retract email already sent. Email deduplication still applies. {status.mode === 'remote' ? 'The restored media and documents only become live after remote confirmation; unrelated application files at the current remote head are preserved.' : 'This action is local only; pushing is separate.'}</p>
      <label className="block my-3">Revision to restore
        <select className="block w-full min-w-0 mt-1" value={target} disabled={locked} onChange={e => { setTarget(e.target.value); setConfirmed(false); }}>
          <option value="">Select a previous publication…</option>
          {status.history?.map(item => <option key={item.revision} value={item.revision}>{item.revision.slice(0, 8)} · {item.date.slice(0, 10)} · {item.message.slice(0, 80)}</option>)}
        </select>
      </label>
      {status.history?.length === 0 && <p>No operation-file history available.</p>}
      <label className="planner-confirmation"><input type="checkbox" checked={confirmed} disabled={locked || !target} onChange={e => setConfirmed(e.target.checked)} /><span>I reviewed the selected revision and understand this replaces the current public content.</span></label>
      <button type="button" className="btn-secondary" disabled={locked || Boolean(error) || !confirmed || !target || status.dirty !== false || status.locked !== false || !status.head || !!status.pendingRevision} onClick={() => { void act("restore"); }}>{status.mode === 'remote' ? 'Restore and publish selected bundle' : 'Restore selected revision locally'}</button>
      <p className="text-sm text-secondary-label mt-3">Identical content is a no-op (no empty commit). History shows the latest 15 content changes. Only valid commits in this branch's history can be restored.</p>
    </>}
  </section>;
}
