/**
 * Tiny safe templating layer. Every interpolation is HTML-escaped unless it
 * is already a SafeHtml value, an array of values, or null/false. This is the
 * only path used to build markup from API data, so a malicious supplier name
 * cannot become executable HTML.
 */
export class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

export function raw(value) {
  return new SafeHtml(String(value ?? ''));
}

function interpolate(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join('');
  return escapeHtml(String(value));
}

export function html(strings, ...values) {
  let output = strings[0];
  for (let index = 0; index < values.length; index += 1) {
    output += interpolate(values[index]) + strings[index + 1];
  }
  return new SafeHtml(output);
}

export function render(value) {
  return value instanceof SafeHtml ? value.value : escapeHtml(String(value ?? ''));
}
