(function () {
  "use strict";

  const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif", "tiff"];
  const VIDEO_EXTS = ["mp4", "webm", "ogg", "ogv", "mov", "avi", "mkv", "flv", "wmv", "m4v", "3gp"];
  const AUDIO_EXTS = ["mp3", "wav", "ogg", "oga", "aac", "flac", "m4a", "wma", "opus"];
  const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS];

  function getType(url) {
    const lower = url.toLowerCase().split("?")[0];

    // 图片反检查：路径以图片扩展名结尾的绝不判为视频
    if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif|tiff)(@|$)/i.test(lower)) return "image";

    // 非视频域名黑名单
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.includes("data.bilibili.com") || host.includes("hm.baidu.com") || host.includes("log.")) return "unknown";
    } catch {}

    if (lower.includes(".m3u8") || lower.includes(".mpd") || lower.includes(".m4s")) return "video";
    if (lower.includes("/videoplayback")) return "video";
    if (/\/[^/]+\.ts([?#]|$)/i.test(url)) return "video";

    // 用点号+扩展名+非字母数字后缀 精确匹配，避免 .webmask 被 .webm 误匹配
    for (const ext of VIDEO_EXTS) {
      if (new RegExp("\\." + ext + "(?=[^a-z0-9]|$)", "i").test(lower)) return "video";
    }
    for (const ext of AUDIO_EXTS) {
      if (new RegExp("\\." + ext + "(?=[^a-z0-9]|$)", "i").test(lower)) return "audio";
    }
    for (const ext of IMAGE_EXTS) {
      if (new RegExp("\\." + ext + "(?=[^a-z0-9]|$)", "i").test(lower)) return "image";
    }
    return "unknown";
  }

  function isValidUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    try {
      new URL(url, window.location.origin);
      return true;
    } catch {
      return false;
    }
  }

  function resolveUrl(url) {
    try {
      return new URL(url, window.location.origin).href;
    } catch {
      return url;
    }
  }

  // 图片去重：截断 CDN 缩略图参数（如 @120w_120h_1c），保留完整查询参数
  // 视频/音频：完整保留 URL 不做截断（认证参数不能丢）
  function extractBaseUrl(url, type) {
    if (type === "video" || type === "audio") return url;

    try {
      const u = new URL(url);
      let pathname = u.pathname;
      const hashIndex = pathname.indexOf("#");
      if (hashIndex !== -1) pathname = pathname.substring(0, hashIndex);

      // 清理 CDN 缩略图后缀
      const cdnMatch = pathname.match(/^(.+?\.(jpg|jpeg|png|gif|webp|bmp|avif|tiff))(@[\w_]+)$/i);
      if (cdnMatch) {
        pathname = cdnMatch[1];
      }

      const lower = pathname.toLowerCase();
      let bestMatch = null;
      let bestIndex = Infinity;

      for (const ext of ALL_EXTS) {
        const idx = lower.indexOf("." + ext);
        if (idx !== -1 && idx < bestIndex) {
          bestIndex = idx;
          bestMatch = ext;
        }
      }

      if (bestMatch) {
        const baseUrl = pathname.substring(0, bestIndex + bestMatch.length + 1);
        u.pathname = baseUrl;
        u.search = "";
        u.hash = "";
        return u.href;
      }
      return url;
    } catch {
      return url;
    }
  }

  // 全局资源收集器：scanMedia 和 MutationObserver 共用
  const allDetectedResources = new Map();

  function addResource(url, type, source) {
    if (!isValidUrl(url)) return;
    const resolved = resolveUrl(url);
    const detectedType = type || getType(resolved);
    if (detectedType === "unknown") return;

    // 视频保留完整 URL，图片用截断 URL 做去重 key
    const baseUrl = extractBaseUrl(resolved, detectedType);
    const normalized = baseUrl.toLowerCase();

    if (allDetectedResources.has(normalized)) {
      const existing = allDetectedResources.get(normalized);
      if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
      // 视频保留最长 URL（含认证参数）
      if (detectedType === "video" || detectedType === "audio") {
        if (resolved.length > existing.url.length) {
          existing.url = resolved;
        }
      }
      return;
    }

    allDetectedResources.set(normalized, {
      url: detectedType === "video" || detectedType === "audio" ? resolved : baseUrl,
      type: detectedType,
      sources: [source],
    });
  }

  function scanMedia() {
    document.querySelectorAll("[data-original], [data-lazy-original]").forEach((el) => {
      ["data-original", "data-lazy-original"].forEach((attr) => {
        const val = el.getAttribute(attr);
        if (val) addResource(val, "image", attr);
      });
    });

    document.querySelectorAll("source[srcset]").forEach((src) => {
      const entries = (src.srcset || "").split(",").map((s) => s.trim().split(/\s+/));
      entries.forEach(([u]) => { if (u) addResource(u, "image", "source[srcset]"); });
    });
    document.querySelectorAll("source[src]").forEach((src) => { addResource(src.src, "image", "source[src]"); });

    document.querySelectorAll("img[src]").forEach((img) => {
      addResource(img.src, "image", "img");
      if (img.dataset.src) addResource(img.dataset.src, "image", "img[data-src]");
    });

    document.querySelectorAll("video[src], audio[src]").forEach((el) => {
      const type = el.tagName.toLowerCase() === "video" ? "video" : "audio";
      const src = el.src;
      if (src && !src.startsWith("blob:")) {
        addResource(src, type, el.tagName.toLowerCase());
      }
    });
    document.querySelectorAll("video source, audio source").forEach((src) => {
      const parent = src.parentElement;
      const type = parent && parent.tagName.toLowerCase() === "video" ? "video" : "audio";
      const srcUrl = src.src;
      if (srcUrl && !srcUrl.startsWith("blob:")) {
        addResource(srcUrl, type, `${parent?.tagName?.toLowerCase()} > source`);
      }
    });

    document.querySelectorAll("video[poster]").forEach((video) => {
      addResource(video.poster, "image", "video[poster]");
    });

    document.querySelectorAll("*").forEach((el) => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none" && bg.startsWith("url")) {
        const matches = bg.match(/url\(["']?(.*?)["']?\)/);
        if (matches && matches[1]) addResource(matches[1], "image", "css-background");
      }
    });

    document.querySelectorAll('link[rel="preload"][as="image"], link[rel="preload"][as="video"], link[rel="preload"][as="audio"]').forEach((link) => {
      const type = link.as === "video" ? "video" : link.as === "audio" ? "audio" : "image";
      addResource(link.href, type, "link");
    });

    document.querySelectorAll('a[href]').forEach((a) => {
      const type = getType(a.href);
      if (type !== "unknown") addResource(a.href, type, "a[href]");
    });

    document.querySelectorAll("[data-src], [data-lazy-src], [data-lazy-srcset]").forEach((el) => {
      ["data-src", "data-lazy-src", "data-lazy-srcset"].forEach((attr) => {
        const val = el.getAttribute(attr);
        if (val) {
          val.split(",").map((s) => s.trim().split(/\s+/)[0]).forEach((u) => addResource(u, undefined, attr));
        }
      });
    });

    document.querySelectorAll("script[type='application/ld+json']").forEach((script) => {
      try {
        const jsonStr = JSON.stringify(JSON.parse(script.textContent));
        const urlRegex = /https?:\/\/[^\s"<>]+\.(jpg|jpeg|png|gif|webp|mp4|webm|mp3|wav|ogg|avif)(\?[^\s"<>]*)?/gi;
        let match;
        while ((match = urlRegex.exec(jsonStr)) !== null) {
          addResource(match[0], undefined, "json-ld");
        }
      } catch {}
    });

    return Array.from(allDetectedResources.values()).map((r) => ({
      url: r.url,
      type: r.type,
      source: r.sources.join(", "),
    }));
  }

  function interceptNetworkRequests() {
    const dynamicResources = new Map();

    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url) {
        const type = getType(url);
        if (type !== "unknown") {
          const key = type === "video" || type === "audio" ? url.toLowerCase() : extractBaseUrl(url, type).toLowerCase();
          if (!dynamicResources.has(key)) {
            dynamicResources.set(key, {
              url: type === "video" || type === "audio" ? url : extractBaseUrl(url, type),
              type,
              source: "fetch"
            });
          }
        }
      }
      return originalFetch.apply(this, args);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (url && typeof url === "string") {
        const type = getType(url);
        if (type !== "unknown") {
          const key = type === "video" || type === "audio" ? url.toLowerCase() : extractBaseUrl(url, type).toLowerCase();
          if (!dynamicResources.has(key)) {
            dynamicResources.set(key, {
              url: type === "video" || type === "audio" ? url : extractBaseUrl(url, type),
              type,
              source: "xhr"
            });
          }
        }
      }
      return originalOpen.apply(this, arguments);
    };

    setInterval(() => {
      if (dynamicResources.size > 0) {
        const resources = Array.from(dynamicResources.values());
        dynamicResources.clear();
        try { chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href }); } catch {}
      }
    }, 2000);
  }

  // MutationObserver：监听动态插入的 <video> 元素
  // 修复：使用全局 addResource，而非 scanMedia 内部局部函数
  function observeVideoElements() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.tagName === "VIDEO") {
              if (node.src && !node.src.startsWith("blob:")) {
                addResource(node.src, "video", "video[added]");
                try { chrome.runtime.sendMessage({ action: "mediaDetected", resources: [{ url: node.src, type: "video", source: "video[added]" }], pageUrl: window.location.href }); } catch {}
              }
              node.querySelectorAll("source").forEach((src) => {
                if (src.src && !src.src.startsWith("blob:")) {
                  addResource(src.src, "video", "video > source[added]");
                  try { chrome.runtime.sendMessage({ action: "mediaDetected", resources: [{ url: src.src, type: "video", source: "video > source[added]" }], pageUrl: window.location.href }); } catch {}
                }
              });
            }
            node.querySelectorAll?.("video").forEach((video) => {
              if (video.src && !video.src.startsWith("blob:")) {
                addResource(video.src, "video", "video[added]");
                try { chrome.runtime.sendMessage({ action: "mediaDetected", resources: [{ url: video.src, type: "video", source: "video[added]" }], pageUrl: window.location.href }); } catch {}
              }
              video.querySelectorAll("source").forEach((src) => {
                if (src.src && !src.src.startsWith("blob:")) {
                  addResource(src.src, "video", "video > source[added]");
                  try { chrome.runtime.sendMessage({ action: "mediaDetected", resources: [{ url: src.src, type: "video", source: "video > source[added]" }], pageUrl: window.location.href }); } catch {}
                }
              });
            });
          }
        });
      });
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scanMedia") {
      const resources = scanMedia();
      sendResponse({ resources, pageUrl: window.location.href, pageTitle: document.title });
    }
  });

  interceptNetworkRequests();
  observeVideoElements();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => {
        const resources = scanMedia();
        if (resources.length > 0) {
          try { chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href, pageTitle: document.title }); } catch {}
        }
      }, 1000);
    });
  } else {
    setTimeout(() => {
      const resources = scanMedia();
      if (resources.length > 0) {
        try { chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href, pageTitle: document.title }); } catch {}
      }
    }, 1000);
  }
})();
