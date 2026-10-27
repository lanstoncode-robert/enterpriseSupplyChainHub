import { gql, errorMessage } from '../gql.js';
import { html, raw } from '../html.js';
import {
  banner,
  chainBadge,
  emptyState,
  errorState,
  icon,
  keyValueList,
  loadingState,
  pageHeader,
  pagination,
  priorityBadge,
  riskBadge,
  sortHeader,
  statusBadge,
} from '../ui.js';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  relativeTime,
  titleCase,
} from '../format.js';

export const meta = {
  name: 'orders',
  title: 'Orders',
  route: '/orders',
};

const PAGE_SIZE = 15;
const STATUS_VALUES = ['DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'ON_HOLD', 'CANCELLED'];
const RISK_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const LIST_QUERY = /* GraphQL */ `
  query Orders($filter: OrderFilter, $sort: OrderSort, $first: Int, $after: String) {
    orders(filter: $filter, sort: $sort, first: $first, after: $after) {
      totalCount
      aggregates { totalValue atRiskCount openCount }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      nodes {
        id
        poNumber
        status
        priority
        createdAt
        expectedDeliveryAt
        totalValue
        currency
        lineCount
        riskScore
        riskLevel
        supplier { id name }
      }
    }
    suppliers { id name }
  }
`;

const DETAIL_QUERY = /* GraphQL */ `
  query OrderDetail($poNumber: String!) {
    order(poNumber: $poNumber) {
      id
      poNumber
      status
      priority
      buyer
      currency
      incoterms
      totalValue
      createdAt
      expectedDeliveryAt
      updatedAt
      deliveredAt
      notes
      riskScore
      riskLevel
      riskFactors
      daysUntilDue
      allowedTransitions
      lineCount
      supplier {
        id
        name
        country
        region
        tier
        riskLevel
        onTimeRate
        leadTimeDays
        activeOrders
        certifications
        contactEmail
      }
      destination { id name city country }
      lines {
        id
        lineNumber
        quantity
        unitPrice
        lineTotal
        receivedQuantity
        backorderQuantity
        status
        product {
          id
          sku
          name
          category
          uom
          sustainability { recycledContentPct carbonKgPerUnit }
        }
      }
      shipments {
        id
        trackingNumber
        carrier
        mode
        status
        delayHours
        temperatureControlled
        departedAt
        estimatedArrivalAt
        deliveredAt
        origin { id name city country }
        destination { id name city country }
        milestones { status occurredAt location note }
      }
      traceabilitySummary { recordCount verifiedCount invalidCount lastEventAt }
      traceability {
        id
        lotCode
        quantity
        unit
        chainVerified
        createdAt
        product { id name }
        verification { reason }
        events { id occurredAt type }
      }
      statusHistory { status at note }
    }
  }
`;

const CREATE_FORM_QUERY = /* GraphQL */ `
  query OrderForm {
    suppliers {
      id
      name
      country
      riskLevel
      products { id sku name unitPrice uom }
    }
  }
`;

const CREATE_MUTATION = /* GraphQL */ `
  mutation CreateOrder($input: CreatePurchaseOrderInput!) {
    createPurchaseOrder(input: $input) { id poNumber status }
  }
`;

const UPDATE_STATUS_MUTATION = /* GraphQL */ `
  mutation UpdateOrderStatus($input: UpdateOrderStatusInput!) {
    updateOrderStatus(input: $input) { id poNumber status updatedAt }
  }
`;

const LINE_TONES = {
  RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  SHIPPED: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
  IN_PRODUCTION: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300',
  PENDING: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  CANCELLED: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
};

const SHIPMENT_TONES = {
  DELIVERED: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  IN_TRANSIT: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
  DELAYED: 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300',
  PLANNED: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  BOOKED: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  EXCEPTION: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
};

function lineStatusBadge(status) {
  return html`<span class="badge ${LINE_TONES[status] ?? LINE_TONES.PENDING}">${titleCase(status)}</span>`;
}

function shipmentStatusBadge(status) {
  return html`<span class="badge ${SHIPMENT_TONES[status] ?? SHIPMENT_TONES.PLANNED}">${titleCase(status)}</span>`;
}

function option(value, label) {
  return html`<option value="${value}">${label}</option>`;
}

function selectOptions(values, labeler = titleCase) {
  return values.map((value) => option(value, labeler(value)));
}

function buildFilter(state) {
  const filter = {};
  if (state.search.trim()) filter.search = state.search.trim();
  if (state.status) filter.status = [state.status];
  if (state.risk) filter.riskLevel = [state.risk];
  if (state.supplierId) filter.supplierId = state.supplierId;
  return filter;
}

function sortLabel(field, direction) {
  const labels = {
    CREATED_AT: 'creation date',
    EXPECTED_DELIVERY: 'expected delivery',
    TOTAL_VALUE: 'order value',
    RISK: 'risk score',
  };
  return `${labels[field] ?? field} ${direction === 'ASC' ? 'ascending' : 'descending'}`;
}

/* ------------------------------------------------------------------ *
 * List view                                                           *
 * ------------------------------------------------------------------ */

function renderListShell(state) {
  return html`
    ${pageHeader({
      eyebrow: 'Order management',
      title: 'Purchase orders',
      description: 'Reconcile orders across suppliers, track risk, and open any purchase order for lines, shipments, and lot-level evidence.',
      actions: html`<a href="#/orders/new" class="btn-primary">${icon('plus')}New purchase order</a>`,
    })}

    <section class="card mb-4 p-4 sm:p-5" aria-label="Filter purchase orders">
      <form id="orders-filters" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div class="lg:col-span-2">
          <label for="order-search" class="field-label">Search</label>
          <input id="order-search" type="search" class="input mt-1.5" value="${state.search}" placeholder="PO number, supplier, buyer, product" autocomplete="off" />
        </div>
        <div>
          <label for="filter-status" class="field-label">Status</label>
          <select id="filter-status" class="select mt-1.5">
            <option value="">All statuses</option>
            ${selectOptions(STATUS_VALUES)}
          </select>
        </div>
        <div>
          <label for="filter-risk" class="field-label">Risk</label>
          <select id="filter-risk" class="select mt-1.5">
            <option value="">All risk levels</option>
            ${selectOptions(RISK_VALUES)}
          </select>
        </div>
        <div class="lg:col-span-2">
          <label for="filter-supplier" class="field-label">Supplier</label>
          <select id="filter-supplier" class="select mt-1.5">
            <option value="">All suppliers</option>
          </select>
        </div>
        <div class="lg:col-span-2">
          <label for="filter-sort" class="field-label">Sort by</label>
          <select id="filter-sort" class="select mt-1.5">
            <option value="CREATED_AT">Creation date</option>
            <option value="EXPECTED_DELIVERY">Expected delivery</option>
            <option value="TOTAL_VALUE">Order value</option>
            <option value="RISK">Risk score</option>
          </select>
        </div>
        <div>
          <label for="filter-direction" class="field-label">Direction</label>
          <select id="filter-direction" class="select mt-1.5">
            <option value="DESC">Descending</option>
            <option value="ASC">Ascending</option>
          </select>
        </div>
        <div class="flex items-end lg:col-span-3">
          <button type="reset" class="btn-secondary">${icon('refresh')}Reset filters</button>
        </div>
      </form>
    </section>

    <div id="orders-results" tabindex="-1" aria-label="Purchase order results" aria-busy="true" class="outline-none">
      <div class="space-y-3" role="status" aria-live="polite">
        <span class="sr-only">Loading purchase orders</span>
        <div class="h-5 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
        <div class="h-72 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"></div>
      </div>
    </div>
  `;
}

function renderListResults(state) {
  const data = state.data;
  const { nodes, totalCount, pageInfo, aggregates } = data;
  const pageNumber = state.afterStack.length + 1;
  const start = totalCount === 0 ? 0 : state.afterStack.length * PAGE_SIZE + 1;
  const end = start === 0 ? 0 : start + nodes.length - 1;
  const hasFilters = Boolean(state.search || state.status || state.risk || state.supplierId);

  const rows = nodes.map((order) => {
    const overdue = ['DELIVERED', 'CANCELLED'].includes(order.status) === false
      && Date.parse(order.expectedDeliveryAt) < Date.now();
    return html`
      <tr>
        <td>
          <a class="link font-mono text-xs" href="#/orders/${encodeURIComponent(order.poNumber)}">${order.poNumber}</a>
          <span class="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">${formatDate(order.createdAt)}</span>
        </td>
        <td class="max-w-[14rem] truncate">${order.supplier.name}</td>
        <td>${statusBadge(order.status)}</td>
        <td>${riskBadge(order.riskLevel, { score: order.riskScore })}</td>
        <td class="whitespace-nowrap text-right tabular-nums">${formatCurrency(order.totalValue, order.currency)}</td>
        <td class="whitespace-nowrap">
          <span>${formatDate(order.expectedDeliveryAt)}</span>
          <span class="mt-0.5 block text-[11px] ${overdue ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}">
            ${overdue ? 'Overdue · ' : ''}${relativeTime(order.expectedDeliveryAt)}
          </span>
        </td>
        <td class="text-right tabular-nums">${order.lineCount}</td>
        <td class="text-right">
          <a class="link whitespace-nowrap text-xs" href="#/orders/${encodeURIComponent(order.poNumber)}">View<span class="sr-only"> ${order.poNumber}</span></a>
        </td>
      </tr>
    `;
  });

  return html`
    <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-sm text-slate-600 dark:text-slate-300" role="status">
        Showing <span class="font-semibold">${start}–${end}</span> of <span class="font-semibold">${totalCount}</span> orders
        · <span class="font-semibold">${formatCurrency(aggregates.totalValue)}</span> filtered value
        · <span class="font-semibold">${aggregates.atRiskCount}</span> at risk
      </p>
      <p class="text-xs text-slate-500 dark:text-slate-400">Page ${pageNumber} · sorted by ${sortLabel(state.sortField, state.direction)}</p>
    </div>

    ${nodes.length === 0
      ? emptyState({
          title: 'No orders match these filters',
          message: hasFilters ? 'Try widening the search, clearing a status or risk filter, or choosing another supplier.' : 'Create the first purchase order to start tracking supplier commitments.',
          iconName: 'orders',
          action: hasFilters
            ? html`<button type="button" class="btn-secondary" data-action="reset-filters">${icon('refresh')}Clear filters</button>`
            : html`<a class="btn-primary" href="#/orders/new">${icon('plus')}New purchase order</a>`,
        })
      : html`
        <div class="table-wrap">
          <table class="data-table">
            <caption class="sr-only">Purchase orders, page ${pageNumber}, sorted by ${sortLabel(state.sortField, state.direction)}</caption>
            <thead>
              <tr>
                <th scope="col">Purchase order</th>
                <th scope="col">Supplier</th>
                <th scope="col">Status</th>
                ${sortHeader({ field: 'RISK', label: 'Risk', activeField: state.sortField, direction: state.direction })}
                ${sortHeader({ field: 'TOTAL_VALUE', label: 'Value', activeField: state.sortField, direction: state.direction })}
                ${sortHeader({ field: 'EXPECTED_DELIVERY', label: 'Expected', activeField: state.sortField, direction: state.direction })}
                <th scope="col" class="text-right">Lines</th>
                <th scope="col" class="text-right"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `}

    ${totalCount > 0
      ? html`<div class="mt-4">
          ${pagination({
            hasPreviousPage: state.afterStack.length > 0,
            hasNextPage: pageInfo.hasNextPage,
            label: 'Purchase order pages',
          })}
        </div>`
      : ''}
  `;
}

async function mountList(root, ctx) {
  let disposed = false;
  let controller = null;
  let searchTimer = null;

  const state = {
    search: ctx.route.query.get('search') ?? '',
    status: ctx.route.query.get('status') ?? '',
    risk: ctx.route.query.get('risk') ?? '',
    supplierId: ctx.route.query.get('supplierId') ?? '',
    sortField: 'CREATED_AT',
    direction: 'DESC',
    after: null,
    afterStack: [],
    data: null,
    suppliers: [],
  };

  root.innerHTML = renderListShell(state).value;
  const results = root.querySelector('#orders-results');
  const form = root.querySelector('#orders-filters');
  const searchInput = root.querySelector('#order-search');
  const statusSelect = root.querySelector('#filter-status');
  const riskSelect = root.querySelector('#filter-risk');
  const supplierSelect = root.querySelector('#filter-supplier');
  const sortSelect = root.querySelector('#filter-sort');
  const directionSelect = root.querySelector('#filter-direction');

  statusSelect.value = state.status;
  riskSelect.value = state.risk;
  sortSelect.value = state.sortField;
  directionSelect.value = state.direction;

  const syncSupplierOptions = () => {
    supplierSelect.replaceChildren();
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All suppliers';
    supplierSelect.append(all);
    for (const supplier of state.suppliers) {
      const item = document.createElement('option');
      item.value = supplier.id;
      item.textContent = supplier.name;
      supplierSelect.append(item);
    }
    supplierSelect.value = state.supplierId;
    if (supplierSelect.value !== state.supplierId) {
      state.supplierId = '';
      supplierSelect.value = '';
    }
  };

  const syncControls = () => {
    searchInput.value = state.search;
    statusSelect.value = state.status;
    riskSelect.value = state.risk;
    sortSelect.value = state.sortField;
    directionSelect.value = state.direction;
    supplierSelect.value = state.supplierId;
  };

  const resetPaging = () => {
    state.after = null;
    state.afterStack = [];
  };

  const load = async ({ focusResults = false, focusField = null, announceIt = false } = {}) => {
    controller?.abort();
    controller = new AbortController();
    results.setAttribute('aria-busy', 'true');
    if (!state.data) {
      results.innerHTML = html`
        <div class="space-y-3" role="status" aria-live="polite">
          <span class="sr-only">Loading purchase orders</span>
          <div class="h-5 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
          <div class="h-72 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"></div>
        </div>
      `.value;
    }
    try {
      const filter = buildFilter(state);
      const data = await gql(LIST_QUERY, {
        filter: Object.keys(filter).length ? filter : null,
        sort: { field: state.sortField, direction: state.direction },
        first: PAGE_SIZE,
        after: state.after,
      }, { signal: controller.signal });
      if (disposed) return;
      state.data = data.orders;
      state.suppliers = data.suppliers;
      syncSupplierOptions();
      results.innerHTML = renderListResults(state).value;
      if (announceIt) {
        ctx.announce(`${state.data.totalCount} orders match the current filters.`);
      }
      if (focusResults) results.focus({ preventScroll: true });
      if (focusField) {
        results.querySelector(`[data-action="sort"][data-field="${focusField}"]`)?.focus({ preventScroll: true });
      }
    } catch (error) {
      if (disposed || error.name === 'AbortError') return;
      results.innerHTML = errorState({
        title: 'Orders could not be loaded',
        message: errorMessage(error),
      }).value;
    } finally {
      results.removeAttribute('aria-busy');
    }
  };

  const resetFilters = () => {
    state.search = '';
    state.status = '';
    state.risk = '';
    state.supplierId = '';
    state.sortField = 'CREATED_AT';
    state.direction = 'DESC';
    syncControls();
    resetPaging();
    load({ announceIt: true });
  };

  const onInput = (event) => {
    if (event.target.id !== 'order-search') return;
    state.search = event.target.value;
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      resetPaging();
      load({ announceIt: true });
    }, 300);
  };

  const onChange = (event) => {
    switch (event.target.id) {
      case 'filter-status':
        state.status = event.target.value;
        break;
      case 'filter-risk':
        state.risk = event.target.value;
        break;
      case 'filter-supplier':
        state.supplierId = event.target.value;
        break;
      case 'filter-sort':
        state.sortField = event.target.value;
        break;
      case 'filter-direction':
        state.direction = event.target.value;
        break;
      default:
        return;
    }
    resetPaging();
    load({ announceIt: true });
  };

  const onSubmit = (event) => {
    event.preventDefault();
    resetPaging();
    load({ announceIt: true });
  };

  const onReset = (event) => {
    event.preventDefault();
    resetFilters();
  };

  const onClick = (event) => {
    if (event.target.closest('[data-action="reset-filters"]')) {
      event.preventDefault();
      resetFilters();
      return;
    }
    if (event.target.closest('[data-action="retry"]')) {
      event.preventDefault();
      load();
      return;
    }
    const sortButton = event.target.closest('[data-action="sort"]');
    if (sortButton) {
      const field = sortButton.dataset.field;
      if (state.sortField === field) state.direction = state.direction === 'ASC' ? 'DESC' : 'ASC';
      else {
        state.sortField = field;
        state.direction = 'DESC';
      }
      syncControls();
      resetPaging();
      load({ focusField: field, announceIt: true });
      return;
    }
    if (event.target.closest('[data-action="next-page"]')) {
      if (!state.data?.pageInfo.hasNextPage) return;
      state.afterStack.push(state.after);
      state.after = state.data.pageInfo.endCursor;
      load({ focusResults: true, announceIt: true });
      return;
    }
    if (event.target.closest('[data-action="previous-page"]')) {
      if (state.afterStack.length === 0) return;
      state.after = state.afterStack.pop() ?? null;
      load({ focusResults: true, announceIt: true });
    }
  };

  form.addEventListener('input', onInput);
  form.addEventListener('change', onChange);
  form.addEventListener('submit', onSubmit);
  form.addEventListener('reset', onReset);
  root.addEventListener('click', onClick);

  await load();

  return () => {
    disposed = true;
    controller?.abort();
    if (searchTimer) window.clearTimeout(searchTimer);
    form.removeEventListener('input', onInput);
    form.removeEventListener('change', onChange);
    form.removeEventListener('submit', onSubmit);
    form.removeEventListener('reset', onReset);
    root.removeEventListener('click', onClick);
  };
}

