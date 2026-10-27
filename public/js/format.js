const currencyFormatters = new Map();

function currencyFormatter(currency, compact, digits) {
  const key = `${currency}:${compact}:${digits}`;
  if (!currencyFormatters.has(key)) {
    currencyFormatters.set(key, new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: compact ? 0 : digits,
      maximumFractionDigits: compact ? 1 : digits,
    }));
  }
  return currencyFormatters.get(key);
}

export function formatCurrency(value, currency = 'USD', { compact = false, digits = 0 } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return currencyFormatter(currency || 'USD', compact, digits).format(Number(value));
}

export function formatNumber(value, { compact = false, maximumFractionDigits = 1 } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits,
  }).format(Number(value));
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export function formatDate(value, { time = false, month = 'short' } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month,
    year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } : {}),
  }).format(date);
}

export function formatDateTime(value) {
  return formatDate(value, { time: true });
}

export function formatMonth(key) {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return key ?? '—';
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function relativeTime(value) {
  if (!value) return '—';
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return '—';
  const deltaSeconds = Math.round((target - Date.now()) / 1000);
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds || unit === 'minute') {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return 'just now';
}

export function titleCase(value) {
  if (!value) return '';
  const lower = String(value).toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function truncate(value, length = 60) {
  const text = String(value ?? '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count, { maximumFractionDigits: 0 })} ${count === 1 ? singular : plural}`;
}

export function initials(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function shortHash(hash, length = 10) {
  if (!hash) return '—';
  return `${hash.slice(0, length)}…${hash.slice(-4)}`;
}
