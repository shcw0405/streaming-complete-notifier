// Grok Prompt 捕获脚本 - 监听用户输入并发送到后台
(function() {
  'use strict';

  if (window.__grokPromptTapInjected) return;
  window.__grokPromptTapInjected = true;

  let lastTypedPrompt = '';

  // Grok 使用 textarea 或 contenteditable 输入框
  document.addEventListener('input', (e) => {
    const target = e.target;
    if (target && target.tagName) {
      const text = target.innerText || target.value || target.textContent;
      if (text && text.trim().length > 0) {
        lastTypedPrompt = text.trim();
      }
    }
  }, true);

  function sendPrompt() {
    if (!lastTypedPrompt) return;
    let prompt = lastTypedPrompt;
    if (prompt.length > 35) prompt = prompt.substring(0, 35) + '...';
    window.postMessage({
      source: 'grok-prompt-tap',
      type: 'grok_prompt_captured',
      data: { prompt },
      timestamp: Date.now()
    }, '*');
    lastTypedPrompt = '';
  }

  // 监听 Enter 发送
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      sendPrompt();
    }
  }, true);

  // 监听发送按钮点击
  document.addEventListener('click', (e) => {
    const sendBtn = e.target.closest('button[aria-label*="Send"], button[aria-label*="发送"], button[type="submit"]');
    if (sendBtn) {
      sendPrompt();
    }
  }, true);
})();
