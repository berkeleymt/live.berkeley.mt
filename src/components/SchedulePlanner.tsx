import { useRef, useState } from "react";
import type { ScheduleEvent } from "../data/types";
import { useStaff } from "../features/staff";

type Plan = {
  fromId: string;
  delayMinutes: number;
  absorbId: string;
  absorbMinutes: number;
  reason: string;
};
type Review = {
  revision: string;
  confirmation: string;
  plan: Plan;
  rows: {
    id: string;
    title: string;
    beforeStart: string;
    beforeEnd: string;
    afterStart: string;
    afterEnd: string;
  }[];
};
export function SchedulePlanner({
  events,
  onPublish,
}: {
  events: ScheduleEvent[];
  onPublish: () => Promise<boolean>;
}) {
  const { request } = useStaff();
  const [plan, setPlan] = useState<Plan>(() => ({
    fromId:
      events.find((e) => e.category === "team" || e.category === "individual")
        ?.id ??
      events[0]?.id ??
      "",
    delayMinutes: 30,
    absorbId: events.find((e) => /lunch/i.test(e.title))?.id ?? "",
    absorbMinutes: 15,
    reason: "Rounds are running late; lunch will absorb 15 minutes.",
  }));
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  function change(patch: Partial<Plan>) {
    setPlan((current) => ({ ...current, ...patch }));
    setReview(null);
    setConfirmed(false);
    setMessage("");
  }
  async function act(apply: boolean) {
    if (flight.current || (apply && (!review || !confirmed))) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await request(
        `/api/schedule/plan/${apply ? "apply" : "preview"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            apply
              ? {
                  revision: review!.revision,
                  confirmation: review!.confirmation,
                  plan: review!.plan,
                }
              : plan,
          ),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      if (apply) {
        setReview(null);
        setConfirmed(false);
        await onPublish();
        setMessage(
          "Published all reviewed changes together. Single-event delay controls remain available below.",
        );
      } else {
        setReview(await response.json());
        setConfirmed(false);
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name !== "TypeError"
          ? cause.message
          : "Could not confirm the request. Refresh published values before retrying; no automatic resubmission.",
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="event-editor" aria-labelledby="planner-heading">
      <h2 id="planner-heading">Adjust the day together</h2>
      <p>
        Preview a delay from one event onward. Shorten only the break you
        select; all other round durations stay intact. No Lemon timers are
        changed.
      </p>
      <fieldset disabled={busy} className="planner-fields">
        <legend className="sr-only">Schedule adjustment</legend>
        <label>
          Start with
          <select
            className="input"
            value={plan.fromId}
            onChange={(e) => change({ fromId: e.target.value })}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Delay (minutes)
          <input
            className="input"
            type="number"
            min="1"
            max="180"
            value={plan.delayMinutes}
            onChange={(e) => change({ delayMinutes: Number(e.target.value) })}
          />
        </label>
        <label>
          Break to shorten
          <select
            className="input"
            value={plan.absorbId}
            onChange={(e) => change({ absorbId: e.target.value })}
          >
            <option value="">Choose a break</option>
            {events
              .filter((e) => e.category === "general")
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          Absorb (minutes)
          <input
            className="input"
            type="number"
            min="0"
            max={plan.delayMinutes}
            value={plan.absorbMinutes}
            onChange={(e) => change({ absorbMinutes: Number(e.target.value) })}
          />
        </label>
        <label className="planner-reason">
          Public reason
          <input
            className="input"
            maxLength={1000}
            value={plan.reason}
            onChange={(e) => change({ reason: e.target.value })}
          />
        </label>
        <button
          className="btn-secondary"
          type="button"
          onClick={() => void act(false)}
        >
          Preview changes
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="editor-error">
          {error}
        </p>
      )}
      <p role="status">{busy ? "Waiting for server confirmation…" : message}</p>
      {review && (
        <div className="planner-review">
          <h3>Review before publishing</h3>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Published</th>
                  <th>Proposed</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((row) => (
                  <tr key={row.id}>
                    <th>{row.title}</th>
                    <td>
                      {row.beforeStart}–{row.beforeEnd}
                    </td>
                    <td>
                      {row.afterStart}–{row.afterEnd}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="planner-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>I reviewed every affected event and the shortened break.</span>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !confirmed}
            onClick={() => void act(true)}
          >
            Publish reviewed adjustment
          </button>
          <p>
            One publication transaction. An intervening edit rejects this plan;
            preview again rather than overwriting it.
          </p>
        </div>
      )}
    </section>
  );
}
