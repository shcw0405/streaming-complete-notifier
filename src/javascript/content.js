// Content Script - 注入页面脚本并转发消息到 background
(function() {
  'use strict';

  const hostname = window.location.hostname;
  // 无条件 boot 日志：用于确认 content script 已运行
  console.log('[ChatGPT-Tap][Boot] content.js 已运行 @', hostname);

  // 注入 page script 到页面上下文
  function injectPageScript(scriptName) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(scriptName);
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // 监听来自 page script 的消息
  window.addEventListener('message', (event) => {
    // 只处理来自同源的消息
    if (event.source !== window) return;

    const message = event.data;
    if (!message) return;

    // 支持 ChatGPT、Gemini 和 Grok 三种来源
    if (message.source !== 'chatgpt-reasoning-tap' && message.source !== 'gemini-prompt-tap' && message.source !== 'grok-prompt-tap') return;

    // 转发到 background script
    chrome.runtime.sendMessage({
      action: 'chatgptStreamEvent',
      eventType: message.type,
      eventData: message.data,
      timestamp: message.timestamp,
      url: window.location.href
    }).catch(err => {
      // 忽略扩展上下文失效的错误
      if (!err.message?.includes('Extension context invalidated')) {
        console.error('[Content] Send message error:', err);
      }
    });
  });

  // 根据页面域名注入对应的 hook 脚本
  function inject() {
    // 根据设置注入 Visibility API 伪装脚本（防止 AI 页面在后台暂停）
    chrome.storage.sync.get({ tabKeepAliveEnabled: false }, (result) => {
      if (result.tabKeepAliveEnabled) {
        injectPageScript('visibilitySpoof.js');
      }
    });

    if (hostname.includes('chatgpt.com')) {
      injectPageScript('pageHook.js');
    } else if (hostname.includes('gemini.google.com')) {
      injectPageScript('geminiHook.js');
    } else if (hostname.includes('grok.com')) {
      injectPageScript('grokHook.js');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
