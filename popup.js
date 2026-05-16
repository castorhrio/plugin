(function () {
  "use strict";

  let allResources = [];
  let currentFilter = "all";

  const resourceList = document.getElementById("resourceList");
  const totalCount = document.getElementById("totalCount");
  const pageTitle = document.getElementById("pageTitle");
  const refreshBtn = document.getElementById("refreshBtn");
  const downloadAllBtn = document.getElementById("downloadAllBtn");
  const filterBtns = document.querySelectorAll(".filter-btn");

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderResources();
    });
  });

  refreshBtn.addEventListener("click", () => scanCurrentTab());

  downloadAllBtn.addEventListener("click", () => {
    const filtered = getFilteredResources();
    filtered.forEach((resource, index) => {
      setTimeout(() => doDownload(resource), index * 500);
    });
  });

  resourceList.addEventListener("click", (e) => {
    const downloadBtn = e.target.closest(".btn-download");
    const previewBtn = e.target.closest(".btn-preview");

    if (downloadBtn) {
      const index = parseInt(downloadBtn.dataset.index, 10);
      const resource = allResources[index];
      if (resource) doDownload(resource);
    }

    if (previewBtn) {
      const url = previewBtn.dataset.url;
      if (url) chrome.tabs.create({ url });
    }
  });

  async function scanCurrentTab() {
    resourceList.innerHTML = '<div class="loading"><div class="spinner"></div>扫描中...</div>';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      chrome.tabs.sendMessage(tab.id, { action: "scanMedia" }, (response) => {
        if (chrome.runtime.lastError) {
          resourceList.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>无法连接到页面</p><p class="hint">请刷新页面后重试</p></div>';
          return;
        }

        if (response && response.resources) {
          allResources = response.resources;
          pageTitle.textContent = response.pageTitle || tab.title || "-";
          renderResources();
        } else {
          resourceList.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>未发现媒体资源</p></div>';
          totalCount.textContent = "0 个资源";
        }
      });
    } catch (err) {
      resourceList.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>扫描失败</p><p class="hint">' + err.message + '</p></div>';
    }
  }

  function getFilteredResources() {
    if (currentFilter === "all") return allResources;
    return allResources.filter((r) => r.type === currentFilter);
  }

  function renderResources() {
    const filtered = getFilteredResources();
    totalCount.textContent = filtered.length + " 个资源";

    if (filtered.length === 0) {
      resourceList.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>未发现' + getFilterLabel(currentFilter) + '资源</p></div>';
      return;
    }

    resourceList.innerHTML = filtered
      .map((resource, index) => {
        const globalIndex = allResources.indexOf(resource);
        const displayUrl = resource.thumbUrl || resource.url;
        const downloadUrl = resource.url;
        const isThumb = !!resource.thumbUrl;

        return `
      <div class="resource-item">
        ${getThumbnail(displayUrl, resource.type)}
        <div class="resource-info">
          <div class="resource-url" title="${escapeHtml(downloadUrl)}">${escapeHtml(getFilename(downloadUrl))}</div>
          <div class="resource-meta">
            <span class="resource-type ${resource.type}">${getTypeLabel(resource.type)}</span>
            ${isThumb ? '<span class="resource-source" style="color:#e94560">原图</span>' : `<span class="resource-source">来源: ${escapeHtml(resource.source)}</span>`}
          </div>
        </div>
        <div class="resource-actions">
          ${resource.type === "image" ? `<button class="btn-preview" data-url="${escapeHtml(downloadUrl)}">预览</button>` : ""}
          <button class="btn-download" data-index="${globalIndex}">${isThumb ? "下载原图" : "下载"}</button>
        </div>
      </div>
    `;
      })
      .join("");
  }

  function getThumbnail(url, type) {
    if (type === "image") {
      return `<img class="resource-thumb" src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'resource-thumb image-thumb\\'>🖼️</div>'">`;
    }
    const icon = type === "video" ? "🎬" : "🎵";
    const thumbClass = type === "video" ? "video-thumb" : "audio-thumb";
    return `<div class="resource-thumb ${thumbClass}">${icon}</div>`;
  }

  function getFilterLabel(filter) {
    const labels = { all: "", image: "图片", video: "视频", audio: "音频" };
    return labels[filter] || "";
  }

  function getTypeLabel(type) {
    const labels = { image: "图片", video: "视频", audio: "音频" };
    return labels[type] || type;
  }

  function getFilename(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.split("/").pop() || "";
      return decodeURIComponent(path) || u.hostname;
    } catch {
      return url.substring(0, 40);
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function doDownload(resource) {
    if (!resource || !resource.url) return;

    chrome.downloads.download(
      {
        url: resource.url,
        filename: generateFilename(resource),
        conflictAction: "uniquify",
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("下载失败:", chrome.runtime.lastError.message);
          return;
        }
        console.log("开始下载:", downloadId, resource.url);
      }
    );
  }

  function generateFilename(resource) {
    try {
      const urlObj = new URL(resource.url);
      let filename = urlObj.pathname.split("/").pop() || "";
      filename = decodeURIComponent(filename);

      if (!filename.includes(".")) {
        const ext = getExtension(resource.url);
        if (ext) filename += "." + ext;
      }

      filename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
      if (!filename || filename === "_") {
        filename = `${resource.type}_${Date.now()}`;
      }

      const prefix = resource.type === "image" ? "img" : resource.type === "video" ? "video" : "audio";
      return `media-sniffer/${prefix}_${filename}`;
    } catch {
      return `media-sniffer/${resource.type}_${Date.now()}`;
    }
  }

  function getExtension(url) {
    const match = url.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|tiff|mp4|webm|mov|mp3|wav|ogg|aac|flac|m3u8|mpd)(\?.*)?$/i);
    return match ? match[1].toLowerCase() : "";
  }

  scanCurrentTab();
})();
