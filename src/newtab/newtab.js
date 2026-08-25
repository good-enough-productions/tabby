import "Polyfill";
import { resolveDefault } from "../options/exports";
import { smartCleanBookmarks, scanAndAnalyzeDuplicates } from "../background/bookmarkRules";
import { $local$ } from "../tapi/store";
import { tokenizeTitle, extractKeywordCloud, extractNgrams, extractNonAdjacentCoOccurrences, clusterByDomainAndTheme, generateLlmPrompt, recordTabVisit, getTabHistoryAnalytics } from "./intelligence";

const root = document.getElementById("app");
const NEWTAB_URL = browser.runtime.getURL("newtab/newtab.html");
const CARD_PREVIEW_RATIO = "56.25%";
const PREVIEW_QUALITY = {
    format: "jpeg",
    quality: 50,
    scale: 0.2
};

const OPTION_DETAIL_MODE = "option:newtab-detail-mode";
const OPTION_STICKY_CONTROLS = "option:newtab-sticky-controls";
const OPTION_KEEP_PINNED = "option:newtab-keep-pinned";
const SESSION_AUTOSAVE_KEY = "tabby-session-autosave-v1";

const SORT_MODES = {
    browser: "Browser order",
    domain: "Domain",
    title: "Title",
    openedNewest: "Recently opened",
    openedOldest: "Oldest opened",
    bookmarked: "Bookmarked first"
};

const STATUS_FILTERS = {
    all: "All tabs",
    bookmarked: "Bookmarked",
    unbookmarked: "Unbookmarked",
    pinned: "Pinned",
    unpinned: "Unpinned",
    discarded: "Discarded",
    audible: "Audible"
};

let renderedTabIds = [];
let previewCache = {};
let tabMeta = {};
let bookmarkState = {};
let tabState = [];
let dragTabId;
let bookmarkBarFolders = [];

const selectionState = {
    active: false,
    tabIds: new Set()
};

const viewState = {
    search: "",
    statusFilter: "all",
    domainFilter: "all",
    sortMode: "browser",
    detailMode: resolveDefault(OPTION_DETAIL_MODE),
    controlsExpanded: false,
    stickyControls: resolveDefault(OPTION_STICKY_CONTROLS),
    keepPinned: resolveDefault(OPTION_KEEP_PINNED),
    settingsOpen: false,
    recaptureMenuOpen: false
};

async function loadDashboardSetting(optionID) {
    let value;
    await $local$.fulfillOnce(optionID, optionValue => {
        value = optionValue;
    }, resolveDefault(optionID));
    return value;
}

async function saveDashboardSetting(optionID, value) {
    await $local$.set(optionID, value);
    return value;
}

async function loadDashboardSettings() {
    let [detailMode, stickyControls, keepPinned] = await Promise.all([
        loadDashboardSetting(OPTION_DETAIL_MODE),
        loadDashboardSetting(OPTION_STICKY_CONTROLS),
        loadDashboardSetting(OPTION_KEEP_PINNED)
    ]);

    viewState.detailMode = detailMode;
    viewState.stickyControls = stickyControls;
    viewState.keepPinned = keepPinned;
}

document.title = "Tabby New Tab";
document.documentElement.style.colorScheme = "light";
document.body.style.margin = "0";
document.body.style.fontFamily = '"Segoe UI", sans-serif';
document.body.style.background = "radial-gradient(circle at top, #f7fbff 0%, #eaf2fa 42%, #e3ebf4 100%)";
document.body.style.color = "#17202a";

