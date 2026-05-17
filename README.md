# Media Sniffer

> 基于 Manifest V3 的浏览器媒体资源嗅探插件，支持图片、音频、视频的一键扫描与下载，具备完整的流媒体（HLS/DASH）下载与合并能力。

<p align="center">
  <img src="icons/icon128.png" alt="Media Sniffer" width="128">
</p>

---

## 功能特性

### 资源检测
- **DOM 扫描**：`<img>`、`<video>`、`<audio>`、`<source>`、`<picture>`、`<a>`、CSS 背景图
- **懒加载属性**：`data-src`、`data-lazy-src`、`data-original` 等
- **网络拦截**：Hook `fetch()` 与 `XMLHttpRequest`，捕获动态加载的媒体
- **结构化数据**：JSON-LD 脚本中的媒体 URL、`<link rel="preload">`
- **背景拦截**：通过 `webRequest` API 在 Service Worker 层捕获所有网络媒体请求

### 流媒体支持
- **HLS (m3u8)**：完整解析多级清单，自动选择最高码率，AES-128 解密，并发下载 TS 片段并拼接
- **DASH (mpd/m4s)**：自动识别视频/音频分离流，fMP4 Remuxer 合并视频+音频为完整 MP4
- **配对流合并**：DASH 视频流与音频流自动配对，一键下载合并后的完整视频

### 站点适配
| 站点 | 能力 |
|------|------|
| **Instagram / Threads** | CDN 认证图片/视频提取，og 标签 + 内嵌 JSON 解析 |
| **X / Twitter** | 图片质量选择（`?format=`），视频 variants 自动选最高码率 |
| **YouTube** | `ytInitialPlayerResponse` 解析，直接 URL 提取，跳过签名加密流 |

### 交互功能
- 按图片/视频/音频分类过滤
- 单个下载、批量全部下载、复制链接
- 图片预览、流媒体合并下载进度条
- 暗色主题 UI（400×500px popup）

---

## 项目结构

```
plugin/
├── manifest.json          # 插件配置 (Manifest V3)
├── background.js          # Service Worker：网络拦截、代理下载
├── content.js             # Content Script：DOM 扫描、fetch/XHR 拦截、站点适配
├── content.css            # 页面浮动按钮样式
├── popup.html             # 弹窗页面
├── popup.js               # 弹窗逻辑：资源列表、下载、流媒体合并
├── popup.css              # 弹窗样式（暗色主题）
├── icons/                 # 插件图标 (16/48/128)
└── README.md
```

---

## 安装方法

### Chrome / Edge

1. 打开浏览器，地址栏输入 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本项目根目录
5. 插件图标出现在工具栏，完成安装

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 **临时载入附加组件**
3. 选择 `manifest.json`

---

## 使用说明

### 基本操作

| 操作 | 方式 |
|------|------|
| 打开插件 | 点击浏览器工具栏的 Media Sniffer 图标 |
| 扫描资源 | 点击 ☰ 按钮手动刷新，或切换标签页自动扫描 |
| 筛选类型 | 点击顶部 **全部 / 图片 / 视频 / 音频** 按钮 |
| 下载单个 | 点击资源右侧 **下载** 按钮 |
| 批量下载 | 点击 **全部下载**，按 500ms 间隔依次下载 |
| 复制链接 | 点击 **复制链接**，自动写入剪贴板 |
| 预览图片 | 点击图片资源的 **预览** 按钮，在新标签页打开 |

### 流媒体下载

| 资源类型 | 显示标签 | 操作 |
|----------|----------|------|
| HLS 清单 | `HLS` | 点击 **合并下载**，自动解析并下载所有 TS 片段，AES 解密后合并为 `.ts` 文件 |
| DASH 清单 | `DASH` | 点击 **复制链接**，获取 mpd 地址 |
| m4s 视频流 | `视频流` | 点击 **合并下载**，下载视频流片段并保存为 `.mp4` |
| m4s 音频流 | `音频` | 点击 **下载**，下载音频流片段并保存为 `.mp4` |
| 配对流 | `完整视频` | 自动合并视频+音频流，输出完整带音轨的 `.mp4`（fMP4 Remuxer） |

> **提示**：打开目标页面的视频播放，等待视频开始缓冲后再点击插件图标，即可自动捕获流媒体资源。

---

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 存储插件设置 |
| `activeTab` | 访问当前活动标签页 |
| `scripting` | 注入脚本执行 DOM 扫描与 Main World fetch |
| `downloads` | 保存媒体文件到本地 |
| `tabs` | 获取页面 URL 与标签页信息 |
| `webRequest` | Service Worker 层拦截网络请求 |
| `cookies` | 代理下载时携带 Cookie（CDN 认证） |
| `host_permissions: <all_urls>` | 在所有网站运行内容脚本与网络拦截 |

---

## 调试

| 调试目标 | 方法 |
|----------|------|
| **Popup** | 右键插件图标 → **检查弹出内容** |
| **Content Script** | 打开网页 F12 → Console（过滤当前页面） |
| **Service Worker** | `chrome://extensions/` → 点击插件的 `service worker` 链接 |

---

## 技术实现

### fMP4 Remuxer

内嵌轻量级 ISOBMFF (MP4) 解析与重写器，支持：
- Box 结构扫描（ftyp / moov / moof / mdat）
- track_ID 重映射（避免合并后 ID 冲突）
- moov 重建：合并视频+音频 trak，重建 mvex/trex
- mvhd `next_track_id` 修正
- base_data_offset 回填修复

### 下载代理

`background.js` 中的 `proxyFetch` 通过 Service Worker 发起带 Cookie、Referer、Origin、User-Agent 的 fetch 请求，绕过：
- CORS 限制
- CDN Referer 校验（Instagram、Twitter、YouTube）
- 防盗链策略

### 站点适配架构

```text
content.js
  ├── extractSiteSpecificMedia()     # 站点分发
  │   ├── extractInstagramMedia()    # Instagram / Threads
  │   ├── extractTwitterMedia()      # X / Twitter
  │   └── extractYouTubeMedia()      # YouTube
  ├── interceptNetworkRequests()     # fetch / XHR Hook
  ├── observeVideoElements()         # MutationObserver
  └── SPA 路由变化监听               # 定时 + URL 变化检测
```

---

## License

MIT
