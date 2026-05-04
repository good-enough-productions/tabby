# Tabby Window And Tab Manager

[![ci](https://github.com/Bill13579/tabby/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/Bill13579/tabby/actions/workflows/ci.yml)

Tabby is being rebuilt as a Firefox-first tab manager with a visual New Tab dashboard plus restored popup, sidebar, and standalone layouts.

The New Tab page is based on static screenshots, not live embedded pages. Tabby now treats the New Tab page as a pinned dashboard for the current window: you can jump back to it quickly, close or pin tabs directly from the card grid, trigger preview recaptures, use compact or detailed cards, and reorder real browser tabs by dragging cards in browser-order mode. The older management layouts are also available again through the popup, sidebar, and standalone/tab surfaces.

## Current scope

- Replace the browser new tab page with a dashboard of preview cards for the other tabs in the current window.
- Show each tab's title, URL, favicon, and latest captured screenshot on the New Tab dashboard.
- Activate, close, pin or unpin, reload, and recapture tabs directly from the New Tab dashboard.
- Keep a single pinned Tabby dashboard tab per window so it stays easy to find in long tab strips.
- Toggle between compact screenshot-only cards and a more detailed New Tab card view with actions and metadata.
- Filter tabs by search text, bookmark state, pinned state, discarded state, audible state, and domain.
- Sort tabs by browser order, domain, title, opened time, and bookmark status.
- Reorder real browser tabs by dragging cards while the dashboard is in browser-order mode.
- Recapture all visible previews at once or enter a selection mode and recapture only chosen cards.
- Track first-seen timestamps for tabs so recently opened and oldest-opened sorts have stable data.
- Open the restored Tabby layouts through the popup, sidebar, standalone window, or dedicated tab view.
- Cycle between the legacy management layouts without affecting the New Tab dashboard, which remains available separately on every new tab.

## Limitations

- Preview cards are screenshots, not live interactive views.
- Firefox is the primary target for the current rebuild and legacy-layout compatibility.
- A tab without a cached screenshot will show a placeholder until it has been activated and captured.
- Discarded tabs cannot be previewed until they are reloaded or activated.
- Preview recapture depends on the browser's screenshot APIs. Some tabs still capture more reliably after they are reloaded or reactivated.
- "Opened time" is tracked from when Tabby first sees the tab, not from a browser-provided creation timestamp.
- Drag-and-drop reorder on the New Tab dashboard is only enabled in browser-order mode. Other sort modes are read-only projections of the same tab set.
- Tabs cannot be dragged across the pinned/unpinned boundary unless their pin state already matches the target region.
- The restored legacy layouts are functional again, but the newest preview-focused affordances live on the New Tab dashboard first.

## Layouts

Tabby now exposes two families of surfaces again:

- The New Tab dashboard: visual previews, direct tab actions, preview recapture, compact or detailed cards, and drag-and-drop reorder.
- The restored legacy layouts: popup, sidebar, standalone window, and tab view for the older list-oriented management workflow.

The New Tab dashboard is not part of the legacy layout cycle. Opening or cycling the restored layouts should not replace the browser's New Tab preview dashboard.

## Building

### Prerequisites

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/en/) >= 16.15.0 LTS
- Firefox >= 59 recommended for the current preview workflow

### Build commands

1. Clone the repository.
2. Install dependencies with `npm install`.
3. Build the Firefox target with `npm run build:firefox`.

Additional targets remain in the repo:

- Chrome: `npm run build:chrome`
- Generic WebExtension bundle: `npm run build:webext`

The build writes assets to `dist`.

## Installation

### Firefox

1. Open `about:debugging`.
2. Choose `This Firefox`.
3. Select `Load Temporary Add-on...`.
4. Pick `dist/manifest.json`.

Do not load `src/manifest.json`. The `src` folder contains source files only; Firefox needs the built files emitted into `dist`, including `dist/newtab/newtab.html`, the popup/options/background bundles, and the restored static layout assets under `dist/popup`, `dist/options`, `dist/icons`, and `dist/stylesheets`.

### Chrome

Chrome builds remain in the repo, but the preview experience is currently tuned for Firefox-first behavior and has not been validated to the same level.

## Development notes

- The new tab page is emitted as `dist/newtab/newtab.html` during the webpack build.
- The background worker in `src/background/captureTab.js` now handles screenshot capture, preview caching, tab metadata, and pinned-dashboard enforcement.
- The new tab UI in `src/newtab/newtab.js` owns the card grid, sticky toolbar, settings/help surface, per-card tab actions, preview-density toggle, and drag-and-drop reorder interactions.
- The restored popup, sidebar, standalone, and options page still rely on tracked static assets under `dist/` plus webpack-generated JS bundles.
- If you change source files, rebuild before reloading the extension in the browser.

## File structure

- `src/newtab/` contains the New Tab dashboard UI.
- `src/popup/` contains the restored legacy popup/sidebar/tab manager logic.
- `src/options/` contains the options page logic and option defaults.
- `src/background/` contains layout commands, background coordination, and preview capture.
- `dist/` contains the built JS bundles plus tracked static assets for the restored legacy layouts.