const style = document.createElement("style");
style.textContent = `
    :root {
        --tabby-ink: #17202a;
        --tabby-muted: #48606f;
        --tabby-soft: #56748f;
        --tabby-panel: rgba(255, 255, 255, 0.82);
        --tabby-panel-strong: rgba(255, 255, 255, 0.95);
        --tabby-border: rgba(109, 133, 160, 0.25);
        --tabby-accent: #135ba1;
        --tabby-accent-soft: rgba(19, 91, 161, 0.12);
        --tabby-shadow: 0 18px 40px rgba(23, 50, 77, 0.10);
        --tabby-shadow-strong: 0 24px 54px rgba(23, 50, 77, 0.16);
    }

    body {
        min-width: 320px;
    }

    .tabby-shell {
        min-height: 100vh;
        padding: 28px;
        box-sizing: border-box;
        max-width: 1560px;
        margin: 0 auto;
    }

    .tabby-top-panel {
        position: relative;
        margin-bottom: 18px;
    }

    .tabby-top-panel.-sticky {
        position: sticky;
        top: 0;
        z-index: 30;
        padding-top: 14px;
    }

    .tabby-top-panel-inner {
        border-radius: 28px;
        padding: 18px 18px 14px;
        background: linear-gradient(180deg, rgba(247, 251, 255, 0.95), rgba(233, 242, 250, 0.92));
        border: 1px solid rgba(109, 133, 160, 0.20);
        box-shadow: var(--tabby-shadow);
        backdrop-filter: blur(18px);
    }

    .tabby-hero {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 18px;
        margin-bottom: 18px;
    }

    .tabby-hero-copy {
        max-width: 820px;
    }

    .tabby-eyebrow {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.18em;
        color: var(--tabby-soft);
        margin-bottom: 8px;
    }

    .tabby-heading {
        margin: 0 0 8px;
        font-size: clamp(34px, 4vw, 48px);
        line-height: 1.02;
    }

    .tabby-subheading {
        margin: 0;
        line-height: 1.55;
        color: var(--tabby-muted);
    }

    .tabby-hero-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
        position: relative;
    }

    .tabby-button,
    .tabby-select,
    .tabby-search,
    .tabby-settings-close {
        border-radius: 14px;
        border: 1px solid var(--tabby-border);
        background: var(--tabby-panel-strong);
        color: var(--tabby-ink);
        box-shadow: var(--tabby-shadow);
    }

    .tabby-button,
    .tabby-settings-close {
        padding: 12px 16px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
    }

    .tabby-button {
        background: #17324d;
        border: none;
        color: #f8fbff;
    }

    .tabby-button.-secondary,
    .tabby-settings-close {
        background: rgba(255, 255, 255, 0.92);
        color: var(--tabby-ink);
        border: 1px solid var(--tabby-border);
    }

    .tabby-button.-icon {
        min-width: 48px;
        padding-inline: 14px;
        font-size: 19px;
        line-height: 1;
    }

    .tabby-button.-disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .tabby-inline-toggle {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        border-radius: 999px;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid var(--tabby-border);
        box-shadow: var(--tabby-shadow);
        color: var(--tabby-ink);
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
    }

    .tabby-inline-toggle input,
    .tabby-switch input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
    }

    .tabby-toggle-track {
        position: relative;
        width: 42px;
        height: 24px;
        border-radius: 999px;
        background: rgba(86, 116, 143, 0.24);
        transition: background 120ms ease;
        flex-shrink: 0;
    }

    .tabby-toggle-track::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: #ffffff;
        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15);
        transition: transform 120ms ease;
    }

    .tabby-inline-toggle input:checked + .tabby-toggle-track,
    .tabby-switch input:checked + .tabby-toggle-track {
        background: var(--tabby-accent);
    }

    .tabby-inline-toggle input:checked + .tabby-toggle-track::after,
    .tabby-switch input:checked + .tabby-toggle-track::after {
        transform: translateX(18px);
    }

    .tabby-toolbar {
        display: grid;
        grid-template-columns: minmax(220px, 1.5fr) repeat(3, minmax(150px, 0.65fr));
        gap: 12px;
        margin-bottom: 14px;
    }

    .tabby-search,
    .tabby-select {
        width: 100%;
        padding: 12px 14px;
        box-sizing: border-box;
        font: inherit;
    }

    .tabby-meta-bar,
    .tabby-selection-bar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        color: var(--tabby-muted);
        flex-wrap: wrap;
    }

    .tabby-selection-bar {
        margin-bottom: 12px;
        padding: 12px 14px;
        border-radius: 18px;
        background: rgba(19, 91, 161, 0.08);
        border: 1px solid rgba(19, 91, 161, 0.16);
    }

    .tabby-selection-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
    }

    .tabby-status,
    .tabby-hint,
    .tabby-selection-copy {
        margin: 0;
    }

    .tabby-hint {
        font-size: 13px;
    }

    .tabby-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
        gap: 16px;
    }

    .tabby-card {
        border-radius: 24px;
        border: 1px solid var(--tabby-border);
        background: var(--tabby-panel);
        box-shadow: var(--tabby-shadow);
        overflow: hidden;
        backdrop-filter: blur(12px);
        transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        position: relative;
    }

    .tabby-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--tabby-shadow-strong);
    }

    .tabby-close-overlay {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        border: none;
        background: rgba(13, 27, 45, 0.55);
        color: #fff;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 120ms ease, background 120ms ease;
        z-index: 3;
        backdrop-filter: blur(4px);
    }

    .tabby-card:hover .tabby-close-overlay {
        opacity: 1;
    }

    .tabby-close-overlay:hover {
        background: rgba(190, 30, 45, 0.82);
    }

    .tabby-minimal-title {
        padding: 10px 14px 4px;
        font-weight: 700;
        font-size: 13px;
        line-height: 1.35;
        color: var(--tabby-ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .tabby-card.-preview-only .tabby-card-main {
        padding: 0;
    }

    .tabby-card.-preview-only .tabby-preview {
        border-radius: 0;
        box-shadow: none;
    }

    .tabby-card.-selection-mode {
        cursor: pointer;
    }

    .tabby-card.-selected {
        border-color: rgba(19, 91, 161, 0.55);
        box-shadow: 0 0 0 3px rgba(19, 91, 161, 0.15), var(--tabby-shadow-strong);
    }

    .tabby-card.-active-drop-before::before,
    .tabby-card.-active-drop-after::after {
        content: "";
        position: absolute;
        left: 18px;
        right: 18px;
        height: 4px;
        border-radius: 999px;
        background: var(--tabby-accent);
        z-index: 2;
    }

    .tabby-card.-active-drop-before::before {
        top: 8px;
    }

    .tabby-card.-active-drop-after::after {
        bottom: 8px;
    }

    .tabby-card.-dragging {
        opacity: 0.5;
    }

    .tabby-card-main {
        width: 100%;
        border: none;
        background: transparent;
        padding: 14px;
        cursor: pointer;
        text-align: left;
        display: block;
    }

    .tabby-preview {
        position: relative;
        padding-top: ${CARD_PREVIEW_RATIO};
        border-radius: 18px;
        overflow: hidden;
        background: linear-gradient(145deg, #d9e5f2 0%, #eef4fb 100%);
        box-shadow: inset 0 0 0 1px rgba(98, 126, 156, 0.16);
    }

    .tabby-preview img,
    .tabby-preview .tabby-placeholder {
        position: absolute;
        inset: 0;
    }

    .tabby-preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .tabby-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        text-align: center;
        color: #36506a;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.48) 0%, rgba(214, 226, 239, 0.70) 100%);
    }

    .tabby-selection-chip {
        position: absolute;
        top: 12px;
        right: 12px;
        border-radius: 999px;
        padding: 7px 10px;
        font-size: 12px;
        font-weight: 700;
        background: rgba(255, 255, 255, 0.92);
        color: var(--tabby-ink);
        box-shadow: 0 8px 18px rgba(23, 50, 77, 0.18);
        pointer-events: none;
    }

    .tabby-selection-chip.-selected {
        background: rgba(19, 91, 161, 0.92);
        color: #f8fbff;
    }

    .tabby-meta-row {
        display: flex;
        gap: 12px;
        justify-content: space-between;
        align-items: flex-start;
        margin: 14px 2px 10px;
    }

    .tabby-card-url-meta {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: var(--tabby-soft);
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .tabby-title {
        font-weight: 700;
        line-height: 1.35;
        color: var(--tabby-ink);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .tabby-pill {
        flex-shrink: 0;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 700;
        color: #36506a;
        background: rgba(54, 80, 106, 0.09);
    }

    .tabby-badges {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 0 0 6px;
    }

    .tabby-badge {
        border-radius: 999px;
        padding: 5px 9px;
        font-size: 11px;
        font-weight: 700;
        background: rgba(54, 80, 106, 0.08);
        color: #36506a;
    }

    .tabby-badge.-accent {
        background: var(--tabby-accent-soft);
        color: var(--tabby-accent);
    }

    .tabby-action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 14px 14px;
    }

    .tabby-action {
        border: 1px solid var(--tabby-border);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.94);
        color: var(--tabby-ink);
        padding: 8px 11px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
    }

    .tabby-empty {
        border-radius: 24px;
        padding: 30px;
        text-align: center;
        background: rgba(255, 255, 255, 0.65);
        border: 1px dashed rgba(109, 133, 160, 0.45);
        color: var(--tabby-muted);
    }

    .tabby-mini-panel {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        min-width: 250px;
        border-radius: 18px;
        border: 1px solid var(--tabby-border);
        background: rgba(255, 255, 255, 0.98);
        box-shadow: var(--tabby-shadow-strong);
        padding: 10px;
        display: none;
        z-index: 35;
    }

    .tabby-mini-panel.-open {
        display: grid;
        gap: 8px;
    }

    .tabby-mini-panel button {
        width: 100%;
        text-align: left;
    }

    .tabby-settings-scrim {
        position: fixed;
        inset: 0;
        background: rgba(13, 27, 45, 0.28);
        backdrop-filter: blur(8px);
        display: none;
        z-index: 40;
    }

    .tabby-settings-scrim.-open {
        display: block;
    }

    .tabby-settings-panel {
        position: fixed;
        top: 24px;
        right: 24px;
        width: min(430px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        overflow: auto;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(109, 133, 160, 0.22);
        box-shadow: var(--tabby-shadow-strong);
        padding: 20px;
        display: none;
        z-index: 41;
    }

    .tabby-settings-panel.-open {
        display: block;
    }

    .tabby-settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
    }

    .tabby-settings-title {
        margin: 0;
        font-size: 20px;
    }

    .tabby-settings-section + .tabby-settings-section {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid rgba(109, 133, 160, 0.18);
    }

    .tabby-settings-section h3 {
        margin: 0 0 10px;
        font-size: 15px;
    }

    .tabby-settings-copy,
    .tabby-settings-list {
        margin: 0;
        color: var(--tabby-muted);
        line-height: 1.55;
    }

    .tabby-settings-list {
        padding-left: 18px;
    }

    .tabby-setting-row {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: flex-start;
        padding: 12px 0;
    }

    .tabby-setting-copy strong {
        display: block;
        margin-bottom: 4px;
    }

    .tabby-setting-copy span {
        color: var(--tabby-muted);
        line-height: 1.45;
    }

    .tabby-switch {
        position: relative;
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        margin-top: 4px;
    }

    @media (max-width: 980px) {
        .tabby-hero {
            flex-direction: column;
            align-items: stretch;
        }

        .tabby-hero-actions {
            justify-content: flex-start;
        }

        .tabby-toolbar {
            grid-template-columns: 1fr 1fr;
        }
    }

    @media (max-width: 720px) {
        .tabby-shell {
            padding: 18px;
        }

        .tabby-top-panel.-sticky {
            top: 0;
            padding-top: 10px;
        }

        .tabby-top-panel-inner {
            padding: 14px;
        }

        .tabby-toolbar {
            grid-template-columns: 1fr;
        }

        .tabby-settings-panel {
            top: 16px;
            right: 16px;
            width: calc(100vw - 32px);
            max-height: calc(100vh - 32px);
        }
    }

    .tabby-detail-seg {
        display: inline-flex;
        border-radius: 999px;
        border: 1px solid var(--tabby-border);
        background: rgba(255, 255, 255, 0.92);
        box-shadow: var(--tabby-shadow);
        overflow: hidden;
        flex-shrink: 0;
    }

    .tabby-detail-seg-btn {
        padding: 10px 14px;
        border: none;
        border-left: 1px solid var(--tabby-border);
        background: transparent;
        color: var(--tabby-ink);
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: background 100ms ease, color 100ms ease;
    }

    .tabby-detail-seg-btn:first-child {
        border-left: none;
    }

    .tabby-detail-seg-btn.-active {
        background: #17324d;
        color: #f8fbff;
    }

    .tabby-detail-seg.-stretch {
        width: 100%;
        border-radius: 14px;
    }

    .tabby-detail-seg.-stretch .tabby-detail-seg-btn {
        flex: 1;
        text-align: center;
        padding: 10px 8px;
    }

    .tabby-hero-collapsible-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    }

    .tabby-expand-btn {
        display: none;
    }

    .tabby-top-panel-inner.-collapsed .tabby-hero-copy,
    .tabby-top-panel-inner.-collapsed .tabby-hero-collapsible-actions,
    .tabby-top-panel-inner.-collapsed .tabby-toolbar,
    .tabby-top-panel-inner.-collapsed .tabby-meta-bar {
        display: none;
    }

    .tabby-top-panel-inner.-collapsed .tabby-hero {
        margin-bottom: 0;
    }

    .tabby-top-panel-inner.-collapsed .tabby-expand-btn {
        display: inline-flex;
        align-items: center;
    }

    .tabby-setting-row.-stacked {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
    }

    .tabby-select.-inline {
        width: auto;
        flex-shrink: 0;
    }

    .tabby-session-list {
        margin-top: 8px;
    }

    .tabby-session-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        padding: 10px 0;
        border-top: 1px solid rgba(109, 133, 160, 0.14);
    }

    .tabby-session-card:first-child {
        border-top: none;
        padding-top: 0;
    }

    .tabby-session-info {
        flex: 1;
        min-width: 0;
    }

    .tabby-session-date {
        font-size: 13px;
        font-weight: 700;
        color: var(--tabby-ink);
        margin-bottom: 2px;
    }

    .tabby-session-count {
        font-size: 12px;
        color: var(--tabby-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .tabby-session-empty {
        color: var(--tabby-muted);
        font-size: 13px;
        padding: 4px 0;
    }

    .tabby-bookmark-report {
        margin-top: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: 400px;
        overflow-y: auto;
        padding-right: 4px;
    }

    .tabby-report-card {
        background: rgba(15, 23, 42, 0.4);
        border: 1px solid var(--tabby-border);
        border-radius: 12px;
        padding: 12px 14px;
    }

    .tabby-report-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .tabby-report-title-group {
        flex: 1;
        min-width: 0;
    }

    .tabby-report-title {
        display: block;
        font-size: 13px;
        font-weight: 700;
        color: #f8fafc;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .tabby-report-url {
        display: block;
        font-size: 11px;
        color: #38bdf8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-decoration: none;
    }

    .tabby-report-url:hover {
        text-decoration: underline;
    }

    .tabby-report-pill {
        font-size: 11px;
        font-weight: 700;
        color: #e2e8f0;
        background: rgba(255, 255, 255, 0.12);
        padding: 3px 8px;
        border-radius: 999px;
        flex-shrink: 0;
    }

    .tabby-report-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .tabby-report-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 10px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: background 150ms ease, opacity 150ms ease;
    }

    .tabby-report-item.-to-remove {
        background: rgba(248, 113, 113, 0.08);
        border-color: rgba(248, 113, 113, 0.25);
    }

    .tabby-report-item.-deleted {
        opacity: 0.55;
        text-decoration: line-through;
    }

    .tabby-report-badge {
        font-size: 10px;
        font-weight: 800;
        padding: 3px 8px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        transition: transform 100ms ease, opacity 100ms ease;
    }

    .tabby-report-badge:hover:not(:disabled) {
        transform: scale(1.05);
    }

    .tabby-report-badge.-keep {
        background: rgba(52, 211, 153, 0.2);
        color: #34d399;
        border: 1px solid rgba(52, 211, 153, 0.4);
    }

    .tabby-report-badge.-remove {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
        border: 1px solid rgba(248, 113, 113, 0.4);
    }

    .tabby-report-badge.-deleted {
        background: rgba(148, 163, 184, 0.15);
        color: #cbd5e1;
        border: 1px solid rgba(148, 163, 184, 0.3);
        cursor: default;
    }

    .tabby-report-item-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .tabby-report-folder {
        font-size: 13px;
        font-weight: 700;
        color: #f8fafc;
    }

    .tabby-report-item-title {
        font-size: 12px;
        color: #cbd5e1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* Studio Modal Styles */
    .tabby-studio-scrim {
        position: fixed;
        inset: 0;
        z-index: 10000;
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(14px);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 200ms ease;
        padding: 20px;
    }

    .tabby-studio-scrim.-open {
        opacity: 1;
        pointer-events: auto;
    }

    .tabby-studio-modal {
        width: 100%;
        max-width: 1240px;
        height: 88vh;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 20px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    .tabby-studio-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(30, 41, 59, 0.7);
    }

    .tabby-studio-title-group h2 {
        margin: 0 0 4px 0;
        font-size: 1.4rem;
        font-weight: 800;
        color: #38bdf8;
    }

    .tabby-studio-title-group p {
        margin: 0;
        font-size: 0.85rem;
        color: #cbd5e1;
    }

    .tabby-studio-close-btn {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #f8fafc;
        padding: 8px 16px;
        border-radius: 8px;
        font-weight: 700;
        font-size: 0.9rem;
        cursor: pointer;
        transition: background 150ms ease;
    }

    .tabby-studio-close-btn:hover {
        background: rgba(255, 255, 255, 0.25);
    }

    .tabby-studio-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 16px 24px;
        background: rgba(15, 23, 42, 0.8);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        align-items: center;
    }

    .tabby-studio-search {
        flex: 1;
        min-width: 240px;
        background: rgba(30, 41, 59, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        padding: 8px 14px;
        color: #f8fafc;
        font-size: 0.9rem;
    }

    .tabby-studio-select {
        background: rgba(30, 41, 59, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        padding: 8px 12px;
        color: #f8fafc;
        font-size: 0.85rem;
        cursor: pointer;
    }

    .tabby-studio-actionbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        padding: 12px 24px;
        background: rgba(30, 41, 59, 0.5);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .tabby-studio-action-left {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .tabby-studio-action-right {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .tabby-studio-stats {
        font-size: 0.85rem;
        color: #cbd5e1;
        font-weight: 600;
    }

    .tabby-studio-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .tabby-studio-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 24px;
        background: rgba(15, 23, 42, 0.8);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .tabby-studio-card {
        background: rgba(30, 41, 59, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        padding: 16px;
        transition: border-color 150ms ease;
    }

    .tabby-studio-card:hover {
        border-color: rgba(56, 189, 248, 0.4);
    }

    .tabby-studio-card-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }

    .tabby-studio-checkbox {
        width: 18px;
        height: 18px;
        cursor: pointer;
        accent-color: #38bdf8;
    }

    .tabby-studio-card-info {
        flex: 1;
        min-width: 0;
    }

    .tabby-studio-card-title {
        font-size: 1rem;
        font-weight: 700;
        color: #f8fafc;
        margin-bottom: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .tabby-studio-card-url {
        font-size: 0.8rem;
        color: #38bdf8;
        text-decoration: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: block;
    }

    .tabby-studio-card-url:hover {
        text-decoration: underline;
    }

    .tabby-studio-card-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }

    .tabby-studio-tag {
        font-size: 0.75rem;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.1);
        color: var(--tabby-muted);
    }

    .tabby-studio-tag.-warning {
        background: rgba(248, 113, 113, 0.15);
        color: #f87171;
    }

    /* Title Only Detail Mode */
    .tabby-card.-title-only {
        min-height: auto;
        padding: 12px 14px;
        border-left: 4px solid var(--tabby-accent);
    }

    .tabby-title-only-header {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 8px;
        width: 100%;
        min-width: 0;
    }

    .tabby-title-only-favicon {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        border-radius: 4px;
    }

    .tabby-title-only-title {
        font-weight: 700;
        font-size: 14px;
        color: var(--tabby-ink);
        line-height: 1.35;
        word-break: break-word;
        flex: 1;
        min-width: 0;
    }

    .tabby-title-only-domain {
        font-size: 11px;
        font-weight: 600;
        color: var(--tabby-muted);
        background: rgba(19, 91, 161, 0.08);
        padding: 2px 8px;
        border-radius: 999px;
        white-space: nowrap;
    }

    /* Tab & Title Intelligence Suite Modal */
    .tabby-intelligence-scrim {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.75);
        backdrop-filter: blur(8px);
        z-index: 2000;
        opacity: 0;
        pointer-events: none;
        transition: opacity 200ms ease;
    }

    .tabby-intelligence-scrim.-open {
        opacity: 1;
        pointer-events: auto;
    }

    .tabby-intelligence-modal {
        position: fixed;
        top: 4vh;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        width: 94vw;
        max-width: 1240px;
        height: 92vh;
        background: #0f172a;
        color: #f8fafc;
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
        z-index: 2001;
        display: flex;
        flex-direction: column;
        opacity: 0;
        pointer-events: none;
        transition: opacity 200ms ease, transform 200ms ease;
        overflow: hidden;
    }

    .tabby-intelligence-modal.-open {
        opacity: 1;
        pointer-events: auto;
        transform: translateX(-50%) translateY(0);
    }

    .tabby-intel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 28px;
        background: rgba(30, 41, 59, 0.7);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .tabby-intel-title-group h2 {
        font-size: 1.5rem;
        font-weight: 800;
        background: linear-gradient(to right, #38bdf8, #818cf8);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin: 0 0 4px 0;
    }

    .tabby-intel-title-group p {
        color: #94a3b8;
        font-size: 0.88rem;
        margin: 0;
    }

    .tabby-intel-nav {
        display: flex;
        gap: 10px;
        padding: 12px 28px;
        background: rgba(15, 23, 42, 0.95);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .tabby-intel-nav-btn {
        background: transparent;
        border: 1px solid transparent;
        color: #94a3b8;
        padding: 8px 18px;
        border-radius: 10px;
        font-weight: 700;
        font-size: 0.88rem;
        cursor: pointer;
        transition: all 150ms ease;
    }

    .tabby-intel-nav-btn:hover {
        color: #f8fafc;
        background: rgba(255, 255, 255, 0.06);
    }

    .tabby-intel-nav-btn.-active {
        color: #38bdf8;
        background: rgba(56, 189, 248, 0.15);
        border-color: rgba(56, 189, 248, 0.35);
    }

    .tabby-intel-body {
        flex: 1;
        overflow-y: auto;
        padding: 24px 28px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .tabby-intel-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        background: rgba(30, 41, 59, 0.4);
        padding: 14px 18px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .tabby-intel-search {
        flex: 1;
        min-width: 240px;
        background: #090d16;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #f8fafc;
        padding: 8px 14px;
        border-radius: 10px;
        font-size: 0.9rem;
    }

    .tabby-intel-select {
        background: #090d16;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #f8fafc;
        padding: 8px 14px;
        border-radius: 10px;
        font-size: 0.88rem;
    }

    .tabby-intel-table-container {
        overflow-x: auto;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(15, 23, 42, 0.6);
    }

    .tabby-intel-table {
        width: 100%;
        border-collapse: collapse;
        color: #e2e8f0;
        font-size: 0.88rem;
        text-align: left;
    }

    .tabby-intel-table th {
        padding: 12px 16px;
        background: rgba(30, 41, 59, 0.9);
        color: #38bdf8;
        font-weight: 700;
        border-bottom: 2px solid rgba(255, 255, 255, 0.1);
        white-space: nowrap;
    }

    .tabby-intel-table td {
        padding: 12px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        vertical-align: middle;
    }

    .tabby-intel-table tr:hover td {
        background: rgba(255, 255, 255, 0.03);
    }

    .tabby-intel-pill {
        display: inline-block;
        font-size: 0.75rem;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.1);
        color: #94a3b8;
    }

    .tabby-intel-pill.-active {
        background: rgba(52, 211, 153, 0.15);
        color: #34d399;
    }

    .tabby-intel-pill.-warning {
        background: rgba(251, 191, 36, 0.15);
        color: #fbbf24;
    }

    .tabby-intel-cloud {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding: 18px;
        background: rgba(30, 41, 59, 0.4);
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .tabby-intel-bubble {
        background: rgba(56, 189, 248, 0.12);
        border: 1px solid rgba(56, 189, 248, 0.25);
        color: #38bdf8;
        padding: 6px 14px;
        border-radius: 999px;
        font-weight: 600;
        cursor: pointer;
        transition: all 150ms ease;
    }

    .tabby-intel-bubble:hover {
        background: #38bdf8;
        color: #0f172a;
        transform: translateY(-2px);
    }

    .tabby-intel-card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 16px;
    }

    .tabby-intel-section-card {
        background: rgba(30, 41, 59, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        padding: 18px;
    }

    .tabby-intel-section-card h3 {
        color: #38bdf8;
        font-size: 1.1rem;
        margin-bottom: 12px;
    }

    .tabby-intel-textarea {
        width: 100%;
        min-height: 380px;
        background: #090d16;
        color: #7dd3fc;
        font-family: "Fira Code", monospace;
        font-size: 0.88rem;
        padding: 16px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        resize: vertical;
        box-sizing: border-box;
    }
`;
document.head.appendChild(style);

const shell = document.createElement("main");
shell.className = "tabby-shell";

const topPanel = document.createElement("section");
topPanel.className = "tabby-top-panel";

const topPanelInner = document.createElement("div");
topPanelInner.className = "tabby-top-panel-inner";

const hero = document.createElement("section");
hero.className = "tabby-hero";
hero.title = "Tabby keeps capture, filter, sort, recapture, and settings controls here so they stay easy to reach.";

const heroCopy = document.createElement("div");
heroCopy.className = "tabby-hero-copy";

const eyebrow = document.createElement("div");
eyebrow.textContent = "TABBY NEW TAB";
eyebrow.className = "tabby-eyebrow";
eyebrow.title = "This dashboard represents the other tabs in the current window.";

const heading = document.createElement("h1");
heading.textContent = "Control the rest of this window.";
heading.className = "tabby-heading";
heading.title = "Use the dashboard to switch tabs, manage them directly, and keep previews current.";

const subheading = document.createElement("p");
subheading.textContent = "Close tabs, pin them, reload pages, switch between compact and detailed cards, filter the window, or drag cards to reorder real browser tabs without leaving the dashboard.";
subheading.className = "tabby-subheading";
subheading.title = "Most actions happen directly from the dashboard cards; settings and preview capture tools live on the right.";

const heroActions = document.createElement("div");
heroActions.className = "tabby-hero-actions";

const detailModeSelector = document.createElement("div");
detailModeSelector.className = "tabby-detail-seg";
detailModeSelector.title = "Card detail level: No details = screenshot only (controls collapse), Minimal = adds action buttons, Full = adds URL, title, and badges.";

const detailModeButtons = {};
for (let [value, label, btnTitle] of [
    ["none", "No details", "Screenshot only \u2014 top controls also collapse to a single icon"],
    ["minimal", "Minimal", "Screenshot plus Open, Pin, Reload, Recapture, and Close action buttons"],
    ["full", "Full", "Action buttons plus URL, title, status pill, and information badges"],
    ["title", "Title Only", "Title-focused ultra-compact card layout without screenshot preview"]
]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tabby-detail-seg-btn";
    btn.textContent = label;
    btn.title = btnTitle;
    btn.dataset.mode = value;
    detailModeSelector.appendChild(btn);
    detailModeButtons[value] = btn;
}

const recaptureButton = document.createElement("button");
recaptureButton.type = "button";
recaptureButton.className = "tabby-button";
recaptureButton.textContent = "Recapture previews";
recaptureButton.title = "Choose whether to recapture all visible previews now or enter selection mode to pick specific previews.";

const recaptureMenu = document.createElement("div");
recaptureMenu.className = "tabby-mini-panel";

const recaptureAllButton = document.createElement("button");
recaptureAllButton.type = "button";
recaptureAllButton.className = "tabby-button -secondary";
recaptureAllButton.textContent = "Capture all visible";
recaptureAllButton.title = "Force a fresh screenshot for every currently visible, non-discarded card.";

const recaptureSelectedModeButton = document.createElement("button");
recaptureSelectedModeButton.type = "button";
recaptureSelectedModeButton.className = "tabby-button -secondary";
recaptureSelectedModeButton.textContent = "Choose previews";
recaptureSelectedModeButton.title = "Enter selection mode, click the previews you want, then confirm the recapture.";

