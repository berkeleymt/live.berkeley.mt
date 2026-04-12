export interface ScheduleEvent {
  id: string;
  title: string;
  startTime: string; // ISO or "HH:mm"
  endTime: string;
  location: string;
  category: "individual" | "team" | "general" | "ceremony";
  description?: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string; // supports markdown (bold, italic, links, etc.)
  timestamp: string; // ISO
  priority: "normal" | "urgent";
  pinned?: boolean;
  scheduledAt?: string; // ISO — if set, announcement is hidden until this time
}

export interface DelayNotice {
  id: string;
  eventId: string;
  eventTitle: string;
  originalTime: string;
  newTime?: string;
  originalEndTime?: string;
  newEndTime?: string;
  reason?: string;
  timestamp: string;
}

export interface VenueLocation {
  id: string;
  name: string;
  shortName: string;
  description: string;
  floor?: string;
}

export interface InfoItem {
  id: string;
  label: string;
  value: string;
  icon?: string;
}

export interface LiveData {
  schedule: ScheduleEvent[];
  announcements: Announcement[];
  delays: DelayNotice[];
  venues: VenueLocation[];
  info: InfoItem[];
  lastUpdated: string;
}