/* ------------------------------------------------------------------ *
 * Detail view                                                         *
 * ------------------------------------------------------------------ */

function renderSummary(order) {
  const summary = order.traceabilitySummary;
  return html`
    <section class="card" aria-label="Order summary">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 class="text-base font-semibold text-slate-900 dark:text-white">Order summary</h2>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Commercial terms and lifecycle dates.</p>
        </div>
        ${priorityBadge(order.priority)}
      </div>
      <div class="p-5">
        <dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Order value</dt>
            <dd class="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-white">${formatCurrency(order.totalValue, order.currency)}</dd>
          </div>
          <div>
            <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Expected delivery</dt>
            <dd class="mt-1 text-sm font-semibold text-slate-900 dark:text-white">${formatDate(order.expectedDeliveryAt)}</dd>
            <dd class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">${relativeTime(order.expectedDeliveryAt)}</dd>
          </div>
          <div>
            <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Line items</dt>
            <dd class="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-white">${order.lineCount}</dd>
          </div>
          <div>
            <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Traceability records</dt>
            <dd class="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-white">${summary.recordCount}</dd>
            <dd class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">${summary.verifiedCount} verified · ${summary.invalidCount} exception${summary.invalidCount === 1 ? '' : 's'}</dd>
          </div>
        </dl>
        <div class="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          ${keyValueList([
            { term: 'Supplier', value: html`<a class="link" href="#/orders?supplierId=${encodeURIComponent(order.supplier.id)}">${order.supplier.name}</a><span class="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">${order.supplier.country} · ${order.supplier.region}</span>` },
            { term: 'Buyer', value: order.buyer },
            { term: 'Destination', value: order.destination ? `${order.destination.name}, ${order.destination.city}` : '—' },
            { term: 'Incoterms', value: order.incoterms },
            { term: 'Created', value: `${formatDateTime(order.createdAt)} (${relativeTime(order.createdAt)})` },
            { term: 'Last updated', value: formatDateTime(order.updatedAt) },
            { term: 'Delivered', value: order.deliveredAt ? formatDateTime(order.deliveredAt) : 'Not delivered' },
            { term: 'Notes', value: order.notes || '—' },
          ])}
        </div>
      </div>
    </section>
  `;
}