recaptureMenu.appendChild(recaptureAllButton);
recaptureMenu.appendChild(recaptureSelectedModeButton);

const resetFiltersButton = document.createElement("button");
resetFiltersButton.type = "button";
resetFiltersButton.className = "tabby-button -secondary";
resetFiltersButton.textContent = "Reset filters";
resetFiltersButton.title = "Clear search, filters, and sort mode and return to the default browser-order view.";

const settingsButton = document.createElement("button");
settingsButton.type = "button";
settingsButton.className = "tabby-button -secondary -icon";
settingsButton.textContent = "⚙";
settingsButton.setAttribute("aria-label", "Open dashboard settings");
settingsButton.title = "Open dashboard settings, quick guidance, and persistent display options.";

heroCopy.appendChild(eyebrow);
heroCopy.appendChild(heading);
heroCopy.appendChild(subheading);
hero.appendChild(heroCopy);

const bookmarkFolderSelect = document.createElement("select");
bookmarkFolderSelect.className = "tabby-select -inline";
bookmarkFolderSelect.title = "Choose which bookmark folder to draw random tabs from.";
const bookmarkFolderDefaultOption = document.createElement("option");
bookmarkFolderDefaultOption.value = "";
bookmarkFolderDefaultOption.textContent = "Bookmark folder\u2026";
bookmarkFolderDefaultOption.disabled = true;
bookmarkFolderDefaultOption.selected = true;
bookmarkFolderSelect.appendChild(bookmarkFolderDefaultOption);

const openRandomButton = document.createElement("button");
openRandomButton.type = "button";
openRandomButton.className = "tabby-button -disabled";
openRandomButton.textContent = "Open 10 random";
openRandomButton.title = "Open 10 bookmarks chosen at random from the selected folder.";
openRandomButton.disabled = true;

const heroCollapsibleActions = document.createElement("div");
heroCollapsibleActions.className = "tabby-hero-collapsible-actions";

const openIntelHeaderBtn = document.createElement("button");
openIntelHeaderBtn.type = "button";
openIntelHeaderBtn.className = "tabby-button -secondary";
openIntelHeaderBtn.textContent = "\ud83d\udce1 Tab Intelligence";
openIntelHeaderBtn.title = "Open the Tab & Title Intelligence Suite for datatable view, co-occurrence analytics, bookmark audit, and prompt synthesis.";
openIntelHeaderBtn.addEventListener("click", () => openIntelligenceModal("table"));

heroCollapsibleActions.appendChild(detailModeSelector);
heroCollapsibleActions.appendChild(openIntelHeaderBtn);
heroCollapsibleActions.appendChild(recaptureButton);
heroCollapsibleActions.appendChild(resetFiltersButton);
heroCollapsibleActions.appendChild(bookmarkFolderSelect);
heroCollapsibleActions.appendChild(openRandomButton);

const expandControlsButton = document.createElement("button");
expandControlsButton.type = "button";
expandControlsButton.className = "tabby-button -secondary -icon tabby-expand-btn";
expandControlsButton.textContent = "\u2261";
expandControlsButton.setAttribute("aria-label", "Show dashboard controls");
expandControlsButton.title = "Expand controls. Detail mode is set to No details.";

heroActions.appendChild(heroCollapsibleActions);
heroActions.appendChild(recaptureMenu);
heroActions.appendChild(expandControlsButton);
heroActions.appendChild(settingsButton);
hero.appendChild(heroActions);

const controls = document.createElement("section");
controls.className = "tabby-toolbar";
controls.title = "Search, filter, and sort the current window without changing the underlying tab set.";

const searchInput = document.createElement("input");
searchInput.className = "tabby-search";
searchInput.type = "search";
searchInput.placeholder = "Filter by title, URL, or domain";
searchInput.title = "Search across tab titles, full URLs, and domain names in the current window.";

const statusFilter = document.createElement("select");
statusFilter.className = "tabby-select";
statusFilter.title = "Filter the current window by bookmark state, pin state, discarded tabs, or audible tabs.";

const domainFilter = document.createElement("select");
domainFilter.className = "tabby-select";
domainFilter.title = "Filter the current window down to a single hostname while keeping sort and actions available.";

const sortSelect = document.createElement("select");
sortSelect.className = "tabby-select";
sortSelect.title = "Change how cards are ordered. Drag-and-drop only works in Browser order.";

for (let [value, label] of Object.entries(STATUS_FILTERS)) {
    let option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    statusFilter.appendChild(option);
}

for (let [value, label] of Object.entries(SORT_MODES)) {
    let option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    sortSelect.appendChild(option);
}

controls.appendChild(searchInput);
controls.appendChild(statusFilter);
controls.appendChild(domainFilter);
controls.appendChild(sortSelect);

const selectionBar = document.createElement("section");
selectionBar.className = "tabby-selection-bar";

const selectionCopy = document.createElement("p");
selectionCopy.className = "tabby-selection-copy";
selectionCopy.title = "Selection mode repurposes card clicks so you can choose exactly which previews to recapture.";

const selectionActions = document.createElement("div");
selectionActions.className = "tabby-selection-actions";

const selectionConfirmButton = document.createElement("button");
selectionConfirmButton.type = "button";
selectionConfirmButton.className = "tabby-button";
selectionConfirmButton.textContent = "Recapture selected";
selectionConfirmButton.title = "Capture only the previews currently selected in selection mode.";

const selectionCancelButton = document.createElement("button");
selectionCancelButton.type = "button";
selectionCancelButton.className = "tabby-button -secondary";
selectionCancelButton.textContent = "Cancel selection";
selectionCancelButton.title = "Exit selection mode and return card clicks to normal tab activation.";

selectionActions.appendChild(selectionConfirmButton);
selectionActions.appendChild(selectionCancelButton);
selectionBar.appendChild(selectionCopy);
selectionBar.appendChild(selectionActions);

const metaBar = document.createElement("section");
metaBar.className = "tabby-meta-bar";

const status = document.createElement("p");
status.textContent = "Loading tabs...";
status.className = "tabby-status";
status.title = "The status line summarizes how many cards are visible and what the dashboard is doing now.";

const hint = document.createElement("p");
hint.className = "tabby-hint";
hint.title = "Hints change based on the current mode, including drag-and-drop limits and selection mode.";

const list = document.createElement("div");
list.className = "tabby-grid";

const settingsScrim = document.createElement("div");
settingsScrim.className = "tabby-settings-scrim";

const settingsPanel = document.createElement("aside");
settingsPanel.className = "tabby-settings-panel";
settingsPanel.setAttribute("aria-hidden", "true");

const settingsHeader = document.createElement("div");
settingsHeader.className = "tabby-settings-header";

const settingsTitle = document.createElement("h2");
settingsTitle.className = "tabby-settings-title";
settingsTitle.textContent = "Dashboard settings";

const settingsCloseButton = document.createElement("button");
settingsCloseButton.type = "button";
settingsCloseButton.className = "tabby-settings-close";
settingsCloseButton.textContent = "Close";
settingsCloseButton.title = "Close the settings panel.";

settingsHeader.appendChild(settingsTitle);
settingsHeader.appendChild(settingsCloseButton);

const settingsTogglesSection = document.createElement("section");
settingsTogglesSection.className = "tabby-settings-section";

const settingsTogglesHeading = document.createElement("h3");
settingsTogglesHeading.textContent = "Display";

settingsTogglesSection.appendChild(settingsTogglesHeading);

function createSettingsToggleRow(labelText, helpText, titleText) {
    const row = document.createElement("div");
    row.className = "tabby-setting-row";
    row.title = titleText;

    const copy = document.createElement("div");
    copy.className = "tabby-setting-copy";

    const label = document.createElement("strong");
    label.textContent = labelText;

    const help = document.createElement("span");
    help.textContent = helpText;

    copy.appendChild(label);
    copy.appendChild(help);

    const toggle = document.createElement("label");
    toggle.className = "tabby-switch";

    const input = document.createElement("input");
    input.type = "checkbox";

    const track = document.createElement("span");
    track.className = "tabby-toggle-track";

    toggle.appendChild(input);
    toggle.appendChild(track);
    row.appendChild(copy);
    row.appendChild(toggle);

    return {
        row,
        input
    };
}

const settingsDetailModeRow = document.createElement("div");
settingsDetailModeRow.className = "tabby-setting-row -stacked";
settingsDetailModeRow.title = "Persist the card detail level preference across windows and restarts.";

const settingsDetailCopy = document.createElement("div");
settingsDetailCopy.className = "tabby-setting-copy";
const settingsDetailLabel = document.createElement("strong");
settingsDetailLabel.textContent = "Card detail level";
const settingsDetailHelp = document.createElement("span");
settingsDetailHelp.textContent = "No details: screenshot only, controls collapse to an icon. Minimal: adds action buttons. Full: adds URL, title, and badges.";
settingsDetailCopy.appendChild(settingsDetailLabel);
settingsDetailCopy.appendChild(settingsDetailHelp);

const settingsDetailSeg = document.createElement("div");
settingsDetailSeg.className = "tabby-detail-seg -stretch";

const settingsDetailModeButtons = {};
for (let [value, label, btnTitle] of [
    ["none", "No details", "Screenshot only \u2014 top controls also collapse to a single icon"],
    ["minimal", "Minimal", "Screenshot plus Open, Pin, Reload, Recapture, and Close action buttons"],
    ["full", "Full", "Action buttons plus URL, title, status pill, and information badges"],
    ["title", "Title Only", "Title-focused ultra-compact card layout without screenshot preview"]
]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tabby-detail-seg-btn";
    btn.textContent = label;
    btn.title = btnTitle;
    btn.dataset.mode = value;
    settingsDetailSeg.appendChild(btn);
    settingsDetailModeButtons[value] = btn;
}

settingsDetailModeRow.appendChild(settingsDetailCopy);
settingsDetailModeRow.appendChild(settingsDetailSeg);

const settingsStickyRow = createSettingsToggleRow(
    "Keep top controls sticky",
    "Pin the dashboard controls to the top of the page so search, recapture, and settings stay visible while scrolling.",
    "Toggle the sticky behavior for the top dashboard controls."
);
const settingsPinnedRow = createSettingsToggleRow(
    "Keep Tabby pinned",
    "Keep one pinned Tabby dashboard tab easy to find at the front of the current window.",
    "Toggle whether Tabby should keep the dashboard pinned in the current window."
);

settingsTogglesSection.appendChild(settingsDetailModeRow);
settingsTogglesSection.appendChild(settingsStickyRow.row);
settingsTogglesSection.appendChild(settingsPinnedRow.row);

const settingsGuideSection = document.createElement("section");
settingsGuideSection.className = "tabby-settings-section";

const settingsGuideHeading = document.createElement("h3");
settingsGuideHeading.textContent = "Getting started";

const settingsGuideCopy = document.createElement("p");
settingsGuideCopy.className = "tabby-settings-copy";
settingsGuideCopy.textContent = "Tabby shows the other tabs in the current window as cached screenshots. Use it as a visual control surface instead of a passive new-tab page.";

const settingsGuideList = document.createElement("ol");
settingsGuideList.className = "tabby-settings-list";
for (let line of [
    "Click a card to activate that tab. Turn on preview details if you also want pin, reload, recapture, and close buttons on every card.",
    "Use search, filters, and sort to narrow the window. Drag-and-drop only works in Browser order.",
    "Use Recapture previews to refresh every visible screenshot at once or enter selection mode and choose a few cards.",
    "Keep Tabby pinned if you want a single dashboard tab to remain easy to find even in a large tab strip."
]) {
    let item = document.createElement("li");
    item.textContent = line;
    settingsGuideList.appendChild(item);
}

settingsGuideSection.appendChild(settingsGuideHeading);
settingsGuideSection.appendChild(settingsGuideCopy);
settingsGuideSection.appendChild(settingsGuideList);

// Session history section
const settingsSessionSection = document.createElement("section");
settingsSessionSection.className = "tabby-settings-section";

const settingsSessionHeading = document.createElement("h3");
settingsSessionHeading.textContent = "Session history";

const settingsSessionDesc = document.createElement("p");
settingsSessionDesc.className = "tabby-settings-copy";
settingsSessionDesc.textContent = "Tabby saves a snapshot of each window you close, one entry per day, up to 3 recent days. Use Restore to reopen a saved session in a new window.";

const settingsAutosaveRow = createSettingsToggleRow(
    "Auto-save closed windows",
    "Automatically snapshot your open tabs when a browser window is closed.",
    "Enable or disable automatic session saving."
);

const sessionHistoryList = document.createElement("div");
sessionHistoryList.className = "tabby-session-list";

settingsSessionSection.appendChild(settingsSessionHeading);
settingsSessionSection.appendChild(settingsSessionDesc);
settingsSessionSection.appendChild(settingsAutosaveRow.row);
settingsSessionSection.appendChild(sessionHistoryList);

const settingsBookmarksSection = document.createElement("section");
settingsBookmarksSection.className = "tabby-settings-section";

const settingsBookmarksHeading = document.createElement("h3");
settingsBookmarksHeading.textContent = "Bookmark Maintenance";

const settingsBookmarksDesc = document.createElement("p");
settingsBookmarksDesc.className = "tabby-settings-copy";
settingsBookmarksDesc.textContent = "Analyze and remove exact duplicates or bookmarks that violate core folder rules (Max 2 rule).";

const scanBookmarksBtn = document.createElement("button");
scanBookmarksBtn.className = "tabby-button -secondary";
scanBookmarksBtn.textContent = "Scan Bookmarks";
scanBookmarksBtn.title = "Scan your bookmarks library for duplicate URLs and folder rule violations (Max 2 rule).";
scanBookmarksBtn.style.marginTop = "10px";

const openStudioBtn = document.createElement("button");
openStudioBtn.className = "tabby-button -secondary";
openStudioBtn.textContent = "Open Bookmark Studio";
openStudioBtn.title = "Open the full-screen Bookmark Maintenance Studio modal for bulk sorting, filtering, batch cleaning, and spot-checking.";
openStudioBtn.style.marginTop = "10px";
openStudioBtn.style.marginLeft = "8px";

const bookmarksResultDiv = document.createElement("div");
bookmarksResultDiv.className = "tabby-settings-copy";
bookmarksResultDiv.style.marginTop = "10px";

const cleanBookmarksBtn = document.createElement("button");
cleanBookmarksBtn.className = "tabby-button -primary";
cleanBookmarksBtn.textContent = "Clean Violations";
cleanBookmarksBtn.title = "Automatically remove duplicate bookmarks while preserving at most one Core folder entry and one Date folder entry per URL.";
cleanBookmarksBtn.style.marginTop = "10px";
cleanBookmarksBtn.style.display = "none";

const bookmarkReportDiv = document.createElement("div");
bookmarkReportDiv.className = "tabby-bookmark-report";

const openIntelSettingsBtn = document.createElement("button");
openIntelSettingsBtn.className = "tabby-button -secondary";
openIntelSettingsBtn.textContent = "\ud83d\udce1 Open Tab & Title Intelligence Suite";
openIntelSettingsBtn.title = "Open datatable manager, keyword cloud, co-occurrence analytics, and LLM prompt synthesizer.";
openIntelSettingsBtn.style.marginTop = "10px";
openIntelSettingsBtn.style.marginLeft = "8px";
openIntelSettingsBtn.addEventListener("click", () => openIntelligenceModal("table"));

settingsBookmarksSection.appendChild(settingsBookmarksHeading);
settingsBookmarksSection.appendChild(settingsBookmarksDesc);
settingsBookmarksSection.appendChild(scanBookmarksBtn);
settingsBookmarksSection.appendChild(openStudioBtn);
settingsBookmarksSection.appendChild(openIntelSettingsBtn);
settingsBookmarksSection.appendChild(bookmarksResultDiv);
settingsBookmarksSection.appendChild(cleanBookmarksBtn);
settingsBookmarksSection.appendChild(bookmarkReportDiv);

let currentAnalysis = null;

// --- BOOKMARK MAINTENANCE STUDIO MODAL ---
const studioScrim = document.createElement("div");
studioScrim.className = "tabby-studio-scrim";

