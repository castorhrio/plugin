// Service Worker - 后台脚本

const mediaCache = new Map();

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Media Sniffer 已安装", details);
});

// 拦截网络请求，捕获流媒体资源
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const lower = url.toLowerCase();
    let type = null;

    if (lower.includes(".m3u8") || lower.includes(".mpd") || lower.includes("/master.m3u8") || lower.includes("/index.m3u8")) {
      type = "video";
    }

    if (type && details.tabId > 0) {
      chrome.tabs.get(details.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab.url) return;

        const pageUrl = tab.url;
        if (!mediaCache.has(pageUrl)) mediaCache.set(pageUrl, []);

        const existing = mediaCache.get(pageUrl);
        const exists = existing.some((r) => r.url === url);
        if (!exists) {
          const resource = { url, type, source: "network" };
          existing.push(resource);

          chrome.action.setBadgeText({ text: existing.length.toString(), tabId: details.tabId });
          chrome.action.setBadgeBackgroundColor({ color: "#e94560", tabId: details.tabId });
        }
      });
    }
  },
  { urls: ["<all_urls>"] },
  []
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "mediaDetected" && message.resources) {
    const pageUrl = message.pageUrl || sender.url;

    if (!mediaCache.has(pageUrl)) mediaCache.set(pageUrl, []);

    const existing = mediaCache.get(pageUrl);
    const existingUrls = new Set(existing.map((r) => r.url));

    message.resources.forEach((resource) => {
      if (!existingUrls.has(resource.url)) existing.push(resource);
    });

    chrome.action.setBadgeText({ text: existing.length.toString(), tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: "#e94560", tabId: sender.tab?.id });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url) {
    mediaCache.delete(tab.url);
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [url] of mediaCache) {
    try {
      const tabUrl = new URL(url);
    } catch {}
  }
});
