import assert from "node:assert/strict";
import { test } from "node:test";
import { eventDateLabel, scheduleState } from "../src/data/schedule.ts";

const event = { date: "2026-11-14", timeZone: "America/Los_Angeles" };
const schedule = [
  { id: "morning", title: "Morning", startTime: "09:00", endTime: "10:00" },
  { id: "afternoon", title: "Afternoon", startTime: "13:00", endTime: "14:00" },
];
const at = (iso, delays = [], events = schedule, config = event) =>
  scheduleState(events, delays, config, Date.parse(iso));

test("shows no current event on the wrong date", () => {
  assert.equal(at("2026-11-13T17:30:00Z").current, undefined);
  assert.equal(at("2026-11-15T17:30:00Z").current, undefined);
  assert.equal(at("2026-11-15T17:30:00Z").next, undefined);
});
test("before the event, shows the first event regardless of today's time", () => {
  const state = at("2026-10-15T23:30:00Z");
  assert.equal(state.phase, "before");
  assert.equal(state.next.id, "morning");
});
test("uses the Berkeley calendar date, not the UTC date", () => {
  assert.equal(at("2026-11-14T07:59:59Z").phase, "before");
  assert.equal(at("2026-11-14T08:00:00Z").phase, "today");
  assert.equal(at("2026-11-15T07:59:59Z").phase, "today");
  assert.equal(at("2026-11-15T08:00:00Z").phase, "after");
});
test("current event uses Pacific time and exclusive end boundary", () => {
  assert.equal(at("2026-11-14T16:59:59Z").current, undefined);
  assert.equal(at("2026-11-14T17:00:00Z").current.id, "morning");
  assert.equal(at("2026-11-14T17:59:59Z").current.id, "morning");
  assert.equal(at("2026-11-14T18:00:00Z").current, undefined);
  assert.equal(at("2026-11-14T18:00:00Z").next.id, "afternoon");
});
test("uses daylight saving time for the April event", () => {
  assert.equal(
    at("2026-04-12T16:30:00Z", [], schedule, { ...event, date: "2026-04-12" })
      .current.id,
    "morning",
  );
});
test("delays change current status, next event and display order", () => {
  const delays = [
    { eventId: "morning", newTime: "13:30", newEndTime: "14:30" },
  ];
  assert.equal(at("2026-11-14T17:30:00Z", delays).current, undefined);
  assert.equal(at("2026-11-14T17:30:00Z", delays).next.id, "afternoon");
  assert.equal(at("2026-11-14T22:15:00Z", delays).current.id, "morning");
  assert.deepEqual(
    at("2026-11-14T17:30:00Z", delays).events.map((e) => e.id),
    ["afternoon", "morning"],
  );
  assert.equal(schedule[0].startTime, "09:00");
});
test("end-only delays extend the current event", () => {
  assert.equal(
    at("2026-11-14T18:15:00Z", [{ eventId: "morning", newEndTime: "10:30" }])
      .current.id,
    "morning",
  );
});
test("empty schedule is unpublished, not over", () => {
  assert.equal(at("2026-11-15T17:30:00Z", [], []).phase, "unpublished");
});
test("date label is independent of the visitor's timezone", () => {
  assert.equal(eventDateLabel("2026-11-14"), "Saturday, November 14, 2026");
});
