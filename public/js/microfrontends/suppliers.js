import { gql, errorMessage } from '../gql.js';
import { html } from '../html.js';
import {
  emptyState,
  errorState,
  icon,
  loadingState,
  pageHeader,
  riskBadge,
} from '../ui.js';
import { formatCurrency, formatNumber } from '../format.js';

export const meta = {
  name: 'suppliers',
  title: 'Suppliers',
  route: '/suppliers',
};

const SUPPLIERS_QUERY = /* GraphQL */ `
  query Suppliers($search: String, $riskLevel: [RiskLevel!]) {
    suppliers(search: $search, riskLevel: $riskLevel) {
      id
      name
      country
      region
      tier
      riskLevel
      certifications
      contactEmail
      onTimeRate
      leadTimeDays
      activeOrders
      products { id sku name category unitPrice uom }
    }
  }
`;

function productCategories(products) {
  return [...new Set(products.map((product) => product.category))];
}

function renderSupplierCard(supplier) {
  const categories = productCategories(supplier.products);
  return html`
    <li class="card flex flex-col p-5">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-base font-semibold text-slate-900 dark:text-white">${supplier.name}</h2>
          <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">${supplier.country} · ${supplier.region} · Tier ${supplier.tier}</p>
        </div>
        ${riskBadge(supplier.riskLevel)}
      </div>

      <dl class="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">On-time</dt>
          <dd class="mt-0.5 font-semibold tabular-nums">${(supplier.onTimeRate * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Lead time</dt>
          <dd class="mt-0.5 font-semibold tabular-nums">${supplier.leadTimeDays} d</dd>
        </div>
        <div>
          <dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Active POs</dt>
          <dd class="mt-0.5 font-semibold tabular-nums">${supplier.activeOrders}</dd>
        </div>
      </dl>

      <div class="mt-4">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Portfolio</p>
        <p class="mt-1 text-sm text-slate-700 dark:text-slate-200">
          ${formatNumber(supplier.products.length, { maximumFractionDigits: 0 })} product${supplier.products.length === 1 ? '' : 's'}
          <span class="text-slate-500 dark:text-slate-400">· ${categories.slice(0, 3).join(', ')}${categories.length > 3 ? '…' : ''}</span>
        </p>
        <ul class="mt-2 space-y-1" role="list">
          ${supplier.products.slice(0, 2).map((product) => html`
            <li class="flex items-baseline justify-between gap-2 text-xs">
              <span class="truncate text-slate-600 dark:text-slate-300">${product.name}</span>
              <span class="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">${formatCurrency(product.unitPrice, 'USD', { digits: 2 })}/${product.uom}</span>
            </li>
          `)}
        </ul>
      </div>

      <div class="mt-4 flex flex-wrap gap-1.5">
        ${supplier.certifications.map((certification) => html`<span class="badge badge-neutral">${certification}</span>`)}
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <a class="btn-secondary" href="#/orders?supplierId=${encodeURIComponent(supplier.id)}">${icon('orders')}View orders</a>
        <a class="link text-xs" href="mailto:${supplier.contactEmail}">${supplier.contactEmail}</a>
      </div>
    </li>
  `;
}

function renderShell() {
  return html`
    ${pageHeader({
      eyebrow: 'Supplier network',
      title: 'Supplier portfolio',
      description: 'Compare delivery reliability, lead time, certifications, and active commitments across the supplier base.',
      actions: html`<a class="btn-secondary" href="#/orders">${icon('orders')}All orders</a>`,
    })}

    <section class="card mb-4 p-4 sm:p-5" aria-label="Filter suppliers">
      <form id="supplier-form" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div class="lg:col-span-3">
          <label for="supplier-search" class="field-label">Search suppliers</label>
          <input id="supplier-search" type="search" class="input mt-1.5" placeholder="Name, country, or region" autocomplete="off" />
        </div>
        <div class="lg:col-span-2">
          <label for="supplier-risk" class="field-label">Risk level</label>
          <select id="supplier-risk" class="select mt-1.5">
            <option value="">All risk levels</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>
        <div class="flex items-end">
          <button type="submit" class="btn-primary w-full">${icon('search')}Apply</button>
        </div>
      </form>
    </section>

    <div id="supplier-results" tabindex="-1" aria-label="Supplier results" aria-busy="true" class="outline-none">
      <div class="space-y-3" role="status" aria-live="polite">
        <span class="sr-only">Loading suppliers</span>
        <div class="h-5 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="h-72 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"></div>
          <div class="h-72 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"></div>
        </div>
      </div>
    </div>
  `;
}

function renderResults(suppliers, state) {
  return html`
    <p class="mb-3 text-sm text-slate-600 dark:text-slate-300" role="status">
      <span class="font-semibold">${suppliers.length}</span> supplier${suppliers.length === 1 ? '' : 's'}
      ${state.search || state.risk ? 'match the current filters' : 'in the network'}
    </p>
    ${suppliers.length === 0
      ? emptyState({
          title: 'No suppliers match',
          message: 'Try a broader search or clear the risk filter.',
          iconName: 'suppliers',
        })
      : html`<ul class="grid gap-4 lg:grid-cols-2" role="list">${suppliers.map(renderSupplierCard)}</ul>`}
  `;
}

export async function mount(root, ctx) {
  let disposed = false;
  let controller = null;
  const state = { search: '', risk: '', data: null };

  root.innerHTML = renderShell().value;
  const form = root.querySelector('#supplier-form');
  const results = root.querySelector('#supplier-results');
  const searchInput = root.querySelector('#supplier-search');
  const riskSelect = root.querySelector('#supplier-risk');

  const load = async () => {
    controller?.abort();
    controller = new AbortController();
    results.setAttribute('aria-busy', 'true');
    try {
      const data = await gql(SUPPLIERS_QUERY, {
        search: state.search || null,
        riskLevel: state.risk ? [state.risk] : null,
      }, { signal: controller.signal });
      if (disposed) return;
      state.data = data;
      results.innerHTML = renderResults(data.suppliers, state).value;
      ctx.setTitle('Suppliers');
    } catch (error) {
      if (disposed || error.name === 'AbortError') return;
      results.innerHTML = errorState({
        title: 'Suppliers could not be loaded',
        message: errorMessage(error),
      }).value;
    } finally {
      results.removeAttribute('aria-busy');
    }
  };

  const onSubmit = (event) => {
    event.preventDefault();
    state.search = searchInput.value.trim();
    state.risk = riskSelect.value;
    load();
  };

  const onChange = (event) => {
    if (event.target.id === 'supplier-risk') {
      state.risk = event.target.value;
      load();
    }
  };

  const onClick = (event) => {
    if (event.target.closest('[data-action="retry"]')) {
      event.preventDefault();
      load();
    }
  };

  form.addEventListener('submit', onSubmit);
  form.addEventListener('change', onChange);
  root.addEventListener('click', onClick);

  root.querySelector('#supplier-results').innerHTML = loadingState({ label: 'Loading suppliers' }).value;
  await load();

  return () => {
    disposed = true;
    controller?.abort();
    form.removeEventListener('submit', onSubmit);
    form.removeEventListener('change', onChange);
    root.removeEventListener('click', onClick);
  };
}
