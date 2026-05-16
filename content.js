// Content Script - 内容脚本
// 注入到网页中，可以操作 DOM

(function () {
  console.log("Content Script 已加载");

  // 创建示例浮动按钮
  function createFloatingButton() {
    const button = document.createElement("div");
    button.id = "extension-floating-btn";
    button.innerHTML = "🔧";
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 50px;
      height: 50px;
      background: #4285f4;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      z-index: 999999;
      font-size: 24px;
      transition: transform 0.2s;
    `;
    
    button.addEventListener("mouseenter", () => {
      button.style.transform = "scale(1.1)";
    });
    
    button.addEventListener("mouseleave", () => {
      button.style.transform = "scale(1)";
    });
    
    button.addEventListener("click", () => {
      // 点击时向 background 发送消息
      chrome.runtime.sendMessage(
        { action: "getData" },
        (response) => {
          console.log("收到响应:", response);
          alert("按钮被点击！");
        }
      );
    });
    
    document.body.appendChild(button);
  }

  // 页面加载完成后创建按钮
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createFloatingButton);
  } else {
    createFloatingButton();
  }
})();
