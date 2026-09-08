/**
 * Display formatting lives in `@atlas/client` so the web and mobile
 * applications render the same money, distances and countdowns. Re-exported
 * here because every component in this app imports it from `@/lib/utils`.
 */
export {
  PAYMENT_ESTIMATE,
  cn,
  estimateMonthlyPayment,
  formatCompact,
  formatCountdown,
  formatDate,
  formatEnum,
  formatKm,
  formatLocation,
  formatNumber,
  formatPrice,
  formatProvince,
  formatRelativeTime,
  isClosingSoon,
  joinSpecs,
} from '@atlas/client';
