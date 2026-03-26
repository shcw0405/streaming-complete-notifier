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
  // 标签页保活功能 - 防止 Chrome 冻结/丢弃后台标签页
  // ===========================================

  let keepAliveAudioCtx = null;
  let keepAliveOscillator = null;
  let keepAliveStarted = false;

  function startKeepAlive() {
    if (keepAliveStarted) return;
    keepAliveStarted = true;

    // 在用户首次交互后启动 AudioContext（满足 Autoplay Policy）
    function initAudio() {
      if (keepAliveAudioCtx) return;
      try {
        keepAliveAudioCtx = new AudioContext();
        // 创建一个几乎无声的振荡器，让 Chrome 认为标签页在播放音频
        // Chrome 不会冻结或丢弃正在播放音频的标签页
        keepAliveOscillator = keepAliveAudioCtx.createOscillator();
        const gainNode = keepAliveAudioCtx.createGain();
        gainNode.gain.value = 0.0001; // 几乎无声，人耳不可感知
        keepAliveOscillator.connect(gainNode);
        gainNode.connect(keepAliveAudioCtx.destination);
        keepAliveOscillator.start();
      } catch (e) {
        // 静默忽略
      }
    }

    // AudioContext 需要用户交互后才能启动，监听首次交互
    const interactionEvents = ['click', 'keydown', 'touchstart'];
    function onFirstInteraction() {
      interactionEvents.forEach(evt => document.removeEventListener(evt, onFirstInteraction, true));
      initAudio();
    }
    interactionEvents.forEach(evt => document.addEventListener(evt, onFirstInteraction, true));

    // 如果页面已有用户交互历史，直接尝试启动
    initAudio();
    if (keepAliveAudioCtx && keepAliveAudioCtx.state === 'suspended') {
      // 需要等用户交互，上面的监听器会处理
    }
  }

  function stopKeepAlive() {
    keepAliveStarted = false;
    if (keepAliveOscillator) {
      try { keepAliveOscillator.stop(); } catch (e) {}
      keepAliveOscillator = null;
    }
    if (keepAliveAudioCtx) {
      try { keepAliveAudioCtx.close(); } catch (e) {}
      keepAliveAudioCtx = null;
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
