/**
 * Video Detector
 * Listens for HTML5 video playback to trigger auto-move of the Next bookmark to Repeat.
 */

export function initVideoDetector() {
    let watchTime = 0;
    let watchInterval = null;
    let hasTriggered = false;

    function triggerRemoval() {
        if (hasTriggered) return;
        hasTriggered = true;
        
        browser.runtime.sendMessage({
            _: "bookmark:moveToRepeat",
            url: window.location.href
        }).catch(() => {});
    }

    function startWatching() {
        if (hasTriggered) return;
        if (!watchInterval) {
            watchInterval = setInterval(() => {
                if (document.visibilityState === "visible") {
                    watchTime += 1;
                    if (watchTime >= 10) { // 10 seconds active tab viewing while playing
                        triggerRemoval();
                        stopWatching();
                    }
                }
            }, 1000);
        }
    }

    function stopWatching() {
        if (watchInterval) {
            clearInterval(watchInterval);
            watchInterval = null;
        }
    }

    // Attach to all current and future videos
    function attachToVideo(video) {
        if (video.dataset.tabbyWatched) return;
        video.dataset.tabbyWatched = "true";

        video.addEventListener("play", startWatching);
        video.addEventListener("playing", startWatching);
        video.addEventListener("pause", stopWatching);
        video.addEventListener("ended", stopWatching);

        // Fallback: If video is already playing > 3s
        video.addEventListener("timeupdate", () => {
            if (video.currentTime > 3 && !video.paused) {
                triggerRemoval();
            }
        });
    }

    const videos = document.querySelectorAll("video");
    videos.forEach(attachToVideo);

    const observer = new MutationObserver(mutations => {
        for (const mut of mutations) {
            for (const node of mut.addedNodes) {
                if (node.nodeName === "VIDEO") {
                    attachToVideo(node);
                } else if (node.querySelectorAll) {
                    const nested = node.querySelectorAll("video");
                    nested.forEach(attachToVideo);
                }
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}
