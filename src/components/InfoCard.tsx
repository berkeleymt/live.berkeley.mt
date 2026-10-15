import { useId, useState } from "react";
import { siteDefaults, siteText } from '../features/site';
import type { SiteConfig } from '../features/site/config';
import type { InfoItem } from "../data/types";

const API = import.meta.env.VITE_API_URL?.replace(/\/live$/, "") ?? "/api";

interface InfoCardProps {
  info: InfoItem[];
}

const iconMap: Record<string, string> = {
  "Wi-Fi": "📶",
  Emergency: "🚨",
  "Information Desk": "ℹ️",
  Restrooms: "🚻",
  Disputes: "📋",
  "Contact Staff": "💬",
  "Campus Map": "🗺️",
  Parking: "🅿️",
};

export function InfoCardCompact({ info }: InfoCardProps) {
  const tiles = info.slice(0, 4);
  return (
    <div className="h-full p-4 flex flex-col">
      <p className="text-[13px] font-semibold text-tertiary-label uppercase tracking-wider px-0.5 mb-3">
        Info & Help
      </p>
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2">
        {tiles.map((item) => (
          <div
            key={item.id}
            className="flex flex-col items-center justify-center rounded-lg bg-bg/80"
          >
            <span className="text-[28px] leading-none">{iconMap[item.label] ?? "ℹ️"}</span>
            <p className="text-[11px] font-semibold text-secondary-label leading-tight mt-1.5 text-center px-1">
              {item.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmailSubscribe({ site = siteDefaults }: { site?: SiteConfig }) {
  const t = (key: string) => siteText(site, key);
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || status === 'loading') return;
    setStatus("loading");
    try {
      const res = await fetch(`${API}/email/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        signal: AbortSignal.timeout(12000),
      });
      const data = await res.json();
      setStatus(data.ok ? "done" : "error");
      setMessage(data.message);
    } catch {
      setStatus("error");
      setMessage(t('subscription.failure'));
    }
  };

  return (
    <div className="px-5 py-3">
      {status === "done" ? (
        <div className="flex items-center gap-3 min-h-[36px]">
            <p role="status" className="text-[13px] text-secondary-label">{message}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2 lg:space-y-0 lg:flex lg:items-center lg:gap-3">
          <label htmlFor={emailId} className="text-[13px] font-medium text-secondary-label shrink-0">{t('subscription.label')}</label>
          <div className="flex items-center gap-2 flex-1 min-w-0">
          <input
            id={emailId}
            autoComplete="email"
            type="email"
            placeholder={t('subscription.placeholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1 min-w-0 rounded-lg border border-black/[0.08] bg-bg/80 px-3 py-1.5 text-[14px] text-label placeholder:text-quaternary-label outline-none focus:border-berkeley-blue/30 focus:ring-1 focus:ring-berkeley-blue/20 transition-colors"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="shrink-0 rounded-lg bg-berkeley-blue text-white text-[13px] font-semibold px-3.5 py-1.5 hover:bg-berkeley-blue/90 disabled:opacity-50 transition-colors"
          >
            {t(status === 'loading' ? 'subscription.pending' : 'subscription.action')}
          </button>
          </div>
          {status === "error" && (
            <p role="alert" className="text-[12px] text-danger shrink-0">{message}</p>
          )}
        </form>
      )}
    </div>
  );
}

export function InfoCardExpanded({ info }: InfoCardProps) {
  return (
    <div className="-mx-5 -my-4">
      {info.map((item, i) => (
        <div
          key={item.id}
          className={`px-5 py-3 flex items-start gap-3 ${
            i < info.length - 1 ? "border-b border-black/[0.06]" : ""
          }`}
        >
          <span className="text-lg shrink-0">{iconMap[item.label] ?? "ℹ️"}</span>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-label">{item.label}</p>
            <p className="text-[13px] text-tertiary-label mt-0.5">{item.value}</p>
          </div>
        </div>
      ))}
      <div className="border-t border-black/[0.06]">
        <EmailSubscribe />
      </div>
    </div>
  );
}
