This is the directory where the source code of Tabby is stored.

Note: Because of how Webpack works, all non JavaScript files are in the `dist` folder one level up.

# File Structure

newtab/ - the New Tab dashboard UI, including sticky controls, settings/help, preview cards, recapture flows, and drag-and-drop reorder<br/>
popup/ - the restored legacy popup, standalone, tab, and sidebar management logic<br/>
options/ - the legacy options page logic plus option defaults reused by the New Tab dashboard<br/>
background/ - background preview capture, tab metadata, layout commands, and pinned-dashboard coordination<br/>
content/ - content scripts used by the restored legacy manager surfaces<br/>
manifest.json - source manifest used to generate the built manifest in `dist/`<br/>

# Current rebuild notes

- The New Tab dashboard remains the newest visual surface and stays separate from the legacy layout cycle.
- The dashboard can close, reload, pin, recapture, filter, sort, and reorder tabs for the current window.
- The dashboard persists preview screenshots, first-seen timestamps, preview-density settings, sticky-controls settings, and pinned-dashboard behavior.
- The popup, sidebar, standalone, and tab layouts are restored alongside the New Tab dashboard instead of replacing it.
- Legacy static HTML, CSS, icons, and shared styles are still tracked under `dist/`, while webpack rebuilds the JavaScript bundles those pages load.
