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

export function isDateString(text) {
    if (!text) return false;
    const clean = text.trim();
    return clean.length > 0 && DATE_PATTERN.test(clean);
}

export function categorizeFolderOrBookmark(folderName, title) {
    if (isCoreFolder(folderName) || isCoreFolder(title)) {
        return "core";
    }
    if (isDateString(folderName) || isDateString(title)) {
        return "date";
    }
    return "other";
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
    for (const b of bookmarks) {
        if (b.parentId) {
            try {
                const parents = await browser.bookmarks.get(b.parentId);
                if (parents && parents[0]) {
                    parentMap[b.id] = parents[0].title || "";
                }
            } catch (e) {
                parentMap[b.id] = "";
            }
        } else {
            parentMap[b.id] = "";
        }
    }
    return parentMap;
}

export async function ensureUrlBookmarkedAsNext(url, title = "") {
    if (!browser.bookmarks?.search || !url) return false;
    const existing = await browser.bookmarks.search({ url });
    const parentMap = await getBookmarkParentTitles(existing);

    let alreadyInNext = false;
    const extraCoreBookmarkIds = [];

    for (const b of existing) {
        const parentTitle = parentMap[b.id] || "";
        const cat = categorizeFolderOrBookmark(parentTitle, b.title);
        if (parentTitle.trim().toLowerCase() === "next") {
            alreadyInNext = true;
        } else if (cat === "core") {
            extraCoreBookmarkIds.push(b.id);
        }
    }

    if (alreadyInNext) {
        for (const id of extraCoreBookmarkIds) {
            await browser.bookmarks.remove(id).catch(() => {});
        }
        return true;
    }

    const nextFolderId = await findOrCreateFolder("Next");
    if (!nextFolderId) return false;

    await browser.bookmarks.create({
        parentId: nextFolderId,
        title: title || url,
        url
    });

    for (const id of extraCoreBookmarkIds) {
        await browser.bookmarks.remove(id).catch(() => {});
    }

    return true;
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

    function flatten(nodes, parentTitle = "") {
        for (const node of nodes) {
            if (node.url) {
                allBookmarks.push({
                    id: node.id,
                    url: node.url,
                    title: node.title || node.url,
                    parentId: node.parentId,
                    parentTitle,
                    dateAdded: node.dateAdded || 0
                });
            }
            if (node.children) {
                flatten(node.children, node.title || parentTitle);
            }
        }
    }

    flatten(tree);

    const urlGroups = {};
    for (const b of allBookmarks) {
        const normUrl = b.url.trim().toLowerCase();
        if (!urlGroups[normUrl]) {
            urlGroups[normUrl] = [];
        }
        urlGroups[normUrl].push(b);
    }

    const flaggedGroups = [];
    let totalViolations = 0;

    for (const [url, list] of Object.entries(urlGroups)) {
        if (list.length < 2) continue;

        let coreCount = 0;
        let dateCount = 0;

        for (const item of list) {
            const cat = categorizeFolderOrBookmark(item.parentTitle, item.title);
            if (cat === "core") coreCount++;
            if (cat === "date") dateCount++;
        }

        const isExactDuplicate = list.length > 1;
        const hasCoreViolation = coreCount > 1;
        const hasDateViolation = dateCount > 1;
        const hasMax2Violation = (coreCount + dateCount) > 2 || list.length > 2;

        if (isExactDuplicate || hasCoreViolation || hasDateViolation || hasMax2Violation) {
            totalViolations++;
            flaggedGroups.push({
                url,
                displayUrl: list[0].url,
                displayTitle: list[0].title,
                bookmarks: list,
                coreCount,
                dateCount,
                isExactDuplicate,
                hasCoreViolation,
                hasDateViolation,
                hasMax2Violation
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

    for (const group of groups) {
        const list = [...group.bookmarks].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));

        let keptCore = false;
        let keptDate = false;
        let keptGeneral = false;

        for (const item of list) {
            const cat = categorizeFolderOrBookmark(item.parentTitle, item.title);

            let keepThis = false;
            if (cat === "core" && !keptCore) {
                keptCore = true;
                keepThis = true;
            } else if (cat === "date" && !keptDate) {
                keptDate = true;
                keepThis = true;
            } else if (cat === "other" && !keptGeneral && (!keptCore || !keptDate)) {
                keptGeneral = true;
                keepThis = true;
            }

            if (!keepThis) {
                try {
                    await browser.bookmarks.remove(item.id);
                    deletedCount++;
                } catch (e) {
                    console.error("Failed to delete bookmark:", item.id, e);
                }
            }
        }
    }

    return deletedCount;
}