function renderLines(order) {
  return html`
    <section class="card" aria-label="Order line items">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Line items</h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Ordered versus received quantities and line-level status.</p>
      </div>
      <div class="overflow-x-auto">
        <table class="data-table">
          <caption class="sr-only">Line items for ${order.poNumber}</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" class="text-right">Ordered</th>
              <th scope="col" class="text-right">Received</th>
              <th scope="col" class="text-right">Backorder</th>
              <th scope="col" class="text-right">Unit price</th>
              <th scope="col" class="text-right">Line total</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            ${order.lines.map((line) => html`
              <tr>
                <td>
                  <span class="block font-medium text-slate-900 dark:text-white">${line.product.name}</span>
                  <span class="mt-0.5 block font-mono text-[11px] text-slate-500 dark:text-slate-400">${line.product.sku} · ${line.product.category}</span>
                </td>
                <td class="text-right tabular-nums">${formatNumber(line.quantity)} ${line.product.uom}</td>
                <td class="text-right tabular-nums">${formatNumber(line.receivedQuantity)}</td>
                <td class="text-right tabular-nums ${line.backorderQuantity > 0 ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}">${formatNumber(line.backorderQuantity)}</td>
                <td class="text-right tabular-nums">${formatCurrency(line.unitPrice, order.currency, { digits: 2 })}</td>
                <td class="text-right tabular-nums">${formatCurrency(line.lineTotal, order.currency, { digits: 2 })}</td>
                <td>${lineStatusBadge(line.status)}</td>
              </tr>
            `)}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="5" class="text-right">Order total</td>
              <td class="text-right tabular-nums">${formatCurrency(order.totalValue, order.currency, { digits: 2 })}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;
}

function renderShipments(order) {
  return html`
    <section class="card" aria-label="Shipments">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Shipments</h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Carrier milestones and delay exposure.</p>
      </div>
      <div class="space-y-4 p-5">
        ${order.shipments.length === 0
          ? html`<p class="text-sm text-slate-500 dark:text-slate-400">No shipment has been booked for this order yet.</p>`
          : order.shipments.map((shipment) => html`
            <article class="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 class="font-semibold text-slate-900 dark:text-white">${shipment.carrier}</h3>
                  <p class="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">${shipment.trackingNumber}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  ${shipmentStatusBadge(shipment.status)}
                  ${shipment.temperatureControlled ? html`<span class="badge border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">Temperature controlled</span>` : ''}
                </div>
              </div>
              <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt class="text-xs text-slate-500 dark:text-slate-400">Mode</dt><dd class="mt-0.5 font-medium">${titleCase(shipment.mode)}</dd></div>
                <div><dt class="text-xs text-slate-500 dark:text-slate-400">Departed</dt><dd class="mt-0.5">${formatDate(shipment.departedAt)}</dd></div>
                <div><dt class="text-xs text-slate-500 dark:text-slate-400">ETA</dt><dd class="mt-0.5">${formatDate(shipment.estimatedArrivalAt)}</dd></div>
                <div><dt class="text-xs text-slate-500 dark:text-slate-400">Delay</dt><dd class="mt-0.5 ${shipment.delayHours > 0 ? 'font-semibold text-orange-700 dark:text-orange-300' : 'text-emerald-700 dark:text-emerald-300'}">${shipment.delayHours > 0 ? `${formatNumber(shipment.delayHours)} h` : 'On schedule'}</dd></div>
              </dl>
              <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">${shipment.origin.name} → ${shipment.destination.name}</p>
              ${shipment.milestones.length
                ? html`<ol class="mt-4 space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
                    ${shipment.milestones.map((milestone) => html`
                      <li class="relative">
                        <span class="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-teal-600 ring-4 ring-white dark:bg-teal-300 dark:ring-slate-900" aria-hidden="true"></span>
                        <p class="text-xs font-semibold text-slate-800 dark:text-slate-100">${titleCase(milestone.status)} <span class="font-normal text-slate-500 dark:text-slate-400">· ${formatDate(milestone.occurredAt, { time: true })}</span></p>
                        <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">${milestone.location}${milestone.note ? ` · ${milestone.note}` : ''}</p>
                      </li>
                    `)}
                  </ol>`
                : ''}
            </article>
          `)}
      </div>
    </section>
  `;
}

function renderTraceability(order) {
  const summary = order.traceabilitySummary;
  return html`
    <section class="card" aria-label="Traceability records">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 class="text-base font-semibold text-slate-900 dark:text-white">Traceability</h2>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">${summary.recordCount} lot record${summary.recordCount === 1 ? '' : 's'} · ${summary.verifiedCount} verified · ${summary.invalidCount} exception${summary.invalidCount === 1 ? '' : 's'}</p>
        </div>
        ${summary.recordCount > 0 ? chainBadge(summary.invalidCount === 0) : ''}
      </div>
      <div class="p-5">
        ${order.traceability.length === 0
          ? html`<p class="text-sm text-slate-500 dark:text-slate-400">No lot records are linked to this order yet. Traceability coverage for the portfolio is tracked on the dashboard.</p>`
          : html`<ul class="space-y-3" role="list">
              ${order.traceability.map((record) => html`
                <li class="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <a class="link font-mono text-xs" href="#/traceability/${encodeURIComponent(record.lotCode)}">${record.lotCode}</a>
                    ${chainBadge(record.chainVerified)}
                  </div>
                  <p class="mt-1 text-sm text-slate-700 dark:text-slate-200">${record.product.name} · ${formatNumber(record.quantity)} ${record.unit}</p>
                  <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">${record.events.length} events · last ${formatDateTime(record.events.at(-1)?.occurredAt)}</p>
                  ${record.chainVerified ? '' : html`<p class="mt-1 text-xs font-medium text-rose-700 dark:text-rose-300">${record.verification.reason}</p>`}
                </li>
              `)}
            </ul>`}
      </div>
    </section>
  `;
}

function renderHistory(order) {
  const history = [...order.statusHistory].reverse();
  return html`
    <section class="card" aria-label="Status history">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Status history</h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Every transition is recorded with its operator note.</p>
      </div>
      <ol class="space-y-4 p-5">
        ${history.map((change) => html`
          <li class="relative border-l border-slate-200 pl-4 dark:border-slate-700">
            <span class="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-teal-600 ring-4 ring-white dark:bg-teal-300 dark:ring-slate-900" aria-hidden="true"></span>
            <div class="flex flex-wrap items-center gap-2">
              ${statusBadge(change.status)}
              <time class="text-xs text-slate-500 dark:text-slate-400" datetime="${change.at}">${formatDateTime(change.at)}</time>
            </div>
            ${change.note ? html`<p class="mt-1 text-xs text-slate-600 dark:text-slate-300">${change.note}</p>` : ''}
          </li>
        `)}
      </ol>
    </section>
  `;
}

function renderStatusCard(order) {
  return html`
    <section class="card" aria-label="Update order status">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Update status</h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Transitions are validated by the order state machine.</p>
      </div>
      <div class="p-5">
        ${order.allowedTransitions.length === 0
          ? html`<p class="text-sm text-slate-500 dark:text-slate-400">This order is in a terminal state and cannot transition further.</p>`
          : html`
            <form id="status-form" class="space-y-4" novalidate>
              <div>
                <label for="status-select" class="field-label">New status</label>
                <select id="status-select" name="status" class="select mt-1.5" required>
                  <option value="">Choose a status</option>
                  ${order.allowedTransitions.map((status) => option(status, titleCase(status)))}
                </select>
              </div>
              <div>
                <label for="status-note" class="field-label">Note <span class="font-normal text-slate-500 dark:text-slate-400">(optional)</span></label>
                <textarea id="status-note" name="note" class="textarea mt-1.5" maxlength="1000" rows="3" placeholder="Reason, reference, or operator comment"></textarea>
              </div>
              <p id="status-error" class="field-error" role="alert"></p>
              <button type="submit" class="btn-primary w-full">Update status</button>
            </form>
          `}
      </div>
    </section>
  `;
}

function renderRiskCard(order) {
  return html`
    <section class="card" aria-label="Risk assessment">
      <div class="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 class="text-base font-semibold text-slate-900 dark:text-white">Risk assessment</h2>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Explainable, deterministic score.</p>
        </div>
        ${riskBadge(order.riskLevel)}
      </div>
      <div class="p-5">
        <div class="flex items-end gap-2">
          <span class="text-4xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white">${order.riskScore}</span>
          <span class="pb-1 text-sm text-slate-500 dark:text-slate-400">/ 100</span>
        </div>
        <progress class="progress mt-3" value="${order.riskScore}" max="100" aria-label="Risk score">${order.riskScore} of 100</progress>
        <ul class="mt-4 space-y-2" role="list">
          ${order.riskFactors.map((factor) => html`
            <li class="flex gap-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
              <span class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">${icon('alert', 'h-3.5 w-3.5')}</span>
              <span>${factor}</span>
            </li>
          `)}
        </ul>
      </div>
    </section>
  `;
}

function renderSupplierCard(order) {
  const supplier = order.supplier;
  return html`
    <section class="card" aria-label="Supplier profile">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Supplier</h2>
      </div>
      <div class="p-5">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="font-semibold text-slate-900 dark:text-white">${supplier.name}</h3>
            <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">${supplier.country} · ${supplier.region} · Tier ${supplier.tier}</p>
          </div>
          ${riskBadge(supplier.riskLevel)}
        </div>
        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">On-time rate</dt><dd class="mt-0.5 font-semibold">${(supplier.onTimeRate * 100).toFixed(1)}%</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Lead time</dt><dd class="mt-0.5 font-semibold">${supplier.leadTimeDays} days</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Active orders</dt><dd class="mt-0.5 font-semibold">${supplier.activeOrders}</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Certifications</dt><dd class="mt-1 flex flex-wrap gap-1">${supplier.certifications.map((cert) => html`<span class="badge badge-neutral">${cert}</span>`)}</dd></div>
        </dl>
        <p class="mt-4 text-xs text-slate-500 dark:text-slate-400">Contact: <a class="link" href="mailto:${supplier.contactEmail}">${supplier.contactEmail}</a></p>
      </div>
    </section>
  `;
}

function renderDetail(order) {
  return html`
    <div class="space-y-6">
      ${pageHeader({
        eyebrow: 'Purchase order',
        title: order.poNumber,
        description: `${order.supplier.name} · ${order.buyer} · ${order.lineCount} line item${order.lineCount === 1 ? '' : 's'}`,
        actions: html`
          <a href="#/orders" class="btn-secondary">${icon('arrow-left')}All orders</a>
          ${statusBadge(order.status)}
          ${riskBadge(order.riskLevel, { score: order.riskScore })}
        `,
      })}

      <div class="grid gap-6 lg:grid-cols-3">
        <div class="space-y-6 lg:col-span-2">
          ${renderSummary(order)}
          ${renderLines(order)}
          ${renderShipments(order)}
          ${renderTraceability(order)}
          ${renderHistory(order)}
        </div>
        <div class="space-y-6">
          ${renderStatusCard(order)}
          ${renderRiskCard(order)}
          ${renderSupplierCard(order)}
        </div>
      </div>
    </div>
  `;
}

async function mountDetail(root, ctx, poNumber) {
  let disposed = false;
  let controller = null;
  let currentOrder = null;

  const load = async ({ initial = false, focusHeading = false } = {}) => {
    controller?.abort();
    controller = new AbortController();
    if (initial) root.innerHTML = loadingState({ label: 'Loading purchase order' }).value;
    else root.setAttribute('aria-busy', 'true');
    try {
      const data = await gql(DETAIL_QUERY, { poNumber }, { signal: controller.signal });
      if (disposed) return;
      if (!data.order) {
        root.innerHTML = html`
          ${pageHeader({ eyebrow: 'Purchase order', title: 'Order not found', description: `No purchase order matches ${poNumber}.` })}
          ${errorState({ title: 'That purchase order does not exist', message: 'It may have been removed or the link may be incorrect.', retry: false, action: html`<a class="btn-secondary" href="#/orders">Back to orders</a>` })}
        `.value;
        return;
      }
      currentOrder = data.order;
      ctx.setTitle(data.order.poNumber);
      ctx.setLastUpdated(data.order.updatedAt);
      root.innerHTML = renderDetail(data.order).value;
      if (focusHeading) {
        root.querySelector('[data-route-heading]')?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    } catch (error) {
      if (disposed || error.name === 'AbortError') return;
      root.innerHTML = errorState({
        title: 'The purchase order could not be loaded',
        message: errorMessage(error),
      }).value;
    } finally {
      root.removeAttribute('aria-busy');
    }
  };

  const onSubmit = async (event) => {
    if (event.target.id !== 'status-form') return;
    event.preventDefault();
    if (!currentOrder) return;
    const form = event.target;
    const select = form.querySelector('#status-select');
    const note = form.querySelector('#status-note');
    const error = form.querySelector('#status-error');
    const button = form.querySelector('button[type="submit"]');
    if (!select.value) {
      error.textContent = 'Choose the status to move this order to.';
      select.focus();
      return;
    }
    error.textContent = '';
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Updating…';
    try {
      await gql(UPDATE_STATUS_MUTATION, {
        input: { orderId: currentOrder.id, status: select.value, note: note.value.trim() },
      });
      ctx.showToast(`Order ${currentOrder.poNumber} moved to ${titleCase(select.value)}.`);
      ctx.announce(`Order status updated to ${titleCase(select.value)}.`);
      await load({ focusHeading: true });
    } catch (updateError) {
      error.textContent = errorMessage(updateError);
      button.disabled = false;
      button.textContent = originalLabel;
      button.focus();
    }
  };

  const onClick = (event) => {
    if (event.target.closest('[data-action="retry"]')) {
      event.preventDefault();
      load({ initial: true });
    }
  };

  root.addEventListener('submit', onSubmit);
  root.addEventListener('click', onClick);

  await load({ initial: true });

  return () => {
    disposed = true;
    controller?.abort();
    root.removeEventListener('submit', onSubmit);
    root.removeEventListener('click', onClick);
  };
}

/* ------------------------------------------------------------------ *
 * Create view                                                         *
 * ------------------------------------------------------------------ */

function productOptions(supplier, selected = '') {
  if (!supplier) return html`<option value="">Choose a supplier first</option>`;
  if (!supplier.products.length) return html`<option value="">No products for this supplier</option>`;
  return html`
    <option value="">Select a product</option>
    ${supplier.products.map((product) => html`
      <option value="${product.id}" ${product.id === selected ? raw('selected') : ''}>${product.name} (${product.sku})</option>
    `)}
  `;
}

function renderLineRow(index, supplier) {
  return html`
    <div class="grid gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-12" data-line data-line-index="${index}">
      <div class="sm:col-span-5">
        <label for="line-product-${index}" class="field-label">Product</label>
        <select id="line-product-${index}" class="select mt-1.5" data-product required ${supplier ? '' : raw('disabled')}>
          ${productOptions(supplier)}
        </select>
      </div>
      <div class="sm:col-span-3">
        <label for="line-quantity-${index}" class="field-label">Quantity</label>
        <input id="line-quantity-${index}" type="number" class="input mt-1.5" data-quantity min="1" max="100000" step="1" value="100" required />
      </div>
      <div class="sm:col-span-3">
        <label for="line-price-${index}" class="field-label">Unit price <span class="font-normal text-slate-500 dark:text-slate-400">(optional)</span></label>
        <input id="line-price-${index}" type="number" class="input mt-1.5" data-price min="0" step="0.01" placeholder="Catalog price" />
        <p class="field-help" data-price-hint>Blank uses the product catalog price.</p>
      </div>
      <div class="flex items-end sm:col-span-1">
        <button type="button" class="btn-ghost px-2 disabled:cursor-not-allowed disabled:opacity-40" data-action="remove-line" aria-label="Remove this line item">${icon('x', 'h-4 w-4')}</button>
      </div>
    </div>
  `;
}

function renderCreatePage(suppliers) {
  const firstSupplier = suppliers[0] ?? null;
  const defaultDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const minimumDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return html`
    ${pageHeader({
      eyebrow: 'Order management',
      title: 'New purchase order',
      description: 'Create a draft order. The gateway validates supplier, product, quantity, unit price, and delivery date before anything is persisted.',
      actions: html`<a href="#/orders" class="btn-secondary">${icon('arrow-left')}Back to orders</a>`,
    })}

    ${banner({
      tone: 'info',
      title: 'Drafts start in DRAFT status',
      message: 'A new order is created as a draft and must follow the status state machine before it can be confirmed or shipped.',
    })}

    <form id="create-order-form" class="mt-6 space-y-6">
      <div id="create-error" class="hidden rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm font-medium text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200" role="alert" tabindex="-1"></div>

      <section class="card" aria-label="Order details">
        <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 class="text-base font-semibold text-slate-900 dark:text-white">Order details</h2>
        </div>
        <div class="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label for="create-supplier" class="field-label">Supplier</label>
            <select id="create-supplier" name="supplierId" class="select mt-1.5" required>
              <option value="">Choose a supplier</option>
              ${suppliers.map((supplier) => html`<option value="${supplier.id}" ${firstSupplier && supplier.id === firstSupplier.id ? raw('selected') : ''}>${supplier.name} · ${supplier.country}</option>`)}
            </select>
          </div>
          <div>
            <label for="create-buyer" class="field-label">Buyer / business unit</label>
            <input id="create-buyer" name="buyer" type="text" class="input mt-1.5" maxlength="120" required placeholder="e.g. Textiles EU" />
          </div>
          <div>
            <label for="create-priority" class="field-label">Priority</label>
            <select id="create-priority" name="priority" class="select mt-1.5">
              <option value="STANDARD">Standard</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>
          <div>
            <label for="create-incoterms" class="field-label">Incoterms</label>
            <select id="create-incoterms" name="incoterms" class="select mt-1.5">
              ${['FOB', 'CIF', 'DAP', 'EXW'].map((term) => option(term, term))}
            </select>
          </div>
          <div>
            <label for="create-expected" class="field-label">Expected delivery</label>
            <input id="create-expected" name="expectedDeliveryAt" type="date" class="input mt-1.5" value="${defaultDate}" min="${minimumDate}" required />
            <p class="field-help">Local date; stored as a UTC timestamp at noon.</p>
          </div>
          <div>
            <label for="create-notes" class="field-label">Notes <span class="font-normal text-slate-500 dark:text-slate-400">(optional)</span></label>
            <textarea id="create-notes" name="notes" class="textarea mt-1.5" maxlength="2000" rows="3" placeholder="Reference, special handling, or supplier instructions"></textarea>
          </div>
        </div>
      </section>

      <section class="card" aria-label="Line items">
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 class="text-base font-semibold text-slate-900 dark:text-white">Line items</h2>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Up to 5 lines per order. Products are limited to the selected supplier.</p>
          </div>
          <button type="button" class="btn-secondary" data-action="add-line">${icon('plus')}Add line</button>
        </div>
        <div class="space-y-3 p-5" id="line-items">
          ${renderLineRow(1, firstSupplier)}
        </div>
      </section>

      <div class="flex flex-wrap items-center justify-end gap-3">
        <a href="#/orders" class="btn-secondary">Cancel</a>
        <button type="submit" class="btn-primary">Create purchase order</button>
      </div>
    </form>
  `;
}

async function mountCreate(root, ctx) {
  let disposed = false;
  let controller = new AbortController();
  let lineSequence = 1;

  root.innerHTML = loadingState({ label: 'Loading suppliers and products' }).value;

  let suppliers = [];
  try {
    const data = await gql(CREATE_FORM_QUERY, {}, { signal: controller.signal });
    if (disposed) return () => {};
    suppliers = data.suppliers;
  } catch (error) {
    if (disposed || error.name === 'AbortError') return () => {};
    root.innerHTML = errorState({ title: 'The order form could not be loaded', message: errorMessage(error) }).value;
    return () => {};
  }

  root.innerHTML = renderCreatePage(suppliers).value;
  ctx.setTitle('New purchase order');

  const form = root.querySelector('#create-order-form');
  const lineContainer = root.querySelector('#line-items');
  const supplierSelect = root.querySelector('#create-supplier');
  const errorBox = root.querySelector('#create-error');
  const addButton = root.querySelector('[data-action="add-line"]');

  const currentSupplier = () => suppliers.find((supplier) => supplier.id === supplierSelect.value) ?? null;

  const updateLineButtons = () => {
    const rows = [...lineContainer.querySelectorAll('[data-line]')];
    addButton.disabled = rows.length >= 5;
    addButton.setAttribute('aria-disabled', String(rows.length >= 5));
    for (const row of rows) {
      const remove = row.querySelector('[data-action="remove-line"]');
      if (remove) remove.disabled = rows.length <= 1;
    }
  };

  const syncProductOptions = () => {
    const supplier = currentSupplier();
    for (const row of lineContainer.querySelectorAll('[data-line]')) {
      const select = row.querySelector('[data-product]');
      const current = select.value;
      select.innerHTML = productOptions(supplier, current).value;
      select.disabled = !supplier;
      const product = supplier?.products.find((item) => item.id === select.value);
      const price = row.querySelector('[data-price]');
      price.placeholder = product ? `Catalog ${formatCurrency(product.unitPrice, 'USD', { digits: 2 })}` : 'Catalog price';
    }
  };

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
    errorBox.focus();
  };

  const onChange = (event) => {
    if (event.target.id === 'create-supplier') {
      syncProductOptions();
      return;
    }
    if (event.target.matches('[data-product]')) {
      const row = event.target.closest('[data-line]');
      const supplier = currentSupplier();
      const product = supplier?.products.find((item) => item.id === event.target.value);
      const price = row.querySelector('[data-price]');
      price.placeholder = product ? `Catalog ${formatCurrency(product.unitPrice, 'USD', { digits: 2 })}` : 'Catalog price';
    }
  };

  const onClick = (event) => {
    if (event.target.closest('[data-action="add-line"]')) {
      event.preventDefault();
      const count = lineContainer.querySelectorAll('[data-line]').length;
      if (count >= 5) return;
      lineSequence += 1;
      lineContainer.insertAdjacentHTML('beforeend', renderLineRow(lineSequence, currentSupplier()).value);
      syncProductOptions();
      updateLineButtons();
      lineContainer.querySelector(`[data-line-index="${lineSequence}"] [data-product]`)?.focus();
      return;
    }
    const remove = event.target.closest('[data-action="remove-line"]');
    if (remove) {
      event.preventDefault();
      const rows = lineContainer.querySelectorAll('[data-line]');
      if (rows.length <= 1) return;
      const row = remove.closest('[data-line]');
      const focusTarget = row.previousElementSibling ?? row.nextElementSibling;
      row.remove();
      updateLineButtons();
      focusTarget?.querySelector('[data-product]')?.focus();
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    errorBox.classList.add('hidden');
    errorBox.textContent = '';

    const supplier = currentSupplier();
    if (!supplier) {
      showError('Choose a supplier before creating the order.');
      supplierSelect.focus();
      return;
    }
    const buyer = form.elements.buyer.value.trim();
    if (!buyer) {
      showError('Enter the buyer or business unit.');
      form.elements.buyer.focus();
      return;
    }
    const dateValue = form.elements.expectedDeliveryAt.value;
    if (!dateValue) {
      showError('Choose an expected delivery date.');
      form.elements.expectedDeliveryAt.focus();
      return;
    }
    const expected = new Date(`${dateValue}T12:00:00`);
    if (Number.isNaN(expected.getTime())) {
      showError('The expected delivery date is not valid.');
      form.elements.expectedDeliveryAt.focus();
      return;
    }

    const rows = [...lineContainer.querySelectorAll('[data-line]')];
    const lines = [];
    for (const [index, row] of rows.entries()) {
      const productId = row.querySelector('[data-product]').value;
      const quantity = Number(row.querySelector('[data-quantity]').value);
      const priceValue = row.querySelector('[data-price]').value;
      if (!productId) {
        showError(`Choose a product for line ${index + 1}.`);
        row.querySelector('[data-product]').focus();
        return;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        showError(`Enter a whole-number quantity greater than zero for line ${index + 1}.`);
        row.querySelector('[data-quantity]').focus();
        return;
      }
      const line = { productId, quantity };
      if (priceValue !== '') {
        const unitPrice = Number(priceValue);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          showError(`Enter a valid unit price for line ${index + 1}.`);
          row.querySelector('[data-price]').focus();
          return;
        }
        line.unitPrice = unitPrice;
      }
      lines.push(line);
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Creating…';
    try {
      const data = await gql(CREATE_MUTATION, {
        input: {
          supplierId: supplier.id,
          buyer,
          priority: form.elements.priority.value,
          incoterms: form.elements.incoterms.value,
          expectedDeliveryAt: expected.toISOString(),
          notes: form.elements.notes.value.trim(),
          lines,
        },
      });
      ctx.showToast(`Draft ${data.createPurchaseOrder.poNumber} created.`);
      ctx.announce(`Purchase order ${data.createPurchaseOrder.poNumber} created.`);
      ctx.navigate(`/orders/${encodeURIComponent(data.createPurchaseOrder.poNumber)}`);
      return;
    } catch (error) {
      showError(errorMessage(error));
      submit.disabled = false;
      submit.textContent = label;
    }
  };

  supplierSelect.addEventListener('change', onChange);
  lineContainer.addEventListener('change', onChange);
  lineContainer.addEventListener('click', onClick);
  addButton.addEventListener('click', onClick);
  form.addEventListener('submit', onSubmit);
  updateLineButtons();

  return () => {
    disposed = true;
    controller.abort();
    supplierSelect.removeEventListener('change', onChange);
    lineContainer.removeEventListener('change', onChange);
    lineContainer.removeEventListener('click', onClick);
    addButton.removeEventListener('click', onClick);
    form.removeEventListener('submit', onSubmit);
  };
}

/* ------------------------------------------------------------------ *
 * Entry point                                                          *
 * ------------------------------------------------------------------ */

export async function mount(root, ctx) {
  const segments = ctx.route.path.split('/').filter(Boolean);
  if (segments[1] === 'new') return mountCreate(root, ctx);
  if (segments.length >= 2) return mountDetail(root, ctx, decodeURIComponent(segments[1]));
  return mountList(root, ctx);
}
