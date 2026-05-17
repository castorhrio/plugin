// Service Worker - 后台脚本

const mediaCache = new Map();

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Media Sniffer 已安装", details);
});

// 非视频 CDN 域名黑名单
const BLOCKED_HOSTS = ["data.bilibili.com", "hm.baidu.com", "log.bilibili.com"];

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;

    // 只检查 URL 路径部分（排除查询参数中的误匹配）
    const pathname = url.split("?")[0].toLowerCase();
    const host = details.url.toLowerCase().split("/")[2] || "";

    // 域名黑名单
    if (BLOCKED_HOSTS.some((h) => host.includes(h))) return;

    // 图片反检查优先
    if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif|tiff)(@|$)/i.test(pathname)) return;

    let type = null;
    let category = null;

    if (pathname.includes(".m3u8")) {
      type = "video";
      category = "manifest";
    } else if (pathname.includes(".mpd")) {
      type = "video";
      category = "dash";
    } else if (pathname.includes(".m4s")) {
      type = "video";
      category = "m4s-segment";
    } else if (/\/[^/]+\.ts([?#]|$)/i.test(url)) {
      type = "video";
      category = "ts-segment";
    } else if (pathname.includes(".mp4") || /\.(webm|mov|flv)(?=[^a-z0-9]|$)/i.test(pathname)) {
      type = "video";
      category = "video";
    } else if (pathname.includes("/videoplayback")) {
      type = "video";
      category = "video";
    }

    if (type && details.tabId > 0) {
      chrome.tabs.get(details.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab.url) return;

        const pageUrl = tab.url;
        if (!mediaCache.has(pageUrl)) mediaCache.set(pageUrl, []);

        const existing = mediaCache.get(pageUrl);
        const exists = existing.some((r) => r.url === url);
        if (!exists) {
          existing.push({ url, type, source: "network", category });
        } else if (category) {
          // 如果新资源带有 category 而已有资源没有，替换之
          const idx = existing.findIndex((r) => r.url === url);
          if (idx >= 0 && !existing[idx].category) existing[idx] = { url, type, source: "network", category };
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
      if (!existingUrls.has(resource.url)) {
        existing.push(resource);
      } else if (resource.category) {
        const idx = existing.findIndex((r) => r.url === resource.url);
        if (idx >= 0 && !existing[idx].category) existing[idx] = resource;
      }
    });

    chrome.action.setBadgeText({ text: existing.length.toString(), tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: "#e94560", tabId: sender.tab?.id });
  }

  if (message.action === "getVideoResources") {
    const pageUrl = message.pageUrl;
    const videos = mediaCache.get(pageUrl)?.filter((r) => r.type === "video") || [];
    sendResponse({ videos });
    return true;
  }

  if (message.action === "proxyFetch") {
    const url = message.url;
    const referer = message.referer || url;

    chrome.cookies.getAll({ url }, (cookies) => {
      const cookieHeader = cookies.map((c) => c.name + "=" + c.value).join("; ");

      const headers = {
        "Referer": referer,
        "Origin": new URL(referer).origin,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      };
      if (cookieHeader) headers["Cookie"] = cookieHeader;

      fetch(url, { headers, redirect: "follow" })
        .then((resp) => {
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          const ct = resp.headers.get("content-type") || "";
          if (ct.includes("text/html")) throw new Error("返回 HTML 非 media");
          return resp.arrayBuffer();
        })
        .then((buffer) => {
          if (!buffer || buffer.byteLength === 0) {
            sendResponse({ success: false, error: "空响应 (0 bytes)" });
            return;
          }
          sendResponse({ success: true, data: arrayBufferToBase64(buffer), size: buffer.byteLength });
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
    });

    return true;
  }
});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url) {
    mediaCache.delete(tab.url);
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {});
