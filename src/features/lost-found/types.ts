import { siteDefaults } from '../site/defaults';

export type ReportKind = "lost" | "found";
export type ReportStatus = "new" | "found" | "contacted" | "resolved";
export interface ReportDraft {
  kind: ReportKind;
  description: string;
  location: string;
  occurredAt: string;
  name: string;
  email: string;
  phone?: string;
}
export type DeliveryState = 'queued' | 'not_configured' | 'sending' | 'retry_wait' | 'accepted' | 'failed' | 'uncertain' | 'handled';
export interface ReportReceipt { receipt: string; emailState?: DeliveryState }
export interface MailDelivery {
  state: DeliveryState; revision: number; attempts: number; nextAttempt: number | null;
  updatedAt: string; diagnostic: string; providerId: string | null;
  history: { at: string; actor: string; action: string; note: string }[];
}
export interface LostFoundReport extends ReportDraft {
  id: string;
  receipt: string;
  status: ReportStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  synthetic: boolean;
  delivery: MailDelivery | null;
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
  mailConfiguration: string;
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
  phoneLabel: string;
  mailQueued: string;
  mailNotConfigured: string;
  mailSending: string;
  mailRetryWait: string;
  mailAccepted: string;
  mailFailed: string;
  mailUncertain: string;
  mailHandled: string;
  mailUnknown: string;
  mailCheck: string;
  mailChecking: string;
  submitLabel: string;
  busyLabel: string;
  retryLabel: string;
  helpLabel: string;
  successTitle: string;
  successBody: string;
  receiptLabel: string;
  anotherLabel: string;
  editingPaused: string;
  submitUncertain: string;
  mailRefreshError: string;
  errorAuth: string;
  errorConflict: string;
  errorTooLarge: string;
  errorInvalid: string;
  errorRateLimited: string;
}
/** Compatibility export, sourced from canonical site copy rather than a second English catalog. */
export const defaultLostFoundCopy = Object.fromEntries(
  Object.entries(siteDefaults.copy).filter(([key]) => key.startsWith('lostFound.')).map(([key, value]) => [key.slice('lostFound.'.length), value]),
) as unknown as LostFoundCopy;
