(function () {
  "use strict";

  const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif", "tiff"];
  const VIDEO_EXTS = ["mp4", "webm", "ogg", "ogv", "mov", "avi", "mkv", "flv", "wmv", "m4v", "3gp"];
  const AUDIO_EXTS = ["mp3", "wav", "ogg", "oga", "aac", "flac", "m4a", "wma", "opus"];
  const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS];

  // CDN 缩略图参数正则
  const CDN_THUMB_PATTERNS = [
    /@\d+w_\d+h_\d+[a-z]*/gi,
    /@\d+w/gi,
    /@\d+h/gi,
    /x-oss-process=image\/[^&]*/gi,
    /imageMogr2\/[^&]*/gi,
    /imageView2\/[^&]*/gi,
    /watermark\/[^&]*/gi,
    /[?&]width=\d+/gi,
    /[?&]height=\d+/gi,
    /[?&]resize=\([^)]*\)/gi,
    /_1s_[^&]*/gi,
    /!web-avatar-nav[^&]*/gi,
  ];

  function getType(url) {
    const lower = url.toLowerCase().split("?")[0];
    // 流媒体格式
    if (lower.includes(".m3u8") || lower.includes(".mpd") || lower.includes("/master.m3u8") || lower.includes("/index.m3u8")) return "video";
    if (lower.includes(".m3u8") || lower.includes(".mpd")) return "video";
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

  // 清理 CDN 缩略图参数，获取原图 URL
  function cleanThumbUrl(url) {
    let cleaned = url;
    CDN_THUMB_PATTERNS.forEach((pattern) => {
      cleaned = cleaned.replace(pattern, "");
    });
    cleaned = cleaned.replace(/[?&]$/, "").replace(/\?$/, "");
    return cleaned;
  }

  // 生成用于去重的规范化 URL
  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      u.search = "";
      u.hash = "";
      return cleanThumbUrl(u.href);
    } catch {
      return cleanThumbUrl(url);
    }
  }

  function scanMedia() {
    const resources = new Map();

    function addResource(url, type, source) {
      if (!isValidUrl(url)) return;
      const resolved = resolveUrl(url);
      const detectedType = type || getType(resolved);
      if (detectedType === "unknown") return;

      const cleaned = cleanThumbUrl(resolved);
      const normalized = normalizeUrl(resolved);
      const isThumb = resolved !== cleaned;

      if (resources.has(normalized)) {
        const existing = resources.get(normalized);
        if (!existing.sources.includes(source)) {
          existing.sources.push(source);
        }
        // 如果当前是原图且之前存的是缩略图，替换为原图
        if (!isThumb && existing.isThumb) {
          existing.url = cleaned;
          existing.thumbUrl = resolved;
          existing.isThumb = false;
        }
        // 如果当前是缩略图且还没有记录缩略图URL
        if (isThumb && !existing.thumbUrl) {
          existing.thumbUrl = resolved;
        }
        return;
      }

      resources.set(normalized, {
        url: isThumb ? cleaned : resolved,
        thumbUrl: isThumb ? resolved : null,
        type: detectedType,
        sources: [source],
        isThumb,
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

    // 检测视频 poster（封面图）
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

    return Array.from(resources.values()).map((r) => ({
      url: r.url,
      thumbUrl: r.thumbUrl,
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
          const cleaned = cleanThumbUrl(url);
          const normalized = normalizeUrl(url);
          if (!dynamicResources.has(normalized)) {
            dynamicResources.set(normalized, { url: cleaned, thumbUrl: url !== cleaned ? url : null, type, source: "fetch" });
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
          const cleaned = cleanThumbUrl(url);
          const normalized = normalizeUrl(url);
          if (!dynamicResources.has(normalized)) {
            dynamicResources.set(normalized, { url: cleaned, thumbUrl: url !== cleaned ? url : null, type, source: "xhr" });
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

    // 拦截 <video> 元素的 src 属性变化（处理动态设置的视频源）
    const videoObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "src") {
          const video = mutation.target;
          if (video.tagName === "VIDEO" && video.src && !video.src.startsWith("blob:")) {
            addResource(video.src, "video", "video[src]");
          }
        }
      });
    });

    document.querySelectorAll("video").forEach((video) => {
      videoObserver.observe(video, { attributes: true });
    });

    // 观察新添加的 video 元素
    const domObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.tagName === "VIDEO" && node.src && !node.src.startsWith("blob:")) {
              addResource(node.src, "video", "video[added]");
            }
            node.querySelectorAll?.("video").forEach((video) => {
              if (video.src && !video.src.startsWith("blob:")) {
                addResource(video.src, "video", "video[added]");
              }
              videoObserver.observe(video, { attributes: true });
            });
          }
        });
      });
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
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
