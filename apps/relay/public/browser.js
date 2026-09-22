// 仅与扩展主动授权的管理台标签页通信，不获取浏览器对话内容。
(() => {
  const supplied = new URLSearchParams(location.hash.slice(1)).get('extension');
  if (supplied && /^[a-p]{32}$/.test(supplied)) sessionStorage.setItem('relay-extension', supplied);
  const id = sessionStorage.getItem('relay-extension');
  const call = (action, settings) => new Promise((resolve, reject) => {
    if (!id || !globalThis.chrome?.runtime?.sendMessage) return reject(Error('请从已安装扩展的 Chrome / Edge 弹窗打开回响管理台。'));
    const timeout = setTimeout(() => reject(Error('扩展连接超时，请检查扩展是否启用，并重新从弹窗打开。')), 3500);
    try {
      chrome.runtime.sendMessage(id, { action, ...(settings ? { settings } : {}) }, response => {
        clearTimeout(timeout);
        const error = chrome.runtime.lastError;
        if (error || !response?.ok) reject(Error(response?.error || error?.message || '扩展未返回响应'));
        else resolve(response);
      });
    } catch (e) { clearTimeout(timeout); reject(e); }
  });
  const local = async settings => {
    const token = document.querySelector('meta[name="relay-token"]').content;
    const response = await fetch('/api/browser', { method: settings ? 'POST' : 'GET', headers: { 'x-relay-token': token, ...(settings ? { 'Content-Type': 'application/json' } : {}) }, ...(settings ? { body: JSON.stringify(settings) } : {}) });
    const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
  };
  window.relayBrowser = { status: () => id ? call('relayStatus') : local(), save: settings => id ? call('relaySettings', settings) : local(settings) };
})();