const studioModal = document.createElement("div");
studioModal.className = "tabby-studio-modal";

// Header
const studioHeader = document.createElement("div");
studioHeader.className = "tabby-studio-header";

const studioTitleGroup = document.createElement("div");
studioTitleGroup.className = "tabby-studio-title-group";
const studioTitle = document.createElement("h2");
studioTitle.textContent = "Bookmark Maintenance Studio";
const studioSubtitle = document.createElement("p");
studioSubtitle.textContent = "Search, filter, batch-clean, and spot-check duplicate bookmarks across your library.";
studioTitleGroup.appendChild(studioTitle);
studioTitleGroup.appendChild(studioSubtitle);

const studioCloseBtn = document.createElement("button");
studioCloseBtn.type = "button";
studioCloseBtn.className = "tabby-studio-close-btn";
studioCloseBtn.textContent = "Close Studio";
studioCloseBtn.title = "Close the Bookmark Maintenance Studio.";
studioCloseBtn.addEventListener("click", () => closeBookmarkStudio());

studioHeader.appendChild(studioTitleGroup);
studioHeader.appendChild(studioCloseBtn);

// Toolbar
const studioToolbar = document.createElement("div");
studioToolbar.className = "tabby-studio-toolbar";

const studioSearchInput = document.createElement("input");
studioSearchInput.className = "tabby-studio-search";
studioSearchInput.type = "search";
studioSearchInput.placeholder = "Filter by title, URL, or domain...";
studioSearchInput.title = "Filter flagged URLs by title, URL, or domain keyword.";

const studioViolationFilter = document.createElement("select");
studioViolationFilter.className = "tabby-studio-select";
studioViolationFilter.title = "Filter by violation category.";
for (let [val, lbl] of [
    ["all", "All Violations"],
    ["multi_core", "Multi-Core (2+ Core)"],
    ["multi_date", "Multi-Date (2+ Date)"],
    ["max2_exceeded", "Max 2 Exceeded (3+ Total)"],
    ["high_volume", "High Volume (4+ Copies)"]
]) {
    let opt = document.createElement("option");
    opt.value = val;
    opt.textContent = lbl;
    studioViolationFilter.appendChild(opt);
}

const studioFolderSelect = document.createElement("select");
studioFolderSelect.className = "tabby-studio-select";
studioFolderSelect.title = "Filter by folder presence.";
let defaultFolderOpt = document.createElement("option");
defaultFolderOpt.value = "all";
defaultFolderOpt.textContent = "All Folders";
studioFolderSelect.appendChild(defaultFolderOpt);

const studioSortSelect = document.createElement("select");
studioSortSelect.className = "tabby-studio-select";
studioSortSelect.title = "Change how flagged groups are ordered.";
for (let [val, lbl] of [
    ["duplicates_desc", "Most Duplicates First"],
    ["duplicates_asc", "Least Duplicates First"],
    ["domain_asc", "Domain (A \u2013 Z)"],
    ["title_asc", "Title / URL (A \u2013 Z)"],
    ["newest", "Newest Bookmark First"],
    ["oldest", "Oldest Bookmark First"]
]) {
    let opt = document.createElement("option");
    opt.value = val;
    opt.textContent = lbl;
    studioSortSelect.appendChild(opt);
}

const studioPageSizeSelect = document.createElement("select");
studioPageSizeSelect.className = "tabby-studio-select";
studioPageSizeSelect.title = "Number of URLs to show per page.";
for (let [val, lbl] of [
    [10, "10 per page"],
    [25, "25 per page"],
    [50, "50 per page"],
    [100, "100 per page"],
    [9999, "Show All"]
]) {
    let opt = document.createElement("option");
    opt.value = val;
    opt.textContent = lbl;
    studioPageSizeSelect.appendChild(opt);
}
studioPageSizeSelect.value = 25;

studioToolbar.appendChild(studioSearchInput);
studioToolbar.appendChild(studioViolationFilter);
studioToolbar.appendChild(studioFolderSelect);
studioToolbar.appendChild(studioSortSelect);
studioToolbar.appendChild(studioPageSizeSelect);

// Actionbar
const studioActionbar = document.createElement("div");
studioActionbar.className = "tabby-studio-actionbar";

const studioActionLeft = document.createElement("div");
studioActionLeft.className = "tabby-studio-action-left";

const studioSelectAllLabel = document.createElement("label");
studioSelectAllLabel.style.display = "flex";
studioSelectAllLabel.style.alignItems = "center";
studioSelectAllLabel.style.gap = "6px";
studioSelectAllLabel.style.fontSize = "0.85rem";
studioSelectAllLabel.style.cursor = "pointer";

const studioSelectAllCheckbox = document.createElement("input");
studioSelectAllCheckbox.type = "checkbox";
studioSelectAllCheckbox.className = "tabby-studio-checkbox";
studioSelectAllCheckbox.title = "Select all visible URLs on the current page for batch cleaning.";

const studioSelectAllSpan = document.createElement("span");
studioSelectAllSpan.textContent = "Select Visible";

studioSelectAllLabel.appendChild(studioSelectAllCheckbox);
studioSelectAllLabel.appendChild(studioSelectAllSpan);

const studioCleanSelectedBtn = document.createElement("button");
studioCleanSelectedBtn.type = "button";
studioCleanSelectedBtn.className = "tabby-button -primary";
studioCleanSelectedBtn.textContent = "Clean Selected (0)";
studioCleanSelectedBtn.title = "Remove duplicate bookmarks for only the checked URL groups.";
studioCleanSelectedBtn.disabled = true;

const studioCleanAllBtn = document.createElement("button");
studioCleanAllBtn.type = "button";
studioCleanAllBtn.className = "tabby-button -secondary";
studioCleanAllBtn.textContent = "Clean All Violations";
studioCleanAllBtn.title = "Remove duplicate bookmarks across all flagged groups in your library.";

studioActionLeft.appendChild(studioSelectAllLabel);
studioActionLeft.appendChild(studioCleanSelectedBtn);
studioActionLeft.appendChild(studioCleanAllBtn);

const studioActionRight = document.createElement("div");
studioActionRight.className = "tabby-studio-action-right";

const studioStatsEl = document.createElement("span");
studioStatsEl.className = "tabby-studio-stats";
studioStatsEl.textContent = "Loading studio...";

studioActionRight.appendChild(studioStatsEl);

studioActionbar.appendChild(studioActionLeft);
studioActionbar.appendChild(studioActionRight);

// Body
const studioBodyEl = document.createElement("div");
studioBodyEl.className = "tabby-studio-body";

// Footer (Pagination)
const studioFooter = document.createElement("div");
studioFooter.className = "tabby-studio-footer";

const studioPrevPageBtn = document.createElement("button");
studioPrevPageBtn.type = "button";
studioPrevPageBtn.className = "tabby-button -secondary";
studioPrevPageBtn.textContent = "\u2190 Previous";
studioPrevPageBtn.title = "Go to the previous page of flagged bookmarks.";

const studioPageIndicator = document.createElement("span");
studioPageIndicator.className = "tabby-studio-stats";
studioPageIndicator.textContent = "Page 1 of 1";

const studioNextPageBtn = document.createElement("button");
studioNextPageBtn.type = "button";
studioNextPageBtn.className = "tabby-button -secondary";
studioNextPageBtn.textContent = "Next \u2192";
studioNextPageBtn.title = "Go to the next page of flagged bookmarks.";

studioFooter.appendChild(studioPrevPageBtn);
studioFooter.appendChild(studioPageIndicator);
studioFooter.appendChild(studioNextPageBtn);

studioModal.appendChild(studioHeader);
studioModal.appendChild(studioToolbar);
studioModal.appendChild(studioActionbar);
studioModal.appendChild(studioBodyEl);
studioModal.appendChild(studioFooter);
studioScrim.appendChild(studioModal);
document.body.appendChild(studioScrim);

// State
let studioState = {
    isOpen: false,
    searchQuery: "",
    violationFilter: "all",
    folderFilter: "all",
    sortMode: "duplicates_desc",
    pageSize: 25,
    currentPage: 1,
    selectedGroupIds: new Set()
};

function populateFolderFilter(groups) {
    const folders = new Set();
    for (const g of groups) {
        if (g.folders) {
            for (const f of g.folders) folders.add(f);
        }
    }
    const currentVal = studioFolderSelect.value;
    studioFolderSelect.replaceChildren();
    let defaultOpt = document.createElement("option");
    defaultOpt.value = "all";
    defaultOpt.textContent = "All Folders";
    studioFolderSelect.appendChild(defaultOpt);

    for (const folder of Array.from(folders).sort()) {
        let opt = document.createElement("option");
        opt.value = folder;
        opt.textContent = `📁 ${folder}`;
        studioFolderSelect.appendChild(opt);
    }
    studioFolderSelect.value = folders.has(currentVal) ? currentVal : "all";
}

function openBookmarkStudio() {
    studioState.isOpen = true;
    studioScrim.classList.add("-open");
    if (currentAnalysis) {
        populateFolderFilter(currentAnalysis.groups);
        renderStudio();
    } else {
        scanAndAnalyzeDuplicates().then(res => {
            currentAnalysis = res;
            populateFolderFilter(res.groups);
            renderStudio();
        });
    }
}

function closeBookmarkStudio() {
    studioState.isOpen = false;
    studioScrim.classList.remove("-open");
}

function getFilteredSortedGroups() {
    if (!currentAnalysis || !currentAnalysis.groups) return [];
    let list = currentAnalysis.groups.filter(g => {
        // Active violations check
        const activeDeletes = g.bookmarks.filter(b => !b.willKeep && !b.deleted).length;
        if (activeDeletes === 0) return false;

        // Search filter
        if (studioState.searchQuery) {
            const q = studioState.searchQuery.toLowerCase();
            const matchTitle = (g.displayTitle || "").toLowerCase().includes(q);
            const matchUrl = (g.displayUrl || "").toLowerCase().includes(q);
            const matchDomain = (g.domain || "").toLowerCase().includes(q);
            if (!matchTitle && !matchUrl && !matchDomain) return false;
        }

        // Violation filter
        if (studioState.violationFilter === "multi_core" && !g.hasCoreViolation) return false;
        if (studioState.violationFilter === "multi_date" && !g.hasDateViolation) return false;
        if (studioState.violationFilter === "max2_exceeded" && !g.hasMax2Violation) return false;
        if (studioState.violationFilter === "high_volume" && g.totalCopies < 4) return false;

        // Folder filter
        if (studioState.folderFilter !== "all") {
            if (!g.folders || !g.folders.includes(studioState.folderFilter)) return false;
        }

        return true;
    });

    // Sorting
    list.sort((a, b) => {
        if (studioState.sortMode === "duplicates_desc") {
            return b.deleteCount - a.deleteCount || b.totalCopies - a.totalCopies;
        }
        if (studioState.sortMode === "duplicates_asc") {
            return a.deleteCount - b.deleteCount || a.totalCopies - b.totalCopies;
        }
        if (studioState.sortMode === "domain_asc") {
            return (a.domain || "").localeCompare(b.domain || "");
        }
        if (studioState.sortMode === "title_asc") {
            return (a.displayTitle || a.url).localeCompare(b.displayTitle || b.url);
        }
        if (studioState.sortMode === "newest") {
            return (b.maxDateAdded || 0) - (a.maxDateAdded || 0);
        }
        if (studioState.sortMode === "oldest") {
            return (a.minDateAdded || 0) - (b.minDateAdded || 0);
        }
        return 0;
    });

    return list;
}

function renderStudio() {
    if (!studioState.isOpen) return;

    const filtered = getFilteredSortedGroups();
    const totalCount = filtered.length;
    const pageSize = studioState.pageSize;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    if (studioState.currentPage > totalPages) {
        studioState.currentPage = totalPages;
    }

    const startIndex = (studioState.currentPage - 1) * pageSize;
    const pageGroups = filtered.slice(startIndex, startIndex + pageSize);

    // Update Action Bar & Stats
    let totalRemovals = 0;
    for (const g of filtered) {
        totalRemovals += g.bookmarks.filter(b => !b.willKeep && !b.deleted).length;
    }

    studioStatsEl.textContent = `Showing ${pageGroups.length} of ${totalCount} URL groups \u2022 ${totalRemovals} duplicate bookmark${totalRemovals === 1 ? "" : "s"} to clean`;
    studioCleanSelectedBtn.textContent = `Clean Selected (${studioState.selectedGroupIds.size})`;
    studioCleanSelectedBtn.disabled = studioState.selectedGroupIds.size === 0;

    // Pagination Controls
    studioPageIndicator.textContent = `Page ${studioState.currentPage} of ${totalPages}`;
    studioPrevPageBtn.disabled = studioState.currentPage <= 1;
    studioNextPageBtn.disabled = studioState.currentPage >= totalPages;

    // Check visible select all state
    const allVisibleSelected = pageGroups.length > 0 && pageGroups.every(g => studioState.selectedGroupIds.has(g.id));
    studioSelectAllCheckbox.checked = allVisibleSelected;

    studioBodyEl.replaceChildren();

    if (pageGroups.length === 0) {
        const empty = document.createElement("div");
        empty.className = "tabby-session-empty";
        empty.style.textAlign = "center";
        empty.style.padding = "40px 20px";
        empty.textContent = totalCount === 0 ? "No bookmark violations found matching your search and filter criteria!" : "No URLs on this page.";
        studioBodyEl.appendChild(empty);
        return;
    }

    for (const group of pageGroups) {
        const card = document.createElement("div");
        card.className = "tabby-studio-card";

        const cardHeader = document.createElement("div");
        cardHeader.className = "tabby-studio-card-header";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "tabby-studio-checkbox";
        checkbox.checked = studioState.selectedGroupIds.has(group.id);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                studioState.selectedGroupIds.add(group.id);
            } else {
                studioState.selectedGroupIds.delete(group.id);
            }
            renderStudio();
        });

        const cardInfo = document.createElement("div");
        cardInfo.className = "tabby-studio-card-info";

        const cardTitle = document.createElement("div");
        cardTitle.className = "tabby-studio-card-title";
        cardTitle.textContent = group.displayTitle || group.url;
        cardTitle.title = group.displayTitle || group.url;

        const cardUrl = document.createElement("a");
        cardUrl.className = "tabby-studio-card-url";
        cardUrl.href = group.displayUrl || group.url;
        cardUrl.target = "_blank";
        cardUrl.rel = "noopener noreferrer";
        cardUrl.textContent = group.displayUrl || group.url;

        cardInfo.appendChild(cardTitle);
        cardInfo.appendChild(cardUrl);

        const cardTags = document.createElement("div");
        cardTags.className = "tabby-studio-card-tags";

        const copiesTag = document.createElement("span");
        copiesTag.className = "tabby-studio-tag";
        copiesTag.textContent = `${group.bookmarks.length} copies`;

        cardTags.appendChild(copiesTag);

        if (group.hasCoreViolation) {
            const tag = document.createElement("span");
            tag.className = "tabby-studio-tag -warning";
            tag.textContent = "Multi-Core";
            cardTags.appendChild(tag);
        }
        if (group.hasDateViolation) {
            const tag = document.createElement("span");
            tag.className = "tabby-studio-tag -warning";
            tag.textContent = "Multi-Date";
            cardTags.appendChild(tag);
        }
        if (group.hasMax2Violation) {
            const tag = document.createElement("span");
            tag.className = "tabby-studio-tag -warning";
            tag.textContent = "Max 2 Exceeded";
            cardTags.appendChild(tag);
        }

        cardHeader.appendChild(checkbox);
        cardHeader.appendChild(cardInfo);
        cardHeader.appendChild(cardTags);
        card.appendChild(cardHeader);

        const list = document.createElement("div");
        list.className = "tabby-report-list";

        for (const item of group.bookmarks) {
            const row = document.createElement("div");
            row.className = "tabby-report-item";
            if (item.deleted) {
                row.classList.add("-deleted");
            } else if (!item.willKeep) {
                row.classList.add("-to-remove");
            }

            const badgeBtn = document.createElement("button");
            badgeBtn.type = "button";
            badgeBtn.className = "tabby-report-badge";

            function updateBadge() {
                if (item.deleted) {
                    badgeBtn.textContent = "REMOVED";
                    badgeBtn.className = "tabby-report-badge -deleted";
                    badgeBtn.disabled = true;
                    badgeBtn.title = "This duplicate bookmark has been removed.";
                } else if (item.willKeep) {
                    badgeBtn.textContent = "KEEP";
                    badgeBtn.className = "tabby-report-badge -keep";
                    badgeBtn.title = "Click to mark this bookmark for removal instead.";
                } else {
                    badgeBtn.textContent = "REMOVE";
                    badgeBtn.className = "tabby-report-badge -remove";
                    badgeBtn.title = "Click to keep this bookmark instead.";
                }
            }
            updateBadge();

            badgeBtn.addEventListener("click", () => {
                if (item.deleted) return;
                item.willKeep = !item.willKeep;
                updateBadge();
                row.classList.toggle("-deleted", false);
                row.classList.toggle("-to-remove", !item.willKeep);
                renderStudio();
            });

            const infoDiv = document.createElement("div");
            infoDiv.className = "tabby-report-item-info";

            const folderSpan = document.createElement("span");
            folderSpan.className = "tabby-report-folder";
            const catLabel = item.category === "core" ? " (Core)" : item.category === "date" ? " (Date)" : "";
            folderSpan.textContent = `📁 ${item.parentTitle || "Root"}${catLabel}`;

            const itemTitleSpan = document.createElement("span");
            itemTitleSpan.className = "tabby-report-item-title";
            itemTitleSpan.textContent = item.title && item.title !== item.url ? item.title : "";

            infoDiv.appendChild(folderSpan);
            if (itemTitleSpan.textContent) {
                infoDiv.appendChild(itemTitleSpan);
            }

            row.appendChild(badgeBtn);
            row.appendChild(infoDiv);
            list.appendChild(row);
        }

        card.appendChild(list);
        studioBodyEl.appendChild(card);
    }
}

