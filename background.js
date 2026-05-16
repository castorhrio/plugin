// Service Worker - 后台脚本

// 缓存检测到的媒体资源，按页面 URL 分组
const mediaCache = new Map();

// 插件安装时触发
chrome.runtime.onInstalled.addListener((details) => {
  console.log("Media Sniffer 已安装", details);
});

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "mediaDetected" && message.resources) {
    const pageUrl = message.pageUrl || sender.url;
    
    if (!mediaCache.has(pageUrl)) {
      mediaCache.set(pageUrl, []);
    }
    
    const existing = mediaCache.get(pageUrl);
    const existingUrls = new Set(existing.map((r) => r.url));
    
    message.resources.forEach((resource) => {
      if (!existingUrls.has(resource.url)) {
        existing.push(resource);
      }
    });
    
    console.log(`检测到 ${message.resources.length} 个资源，当前页面共 ${existing.length} 个资源`);
    
    // 更新插件图标徽章显示资源数量
    chrome.action.setBadgeText({
      text: existing.length.toString(),
      tabId: sender.tab?.id,
    });
    chrome.action.setBadgeBackgroundColor({
      color: "#e94560",
      tabId: sender.tab?.id,
    });
  }
});

// 标签页更新时清除缓存
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url) {
    mediaCache.delete(tab.url);
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

// 标签页关闭时清除缓存
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [url] of mediaCache) {
    try {
      const tabUrl = new URL(url);
      // 简单清理，实际应用中可能需要更复杂的匹配
    } catch {}
  }
});
