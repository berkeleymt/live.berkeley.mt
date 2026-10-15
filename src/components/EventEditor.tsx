import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ContentDocument, EventContent } from "../data/types";

const API = import.meta.env.VITE_API_URL?.replace(/\/live$/, "") || "/api";

export function EventEditor({ onPublish }: { onPublish: () => void }) {
  const [saved, setSaved] = useState<ContentDocument | null>(null);
  const [draft, setDraft] = useState<EventContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const dirty =
    saved !== null && JSON.stringify(draft) !== JSON.stringify(saved.content);

  async function load() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`${API}/content`, {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await response.text());
      const document: ContentDocument = await response.json();
      setSaved(document);
      setDraft(document.content);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load event content.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change<K extends keyof EventContent>(
    key: K,
    value: EventContent[K],
  ) {
    setDraft((current) => current && { ...current, [key]: value });
    setStatus("");
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!saved || !draft) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`${API}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: saved.revision, content: draft }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(await response.text());
      const document: ContentDocument = await response.json();
      setSaved(document);
      setDraft(document.content);
      setStatus(
        "Published to this server. Public pages pick it up on their next refresh, normally within 5 seconds. Download the JSON to retain it in Git.",
      );
      onPublish();
    } catch (error) {
      setError(
        error instanceof TypeError ||
          (error instanceof DOMException && error.name === "TimeoutError")
          ? "Could not confirm publication. Your draft is still here; reload the file to check whether it was saved before retrying."
          : error instanceof Error
            ? error.message
            : "Could not publish. Your draft is still here.",
      );
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "event.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="event-editor" aria-labelledby="event-editor-heading">
      <h2 id="event-editor-heading">Event details & FAQ</h2>
      <p>
        These fields edit the same JSON file as repository edits. Schedule,
        announcements, map and help information still use their existing
        sources.
      </p>
      <p className="editor-caution">
        Publishing changes this server immediately; it does not commit to Git.
        Persist the content directory before using this on a deployed container.
      </p>
      {error && (
        <p className="editor-error" role="alert">
          {error}
        </p>
      )}
      <p role="status">
        {status || (busy ? "Working…" : dirty ? "Unpublished changes" : "")}
      </p>
      {draft && (
        <form onSubmit={publish}>
          <fieldset disabled={busy}>
            <div className="editor-fields">
              <label>
                Event name
                <input
                  required
                  maxLength={120}
                  value={draft.title}
                  onChange={(e) => change("title", e.target.value)}
                />
              </label>
              <label>
                Event date (Pacific time)
                <input
                  required
                  type="date"
                  value={draft.date}
                  onChange={(e) => change("date", e.target.value)}
                />
              </label>
              <label className="editor-wide">
                Introduction
                <textarea
                  maxLength={500}
                  value={draft.subtitle}
                  onChange={(e) => change("subtitle", e.target.value)}
                />
              </label>
              <label className="editor-wide">
                Page notice (optional)
                <textarea
                  maxLength={1000}
                  value={draft.notice}
                  onChange={(e) => change("notice", e.target.value)}
                />
              </label>
              <label>
                Event website
                <input
                  type="url"
                  required
                  value={draft.eventUrl}
                  onChange={(e) => change("eventUrl", e.target.value)}
                />
              </label>
              <label>
                Travel planner URL (optional)
                <input
                  type="url"
                  value={draft.travelUrl}
                  onChange={(e) => change("travelUrl", e.target.value)}
                />
              </label>
            </div>
            <h3>Frequently asked questions</h3>
            {draft.faqs.map((faq, index) => (
              <fieldset key={index} className="editor-faq">
                <legend>Question {index + 1}</legend>
                <label>
                  Question
                  <input
                    required
                    maxLength={300}
                    value={faq.question}
                    onChange={(e) =>
                      change(
                        "faqs",
                        draft.faqs.map((item, i) =>
                          i === index
                            ? { ...item, question: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Answer (Markdown)
                  <textarea
                    required
                    rows={3}
                    maxLength={10000}
                    value={faq.answer}
                    onChange={(e) =>
                      change(
                        "faqs",
                        draft.faqs.map((item, i) =>
                          i === index
                            ? { ...item, answer: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    change(
                      "faqs",
                      draft.faqs.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove question {index + 1}
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="btn-secondary"
              disabled={draft.faqs.length >= 50}
              onClick={() =>
                change("faqs", [...draft.faqs, { question: "", answer: "" }])
              }
            >
              Add question
            </button>
            <div className="editor-actions">
              <button
                type="button"
                className="btn-secondary"
                aria-expanded={preview}
                onClick={() => setPreview(!preview)}
              >
                {preview ? "Hide preview" : "Preview copy"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={download}
              >
                Download JSON
              </button>
              <button type="submit" className="btn-primary" disabled={!dirty}>
                {busy ? "Publishing…" : "Publish event details"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={() => {
          if (
            !dirty ||
            window.confirm("Discard your unpublished edits and load the file?")
          )
            void load();
        }}
      >
        Reload file
      </button>
      {preview && draft && (
        <aside
          className="editor-preview prose-copy"
          aria-label="Unpublished content preview"
        >
          <p>Copy preview — not published</p>
          <h3>
            {draft.title} · {draft.date}
          </h3>
          <p>{draft.subtitle}</p>
          <p>{draft.notice}</p>
          {draft.faqs.map((faq, i) => (
            <div key={i}>
              <h4>{faq.question}</h4>
              <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                {faq.answer}
              </Markdown>
            </div>
          ))}
        </aside>
      )}
    </section>
  );
}
