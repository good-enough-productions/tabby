/**
 * Rules and Utilities for Tabby Bookmark Management
 */

export const CORE_FOLDERS = ["S tier", "New", "Previous", "Repeat", "Revisit", "Next"];
const DATE_PATTERN = /^[0-9.]+$/;

export function isCoreFolder(name) {
    if (!name) return false;
    const clean = name.trim().toLowerCase();
    return CORE_FOLDERS.some(c => c.toLowerCase() === clean);
}

export function getCoreFolderPriority(name) {
    if (!name) return 999;
    const clean = name.trim().toLowerCase();
    const index = CORE_FOLDERS.findIndex(c => c.toLowerCase() === clean);
    return index !== -1 ? index : 999;
}

export function isDateString(text) {
    if (!text) return false;
    const clean = text.trim();
    return clean.length > 0 && DATE_PATTERN.test(clean);
}

export function categorizeFolderOrBookmark(folderName, title) {
    if (isCoreFolder(folderName)) {
        return "core";
    }
    if (isDateString(folderName)) {
        return "date";
    }
    return "other";
}

export function normalizeUrlForGrouping(urlStr) {
    if (!urlStr) return "";
    try {
        const u = new URL(urlStr.trim());
        u.hash = "";
        u.searchParams.delete("utm_source");
        u.searchParams.delete("utm_medium");
        u.searchParams.delete("utm_campaign");
        if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
            u.pathname = u.pathname.slice(0, -1);
        }
        return u.toString().toLowerCase();
    } catch (e) {
        return String(urlStr).trim().toLowerCase().replace(/\/+$/, "");
    }
}

export async function findOrCreateFolder(folderName) {
    if (!browser.bookmarks?.getTree) return null;
    const tree = await browser.bookmarks.getTree();
    
    let targetFolder = null;

    function searchTree(nodes) {
        for (const node of nodes) {
            if (!node.url && node.title && node.title.trim().toLowerCase() === folderName.trim().toLowerCase()) {
                targetFolder = node;
                return;
            }
            if (node.children) {
                searchTree(node.children);
                if (targetFolder) return;
            }
        }
    }

    searchTree(tree);

    if (targetFolder) {
        return targetFolder.id;
    }

    const parentId = (tree[0]?.children?.[0]?.id) || tree[0]?.id || "1";
    const newFolder = await browser.bookmarks.create({
        parentId,
        title: folderName
    });
    return newFolder.id;
}

export async function getBookmarkParentTitles(bookmarks) {
    const parentMap = {};
    if (!bookmarks || bookmarks.length === 0) return parentMap;
    
    const parentIds = Array.from(new Set(bookmarks.map(b => b.parentId).filter(Boolean)));
    const parentCache = {};

    await Promise.all(parentIds.map(async pid => {
        try {
            const parents = await browser.bookmarks.get(pid);
            if (parents && parents[0]) {
                parentCache[pid] = parents[0].title || "";
            }
        } catch (e) {
            parentCache[pid] = "";
        }
    }));

    for (const b of bookmarks) {
        parentMap[b.id] = parentCache[b.parentId] || "";
    }
    return parentMap;
}

export async function ensureUrlBookmarkedAsNextOnlyIfUnbookmarked(url, title = "") {
    if (!browser.bookmarks?.search || !url) return false;
    const existing = await browser.bookmarks.search({ url });
    if (existing && existing.length > 0) {
        // Already bookmarked somewhere in the browser. Do not duplicate into Next.
        return false;
    }

    const nextFolderId = await findOrCreateFolder("Next");
    if (!nextFolderId) return false;

    await browser.bookmarks.create({
        parentId: nextFolderId,
        title: title || url,
        url
    });
    return true;
}

export async function ensureUrlBookmarkedAsNext(url, title = "") {
    return ensureUrlBookmarkedAsNextOnlyIfUnbookmarked(url, title);
}

