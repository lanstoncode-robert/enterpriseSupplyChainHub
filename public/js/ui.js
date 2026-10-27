import { html, raw } from './html.js';
import { formatNumber, titleCase } from './format.js';

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  orders: '<path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1Z"/><path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2"/><path d="M9 12h6M9 16h4"/>',
  trace: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h7"/>',
  suppliers: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/><path d="M15 9h3a2 2 0 0 1 2 2v10"/><path d="M2 21h20"/><path d="M8 7h3M8 11h3M8 15h3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  alert: '<path d="M10.3 3.8 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.1-8.1M15.5 7.5l2 2M17.5 5.5l2 2"/>',
  shield: '<path d="M12 3 5 6v6c0 4.4 2.9 7.8 7 9 4.1-1.2 7-4.6 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  ship: '<path d="M3 15h18l-2.2 4.5a2 2 0 0 1-1.8 1.1H7a2 2 0 0 1-1.8-1.1L3 15Z"/><path d="M5 15V9h14v6"/><path d="M9 9V5h6v4M12 5V3"/>',
  package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5a3.5 3.5 0 0 1 0 7M18 20a6.5 6.5 0 0 0-2-4.7"/>',
  factory: '<path d="M3 21V8l6 4V8l6 4V4h6v17H3Z"/><path d="M7 17h2M13 17h2M18 17h1"/>',
  inbox: '<path d="M4 4h16v12H4z"/><path d="m4 12 4-4h8l4 4M8 20h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
};

export function icon(name, className = 'h-4 w-4') {
  const body = ICONS[name] ?? ICONS.circle;
  return raw(`<svg viewBox="0 0 24 24" class="${className}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`);
}

const STATUS_TONES = {
  DELIVERED: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  SHIPPED: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
  IN_PRODUCTION: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300',
  CONFIRMED: 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300',
  PARTIALLY_SHIPPED: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  PENDING_CONFIRMATION: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
  ON_HOLD: 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300',
  CANCELLED: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
  DRAFT: 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
};

const STATUS_DOTS = {
  DELIVERED: 'bg-emerald-600 dark:bg-emerald-400',
  SHIPPED: 'bg-sky-600 dark:bg-sky-400',
  IN_PRODUCTION: 'bg-violet-600 dark:bg-violet-400',
  CONFIRMED: 'bg-indigo-600 dark:bg-indigo-400',
  PARTIALLY_SHIPPED: 'bg-amber-600 dark:bg-amber-400',
  PENDING_CONFIRMATION: 'bg-slate-500 dark:bg-slate-400',
  ON_HOLD: 'bg-orange-600 dark:bg-orange-400',
  CANCELLED: 'bg-rose-600 dark:bg-rose-400',
  DRAFT: 'bg-slate-400 dark:bg-slate-500',
};

export function statusBadge(status) {
  const tone = STATUS_TONES[status] ?? STATUS_TONES.DRAFT;
  const dot = STATUS_DOTS[status] ?? STATUS_DOTS.DRAFT;
  return html`<span class="badge ${tone}"><span class="h-1.5 w-1.5 rounded-full ${dot}" aria-hidden="true"></span>${titleCase(status)}</span>`;
}

const RISK_TONES = {
  LOW: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  HIGH: 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300',
  CRITICAL: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
};

export function riskBadge(level, { score = null } = {}) {
  const tone = RISK_TONES[level] ?? RISK_TONES.LOW;
  return html`<span class="badge ${tone}">${icon(level === 'LOW' ? 'shield' : 'alert', 'h-3.5 w-3.5')}${titleCase(level)} risk${score === null ? '' : ` · ${score}`}</span>`;
}

const PRIORITY_TONES = {
  STANDARD: 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  HIGH: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  CRITICAL: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
};

export function priorityBadge(priority) {
  return html`<span class="badge ${PRIORITY_TONES[priority] ?? PRIORITY_TONES.STANDARD}">${titleCase(priority)}</span>`;
}

export function chainBadge(valid, { label = null } = {}) {
  if (valid) {
    return html`<span class="badge border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">${icon('check', 'h-3.5 w-3.5')}${label ?? 'Chain verified'}</span>`;
  }
  return html`<span class="badge border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">${icon('alert', 'h-3.5 w-3.5')}${label ?? 'Chain exception'}</span>`;
}

