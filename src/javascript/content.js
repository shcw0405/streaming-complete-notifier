// Content Script - 注入页面脚本并转发消息到 background
(function() {
  'use strict';

  const hostname = window.location.hostname;

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

  // ===========================================
  // 标签页保活功能 - 防止 Chrome 冻结后台标签页
  // ===========================================

  let keepAliveWorker = null;

  function startKeepAlive() {
    if (keepAliveWorker) return;

    // 用 inline Web Worker 周期性发送消息，阻止 Chrome 冻结标签页
    const workerCode = `
      let intervalId = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (intervalId) clearInterval(intervalId);
          intervalId = setInterval(() => { self.postMessage('ping'); }, 20000);
        } else if (e.data === 'stop') {
          if (intervalId) { clearInterval(intervalId); intervalId = null; }
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    keepAliveWorker = new Worker(URL.createObjectURL(blob));
    keepAliveWorker.onmessage = () => {
      // 收到 ping 即可，保持主线程活跃
    };
    keepAliveWorker.postMessage('start');
  }

  function stopKeepAlive() {
    if (keepAliveWorker) {
      keepAliveWorker.postMessage('stop');
      keepAliveWorker.terminate();
      keepAliveWorker = null;
    }
  }

  // 根据设置决定是否启用保活
  function updateKeepAlive() {
    chrome.storage.sync.get({ tabKeepAliveEnabled: false }, (result) => {
      if (result.tabKeepAliveEnabled) {
        startKeepAlive();
      } else {
        stopKeepAlive();
      }
    });
  }

  // 监听设置变化，实时响应开关
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.tabKeepAliveEnabled) {
      if (changes.tabKeepAliveEnabled.newValue) {
        startKeepAlive();
      } else {
        stopKeepAlive();
      }
    }
  });

  updateKeepAlive();

  // ===========================================
  // 注入 hook 脚本
  // ===========================================

  // 根据页面域名注入对应的 hook 脚本
  function inject() {
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
