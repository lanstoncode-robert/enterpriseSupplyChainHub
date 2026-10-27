import { html } from './html.js';
import { formatCurrency, formatMonth } from './format.js';

let chartSequence = 0;

/**
 * Accessible SVG line chart with a visually hidden summary and an expandable
 * data table. The chart is decorative-plus-informative; the table is the
 * keyboard/screen-reader equivalent of the same numbers.
 */
export function spendTrendChart({ points = [], currency = 'USD', title = 'Spend by month' }) {
  if (!points.length) {
    return html`<p class="text-sm text-slate-500 dark:text-slate-400">No spend history is available for this period.</p>`;
  }

  const id = `chart-${++chartSequence}`;
  const width = 720;
  const height = 260;
  const padding = { top: 18, right: 18, bottom: 36, left: 70 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(1, ...points.map((point) => Number(point.spend) || 0));
  const x = (index) => padding.left + (points.length === 1 ? innerWidth / 2 : (innerWidth * index) / (points.length - 1));
  const y = (value) => padding.top + innerHeight - (Math.max(0, Number(value) || 0) / maximum) * innerHeight;

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.spend).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${padding.top + innerHeight} L${x(0).toFixed(1)},${padding.top + innerHeight} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = maximum * fraction;
    const yPosition = y(value);
    return html`
      <line x1="${padding.left}" y1="${yPosition.toFixed(1)}" x2="${width - padding.right}" y2="${yPosition.toFixed(1)}" class="stroke-slate-200 dark:stroke-slate-700" stroke-width="1" stroke-dasharray="3 5" />
      <text x="${padding.left - 10}" y="${(yPosition + 4).toFixed(1)}" text-anchor="end" font-size="11" class="fill-slate-500 dark:fill-slate-400">${formatCurrency(value, currency, { compact: true })}</text>
    `;
  });

  const xLabels = points.map((point, index) => {
    const show = points.length <= 8 || index % 2 === 0 || index === points.length - 1;
    if (!show) return '';
    const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
    return html`<text x="${x(index).toFixed(1)}" y="${height - 10}" text-anchor="${anchor}" font-size="11" class="fill-slate-500 dark:fill-slate-400">${formatMonth(point.month)}</text>`;
  });

  const dots = points.map((point, index) => html`
    <circle cx="${x(index).toFixed(1)}" cy="${y(point.spend).toFixed(1)}" r="4" class="fill-teal-600 dark:fill-teal-300">
      <title>${formatMonth(point.month)}: ${formatCurrency(point.spend, currency)} across ${point.orders} orders</title>
    </circle>
  `);

  const total = points.reduce((sum, point) => sum + (Number(point.spend) || 0), 0);
  const totalOrders = points.reduce((sum, point) => sum + (Number(point.orders) || 0), 0);

  return html`
    <figure>
      <svg viewBox="0 0 ${width} ${height}" class="h-auto w-full" role="img" aria-labelledby="${id}-title ${id}-desc">
        <title id="${id}-title">${title}</title>
        <desc id="${id}-desc">Line chart of non-cancelled purchase order spend over ${points.length} months, totalling ${formatCurrency(total, currency)} across ${totalOrders} orders.</desc>
        ${gridLines}
        <path d="${area}" class="fill-teal-600/10 dark:fill-teal-300/10" opacity="1" />
        <path d="${line}" fill="none" class="stroke-teal-600 dark:stroke-teal-300" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${dots}
        ${xLabels}
      </svg>
      <figcaption class="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Non-cancelled purchase order value by creation month. Hover a point for the exact figure.
      </figcaption>
      <details class="mt-3">
        <summary class="cursor-pointer rounded text-xs font-semibold text-teal-800 underline decoration-teal-300 underline-offset-2 hover:text-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-teal-300 dark:decoration-teal-700 dark:hover:text-teal-200">View chart data as a table</summary>
        <div class="mt-3 overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-left text-xs dark:divide-slate-700">
            <caption class="sr-only">${title} data</caption>
            <thead>
              <tr>
                <th scope="col" class="px-2 py-2 font-semibold text-slate-600 dark:text-slate-300">Month</th>
                <th scope="col" class="px-2 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Spend</th>
                <th scope="col" class="px-2 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Orders</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              ${points.map((point) => html`
                <tr>
                  <th scope="row" class="px-2 py-1.5 font-medium text-slate-700 dark:text-slate-200">${formatMonth(point.month)}</th>
                  <td class="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">${formatCurrency(point.spend, currency)}</td>
                  <td class="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">${point.orders}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  `;
}
