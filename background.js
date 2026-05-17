// Service Worker - 后台脚本

const mediaCache = new Map();

chrome.runtime.onInstalled.addListener((details) => {
  console.log("觅源 SourceSeek 已安装", details);
});

// 非视频 CDN 域名黑名单
const BLOCKED_HOSTS = ["data.bilibili.com", "hm.baidu.com", "log.bilibili.com"];

// Site-specific CDN patterns for media detection
const SITE_MEDIA_PATTERNS = [
  // Instagram CDN images & videos
  { host: ["cdninstagram.com", "fbcdn.net"], pathPattern: /\/v\/t\d+\.\d+-\d+\//, queryFormat: true, type: "image" },
  { host: ["cdninstagram.com", "fbcdn.net"], pathPattern: /\/v\/t\d+\.\d+-\d+\/.*\.mp4/, type: "video", category: "video" },
  // X/Twitter image CDN (twimg.com with ?format=)
  { host: ["twimg.com", "pbs.twimg.com"], queryFormat: true, type: "image" },
  // X/Twitter video CDN
  { host: ["video.twimg.com", "pbs.twimg.com"], pathPattern: /\.mp4(?=[^a-z0-9]|$)/i, type: "video", category: "video" },
  // YouTube video playback - these are byte-range fragments, skip them
  // (content.js extracts the full direct URLs from ytInitialPlayerResponse instead)
];

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

    // Check site-specific patterns first
    for (const sp of SITE_MEDIA_PATTERNS) {
      const hostMatch = sp.host.some((h) => host.includes(h));
      if (!hostMatch) continue;

      if (sp.pathPattern && !sp.pathPattern.test(pathname) && !sp.pathPattern.test(url)) continue;

      if (sp.queryFormat) {
        // Check for format= query param (X/Twitter style)
        try {
          const format = new URL(url).searchParams.get("format");
          if (format) {
            const f = format.toLowerCase();
            if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif", "tiff"].includes(f)) {
              type = "image";
              category = "image";
              break;
            }
            if (["mp4", "webm", "mov", "flv"].includes(f)) {
              type = "video";
              category = sp.category || "video";
              break;
            }
          }
        } catch {}
        // For Instagram CDN URLs without format param, check path for image indicators
        if (!type && (host.includes("cdninstagram.com") || host.includes("fbcdn.net"))) {
          // Instagram image URLs typically contain /t51.2885-15/ or similar, not .mp4
          if (!pathname.includes(".mp4") && !pathname.includes(".webm")) {
            // Check if it looks like a large image (not a tiny profile pic)
            try {
              const u = new URL(url);
              const stp = u.searchParams.get("stp") || "";
              const oh = u.searchParams.get("oh") || "";
              if (oh || stp || pathname.includes("/t51.") || pathname.includes("/t50.")) {
                type = "image";
                category = "image";
                break;
              }
            } catch {}
          }
        }
        // If no format detected, skip this pattern and continue
        continue;
      }

      type = sp.type;
      category = sp.category || null;
      break;
    }

    // Generic pattern matching (original logic)
    if (!type) {
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
      }
      // Note: /videoplayback (YouTube) is NOT captured here because those are
      // byte-range fragments, not complete videos. The content script extracts
      // the full direct URLs from ytInitialPlayerResponse instead.
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

  if (message.action === "getAllResources") {
    const pageUrl = message.pageUrl;
    const resources = mediaCache.get(pageUrl) || [];
    sendResponse({ resources });
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

      // Site-specific headers
      const urlHost = url.toLowerCase();
      if (urlHost.includes("cdninstagram.com") || urlHost.includes("fbcdn.net")) {
        // Determine correct Referer based on page origin
        try {
          const pageUrl = message.referer || "";
          if (pageUrl.includes("threads.net") || pageUrl.includes("threads.com")) {
            headers["Referer"] = "https://www.threads.net/";
            headers["Origin"] = "https://www.threads.net";
          } else {
            headers["Referer"] = "https://www.instagram.com/";
            headers["Origin"] = "https://www.instagram.com";
          }
        } catch {
          headers["Referer"] = "https://www.instagram.com/";
          headers["Origin"] = "https://www.instagram.com";
        }
      } else if (urlHost.includes("twimg.com")) {
        headers["Referer"] = "https://x.com/";
        headers["Origin"] = "https://x.com";
      } else if (urlHost.includes("googlevideo.com")) {
        headers["Referer"] = "https://www.youtube.com/";
        headers["Origin"] = "https://www.youtube.com";
      }

      fetch(url, { headers, redirect: "follow" })
        .then((resp) => {
          if (!resp.ok) throw new Error("HTTP " + resp.status);
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
