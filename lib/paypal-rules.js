// Shared, pure validation rules. Never infer payment from a browser return URL.
export function validPlan(plan) {
  const cycles = plan?.billing_cycles;
  const cycle = cycles?.[0];
  return plan?.status === 'ACTIVE' && cycles?.length === 1 && cycle.tenure_type === 'REGULAR' &&
    cycle.frequency?.interval_unit === 'MONTH' && cycle.frequency?.interval_count === 1 &&
    cycle.total_cycles === 0 && cycle.pricing_scheme?.fixed_price?.currency_code === 'USD' &&
    cycle.pricing_scheme?.fixed_price?.value === '4.99' && !plan.quantity_supported &&
    Number(plan.payment_preferences?.setup_fee?.value || 0) === 0 && Number(plan.taxes?.percentage || 0) === 0;
}
export function monthlyWindow(startTime, now = Date.now()) {
  const anchor = new Date(startTime);
  if (!Number.isFinite(anchor.getTime()) || anchor.getTime() > now) return null;
  const boundary = offset => {
    const date = new Date(anchor);
    date.setUTCDate(1);
    date.setUTCMonth(anchor.getUTCMonth() + offset);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
    return date.getTime();
  };
  const current = new Date(now);
  let months = (current.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + current.getUTCMonth() - anchor.getUTCMonth();
  if (boundary(months) > now) months--;
  return { start: boundary(months), end: boundary(months + 1) };
}
export function verifiedPayment(transactions, window) {
  if (!window) return null;
  return transactions.filter(t => t.status === 'COMPLETED' && /^[A-Z0-9]+$/.test(t.id || '') &&
    t.amount_with_breakdown?.gross_amount?.currency_code === 'USD' &&
    t.amount_with_breakdown?.gross_amount?.value === '4.99' &&
    Date.parse(t.time) >= window.start && Date.parse(t.time) < window.end)
    .sort((a,b) => Date.parse(b.time) - Date.parse(a.time))[0] || null;
}
export function approvalURL(subscription, sandbox = false) {
  const href = subscription.links?.find(link => link.rel === 'approve')?.href;
  if (!href) return null;
  const url = new URL(href);
  if (url.protocol !== 'https:' || url.hostname !== (sandbox ? 'www.sandbox.paypal.com' : 'www.paypal.com')) return null;
  return url.href;
}
