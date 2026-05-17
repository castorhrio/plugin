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
    // YouTube videoplayback with googlevideo.com - only if also has itag param (full direct URL, not byte-range fragment)
    if (lower.includes("/videoplayback") && lower.includes("googlevideo.com")) {
      try { if (new URL(url).searchParams.has("itag")) return "video"; } catch {}
    }
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

    // Check query params for format (Twitter/X style: ?format=jpg&name=large)
    try {
      const u = new URL(url);
      const format = u.searchParams.get("format");
      if (format) {
        const f = format.toLowerCase();
        if (IMAGE_EXTS.includes(f)) return "image";
        if (VIDEO_EXTS.includes(f)) return "video";
        if (AUDIO_EXTS.includes(f)) return "audio";
      }
    } catch {}

    // Instagram/Threads CDN: URLs with no file extension but with stp/oh/oe params are images
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (host.includes("cdninstagram.com") || host.includes("fbcdn.net")) {
        if (lower.includes(".mp4")) return "video";
        // Has image-related query params → image
        if (u.searchParams.has("stp") || u.searchParams.has("oh") || u.searchParams.has("oe")) return "image";
        // Path pattern like /v/t51.2885-15/ → image
        if (/\/v\/t\d+\.\d+-\d+\//i.test(lower)) return "image";
      }
    } catch {}

    return "unknown";
  }

  function isValidUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (url.startsWith("data:")) return false;
    // Allow blob: URLs for site-specific extraction (IG, X, YouTube use blob: for video)
    if (url.startsWith("blob:")) {
      // Only allow blob URLs from the current page origin
      try {
        const blobOrigin = url.substring(5).split("/")[0];
        if (blobOrigin === window.location.origin || blobOrigin === window.location.host) return true;
      } catch {}
      return false;
    }
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
      const hostLower = u.hostname.toLowerCase();
      let pathname = u.pathname;
      const hashIndex = pathname.indexOf("#");
      if (hashIndex !== -1) pathname = pathname.substring(0, hashIndex);

      // Instagram/Threads CDN: 认证参数(oh, oe, stp等)不能丢，只清理缩略图后缀做去重key
      if (hostLower.includes("cdninstagram.com") || hostLower.includes("fbcdn.net")) {
        const cdnMatch = pathname.match(/^(.+?\.(jpg|jpeg|png|gif|webp|bmp|avif|tiff))(@[\w_]+)$/i);
        if (cdnMatch) {
          pathname = cdnMatch[1];
        }
        // 去重key：只取路径（同图不同尺寸共享路径），但存储的URL保留完整查询参数
        const dedupUrl = new URL(url);
        dedupUrl.pathname = pathname;
        dedupUrl.search = "";
        dedupUrl.hash = "";
        return dedupUrl.href;
      }

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

      // X/Twitter style: no file extension in path, but format= in query
      const format = u.searchParams.get("format");
      if (format) {
        const f = format.toLowerCase();
        if (IMAGE_EXTS.includes(f) || VIDEO_EXTS.includes(f) || AUDIO_EXTS.includes(f)) {
          // Keep path + format param for dedup, strip size/name params
          const dedupUrl = new URL(url);
          dedupUrl.searchParams.delete("name");
          dedupUrl.hash = "";
          return dedupUrl.href;
        }
      }

      return url;
    } catch {
      return url;
    }
  }

  // 全局资源收集器：scanMedia 和 MutationObserver 共用
  const allDetectedResources = new Map();

  // Instagram/Threads CDN 图片需要完整 URL（含认证参数 oh/oe/stp），否则 403
  function isAuthCDNUrl(url) {
    try {
      const h = new URL(url).hostname.toLowerCase();
      return h.includes("cdninstagram.com") || h.includes("fbcdn.net");
    } catch { return false; }
  }

  function addResource(url, type, source) {
    if (!isValidUrl(url)) return;
    const resolved = resolveUrl(url);
    const detectedType = type || getType(resolved);
    if (detectedType === "unknown") return;

    // 视频保留完整 URL，图片用截断 URL 做去重 key
    // Instagram/Threads CDN 图片也保留完整 URL（认证参数不能丢）
    const baseUrl = extractBaseUrl(resolved, detectedType);
    const normalized = baseUrl.toLowerCase();
    const needFullUrl = detectedType === "video" || detectedType === "audio" || isAuthCDNUrl(resolved);

    if (allDetectedResources.has(normalized)) {
      const existing = allDetectedResources.get(normalized);
      if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
      // 保留最长 URL（含认证参数）
      if (needFullUrl) {
        if (resolved.length > existing.url.length) {
          existing.url = resolved;
        }
      }
      return;
    }

    allDetectedResources.set(normalized, {
      url: needFullUrl ? resolved : baseUrl,
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
        // Standard media URLs with file extensions
        const urlRegex = /https?:\/\/[^\s"<>]+\.(jpg|jpeg|png|gif|webp|mp4|webm|mp3|wav|ogg|avif)(\?[^\s"<>]*)?/gi;
        let match;
        while ((match = urlRegex.exec(jsonStr)) !== null) {
          addResource(match[0], undefined, "json-ld");
        }
        // X/Twitter style URLs with ?format= parameter
        const twitterUrlRegex = /https?:\/\/pbs\.twimg\.com\/media\/[^\s"<>]+\?format=\w+[^\s"<>]*/gi;
        while ((match = twitterUrlRegex.exec(jsonStr)) !== null) {
          addResource(match[0], "image", "json-ld");
        }
        // Instagram CDN URLs
        const igUrlRegex = /https?:\/\/[^\s"<>]*cdninstagram\.com[^\s"<>]*/gi;
        while ((match = igUrlRegex.exec(jsonStr)) !== null) {
          const url = match[0];
          if (url.includes(".mp4")) addResource(url, "video", "json-ld");
          else addResource(url, "image", "json-ld");
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
          const needFull = type === "video" || type === "audio" || isAuthCDNUrl(url);
          const key = needFull ? url.toLowerCase() : extractBaseUrl(url, type).toLowerCase();
          if (!dynamicResources.has(key)) {
            dynamicResources.set(key, {
              url: needFull ? url : extractBaseUrl(url, type),
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
          const needFull = type === "video" || type === "audio" || isAuthCDNUrl(url);
          const key = needFull ? url.toLowerCase() : extractBaseUrl(url, type).toLowerCase();
          if (!dynamicResources.has(key)) {
            dynamicResources.set(key, {
              url: needFull ? url : extractBaseUrl(url, type),
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
      extractSiteSpecificMedia();
      const resources = scanMedia();
      sendResponse({ resources, pageUrl: window.location.href, pageTitle: document.title });
    }
  });

  // =========================================================
  // SITE-SPECIFIC EXTRACTION
  // Instagram, Threads, X/Twitter, YouTube
  // =========================================================

  function extractSiteSpecificMedia() {
    const host = window.location.hostname;
    const isInstagram = host.includes("instagram.com");
    const isThreads = host.includes("threads.net") || host.includes("threads.com");
    const isTwitter = host.includes("twitter.com") || host.includes("x.com");
    const isYouTube = host.includes("youtube.com") || host.includes("youtu.be");

    if (isInstagram || isThreads) {
      extractInstagramMedia();
    }
    if (isTwitter) {
      extractTwitterMedia();
    }
    if (isYouTube) {
      extractYouTubeMedia();
    }
  }

  // Instagram & Threads: extract from embedded JSON and meta tags
  function extractInstagramMedia() {
    // Extract from meta tags (og:image, og:video)
    document.querySelectorAll('meta[property="og:image"], meta[property="og:video"], meta[name="twitter:image"], meta[name="twitter:player:stream"]').forEach((meta) => {
      const content = meta.getAttribute("content");
      if (content) {
        const prop = meta.getAttribute("property") || meta.getAttribute("name") || "";
        const type = prop.includes("video") || prop.includes("player") ? "video" : "image";
        addResource(content, type, "meta-tag");
      }
    });

    // Extract from script tags containing embedded JSON data
    document.querySelectorAll("script").forEach((script) => {
      const text = script.textContent || "";
      if (!text.includes("display_url") && !text.includes("video_url")) return;

      // Extract image URLs (display_url, thumbnail_src)
      const imgUrlPatterns = [
        /"display_url"\s*:\s*"([^"]+)"/g,
        /"thumbnail_src"\s*:\s*"([^"]+)"/g,
        /"thumbnailUrl"\s*:\s*"([^"]+)"/g,
      ];
      for (const pattern of imgUrlPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const url = match[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
          if (url) addResource(url, "image", "ig-json");
        }
      }

      // Extract video URLs (video_url, video_versions)
      const vidUrlPatterns = [
        /"video_url"\s*:\s*"([^"]+)"/g,
        /"video_versions"\s*:\s*\[[\s\S]*?"url"\s*:\s*"([^"]+)"/g,
      ];
      for (const pattern of vidUrlPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const url = match[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
          if (url) addResource(url, "video", "ig-json");
        }
      }
    });

    // Extract from __a=1 API response (if available in page context)
    // Also scan for image URLs in the page that match Instagram CDN patterns
    document.querySelectorAll("img[src]").forEach((img) => {
      const src = img.src || "";
      if (src.includes("cdninstagram.com") || src.includes("fbcdn.net")) {
        addResource(src, "image", "ig-img");
      }
    });

    // Extract video elements that may have blob: or direct URLs
    document.querySelectorAll("video[src], video source").forEach((el) => {
      const src = el.src || el.getAttribute("src") || "";
      if (src && !src.startsWith("blob:")) {
        addResource(src, "video", "ig-video");
      }
    });

    // Extract poster images from video elements
    document.querySelectorAll("video[poster]").forEach((video) => {
      if (video.poster) addResource(video.poster, "image", "ig-video[poster]");
    });
  }

  // X/Twitter: extract from embedded JSON and media elements
  function extractTwitterMedia() {
    // Extract from meta tags
    document.querySelectorAll('meta[property="og:image"], meta[property="og:video"], meta[name="twitter:image:src"], meta[name="twitter:player:stream"]').forEach((meta) => {
      const content = meta.getAttribute("content");
      if (content) {
        const prop = meta.getAttribute("property") || meta.getAttribute("name") || "";
        const type = prop.includes("video") || prop.includes("player") ? "video" : "image";
        addResource(content, type, "meta-tag");
      }
    });

    // Extract from embedded JSON in script tags (tweet data)
    document.querySelectorAll("script").forEach((script) => {
      const text = script.textContent || "";
      if (!text.includes("media_url_https") && !text.includes("video_info")) return;

      // Extract images (media_url_https, media_url)
      const imgPatterns = [
        /"media_url_https"\s*:\s*"([^"]+)"/g,
        /"media_url"\s*:\s*"([^"]+)"/g,
      ];
      for (const pattern of imgPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const url = match[1].replace(/\\/g, "");
          if (url) addResource(url, "image", "x-json");
        }
      }

      // Extract video URLs from video_info.variants
      const videoInfoPattern = /"video_info"\s*:\s*\{[\s\S]*?"variants"\s*:\s*\[([\s\S]*?)\]/g;
      let vMatch;
      while ((vMatch = videoInfoPattern.exec(text)) !== null) {
        const variantsStr = vMatch[1];
        const urlPattern = /"url"\s*:\s*"([^"]+)"/g;
        let uMatch;
        let bestVideoUrl = null;
        let bestBitrate = 0;
        while ((uMatch = urlPattern.exec(variantsStr)) !== null) {
          const vUrl = uMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
          const bitrateMatch = variantsStr.substring(0, uMatch.index).match(/"bitrate"\s*:\s*(\d+)/g);
          const bitrate = bitrateMatch ? parseInt(bitrateMatch[bitrateMatch.length - 1].match(/\d+/)[0]) : 0;
          // Prefer MP4 with highest bitrate
          if (vUrl.includes(".mp4") && bitrate >= bestBitrate) {
            bestBitrate = bitrate;
            bestVideoUrl = vUrl;
          }
        }
        if (bestVideoUrl) addResource(bestVideoUrl, "video", "x-json");
      }
    });

    // Extract from visible tweet media elements
    document.querySelectorAll("img[src]").forEach((img) => {
      const src = img.src || "";
      if (src.includes("twimg.com") || src.includes("pbs.twimg.com")) {
        // Skip tiny profile/emoji images
        if (src.includes("/emoji/") || src.includes("/profile_images/")) return;
        addResource(src, "image", "x-img");
      }
    });

    // Extract video elements
    document.querySelectorAll("video[src], video source").forEach((el) => {
      const src = el.src || el.getAttribute("src") || "";
      if (src && !src.startsWith("blob:")) {
        addResource(src, "video", "x-video");
      }
    });

    document.querySelectorAll("video[poster]").forEach((video) => {
      if (video.poster) addResource(video.poster, "image", "x-video[poster]");
    });
  }

  // YouTube: extract from ytInitialPlayerResponse
  function extractYouTubeMedia() {
    // Extract from ytInitialPlayerResponse in script tags
    document.querySelectorAll("script").forEach((script) => {
      const text = script.textContent || "";
      if (!text.includes("ytInitialPlayerResponse")) return;

      const startIdx = text.indexOf("ytInitialPlayerResponse");
      if (startIdx === -1) return;

      const streamingIdx = text.indexOf("streamingData", startIdx);
      if (streamingIdx === -1) return;

      // Parse each format object from formats[] and adaptiveFormats[]
      // We only extract formats that have a direct "url" field (not signatureCipher)
      // signatureCipher URLs are incomplete (need YouTube's signature decryption) and will fail
      const searchStr = text.substring(startIdx);

      // Find all format blocks by looking for itag as a reliable start marker
      const itagPattern = /"itag"\s*:\s*(\d+)/g;
      let itagMatch;
      const formatBlocks = [];

      while ((itagMatch = itagPattern.exec(searchStr)) !== null) {
        // Extract a chunk around this itag to parse the format
        const chunkStart = itagMatch.index;
        // Find the enclosing { and }
        let braceStart = chunkStart;
        while (braceStart > 0 && searchStr[braceStart] !== '{') braceStart--;
        let braceEnd = braceStart + 1;
        let depth = 1;
        while (braceEnd < searchStr.length && depth > 0) {
          if (searchStr[braceEnd] === '{') depth++;
          if (searchStr[braceEnd] === '}') depth--;
          braceEnd++;
        }
        const block = searchStr.substring(braceStart, braceEnd);

        // Only process blocks with a direct "url" field (not signatureCipher)
        if (block.includes('"url"') && !block.includes('"signatureCipher"')) {
          const urlMatch = block.match(/"url"\s*:\s*"([^"]+)"/);
          if (urlMatch) {
            const url = urlMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
            if (!url) continue;

            // Extract metadata for labeling
            const qualityLabel = (block.match(/"qualityLabel"\s*:\s*"([^"]+)"/) || [])[1] || "";
            const mimeType = (block.match(/"mimeType"\s*:\s*"([^"]+)"/) || [])[1] || "";
            const audioQuality = (block.match(/"audioQuality"\s*:\s*"([^"]+)"/) || [])[1] || "";
            const hasVideo = mimeType.startsWith("video/");
            const hasAudioOnly = mimeType.startsWith("audio/");

            // Build a descriptive label
            let label;
            if (hasAudioOnly) {
              label = "音频 " + audioQuality;
            } else if (qualityLabel) {
              label = qualityLabel + (hasVideo && !mimeType.includes("mp4a") ? "" : "");
            } else {
              label = hasVideo ? "视频" : "音频";
            }

            formatBlocks.push({
              url,
              type: hasAudioOnly ? "audio" : "video",
              label,
              qualityLabel,
              mimeType,
            });
          }
        }
      }

      // De-duplicate by qualityLabel (keep highest quality per label)
      const seen = new Map();
      for (const fb of formatBlocks) {
        const key = fb.type + ":" + fb.qualityLabel;
        if (!seen.has(key)) {
          seen.set(key, fb);
        }
      }

      for (const fb of seen.values()) {
        addResource(fb.url, fb.type, "yt-" + fb.label);
      }
    });

    // Extract from ytInitialData (playlist thumbnails, etc.)
    document.querySelectorAll("script").forEach((script) => {
      const text = script.textContent || "";
      if (!text.includes("ytInitialData")) return;

      // Extract thumbnail URLs
      const thumbPattern = /"url"\s*:\s*"(https?:\/\/i\.ytimg\.com\/[^"]+)"/g;
      let match;
      while ((match = thumbPattern.exec(text)) !== null) {
        const url = match[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
        if (url) addResource(url, "image", "yt-thumb");
      }
    });

    // Extract from video and poster elements
    document.querySelectorAll("video[src], video source").forEach((el) => {
      const src = el.src || el.getAttribute("src") || "";
      if (src && !src.startsWith("blob:")) {
        addResource(src, "video", "yt-video");
      }
    });

    document.querySelectorAll("video[poster]").forEach((video) => {
      if (video.poster) addResource(video.poster, "image", "yt-video[poster]");
    });
  }

  interceptNetworkRequests();
  observeVideoElements();

  // SPA URL change detection: re-extract site-specific media when URL changes
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Delay to allow SPA content to render
      setTimeout(() => {
        extractSiteSpecificMedia();
        const resources = scanMedia();
        if (resources.length > 0) {
          try { chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href, pageTitle: document.title }); } catch {}
        }
      }, 2000);
    }
  });
  if (document.body) {
    urlObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Periodic re-extraction for SPA sites (Instagram, X, Threads, YouTube)
  // These sites load media content dynamically via AJAX after initial render
  const host = window.location.hostname;
  const isSPASite = host.includes("instagram.com") || host.includes("threads.net") || host.includes("threads.com") ||
    host.includes("twitter.com") || host.includes("x.com") ||
    host.includes("youtube.com") || host.includes("youtu.be");
  if (isSPASite) {
    setInterval(() => {
      extractSiteSpecificMedia();
      const resources = scanMedia();
      if (resources.length > 0) {
        try { chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href, pageTitle: document.title }); } catch {}
      }
    }, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => {
        extractSiteSpecificMedia();
        const resources = scanMedia();
        if (resources.length > 0) {
          try { chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href, pageTitle: document.title }); } catch {}
        }
      }, 1000);
    });
  } else {
    setTimeout(() => {
      extractSiteSpecificMedia();
      const resources = scanMedia();
      if (resources.length > 0) {
        try { chrome.runtime.sendMessage({ action: "mediaDetected", resources, pageUrl: window.location.href, pageTitle: document.title }); } catch {}
      }
    }, 1000);
  }
})();
