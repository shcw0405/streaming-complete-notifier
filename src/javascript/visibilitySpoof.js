// 防止页面检测标签页切换 - 伪装 Page Visibility API
// 参考问题：https://community.openai.com/t/chatgpt-pausing-completion-if-you-switch-tabs-30-11-2023/535273
// ChatGPT 等 AI 页面会监听 visibilitychange 事件，当用户切走标签页时暂停流式传输。
// 此脚本拦截 Visibility API，让页面始终认为自己处于前台可见状态。
(function() {
  'use strict';

  if (window.__visibilitySpoofInjected) return;
  window.__visibilitySpoofInjected = true;

  // 保存原始值
  const originalDescriptors = {
    hidden: Object.getOwnPropertyDescriptor(Document.prototype, 'hidden'),
    visibilityState: Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
  };

  // 伪装 document.hidden 始终返回 false
  Object.defineProperty(Document.prototype, 'hidden', {
    get: function() { return false; },
    configurable: true
  });

  // 伪装 document.visibilityState 始终返回 'visible'
  Object.defineProperty(Document.prototype, 'visibilityState', {
    get: function() { return 'visible'; },
    configurable: true
  });

  // 拦截 visibilitychange 事件，阻止页面收到标签页切换通知
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const blockedListeners = new WeakMap();

  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'visibilitychange' && this === document) {
      // 包装 listener，在页面真正可见时才放行，切走时静默吞掉
      const wrappedListener = function(event) {
        // 不触发回调，让页面不知道标签页被切走了
      };
      blockedListeners.set(listener, wrappedListener);
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // 同步拦截 removeEventListener
  const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (type === 'visibilitychange' && this === document) {
      const wrappedListener = blockedListeners.get(listener);
      if (wrappedListener) {
        blockedListeners.delete(listener);
        return originalRemoveEventListener.call(this, type, wrappedListener, options);
      }
    }
    return originalRemoveEventListener.call(this, type, listener, options);
  };

  // 同时拦截 document.onvisibilitychange 赋值
  let _onvisibilitychange = null;
  Object.defineProperty(document, 'onvisibilitychange', {
    get: function() { return _onvisibilitychange; },
    set: function(fn) { _onvisibilitychange = fn; /* 存储但不真正绑定 */ },
    configurable: true
  });
})();
