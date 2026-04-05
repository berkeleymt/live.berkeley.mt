import type { LiveData } from "./types";

/**
 * Mock data for local development.
 *
 * This object matches the exact shape the API should return (LiveData).
 * Timestamps use relative Date.now() so the mock always feels "live."
 *
 * When wiring up a real backend, the API endpoint should return JSON
 * in this same shape. See types.ts for the full interface definitions.
 *
 * Example API response:
 * {
 *   "lastUpdated": "2026-04-12T10:30:00Z",
 *   "schedule":      [...ScheduleEvent],
 *   "announcements": [...Announcement],   // body supports markdown
 *   "delays":        [...DelayNotice],
 *   "venues":        [...VenueLocation],
 *   "info":          [...InfoItem]
 * }
 */

export const mockData: LiveData = {
  lastUpdated: new Date().toISOString(),

  schedule: [
    {
      id: "s1",
      title: "Check-in (Coaches Only)",
      startTime: "08:00",
      endTime: "08:45",
      location: "Dwinelle Hall",
      category: "general",
      description:
        "Coaches should proceed to Dwinelle Hall for check-in and materials pick-up. Room assignments, sticker sheets, and tournament guides will be distributed.",
    },
    {
      id: "s2",
      title: "Puzzle Round",
      startTime: "09:00",
      endTime: "10:15",
      location: "Dwinelle Hall & Wheeler Hall",
      category: "team",
      description:
        "75-minute team-based round with a variety of mathematical puzzles. Report to your assigned classroom.",
    },
    {
      id: "s3",
      title: "Individual Round",
      startTime: "10:30",
      endTime: "11:30",
      location: "Dwinelle Hall & Wheeler Hall",
      category: "individual",
      description:
        "60-minute individual test, 20 questions. No calculators. Remain in your assigned classroom.",
    },
    {
      id: "s4",
      title: "Lunch",
      startTime: "11:30",
      endTime: "12:30",
      location: "Outside Dwinelle Hall",
      category: "general",
      description:
        "Pre-purchased lunches (Crave Subs) available for pick-up outside Dwinelle Hall. Restaurants also nearby on south side of campus and in Downtown Berkeley.",
    },
    {
      id: "s5",
      title: "Team Round",
      startTime: "12:45",
      endTime: "13:45",
      location: "Dwinelle Hall & Wheeler Hall",
      category: "team",
      description:
        "60-minute team test, 20 questions. Work with your team of up to 5 in your assigned classroom.",
    },
    {
      id: "s6",
      title: "Relay Round",
      startTime: "13:45",
      endTime: "14:25",
      location: "Dwinelle Hall & Wheeler Hall",
      category: "team",
      description:
        "40-minute relay-style round. Teams pass answers down the line. Stay in your assigned classroom.",
    },
    {
      id: "s7",
      title: "Activities",
      startTime: "14:45",
      endTime: "16:00",
      location: "Various Locations",
      category: "general",
      description:
        "Fun math activities and campus exploration while scores are tabulated. Check the info booth for details.",
    },
    {
      id: "s8",
      title: "Awards Ceremony",
      startTime: "17:00",
      endTime: "18:00",
      location: "Pauley Ballroom & Dwinelle 155",
      category: "ceremony",
      description:
        "Results announcement and trophy presentation. Report to your assigned awards room. Tiebreaker qualifiers will be announced after the Relay Round.",
    },
  ],

  announcements: [
    {
      id: "a1",
      title: "Welcome to BmMT 2026!",
      body: "We're excited to have you at UC Berkeley for the Berkeley mini Math Tournament! Coaches: head to Dwinelle Hall for check-in. Students: find your team and wait for your coach to return with room assignments.",
      timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      priority: "normal",
      pinned: true,
    },
    {
      id: "a2",
      title: "Room assignments distributed",
      body: "Room assignments are on the sticker sheets given to coaches at check-in. You'll be in classrooms in Dwinelle Hall or Wheeler Hall. Check the campus map if you need directions.",
      timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      priority: "normal",
    },
    {
      id: "a3",
      title: "Lunch pick-up location update",
      body: "Pre-purchased lunches from Crave Subs will be available outside Dwinelle Hall starting at 11:30 AM. Please have your ticket ready. Vegetarian and vegan options labeled separately.",
      timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      priority: "urgent",
    },
  ],

  delays: [
    {
      id: "d1",
      eventId: "s5",
      eventTitle: "Team Round",
      originalTime: "12:45",
      newTime: "13:00",
      reason: "Extended lunch break due to food distribution delays",
      timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    },
  ],

  venues: [
    {
      id: "v1",
      name: "Dwinelle Hall",
      shortName: "Dwinelle",
      description:
        "Main venue for check-in, testing rooms, and awards. Coaches check in at Dwinelle 145/155.",
      floor: "Multiple floors",
    },
    {
      id: "v2",
      name: "Wheeler Hall",
      shortName: "Wheeler",
      description:
        "Overflow testing rooms for Puzzle, Individual, Team, and Relay rounds.",
      floor: "1F–2F",
    },
    {
      id: "v3",
      name: "Pauley Ballroom",
      shortName: "Pauley",
      description:
        "Awards ceremony location (shared with Dwinelle 155). Located in Martin Luther King Jr. Student Union.",
    },
    {
      id: "v4",
      name: "South Side & Downtown Berkeley",
      shortName: "Food",
      description:
        "Restaurants within a 5–15 minute walk from campus for those not purchasing lunch.",
    },
  ],

  info: [
    { id: "i1", label: "Wi-Fi", value: "CalVisitor (no password)" },
    { id: "i2", label: "Emergency", value: "UCPD: 510-642-3333" },
    { id: "i3", label: "Lost & Found", value: "Information booth near Dwinelle" },
    { id: "i4", label: "Restrooms", value: "Dwinelle 1F, Wheeler 1F" },
    { id: "i5", label: "Disputes", value: "Wheeler 126, during lunch only" },
    { id: "i6", label: "Contact Staff", value: "team@berkeley.mt" },
    { id: "i7", label: "Campus Map", value: "berkeley.edu/map (PDF)" },
    { id: "i8", label: "Parking", value: "See UC Berkeley Parking website" },
  ],
};
