const MANIFEST_URL = '/js/microfrontends/manifest.json';
let manifestPromise = null;
const moduleCache = new Map();

export async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL, { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Microfrontend manifest returned ${response.status}.`);
        const manifest = await response.json();
        if (!manifest || !Array.isArray(manifest.microfrontends)) throw new Error('Microfrontend manifest is malformed.');
        for (const entry of manifest.microfrontends) {
          if (!entry.name || !entry.entry || !entry.route) throw new Error('Microfrontend manifest entry is incomplete.');
        }
        return manifest;
      })
      .catch((error) => {
        manifestPromise = null;
        throw new Error(`Could not load the microfrontend manifest: ${error.message}`);
      });
  }
  return manifestPromise;
}

export function matchMicrofrontend(manifest, path) {
  const routes = [...manifest.microfrontends].sort((a, b) => b.route.length - a.route.length);
  return routes.find((entry) => path === entry.route || path.startsWith(`${entry.route}/`)) ?? null;
}

export async function loadMicrofrontend(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  const manifest = await loadManifest();
  const entry = manifest.microfrontends.find((item) => item.name === name);
  if (!entry) throw new Error(`No microfrontend named "${name}" is registered.`);
  const url = new URL(entry.entry, window.location.origin);
  url.searchParams.set('v', manifest.version ?? '1');
  const module = await import(url.href);
  if (typeof module.mount !== 'function') {
    throw new Error(`Microfrontend "${name}" does not export a mount() function.`);
  }
  moduleCache.set(name, module);
  return module;
}
