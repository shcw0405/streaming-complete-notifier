// 第十三部分：回响管理台桥接。只授权由扩展主动打开的顶层标签页。
(() => {
  const DEFAULTS = {
    geminiEnabled: true, chatgptEnabled: true, grokEnabled: true, aistudioEnabled: true,
    chatgptReasoningEndEnabled: true, tabKeepAliveEnabled: false,
    notificationEnabled: true, soundEnabled: true, soundVolume: 1
  };
  const DEFAULT_URL = 'http://127.0.0.1:62348/';
  const normalizeUrl = value => {
    const url = new URL(value || DEFAULT_URL);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('管理台地址必须是 http://127.0.0.1:端口/');
    return url.href;
  };
  let syncing = false;
  const post = async (url, route, body, token) => {
    const response = await fetch(new URL(route, url), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-relay-pair': token } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(route === '/bridge/connect' ? 120000 : 5000) });
    const data = await response.json(); if (!response.ok) throw Error(data.error || '桌面端暂不可用'); return data;
  };
  async function syncDesktop() {
    if (syncing) return { ok: true };
    syncing = true;
    try {
      const { relayDesktop: pair } = await chrome.storage.local.get('relayDesktop');
      if (!pair) throw Error('尚未配对桌面端。');
      const state = () => chrome.storage.sync.get(DEFAULTS);
      const result = await post(pair.url, '/bridge/sync', { settings: await state(), version: chrome.runtime.getManifest().version }, pair.token);
      if (result.pending) {
        const patch = result.pending.settings;
        for (const [key, value] of Object.entries(patch)) {
          if (!Object.hasOwn(DEFAULTS, key) || (key === 'soundVolume' ? !Number.isFinite(value) || value < 0 || value > 1.5 : typeof value !== 'boolean')) throw Error('桌面端返回了无效设置。');
        }
        await chrome.storage.sync.set(patch);
        await post(pair.url, '/bridge/sync', { settings: await state(), version: chrome.runtime.getManifest().version, ack: result.pending.id }, pair.token);
      }
      return { ok: true };
    } finally { syncing = false; }
  }
  chrome.alarms.create('relay-desktop-sync', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'relay-desktop-sync') syncDesktop().catch(() => {}); });
  chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'sync') syncDesktop().catch(() => {}); });
  // 自动发现仅探测默认地址和以前成功连接过的地址，不扫描本机端口。
  let discoveredUrl = null;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['relayDiscover', 'relayConnect', 'relayDisconnect'].includes(message?.action)) return;
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html')) { respond({ ok: false, error: '请在扩展管理页面操作。' }); return; }
    (async () => {
      const { relayDesktop: pair } = await chrome.storage.local.get('relayDesktop');
      if (message.action === 'relayDiscover') {
        discoveredUrl = null;
        for (const url of [...new Set([pair?.url, DEFAULT_URL].filter(Boolean))]) {
          try {
            const result = await post(normalizeUrl(url), '/bridge/discover', {}, pair?.url === url ? pair.token : undefined);
            if (result.product !== 'relay-notifier' || result.protocol !== 1 || result.url !== url) continue;
            discoveredUrl = url;
            if (result.connected) await syncDesktop();
            respond({ ok: true, ...result }); return;
          } catch { /* 检查下一个已知地址。 */ }
        }
        throw Error('未发现运行中的回响。请打开桌面应用，再点击重新检测。');
      }
      if (message.action === 'relayDisconnect') {
        if (pair) {
          await post(pair.url, '/bridge/disconnect', {}, pair.token);
          await chrome.storage.local.remove('relayDesktop');
        }
        respond({ ok: true }); return;
      }
      if (!discoveredUrl) throw Error('请先重新检测本机回响。');
      const result = await post(discoveredUrl, '/bridge/connect', {}, pair?.url === discoveredUrl ? pair.token : undefined);
      await chrome.storage.local.set({ relayDesktop: { url: discoveredUrl, token: result.token }, relayManagerUrl: discoveredUrl });
      await syncDesktop(); respond({ ok: true });
    })().catch(e => respond({ ok: false, error: e.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['relayPairDesktop', 'relaySyncDesktop'].includes(message?.action)) return;
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) { respond({ ok: false, error: '仅扩展弹窗可以配对。' }); return; }
    (async () => {
      if (message.action === 'relayPairDesktop') {
        const url = normalizeUrl(message.url);
        const result = await post(url, '/bridge/pair', { code: message.code });
        await chrome.storage.local.set({ relayDesktop: { url, token: result.token }, relayManagerUrl: url });
      }
      await syncDesktop(); respond({ ok: true });
    })().catch(e => respond({ ok: false, error: e.message }));
    return true;
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.action !== 'relayOpenManager') return;
    // 仅扩展自身页面可以授权管理台，网页内容脚本不可以。
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html')) { respond({ ok: false, error: '请从扩展管理页面打开工作台。' }); return; }
    (async () => {
      const url = normalizeUrl(message.url);
      const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
      await chrome.storage.local.set({ relayManagerGrant: { tabId: tab.id, url }, relayManagerUrl: url });
      await chrome.tabs.update(tab.id, { url: url + '#extension=' + chrome.runtime.id });
      respond({ ok: true });
    })().catch(e => respond({ ok: false, error: e.message }));
    return true;
  });
  chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
    (async () => {
      const { relayManagerGrant: grant } = await chrome.storage.local.get('relayManagerGrant');
      const url = new URL(sender.url);
      if (!grant || sender.id || sender.tab?.id !== grant.tabId || sender.frameId !== 0 || url.origin !== new URL(grant.url).origin || url.pathname !== '/') throw Error('此页面尚未授权，请从扩展弹窗重新打开回响。');
      if (message?.action === 'relayStatus') {
        respond({ ok: true, version: chrome.runtime.getManifest().version, settings: await chrome.storage.sync.get(DEFAULTS) });
      } else if (message?.action === 'relaySettings') {
        const patch = message.settings;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('设置格式不正确。');
        for (const [key, value] of Object.entries(patch)) {
          if (!Object.hasOwn(DEFAULTS, key)) throw Error('不支持这个设置项。');
          if (key === 'soundVolume') {
            if (!Number.isFinite(value) || value < 0 || value > 1.5) throw Error('音量超出范围。');
          } else if (typeof value !== 'boolean') throw Error('开关必须为布尔值。');
        }
        await chrome.storage.sync.set(patch);
        respond({ ok: true, settings: await chrome.storage.sync.get(DEFAULTS) });
      } else throw Error('不支持这个管理操作。');
    })().catch(e => respond({ ok: false, error: e.message }));
    return true;
  });
  chrome.tabs.onRemoved.addListener(async tabId => {
    const { relayManagerGrant: grant } = await chrome.storage.local.get('relayManagerGrant');
    if (grant?.tabId === tabId) await chrome.storage.local.remove('relayManagerGrant');
  });
})();
