/** Legacy API keeps {ok,message}. Recognize only fixed results; never render its text. */
export function subscriptionResult(status: number, value: unknown): { ok: boolean; key: string } {
  if (status === 429) return { ok: false, key: 'subscription.rateLimited' };
  if (status < 200 || status >= 300 || !value || typeof value !== 'object' || !('ok' in value)) return { ok: false, key: 'subscription.failure' };
  const message = 'message' in value ? value.message : null;
  if (value.ok === true) {
    if ('emailDeliveryEnabled' in value && value.emailDeliveryEnabled === false) return { ok: true, key: 'subscription.unavailable' };
    if (message === "You're already subscribed.") return { ok: true, key: 'subscription.alreadySubscribed' };
    return { ok: true, key: 'emailDeliveryEnabled' in value && value.emailDeliveryEnabled === true ? 'subscription.success' : 'subscription.saved' };
  }
  return { ok: false, key: message === 'Invalid email address.' ? 'subscription.invalid' : 'subscription.failure' };
}
