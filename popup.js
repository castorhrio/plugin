// Popup 脚本
document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("saveBtn");
  const loadBtn = document.getElementById("loadBtn");
  const status = document.getElementById("status");

  // 保存数据
  saveBtn.addEventListener("click", () => {
    chrome.storage.local.set({ key: "Hello from Popup!" }, () => {
      status.textContent = "数据已保存";
      status.style.background = "#e6f4ea";
    });
  });

  // 读取数据
  loadBtn.addEventListener("click", () => {
    chrome.storage.local.get(["key"], (result) => {
      status.textContent = result.key ? `读取到: ${result.key}` : "无数据";
      status.style.background = "#fce8e6";
    });
  });

  // 向当前标签页注入脚本
  const injectBtn = document.createElement("button");
  injectBtn.textContent = "注入脚本";
  injectBtn.style.background = "#34a853";
  saveBtn.parentNode.appendChild(injectBtn);

  injectBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    status.textContent = "脚本已注入";
    status.style.background = "#e8f0fe";
  });
});
