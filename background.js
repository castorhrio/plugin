// Service Worker - 后台脚本
// 在 Manifest V3 中，background page 被替换为 service worker

// 插件安装时触发
chrome.runtime.onInstalled.addListener((details) => {
  console.log("插件已安装", details);
});

// 监听来自 popup 或 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("收到消息:", message);
  
  switch (message.action) {
    case "getData":
      // 从 storage 获取数据
      chrome.storage.local.get(["key"], (result) => {
        sendResponse({ data: result.key });
      });
      return true; // 保持消息通道开放以支持异步响应
      
    case "setData":
      // 保存数据到 storage
      chrome.storage.local.set({ key: message.value }, () => {
        sendResponse({ success: true });
      });
      return true;
      
    default:
      sendResponse({ error: "未知操作" });
      return false;
  }
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    console.log("页面加载完成:", tab.url);
  }
});
