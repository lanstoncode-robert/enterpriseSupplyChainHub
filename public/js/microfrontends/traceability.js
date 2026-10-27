import { gql, errorMessage } from '../gql.js';
import { html, raw } from '../html.js';
import {
  banner,
  chainBadge,
  emptyState,
  errorState,
  icon,
  loadingState,
  pageHeader,
} from '../ui.js';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  titleCase,
} from '../format.js';

export const meta = {
  name: 'traceability',
  title: 'Traceability',
  route: '/traceability',
};

const EVENT_TYPES = [
  'HARVEST',
  'PRODUCTION',
  'PROCESSING',
  'QUALITY_CHECK',
  'PACKAGING',
  'DEPARTURE',
  'CUSTOMS_CLEARANCE',
  'ARRIVAL',
  'WAREHOUSE_RECEIPT',
  'DELIVERY',
];

const LIST_QUERY = /* GraphQL */ `
  query TraceList($filter: TraceFilter, $first: Int) {
    traceabilityRecords(filter: $filter, first: $first) {
      id
      lotCode
      serialRange
      quantity
      unit
      chainVerified
      createdAt
      product { id name sku }
      supplier { id name }
      order { id poNumber }
      events { id occurredAt }
      verification { valid reason checkedEvents totalEvents }
      certificateRefs
    }
    products(first: 100) { id name }
    metrics {
      chainIntegrity { valid invalid totalRecords }
    }
  }
`;

const DETAIL_QUERY = /* GraphQL */ `
  query TraceRecord($lotCode: String!) {
    traceabilityRecord(lotCode: $lotCode) {
      id
      lotCode
      serialRange
      quantity
      unit
      harvestDate
      bestBefore
      chainVerified
      createdAt
      updatedAt
      certificateRefs
      product { id name sku category }
      supplier { id name country riskLevel }
      order { id poNumber status buyer }
      facilityPath { id name type city country }
      events {
        id
        recordId
        sequence
        type
        occurredAt
        actor
        notes
        documentRefs
        integrityHash
        previousHash
        facility { id name city country }
      }
      verification {
        valid
        checkedEvents
        totalEvents
        brokenAt
        expectedHash
        actualHash
        reason
        verifiedAt
      }
    }
    facilities { id name type city country }
  }
`;

const APPEND_MUTATION = /* GraphQL */ `
  mutation AppendTraceEvent($input: AppendTraceEventInput!) {
    appendTraceEvent(input: $input) { id lotCode updatedAt }
  }
`;

function renderListShell(state) {
  return html`
    ${pageHeader({
      eyebrow: 'Chain of custody',
      title: 'Traceability records',
      description: 'Search lot codes and serial ranges, verify the SHA-256 hash chain, and inspect every custody event from origin to delivery.',
    })}

    <section class="card mb-4 p-4 sm:p-5" aria-label="Search traceability records">
      <form id="trace-form" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div class="lg:col-span-3">
          <label for="trace-search" class="field-label">Lot code or serial number</label>
          <input id="trace-search" type="search" class="input mt-1.5" placeholder="e.g. LOT-2026-4128 or SN-2026-52000" autocomplete="off" />
        </div>
        <div class="lg:col-span-2">
          <label for="trace-product" class="field-label">Product</label>
          <select id="trace-product" class="select mt-1.5">
            <option value="">All products</option>
          </select>
        </div>
        <div class="flex items-end">
          <button type="submit" class="btn-primary w-full">${icon('search')}Search</button>
        </div>
        <div class="lg:col-span-4">
          <label class="flex min-h-[44px] items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <input id="trace-invalid" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 dark:border-slate-600 dark:bg-slate-900" ${state.onlyInvalid ? raw('checked') : ''} />
            Only show records with failed chain verification
          </label>
        </div>
        <div class="flex items-end lg:col-span-2">
          <button type="reset" class="btn-secondary w-full">Reset</button>
        </div>
      </form>
    </section>

    <div id="trace-results" tabindex="-1" aria-label="Traceability search results" aria-busy="true" class="outline-none">
      <div class="space-y-3" role="status" aria-live="polite">
        <span class="sr-only">Loading traceability records</span>
        <div class="h-5 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
        <div class="h-56 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"></div>
      </div>
    </div>
  `;
}

