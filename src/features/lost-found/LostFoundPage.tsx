import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { LostFoundRequestError, lostFoundRequest, requestMessage } from "./api";
import { defaultLostFoundCopy } from "./types";
import type { LostFoundCopy, ReportDraft, ReportReceipt } from "./types";
import "./lost-found.css";

const emptyDraft: ReportDraft = { kind: "lost", description: "", location: "", occurredAt: "", name: "", email: "" };

/** Pass published event copy from the content editor; no private fixtures in JS. */
export function LostFoundPage({ copy: overrides, helpHref = "/#help" }: {
  copy?: Partial<LostFoundCopy>;
  helpHref?: string;
}) {
  const copy = { ...defaultLostFoundCopy, ...overrides };
  const [draft, setDraft] = useState<ReportDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  // Memory only: no contact data in localStorage, URLs, telemetry or logs.
  const attempt = useRef<{ key: string; draft: ReportDraft } | null>(null);
  const inFlight = useRef(false);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const hasDraft = Boolean(draft.description || draft.location || draft.occurredAt || draft.name || draft.email);
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
        body: JSON.stringify({ ...submission.draft, idempotencyKey: submission.key }),
      });
      setReceipt(result.receipt);
      setDraft(emptyDraft);
      attempt.current = null;
      setUncertain(false);
      // Focus the confirmation once its DOM is present, without losing the receipt.
      requestAnimationFrame(() => successHeading.current?.focus());
    } catch (error) {
      const definiteRejection = error instanceof LostFoundRequestError && [400, 413, 422, 429].includes(error.status);
      if (definiteRejection) attempt.current = null;
      setUncertain(!definiteRejection);
      setError(requestMessage(error, "We could not confirm whether your report arrived. Your details are still here. Retry the same report; the same submission key prevents a duplicate."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return <section className="lf-page" aria-labelledby="lf-heading">
    <header className="lf-heading">
      <p className="lf-muted">{copy.eyebrow}</p>
      <h1 id="lf-heading">{copy.title}</h1>
      <p>{copy.intro}</p>
    </header>
    <aside className="lf-privacy" aria-labelledby="lf-privacy-title">
      <h2 id="lf-privacy-title">{copy.privacyTitle}</h2>
      <p>{copy.privacy}</p>
      <p>{copy.safety}</p>
    </aside>
    {receipt ? <div className="lf-success" role="status">
      <h2 ref={successHeading} tabIndex={-1}>{copy.successTitle}</h2>
      <p>{copy.successBody}</p>
      <p>{copy.receiptLabel}: <code className="lf-receipt">{receipt}</code></p>
      <button className="btn-secondary" type="button" onClick={() => { setReceipt(null); setError(""); }}>{copy.anotherLabel}</button>
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
      </fieldset>
      {error && <p className="lf-error" role="alert">{error}</p>}
      {uncertain && <p className="lf-hint">Editing is paused until we confirm this attempt. Retry uses the original report, not a new submission.</p>}
      <div className="lf-actions"><a href={helpHref}>{copy.helpLabel}</a><button type="submit" className="btn-primary" disabled={busy}>{busy ? copy.busyLabel : uncertain ? copy.retryLabel : copy.submitLabel}</button></div>
    </form>}
  </section>;
}
export default LostFoundPage;