export async function removeNextBookmark(url) {
    if (!browser.bookmarks?.getTree || !url) return false;
    const tree = await browser.bookmarks.getTree();
    
    function cleanUrl(u) {
        try {
            const parsed = new URL(u);
            parsed.hash = '';
            parsed.searchParams.delete('t');
            return parsed.toString();
        } catch(e) {
            return String(u).split('#')[0];
        }
    }
    
    const targetClean = cleanUrl(url);
    let removedCount = 0;
    
    function searchAndRemove(nodes, inNext = false) {
        for (const node of nodes) {
            const isNext = inNext || (node.title?.trim().toLowerCase() === "next");
            
            if (node.url && isNext) {
                const nodeClean = cleanUrl(node.url);
                
                let isMatch = false;
                if (nodeClean === targetClean || targetClean.startsWith(nodeClean) || nodeClean.startsWith(targetClean)) {
                    isMatch = true;
                } else {
                    try {
                        const nU = new URL(node.url);
                        const tU = new URL(url);
                        if (nU.hostname === tU.hostname && nU.pathname === tU.pathname) {
                            isMatch = true;
                        }
                    } catch(e) {}
                }
                
                if (isMatch) {
                    browser.bookmarks.remove(node.id).catch(() => {});
                    removedCount++;
                }
            }
            if (node.children) {
                searchAndRemove(node.children, isNext);
            }
        }
    }
    
    searchAndRemove(tree);
    return removedCount > 0;
}

export async function scanAndAnalyzeDuplicates() {
    if (!browser.bookmarks?.getTree) {
        return { groups: [], totalBookmarks: 0, totalViolations: 0 };
    }

    const tree = await browser.bookmarks.getTree();
    const allBookmarks = [];

    function flatten(nodes, ancestors = []) {
        for (const node of nodes) {
            if (node.url) {
                const directParent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : "";
                let categoryParentTitle = directParent;
                for (let i = ancestors.length - 1; i >= 0; i--) {
                    if (isCoreFolder(ancestors[i]) || isDateString(ancestors[i])) {
                        categoryParentTitle = ancestors[i];
                        break;
                    }
                }
                allBookmarks.push({
                    id: node.id,
                    url: node.url,
                    title: node.title || node.url,
                    parentId: node.parentId,
                    parentTitle: directParent,
                    categoryParentTitle,
                    dateAdded: node.dateAdded || 0
                });
            }
            if (node.children) {
                const nextAncestors = node.title ? [...ancestors, node.title] : ancestors;
                flatten(node.children, nextAncestors);
            }
        }
    }

    flatten(tree);

    const urlGroups = {};
    for (const b of allBookmarks) {
        const normUrl = normalizeUrlForGrouping(b.url);
        if (!urlGroups[normUrl]) {
            urlGroups[normUrl] = [];
        }
        urlGroups[normUrl].push(b);
    }

    const flaggedGroups = [];
    let totalViolations = 0;

    for (const [normUrl, list] of Object.entries(urlGroups)) {
        if (list.length < 2) continue;

        let coreCount = 0;
        let dateCount = 0;
        let otherCount = 0;

        const coreItems = [];
        const dateItems = [];
        const otherItems = [];

        for (const item of list) {
            const cat = categorizeFolderOrBookmark(item.categoryParentTitle, item.title);
            item.category = cat;
            if (cat === "core") {
                coreCount++;
                coreItems.push(item);
            } else if (cat === "date") {
                dateCount++;
                dateItems.push(item);
            } else {
                otherCount++;
                otherItems.push(item);
            }
        }

        coreItems.sort((a, b) => {
            const prioA = getCoreFolderPriority(a.categoryParentTitle);
            const priob = getCoreFolderPriority(b.categoryParentTitle);
            if (prioA !== priob) return prioA - priob; // Lower index = higher priority
            return (b.dateAdded || 0) - (a.dateAdded || 0); // Newest date tie breaker
        });

        dateItems.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
        otherItems.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));

        let deleteCount = 0;
        const annotatedBookmarks = [];

        // 1. Process Core items: keep max 1 highest priority Core item
        let keptCore = false;
        for (const item of coreItems) {
            if (!keptCore) {
                keptCore = true;
                item.willKeep = true;
            } else {
                item.willKeep = false;
                deleteCount++;
            }
            annotatedBookmarks.push(item);
        }

        // 2. Process Date items: keep max 1 newest Date item
        let keptDate = false;
        for (const item of dateItems) {
            if (!keptDate) {
                keptDate = true;
                item.willKeep = true;
            } else {
                item.willKeep = false;
                deleteCount++;
            }
            annotatedBookmarks.push(item);
        }

        // 3. Process General items: General items in regular user folders are preserved.
        // Deduplicate only if there are duplicate General bookmarks in the same folder or exact redundant copies.
        const seenGeneralFolders = new Set();
        for (const item of otherItems) {
            const folderKey = item.parentId || item.parentTitle || "root";
            if (!seenGeneralFolders.has(folderKey)) {
                seenGeneralFolders.add(folderKey);
                item.willKeep = true;
            } else {
                item.willKeep = false;
                deleteCount++;
            }
            annotatedBookmarks.push(item);
        }

        // Safety Guarantee: Ensure at least one bookmark in the group has willKeep = true
        if (!annotatedBookmarks.some(b => b.willKeep === true)) {
            if (annotatedBookmarks.length > 0) {
                annotatedBookmarks[0].willKeep = true;
                deleteCount = Math.max(0, deleteCount - 1);
            }
        }

        // Sort output list so kept items appear first
        annotatedBookmarks.sort((a, b) => (b.willKeep ? 1 : 0) - (a.willKeep ? 1 : 0));

        if (deleteCount > 0) {
            totalViolations += deleteCount;

            let domain = "other";
            try {
                domain = new URL(list[0].url).hostname.replace(/^www\./, "");
            } catch (e) {
                domain = "other";
            }

            const dates = list.map(b => b.dateAdded || 0).filter(Boolean);
            const maxDateAdded = dates.length ? Math.max(...dates) : 0;
            const minDateAdded = dates.length ? Math.min(...dates) : 0;
            const folders = Array.from(new Set(list.map(b => b.parentTitle || "Root"))).filter(Boolean);

            flaggedGroups.push({
                id: `group_${flaggedGroups.length + 1}_${Date.now()}`,
                url: normUrl,
                displayUrl: list[0].url,
                displayTitle: list[0].title,
                domain,
                maxDateAdded,
                minDateAdded,
                folders,
                totalCopies: list.length,
                bookmarks: annotatedBookmarks,
                coreCount,
                dateCount,
                otherCount,
                deleteCount,
                hasCoreViolation: coreCount > 1,
                hasDateViolation: dateCount > 1,
                hasMax2Violation: (coreCount + dateCount + otherCount) > 2
            });
        }
    }

    return {
        groups: flaggedGroups,
        totalBookmarks: allBookmarks.length,
        totalViolations
    };
}

