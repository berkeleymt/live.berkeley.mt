import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useSiteText } from '../site/text';
import { LostFoundRequestError, lostFoundRequest, publicReportError } from "./api";
import { defaultLostFoundCopy } from "./types";
import type { LostFoundCopy, ReportDraft, ReportReceipt } from "./types";
import "./lost-found.css";

const emptyDraft: ReportDraft = { kind: "lost", description: "", location: "", occurredAt: "", name: "", email: "" };

/** Pass published event copy from the content editor; no private fixtures in JS. */
export function LostFoundPage({ copy: overrides, helpHref = "/#help", embedded = false, formOnly = false }: {
  copy?: Partial<LostFoundCopy>;
  helpHref?: string;
  embedded?: boolean;
  formOnly?: boolean;
}) {
  const t = useSiteText();
  const copy = Object.fromEntries((Object.keys(defaultLostFoundCopy) as (keyof LostFoundCopy)[]).map(key => [key, overrides?.[key] ?? t(`lostFound.${key}`)])) as unknown as LostFoundCopy;
  const [draft, setDraft] = useState<ReportDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);
  // Memory only: no contact data in localStorage, URLs, telemetry or logs.
  const attempt = useRef<{ key: string; draft: ReportDraft } | null>(null);
  const inFlight = useRef(false);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const hasDraft = Boolean(draft.description || draft.location || draft.occurredAt || draft.name || draft.email || draft.phone);
  useEffect(() => {
    if ((!hasDraft && !uncertain) || receipt) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDraft, uncertain, receipt]);
  function change<K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || receipt) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const submission = attempt.current || { key: crypto.randomUUID(), draft: { ...draft } };
    attempt.current = submission;
    try {
      const result = await lostFoundRequest<ReportReceipt>("", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...submission.draft, idempotencyKey: submission.key, confirmationEmail: true }),
      });
      setReceipt(result);
      setDraft(emptyDraft);
      // Keep the original attempt in memory only for an explicit status check.
      // No receipt lookup route and no saved contact data in browser storage.
      setUncertain(false);
      // Focus the confirmation once its DOM is present, without losing the receipt.
      requestAnimationFrame(() => successHeading.current?.focus());
    } catch (error) {
      const definiteRejection = error instanceof LostFoundRequestError && [400, 413, 422, 429].includes(error.status);
      if (definiteRejection) attempt.current = null;
      setUncertain(!definiteRejection);
      setError(publicReportError(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function checkMail() {
    const submission = attempt.current;
    if (!submission || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      setReceipt(await lostFoundRequest<ReportReceipt>("", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...submission.draft, idempotencyKey: submission.key, confirmationEmail: true }),
      }));
    } catch {
      setError('mailRefreshError');
    } finally { inFlight.current = false; setBusy(false); }
  }
  const mailMessages = { queued: copy.mailQueued, not_configured: copy.mailNotConfigured, sending: copy.mailSending, retry_wait: copy.mailRetryWait, accepted: copy.mailAccepted, failed: copy.mailFailed, uncertain: copy.mailUncertain, handled: copy.mailHandled };
  return <section className="lf-page" aria-labelledby={formOnly ? undefined : 'lf-heading'} aria-label={formOnly ? copy.kindLabel : undefined}>
    {!formOnly && <><header className="lf-heading">
      <p className="lf-muted">{copy.eyebrow}</p>
      {embedded ? <h2 id="lf-heading">{copy.title}</h2> : <h1 id="lf-heading">{copy.title}</h1>}
      <p>{copy.intro}</p>
    </header>
    <aside className="lf-privacy" aria-labelledby="lf-privacy-title">
      <h2 id="lf-privacy-title">{copy.privacyTitle}</h2>
      <p>{copy.privacy}</p>
      <p>{copy.safety}</p>
    </aside></>}
    {receipt ? <div className="lf-success" role="status">
      <h2 ref={successHeading} tabIndex={-1}>{copy.successTitle}</h2>
      <p>{copy.successBody}</p>
      <p>{copy.receiptLabel}: <code className="lf-receipt">{receipt.receipt}</code></p>
      <p>{receipt.emailState ? mailMessages[receipt.emailState] ?? copy.mailUnknown : copy.mailUnknown}</p>
      {error && <p className="lf-error" role="alert">{copy[error as keyof LostFoundCopy]}</p>}
      <div className="lf-actions">
        <button className="btn-secondary" type="button" disabled={busy} onClick={() => void checkMail()}>{busy ? copy.mailChecking : copy.mailCheck}</button>
        <button className="btn-secondary" type="button" disabled={busy} onClick={() => { setReceipt(null); setError(""); attempt.current = null; }}>{copy.anotherLabel}</button>
      </div>
    </div> : <form onSubmit={submit} className="lf-form" aria-busy={busy}>
      <fieldset disabled={busy || uncertain}>
        <legend>{copy.kindLabel}</legend>
        <div className="lf-kind">
          <label><input type="radio" name="kind" value="lost" checked={draft.kind === "lost"} onChange={() => change("kind", "lost")} />{copy.lostLabel}</label>
          <label><input type="radio" name="kind" value="found" checked={draft.kind === "found"} onChange={() => change("kind", "found")} />{copy.foundLabel}</label>
        </div>
        <label htmlFor="lf-description">{copy.descriptionLabel}</label>
        <p id="lf-description-hint" className="lf-hint">{copy.descriptionHint}</p>
        <textarea id="lf-description" className="input" rows={4} required minLength={5} maxLength={2000} aria-describedby="lf-description-hint" value={draft.description} onChange={(e) => change("description", e.target.value)} />
        <label htmlFor="lf-location">{copy.locationLabel}</label>
        <p id="lf-location-hint" className="lf-hint">{copy.locationHint}</p>
        <input id="lf-location" className="input" required minLength={2} maxLength={200} aria-describedby="lf-location-hint" value={draft.location} onChange={(e) => change("location", e.target.value)} />
        <label htmlFor="lf-time">{copy.timeLabel}</label>
        <p id="lf-time-hint" className="lf-hint">{copy.timeHint}</p>
        <input id="lf-time" className="input" required minLength={2} maxLength={120} aria-describedby="lf-time-hint" value={draft.occurredAt} onChange={(e) => change("occurredAt", e.target.value)} />
        <div className="lf-two-fields">
          <div><label htmlFor="lf-name">{copy.nameLabel}</label><input id="lf-name" className="input" autoComplete="name" maxLength={100} value={draft.name} onChange={(e) => change("name", e.target.value)} /></div>
          <div><label htmlFor="lf-email">{copy.emailLabel}</label><input id="lf-email" className="input" type="email" required autoComplete="email" maxLength={254} aria-describedby="lf-email-hint" value={draft.email} onChange={(e) => change("email", e.target.value)} /></div>
        </div>
        <p id="lf-email-hint" className="lf-hint">{copy.emailHint}</p>
        <label htmlFor="lf-phone">{copy.phoneLabel}</label><input id="lf-phone" className="input" type="tel" autoComplete="tel" maxLength={80} value={draft.phone ?? ""} onChange={(e) => change("phone", e.target.value)} />
      </fieldset>
      {error && <p className="lf-error" role="alert">{copy[error as keyof LostFoundCopy]}</p>}
      {uncertain && <p className="lf-hint">{copy.editingPaused}</p>}
      <div className="lf-actions"><a href={helpHref}>{copy.helpLabel}</a><button type="submit" className="btn-primary" disabled={busy}>{busy ? copy.busyLabel : uncertain ? copy.retryLabel : copy.submitLabel}</button></div>
    </form>}
  </section>;
}
export default LostFoundPage;
