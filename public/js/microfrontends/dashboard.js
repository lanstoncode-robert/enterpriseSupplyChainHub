import { gql, errorMessage } from '../gql.js';
import { html } from '../html.js';
import {
  announce,
  banner,
  chainBadge,
  emptyState,
  errorState,
  icon,
  loadingState,
  metricBar,
  pageHeader,
  riskBadge,
  sectionCard,
  statCard,
  statusBadge,
} from '../ui.js';
import { spendTrendChart } from '../charts.js';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  relativeTime,
  titleCase,
} from '../format.js';

export const meta = {
  name: 'dashboard',
  title: 'Dashboard',
  route: '/dashboard',
};

const DASHBOARD_QUERY = /* GraphQL */ `
  query Dashboard($months: Int!) {
    metrics(months: $months) {
      totalOrders
      openOrders
      onTimeDeliveryRate
      averageLeadTimeDays
      totalSpend
      atRiskOrders
      traceabilityCoveragePct
      currency
      lastUpdated
      byStatus { status count }
      riskDistribution { level count }
      spendTrend { month spend orders }
      chainIntegrity { valid invalid totalRecords verifiedAt }
    }
    recent: orders(first: 6, sort: { field: CREATED_AT, direction: DESC }) {
      nodes {
        id
        poNumber
        status
        totalValue
        currency
        expectedDeliveryAt
        riskLevel
        supplier { id name }
      }
    }
    attention: orders(first: 4, filter: { riskLevel: [HIGH, CRITICAL] }, sort: { field: RISK, direction: DESC }) {
      nodes {
        id
        poNumber
        status
        riskScore
        riskLevel
        expectedDeliveryAt
        supplier { name }
      }
    }
    invalid: traceabilityRecords(first: 3, filter: { onlyInvalid: true }) {
      id
      lotCode
      product { name }
      verification { reason }
    }
    gatewayInfo {
      version
      strategy
      dataCounts { orders suppliers traceabilityRecords }
      subgraphs { name typeCount resolverCount }
    }
  }
`;

