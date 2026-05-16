# 浏览器插件模板

基于 **Manifest V3** 的浏览器插件基础框架，适用于 Chrome、Edge、Arc 等 Chromium 内核浏览器。

## 目录结构

```
plugin/
├── manifest.json      # 插件配置文件（必需）
├── background.js      # Service Worker 后台脚本
├── content.js         # 内容脚本（注入网页）
├── content.css        # 内容脚本样式
├── popup.html         # 弹窗页面
├── popup.js           # 弹窗逻辑
├── popup.css          # 弹窗样式
├── icons/             # 图标文件夹
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md          # 说明文档
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `manifest.json` | 插件核心配置，定义权限、脚本入口、图标等 |
| `background.js` | 后台服务脚本，处理事件、消息通信、长期运行逻辑 |
| `content.js` | 内容脚本，注入到网页中，可操作 DOM |
| `content.css` | 内容脚本的样式文件 |
| `popup.html` | 点击插件图标时弹出的窗口 |
| `popup.js` | 弹窗的交互逻辑 |
| `popup.css` | 弹窗的样式 |

## 快速开始

### 1. 安装到浏览器

1. 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本文件夹目录

### 2. 测试功能

- 点击插件图标，打开弹窗
- 点击 **保存数据** / **读取数据** 测试 storage API
- 打开任意网页，右下角会出现 🔧 浮动按钮

## 核心概念

### Manifest V3

Google 推出的新版插件规范，主要变化：
- `background page` → `service worker`
- 禁止远程执行代码
- 更严格的权限管理

### 三种脚本类型

| 类型 | 运行环境 | 权限 |
|------|----------|------|
| **Background** | 插件后台 | 完整 API 权限 |
| **Content Script** | 网页上下文 | 有限的 DOM 操作 |
| **Popup** | 弹窗上下文 | 完整 API 权限 |

### 消息通信

```
Popup/Content Script  ←→  chrome.runtime.sendMessage()  ←→  Background
```

**发送消息：**
```javascript
chrome.runtime.sendMessage({ action: "getData" }, (response) => {
  console.log(response);
});
```

**接收消息（background.js）：**
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  sendResponse({ data: "hello" });
  return true; // 异步响应必需
});
```

## 常用 API

### Storage（本地存储）

```javascript
// 保存
chrome.storage.local.set({ key: "value" });

// 读取
chrome.storage.local.get(["key"], (result) => {
  console.log(result.key);
});
```

### Tabs（标签页）

```javascript
// 获取当前标签页
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

// 创建新标签页
chrome.tabs.create({ url: "https://example.com" });
```

### Scripting（脚本注入）

```javascript
await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  files: ["content.js"],
});
```

## 开发建议

1. **调试 Background**：在 `chrome://extensions/` 点击插件的 `service worker` 链接
2. **调试 Content Script**：打开网页的开发者工具（F12）
3. **调试 Popup**：右键点击插件图标 → **检查弹出内容**
4. **热重载**：Manifest V3 不支持热重载，修改后需点击刷新按钮

## 打包发布

1. 在 `chrome://extensions/` 点击 **打包扩展程序**
2. 选择插件根目录
3. 生成 `.crx` 文件和私钥
4. 提交到 Chrome Web Store 或企业内部部署

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 本地数据存储 |
| `activeTab` | 访问当前活动标签页 |
| `scripting` | 动态注入脚本 |
| `host_permissions` | 允许访问的主机范围 |

## 扩展开发

在此模板基础上，你可以添加：
- 选项页面（options page）
- 侧边栏（side panel）
- 右键菜单（context menus）
- DevTools 面板
- 内容安全策略配置

## 参考资源

- [Chrome Extensions 官方文档](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 迁移指南](https://developer.chrome.com/docs/extensions/migrating/)
- [Extensions API 参考](https://developer.chrome.com/docs/extensions/reference/)
