export function parseRoute(hash = window.location.hash) {
  let raw = String(hash).replace(/^#/, '');
  if (!raw) raw = '/dashboard';
  const [pathPart, queryPart = ''] = raw.split('?');
  let path = pathPart || '/dashboard';
  if (!path.startsWith('/')) path = `/${path}`;
  try {
    path = decodeURI(path);
  } catch {
    /* Keep the undecoded path; the route will fall through to not-found. */
  }
  return { path, query: new URLSearchParams(queryPart), full: raw };
}

export function createRouter(onChange) {
  let current = null;
  let destroyed = false;

  const notify = () => {
    if (destroyed) return;
    const route = parseRoute();
    if (current && current.full === route.full) return;
    current = route;
    onChange(route);
  };

  const onHashChange = () => {
    current = null;
    notify();
  };

  if (!window.location.hash) {
    window.history.replaceState(null, '', '#/dashboard');
  }
  window.addEventListener('hashchange', onHashChange);
  queueMicrotask(notify);

  return {
    navigate(path, { replace = false } = {}) {
      if (destroyed) return;
      const target = `#${path.startsWith('/') ? path : `/${path}`}`;
      if (window.location.hash === target) {
        current = null;
        notify();
        return;
      }
      if (replace) {
        window.history.replaceState(null, '', target);
        current = null;
        notify();
      } else {
        window.location.hash = target;
      }
    },
    refresh() {
      current = null;
      notify();
    },
    destroy() {
      destroyed = true;
      window.removeEventListener('hashchange', onHashChange);
    },
  };
}