function renderRecordCard(record) {
  const lastEvent = record.events.at(-1);
  return html`
    <li class="card p-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <a class="link font-mono text-sm" href="#/traceability/${encodeURIComponent(record.lotCode)}">${record.lotCode}</a>
        ${chainBadge(record.chainVerified)}
      </div>
      <p class="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">${record.product.name} <span class="font-normal text-slate-500 dark:text-slate-400">· ${record.product.sku}</span></p>
      <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">${record.supplier.name} · ${formatNumber(record.quantity)} ${record.unit}</p>
      <dl class="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div><dt class="text-slate-500 dark:text-slate-400">Order</dt><dd class="mt-0.5"><a class="link font-mono" href="#/orders/${encodeURIComponent(record.order.poNumber)}">${record.order.poNumber}</a></dd></div>
        <div><dt class="text-slate-500 dark:text-slate-400">Events</dt><dd class="mt-0.5 font-semibold">${record.events.length}</dd></div>
        <div><dt class="text-slate-500 dark:text-slate-400">Last event</dt><dd class="mt-0.5">${lastEvent ? formatDate(lastEvent.occurredAt) : '—'}</dd></div>
        <div><dt class="text-slate-500 dark:text-slate-400">Serial range</dt><dd class="mt-0.5 font-mono">${record.serialRange}</dd></div>
      </dl>
      ${record.chainVerified ? '' : html`<p class="mt-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">${record.verification.reason}</p>`}
    </li>
  `;
}

function renderListResults(data, state) {
  const { traceabilityRecords: records, metrics } = data;
  const total = metrics.chainIntegrity.totalRecords;
  return html`
    <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-sm text-slate-600 dark:text-slate-300" role="status">
        <span class="font-semibold">${records.length}</span> record${records.length === 1 ? '' : 's'} shown
        · ${metrics.chainIntegrity.valid} of ${total} chains verify portfolio-wide
      </p>
      <p class="text-xs text-slate-500 dark:text-slate-400">${state.onlyInvalid ? 'Filtered to exceptions' : 'Newest lots first'} · limit 50</p>
    </div>

    ${records.length === 0
      ? emptyState({
          title: 'No traceability records match',
          message: state.onlyInvalid
            ? 'Every chain currently verifies. Clear the exception filter to see all lots.'
            : 'Try a different lot code, serial range, or product.',
          iconName: 'trace',
        })
      : html`<ul class="space-y-3" role="list">${records.map(renderRecordCard)}</ul>`}
  `;
}

