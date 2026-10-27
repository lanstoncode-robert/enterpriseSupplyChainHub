import { createRouter } from './router.js';
import { loadManifest, matchMicrofrontend, loadMicrofrontend } from './microfrontends.js';
import { html } from './html.js';
import { auth } from './auth.js';
import { formatDateTime } from './format.js';
import { gql } from './gql.js';
import {
  announce,
  errorState,
  focusRouteHeading,
  icon,
  pageHeader,
  showToast,
} from './ui.js';

const elements = {
  root: document.getElementById('mf-root'),
  loading: document.getElementById('route-loading'),
  live: document.getElementById('live-region'),
  navLinks: [...document.querySelectorAll('[data-nav]')],
  apiStatus: document.getElementById('api-status'),
  apiStatusDot: document.getElementById('api-status-dot'),
  apiStatusText: document.getElementById('api-status-text'),
  themeToggle: document.getElementById('theme-toggle'),
  tokenButton: document.getElementById('token-button'),
  tokenDialog: document.getElementById('token-dialog'),
  tokenForm: document.getElementById('token-form'),
  tokenInput: document.getElementById('token-input'),
  tokenError: document.getElementById('token-error'),
  tokenCancel: document.getElementById('token-cancel'),
  tokenClear: document.getElementById('token-clear'),
  footerVersion: document.getElementById('footer-version'),
  footerUpdated: document.getElementById('footer-updated'),
};

let manifest = null;
let router = null;
let active = null;
let renderToken = 0;

/* ------------------------------------------------------------------ *
 * Theme                                                               *
 * ------------------------------------------------------------------ */

function applyTheme(dark, { persist = false } = {}) {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  elements.themeToggle?.setAttribute('aria-pressed', String(dark));
  elements.themeToggle?.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  elements.themeToggle?.querySelectorAll('[data-theme-icon]').forEach((node) => {
    node.classList.toggle('hidden', node.dataset.themeIcon !== (dark ? 'dark' : 'light'));
  });
  if (persist) {
    try {
      localStorage.setItem('sch.theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore storage failures */
    }
  }
}

function setupTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(isDark);
  elements.themeToggle?.addEventListener('click', () => {
    const next = !document.documentElement.classList.contains('dark');
    applyTheme(next, { persist: true });
    announce(next ? 'Dark theme enabled.' : 'Light theme enabled.');
  });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', (event) => {
    try {
      if (!localStorage.getItem('sch.theme')) applyTheme(event.matches);
    } catch {
      /* ignore */
    }
  });
}

/* ------------------------------------------------------------------ *
 * Token dialog                                                        *
 * ------------------------------------------------------------------ */

function updateTokenButton() {
  if (!elements.tokenButton) return;
  const configured = auth.hasToken;
  elements.tokenButton.classList.toggle('text-teal-700', configured);
  elements.tokenButton.classList.toggle('dark:text-teal-300', configured);
  elements.tokenButton.setAttribute('aria-label', configured ? 'API access token configured' : 'Configure API access token');
  elements.tokenButton.title = configured ? 'API access token configured' : 'API access token';
  if (elements.tokenClear) elements.tokenClear.hidden = !configured;
}

function openTokenDialog(message = '') {
  if (!elements.tokenDialog) return;
  elements.tokenError.textContent = message;
  if (document.activeElement !== elements.tokenInput) elements.tokenInput.value = auth.token;
  if (typeof elements.tokenDialog.showModal === 'function') {
    if (!elements.tokenDialog.open) elements.tokenDialog.showModal();
    elements.tokenInput.focus();
    elements.tokenInput.select();
  } else {
    elements.tokenDialog.setAttribute('open', '');
  }
}

function closeTokenDialog() {
  if (!elements.tokenDialog) return;
  if (typeof elements.tokenDialog.close === 'function') elements.tokenDialog.close();
  else elements.tokenDialog.removeAttribute('open');
  elements.tokenButton?.focus();
}

function setupTokenDialog() {
  updateTokenButton();
  elements.tokenButton?.addEventListener('click', () => openTokenDialog(''));
  elements.tokenCancel?.addEventListener('click', closeTokenDialog);
  elements.tokenClear?.addEventListener('click', () => {
    auth.clear();
    updateTokenButton();
    closeTokenDialog();
    announce('Saved API token cleared.');
    router?.refresh();
  });
  elements.tokenForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = elements.tokenInput.value.trim();
    if (!token) {
      elements.tokenError.textContent = 'Enter a token before saving.';
      elements.tokenInput.focus();
      return;
    }
    auth.set(token);
    elements.tokenError.textContent = '';
    updateTokenButton();
    closeTokenDialog();
    announce('API token saved for this tab.');
    router?.refresh();
  });
  window.addEventListener('sch:auth-required', (event) => {
    openTokenDialog(event.detail?.message ?? 'A bearer token is required.');
  });
  window.addEventListener('sch:auth-changed', updateTokenButton);
}

/* ------------------------------------------------------------------ *
 * API health                                                          *
 * ------------------------------------------------------------------ */

let healthTimer = null;
let healthInFlight = false;

