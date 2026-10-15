export type ReportKind = "lost" | "found";
export type ReportStatus = "new" | "found" | "contacted" | "resolved";
export interface ReportDraft {
  kind: ReportKind;
  description: string;
  location: string;
  occurredAt: string;
  name: string;
  email: string;
}
export interface ReportReceipt { receipt: string }
export interface LostFoundReport extends ReportDraft {
  id: string;
  receipt: string;
  status: ReportStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  synthetic: boolean;
  history: {
    at: string;
    actor: string;
    fromStatus: ReportStatus | null;
    status: ReportStatus;
    notes: string;
    revision: number;
  }[];
}
export interface ReportPage {
  reports: LostFoundReport[];
  total: number;
  limit: number;
  offset: number;
  demoMode: boolean;
}
export interface LostFoundCopy {
  eyebrow: string;
  title: string;
  intro: string;
  privacyTitle: string;
  privacy: string;
  safety: string;
  kindLabel: string;
  lostLabel: string;
  foundLabel: string;
  descriptionLabel: string;
  descriptionHint: string;
  locationLabel: string;
  locationHint: string;
  timeLabel: string;
  timeHint: string;
  nameLabel: string;
  emailLabel: string;
  emailHint: string;
  submitLabel: string;
  busyLabel: string;
  retryLabel: string;
  helpLabel: string;
  successTitle: string;
  successBody: string;
  receiptLabel: string;
  anotherLabel: string;
}
export const defaultLostFoundCopy: LostFoundCopy = {
  eyebrow: "Tournament help",
  title: "Lost & found",
  intro: "Tell us what you lost or found. Tournament staff will help connect it with its owner.",
  privacyTitle: "A private report, not a public listing",
  privacy: "Only authorized tournament staff can see your report and contact details. We ask for an email so staff can follow up; your name is optional. Reports are not published on this website or in its public content files.",
  safety: "Do not include passwords, ID numbers, or other sensitive details. Keep found items safe and ask a volunteer where to hand them in. For urgent or safety concerns, speak to staff in person.",
  kindLabel: "What happened?",
  lostLabel: "I lost something",
  foundLabel: "I found something",
  descriptionLabel: "Describe the item",
  descriptionHint: "Include the color, brand, and a distinguishing feature. 5–2000 characters.",
  locationLabel: "Where was it lost or found?",
  locationHint: "A building, room, or nearby landmark. Write “Unknown” if you are unsure.",
  timeLabel: "When was it lost or found?",
  timeHint: "An approximate time is fine, for example “November 14, around 10 am Pacific.”",
  nameLabel: "Your name (optional)",
  emailLabel: "Contact email",
  emailHint: "Use an address you can check. A parent or guardian’s email is welcome.",
  submitLabel: "Send private report",
  busyLabel: "Sending report…",
  retryLabel: "Retry the same report",
  helpLabel: "Other ways to get help",
  successTitle: "Your report is with tournament staff",
  successBody: "Save your receipt below if you need to speak with staff. They can follow up at the email you provided. This is not a promise of a match or an email notification, and the receipt does not let anyone view your report online.",
  receiptLabel: "Receipt",
  anotherLabel: "Report another item",
};