async function mountList(root, ctx) {
  let disposed = false;
  let controller = null;
  const state = {
    search: '',
    productId: '',
    onlyInvalid: ctx.route.query.get('invalid') === '1',
    data: null,
  };

  root.innerHTML = renderListShell(state).value;
  const form = root.querySelector('#trace-form');
  const results = root.querySelector('#trace-results');
  const searchInput = root.querySelector('#trace-search');
  const productSelect = root.querySelector('#trace-product');
  const invalidCheckbox = root.querySelector('#trace-invalid');

  const syncProducts = (products) => {
    const current = state.productId;
    productSelect.replaceChildren();
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All products';
    productSelect.append(all);
    for (const product of products) {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = product.name;
      productSelect.append(option);
    }
    productSelect.value = products.some((product) => product.id === current) ? current : '';
    state.productId = productSelect.value;
  };

  const load = async () => {
    controller?.abort();
    controller = new AbortController();
    results.setAttribute('aria-busy', 'true');
    if (!state.data) {
      results.innerHTML = html`
        <div class="space-y-3" role="status" aria-live="polite">
          <span class="sr-only">Loading traceability records</span>
          <div class="h-5 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-800"></div>
          <div class="h-56 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800"></div>
        </div>
      `.value;
    }
    const filter = {};
    const typed = state.search.trim();
    if (typed) {
      if (/^sn[-_]/i.test(typed)) filter.serial = typed;
      else filter.lotCode = typed;
    }
    if (state.productId) filter.productId = state.productId;
    if (state.onlyInvalid) filter.onlyInvalid = true;
    try {
      const data = await gql(LIST_QUERY, { filter: Object.keys(filter).length ? filter : null, first: 50 }, { signal: controller.signal });
      if (disposed) return;
      state.data = data;
      syncProducts(data.products);
      results.innerHTML = renderListResults(data, state).value;
    } catch (error) {
      if (disposed || error.name === 'AbortError') return;
      results.innerHTML = errorState({
        title: 'Traceability records could not be loaded',
        message: errorMessage(error),
      }).value;
    } finally {
      results.removeAttribute('aria-busy');
    }
  };

  const onSubmit = (event) => {
    event.preventDefault();
    state.search = searchInput.value;
    state.productId = productSelect.value;
    state.onlyInvalid = invalidCheckbox.checked;
    load();
  };

  const onChange = (event) => {
    if (event.target.id === 'trace-invalid' || event.target.id === 'trace-product') {
      state.search = searchInput.value;
      state.onlyInvalid = invalidCheckbox.checked;
      state.productId = productSelect.value;
      load();
    }
  };

  const onReset = (event) => {
    event.preventDefault();
    searchInput.value = '';
    productSelect.value = '';
    invalidCheckbox.checked = false;
    state.search = '';
    state.productId = '';
    state.onlyInvalid = false;
    load();
  };

  const onClick = (event) => {
    if (event.target.closest('[data-action="retry"]')) {
      event.preventDefault();
      load();
    }
  };

  form.addEventListener('submit', onSubmit);
  form.addEventListener('change', onChange);
  form.addEventListener('reset', onReset);
  root.addEventListener('click', onClick);

  await load();

  return () => {
    disposed = true;
    controller?.abort();
    form.removeEventListener('submit', onSubmit);
    form.removeEventListener('change', onChange);
    form.removeEventListener('reset', onReset);
    root.removeEventListener('click', onClick);
  };
}

/* ------------------------------------------------------------------ *
 * Detail                                                              *
 * ------------------------------------------------------------------ */

function renderVerification(record) {
  const verification = record.verification;
  return html`
    <section class="card ${verification.valid ? '' : 'border-rose-300 dark:border-rose-500/40'}" aria-label="Chain verification">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Chain verification</h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Recomputed on every request from the stored event digests.</p>
      </div>
      <div class="p-5">
        <div class="flex items-center gap-3">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full ${verification.valid ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'}">
            ${icon(verification.valid ? 'check' : 'alert', 'h-5 w-5')}
          </span>
          <div>
            <p class="text-sm font-semibold ${verification.valid ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'}">${verification.valid ? 'Chain verified' : 'Integrity exception'}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">${verification.checkedEvents} of ${verification.totalEvents} events checked</p>
          </div>
        </div>
        <p class="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">${verification.reason}</p>
        <dl class="mt-4 space-y-2 text-xs">
          <div class="flex justify-between gap-3"><dt class="text-slate-500 dark:text-slate-400">Verified at</dt><dd class="text-right">${formatDateTime(verification.verifiedAt)}</dd></div>
          ${verification.brokenAt ? html`<div class="flex justify-between gap-3"><dt class="text-slate-500 dark:text-slate-400">Broken event</dt><dd class="font-mono text-right">${verification.brokenAt}</dd></div>` : ''}
          ${verification.expectedHash ? html`<div><dt class="text-slate-500 dark:text-slate-400">Expected hash</dt><dd class="mt-1 break-all font-mono text-[11px]">${verification.expectedHash}</dd></div>` : ''}
          ${verification.actualHash ? html`<div><dt class="text-slate-500 dark:text-slate-400">Recorded hash</dt><dd class="mt-1 break-all font-mono text-[11px]">${verification.actualHash}</dd></div>` : ''}
        </dl>
      </div>
    </section>
  `;
}

