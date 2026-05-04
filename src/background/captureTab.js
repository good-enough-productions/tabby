/**
 * Capture and cache static tab preview screenshots for the new-tab page.
 */

import "Polyfill";
import { TTabActions } from "../tapi/taction";

let _captureTabAbortController;
let _previewCache = {};
let _previewCacheLoadPromise;
let _tabMeta = {};
let _tabMetaLoadPromise;

const PREVIEW_CACHE_KEY = "tabby-newtab-preview-cache-v1";
const TAB_META_KEY = "tabby-newtab-tab-meta-v1";
const NEWTAB_URL = browser.runtime.getURL("newtab/newtab.html");

const PREVIEW_QUALITY = {
    format: "jpeg",
    quality: 50,
    scale: 0.2
};

class AbortError extends Error {  }

async function ensurePreviewCacheLoaded() {
    if (!_previewCacheLoadPromise) {
        _previewCacheLoadPromise = browser.storage.local.get(PREVIEW_CACHE_KEY).then(result => {
            _previewCache = result[PREVIEW_CACHE_KEY] || {};
        });
    }
    await _previewCacheLoadPromise;
}

async function persistPreviewCache() {
    await browser.storage.local.set({
        [PREVIEW_CACHE_KEY]: _previewCache
    });
}

async function ensureTabMetaLoaded() {
    if (!_tabMetaLoadPromise) {
        _tabMetaLoadPromise = browser.storage.local.get(TAB_META_KEY).then(result => {
            _tabMeta = result[TAB_META_KEY] || {};
        });
    }
    await _tabMetaLoadPromise;
}

async function persistTabMeta() {
    await browser.storage.local.set({
        [TAB_META_KEY]: _tabMeta
    });
}

async function seedTabMetaForOpenTabs() {
    await ensureTabMetaLoaded();
    let tabs = await browser.tabs.query({});
    let updated = false;
    let now = Date.now();
    for (let tab of tabs) {
        if (!_tabMeta[tab.id]) {
            _tabMeta[tab.id] = {
                firstSeenAt: now,
                lastActivatedAt: tab.active ? now : undefined
            };
            updated = true;
        }
    }
    if (updated) {
        await persistTabMeta();
    }
}

async function getTabMeta(tabIds) {
    await seedTabMetaForOpenTabs();
    let keys = tabIds ? tabIds.map(id => id.toString()) : Object.keys(_tabMeta);
    let tabMeta = {};
    for (let key of keys) {
        if (_tabMeta[key]) {
            tabMeta[key] = _tabMeta[key];
        }
    }
    return tabMeta;
}

async function updateTabMeta(tabId, updater) {
    await ensureTabMetaLoaded();
    let current = _tabMeta[tabId] || {
        firstSeenAt: Date.now()
    };
    _tabMeta[tabId] = updater(current) || current;
    await persistTabMeta();
    return _tabMeta[tabId];
}

async function ensurePinnedDashboard(windowId, tabId) {
    let tabs = await browser.tabs.query({ windowId });
    let dashboardTabs = tabs.filter(tab => (tab.url || "").startsWith(NEWTAB_URL));
    let pinnedDashboard = dashboardTabs.find(tab => tab.id !== tabId && tab.pinned);

    if (pinnedDashboard) {
        await browser.tabs.update(pinnedDashboard.id, { active: true });
        await browser.windows.update(windowId, { focused: true });
        await browser.tabs.remove(tabId);
        return {
            status: "redirected",
            tabId: pinnedDashboard.id
        };
    }

    let currentDashboard = dashboardTabs.find(tab => tab.id === tabId);
    if (!currentDashboard) {
        return {
            status: "ignored",
            tabId
        };
    }

    if (!currentDashboard.pinned) {
        await browser.tabs.update(tabId, { pinned: true });
    }
    await browser.tabs.move(tabId, { index: 0 }).catch(() => undefined);
    return {
        status: "pinned",
        tabId
    };
}

