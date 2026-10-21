export type ProductionStaffRole = "admin" | "super";
export type StaffRole = ProductionStaffRole | "dispatcher" | "crisis_manager" | "info_desk" | "administrator";
export type StaffCapability =
  | "schedule:write" | "updates:read" | "updates:write"
  | "content:write" | "rooms:write" | "found:read" | "found:write"
  | "publishing:write" | "access:read" | "people:write" | "settings:write";

export interface StaffIdentity {
  id: string;
  name: string;
  role: StaffRole;
  capabilities: StaffCapability[];
  demo: boolean;
  authSource: "account" | "owner" | "demo" | "google";
  email?: string | null;
  picture?: string | null;
}

export interface StaffSession {
  user: StaffIdentity | null;
  csrfToken: string | null;
  /** Unix seconds, not milliseconds. Sessions do not renew automatically. */
  expiresAt: number | null;
  demoMode: boolean;
  demoAccounts: StaffIdentity[];
  passwordLoginEnabled: boolean;
  ownerLoginEnabled: boolean;
  authMode?: "google" | "legacy";
  googleClientId?: string | null;
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  super: "Super admin",
  dispatcher: "Dispatcher",
  crisis_manager: "Crisis manager",
  info_desk: "Info desk",
  administrator: "Administrator",
};

export const CAPABILITY_LABELS: Record<StaffCapability, string> = {
  "schedule:write": "Change the schedule and delays",
  "updates:read": "Read scheduled and future updates",
  "updates:write": "Write and schedule updates",
  "content:write": "Edit public content, guide and images",
  "rooms:write": "Edit buildings, rooms and directions",
  "found:read": "Read the private lost-and-found inbox",
  "found:write": "Respond to and resolve lost-and-found reports",
  "publishing:write": "Publish, export and restore Git content",
  "access:read": "View your own role and permissions",
  "people:write": "Manage staff accounts and roles",
  "settings:write": "Manage application settings and provider credentials",
};

/** Presentation only. The server checks its own policy on every protected request. */
export function canStaff(user: StaffIdentity | null | undefined, capability: StaffCapability): boolean {
  return user?.capabilities.includes(capability) ?? false;
}

export function hasAnyCapability(user: StaffIdentity | null | undefined, capabilities: readonly StaffCapability[]): boolean {
  return capabilities.some((capability) => canStaff(user, capability));
}

/** Never let a login return URL navigate off-site or back into the sign-in page. */
export function staffReturnPath(value: string | null): string {
  if (!value || /[\\\r\n]/.test(value) || !/^\/admin(?:\/|\?|#|$)/.test(value)) return "/admin";
  const url = new URL(value, "https://staff.invalid");
  return url.pathname === "/admin" || url.pathname.startsWith("/admin/")
    ? url.pathname + url.search + url.hash
    : "/admin";
}
