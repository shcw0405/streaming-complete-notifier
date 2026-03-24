// Grok Prompt 捕获脚本 - 通过拦截 fetch 请求体提取用户提问
(function() {
  'use strict';

  if (window.__grokPromptTapInjected) return;
  window.__grokPromptTapInjected = true;

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    // 匹配 Grok 的对话请求
    if (url && /\/rest\/app-chat\/conversations\/[^/]+\/responses$/.test(url) && args[1]?.body) {
      try {
        let bodyContent = null;
        if (typeof args[1].body === 'string') {
          bodyContent = args[1].body;
        } else if (args[1].body instanceof Uint8Array) {
          bodyContent = new TextDecoder().decode(args[1].body);
        }

        if (bodyContent) {
          const reqData = JSON.parse(bodyContent);
          if (reqData.message && typeof reqData.message === 'string') {
            let prompt = reqData.message.trim();
            if (prompt.length > 35) prompt = prompt.substring(0, 35) + '...';
            window.postMessage({
              source: 'grok-prompt-tap',
              type: 'grok_prompt_captured',
              data: { prompt },
              timestamp: Date.now()
            }, '*');
          }
        }
      } catch (e) {
        // 静默忽略解析错误
      }
    }

    return originalFetch.apply(this, args);
  };
})();
