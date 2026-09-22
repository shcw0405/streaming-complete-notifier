const $ = id => document.getElementById(id);
let found = null;
async function call(action, body = {}) {
  const result = await chrome.runtime.sendMessage({ action, ...body });
  if (!result?.ok) throw Error(result?.error || '操作未完成。'); return result;
}
async function detect() {
  found = null; $('connection-state').textContent = '正在自动检测…';
  for (const id of ['connect', 'open-manager', 'disconnect', 'connection-address']) $(id).hidden = true;
  try {
    found = await call('relayDiscover');
    $('connection-state').textContent = found.connected ? '已连接 · 回响桌面应用' : found.canConnect ? '已发现回响桌面应用，连接时请在桌面端确认。' : '检测到旧版或开发服务，请打开新版回响桌面应用。';
    $('connection-address').textContent = found.url; $('connection-address').hidden = false;
    $('connect').hidden = found.connected || !found.canConnect;
    $('open-manager').hidden = !found.connected; $('disconnect').hidden = !found.connected;
  } catch (e) { $('connection-state').textContent = e.message; }
}
async function busy(button, fn) {
  button.disabled = true; try { await fn(); } catch (e) { $('status').textContent = e.message; } finally { button.disabled = false; }
}
$('detect').onclick = e => busy(e.target, detect);
$('connect').onclick = e => busy(e.target, async () => {
  $('connection-state').textContent = '请在回响桌面端确认连接，无需输入地址或配对码。';
  try { await call('relayConnect'); $('status').textContent = '已连接，原有提醒设置保持不变。'; }
  finally { await detect(); }
});
$('disconnect').onclick = e => busy(e.target, async () => { await call('relayDisconnect'); await detect(); $('status').textContent = '已断开，网页提醒仍独立运行。'; });
$('open-manager').onclick = e => busy(e.target, () => call('relayOpenManager', { url: found.url }));
const defaults = { chatgptEnabled: true, geminiEnabled: true, grokEnabled: true, aistudioEnabled: true, notificationEnabled: true, soundEnabled: true, soundVolume: 1, chatgptReasoningEndEnabled: true, tabKeepAliveEnabled: false, chatgptDiagnosticModeEnabled: false };
async function load() {
  const settings = await chrome.storage.sync.get(defaults);
  for (const input of document.querySelectorAll('[data-setting]')) {
    if (input.type === 'range') input.value = settings[input.dataset.setting]; else input.checked = settings[input.dataset.setting];
  }
  $('volume').textContent = Math.round(settings.soundVolume * 100) + '%';
}
for (const input of document.querySelectorAll('[data-setting]')) {
  if (input.type === 'range') input.oninput = () => $('volume').textContent = Math.round(Number(input.value) * 100) + '%';
  input.onchange = () => busy(input, async () => {
    await chrome.storage.sync.set({ [input.dataset.setting]: input.type === 'range' ? Number(input.value) : input.checked }); $('status').textContent = '已保存。';
  });
}
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'sync') load(); });
$('copy-logs').onclick = e => busy(e.target, async () => { const result = await chrome.runtime.sendMessage({ action: 'getChatgptDiagnosticLogs' }); await navigator.clipboard.writeText(JSON.stringify(result?.logs || [], null, 2)); $('status').textContent = '诊断日志已复制。'; });
$('clear-logs').onclick = e => busy(e.target, async () => { await chrome.runtime.sendMessage({ action: 'clearChatgptDiagnosticLogs' }); $('status').textContent = '诊断日志已清空。'; });
load().catch(e => $('status').textContent = e.message); detect();