function renderFacilityPath(record) {
  return html`
    <section class="card" aria-label="Facility path">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Chain of custody</h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">${record.facilityPath.length} facilities touched across the lot lifecycle.</p>
      </div>
      <ol class="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        ${record.facilityPath.map((facility, index) => html`
          <li class="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Step ${index + 1}</p>
            <p class="mt-1 text-sm font-medium text-slate-900 dark:text-white">${facility.name}</p>
            <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">${facility.city}, ${facility.country} · ${titleCase(facility.type)}</p>
          </li>
        `)}
      </ol>
    </section>
  `;
}

function renderEvents(record) {
  return html`
    <section class="card" aria-label="Custody events">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Custody events</h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Each event commits to the previous digest, forming a tamper-evident chain.</p>
      </div>
      <ol class="space-y-0 p-5">
        ${record.events.map((event, index) => html`
          <li class="relative border-l border-slate-200 pb-6 pl-5 last:pb-0 dark:border-slate-700">
            <span class="absolute -left-[6px] top-1 h-3 w-3 rounded-full ${index === record.events.length - 1 ? 'bg-teal-600 ring-4 ring-teal-100 dark:bg-teal-300 dark:ring-teal-500/20' : 'bg-slate-400 ring-4 ring-white dark:bg-slate-500 dark:ring-slate-900'}" aria-hidden="true"></span>
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h3 class="text-sm font-semibold text-slate-900 dark:text-white">${titleCase(event.type)}</h3>
              <time class="text-xs text-slate-500 dark:text-slate-400" datetime="${event.occurredAt}">${formatDateTime(event.occurredAt)}</time>
            </div>
            <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">${event.facility.name}, ${event.facility.city} · ${event.actor}</p>
            ${event.notes ? html`<p class="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">${event.notes}</p>` : ''}
            ${event.documentRefs.length
              ? html`<ul class="mt-2 flex flex-wrap gap-1.5" role="list">${event.documentRefs.map((ref) => html`<li class="badge badge-neutral font-mono">${ref}</li>`)}</ul>`
              : ''}
            <details class="mt-2">
              <summary class="cursor-pointer text-xs font-medium text-teal-800 underline decoration-teal-300 underline-offset-2 dark:text-teal-300 dark:decoration-teal-700">Integrity hashes</summary>
              <dl class="mt-2 space-y-1.5 text-[11px]">
                <div><dt class="text-slate-500 dark:text-slate-400">Previous</dt><dd class="break-all font-mono">${event.previousHash}</dd></div>
                <div><dt class="text-slate-500 dark:text-slate-400">This event</dt><dd class="break-all font-mono">${event.integrityHash}</dd></div>
              </dl>
            </details>
          </li>
        `)}
      </ol>
    </section>
  `;
}

