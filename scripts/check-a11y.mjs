import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';

const failures = [];
const warnings = [];
const publicDir = config.publicDir;

async function read(relative) {
  return readFile(path.join(publicDir, relative), 'utf8');
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

const index = await read('index.html');
if (!/<html[^>]+lang="en"/.test(index)) fail('index.html must declare lang="en" on <html>.');
if (!/<meta name="viewport"/.test(index)) fail('index.html must declare a viewport meta tag.');
if (!/<a[^>]+href="#main"[^>]*class="skip-link"/.test(index)) fail('index.html must include a skip link to #main.');
if (!/<main[^>]+id="main"[^>]+tabindex="-1"/.test(index)) fail('index.html must include <main id="main" tabindex="-1">.');
if (!/<dialog[^>]+aria-labelledby=/.test(index)) fail('The token dialog must be labelled with aria-labelledby.');
if (!/<label[^>]+for="token-input"/.test(index)) fail('The token input needs an explicit label.');
if (!/aria-live="polite"/.test(index)) fail('A polite live region is required for async announcements.');
if (!/<noscript>/.test(index)) fail('A <noscript> fallback is required.');
if (/style="/.test(index)) fail('Inline style attributes are blocked by the CSP; use classes instead.');
if (/<button(?![^>]*type=)[^>]*>/.test(index)) fail('Every button must declare an explicit type.');
if (/<img(?![^>]*alt=)[^>]*>/.test(index)) fail('Every image must have an alt attribute.');
if (/target="_blank"(?![^>]*rel=)/.test(index)) fail('New-window links must include rel="noopener".');

const jsDir = path.join(publicDir, 'js');
const jsFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.name.endsWith('.js')) jsFiles.push(full);
  }
}
await walk(jsDir);

for (const file of jsFiles) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(publicDir, file);
  const buttons = source.match(/<button\b[^>]*>/g) ?? [];
  for (const tag of buttons) {
    if (!/\btype=/.test(tag)) fail(`${relative}: button without explicit type: ${tag.slice(0, 80)}`);
  }
  const images = source.match(/<img\b[^>]*>/g) ?? [];
  for (const tag of images) {
    if (!/\balt=/.test(tag)) fail(`${relative}: image without alt: ${tag.slice(0, 80)}`);
  }
  if (/target="_blank"(?![^>]*rel=)/.test(source)) fail(`${relative}: target="_blank" without rel.`);
  if (/\.innerHTML\s*=\s*(?!html`|`.+?`\.value|[a-zA-Z]+\.value)/.test(source)) {
    warn(`${relative}: review direct innerHTML assignments for escaping.`);
  }
}

const css = await readFile(path.join(config.rootDir, 'styles', 'app.css'), 'utf8');
if (!/:focus-visible/.test(css)) fail('Global :focus-visible styling is missing.');
if (!/prefers-reduced-motion/.test(css)) fail('prefers-reduced-motion handling is missing.');
if (!/\.skip-link/.test(css)) fail('Skip-link styling is missing.');

if (failures.length > 0) {
  console.error('Accessibility static checks failed:');
  for (const failure of failures) console.error(`  ✖ ${failure}`);
  process.exit(1);
}

console.log('Accessibility static checks passed: language, landmarks, skip link, labels, live regions, button types, reduced motion, focus styles.');
console.log(`Scanned ${jsFiles.length} frontend modules.`);
if (warnings.length > 0) {
  console.log('Review notes:');
  for (const warning of warnings) console.log(`  • ${warning}`);
}
console.log('Manual gate still required: axe/Lighthouse plus keyboard and screen-reader passes on Dashboard, Orders, Traceability, Suppliers.');
