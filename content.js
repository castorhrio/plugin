(function () {
  "use strict";

  const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif", "tiff"];
  const VIDEO_EXTS = ["mp4", "webm", "ogg", "ogv", "mov", "avi", "mkv", "flv", "wmv", "m4v", "3gp"];
  const AUDIO_EXTS = ["mp3", "wav", "ogg", "oga", "aac", "flac", "m4a", "wma", "opus"];
  const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS];

  function getType(url) {
    const lower = url.toLowerCase().split("?")[0];
    for (const ext of VIDEO_EXTS) {
      if (lower.includes("." + ext)) return "video";
    }
    for (const ext of AUDIO_EXTS) {
      if (lower.includes("." + ext)) return "audio";
    }
    for (const ext of IMAGE_EXTS) {
      if (lower.includes("." + ext)) return "image";
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

  // 提取基础URL：找到第一个媒体扩展名，截取到扩展名结束
  function extractBaseUrl(url) {
    try {
      const u = new URL(url);
      let pathname = u.pathname;
      const hashIndex = pathname.indexOf("#");
      if (hashIndex !== -1) pathname = pathname.substring(0, hashIndex);

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

  function scanMedia() {
    const resources = new Map();

    function addResource(url, type, source) {
      if (!isValidUrl(url)) return;
      const resolved = resolveUrl(url);
      const detectedType = type || getType(resolved);
      if (detectedType === "unknown") return;

      const baseUrl = extractBaseUrl(resolved);
      const normalized = baseUrl.toLowerCase();

      if (resources.has(normalized)) {
        const existing = resources.get(normalized);
        if (!existing.sources.includes(source)) {
          existing.sources.push(source);
        }
        if (resolved.length > existing.url.length) {
          existing.originalUrl = resolved;
        }
        return;
      }

      resources.set(normalized, {
        url: baseUrl,
        originalUrl: resolved !== baseUrl ? resolved : null,
        type: detectedType,
        sources: [source],
      });
    }

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
      addResource(el.src, type, el.tagName.toLowerCase());
    });
    document.querySelectorAll("video source, audio source").forEach((src) => {
      const parent = src.parentElement;
      const type = parent && parent.tagName.toLowerCase() === "video" ? "video" : "audio";
      addResource(src.src, type, `${parent?.tagName?.toLowerCase()} > source`);
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

    return Array.from(resources.values()).map((r) => ({
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
          const baseUrl = extractBaseUrl(url);
          const normalized = baseUrl.toLowerCase();
          if (!dynamicResources.has(normalized)) {
            dynamicResources.set(normalized, { url: baseUrl, type, source: "fetch" });
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
          const baseUrl = extractBaseUrl(url);
          const normalized = baseUrl.toLowerCase();
          if (!dynamicResources.has(normalized)) {
            dynamicResources.set(normalized, { url: baseUrl, type, source: "xhr" });
          }
        }
      }
      return originalOpen.apply(this, arguments);
    };

    setInterval(() => {
      if (dynamicResources.size > 0) {
        const resources = Array.from(dynamicResources.values());
        dynamicResources.clear();
        chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href });
      }
    }, 2000);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scanMedia") {
      const resources = scanMedia();
      sendResponse({ resources, pageUrl: window.location.href, pageTitle: document.title });
    }
  });

  interceptNetworkRequests();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => {
        const resources = scanMedia();
        if (resources.length > 0) {
          chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href, pageTitle: document.title });
        }
      }, 1000);
    });
  } else {
    setTimeout(() => {
      const resources = scanMedia();
      if (resources.length > 0) {
        chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href, pageTitle: document.title });
      }
    }, 1000);
  }
})();