async function captureTab(tabId, quality) {
    if (_captureTabAbortController) {
        _captureTabAbortController.abort();
    }
    _captureTabAbortController = new AbortController();
    const signal = _captureTabAbortController.signal;
    try {
        let dataURI = await new TTabActions(tabId).captureTab(signal, quality);
        if (dataURI) {
            return dataURI;
        } else {
            return undefined;
        }
    } catch (e) { throw new AbortError("captureTab aborted"); }
}

async function refreshPreviewCache(tabId, quality=PREVIEW_QUALITY, force=false) {
    await ensurePreviewCacheLoaded();
    try {
        let tab = await browser.tabs.get(tabId);
        if (tab.discarded) {
            return _previewCache[tabId];
        }
        if (!force && _previewCache[tabId]?.src) {
            return _previewCache[tabId];
        }
        let dataURI = await captureTab(tabId, quality);
        if (dataURI) {
            _previewCache[tabId] = {
                src: dataURI,
                tabId,
                updatedAt: Date.now()
            };
            await persistPreviewCache();
        }
        return _previewCache[tabId];
    } catch (e) {
        return _previewCache[tabId];
    }
}

async function ensurePreviewCacheForTabs(tabIds, quality=PREVIEW_QUALITY, force=false) {
    await ensurePreviewCacheLoaded();
    let previews = {};
    for (let tabId of tabIds) {
        let preview = await refreshPreviewCache(tabId, quality, force);
        if (preview) {
            previews[tabId] = preview;
        }
    }
    return previews;
}

async function getPreviewCache(tabIds) {
    await ensurePreviewCacheLoaded();
    let keys = tabIds ? tabIds.map(id => id.toString()) : Object.keys(_previewCache);
    let previews = {};
    for (let key of keys) {
        if (_previewCache[key]) {
            previews[key] = _previewCache[key];
        }
    }
    return previews;
}

browser.runtime.onMessage.addListener(message => {
    if (message["_"] !== "captureTab") return;
    return captureTab(message["tabId"], message["quality"]);
});
browser.runtime.onMessage.addListener(message => {
    if (message["_"] !== "preview:getCached") return;
    return getPreviewCache(message["tabIds"]);
});
browser.runtime.onMessage.addListener(message => {
    if (message["_"] !== "preview:refresh") return;
    return refreshPreviewCache(message["tabId"], message["quality"], true);
});
browser.runtime.onMessage.addListener(message => {
    if (message["_"] !== "preview:ensureMany") return;
    return ensurePreviewCacheForTabs(message["tabIds"], message["quality"], message["force"]);
});
browser.runtime.onMessage.addListener(message => {
    if (message["_"] !== "tabs:getMeta") return;
    return getTabMeta(message["tabIds"]);
});
browser.runtime.onMessage.addListener((message, sender) => {
    if (message["_"] !== "dashboard:ensurePinned") return;
    if (!sender.tab?.id || !sender.tab.windowId) {
        return Promise.resolve({ status: "ignored" });
    }
    return ensurePinnedDashboard(sender.tab.windowId, sender.tab.id);
});

browser.tabs.onActivated.addListener(({ tabId }) => {
    updateTabMeta(tabId, current => ({
        ...current,
        lastActivatedAt: Date.now()
    }));
    refreshPreviewCache(tabId, PREVIEW_QUALITY, true);
});
browser.tabs.onCreated.addListener(tab => {
    updateTabMeta(tab.id, current => ({
        ...current,
        firstSeenAt: current.firstSeenAt || Date.now()
    }));
});
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.discarded) {
        delete _previewCache[tabId];
        persistPreviewCache();
        return;
    }
    if (changeInfo.status === "complete" && tab.active) {
        refreshPreviewCache(tabId, PREVIEW_QUALITY, true);
    }
});
browser.tabs.onRemoved.addListener(tabId => {
    delete _previewCache[tabId];
    delete _tabMeta[tabId];
    persistPreviewCache();
    persistTabMeta();
});

seedTabMetaForOpenTabs();