export function pageHeader({ eyebrow = '', title, description = '', actions = null, meta = null }) {
  return html`
    <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        ${eyebrow ? html`<p class="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">${eyebrow}</p>` : ''}
        <h1 data-route-heading tabindex="-1" class="mt-1 text-2xl font-bold tracking-tight text-slate-900 outline-none dark:text-white sm:text-3xl">${title}</h1>
        ${description ? html`<p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">${description}</p>` : ''}
        ${meta ? html`<div class="mt-3">${meta}</div>` : ''}
      </div>
      ${actions ? html`<div class="flex shrink-0 flex-wrap items-center gap-2">${actions}</div>` : ''}
    </header>
  `;
}

const STAT_TONES = {
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
};

export function statCard({ label, value, helper = '', iconName = 'circle', tone = 'teal', href = null }) {
  const content = html`
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">${label}</p>
        <p class="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">${value}</p>
        ${helper ? html`<p class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">${helper}</p>` : ''}
      </div>
      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg ${STAT_TONES[tone] ?? STAT_TONES.teal}">${icon(iconName, 'h-5 w-5')}</span>
    </div>
  `;
  return href
    ? html`<a href="${href}" class="card block p-5 transition-colors hover:border-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:border-teal-700">${content}</a>`
    : html`<div class="card p-5">${content}</div>`;
}

export function sectionCard({ title, description = '', actions = null, body, className = '' }) {
  return html`
    <section class="card ${className}" aria-label="${title}">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 class="text-base font-semibold text-slate-900 dark:text-white">${title}</h2>
          ${description ? html`<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">${description}</p>` : ''}
        </div>
        ${actions ? html`<div class="flex flex-wrap items-center gap-2">${actions}</div>` : ''}
      </div>
      <div class="p-5">${body}</div>
    </section>
  `;
}

const BANNER_TONES = {
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  danger: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
};

export function banner({ tone = 'info', title, message = '', action = null, role = 'status' }) {
  const iconName = tone === 'success' ? 'check' : tone === 'danger' || tone === 'warning' ? 'alert' : 'info';
  return html`
    <div class="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start ${BANNER_TONES[tone] ?? BANNER_TONES.info}" role="${role}">
      <span class="mt-0.5 shrink-0">${icon(iconName, 'h-5 w-5')}</span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">${title}</p>
        ${message ? html`<div class="mt-1 text-sm leading-6 opacity-90">${message}</div>` : ''}
      </div>
      ${action ? html`<div class="shrink-0">${action}</div>` : ''}
    </div>
  `;
}

export function emptyState({ title, message = '', action = null, iconName = 'inbox' }) {
  return html`
    <div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
      <span class="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">${icon(iconName, 'h-6 w-6')}</span>
      <h3 class="mt-4 text-base font-semibold text-slate-900 dark:text-white">${title}</h3>
      ${message ? html`<p class="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">${message}</p>` : ''}
      ${action ? html`<div class="mt-4">${action}</div>` : ''}
    </div>
  `;
}

export function errorState({ title = 'Something went wrong', message, retry = true, action = null }) {
  return html`
    <div class="rounded-xl border border-rose-300 bg-rose-50 p-6 dark:border-rose-500/40 dark:bg-rose-500/10" role="alert">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 shrink-0 text-rose-700 dark:text-rose-300">${icon('alert', 'h-5 w-5')}</span>
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-rose-900 dark:text-rose-200">${title}</h2>
          <p class="mt-1 text-sm leading-6 text-rose-800 dark:text-rose-200/90">${message}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            ${retry ? html`<button type="button" class="btn-secondary" data-action="retry">${icon('refresh')}Try again</button>` : ''}
            ${action ?? ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function loadingState({ label = 'Loading' } = {}) {
  return html`
    <div role="status" aria-live="polite" aria-busy="true">
      <span class="sr-only">${label}</span>
      <div class="mb-6 space-y-2">
        <div class="h-7 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
        <div class="h-4 w-96 max-w-full animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        ${Array.from({ length: 4 }, () => html`<div class="h-28 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"></div>`)}
      </div>
      <div class="mt-6 h-64 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"></div>
    </div>
  `;
}

export function metricBar({ label, value, max, display }) {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.max(0, Math.min(Number(value) || 0, safeMax));
  return html`
    <li>
      <div class="flex items-baseline justify-between gap-3 text-sm">
        <span class="font-medium text-slate-700 dark:text-slate-200">${label}</span>
        <span class="text-slate-500 dark:text-slate-400">${display ?? formatNumber(value)}</span>
      </div>
      <progress class="progress mt-2" value="${safeValue}" max="${safeMax}" aria-label="${label}">${display ?? formatNumber(value)}</progress>
    </li>
  `;
}

export function pagination({ hasPreviousPage, hasNextPage, label = '' }) {
  return html`
    <nav class="flex flex-wrap items-center justify-between gap-3" aria-label="${label || 'Pagination'}">
      <p class="text-xs text-slate-500 dark:text-slate-400">Cursor pagination · server-side filtering</p>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" data-action="previous-page" ${hasPreviousPage ? '' : raw('disabled')}>
          ${icon('chevron-left')}Previous
        </button>
        <button type="button" class="btn-secondary" data-action="next-page" ${hasNextPage ? '' : raw('disabled')}>
          Next${icon('chevron-right')}
        </button>
      </div>
    </nav>
  `;
}

export function sortHeader({ field, label, activeField, direction }) {
  const active = field === activeField;
  const ariaSort = active ? (direction === 'ASC' ? 'ascending' : 'descending') : 'none';
  return html`
    <th scope="col" aria-sort="${ariaSort}">
      <button type="button" class="inline-flex min-h-[32px] items-center gap-1 rounded px-1 text-xs font-semibold uppercase tracking-wide hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:text-teal-200" data-action="sort" data-field="${field}">
        ${label}
        <span class="${active ? 'text-teal-700 dark:text-teal-300' : 'text-slate-400'}" aria-hidden="true">${icon('chevron-down', active && direction === 'ASC' ? 'h-3 w-3 rotate-180' : 'h-3 w-3')}</span>
      </button>
    </th>
  `;
}

let toastTimer = null;

export function announce(message) {
  const region = document.getElementById('live-region');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 30);
}

export function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

export function focusRouteHeading(root = document) {
  const heading = root.querySelector('[data-route-heading]');
  if (heading) heading.focus({ preventScroll: true });
  else document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

export function inlineSpinner(label = 'Working') {
  return html`<span class="inline-flex items-center gap-2"><span class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span><span>${label}</span></span>`;
}

export function keyValueList(items) {
  return html`
    <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      ${items.map(({ term, value }) => html`
        <div>
          <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">${term}</dt>
          <dd class="mt-1 text-sm text-slate-800 dark:text-slate-100">${value ?? '—'}</dd>
        </div>
      `)}
    </dl>
  `;
}