function renderRecentOrders(nodes) {
  if (!nodes.length) {
    return emptyState({ title: 'No purchase orders yet', message: 'Create an order to populate the pipeline.' });
  }
  return html`
    <div class="overflow-x-auto">
      <table class="data-table">
        <caption class="sr-only">Most recently created purchase orders</caption>
        <thead>
          <tr>
            <th scope="col">Purchase order</th>
            <th scope="col">Supplier</th>
            <th scope="col">Status</th>
            <th scope="col" class="text-right">Value</th>
            <th scope="col">Expected</th>
          </tr>
        </thead>
        <tbody>
          ${nodes.map((order) => html`
            <tr>
              <td>
                <a class="link font-mono text-xs" href="#/orders/${encodeURIComponent(order.poNumber)}">${order.poNumber}</a>
              </td>
              <td class="max-w-[16rem] truncate">${order.supplier.name}</td>
              <td>${statusBadge(order.status)}</td>
              <td class="text-right tabular-nums">${formatCurrency(order.totalValue, order.currency)}</td>
              <td class="whitespace-nowrap text-xs">${formatDate(order.expectedDeliveryAt)}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function renderAttention(nodes) {
  if (!nodes.length) {
    return banner({
      tone: 'success',
      title: 'No open orders at high or critical risk',
      message: 'Supplier, delay, and evidence signals are currently within tolerance.',
    });
  }
  return html`
    <ul class="space-y-3" role="list">
      ${nodes.map((order) => html`
        <li>
          <a href="#/orders/${encodeURIComponent(order.poNumber)}" class="block rounded-lg border border-slate-200 p-3 transition-colors hover:border-teal-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-slate-700 dark:hover:border-teal-700 dark:hover:bg-slate-800/50">
            <div class="flex items-start justify-between gap-2">
              <span class="font-mono text-xs font-semibold text-slate-900 dark:text-white">${order.poNumber}</span>
              ${riskBadge(order.riskLevel, { score: order.riskScore })}
            </div>
            <p class="mt-1 truncate text-xs text-slate-600 dark:text-slate-300">${order.supplier.name}</p>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Due ${relativeTime(order.expectedDeliveryAt)}</p>
          </a>
        </li>
      `)}
    </ul>
  `;
}

function renderDashboard(data) {
  const { metrics, recent, attention, invalid, gatewayInfo } = data;
  const statusTotal = metrics.byStatus.reduce((sum, item) => sum + item.count, 0) || 1;
  const riskTotal = metrics.riskDistribution.reduce((sum, item) => sum + item.count, 0) || 1;
  const statusRows = [...metrics.byStatus].filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  const riskRows = metrics.riskDistribution.filter((item) => item.count > 0);

  const integrityBanner = metrics.chainIntegrity.invalid > 0
    ? banner({
        tone: 'warning',
        title: `${metrics.chainIntegrity.invalid} chain-of-custody exception${metrics.chainIntegrity.invalid === 1 ? '' : 's'} detected`,
        message: 'The integrity hash chain does not match for at least one lot. Open traceability to inspect the exact event where verification broke.',
        action: html`<a class="btn-secondary" href="#/traceability?invalid=1">Review exception</a>`,
        role: 'status',
      })
    : '';

  return html`
    <div class="space-y-6">
      ${pageHeader({
        eyebrow: 'Operations overview',
        title: 'Supply chain at a glance',
        description: 'Orders, supplier exposure, shipment performance, and chain-of-custody evidence stitched into one view.',
        actions: html`
          <button type="button" class="btn-secondary" data-action="refresh">${icon('refresh')}Refresh</button>
          <a href="#/orders" class="btn-primary">View orders</a>
        `,
      })}

      ${integrityBanner}

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        ${statCard({
          label: 'Open orders',
          value: formatNumber(metrics.openOrders, { maximumFractionDigits: 0 }),
          helper: `${metrics.totalOrders} orders in the portfolio`,
          iconName: 'orders',
          tone: 'teal',
          href: '#/orders',
        })}
        ${statCard({
          label: 'On-time delivery',
          value: formatPercent(metrics.onTimeDeliveryRate),
          helper: `${metrics.averageLeadTimeDays} day average lead time`,
          iconName: 'clock',
          tone: 'emerald',
        })}
        ${statCard({
          label: 'Portfolio spend',
          value: formatCurrency(metrics.totalSpend, metrics.currency, { compact: true }),
          helper: 'Non-cancelled orders, all time',
          iconName: 'package',
          tone: 'sky',
        })}
        ${statCard({
          label: 'At-risk orders',
          value: formatNumber(metrics.atRiskOrders, { maximumFractionDigits: 0 }),
          helper: 'High or critical, still open',
          iconName: 'alert',
          tone: 'rose',
          href: '#/orders?risk=HIGH',
        })}
        ${statCard({
          label: 'Traceability coverage',
          value: formatPercent(metrics.traceabilityCoveragePct),
          helper: `${metrics.chainIntegrity.valid} of ${metrics.chainIntegrity.totalRecords} chains verify`,
          iconName: 'shield',
          tone: 'violet',
          href: '#/traceability',
        })}
      </div>

      <section class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4" aria-label="Order pipeline by status">
        <h2 class="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Order pipeline</h2>
        <ul class="flex flex-wrap gap-2" role="list">
          ${statusRows.map((item) => html`
            <li class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-0.5 pr-2.5 dark:border-slate-700 dark:bg-slate-800">
              ${statusBadge(item.status)}
              <span class="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">${item.count}</span>
            </li>
          `)}
        </ul>
      </section>

      <div class="grid gap-6 lg:grid-cols-3">
        ${sectionCard({
          title: 'Spend trend',
          description: 'Value of non-cancelled purchase orders by creation month.',
          className: 'lg:col-span-2',
          body: spendTrendChart({
            points: metrics.spendTrend,
            currency: metrics.currency,
            title: 'Purchase order spend by month',
          }),
        })}
        ${sectionCard({
          title: 'Risk & integrity',
          description: 'Composite supplier, delay, and evidence signals.',
          body: html`
            <ul class="space-y-4" role="list">
              ${riskRows.map((item) => metricBar({
                label: `${titleCase(item.level)} risk`,
                value: item.count,
                max: riskTotal,
                display: `${item.count}`,
              }))}
            </ul>
            <div class="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div class="flex items-center justify-between gap-3">
                <h3 class="text-sm font-semibold text-slate-900 dark:text-white">Chain integrity</h3>
                ${chainBadge(metrics.chainIntegrity.invalid === 0, {
                  label: metrics.chainIntegrity.invalid === 0 ? 'All chains verified' : `${metrics.chainIntegrity.invalid} exception${metrics.chainIntegrity.invalid === 1 ? '' : 's'}`,
                })}
              </div>
              <p class="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                ${metrics.chainIntegrity.valid} of ${metrics.chainIntegrity.totalRecords} lot chains recompute to their recorded SHA-256 digest.
              </p>
              ${invalid.length
                ? html`<ul class="mt-3 space-y-2" role="list">
                    ${invalid.map((record) => html`
                      <li class="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        <a class="font-semibold underline decoration-rose-300 underline-offset-2" href="#/traceability/${encodeURIComponent(record.lotCode)}">${record.lotCode}</a>
                        <span class="block truncate opacity-90">${record.product.name}</span>
                      </li>
                    `)}
                  </ul>`
                : ''}
            </div>
          `,
        })}
      </div>

      <div class="grid gap-6 lg:grid-cols-3">
        ${sectionCard({
          title: 'Needs attention',
          description: 'Highest-risk open orders, ranked by the gateway.',
          body: renderAttention(attention.nodes),
        })}
        ${sectionCard({
          title: 'Recent purchase orders',
          description: 'Newest orders across every supplier and region.',
          className: 'lg:col-span-2',
          actions: html`<a href="#/orders" class="btn-ghost">All orders${html`<span aria-hidden="true"> →</span>`}</a>`,
          body: renderRecentOrders(recent.nodes),
        })}
      </div>

      <section class="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between" aria-label="Gateway composition">
        <div>
          <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Stitched by the GraphQL gateway</h2>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            ${gatewayInfo.strategy} · ${gatewayInfo.subgraphs.length} subgraphs · ${formatNumber(gatewayInfo.dataCounts.traceabilityRecords, { maximumFractionDigits: 0 })} lot records
          </p>
        </div>
        <ul class="flex flex-wrap gap-2" role="list">
          ${gatewayInfo.subgraphs.map((subgraph) => html`
            <li class="badge border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              ${subgraph.name}<span class="font-normal opacity-70">${subgraph.typeCount} types</span>
            </li>
          `)}
        </ul>
      </section>
    </div>
  `;
}

export async function mount(root, ctx) {
  let disposed = false;
  let controller = null;

  const load = async ({ initial = false } = {}) => {
    controller?.abort();
    controller = new AbortController();
    if (initial) {
      root.innerHTML = loadingState({ label: 'Loading supply chain overview' }).value;
    } else {
      root.setAttribute('aria-busy', 'true');
    }
    try {
      const data = await gql(DASHBOARD_QUERY, { months: 6 }, { signal: controller.signal });
      if (disposed) return;
      ctx.setLastUpdated(data.metrics.lastUpdated);
      root.innerHTML = renderDashboard(data).value;
      ctx.setTitle('Dashboard');
      if (!initial) {
        announce('Dashboard refreshed.');
        ctx.showToast('Dashboard refreshed.');
      }
    } catch (error) {
      if (disposed || error.name === 'AbortError') return;
      root.innerHTML = errorState({
        title: 'The overview could not be loaded',
        message: errorMessage(error),
      }).value;
    } finally {
      root.removeAttribute('aria-busy');
    }
  };

  const onClick = (event) => {
    const refresh = event.target.closest?.('[data-action="refresh"]');
    if (refresh) {
      event.preventDefault();
      load();
      return;
    }
    if (event.target.closest?.('[data-action="retry"]')) {
      event.preventDefault();
      load();
    }
  };

  root.addEventListener('click', onClick);
  root.innerHTML = loadingState({ label: 'Loading supply chain overview' }).value;
  await load({ initial: true });

  return () => {
    disposed = true;
    controller?.abort();
    root.removeEventListener('click', onClick);
  };
}