function renderMetaCard(record) {
  return html`
    <section class="card" aria-label="Record metadata">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Lot metadata</h2>
      </div>
      <div class="p-5">
        <dl class="space-y-3 text-sm">
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Product</dt><dd class="mt-0.5 font-medium">${record.product.name}</dd><dd class="text-xs text-slate-500 dark:text-slate-400">${record.product.sku} · ${record.product.category}</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Supplier</dt><dd class="mt-0.5 font-medium">${record.supplier.name}</dd><dd class="text-xs text-slate-500 dark:text-slate-400">${record.supplier.country} · ${titleCase(record.supplier.riskLevel)} risk</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Quantity</dt><dd class="mt-0.5 font-medium">${formatNumber(record.quantity)} ${record.unit}</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Serial range</dt><dd class="mt-0.5 break-all font-mono text-xs">${record.serialRange}</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Harvest date</dt><dd class="mt-0.5">${record.harvestDate ? formatDate(record.harvestDate) : 'Not applicable'}</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Best before</dt><dd class="mt-0.5">${record.bestBefore ? formatDate(record.bestBefore) : 'Not applicable'}</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Certificates</dt><dd class="mt-1 flex flex-wrap gap-1.5">${record.certificateRefs.length ? record.certificateRefs.map((ref) => html`<span class="badge badge-neutral font-mono">${ref}</span>`) : html`<span class="text-xs text-slate-500 dark:text-slate-400">None recorded</span>`}</dd></div>
          <div><dt class="text-xs text-slate-500 dark:text-slate-400">Purchase order</dt><dd class="mt-0.5"><a class="link font-mono text-xs" href="#/orders/${encodeURIComponent(record.order.poNumber)}">${record.order.poNumber}</a> · ${titleCase(record.order.status)}</dd></div>
        </dl>
      </div>
    </section>
  `;
}