// Studio Event Listeners
studioSearchInput.addEventListener("input", e => {
    studioState.searchQuery = e.target.value;
    studioState.currentPage = 1;
    renderStudio();
});

studioViolationFilter.addEventListener("change", e => {
    studioState.violationFilter = e.target.value;
    studioState.currentPage = 1;
    renderStudio();
});

studioFolderSelect.addEventListener("change", e => {
    studioState.folderFilter = e.target.value;
    studioState.currentPage = 1;
    renderStudio();
});

studioSortSelect.addEventListener("change", e => {
    studioState.sortMode = e.target.value;
    renderStudio();
});

studioPageSizeSelect.addEventListener("change", e => {
    studioState.pageSize = parseInt(e.target.value, 10);
    studioState.currentPage = 1;
    renderStudio();
});

studioSelectAllCheckbox.addEventListener("change", e => {
    const pageGroups = getFilteredSortedGroups().slice((studioState.currentPage - 1) * studioState.pageSize, studioState.currentPage * studioState.pageSize);
    if (e.target.checked) {
        for (const g of pageGroups) studioState.selectedGroupIds.add(g.id);
    } else {
        for (const g of pageGroups) studioState.selectedGroupIds.delete(g.id);
    }
    renderStudio();
});

studioPrevPageBtn.addEventListener("click", () => {
    if (studioState.currentPage > 1) {
        studioState.currentPage--;
        renderStudio();
    }
});

studioNextPageBtn.addEventListener("click", () => {
    studioState.currentPage++;
    renderStudio();
});

studioCleanSelectedBtn.addEventListener("click", async () => {
    if (studioState.selectedGroupIds.size === 0 || !currentAnalysis) return;
    studioCleanSelectedBtn.textContent = "Cleaning...";
    studioCleanSelectedBtn.disabled = true;

    const selectedGroups = currentAnalysis.groups.filter(g => studioState.selectedGroupIds.has(g.id));
    try {
        const deleted = await smartCleanBookmarks(selectedGroups);
        studioState.selectedGroupIds.clear();
        bookmarksResultDiv.textContent = `Successfully removed ${deleted} invalid bookmarks from selected groups.`;
        currentAnalysis = await scanAndAnalyzeDuplicates();
        populateFolderFilter(currentAnalysis.groups);
        renderStudio();
        renderBookmarkReport(currentAnalysis.groups);
    } catch (e) {
        bookmarksResultDiv.textContent = `Clean failed: ${e}`;
    }
});

studioCleanAllBtn.addEventListener("click", async () => {
    if (!currentAnalysis) return;
    studioCleanAllBtn.textContent = "Cleaning All...";
    studioCleanAllBtn.disabled = true;
    try {
        const deleted = await smartCleanBookmarks(currentAnalysis.groups);
        studioState.selectedGroupIds.clear();
        bookmarksResultDiv.textContent = `Successfully removed ${deleted} invalid bookmarks.`;
        currentAnalysis = await scanAndAnalyzeDuplicates();
        populateFolderFilter(currentAnalysis.groups);
        renderStudio();
        renderBookmarkReport(currentAnalysis.groups);
    } catch (e) {
        bookmarksResultDiv.textContent = `Clean failed: ${e}`;
    }
    studioCleanAllBtn.textContent = "Clean All Violations";
    studioCleanAllBtn.disabled = false;
});

function renderBookmarkReport(groups) {
    bookmarkReportDiv.replaceChildren();
    if (!groups || groups.length === 0) return;

    for (const group of groups.slice(0, 5)) {
        const card = document.createElement("div");
        card.className = "tabby-report-card";

        const header = document.createElement("div");
        header.className = "tabby-report-header";

        const titleGroup = document.createElement("div");
        titleGroup.className = "tabby-report-title-group";

        const titleEl = document.createElement("strong");
        titleEl.className = "tabby-report-title";
        titleEl.textContent = group.displayTitle || group.url;

        const urlEl = document.createElement("a");
        urlEl.className = "tabby-report-url";
        urlEl.href = group.displayUrl || group.url;
        urlEl.target = "_blank";
        urlEl.rel = "noopener noreferrer";
        urlEl.textContent = group.displayUrl || group.url;

        titleGroup.appendChild(titleEl);
        titleGroup.appendChild(urlEl);

        header.appendChild(titleGroup);
        card.appendChild(header);

        bookmarkReportDiv.appendChild(card);
    }
}

function recountTotalViolations() {
    if (!currentAnalysis) return;
    let total = 0;
    for (const group of currentAnalysis.groups) {
        total += group.bookmarks.filter(b => !b.willKeep && !b.deleted).length;
    }
    currentAnalysis.totalViolations = total;
    if (total > 0) {
        bookmarksResultDiv.textContent = `Found ${total} violation${total === 1 ? "" : "s"} across ${currentAnalysis.groups.length} unique URL${currentAnalysis.groups.length === 1 ? "" : "s"}.`;
        cleanBookmarksBtn.style.display = "block";
    } else {
        bookmarksResultDiv.textContent = `All selected bookmarks marked to KEEP. No violations to clean!`;
        cleanBookmarksBtn.style.display = "none";
    }
}

scanBookmarksBtn.addEventListener("click", async () => {
    bookmarksResultDiv.textContent = "Scanning...";
    cleanBookmarksBtn.style.display = "none";
    bookmarkReportDiv.replaceChildren();
    try {
        currentAnalysis = await scanAndAnalyzeDuplicates();
        if (currentAnalysis.totalViolations > 0) {
            bookmarksResultDiv.textContent = `Found ${currentAnalysis.totalViolations} violations across ${currentAnalysis.groups.length} unique URLs.`;
            cleanBookmarksBtn.style.display = "block";
            openBookmarkStudio();
        } else {
            bookmarksResultDiv.textContent = `Scanned ${currentAnalysis.totalBookmarks} bookmarks. No violations found!`;
        }
    } catch (e) {
        bookmarksResultDiv.textContent = `Scan failed: ${e}`;
    }
});

cleanBookmarksBtn.addEventListener("click", async () => {
    openBookmarkStudio();
});

// --- TAB & TITLE INTELLIGENCE SUITE MODAL ---
const intelScrim = document.createElement("div");
intelScrim.className = "tabby-intelligence-scrim";

const intelModal = document.createElement("div");
intelModal.className = "tabby-intelligence-modal";

// Header
const intelHeader = document.createElement("div");
intelHeader.className = "tabby-intel-header";

const intelTitleGroup = document.createElement("div");
intelTitleGroup.className = "tabby-intel-title-group";

const intelTitle = document.createElement("h2");
intelTitle.textContent = "📊 Tab & Title Intelligence Suite";

const intelSubtitle = document.createElement("p");
intelSubtitle.textContent = "Datatable management, title keyword analytics, non-adjacent co-occurrence matrix, and prompt synthesis.";

intelTitleGroup.appendChild(intelTitle);
intelTitleGroup.appendChild(intelSubtitle);

const intelCloseBtn = document.createElement("button");
intelCloseBtn.type = "button";
intelCloseBtn.className = "tabby-studio-close-btn";
intelCloseBtn.textContent = "Close Suite";
intelCloseBtn.addEventListener("click", () => closeIntelligenceModal());

intelHeader.appendChild(intelTitleGroup);
intelHeader.appendChild(intelCloseBtn);

// Navigation Bar
const intelNav = document.createElement("div");
intelNav.className = "tabby-intel-nav";

const intelNavButtons = {};
for (let [tabKey, tabLabel] of [
    ["table", "📋 Datatable & Bookmark Manager"],
    ["analytics", "📊 Language & Co-occurrence Analytics"],
    ["prompts", "🤖 Prompt Synthesizer"]
]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tabby-intel-nav-btn";
    btn.textContent = tabLabel;
    btn.dataset.tab = tabKey;
    btn.addEventListener("click", () => switchIntelligenceTab(tabKey));
    intelNav.appendChild(btn);
    intelNavButtons[tabKey] = btn;
}

// Body container
const intelBody = document.createElement("div");
intelBody.className = "tabby-intel-body";

intelModal.appendChild(intelHeader);
intelModal.appendChild(intelNav);
intelModal.appendChild(intelBody);

document.body.appendChild(intelScrim);
document.body.appendChild(intelModal);

intelScrim.addEventListener("click", (e) => {
    if (e.target === intelScrim) closeIntelligenceModal();
});

let currentIntelTab = "table";
let intelSearchText = "";
let intelStatusFilter = "all";
let intelSortBy = "title_asc";
let intelSelectedTabIds = new Set();
let intelPromptTemplate = "research";

function openIntelligenceModal(initialTab = "table") {
    closeMenus();
    currentIntelTab = initialTab;
    intelScrim.classList.add("-open");
    intelModal.classList.add("-open");
    intelModal.setAttribute("aria-hidden", "false");
    renderIntelligenceSuiteContent();
}

function closeIntelligenceModal() {
    intelScrim.classList.remove("-open");
    intelModal.classList.remove("-open");
    intelModal.setAttribute("aria-hidden", "true");
}

function switchIntelligenceTab(tabKey) {
    currentIntelTab = tabKey;
    renderIntelligenceSuiteContent();
}

async function renderIntelligenceSuiteContent() {
    for (let [key, btn] of Object.entries(intelNavButtons)) {
        btn.classList.toggle("-active", key === currentIntelTab);
    }
    intelBody.replaceChildren();

    const currentTabs = tabState || [];

    // Automatically record visit intelligence
    for (const tab of currentTabs) {
        recordTabVisit(tab, isBookmarked(tab));
    }

    if (currentIntelTab === "table") {
        renderDatatableView(currentTabs);
    } else if (currentIntelTab === "analytics") {
        renderAnalyticsView(currentTabs);
    } else if (currentIntelTab === "prompts") {
        renderPromptSynthesizerView(currentTabs);
    }
}

