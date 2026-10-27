const STORAGE_KEY = 'sch.api.token';
let memoryToken = '';

function readStorage() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return memoryToken;
  }
}

export const auth = {
  get token() {
    return readStorage();
  },
  get hasToken() {
    return Boolean(readStorage());
  },
  set(token) {
    memoryToken = token;
    try {
      sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* session storage unavailable: memory only for this tab */
    }
    window.dispatchEvent(new CustomEvent('sch:auth-changed', { detail: { hasToken: Boolean(token) } }));
  },
  clear() {
    memoryToken = '';
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('sch:auth-changed', { detail: { hasToken: false } }));
  },
};