function renderAppendCard(record, facilities) {
  const defaults = new Date();
  const local = new Date(defaults.getTime() - defaults.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const defaultFacilityId = record.events.at(-1)?.facility.id ?? facilities[0]?.id ?? '';
  const defaultType = 'QUALITY_CHECK';
  return html`
    <section class="card" aria-label="Record a custody event">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Record a custody event</h2>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Appending extends the hash chain. Events cannot predate the previous event.</p>
      </div>
      <div class="p-5">
        ${record.chainVerified
          ? ''
          : banner({
              tone: 'warning',
              title: 'This chain already has an integrity exception',
              message: 'A new event will extend the recorded chain, but verification will continue to fail at the broken event until it is investigated.',
            })}
        <form id="trace-event-form" class="mt-4 space-y-3" novalidate>
          <div>
            <label for="event-type" class="field-label">Event type</label>
            <select id="event-type" name="type" class="select mt-1.5" required>
              ${EVENT_TYPES.map((type) => html`<option value="${type}" ${type === defaultType ? raw('selected') : ''}>${titleCase(type)}</option>`)}
            </select>
          </div>
          <div>
            <label for="event-facility" class="field-label">Facility</label>
            <select id="event-facility" name="facilityId" class="select mt-1.5" required>
              ${facilities.map((facility) => html`<option value="${facility.id}" ${facility.id === defaultFacilityId ? raw('selected') : ''}>${facility.name} · ${facility.city}</option>`)}
            </select>
          </div>
          <div>
            <label for="event-actor" class="field-label">Actor</label>
            <input id="event-actor" name="actor" type="text" class="input mt-1.5" maxlength="120" required placeholder="Operator or system name" />
          </div>
          <div>
            <label for="event-time" class="field-label">Occurred at</label>
            <input id="event-time" name="occurredAt" type="datetime-local" class="input mt-1.5" value="${local}" />
          </div>
          <div>
            <label for="event-notes" class="field-label">Notes <span class="font-normal text-slate-500 dark:text-slate-400">(optional)</span></label>
            <textarea id="event-notes" name="notes" class="textarea mt-1.5" rows="2" maxlength="2000" placeholder="Observation, inspection result, or handover detail"></textarea>
          </div>
          <p id="event-error" class="field-error" role="alert"></p>
          <button type="submit" class="btn-primary w-full">Append event</button>
        </form>
      </div>
    </section>
  `;
}

function renderDetail(record, facilities) {
  return html`
    <div class="space-y-6">
      ${pageHeader({
        eyebrow: 'Chain of custody',
        title: record.lotCode,
        description: `${record.product.name} · ${record.supplier.name} · ${formatNumber(record.quantity)} ${record.unit}`,
        actions: html`
          <a href="#/traceability" class="btn-secondary">${icon('arrow-left')}All records</a>
          ${chainBadge(record.chainVerified)}
        `,
        meta: html`<div class="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span class="badge badge-neutral font-mono">${record.serialRange}</span>
          <a class="link font-mono" href="#/orders/${encodeURIComponent(record.order.poNumber)}">${record.order.poNumber}</a>
          <span>Created ${formatDateTime(record.createdAt)}</span>
        </div>`,
      })}

      <div class="grid gap-6 lg:grid-cols-3">
        <div class="space-y-6 lg:col-span-2">
          ${renderFacilityPath(record)}
          ${renderEvents(record)}
        </div>
        <div class="space-y-6">
          ${renderVerification(record)}
          ${renderMetaCard(record)}
          ${renderAppendCard(record, facilities)}
        </div>
      </div>
    </div>
  `;
}

async function mountDetail(root, ctx, lotCode) {
  let disposed = false;
  let controller = null;
  let currentRecord = null;

  const load = async ({ initial = false, focusHeading = false } = {}) => {
    controller?.abort();
    controller = new AbortController();
    if (initial) root.innerHTML = loadingState({ label: 'Verifying chain of custody' }).value;
    else root.setAttribute('aria-busy', 'true');
    try {
      const data = await gql(DETAIL_QUERY, { lotCode }, { signal: controller.signal });
      if (disposed) return;
      if (!data.traceabilityRecord) {
        root.innerHTML = html`
          ${pageHeader({ eyebrow: 'Traceability', title: 'Record not found', description: `No lot record matches ${lotCode}.` })}
          ${errorState({ title: 'That lot record does not exist', message: 'Check the lot code or search from the traceability index.', retry: false, action: html`<a class="btn-secondary" href="#/traceability">Back to traceability</a>` })}
        `.value;
        return;
      }
      currentRecord = data.traceabilityRecord;
      ctx.setTitle(`Lot ${currentRecord.lotCode}`);
      ctx.setLastUpdated(currentRecord.updatedAt);
      root.innerHTML = renderDetail(currentRecord, data.facilities).value;
      if (focusHeading) {
        root.querySelector('[data-route-heading]')?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    } catch (error) {
      if (disposed || error.name === 'AbortError') return;
      root.innerHTML = errorState({
        title: 'The traceability record could not be loaded',
        message: errorMessage(error),
      }).value;
    } finally {
      root.removeAttribute('aria-busy');
    }
  };

  const onSubmit = async (event) => {
    if (event.target.id !== 'trace-event-form') return;
    event.preventDefault();
    if (!currentRecord) return;
    const form = event.target;
    const error = form.querySelector('#event-error');
    const button = form.querySelector('button[type="submit"]');
    const actor = form.elements.actor.value.trim();
    if (!actor) {
      error.textContent = 'Enter the actor recording this event.';
      form.elements.actor.focus();
      return;
    }
    const occurredValue = form.elements.occurredAt.value;
    error.textContent = '';
    button.disabled = true;
    const label = button.textContent;
    button.textContent = 'Appending…';
    try {
      const input = {
        recordId: currentRecord.id,
        type: form.elements.type.value,
        facilityId: form.elements.facilityId.value,
        actor,
        notes: form.elements.notes.value.trim(),
      };
      if (occurredValue) {
        const occurredAt = new Date(occurredValue);
        if (Number.isNaN(occurredAt.getTime())) {
          throw new Error('The occurred-at value is not a valid date and time.');
        }
        input.occurredAt = occurredAt.toISOString();
      }
      await gql(APPEND_MUTATION, { input });
      ctx.showToast('Custody event appended to the chain.');
      ctx.announce('Custody event appended; chain verification re-run.');
      await load({ focusHeading: true });
    } catch (appendError) {
      error.textContent = errorMessage(appendError);
      button.disabled = false;
      button.textContent = label;
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
 * Entry point                                                          *
 * ------------------------------------------------------------------ */

export async function mount(root, ctx) {
  const segments = ctx.route.path.split('/').filter(Boolean);
  if (segments.length >= 2) return mountDetail(root, ctx, decodeURIComponent(segments[1]));
  return mountList(root, ctx);
}