function renderDatatableView(tabs) {
    const toolbar = document.createElement("div");
    toolbar.className = "tabby-intel-toolbar";

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "tabby-intel-search";
    searchInput.placeholder = "Filter titles, URLs, or domains...";
    searchInput.value = intelSearchText;
    searchInput.addEventListener("input", (e) => {
        intelSearchText = e.target.value;
        renderDatatableView(tabs);
    });

    const statusSelect = document.createElement("select");
    statusSelect.className = "tabby-intel-select";
    for (let [val, lbl] of [
        ["all", "All Tabs"],
        ["bookmarked", "Bookmarked"],
        ["unbookmarked", "Unbookmarked"],
        ["pinned", "Pinned"],
        ["discarded", "Discarded"],
        ["audible", "Audible"]
    ]) {
        let opt = document.createElement("option");
        opt.value = val;
        opt.textContent = lbl;
        if (val === intelStatusFilter) opt.selected = true;
        statusSelect.appendChild(opt);
    }
    statusSelect.addEventListener("change", (e) => {
        intelStatusFilter = e.target.value;
        renderDatatableView(tabs);
    });

    const sortSelect = document.createElement("select");
    sortSelect.className = "tabby-intel-select";
    for (let [val, lbl] of [
        ["title_asc", "Title (A-Z)"],
        ["title_desc", "Title (Z-A)"],
        ["domain", "Domain"],
        ["index", "Tab Order Index"]
    ]) {
        let opt = document.createElement("option");
        opt.value = val;
        opt.textContent = lbl;
        if (val === intelSortBy) opt.selected = true;
        sortSelect.appendChild(opt);
    }
    sortSelect.addEventListener("change", (e) => {
        intelSortBy = e.target.value;
        renderDatatableView(tabs);
    });

    // Batch buttons
    const batchGroup = document.createElement("div");
    batchGroup.style.display = "flex";
    batchGroup.style.gap = "8px";

    const copyMarkdownBtn = document.createElement("button");
    copyMarkdownBtn.type = "button";
    copyMarkdownBtn.className = "tabby-button -secondary";
    copyMarkdownBtn.textContent = "📋 Copy Markdown Links";
    copyMarkdownBtn.addEventListener("click", () => {
        const selected = tabs.filter(t => intelSelectedTabIds.has(t.id));
        const listToCopy = selected.length > 0 ? selected : tabs;
        const mdText = listToCopy.map(t => `- [${t.title || getDisplayUrl(t)}](${t.url})`).join("\n");
        navigator.clipboard.writeText(mdText);
        setStatus(`Copied ${listToCopy.length} markdown links to clipboard!`);
    });

    const exportCsvBtn = document.createElement("button");
    exportCsvBtn.type = "button";
    exportCsvBtn.className = "tabby-button -secondary";
    exportCsvBtn.textContent = "💾 Export CSV";
    exportCsvBtn.addEventListener("click", () => {
        const rows = [["Tab ID", "Title", "URL", "Domain", "Pinned", "Bookmarked", "Discarded"]];
        for (const t of tabs) {
            rows.push([t.id, `"${(t.title||'').replace(/"/g, '""')}"`, `"${t.url}"`, `"${getDomain(t)}"`, t.pinned, isBookmarked(t), t.discarded]);
        }
        const csvContent = "data:text/csv;charset=utf-8," + rows.map(r => r.join(",")).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `tabby_tab_table_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    batchGroup.appendChild(copyMarkdownBtn);
    batchGroup.appendChild(exportCsvBtn);

    toolbar.appendChild(searchInput);
    toolbar.appendChild(statusSelect);
    toolbar.appendChild(sortSelect);
    toolbar.appendChild(batchGroup);

    // Apply filtering & sorting
    let filtered = tabs.filter(t => {
        let q = intelSearchText.toLowerCase();
        let title = (t.title || "").toLowerCase();
        let url = (t.url || "").toLowerCase();
        let dom = getDomain(t).toLowerCase();
        if (q && !title.includes(q) && !url.includes(q) && !dom.includes(q)) return false;
        
        if (intelStatusFilter === "bookmarked") return isBookmarked(t);
        if (intelStatusFilter === "unbookmarked") return !isBookmarked(t);
        if (intelStatusFilter === "pinned") return t.pinned;
        if (intelStatusFilter === "discarded") return t.discarded;
        if (intelStatusFilter === "audible") return t.audible;
        return true;
    });

    if (intelSortBy === "title_asc") filtered.sort((a,b) => (a.title||"").localeCompare(b.title||""));
    if (intelSortBy === "title_desc") filtered.sort((a,b) => (b.title||"").localeCompare(a.title||""));
    if (intelSortBy === "domain") filtered.sort((a,b) => getDomain(a).localeCompare(getDomain(b)));
    if (intelSortBy === "index") filtered.sort((a,b) => a.index - b.index);

    // Table view
    const tableContainer = document.createElement("div");
    tableContainer.className = "tabby-intel-table-container";

    const table = document.createElement("table");
    table.className = "tabby-intel-table";

    const thead = document.createElement("thead");
    thead.innerHTML = `
        <tr>
            <th style="width:36px;"><input type="checkbox" id="intel-select-all" /></th>
            <th>Title</th>
            <th>Domain</th>
            <th>Index / Age</th>
            <th>Status Badges</th>
            <th>Bookmark</th>
            <th style="text-align:right;">Actions</th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const tab of filtered) {
        const tr = document.createElement("tr");

        const tdCheck = document.createElement("td");
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = intelSelectedTabIds.has(tab.id);
        chk.addEventListener("change", (e) => {
            if (e.target.checked) intelSelectedTabIds.add(tab.id);
            else intelSelectedTabIds.delete(tab.id);
        });
        tdCheck.appendChild(chk);

        const tdTitle = document.createElement("td");
        tdTitle.style.fontWeight = "600";
        tdTitle.style.maxWidth = "400px";
        const titleLink = document.createElement("a");
        titleLink.href = "#";
        titleLink.textContent = tab.title || tab.url || "Untitled";
        titleLink.style.color = "#38bdf8";
        titleLink.style.textDecoration = "none";
        titleLink.addEventListener("click", (e) => {
            e.preventDefault();
            activateTab(tab);
            closeIntelligenceModal();
        });
        tdTitle.appendChild(titleLink);

        const tdDomain = document.createElement("td");
        tdDomain.textContent = getDomain(tab);
        tdDomain.style.color = "#94a3b8";

        const tdAge = document.createElement("td");
        tdAge.textContent = `Tab ${tab.index + 1} (${describeOpenedAt(tab)})`;

        const tdBadges = document.createElement("td");
        if (tab.pinned) {
            let p = document.createElement("span");
            p.className = "tabby-intel-pill -active";
            p.textContent = "Pinned";
            tdBadges.appendChild(p);
        }
        if (tab.discarded) {
            let p = document.createElement("span");
            p.className = "tabby-intel-pill -warning";
            p.textContent = "Discarded";
            tdBadges.appendChild(p);
        }
        if (tab.audible) {
            let p = document.createElement("span");
            p.className = "tabby-intel-pill -active";
            p.textContent = "Audible";
            tdBadges.appendChild(p);
        }

        const tdBookmark = document.createElement("td");
        const isB = isBookmarked(tab);
        let bPill = document.createElement("span");
        bPill.className = isB ? "tabby-intel-pill -active" : "tabby-intel-pill";
        bPill.textContent = isB ? "★ Bookmarked" : "☆ Unbookmarked";
        tdBookmark.appendChild(bPill);

        const tdActions = document.createElement("td");
        tdActions.style.textAlign = "right";
        const switchBtn = createActionButton("Jump", "Switch to tab", () => {
            activateTab(tab);
            closeIntelligenceModal();
            return Promise.resolve();
        });
        const closeBtn = createActionButton("Close", "Close tab", () => {
            return closeTab(tab).then(() => renderIntelligenceSuiteContent());
        });
        tdActions.appendChild(switchBtn);
        tdActions.appendChild(closeBtn);

        tr.appendChild(tdCheck);
        tr.appendChild(tdTitle);
        tr.appendChild(tdDomain);
        tr.appendChild(tdAge);
        tr.appendChild(tdBadges);
        tr.appendChild(tdBookmark);
        tr.appendChild(tdActions);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableContainer.appendChild(table);

    intelBody.appendChild(toolbar);
    intelBody.appendChild(tableContainer);

    const selectAllChk = thead.querySelector("#intel-select-all");
    selectAllChk?.addEventListener("change", (e) => {
        if (e.target.checked) filtered.forEach(t => intelSelectedTabIds.add(t.id));
        else intelSelectedTabIds.clear();
        renderDatatableView(tabs);
    });
}

function renderAnalyticsView(tabs) {
    const cloud = extractKeywordCloud(tabs);
    const bigrams = extractNgrams(tabs, 2);
    const coOccur = extractNonAdjacentCoOccurrences(tabs);
    const clusters = clusterByDomainAndTheme(tabs);

    // Section 1: Word Cloud
    const cloudCard = document.createElement("div");
    cloudCard.className = "tabby-intel-section-card";
    const cloudTitle = document.createElement("h3");
    cloudTitle.textContent = "☁ Title Keyword Frequency Cloud";
    cloudCard.appendChild(cloudTitle);

    const cloudDiv = document.createElement("div");
    cloudDiv.className = "tabby-intel-cloud";
    for (const item of cloud.slice(0, 30)) {
        const bubble = document.createElement("button");
        bubble.className = "tabby-intel-bubble";
        bubble.textContent = `${item.word} (${item.count})`;
        bubble.addEventListener("click", () => {
            intelSearchText = item.word;
            switchIntelligenceTab("table");
        });
        cloudDiv.appendChild(bubble);
    }
    cloudCard.appendChild(cloudDiv);

    // Section 2: Non-adjacent Co-occurrences & N-Grams
    const grid = document.createElement("div");
    grid.className = "tabby-intel-card-grid";

    // Non-adjacent Co-occurrences Card
    const coCard = document.createElement("div");
    coCard.className = "tabby-intel-section-card";
    const coTitle = document.createElement("h3");
    coTitle.textContent = "🔗 Non-Adjacent Co-Occurring Words Matrix";
    coTitle.title = "Words frequently appearing together in titles across your session, even if separated by other terms.";
    coCard.appendChild(coTitle);

    const coTable = document.createElement("table");
    coTable.className = "tabby-intel-table";
    coTable.innerHTML = `<thead><tr><th>Word Pair</th><th>Co-occurrences</th><th>Score</th></tr></thead>`;
    const coTbody = document.createElement("tbody");
    for (const item of coOccur.slice(0, 10)) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td><strong>${item.pair}</strong></td><td>${item.count}</td><td><span class="tabby-intel-pill -active">${item.score.toFixed(2)}</span></td>`;
        coTbody.appendChild(tr);
    }
    coTable.appendChild(coTbody);
    coCard.appendChild(coTable);

    // Adjacent N-grams Card
    const ngramCard = document.createElement("div");
    ngramCard.className = "tabby-intel-section-card";
    const ngramTitle = document.createElement("h3");
    ngramTitle.textContent = "🔤 Common Multi-Word Phrases (N-Grams)";
    ngramCard.appendChild(ngramTitle);

    const ngramTable = document.createElement("table");
    ngramTable.className = "tabby-intel-table";
    ngramTable.innerHTML = `<thead><tr><th>Phrase</th><th>Frequency</th></tr></thead>`;
    const ngramTbody = document.createElement("tbody");
    for (const item of bigrams.slice(0, 10)) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td><strong>${item.phrase}</strong></td><td>${item.count}</td>`;
        ngramTbody.appendChild(tr);
    }
    ngramTable.appendChild(ngramTbody);
    ngramCard.appendChild(ngramTable);

    grid.appendChild(coCard);
    grid.appendChild(ngramCard);

    // Section 3: Domain Clusters
    const clusterCard = document.createElement("div");
    clusterCard.className = "tabby-intel-section-card";
    const clusterTitle = document.createElement("h3");
    clusterTitle.textContent = "🌐 Domain & Theme Clusters";
    clusterCard.appendChild(clusterTitle);

    const clusterTable = document.createElement("table");
    clusterTable.className = "tabby-intel-table";
    clusterTable.innerHTML = `<thead><tr><th>Domain</th><th>Tab Count</th><th>Extracted Topic Keywords</th></tr></thead>`;
    const clusterTbody = document.createElement("tbody");
    for (const cl of clusters) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td><strong>${cl.domain}</strong></td><td>${cl.count}</td><td>${cl.topKeywords.join(", ") || "General"}</td>`;
        clusterTbody.appendChild(tr);
    }
    clusterTable.appendChild(clusterTbody);
    clusterCard.appendChild(clusterTable);

    intelBody.appendChild(cloudCard);
    intelBody.appendChild(grid);
    intelBody.appendChild(clusterCard);
}

function renderPromptSynthesizerView(tabs) {
    const card = document.createElement("div");
    card.className = "tabby-intel-section-card";

    const title = document.createElement("h3");
    title.textContent = "🤖 LLM Prompt Synthesizer";
    const desc = document.createElement("p");
    desc.style.color = "#94a3b8";
    desc.style.marginBottom = "14px";
    desc.textContent = "Transform your open tab titles and extracted co-occurrences into high-yield, structured prompts for ChatGPT, Claude, and Gemini.";

    const templateBar = document.createElement("div");
    templateBar.style.display = "flex";
    templateBar.style.gap = "12px";
    templateBar.style.marginBottom = "16px";

    for (let [type, label] of [
        ["research", "🔬 Research Session Synthesis"],
        ["developer", "💻 Developer Context Pack"],
        ["bookmark_digest", "📚 Bookmark Knowledge Digest"]
    ]) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = type === intelPromptTemplate ? "tabby-button -primary" : "tabby-button -secondary";
        btn.textContent = label;
        btn.addEventListener("click", () => {
            intelPromptTemplate = type;
            renderPromptSynthesizerView(tabs);
        });
        templateBar.appendChild(btn);
    }

    const promptText = generateLlmPrompt(tabs, intelPromptTemplate);

    const textarea = document.createElement("textarea");
    textarea.className = "tabby-intel-textarea";
    textarea.value = promptText;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "tabby-button -accent";
    copyBtn.style.marginTop = "14px";
    copyBtn.textContent = "📋 Copy Prompt to Clipboard";
    copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(textarea.value);
        setStatus("Copied synthesized prompt to clipboard!");
    });

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(templateBar);
    card.appendChild(textarea);
    card.appendChild(copyBtn);

    intelBody.appendChild(card);
}

settingsPanel.appendChild(settingsHeader);
settingsPanel.appendChild(settingsTogglesSection);
settingsPanel.appendChild(settingsSessionSection);
settingsPanel.appendChild(settingsBookmarksSection);
settingsPanel.appendChild(settingsGuideSection);

topPanelInner.appendChild(hero);
topPanelInner.appendChild(controls);
topPanelInner.appendChild(selectionBar);
metaBar.appendChild(status);
metaBar.appendChild(hint);
topPanelInner.appendChild(metaBar);
topPanel.appendChild(topPanelInner);

shell.appendChild(topPanel);
shell.appendChild(list);
root.appendChild(shell);
document.body.appendChild(settingsScrim);
document.body.appendChild(settingsPanel);

function setStatus(message) {
    status.textContent = message;
}

function getDisplayUrl(tab) {
    return tab.url || tab.pendingUrl || "Browser page";
}

function getDomain(tab) {
    try {
        return tab.url ? new URL(tab.url).hostname : "Browser page";
    } catch (error) {
        return "Browser page";
    }
}

function formatClock(timestamp) {
    if (!timestamp) {
        return "Unknown";
    }
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });
}

function describeOpenedAt(tab) {
    let firstSeenAt = tabMeta[tab.id]?.firstSeenAt;
    return firstSeenAt ? `Opened ${formatClock(firstSeenAt)}` : "Opened time unavailable";
}

function describePreview(tab) {
    if (tab.discarded) {
        return "Preview unavailable until the tab is reloaded.";
    }
    if (previewCache[tab.id]?.updatedAt) {
        return `Preview captured ${formatClock(previewCache[tab.id].updatedAt)}`;
    }
    return "No captured preview yet. Use Recapture to try again.";
}

function isBookmarked(tab) {
    return Boolean(bookmarkState[tab.id]);
}

function isSelectedForRecapture(tabId) {
    return selectionState.tabIds.has(tabId);
}

function createBadge(text, accent=false) {
    let badge = document.createElement("span");
    badge.className = accent ? "tabby-badge -accent" : "tabby-badge";
    badge.textContent = text;
    return badge;
}

function buildPreviewMedia(tab) {
    const frame = document.createElement("div");
    frame.className = "tabby-preview";

    const image = document.createElement("img");
    image.alt = "";
    image.style.display = "none";

    const placeholder = document.createElement("div");
    placeholder.className = "tabby-placeholder";

    const placeholderLabel = document.createElement("div");
    placeholderLabel.textContent = tab.discarded ? "Discarded tab" : "Preview pending";
    placeholderLabel.style.fontWeight = "700";
    placeholderLabel.style.marginBottom = "6px";

    const placeholderText = document.createElement("div");
    placeholderText.textContent = tab.discarded ? "Reload the page before capturing again." : "Activate or recapture this tab to refresh its screenshot.";
    placeholderText.style.fontSize = "13px";
    placeholderText.style.lineHeight = "1.45";

    placeholder.appendChild(placeholderLabel);
    placeholder.appendChild(placeholderText);
    frame.appendChild(image);
    frame.appendChild(placeholder);

    let preview = previewCache[tab.id];
    if (preview?.src) {
        image.src = preview.src;
        image.style.display = "block";
        placeholder.style.display = "none";
    } else if (tab.favIconUrl) {
        const favicon = document.createElement("img");
        favicon.alt = "";
        favicon.src = tab.favIconUrl;
        favicon.style.width = "40px";
        favicon.style.height = "40px";
        favicon.style.marginBottom = "10px";
        placeholder.prepend(favicon);
    }

    if (selectionState.active) {
        const selectionChip = document.createElement("div");
        let selected = isSelectedForRecapture(tab.id);
        selectionChip.className = selected ? "tabby-selection-chip -selected" : "tabby-selection-chip";
        selectionChip.textContent = selected ? "Selected" : "Select";
        frame.appendChild(selectionChip);
    }

    return frame;
}

function createActionButton(label, title, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tabby-action";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", event => {
        event.stopPropagation();
        handler().catch(error => {
            setStatus(`Action failed: ${error}`);
        });
    });
    return button;
}

function getFilteredSortedTabs() {
    return sortTabs(applyFilters(tabState));
}

function syncDashboardChrome() {
    for (let [mode, btn] of Object.entries(detailModeButtons)) {
        btn.classList.toggle("-active", mode === viewState.detailMode);
    }
    for (let [mode, btn] of Object.entries(settingsDetailModeButtons)) {
        btn.classList.toggle("-active", mode === viewState.detailMode);
    }
    let isCollapsed = viewState.detailMode === "none" && !viewState.controlsExpanded;
    topPanelInner.classList.toggle("-collapsed", isCollapsed);

    settingsStickyRow.input.checked = viewState.stickyControls;
    settingsPinnedRow.input.checked = viewState.keepPinned;

    topPanel.classList.toggle("-sticky", viewState.stickyControls);
    recaptureMenu.classList.toggle("-open", viewState.recaptureMenuOpen);
    settingsScrim.classList.toggle("-open", viewState.settingsOpen);
    settingsPanel.classList.toggle("-open", viewState.settingsOpen);
    settingsPanel.setAttribute("aria-hidden", viewState.settingsOpen ? "false" : "true");

    selectionBar.style.display = selectionState.active ? "flex" : "none";
    selectionCopy.textContent = selectionState.active
        ? `${selectionState.tabIds.size} preview${selectionState.tabIds.size === 1 ? "" : "s"} selected. Click cards to add or remove them, then confirm the recapture.`
        : "";
    selectionConfirmButton.disabled = selectionState.tabIds.size === 0;
    selectionConfirmButton.classList.toggle("-disabled", selectionState.tabIds.size === 0);
}

function closeMenus() {
    viewState.recaptureMenuOpen = false;
    viewState.settingsOpen = false;
    syncDashboardChrome();
}

async function setDetailMode(value) {
    viewState.detailMode = value;
    if (value !== "none") {
        viewState.controlsExpanded = false;
    }
    syncDashboardChrome();
    await saveDashboardSetting(OPTION_DETAIL_MODE, value);
    renderVisibleTabs();
}

async function setStickyControls(value) {
    viewState.stickyControls = value;
    syncDashboardChrome();
    await saveDashboardSetting(OPTION_STICKY_CONTROLS, value);
}

async function setKeepPinned(value) {
    viewState.keepPinned = value;
    syncDashboardChrome();
    await saveDashboardSetting(OPTION_KEEP_PINNED, value);

    if (value) {
        await ensurePinnedDashboard();
    } else {
        let tabs = await browser.tabs.query({ currentWindow: true });
        let tabbyTabs = tabs.filter(tab => (tab.url || "").startsWith(NEWTAB_URL) && tab.pinned);
        await Promise.all(tabbyTabs.map(tab => browser.tabs.update(tab.id, { pinned: false })));
    }
    renderVisibleTabs();
}

function openSettings() {
    viewState.settingsOpen = true;
    viewState.recaptureMenuOpen = false;
    syncDashboardChrome();
}

function toggleRecaptureMenu() {
    viewState.recaptureMenuOpen = !viewState.recaptureMenuOpen;
    viewState.settingsOpen = false;
    syncDashboardChrome();
}

function startRecaptureSelection() {
    selectionState.active = true;
    selectionState.tabIds.clear();
    viewState.recaptureMenuOpen = false;
    syncDashboardChrome();
    renderVisibleTabs();
}

function cancelRecaptureSelection() {
    selectionState.active = false;
    selectionState.tabIds.clear();
    syncDashboardChrome();
    renderVisibleTabs();
}

function toggleSelectedRecapture(tab) {
    if (tab.discarded) {
        setStatus("Discarded tabs must be reloaded before they can be recaptured.");
        return;
    }
    if (selectionState.tabIds.has(tab.id)) {
        selectionState.tabIds.delete(tab.id);
    } else {
        selectionState.tabIds.add(tab.id);
    }
    syncDashboardChrome();
    renderVisibleTabs();
}

async function activateTab(tab) {
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
}

async function closeTab(tab) {
    setStatus(`Closing ${tab.title || tab.url || "tab"}...`);
    await browser.tabs.remove(tab.id);
    await renderTabs();
}

async function togglePin(tab) {
    setStatus(`${tab.pinned ? "Unpinning" : "Pinning"} ${tab.title || tab.url || "tab"}...`);
    await browser.tabs.update(tab.id, { pinned: !tab.pinned });
    await renderTabs();
}

async function reloadTab(tab) {
    setStatus(`Reloading ${tab.title || tab.url || "tab"}...`);
    await browser.tabs.reload(tab.id, { bypassCache: true });
    await browser.runtime.sendMessage({
        _: "preview:refresh",
        tabId: tab.id,
        quality: PREVIEW_QUALITY
    });
    await renderTabs();
}

async function recaptureTab(tab) {
    if (selectionState.active) {
        toggleSelectedRecapture(tab);
        return;
    }
    setStatus(`Recapturing ${tab.title || tab.url || "tab"}...`);
    let refreshed = await browser.runtime.sendMessage({
        _: "preview:refresh",
        tabId: tab.id,
        quality: PREVIEW_QUALITY
    });
    if (refreshed) {
        previewCache[tab.id] = refreshed;
    }
    await renderTabs();
}

function renderTabCard(tab) {
    const article = document.createElement("article");
    article.className = "tabby-card";
    article.dataset.tabId = tab.id;
    article.draggable = viewState.sortMode === "browser" && !selectionState.active;

    if (viewState.detailMode === "none") {
        article.classList.add("-preview-only");
    }
    if (selectionState.active) {
        article.classList.add("-selection-mode");
    }
    if (selectionState.tabIds.has(tab.id)) {
        article.classList.add("-selected");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tabby-card-main";
    button.title = selectionState.active
        ? `Select ${tab.title || getDisplayUrl(tab)} for recapture`
        : `Switch to ${tab.title || getDisplayUrl(tab)}`;
    const previewContainer = document.createElement("div");
    previewContainer.style.position = "relative";
    previewContainer.appendChild(buildPreviewMedia(tab));

    if (!selectionState.active) {
        const closeOverlay = document.createElement("button");
        closeOverlay.type = "button";
        closeOverlay.className = "tabby-close-overlay";
        closeOverlay.textContent = "\u00d7";
        closeOverlay.title = `Close ${tab.title || getDisplayUrl(tab)}`;
        closeOverlay.setAttribute("aria-label", `Close ${tab.title || getDisplayUrl(tab)}`);
        closeOverlay.addEventListener("click", event => {
            event.stopPropagation();
            closeTab(tab).catch(error => setStatus(`Failed to close tab: ${error}`));
        });
        previewContainer.appendChild(closeOverlay);
    }

    button.appendChild(previewContainer);

    if (viewState.detailMode === "full") {
        const metaRow = document.createElement("div");
        metaRow.className = "tabby-meta-row";

        const titleGroup = document.createElement("div");
        titleGroup.style.minWidth = "0";

        const urlMeta = document.createElement("div");
        urlMeta.textContent = getDisplayUrl(tab);
        urlMeta.className = "tabby-card-url-meta";
        urlMeta.title = getDisplayUrl(tab);

        const title = document.createElement("div");
        title.textContent = tab.title || tab.pendingUrl || tab.url || "Untitled tab";
        title.className = "tabby-title";
        title.title = tab.title || tab.pendingUrl || tab.url || "Untitled tab";

        titleGroup.appendChild(urlMeta);
        titleGroup.appendChild(title);

        const pill = document.createElement("div");
        pill.textContent = tab.pinned ? "Pinned" : `Tab ${tab.index + 1}`;
        pill.className = "tabby-pill";
        pill.title = tab.pinned ? "This tab is pinned." : "This is the tab's current browser order index.";

        metaRow.appendChild(titleGroup);
        metaRow.appendChild(pill);

        const badges = document.createElement("div");
        badges.className = "tabby-badges";
        badges.appendChild(createBadge(describeOpenedAt(tab)));
        badges.appendChild(createBadge(describePreview(tab), true));
        if (isBookmarked(tab)) {
            badges.appendChild(createBadge("Bookmarked"));
        }
        if (tab.audible) {
            badges.appendChild(createBadge("Audible"));
        }
        if (tab.discarded) {
            badges.appendChild(createBadge("Discarded"));
        }

        button.appendChild(metaRow);
        button.appendChild(badges);
    }

    if (viewState.detailMode === "minimal") {
        const minimalTitle = document.createElement("div");
        minimalTitle.className = "tabby-minimal-title";
        minimalTitle.textContent = tab.title || tab.pendingUrl || tab.url || "Untitled tab";
        minimalTitle.title = tab.title || tab.pendingUrl || tab.url || "Untitled tab";
        button.appendChild(minimalTitle);
    }

    if (viewState.detailMode === "title") {
        article.classList.add("-title-only");
        previewContainer.style.display = "none";

        const titleRow = document.createElement("div");
        titleRow.className = "tabby-title-only-header";

        if (tab.favIconUrl) {
            const fav = document.createElement("img");
            fav.className = "tabby-title-only-favicon";
            fav.src = tab.favIconUrl;
            fav.alt = "";
            titleRow.appendChild(fav);
        }

        const titleTxt = document.createElement("div");
        titleTxt.className = "tabby-title-only-title";
        titleTxt.textContent = tab.title || tab.pendingUrl || tab.url || "Untitled tab";
        titleTxt.title = tab.title || tab.pendingUrl || tab.url || "Untitled tab";
        titleRow.appendChild(titleTxt);

        const domTag = document.createElement("div");
        domTag.className = "tabby-title-only-domain";
        domTag.textContent = getDomain(tab);
        titleRow.appendChild(domTag);

        button.appendChild(titleRow);

        const badges = document.createElement("div");
        badges.className = "tabby-badges";
        badges.appendChild(createBadge(describeOpenedAt(tab)));
        if (isBookmarked(tab)) badges.appendChild(createBadge("Bookmarked"));
        if (tab.audible) badges.appendChild(createBadge("Audible"));
        if (tab.discarded) badges.appendChild(createBadge("Discarded"));

        button.appendChild(badges);
    }

    button.addEventListener("click", async event => {
        event.preventDefault();
        if (selectionState.active) {
            toggleSelectedRecapture(tab);
            return;
        }
        await activateTab(tab);
    });

    article.appendChild(button);

    if (viewState.detailMode !== "none" && !selectionState.active) {
        const actions = document.createElement("div");
        actions.className = "tabby-action-row";
        actions.appendChild(createActionButton(tab.pinned ? "Unpin" : "Pin", "Toggle pin state", () => togglePin(tab)));
        actions.appendChild(createActionButton("Reload", "Reload the page and refresh its preview cache", () => reloadTab(tab)));
        actions.appendChild(createActionButton("Recapture", "Force a new preview screenshot", () => recaptureTab(tab)));
        article.appendChild(actions);
    }

    wireDragAndDrop(article, tab);
    return article;
}

async function getVisibleTabs() {
    const currentTabs = await browser.tabs.query({ currentWindow: true });
    return currentTabs
        .filter(tab => !(tab.url || "").startsWith(NEWTAB_URL))
        .sort((left, right) => left.index - right.index);
}

let _urlBookmarkCache = new Map();
let _urlBookmarkCacheTime = 0;

function clearBookmarkCache() {
    _urlBookmarkCache.clear();
    _urlBookmarkCacheTime = Date.now();
}

async function getBookmarkStateForTabs(tabs) {
    if (!browser.bookmarks?.search) {
        return {};
    }

    let now = Date.now();
    if (now - _urlBookmarkCacheTime > 5000) {
        _urlBookmarkCache.clear();
        _urlBookmarkCacheTime = now;
    }

    let uniqueUrls = new Map();
    let urlsToQuery = [];

    for (let tab of tabs) {
        let url = tab.url || tab.pendingUrl;
        if (url && !uniqueUrls.has(url)) {
            if (_urlBookmarkCache.has(url)) {
                uniqueUrls.set(url, _urlBookmarkCache.get(url));
            } else {
                uniqueUrls.set(url, false);
                urlsToQuery.push(url);
            }
        }
    }

    if (urlsToQuery.length > 0) {
        const batchSize = 10;
        for (let i = 0; i < urlsToQuery.length; i += batchSize) {
            const batch = urlsToQuery.slice(i, i + batchSize);
            await Promise.all(batch.map(async url => {
                try {
                    let matches = await browser.bookmarks.search({ url });
                    let isBookmarked = matches && matches.length > 0;
                    _urlBookmarkCache.set(url, isBookmarked);
                    uniqueUrls.set(url, isBookmarked);
                } catch (e) {
                    uniqueUrls.set(url, false);
                }
            }));
        }
    }

    let result = {};
    for (let tab of tabs) {
        let url = tab.url || tab.pendingUrl;
        result[tab.id] = url ? uniqueUrls.get(url) || false : false;
    }
    return result;
}

async function updatePreviewCacheForTabs(tabs) {
    try {
        previewCache = await browser.runtime.sendMessage({
            _: "preview:getCached",
            tabIds: tabs.map(tab => tab.id)
        }) || {};
    } catch (e) {
        previewCache = previewCache || {};
    }

    let missingTabs = tabs
        .filter(tab => !tab.discarded && !previewCache[tab.id]?.src)
        .map(tab => tab.id);

    if (missingTabs.length > 0) {
        try {
            let captured = await browser.runtime.sendMessage({
                _: "preview:ensureMany",
                tabIds: missingTabs,
                quality: PREVIEW_QUALITY,
                force: false
            });
            previewCache = {
                ...previewCache,
                ...(captured || {})
            };
        } catch (e) {
            // keep existing cache on failure
        }
    }
}

function getOpenedAt(tab) {
    return tabMeta[tab.id]?.firstSeenAt || 0;
}

function applyFilters(tabs) {
    return tabs.filter(tab => {
        let searchText = viewState.search.trim().toLowerCase();
        let domain = getDomain(tab);
        let title = (tab.title || "").toLowerCase();
        let url = getDisplayUrl(tab).toLowerCase();

        if (searchText) {
            let haystack = `${title}\n${url}\n${domain.toLowerCase()}`;
            if (!haystack.includes(searchText)) {
                return false;
            }
        }

        if (viewState.domainFilter !== "all" && domain !== viewState.domainFilter) {
            return false;
        }

        switch (viewState.statusFilter) {
            case "bookmarked":
                return isBookmarked(tab);
            case "unbookmarked":
                return !isBookmarked(tab);
            case "pinned":
                return tab.pinned;
            case "unpinned":
                return !tab.pinned;
            case "discarded":
                return tab.discarded;
            case "audible":
                return tab.audible;
            default:
                return true;
        }
    });
}

function sortTabs(tabs) {
    let sorted = [...tabs];
    switch (viewState.sortMode) {
        case "domain":
            sorted.sort((left, right) => getDomain(left).localeCompare(getDomain(right)) || left.index - right.index);
            break;
        case "title":
            sorted.sort((left, right) => (left.title || left.url || "").localeCompare(right.title || right.url || "") || left.index - right.index);
            break;
        case "openedNewest":
            sorted.sort((left, right) => getOpenedAt(right) - getOpenedAt(left) || left.index - right.index);
            break;
        case "openedOldest":
            sorted.sort((left, right) => getOpenedAt(left) - getOpenedAt(right) || left.index - right.index);
            break;
        case "bookmarked":
            sorted.sort((left, right) => Number(isBookmarked(right)) - Number(isBookmarked(left)) || left.index - right.index);
            break;
        default:
            sorted.sort((left, right) => left.index - right.index);
            break;
    }
    return sorted;
}

function updateDomainFilterOptions(tabs) {
    let domains = Array.from(new Set(tabs.map(getDomain))).sort((left, right) => left.localeCompare(right));
    let previous = viewState.domainFilter;
    domainFilter.replaceChildren();

    let allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All domains";
    domainFilter.appendChild(allOption);

    for (let domain of domains) {
        let option = document.createElement("option");
        option.value = domain;
        option.textContent = domain;
        domainFilter.appendChild(option);
    }

    viewState.domainFilter = domains.includes(previous) || previous === "all" ? previous : "all";
    domainFilter.value = viewState.domainFilter;
}

function updateHint(visibleTabs) {
    if (selectionState.active) {
        hint.textContent = "Selection mode is active. Click previews to choose them, then use Recapture selected above.";
        return;
    }
    if (visibleTabs.length === 0) {
        hint.textContent = "No tabs match the current filters.";
        return;
    }
    if (viewState.sortMode === "browser") {
        hint.textContent = "Drag cards to reorder real browser tabs. Moving across the pinned boundary is blocked until pin states match.";
    } else {
        hint.textContent = "Switch back to Browser order to drag tabs. Other sort modes are read-only views.";
    }
}

function clearDropMarkers() {
    for (let element of list.querySelectorAll(".tabby-card.-active-drop-before, .tabby-card.-active-drop-after")) {
        element.classList.remove("-active-drop-before", "-active-drop-after");
    }
}

function getDropRelation(event, element) {
    let bounds = element.getBoundingClientRect();
    let offsetX = event.clientX - bounds.left;
    let offsetY = event.clientY - bounds.top;
    if (bounds.width >= bounds.height) {
        return offsetX < bounds.width / 2 ? "before" : "after";
    }
    return offsetY < bounds.height / 2 ? "before" : "after";
}

async function reorderTabs(sourceTabId, targetTabId, relation) {
    let sourceTab = tabState.find(tab => tab.id === sourceTabId);
    let targetTab = tabState.find(tab => tab.id === targetTabId);
    if (!sourceTab || !targetTab || sourceTab.id === targetTab.id) {
        return;
    }
    if (sourceTab.pinned !== targetTab.pinned) {
        setStatus("Pin or unpin the tab first before moving it across the pinned boundary.");
        return;
    }

    let targetIndex = relation === "after" ? targetTab.index + 1 : targetTab.index;
    if (sourceTab.index < targetIndex) {
        targetIndex -= 1;
    }

    setStatus(`Moving ${sourceTab.title || sourceTab.url || "tab"}...`);
    await browser.tabs.move(sourceTab.id, { index: targetIndex });
    await renderTabs();
}

function wireDragAndDrop(element, tab) {
    if (viewState.sortMode !== "browser" || selectionState.active) {
        return;
    }

    element.addEventListener("dragstart", event => {
        dragTabId = tab.id;
        element.classList.add("-dragging");
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(tab.id));
        }
    });

    element.addEventListener("dragend", () => {
        dragTabId = undefined;
        element.classList.remove("-dragging");
        clearDropMarkers();
    });

    element.addEventListener("dragover", event => {
        if (!dragTabId || dragTabId === tab.id) {
            return;
        }
        event.preventDefault();
        clearDropMarkers();
        let relation = getDropRelation(event, element);
        element.classList.add(relation === "before" ? "-active-drop-before" : "-active-drop-after");
    });

    element.addEventListener("drop", event => {
        if (!dragTabId || dragTabId === tab.id) {
            return;
        }
        event.preventDefault();
        let relation = getDropRelation(event, element);
        clearDropMarkers();
        reorderTabs(dragTabId, tab.id, relation).catch(error => {
            setStatus(`Failed to move tab: ${error}`);
        });
    });
}

function renderVisibleTabs() {
    let visibleTabs = getFilteredSortedTabs();
    setStatus(`${visibleTabs.length} of ${tabState.length} tab${tabState.length === 1 ? "" : "s"} in this window.${viewState.keepPinned ? " Tabby stays pinned at the front for quick return." : ""}`);
    updateHint(visibleTabs);

    if (visibleTabs.length === 0) {
        let empty = document.createElement("div");
        empty.className = "tabby-empty";
        empty.textContent = selectionState.active
            ? "No visible cards are available to select right now. Adjust filters or cancel selection mode."
            : "No tabs match the current filters. Reset the controls or clear the search to bring cards back.";
        list.replaceChildren(empty);
        return;
    }

    list.replaceChildren(...visibleTabs.map(renderTabCard));
}

async function renderTabs() {
    tabState = await getVisibleTabs();
    renderedTabIds = tabState.map(tab => tab.id);

    // Kick off bookmark lookup in background — don't block the initial render on it
    let bookmarkStatePromise = getBookmarkStateForTabs(tabState);

    let tabMetaResult = await browser.runtime.sendMessage({
        _: "tabs:getMeta",
        tabIds: tabState.map(tab => tab.id)
    }).catch(() => {});
    tabMeta = tabMetaResult || {};

    await updatePreviewCacheForTabs(tabState);
    updateDomainFilterOptions(tabState);
    renderVisibleTabs();

    // Re-render once bookmark state resolves so badges are accurate
    bookmarkState = await bookmarkStatePromise.catch(() => {}) || {};
    renderVisibleTabs();
}

async function recaptureVisiblePreviews() {
    let visibleTabs = getFilteredSortedTabs().filter(tab => !tab.discarded);
    if (visibleTabs.length === 0) {
        setStatus("No visible tabs available to recapture.");
        return;
    }
    setStatus(`Recapturing ${visibleTabs.length} visible preview${visibleTabs.length === 1 ? "" : "s"}...`);
    let refreshed = await browser.runtime.sendMessage({
        _: "preview:ensureMany",
        tabIds: visibleTabs.map(tab => tab.id),
        quality: PREVIEW_QUALITY,
        force: true
    });
    previewCache = {
        ...previewCache,
        ...(refreshed || {})
    };
    viewState.recaptureMenuOpen = false;
    syncDashboardChrome();
    await renderTabs();
}

async function recaptureSelectedPreviews() {
    let selectedTabIds = Array.from(selectionState.tabIds);
    if (selectedTabIds.length === 0) {
        setStatus("Choose at least one preview before confirming the recapture.");
        return;
    }
    setStatus(`Recapturing ${selectedTabIds.length} selected preview${selectedTabIds.length === 1 ? "" : "s"}...`);
    let refreshed = await browser.runtime.sendMessage({
        _: "preview:ensureMany",
        tabIds: selectedTabIds,
        quality: PREVIEW_QUALITY,
        force: true
    });
    previewCache = {
        ...previewCache,
        ...(refreshed || {})
    };
    cancelRecaptureSelection();
    await renderTabs();
}

async function ensurePinnedDashboard() {
    let result = await browser.runtime.sendMessage({ _: "dashboard:ensurePinned" });
    if (result?.status === "redirected") {
        setStatus("Returning to the pinned Tabby dashboard...");
    }
}

// ============================================================
// Bookmark folder detection + random opener
// ============================================================

async function loadBookmarkBarFolders() {
    if (!browser.bookmarks?.getTree) return;
    try {
        const tree = await browser.bookmarks.getTree();
        const root = tree[0];
        let toolbarNode = null;
        for (const child of (root.children || [])) {
            const title = (child.title || "").toLowerCase();
            if (
                child.id === "toolbar_____" ||   // Firefox
                child.id === "1" ||               // Chrome
                title.includes("toolbar") ||
                title.includes("bookmarks bar")
            ) {
                toolbarNode = child;
                break;
            }
        }
        if (!toolbarNode) toolbarNode = root;

        bookmarkBarFolders = (toolbarNode.children || []).filter(
            n => !n.url && Array.isArray(n.children)
        );
    } catch (e) {
        bookmarkBarFolders = [];
    }

    bookmarkFolderSelect.replaceChildren();
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = bookmarkBarFolders.length === 0
        ? "No bookmark folders found"
        : "Bookmark folder\u2026";
    defaultOpt.disabled = true;
    defaultOpt.selected = true;
    bookmarkFolderSelect.appendChild(defaultOpt);

    for (const folder of bookmarkBarFolders) {
        const opt = document.createElement("option");
        opt.value = folder.id;
        opt.textContent = folder.title || "Untitled folder";
        bookmarkFolderSelect.appendChild(opt);
    }
}

function _collectBookmarkUrls(nodes) {
    let urls = [];
    for (const node of nodes) {
        if (node.url) {
            urls.push(node.url);
        } else if (node.children) {
            urls.push(..._collectBookmarkUrls(node.children));
        }
    }
    return urls;
}

function _pickRandom(arr, count) {
    const pool = [...arr];
    const result = [];
    while (result.length < count && pool.length > 0) {
        const i = Math.floor(Math.random() * pool.length);
        result.push(pool.splice(i, 1)[0]);
    }
    return result;
}

async function openRandomBookmarks() {
    const folderId = bookmarkFolderSelect.value;
    if (!folderId) {
        setStatus("Select a bookmark folder first.");
        return;
    }
    const subtree = await browser.bookmarks.getSubTree(folderId);
    const folderTitle = subtree[0]?.title || "folder";
    const urls = _collectBookmarkUrls(subtree[0]?.children || []);
    if (urls.length === 0) {
        setStatus(`No bookmarks found in "${folderTitle}".`);
        return;
    }
    const selected = _pickRandom(urls, 10);
    await Promise.all(selected.map(url => browser.tabs.create({ url, active: false })));
    setStatus(`Opened ${selected.length} random bookmark${selected.length === 1 ? "" : "s"} from "${folderTitle}".`);
}

// ============================================================
// Session history
// ============================================================

async function renderSessionHistory() {
    sessionHistoryList.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "tabby-session-empty";
    loading.textContent = "Loading\u2026";
    sessionHistoryList.appendChild(loading);

    try {
        const [sessions, autosaveResult] = await Promise.all([
            browser.runtime.sendMessage({ _: "sessions:getHistory" }),
            browser.storage.local.get(SESSION_AUTOSAVE_KEY)
        ]);
        const autosaveEnabled = autosaveResult[SESSION_AUTOSAVE_KEY] !== false;
        settingsAutosaveRow.input.checked = autosaveEnabled;

        sessionHistoryList.replaceChildren();

        if (!sessions || sessions.length === 0) {
            const empty = document.createElement("div");
            empty.className = "tabby-session-empty";
            empty.textContent = autosaveEnabled
                ? "No sessions saved yet. Close a window to save your first snapshot."
                : "Auto-save is off. Enable it above to start saving sessions.";
            sessionHistoryList.appendChild(empty);
            return;
        }

        for (const session of sessions) {
            const card = document.createElement("div");
            card.className = "tabby-session-card";

            const info = document.createElement("div");
            info.className = "tabby-session-info";

            const dateDiv = document.createElement("div");
            dateDiv.className = "tabby-session-date";
            dateDiv.textContent = new Date(session.savedAt).toLocaleDateString([], {
                weekday: "short", month: "short", day: "numeric"
            });

            const countDiv = document.createElement("div");
            countDiv.className = "tabby-session-count";
            const sampleTitles = session.tabs.slice(0, 3).map(t => t.title || t.url).join(", ");
            const extra = session.tabs.length > 3 ? ` +${session.tabs.length - 3} more` : "";
            countDiv.textContent = `${session.tabs.length} tab${session.tabs.length === 1 ? "" : "s"} \u2014 ${sampleTitles}${extra}`;
            countDiv.title = session.tabs.map(t => t.title || t.url).join("\n");

            info.appendChild(dateDiv);
            info.appendChild(countDiv);

            const restoreBtn = document.createElement("button");
            restoreBtn.type = "button";
            restoreBtn.className = "tabby-button -secondary";
            restoreBtn.textContent = "Restore";
            restoreBtn.title = `Open these ${session.tabs.length} tabs in a new window.`;
            restoreBtn.addEventListener("click", () => {
                restoreSession(session).catch(e => setStatus(`Failed to restore session: ${e}`));
            });

            card.appendChild(info);
            card.appendChild(restoreBtn);
            sessionHistoryList.appendChild(card);
        }
    } catch (e) {
        sessionHistoryList.replaceChildren();
        const err = document.createElement("div");
        err.className = "tabby-session-empty";
        err.textContent = "Could not load session history.";
        sessionHistoryList.appendChild(err);
    }
}

async function restoreSession(session) {
    if (!session.tabs || session.tabs.length === 0) return;
    const urls = session.tabs.map(t => t.url).filter(Boolean);
    if (urls.length === 0) return;
    const newWindow = await browser.windows.create({ url: urls[0] });
    await Promise.all(
        urls.slice(1).map(url => browser.tabs.create({ windowId: newWindow.id, url, active: false }))
    );
    setStatus(`Restored ${urls.length} tab${urls.length === 1 ? "" : "s"} in a new window.`);
}

for (let btn of Object.values(detailModeButtons)) {
    btn.addEventListener("click", () => {
        setDetailMode(btn.dataset.mode).catch(error => {
            setStatus(`Failed to change card detail level: ${error}`);
        });
    });
}
for (let btn of Object.values(settingsDetailModeButtons)) {
    btn.addEventListener("click", () => {
        setDetailMode(btn.dataset.mode).catch(error => {
            setStatus(`Failed to change card detail level: ${error}`);
        });
    });
}
expandControlsButton.addEventListener("click", event => {
    event.stopPropagation();
    viewState.controlsExpanded = !viewState.controlsExpanded;
    syncDashboardChrome();
});

settingsStickyRow.input.addEventListener("change", event => {
    setStickyControls(event.target.checked).catch(error => {
        setStatus(`Failed to update sticky controls: ${error}`);
    });
});

settingsPinnedRow.input.addEventListener("change", event => {
    setKeepPinned(event.target.checked).catch(error => {
        setStatus(`Failed to update pinned Tabby behavior: ${error}`);
    });
});

recaptureButton.addEventListener("click", event => {
    event.stopPropagation();
    toggleRecaptureMenu();
});

recaptureAllButton.addEventListener("click", () => {
    recaptureVisiblePreviews().catch(error => {
        setStatus(`Failed to recapture previews: ${error}`);
    });
});

recaptureSelectedModeButton.addEventListener("click", () => {
    startRecaptureSelection();
});

selectionConfirmButton.addEventListener("click", () => {
    recaptureSelectedPreviews().catch(error => {
        setStatus(`Failed to recapture selected previews: ${error}`);
    });
});

selectionCancelButton.addEventListener("click", () => {
    cancelRecaptureSelection();
});

resetFiltersButton.addEventListener("click", () => {
    viewState.search = "";
    viewState.statusFilter = "all";
    viewState.domainFilter = "all";
    viewState.sortMode = "browser";
    searchInput.value = "";
    statusFilter.value = "all";
    domainFilter.value = "all";
    sortSelect.value = "browser";
    renderVisibleTabs();
});

settingsButton.addEventListener("click", event => {
    event.stopPropagation();
    viewState.settingsOpen = !viewState.settingsOpen;
    viewState.recaptureMenuOpen = false;
    syncDashboardChrome();
    if (viewState.settingsOpen) {
        renderSessionHistory().catch(() => {});
    }
});

settingsCloseButton.addEventListener("click", () => {
    closeMenus();
});

settingsScrim.addEventListener("click", () => {
    closeMenus();
});

bookmarkFolderSelect.addEventListener("change", () => {
    const hasValue = !!bookmarkFolderSelect.value;
    openRandomButton.disabled = !hasValue;
    openRandomButton.classList.toggle("-disabled", !hasValue);
});

openRandomButton.addEventListener("click", () => {
    openRandomBookmarks().catch(e => setStatus(`Failed to open random bookmarks: ${e}`));
});

settingsAutosaveRow.input.addEventListener("change", event => {
    const enabled = event.target.checked;
    browser.storage.local.set({ [SESSION_AUTOSAVE_KEY]: enabled })
        .then(() => browser.runtime.sendMessage({ _: "sessions:setAutosave", enabled }))
        .catch(e => setStatus(`Failed to save autosave setting: ${e}`));
});

searchInput.addEventListener("input", event => {
    viewState.search = event.target.value;
    renderVisibleTabs();
});

statusFilter.addEventListener("change", event => {
    viewState.statusFilter = event.target.value;
    renderVisibleTabs();
});

domainFilter.addEventListener("change", event => {
    viewState.domainFilter = event.target.value;
    renderVisibleTabs();
});

sortSelect.addEventListener("change", event => {
    viewState.sortMode = event.target.value;
    renderVisibleTabs();
});

document.addEventListener("click", event => {
    if (!heroActions.contains(event.target)) {
        viewState.recaptureMenuOpen = false;
        syncDashboardChrome();
    }
});

window.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        if (selectionState.active) {
            cancelRecaptureSelection();
            return;
        }
        closeMenus();
    }
});

let _rerenderTimeout = null;
let _isRendering = false;
let _pendingRerender = false;

const rerender = () => {
    if (_rerenderTimeout) clearTimeout(_rerenderTimeout);
    _rerenderTimeout = setTimeout(async () => {
        _rerenderTimeout = null;
        if (_isRendering) {
            _pendingRerender = true;
            return;
        }
        _isRendering = true;
        try {
            await renderTabs();
        } catch (error) {
            setStatus(`Failed to load tabs: ${error}`);
        } finally {
            _isRendering = false;
            if (_pendingRerender) {
                _pendingRerender = false;
                rerender();
            }
        }
    }, 200);
};

const onBookmarkChanged = () => {
    clearBookmarkCache();
    rerender();
};

browser.tabs.onActivated.addListener(rerender);
browser.tabs.onAttached.addListener(rerender);
browser.tabs.onCreated.addListener(rerender);
browser.tabs.onDetached.addListener(rerender);
browser.tabs.onMoved.addListener(rerender);
browser.tabs.onRemoved.addListener(tabId => {
    delete previewCache[tabId];
    delete tabMeta[tabId];
    delete bookmarkState[tabId];
    selectionState.tabIds.delete(tabId);
    if (renderedTabIds.includes(tabId)) {
        rerender();
    }
});
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (renderedTabIds.includes(tabId) && (changeInfo.status || changeInfo.title || changeInfo.url || changeInfo.favIconUrl || Object.prototype.hasOwnProperty.call(changeInfo, "discarded"))) {
        rerender();
    }
});
if (browser.bookmarks?.onCreated) {
    browser.bookmarks.onCreated.addListener(onBookmarkChanged);
    browser.bookmarks.onRemoved.addListener(onBookmarkChanged);
    browser.bookmarks.onChanged.addListener(onBookmarkChanged);
}
window.addEventListener("focus", rerender);

async function initializeDashboard() {
    await loadDashboardSettings();
    syncDashboardChrome();
    if (viewState.keepPinned) {
        await ensurePinnedDashboard();
    }
    await Promise.all([renderTabs(), loadBookmarkBarFolders()]);
}

initializeDashboard().catch(error => {
    setStatus(`Failed to load tabs: ${error}`);
});