async function checkHealth() {
  if (healthInFlight) return;
  healthInFlight = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch('/healthz', { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Health check returned ${response.status}`);
    const data = await response.json();
    elements.apiStatusDot?.classList.remove('bg-slate-400', 'bg-rose-500');
    elements.apiStatusDot?.classList.add('bg-emerald-500');
    elements.apiStatusText.textContent = 'API online';
    elements.apiStatus?.setAttribute('title', `Version ${data.version} · uptime ${data.uptimeSeconds}s`);
    if (elements.footerVersion) elements.footerVersion.textContent = `v${data.version}`;
  } catch (error) {
    if (error.name === 'AbortError') return;
    elements.apiStatusDot?.classList.remove('bg-slate-400', 'bg-emerald-500');
    elements.apiStatusDot?.classList.add('bg-rose-500');
    elements.apiStatusText.textContent = 'API offline';
    elements.apiStatus?.setAttribute('title', 'The API health check failed. Retrying every 30 seconds.');
  } finally {
    window.clearTimeout(timeout);
    healthInFlight = false;
  }
}

function setupHealth() {
  checkHealth();
  healthTimer = window.setInterval(() => {
    if (!document.hidden) checkHealth();
  }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkHealth();
  });
  window.addEventListener('beforeunload', () => window.clearInterval(healthTimer));
}

/* ------------------------------------------------------------------ *
 * Route rendering and microfrontend lifecycle                         *
 * ------------------------------------------------------------------ */

function setNavActive(name) {
  for (const link of elements.navLinks) {
    if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function showSkeleton(show) {
  elements.loading?.classList.toggle('hidden', !show);
  if (elements.root) elements.root.hidden = show;
}

function renderNotFound() {
  setNavActive('');
  elements.root.hidden = false;
  elements.root.innerHTML = html`
    ${pageHeader({
      eyebrow: '404',
      title: 'Page not found',
      description: 'That route is not registered with the microfrontend loader. Use the navigation above or return to the dashboard.',
    })}
    <div class="card p-6">
      <p class="text-sm text-slate-600 dark:text-slate-300">Registered routes: dashboard, orders, traceability, suppliers.</p>
      <p class="mt-4"><a class="btn-primary" href="#/dashboard">${icon('arrow-left')}Back to dashboard</a></p>
    </div>
  `.value;
  announce('Page not found.');
}

function renderShellError(message) {
  elements.root.hidden = false;
  elements.root.innerHTML = html`
    <div class="mx-auto max-w-2xl py-8">
      ${errorState({
        title: 'The dashboard could not start',
        message,
        retry: false,
        action: html`<button type="button" class="btn-primary" data-action="reload-shell">${icon('refresh')}Reload</button>`,
      })}
    </div>
  `.value;
}

function createContext(route) {
  return {
    route,
    gql,
    auth,
    navigate: (path, options) => router?.navigate(path, options),
    refresh: () => router?.refresh(),
    announce,
    showToast,
    setTitle: (title) => {
      document.title = `${title} · Supply Chain Hub`;
    },
    setLastUpdated: (value) => {
      if (elements.footerUpdated) {
        elements.footerUpdated.textContent = value ? `Data updated ${formatDateTime(value)}` : 'Data updated —';
      }
    },
    focusHeading: () => focusRouteHeading(elements.root),
  };
}

async function renderRoute(route) {
  const path = route.path === '/' ? '/dashboard' : route.path;
  if (!manifest) return;
  const entry = matchMicrofrontend(manifest, path);
  if (!entry) {
    renderNotFound();
    return;
  }

  const token = ++renderToken;
  setNavActive(entry.name);
  showSkeleton(true);

  if (active?.cleanup) {
    try {
      await active.cleanup();
    } catch (error) {
      console.warn('Microfrontend cleanup failed', error);
    }
    active = null;
  }

  let module;
  try {
    module = await loadMicrofrontend(entry.name);
  } catch (error) {
    if (token !== renderToken) return;
    showSkeleton(false);
    elements.root.hidden = false;
    elements.root.innerHTML = html`
      <div class="mx-auto max-w-2xl py-8">
        ${errorState({
          title: `The ${entry.title} module failed to load`,
          message: error.message,
          action: html`<a class="btn-secondary" href="#/dashboard">Go to dashboard</a>`,
        })}
      </div>
    `.value;
    return;
  }

  if (token !== renderToken) return;

  const container = document.createElement('div');
  container.className = 'animate-fade-up';
  elements.root.replaceChildren(container);
  showSkeleton(false);
  elements.root.hidden = false;

  const context = createContext({ ...route, path });
  try {
    const cleanup = await module.mount(container, context);
    if (token !== renderToken) {
      if (typeof cleanup === 'function') await cleanup();
      return;
    }
    active = { name: entry.name, cleanup: typeof cleanup === 'function' ? cleanup : null };
    if (!document.title.includes('·')) document.title = `${entry.title} · Supply Chain Hub`;
    focusRouteHeading(container);
    announce(`${entry.title} page loaded.`);
  } catch (error) {
    if (token !== renderToken) return;
    console.error('Microfrontend mount failed', error);
    container.innerHTML = html`
      ${errorState({
        title: `The ${entry.title} view could not be rendered`,
        message: error.message,
        action: html`<a class="btn-secondary" href="#/dashboard">Go to dashboard</a>`,
      })}
    `.value;
    announce(`${entry.title} failed to load.`);
  }
}

/* ------------------------------------------------------------------ *
 * Boot                                                                *
 * ------------------------------------------------------------------ */

async function boot() {
  setupTheme();
  setupTokenDialog();
  setupHealth();

  if (elements.root) {
    elements.root.addEventListener('click', (event) => {
      if (event.target.closest?.('[data-action="reload-shell"]')) {
        window.location.reload();
        return;
      }
      if (event.target.closest?.('[data-action="retry"]') && !event.defaultPrevented) {
        router?.refresh();
      }
    });
  }

  try {
    manifest = await loadManifest();
  } catch (error) {
    renderShellError(error.message);
    return;
  }

  router = createRouter(renderRoute);
  window.addEventListener('beforeunload', () => {
    if (active?.cleanup) {
      try {
        active.cleanup();
      } catch {
        /* ignore */
      }
    }
  });
}

void boot();