export async function smartCleanBookmarks(groupsToClean = null) {
    if (!browser.bookmarks?.remove) return 0;

    let groups = groupsToClean;
    if (!groups) {
        const analysis = await scanAndAnalyzeDuplicates();
        groups = analysis.groups;
    }

    let deletedCount = 0;
    const itemsToDelete = [];

    for (const group of groups) {
        // Safety Guarantee: Never delete all bookmarks of a URL group!
        const remainingToKeep = group.bookmarks.filter(b => b.willKeep !== false && !b.deleted);
        if (remainingToKeep.length === 0 && group.bookmarks.length > 0) {
            // Force keep the first (highest priority / newest) non-deleted bookmark
            const fallbackItem = group.bookmarks.find(b => !b.deleted) || group.bookmarks[0];
            fallbackItem.willKeep = true;
        }

        for (const item of group.bookmarks) {
            if (item.willKeep === false && !item.deleted) {
                itemsToDelete.push(item);
            }
        }
    }

    // Process deletions in parallel batches of 5
    const batchSize = 5;
    for (let i = 0; i < itemsToDelete.length; i += batchSize) {
        const batch = itemsToDelete.slice(i, i + batchSize);
        await Promise.all(batch.map(async item => {
            try {
                await browser.bookmarks.remove(item.id);
                deletedCount++;
                item.deleted = true;
            } catch (e) {
                console.error("Failed to delete bookmark:", item.id, e);
            }
        }));
    }

    return deletedCount;
}
