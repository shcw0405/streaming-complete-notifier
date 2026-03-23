// Gemini Prompt 捕获脚本 - 监听用户输入并发送到后台
(function() {
  'use strict';

  let lastTypedPrompt = '';

  // Gemini 使用 rich text editor，监听 input 事件
  document.addEventListener('input', (e) => {
    const target = e.target;
    if (target && target.tagName) {
      const text = target.innerText || target.value || target.textContent;
      if (text && text.trim().length > 0) {
        lastTypedPrompt = text.trim();
      }
    }
  }, true);

  // 监听表单提交和按键（Enter 发送）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && lastTypedPrompt) {
      // 发送 prompt 到 content script
      window.postMessage({
        source: 'gemini-prompt-tap',
        type: 'gemini_prompt_captured',
        data: { prompt: lastTypedPrompt },
        timestamp: Date.now()
      }, '*');
    }
  }, true);

  // 也监听发送按钮点击
  document.addEventListener('click', (e) => {
    const target = e.target;
    // Gemini 的发送按钮通常在 mat-icon 或 button 内
    const sendBtn = target.closest('button[aria-label*="Send"], button[aria-label*="发送"], .send-button, [data-mat-icon-name="send"]');
    if (sendBtn && lastTypedPrompt) {
      window.postMessage({
        source: 'gemini-prompt-tap',
        type: 'gemini_prompt_captured',
        data: { prompt: lastTypedPrompt },
        timestamp: Date.now()
      }, '*');
    }
  }, true);
})();
