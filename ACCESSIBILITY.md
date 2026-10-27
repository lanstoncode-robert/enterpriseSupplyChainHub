# Accessibility

## Target and status

This application is **designed against WCAG 2.1 Level AA** and has been checked with automated source scans, a real headless-browser render, and keyboard-oriented interaction tests. It is **not third-party certified**. Run axe/Lighthouse and a manual screen-reader pass before making a formal conformance claim.

## Implemented practices

### Perceivable

- Text alternatives: decorative SVGs are `aria-hidden`; informative SVGs carry `<title>` and `<desc>`; the spend chart has an expandable data table with the same numbers.
- Colour is never the only signal: statuses, risk, chain verification, and delays all include text labels and icons.
- Contrast targets: slate-900/700 on white, slate-100/300 on slate-900, teal-700/300 for links, dark badge text on tinted backgrounds. Muted text uses `dark:text-slate-400` on dark surfaces.
- Layout reflows at 390px without page-level horizontal scroll; tables scroll inside their own labelled container.
- Text can be zoomed to 200% without loss of content; no fixed-height text containers.

### Operable

- Full keyboard operation: skip link, nav, filters, sortable table headers, pagination, dialogs, forms.
- Visible focus ring (`:focus-visible`, 2px teal, offset), except the programmatically focused `h1` which is not tabbable.
- Minimum 44px targets for buttons and inputs.
- Native `<dialog>` traps focus, closes with Escape, and restores focus to the token button.
- No autoplaying media, carousels, or time-limited interactions.
- `prefers-reduced-motion` disables animations and smooth scrolling.
- Route changes move focus to the new `h1` and announce the page.

### Understandable

- One `h1` per route, ordered `h2`/`h3` sections, landmark regions (`header`, `nav`, `main`, `footer`).
- Inputs have visible labels and optional/required text; errors use `role="alert"` and are associated with the form.
- Status transitions are explained; risk factors are itemised rather than opaque.
- Dates use locale-aware formatting; quantities and currency are tabular and consistent.
- The UI remains usable in light and dark themes.

### Robust

- Semantic tables with `<caption>`, `<th scope>`, `aria-sort` on sortable columns, and accessible action link names.
- `aria-current="page"` on the active navigation item.
- Live regions (`polite`) for async results; errors are assertive via `role="alert"`.
- No reliance on hover; all hover-only information is also in text.
- No custom ARIA widgets where native elements suffice (`dialog`, `progress`, `details`, `button`, `select`).

## Automated checks in this repository

```bash
npm run a11y
```

The static checker verifies:

- `lang="en"`, viewport, skip link, `main` with `tabindex="-1"`, live region, noscript fallback
- labels on the token dialog, `aria-labelledby` on the dialog
- explicit button types, image alt text, `rel` on new-window links
- no inline `style` attributes (CSP)
- global `:focus-visible`, skip-link styles, reduced-motion CSS
- flags direct `innerHTML` assignments for review

The browser check (used during development, not shipped as a dependency) additionally verified:

- dashboard metrics render
- order pagination, server-side search, create form submission
- status update mutation and history persistence
- traceability event append and chain verification
- 390px viewport has no horizontal page overflow
- no uncaught browser exceptions during the flows

## Manual audit checklist

1. **Keyboard only:** Tab through every view; confirm focus order, visible focus, no traps, Escape closes the dialog, pagination and sort buttons work.
2. **Screen reader:** VoiceOver/NVDA pass on dashboard, order detail, traceability detail, and the create form. Confirm table headers, status announcements, and error alerts.
3. **Zoom/reflow:** 200% and 400% zoom; 320px viewport; confirm no clipped controls or two-dimensional page scrolling (table scroll is expected).
4. **Contrast:** axe or a contrast analyser on both themes, including badges, muted text, and chart labels.
5. **Forms:** submit empty/invalid values; confirm error identification, suggestions, and that focus moves to the first error.
6. **Reduced motion:** enable the OS setting; confirm no animation and no smooth scroll.
7. **Colour blindness:** simulate deuteranopia/protanopia; confirm text labels remain sufficient.
8. **Dynamic updates:** change filters and status; confirm polite announcements do not drown out the form.

## Known limitations

- The chart is an SVG line chart; screen-reader users get the summary and the data table, not a sonified graph.
- The table pagination is cursor-based, so the page number is approximate; the summary reports the visible range.
- Very long lot/serial/hash strings wrap mid-token; this is intentional to avoid horizontal scrolling.
- The dashboard is client-rendered; with JavaScript disabled only the API and a notice are available.
- Native `<dialog>` support is required (current evergreen browsers); older browsers fall back to an `open` attribute without a full focus trap.
- Contrast is designed to meet AA but not measured automatically in CI; add axe to CI when a headless browser is available.

## Reporting

If you find a barrier, include the route, browser/assistive technology, steps, and expected vs actual behaviour. Accessibility fixes are treated as bugs, not enhancements.
