(function () {
  "use strict";

  let allResources = [];
  let currentFilter = "all";
  let isDownloading = false;

  const resourceList = document.getElementById("resourceList");
  const totalCount = document.getElementById("totalCount");
  const pageTitle = document.getElementById("pageTitle");
  const refreshBtn = document.getElementById("refreshBtn");
  const downloadAllBtn = document.getElementById("downloadAllBtn");
  const filterBtns = document.querySelectorAll(".filter-btn");
  const downloadPanel = document.getElementById("downloadPanel");
  const downloadPanelTitle = document.getElementById("downloadPanelTitle");
  const downloadPanelClose = document.getElementById("downloadPanelClose");
  const downloadProgressFill = document.getElementById("downloadProgressFill");
  const downloadProgressText = document.getElementById("downloadProgressText");
  const downloadProgressDetail = document.getElementById("downloadProgressDetail");
  const downloadLog = document.getElementById("downloadLog");

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
    getFilteredResources().forEach((r, i) => setTimeout(() => doDownload(r), i * 500));
  });
  downloadPanelClose.addEventListener("click", () => downloadPanel.classList.remove("active"));

  resourceList.addEventListener("click", (e) => {
    const idx = parseInt((e.target.closest("[data-index]") || {}).dataset?.index, 10);
    const resource = allResources[idx];
    if (!resource) return;

    if (e.target.closest(".btn-download")) doDownload(resource);
    if (e.target.closest(".btn-preview")) { const u = e.target.closest(".btn-preview").dataset.url; if (u) chrome.tabs.create({ url: u }); }
    if (e.target.closest(".btn-copy")) {
      const u = e.target.closest(".btn-copy").dataset.url;
      if (u) navigator.clipboard.writeText(u).then(() => { e.target.closest(".btn-copy").textContent = "已复制"; setTimeout(() => { e.target.closest(".btn-copy").textContent = "复制链接"; }, 1500); });
    }
    if (e.target.closest(".btn-merge")) {
      if (resource.category === "paired-stream") downloadPairedStream(resource);
      else if (resource.category === "manifest") downloadHLS(resource.url);
      else if (resource.category === "video-stream") downloadSingleStream(resource);
    }
  });

  // =========================================================
  // fMP4 REMUXER - 合并视频+音频为完整 MP4
  // =========================================================

  const Remuxer = {
    u32(b, o) { return ((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0; },
    w32(b, o, v) { b[o]=(v>>24)&0xff; b[o+1]=(v>>16)&0xff; b[o+2]=(v>>8)&0xff; b[o+3]=v&0xff; },
    type(b, o) { return String.fromCharCode(b[o+4],b[o+5],b[o+6],b[o+7]); },

    // 将 fMP4 数据拆分为 ftyp + moov + moof/mdat 对
    split(data) {
      const ftyp = []; const moov = []; const segs = []; let mo = null;
      let o = 0;
      while (o + 8 <= data.length) {
        let s = this.u32(data, o);
        if (s < 8 || o + s > data.length) break;
        const t = this.type(data, o);
        if (t === "ftyp") ftyp.push({ off: o, sz: s, end: o + s });
        else if (t === "moov") moov.push({ off: o, sz: s, end: o + s });
        else if (t === "moof") mo = { off: o, sz: s, end: o + s };
        else if (t === "mdat" && mo) { segs.push({ moof: mo, mdat: { off: o, sz: s, end: o + s } }); mo = null; }
        o += s;
      }
      return { ftyp, moov, segs };
    },

    // 在 data[start..end] 中查找指定类型的子 box
    find(data, start, end, t) {
      let o = start;
      while (o + 8 <= end) { let s = this.u32(data, o); if (s < 8 || o + s > end) break; if (this.type(data, o) === t) return { off: o, sz: s, end: o + s }; o += s; }
      return null;
    },

    // 在 moof 中修改 tfhd.track_ID（4 字节，不改变大小）
    fixTid(data, moofOff, moofSz, newId) {
      const end = moofOff + moofSz;
      const traf = this.find(data, moofOff + 8, end, "traf");
      if (!traf) return;
      const tfhd = this.find(data, traf.off + 8, traf.end, "tfhd");
      if (tfhd && tfhd.sz >= 16) this.w32(data, tfhd.off + 12, newId);
    },

    // 在 moof 中更新 tfhd.base_data_offset（8 字节，不改变大小）
    fixBase(data, moofOff, moofSz, newBase) {
      const end = moofOff + moofSz;
      const traf = this.find(data, moofOff + 8, end, "traf");
      if (!traf) return;
      const tfhd = this.find(data, traf.off + 8, traf.end, "tfhd");
      if (!tfhd || tfhd.sz < 24) return;
      const fl = ((data[tfhd.off + 9] << 16) | (data[tfhd.off + 10] << 8) | data[tfhd.off + 11]);
      if (!(fl & 0x01)) return;
      this.w32(data, tfhd.off + 16, 0);
      this.w32(data, tfhd.off + 20, newBase);
    },

    merge(vData, aData, logFn) {
      const log = logFn || (() => {});
      const v = this.split(vData);
      const a = this.split(aData);

      if (!v.moov.length) throw new Error("视频缺少 moov");
      if (!a.moov.length) throw new Error("音频缺少 moov");
      if (!v.ftyp.length && !a.ftyp.length) throw new Error("缺少 ftyp");

      const ftyp = v.ftyp[0] || a.ftyp[0];
      const vMoov = v.moov[0];
      const aMoov = a.moov[0];

      // 读取视频 track_ID
      const vTrak = this.find(vData, vMoov.off + 8, vMoov.off + vMoov.sz, "trak");
      if (!vTrak) throw new Error("视频缺少 trak");
      const vTkhd = this.find(vData, vTrak.off + 8, vTrak.end, "tkhd");
      const vVer = vTkhd ? vData[vTkhd.off + 8] : 0;
      // tkhd: version(1)+flags(3)+creation_time(4/8)+modification_time(4/8)+track_ID(4)
      // version 0: track_ID at offset 20; version 1: track_ID at offset 28
      const vTkhdTidOff = vVer === 0 ? 20 : 28;
      const vOldId = vTkhd ? this.u32(vData, vTkhd.off + vTkhdTidOff) : 1;
      const vNewId = 1;

      // 读取音频 track_ID 并分配新 ID = 2
      const aTrak = this.find(aData, aMoov.off + 8, aMoov.off + aMoov.sz, "trak");
      if (!aTrak) throw new Error("音频缺少 trak");
      const aTkhd = this.find(aData, aTrak.off + 8, aTrak.end, "tkhd");
      const aVer = aTkhd ? aData[aTkhd.off + 8] : 0;
      const aTkhdTidOff = aVer === 0 ? 20 : 28;
      const aOldId = aTkhd ? this.u32(aData, aTkhd.off + aTkhdTidOff) : 1;
      const aNewId = 2;

      log("track_ID: 视频 " + vOldId + "→" + vNewId + ", 音频 " + aOldId + "→" + aNewId);

      // 提取视频 trex（修改 track_ID）
      const vMvex = this.find(vData, vMoov.off + 8, vMoov.off + vMoov.sz, "mvex");
      let vTrexBuf = null;
      if (vMvex) {
        const vTrex = this.find(vData, vMvex.off + 8, vMvex.end, "trex");
        if (vTrex && vTrex.sz >= 16) {
          vTrexBuf = new Uint8Array(vData.subarray(vTrex.off, vTrex.end));
          if (vOldId !== vNewId) this.w32(vTrexBuf, 12, vNewId);
        }
      }

      // 提取音频 trex（修改 track_ID）
      const aMvex = this.find(aData, aMoov.off + 8, aMoov.off + aMoov.sz, "mvex");
      let aTrexBuf = null;
      if (aMvex) {
        const aTrex = this.find(aData, aMvex.off + 8, aMvex.end, "trex");
        if (aTrex && aTrex.sz >= 16) {
          aTrexBuf = new Uint8Array(aData.subarray(aTrex.off, aTrex.end));
          this.w32(aTrexBuf, 12, aNewId);
        }
      }

      log("Video segments: " + v.segs.length + ", audio: " + a.segs.length);

      // 复制并修改视频 trak 的 track_ID
      const vTrakData = new Uint8Array(vData.subarray(vTrak.off, vTrak.end));
      if (vTkhd && vOldId !== vNewId) this.w32(vTrakData, vTkhdTidOff + (vTkhd.off - vTrak.off), vNewId);

      // 复制并修改音频 trak 的 track_ID
      const aTrakData = new Uint8Array(aData.subarray(aTrak.off, aTrak.end));
      if (aTkhd) this.w32(aTrakData, aTkhdTidOff + (aTkhd.off - aTrak.off), aNewId);

      // 构建新 moov：遍历视频 moov 子 box，替换视频 trak、插入音频 trak、重建 mvex
      const parts = [];
      let audioTrakAdded = false;
      let o = vMoov.off + 8, vEnd = vMoov.off + vMoov.sz;
      while (o + 8 <= vEnd) {
        let s = this.u32(vData, o);
        if (s < 8 || o + s > vEnd) break;
        const t = this.type(vData, o);
        if (t === "trak") {
          parts.push(vTrakData); // 用修改后的视频 trak 替换
        } else if (t === "mvex") {
          if (!audioTrakAdded) { parts.push(aTrakData); audioTrakAdded = true; }
          // 重建 mvex：替换视频 trex + 添加音频 trex
          if (vTrexBuf || aTrexBuf) {
            const mvexChildren = [];
            let mo2 = o + 8, mEnd2 = o + s;
            while (mo2 + 8 <= mEnd2) {
              let ms2 = this.u32(vData, mo2);
              if (ms2 < 8 || mo2 + ms2 > mEnd2) break;
              const mt2 = this.type(vData, mo2);
              if (mt2 === "trex" && vTrexBuf) mvexChildren.push(vTrexBuf);
              else mvexChildren.push(vData.subarray(mo2, mo2 + ms2));
              mo2 += ms2;
            }
            if (aTrexBuf) mvexChildren.push(aTrexBuf);
            const newMvexLen = mvexChildren.reduce((acc, p) => acc + p.length, 0);
            const newMvex = new Uint8Array(8 + newMvexLen);
            this.w32(newMvex, 0, newMvex.length);
            newMvex[4]=0x6D; newMvex[5]=0x76; newMvex[6]=0x65; newMvex[7]=0x78;
            let mw = 8;
            for (const p of mvexChildren) { newMvex.set(p, mw); mw += p.length; }
            parts.push(newMvex);
          } else {
            parts.push(vData.subarray(o, o + s));
          }
        } else {
          parts.push(vData.subarray(o, o + s));
        }
        o += s;
      }
      if (!audioTrakAdded) parts.push(aTrakData);

      // 构建 moov box
      const mc = parts.reduce((s, p) => s + p.length, 0);
      const moov = new Uint8Array(8 + mc);
      this.w32(moov, 0, moov.length);
      moov[4] = 0x6D; moov[5] = 0x6F; moov[6] = 0x6F; moov[7] = 0x76;
      let wp = 8;
      for (const p of parts) { moov.set(p, wp); wp += p.length; }

      // 修复 mvhd next_track_id
      const mvhd = this.find(moov, 8, moov.length, "mvhd");
      if (mvhd) { const ver = moov[mvhd.off + 8]; this.w32(moov, mvhd.off + (ver === 0 ? 104 : 108), 3); }

      // 组装输出：ftyp + moov + 视频片段 + 音频片段
      const outParts = [vData.subarray(ftyp.off, ftyp.off + ftyp.sz), moov];
      for (const seg of v.segs) {
        outParts.push(vData.subarray(seg.moof.off, seg.mdat.off + seg.mdat.sz));
      }
      for (const seg of a.segs) {
        outParts.push(aData.subarray(seg.moof.off, seg.mdat.off + seg.mdat.sz));
      }

      const total = outParts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(total);
      let oo = 0;
      for (const p of outParts) { out.set(p, oo); oo += p.length; }

      // 回填：修复所有 moof 的 base_data_offset 和音频 track_ID
      // 按 box 边界扫描，不逐字节扫描，避免在 styp/emsg 内部误匹配
      let pos = ftyp.sz + moov.length;
      let segIdx = 0;
      const allSegs = v.segs.length + a.segs.length;
      while (pos + 8 <= total && segIdx < allSegs) {
        let boxSz = this.u32(out, pos);
        let boxType = this.type(out, pos);
        if (boxSz < 8 || pos + boxSz > total) break;

        if (boxType === "moof") {
          // 在 moof 之后按 box 边界搜索 mdat（moof 和 mdat 之间可能有 styp/emsg）
          let mdatPos = -1;
          let scanPos = pos + boxSz;
          while (scanPos + 8 <= total) {
            let sSz = this.u32(out, scanPos);
            let sType = this.type(out, scanPos);
            if (sSz < 8 || scanPos + sSz > total) break;
            if (sType === "mdat") { mdatPos = scanPos; break; }
            scanPos += sSz;
          }

          if (mdatPos >= 0) {
            const dataPos = mdatPos + 8;
            if (segIdx < v.segs.length) {
              // 视频 moof: 修改 track_ID 为 vNewId（如果原 ID 不是 1）
              if (vOldId !== vNewId) this.fixTid(out, pos, boxSz, vNewId);
            } else {
              // 音频 moof: 修改 track_ID 为 aNewId
              this.fixTid(out, pos, boxSz, aNewId);
            }
            this.fixBase(out, pos, boxSz, dataPos);
            segIdx++;
            pos = mdatPos + this.u32(out, mdatPos);
          } else {
            // 没找到 mdat，跳过这个 moof
            pos += boxSz;
          }
        } else {
          // 跳过非 moof box（styp/emsg 等）
          pos += boxSz;
        }
      }

      log("合并完成: " + (total / 1024 / 1024).toFixed(1) + "MB, " + v.segs.length + "V + " + a.segs.length + "A");
      return out;
    }
  };

  // =========================================================
  // DOWNLOAD PAIRED STREAM (DASH: 视频+音频 → 合并)
  // =========================================================

  async function downloadPairedStream(resource) {
    if (isDownloading) return;
    isDownloading = true;
    showPanel("下载完整视频...");

    try {
      const vSegs = resource._video._segments || [];
      const aSegs = resource._audio._segments || [];
      addLog("视频流: " + vSegs.length + " 片段, URL: " + (vSegs[0] || "").substring(0, 80));
      addLog("音频流: " + aSegs.length + " 片段, URL: " + (aSegs[0] || "").substring(0, 80));

      addLog("下载视频流...");
      const vData = await downloadStreamData(resource._video, "视频");
      addLog("视频: " + (vData.length / 1024 / 1024).toFixed(1) + "MB");
      // 验证视频数据
      const vSplit = Remuxer.split(vData);
      addLog("视频结构: ftyp=" + vSplit.ftyp.length + " moov=" + vSplit.moov.length + " segs=" + vSplit.segs.length);

      addLog("下载音频流...");
      const aData = await downloadStreamData(resource._audio, "音频");
      addLog("音频: " + (aData.length / 1024 / 1024).toFixed(1) + "MB");
      const aSplit = Remuxer.split(aData);
      addLog("音频结构: ftyp=" + aSplit.ftyp.length + " moov=" + aSplit.moov.length + " segs=" + aSplit.segs.length);

      addLog("合并中...");
      setPanelTitle("合并中...");

      let merged;
      try {
        merged = Remuxer.merge(vData, aData, addLog);
      } catch (e) {
        addLog("合并失败: " + e.message);
        addLog("分别保存视频流和音频流...");
        saveBlob(vData, "完整视频_视频流", "video/mp4", ".mp4");
        saveBlob(aData, "完整视频_音频流", "video/mp4", ".mp4");
        addLog("请使用 ffmpeg 合并: ffmpeg -i 视频流.mp4 -i 音频流.mp4 -c copy 输出.mp4");
        isDownloading = false;
        return;
      }

      // 验证合并结果
      const mSplit = Remuxer.split(merged);
      addLog("合并结果: ftyp=" + mSplit.ftyp.length + " moov=" + mSplit.moov.length + " segs=" + mSplit.segs.length);

      const blob = new Blob([merged], { type: "video/mp4" });
      const blobUrl = URL.createObjectURL(blob);
      const filename = "media-sniffer/complete_" + Date.now() + ".mp4";
      chrome.downloads.download({ url: blobUrl, filename, conflictAction: "uniquify" }, () => {
        if (chrome.runtime.lastError) addLog("保存失败: " + chrome.runtime.lastError.message);
        else addLog("完成! 合并视频 " + (merged.length / 1024 / 1024).toFixed(1) + "MB");
        setPanelTitle("下载完成");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
      });
    } catch (e) {
      addLog("错误: " + e.message);
      setPanelTitle("下载失败");
    } finally { isDownloading = false; }
  }

  // =========================================================
  // MAIN WORLD FETCH
  // =========================================================

  let currentPageTabId = null;
  let currentPageOrigin = "";

  // 检查数据是否以有效的 ISOBMFF box 开头（ftyp/moof/moov/styp/msix/emsg）
  // 或 TS 流同步字节 0x47
  function isValidMediaData(data) {
    if (data.length < 4) return false;
    // TS 流以 0x47 同步字节开头
    if (data[0] === 0x47) return true;
    // ISOBMFF box
    const sz = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
    if (sz < 8 || sz > data.length) return false;
    const t = String.fromCharCode(data[4], data[5], data[6], data[7]);
    return ["ftyp", "moof", "moov", "styp", "msix", "emsg"].includes(t);
  }

  async function mainWorldFetch(url) {
    if (!currentPageTabId) throw new Error("无活动标签页");
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentPageTabId },
      world: "MAIN",
      func: (u) => fetch(u).then(r => {
        if (!r.ok) return { error: "HTTP " + r.status };
        const ct = r.headers.get("content-type") || "";
        if (ct.includes("text/html") || ct.includes("text/xml")) return { error: "非媒体类型: " + ct };
        return r.arrayBuffer().then(b => {
          const x = new Uint8Array(b);
          let s = "";
          for (let i = 0; i < x.length; i += 8192)
            s += String.fromCharCode.apply(null, x.subarray(i, i + 8192));
          return { data: btoa(s), size: x.length, ct };
        });
      }).catch(e => ({ error: e.message })),
      args: [url],
    });
    const r = results?.[0]?.result;
    if (!r) throw new Error("页面无响应");
    if (r.error) throw new Error(r.error);
    if (!r.data) throw new Error("空响应");
    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // 限制 mainWorldFetch 并发数（chrome.scripting.executeScript 有并发上限）
  let _mwRunning = 0;
  const MW_CONCURRENCY = 3;

  async function fetchSeg(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    // 优先 proxyFetch（不受浏览器注入限制，适合批量下载）
    try {
      const d = await new Promise((res, rej) => {
        chrome.runtime.sendMessage({ action: "proxyFetch", url, referer: currentPageOrigin || "" }, r => {
          if (chrome.runtime.lastError) { rej(new Error(chrome.runtime.lastError.message)); return; }
          if (!r || !r.success) { rej(new Error(r ? r.error : "代理失败")); return; }
          const bin = atob(r.data); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); res(b);
        });
      });
      clearTimeout(timeout);
      if (d.length < 4) throw new Error("空响应");
      return d;
    } catch (proxyErr) {
      // proxyFetch 失败，尝试 mainWorldFetch（受并发限制）
      while (_mwRunning >= MW_CONCURRENCY) await new Promise(r => setTimeout(r, 100));
      _mwRunning++;
      try {
        const d = await mainWorldFetch(url);
        clearTimeout(timeout);
        if (d.length < 4) throw new Error("空响应");
        return d;
      } finally {
        _mwRunning--;
      }
    }
  }

  // =========================================================
  // M3U8 PARSER
  // =========================================================

  function parseM3U8(text, base) {
    const lines = text.split("\n").map(l => l.trim());
    const segs = [], streams = []; let master = false, key = null, dur = 0, init = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("#EXT-X-STREAM-INF:")) { master = true; const bw = (l.match(/BANDWIDTH=(\d+)/) || [])[1] || "0"; const res = (l.match(/RESOLUTION=([\dx]+)/) || [])[1] || ""; for (let j = i + 1; j < lines.length; j++) { if (!lines[j].startsWith("#") && lines[j].length > 0) { streams.push({ url: rUrl(base, lines[j]), bandwidth: +bw, resolution: res }); break; } } }
      if (l.startsWith("#EXT-X-KEY:")) { const m = (l.match(/METHOD=([^,\s]+)/) || [])[1]; const u = (l.match(/URI="([^"]+)"/) || [])[1]; const v = (l.match(/IV=0x([0-9a-fA-F]+)/) || [])[1]; key = (m && m !== "NONE") ? { method: m, uri: u ? rUrl(base, u) : null, iv: v ? h2b(v) : null } : null; }
      if (l.startsWith("#EXT-X-MAP:")) { const u = (l.match(/URI="([^"]+)"/) || [])[1]; if (u) init = rUrl(base, u); }
      if (l.startsWith("#EXTINF:")) dur = parseFloat(l.split(":")[1]) || 0;
      if (!l.startsWith("#") && l.length > 0 && !master) segs.push({ url: rUrl(base, l), duration: dur, key, initSegment: init });
    }
    return { segments: segs, isMaster: master, streams };
  }
  function rUrl(b, r) { if (!r) return b; if (r.startsWith("http")) return r; try { return new URL(r, b).href; } catch { return r; } }
  function h2b(h) { const b = new Uint8Array(h.length / 2); for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.substr(i, 2), 16); return b; }

  function saveBlob(data, label, mimeType, ext) {
    const blob = new Blob([data], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const filename = "media-sniffer/" + label.replace(/[^\w\u4e00-\u9fff]/g, "_") + "_" + Date.now() + ext;
    chrome.downloads.download({ url: blobUrl, filename, conflictAction: "uniquify" }, () => {
      if (chrome.runtime.lastError) addLog("保存失败: " + chrome.runtime.lastError.message);
      else addLog("已保存: " + label + " (" + (data.length / 1024 / 1024).toFixed(1) + "MB)");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
    });
  }

  async function downloadStreamData(resource, label) {
    const segs = resource._segments || [];
    if (!segs.length) throw new Error(label + "无片段");
    // 片段数多时并发下载
    if (segs.length > 5) {
      addLog(label + " " + segs.length + " 片段，并发下载...");
      const CONCURRENCY = 5;
      const bufs = new Array(segs.length);
      let failed = 0;
      let nextIdx = 0;
      const self = this;
      async function worker() {
        while (nextIdx < segs.length) {
          const i = nextIdx++;
          try { bufs[i] = await fetchSeg(segs[i]); }
          catch (e) { failed++; }
          const done = bufs.filter(b => b !== undefined).length;
          updateProgress(done, segs.length);
        }
      }
      const workers = [];
      for (let w = 0; w < Math.min(CONCURRENCY, segs.length); w++) workers.push(worker());
      await Promise.all(workers);
      const validBufs = bufs.filter(b => b !== undefined);
      if (!validBufs.length) throw new Error(label + "无可用片段");
      const len = validBufs.reduce((s, b) => s + b.length, 0);
      const out = new Uint8Array(len);
      let off = 0;
      for (const b of validBufs) { out.set(b, off); off += b.length; }
      addLog(label + "下载完成 " + (len / 1024 / 1024).toFixed(1) + "MB" + (failed ? " (" + failed + " 失败)" : ""));
      return out;
    }
    // 少量片段串行下载
    const bufs = [];
    let failed = 0;
    for (let i = 0; i < segs.length; i++) {
      try { bufs.push(await fetchSeg(segs[i])); }
      catch (e) { failed++; addLog(label + " 片段 " + (i + 1) + " 失败: " + e.message); }
      updateProgress(i + 1, segs.length);
    }
    if (!bufs.length) throw new Error(label + "无可用片段");
    const len = bufs.reduce((s, b) => s + b.length, 0);
    const out = new Uint8Array(len);
    let off = 0;
    for (const b of bufs) { out.set(b, off); off += b.length; }
    addLog(label + "下载完成 " + (len / 1024 / 1024).toFixed(1) + "MB" + (failed ? " (" + failed + " 失败)" : ""));
    return out;
  }

  async function downloadSingleStream(resource) {
    if (isDownloading) return;

    // 如果是视频流，自动查找匹配的音频流并合并
    if (resource._streamLabel === "视频流") {
      const matchedAudio = allResources.find(r =>
        r !== resource &&
        r.category === "video-stream" &&
        r._streamLabel === "音频流" &&
        extractVid(r.url) === extractVid(resource.url)
      );
      if (matchedAudio) {
        // 转为 paired-stream 下载
        const pairedRes = {
          type: "video", source: "network", category: "paired-stream",
          url: resource.url, _video: resource, _audio: matchedAudio, _streamLabel: "完整视频"
        };
        return downloadPairedStream(pairedRes);
      }
    }

    isDownloading = true;
    showPanel("下载" + (resource._streamLabel || "流媒体") + "...");
    try {
      const data = await downloadStreamData(resource, resource._streamLabel || "流媒体");
      saveBlob(data, resource._streamLabel || "流媒体", "video/mp4", ".mp4");
    }
    catch (e) { addLog("错误: " + e.message); setPanelTitle("下载失败"); }
    finally { isDownloading = false; }
  }

  // =========================================================
  // DOWNLOAD: SINGLE STREAM / HLS
  // =========================================================

  async function downloadHLS(url) {
    if (isDownloading) return;
    isDownloading = true;
    showPanel("解析 HLS...");
    try {
      let txt;
      try { const d = await mainWorldFetch(url); txt = new TextDecoder().decode(d); }
      catch { const d = await new Promise((res, rej) => chrome.runtime.sendMessage({ action: "proxyFetch", url, referer: currentPageOrigin }, r => { if (!r?.success) rej(new Error(r?.error || "代理失败")); else { const b = atob(r.data); const x = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) x[i] = b.charCodeAt(i); res(x); } })); txt = new TextDecoder().decode(d); }
      const p = parseM3U8(txt, url);
      if (p.isMaster && p.streams.length > 0) { isDownloading = false; await downloadHLS(p.streams.reduce((a, b) => a.bandwidth > b.bandwidth ? a : b).url); return; }
      if (!p.segments.length) { addLog("清单中无片段"); isDownloading = false; return; }
      setPanelTitle("HLS 下载 (" + p.segments.length + " 片段)");
      addLog("下载 " + p.segments.length + " 个片段...");
      const kc = new Map(); const bufs = new Array(p.segments.length); let fl = 0;
      // 并发下载（限制并发数避免浏览器注入限制）
      const CONCURRENCY = 5;
      let nextIdx = 0;
      async function worker() {
        while (nextIdx < p.segments.length) {
          const i = nextIdx++;
          try {
            let d = await fetchSeg(p.segments[i].url);
            if (p.segments[i].key?.uri) {
              if (!kc.has(p.segments[i].key.uri)) kc.set(p.segments[i].key.uri, await fetchSeg(p.segments[i].key.uri));
              d = await aesDec(d, kc.get(p.segments[i].key.uri), p.segments[i].key.iv || new Uint8Array(16));
            }
            bufs[i] = d;
          } catch (e) { fl++; }
          const done = bufs.filter(b => b !== undefined).length;
          updateProgress(done, p.segments.length);
        }
      }
      const workers = [];
      for (let w = 0; w < Math.min(CONCURRENCY, p.segments.length); w++) workers.push(worker());
      await Promise.all(workers);
      // 过滤掉未下载的片段
      const validBufs = bufs.filter(b => b !== undefined);
      await saveBufs(validBufs, "video/mp2t", ".ts", fl);
    } catch (e) { addLog("错误: " + e.message); setPanelTitle("失败"); }
    finally { isDownloading = false; }
  }

  async function aesDec(d, k, iv) { try { const ck = await crypto.subtle.importKey("raw", k, { name: "AES-CBC" }, false, ["decrypt"]); return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, ck, d)); } catch { return d; } }

  async function saveBufs(bufs, mime, ext, failed) {
    if (!bufs.length) { addLog("无可用片段"); return; }
    const len = bufs.reduce((s, b) => s + b.length, 0);
    addLog("合并 " + bufs.length + " 个片段 (" + (len / 1024 / 1024).toFixed(1) + "MB)...");
    const m = new Uint8Array(len); let o = 0; for (const b of bufs) { m.set(b, o); o += b.length; }
    try {
      const blob = new Blob([m], { type: mime });
      const bu = URL.createObjectURL(blob);
      const filename = "media-sniffer/video_" + Date.now() + ext;
      chrome.downloads.download({ url: bu, filename, conflictAction: "uniquify" }, (dlId) => {
        if (chrome.runtime.lastError) {
          addLog("下载保存失败: " + chrome.runtime.lastError.message);
        } else {
          addLog("完成! " + (len / 1024 / 1024).toFixed(1) + "MB" + (failed ? " (" + failed + " 失败)" : ""));
        }
        setPanelTitle("下载完成");
        setTimeout(() => URL.revokeObjectURL(bu), 120000);
      });
    } catch (e) {
      addLog("保存失败: " + e.message + "，尝试直接保存...");
      // fallback: 使用 chrome.downloads 直接下载
      const blob = new Blob([m], { type: mime });
      const reader = new FileReader();
      reader.onload = () => {
        const bu = reader.result;
        chrome.downloads.download({ url: bu, filename: "media-sniffer/video_" + Date.now() + ext, conflictAction: "uniquify" }, () => {
          addLog("完成! " + (len / 1024 / 1024).toFixed(1) + "MB");
          setPanelTitle("下载完成");
        });
      };
      reader.readAsDataURL(blob);
    }
  }

  // =========================================================
  // PANEL UI
  // =========================================================

  function showPanel(t) { downloadPanel.classList.add("active"); downloadPanelTitle.textContent = t; downloadProgressFill.style.width = "0%"; downloadProgressText.textContent = "0%"; downloadProgressDetail.textContent = ""; downloadLog.innerHTML = ""; }
  function setPanelTitle(t) { downloadPanelTitle.textContent = t; }
  function updateProgress(d, t) { const p = t > 0 ? Math.round(d / t * 100) : 0; downloadProgressFill.style.width = p + "%"; downloadProgressText.textContent = p + "%"; downloadProgressDetail.textContent = d + " / " + t + " 片段"; }
  function addLog(m) { const d = document.createElement("div"); d.textContent = m; downloadLog.appendChild(d); downloadLog.scrollTop = downloadLog.scrollHeight; }

  // =========================================================
  // SCAN & GROUP
  // =========================================================

  async function scanCurrentTab() {
    resourceList.innerHTML = '<div class="loading"><div class="spinner"></div>扫描中...</div>';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentPageTabId = tab.id;
      try { currentPageOrigin = new URL(tab.url).origin; } catch { currentPageOrigin = ""; }

      const cr = await new Promise(r => chrome.tabs.sendMessage(tab.id, { action: "scanMedia" }, res => r(chrome.runtime.lastError ? { resources: [] } : res || { resources: [] })));
      const vr = await new Promise(r => chrome.runtime.sendMessage({ action: "getVideoResources", pageUrl: tab.url }, res => r(chrome.runtime.lastError ? { videos: [] } : res || { videos: [] })));

      // 合并时优先使用带有 category 的资源（来自 background.js 网络拦截）
      const allMerged = [...cr.resources, ...vr.videos];
      const urlMap = new Map();
      for (const r of allMerged) {
        const existing = urlMap.get(r.url);
        if (!existing || (r.category && !existing.category)) {
          urlMap.set(r.url, r);
        }
      }
      const merged = Array.from(urlMap.values());

      allResources = groupAndPair(merged);
      pageTitle.textContent = cr.pageTitle || tab.title || "-";
      renderResources();
      if (!allResources.length) { resourceList.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>未发现媒体资源</p><p class="hint">播放视频后重试</p></div>'; totalCount.textContent = "0 个资源"; }
    } catch (e) { resourceList.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>扫描失败</p><p class="hint">' + esc(e.message) + '</p></div>'; }
  }

  function groupAndPair(resources) {
    const result = [];
    const m4sMap = new Map();
    const tsMap = new Map();

    for (const r of resources) {
      if (r.category === "m4s-segment") {
        const k = getM4SKey(r.url);
        if (!m4sMap.has(k)) m4sMap.set(k, { url: r.url, type: "video", source: "network", category: "video-stream", _segments: [], _streamLabel: guessLabel(r.url) });
        const stream = m4sMap.get(k);
        // 去重：同一个 URL 不重复加入
        if (!stream._segments.includes(r.url)) stream._segments.push(r.url);
      } else if (r.category === "ts-segment") {
        // TS 流片段拼接后无法直接播放，对用户无用，跳过
        continue;
      } else {
        result.push(r);
      }
    }

    // 排序 m4s 段：init 段在前，data 段按序号排列；并更新流 URL 为首段
    for (const stream of m4sMap.values()) {
      stream._segments = sortM4SSegments(stream._segments);
      if (stream._segments.length > 0) stream.url = stream._segments[0];
    }

    const allStreams = [...m4sMap.values(), ...tsMap.values()];

    // 配对: 同一视频ID的视频流+音频流
    const videos = allStreams.filter(s => s._streamLabel === "视频流");
    const audios = allStreams.filter(s => s._streamLabel === "音频流");
    const usedA = new Set();
    const usedV = new Set();

    for (const vs of videos) {
      const vid = extractVid(vs.url);
      const ai = audios.findIndex((a, i) => !usedA.has(i) && extractVid(a.url) === vid);
      if (ai >= 0) {
        usedA.add(ai);
        usedV.add(vs);
        result.push({ type: "video", source: "network", category: "paired-stream", url: vs.url, _video: vs, _audio: audios[ai], _streamLabel: "完整视频" });
      }
    }
    // 未配对的视频流单独显示
    for (const vs of videos) { if (!usedV.has(vs)) result.push(vs); }
    // 所有音频流都保留显示（配对后也保留，方便用户单独下载音频）
    for (const a of audios) result.push(a);
    // 非视频流/音频流的 stream
    for (const s of allStreams) {
      if (s._streamLabel !== "视频流" && s._streamLabel !== "音频流") result.push(s);
    }

    return result;
  }

  // B站音频质量ID集合
  const AUDIO_QUALITY_IDS = new Set(["30216", "30232", "30280", "30264", "30250", "30251", "30266"]);

  // 验证 URL 是否指向真正的媒体文件（排除 .webmask 等误判）
  const REAL_MEDIA_EXTS = /\.(mp4|webm|mov|flv|mkv|avi|m4v|mp3|wav|ogg|aac|flac|m4a|wma|opus|m3u8|mpd|ts|m4s)(\?|$)/i;
  function isRealMediaUrl(url) {
    if (!url) return false;
    if (REAL_MEDIA_EXTS.test(url)) return true;
    if (url.includes("/videoplayback")) return true;
    return false;
  }

  // 从 m4s 文件名中提取"init base"（去掉段号部分）
  // init: 38368381774-1-100026 → 38368381774-1-100026
  // data: 38368381774-1-100026-1 → 38368381774-1-100026 (去掉末尾段号)
  // data: 38368381774-1-100026-2 → 38368381774-1-100026
  function getM4SInitBase(url) {
    try {
      const fn = new URL(url).pathname.split("/").pop() || "";
      const base = fn.replace(/\.m4s$/i, "");
      const parts = base.split("-");
      // 如果最后一段是纯数字且文件名超过3段，视为段号，去掉
      if (parts.length > 3 && /^\d+$/.test(parts[parts.length - 1])) {
        return parts.slice(0, -1).join("-");
      }
      return base;
    } catch { return url; }
  }

  // 按 init base + 目录 分组，确保 init 和 data 段在同一组
  function getM4SKey(url) {
    try {
      const u = new URL(url);
      const dirPath = u.pathname.substring(0, u.pathname.lastIndexOf("/"));
      return u.origin + dirPath + ":" + getM4SInitBase(url);
    } catch { return url.substring(0, url.lastIndexOf("/")); }
  }

  function sortM4SSegments(segments) {
    return [...segments].sort((a, b) => {
      const ka = getM4SSortKey(a);
      const kb = getM4SSortKey(b);
      if (ka.isInit !== kb.isInit) return ka.isInit ? -1 : 1;
      return ka.segNum - kb.segNum;
    });
  }

  function getM4SSortKey(url) {
    try {
      const fn = new URL(url).pathname.split("/").pop() || "";
      const base = fn.replace(/\.m4s$/i, "");
      const parts = base.split("-");
      // init 段: 段数 <= 3 (如 {videoId}-{part}-{qualityId}.m4s)
      // data 段: 段数 > 3 且最后一段是纯数字段号
      if (parts.length <= 3) return { isInit: true, segNum: 0 };
      if (/^\d+$/.test(parts[parts.length - 1])) {
        return { isInit: false, segNum: parseInt(parts[parts.length - 1]) || 0 };
      }
      // 非标准格式，当作 init
      return { isInit: true, segNum: 0 };
    } catch {
      return { isInit: false, segNum: 0 };
    }
  }

  // 判断 m4s 流是视频还是音频：扫描文件名所有部分，查找音频质量ID
  function guessLabel(url) {
    try {
      const fn = new URL(url).pathname.split("/").pop() || "";
      const base = fn.replace(/\.m4s$/i, "");
      const parts = base.split("-");
      // 扫描所有部分，只要有音频质量ID就是音频流
      if (parts.some(p => AUDIO_QUALITY_IDS.has(p))) return "音频流";
      // URL 模式匹配（非B站格式）
      const l = url.toLowerCase();
      if (l.includes("/audio/") || l.includes("/a/") || l.includes("-audio-") || l.includes("_audio_")) return "音频流";
      return "视频流";
    } catch { return "视频流"; }
  }

  // 从URL提取视频ID：同时从路径目录和文件名中提取最长数字段
  function extractVid(url) {
    try {
      const u = new URL(url);
      const candidates = [];
      // 从路径目录中提取纯数字段
      u.pathname.split("/").forEach(p => { if (/^\d+$/.test(p)) candidates.push(p); });
      // 从文件名中提取第一段数字（videoId）
      const fn = u.pathname.split("/").pop() || "";
      const fnFirst = fn.replace(/\.m4s$/i, "").split("-")[0];
      if (fnFirst && /^\d+$/.test(fnFirst)) candidates.push(fnFirst);
      if (candidates.length > 0) {
        return candidates.reduce((a, b) => b.length >= a.length ? b : a, "");
      }
      return u.pathname;
    } catch { return ""; }
  }

  function getPrefix(url) {
    try { const u = new URL(url); const p = u.pathname.split("/"); p.pop(); return u.origin + p.join("/"); }
    catch { return url.substring(0, Math.max(url.lastIndexOf("/"), 1)); }
  }

  // =========================================================
  // RENDER
  // =========================================================

  function getFilteredResources() {
    if (currentFilter === "all") return allResources;
    return allResources.filter(r => {
      // 音频流 type 是 "video" 但应该归入"音频"筛选
      if (currentFilter === "audio" && r.category === "video-stream" && r._streamLabel === "音频流") return true;
      if (currentFilter === "video" && r.category === "video-stream" && r._streamLabel === "音频流") return false;
      return r.type === currentFilter;
    });
  }

  function renderResources() {
    const filtered = getFilteredResources();
    totalCount.textContent = filtered.length + " 个资源";
    if (!filtered.length) { resourceList.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>未发现' + ({ all: "", image: "图片", video: "视频", audio: "音频" }[currentFilter] || "") + '资源</p></div>'; return; }

    resourceList.innerHTML = filtered.map((r, i) => {
      const gi = allResources.indexOf(r);
      const isImg = r.type === "image";
      const isPaired = r.category === "paired-stream";
      const isHLS = r.category === "manifest";
      const isDASH = r.category === "dash";
      const isVFile = r.category === "video";
      const isStream = r.category === "video-stream";
      const isAudioStream = isStream && r._streamLabel === "音频流";

      // 名称
      let name;
      if (isPaired) name = "视频";
      else if (isAudioStream) name = "音频";
      else if (isStream) name = r._streamLabel || "流媒体";
      else name = getFilename(r.url);

      // category 标签
      let cat = "";
      if (isHLS) cat = '<span class="resource-category manifest">HLS</span>';
      else if (isDASH) cat = '<span class="resource-category dash">DASH</span>';
      else if (isVFile) cat = '<span class="resource-category video">视频文件</span>';
      else if (isAudioStream) cat = '<span class="resource-category stream">音频</span>';
      else if (isStream) cat = '<span class="resource-category stream">' + esc(r._streamLabel || "") + '</span>';

      // 按钮
      let btns = "";
      if (isImg) btns = '<button class="btn-preview" data-url="' + esc(r.url) + '">预览</button><button class="btn-download" data-index="' + gi + '">下载</button>';
      else if (isPaired) btns = '<button class="btn-merge" data-index="' + gi + '">下载</button>';
      else if (isHLS) btns = '<button class="btn-merge" data-index="' + gi + '">合并下载</button><button class="btn-copy" data-url="' + esc(r.url) + '">复制链接</button>';
      else if (isDASH) btns = '<button class="btn-copy" data-url="' + esc(r.url) + '">复制链接</button>';
      else if (isAudioStream) btns = '<button class="btn-merge" data-index="' + gi + '">下载</button>';
      else if (isStream) btns = '<button class="btn-merge" data-index="' + gi + '">合并下载</button><button class="btn-copy" data-url="' + esc(r.url) + '">复制链接</button>';
      else if (isVFile) btns = '<button class="btn-download" data-index="' + gi + '">下载</button>';
      else btns = '<button class="btn-download" data-index="' + gi + '">下载</button>';

      // type 显示
      const displayType = isAudioStream ? "audio" : r.type;
      const typeLabel = { image: "图片", video: "视频", audio: "音频" }[displayType] || displayType;
      // 图标
      const thumbIcon = isAudioStream ? "🎵" : "🎬";

      return '<div class="resource-item" data-type="' + displayType + '">' +
        (isImg ? '<img class="resource-thumb" src="' + esc(r.url) + '" alt="" loading="lazy">' : '<div class="resource-thumb video-thumb">' + thumbIcon + '</div>') +
        '<div class="resource-info"><div class="resource-url" title="' + esc(r.url) + '">' + esc(name) + '</div>' +
        '<div class="resource-meta"><span class="resource-type ' + displayType + '">' + typeLabel + '</span>' + cat +
        '<span class="resource-source">' + esc(r.source) + '</span></div></div>' +
        '<div class="resource-actions">' + btns + '</div></div>';
    }).join("");
  }

  function getFilename(u) { try { return decodeURIComponent(new URL(u).pathname.split("/").pop() || "") || new URL(u).hostname; } catch { return u.substring(0, 40); } }
  function esc(s) { return s ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : ""; }

  async function doDownload(r) {
    if (!r?.url) return;
    const isStream = r.category === "video-stream" || r.category === "paired-stream" || r.category === "manifest" || r.category === "dash";
    if (isStream) return; // 流媒体走专门的下载流程
    // 对于视频文件，使用proxyFetch确保带Referer/Cookie下载完整内容
    if (r.type === "video" || r.type === "audio") {
      if (isDownloading) return;
      isDownloading = true;
      showPanel("下载中...");
      try {
        const data = await fetchSeg(r.url);
        saveBlob(data, getFilename(r.url), r.type === "video" ? "video/mp4" : "audio/mpeg", r.url.match(/\.\w+(\?|$)/)?.[0]?.replace("?", "") || (r.type === "video" ? ".mp4" : ".mp3"));
      } catch (e) {
        // fallback: 直接URL下载
        addLog("带认证下载失败，尝试直接下载: " + e.message);
        chrome.downloads.download({ url: r.url, filename: genFn(r), conflictAction: "uniquify" });
      } finally { isDownloading = false; }
      return;
    }
    chrome.downloads.download({ url: r.url, filename: genFn(r), conflictAction: "uniquify" });
  }
  function genFn(r) {
    try { let f = decodeURIComponent(new URL(r.url).pathname.split("/").pop() || ""); if (!f.includes(".")) f += "." + (r.url.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|mp3|wav|ogg|aac|flac|m3u8|mpd|m4s|ts)(\?|$)/i)?.[1] || "mp4"); f = f.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_"); return "media-sniffer/" + (r.type === "image" ? "img" : "video") + "_" + f; }
    catch { return "media-sniffer/" + r.type + "_" + Date.now() + ".mp4"; }
  }

  scanCurrentTab();
})();
