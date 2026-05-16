# Media Sniffer - 媒体资源嗅探插件

基于 **Manifest V3** 的浏览器插件，自动嗅探并下载网页中的图片、音频、视频等媒体资源。

## 功能特性

- **自动扫描**：页面加载后自动检测媒体资源
- **多类型支持**：图片（jpg/png/gif/webp/svg 等）、视频（mp4/webm/mov 等）、音频（mp3/wav/aac 等）
- **智能识别**：支持 `<img>`、`<video>`、`<audio>`、CSS 背景图、懒加载属性、JSON-LD 等多种来源
- **网络拦截**：拦截 fetch/XHR 请求捕获动态加载的资源
- **分类过滤**：按图片/视频/音频分类查看
- **一键下载**：单个下载或批量全部下载
- **图片预览**：点击预览按钮在新标签页查看图片

## 目录结构

```
plugin/
├── manifest.json      # 插件配置
├── background.js      # Service Worker 后台脚本
├── content.js         # 内容脚本（媒体扫描）
├── content.css        # 内容脚本样式
├── popup.html         # 弹窗页面
├── popup.js           # 弹窗逻辑（资源列表+下载）
├── popup.css          # 弹窗样式
├── icons/             # 图标
└── README.md          # 说明文档
```

## 安装方法

1. 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本文件夹目录

## 使用方法

1. 打开任意网页
2. 点击浏览器工具栏中的插件图标
3. 插件会自动扫描页面中的媒体资源
4. 使用顶部分类按钮过滤资源类型
5. 点击 **下载** 按钮下载单个资源
6. 点击 **全部下载** 批量下载所有资源
7. 点击图片资源旁的 **预览** 按钮在新标签页查看

## 支持的资源类型

| 类型 | 扩展名 |
|------|--------|
| 图片 | jpg, jpeg, png, gif, webp, svg, bmp, ico, avif, tiff |
| 视频 | mp4, webm, ogg, ogv, mov, avi, mkv, flv, wmv, m4v, 3gp |
| 音频 | mp3, wav, ogg, oga, aac, flac, m4a, wma, opus |

## 资源检测方式

- **DOM 元素**：`<img>`, `<video>`, `<audio>`, `<source>`, `<picture>`, `<a>`
- **CSS 背景**：`background-image` 样式
- **懒加载**：`data-src`, `data-lazy-src`, `data-original` 等属性
- **网络请求**：拦截 `fetch()` 和 `XMLHttpRequest`
- **结构化数据**：JSON-LD 脚本中的媒体 URL
- **预加载**：`<link rel="preload">` 标签

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 本地数据存储 |
| `activeTab` | 访问当前活动标签页 |
| `scripting` | 动态注入脚本 |
| `downloads` | 下载媒体文件 |
| `tabs` | 获取标签页信息 |
| `<all_urls>` | 在所有网页中运行 |

## 开发调试

- **调试 Popup**：右键点击插件图标 → **检查弹出内容**
- **调试 Content Script**：打开网页的开发者工具（F12）→ Console
- **调试 Background**：`chrome://extensions/` → 点击插件的 `service worker` 链接

## 注意事项

- 某些网站可能使用 CORS 限制或防盗链，导致资源无法直接下载
- 动态加载的资源可能需要等待页面完全加载后才能被检测到
- 部分视频流（如 HLS/m3u8、DASH）需要额外处理，当前版本不支持

## 参考资源

- [Chrome Extensions 官方文档](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 迁移指南](https://developer.chrome.com/docs/extensions/migrating/)
- [Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
