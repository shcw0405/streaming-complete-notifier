const token = document.querySelector('meta[name="relay-token"]').content;
const $ = selector => document.querySelector(selector);
const form = $('#prefs-form');
let latest, preview, toastTimer;
let busyCount = 0, browserDirty = false;
let browserState = null;
const browserForm = $('#browser-form');
browserForm.addEventListener('change', () => { browserDirty = true; });
const browserKeys = ['chatgptEnabled', 'geminiEnabled', 'grokEnabled', 'aistudioEnabled', 'chatgptReasoningEndEnabled', 'tabKeepAliveEnabled'];
function sharedSettings(prefs) { return { notificationEnabled: prefs.desktop, soundEnabled: prefs.sound, soundVolume: prefs.volume }; }
function updateSharedStatus() {
  if (!browserState || !latest) return;
  const shared = sharedSettings(latest.preferences);
  const match = Object.entries(shared).every(([key, value]) => browserState.settings[key] === value);
  $('#shared-status').textContent = match ? '声音、音量、桌面通知已与本机偏好一致' : '浏览器与本机提醒偏好不同，可主动同步；不覆盖现有偏好';
}
async function connectBrowser() {
  try {
    browserState = await window.relayBrowser.status();
    $('#browser-status').textContent = `扩展已连接 · v${browserState.version}`;
    $('#browser-help').textContent = '网页开关直接作用于扩展，保存后等待浏览器确认（通常 30 秒内，打开扩展弹窗可立即同步）。共同提醒偏好也可同步；退出桌面应用后，扩展仍独立提醒。';
    $('#browser-fields').disabled = false; $('#sync-browser').disabled = false;
    if (!browserDirty) for (const key of browserKeys) browserForm.elements[key].checked = browserState.settings[key];
    updateSharedStatus();
  } catch (e) {
    browserState = null; $('#browser-fields').disabled = true; $('#sync-browser').disabled = true;
    $('#browser-status').textContent = '扩展未连接 · CLI 仍可独立使用';
    $('#browser-help').textContent = e.message;
    $('#shared-status').textContent = '连接后可同步声音、音量和桌面通知';
  }
}
$('#connect-browser').addEventListener('click', e => busy(e.target, connectBrowser));
browserForm.addEventListener('submit', e => {
  e.preventDefault(); busy(browserForm.querySelector('button'), async () => {
    $('#browser-save-status').textContent = '等待扩展确认，通常不超过 30 秒；打开扩展弹窗可立即同步';
    const settings = Object.fromEntries(browserKeys.map(key => [key, browserForm.elements[key].checked]));
    browserState = { ...browserState, ...await window.relayBrowser.save(settings) };
    browserDirty = false;
    $('#browser-save-status').textContent = '已写入扩展；后台保活变更需刷新 AI 页面';
    toast('网页平台设置已保存。');
  });
});
$('#sync-browser').addEventListener('click', e => busy(e.target, async () => {
  browserState = { ...browserState, ...await window.relayBrowser.save(sharedSettings(latest.preferences)) };
  updateSharedStatus(); toast('共同提醒偏好已同步到扩展。');
}));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(route, body) {
  const response = await fetch('/api/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-relay-token': token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || '操作未完成'); return data;
}
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, error ? 14000 : 6500); }
async function busy(button, operation) { busyCount++; const original = button.textContent; button.disabled = true; button.textContent = '处理中…'; try { await operation(); } catch (e) { toast(e.message, true); } finally { busyCount--; button.disabled = false; button.textContent = original; } }
const labels = { enabled: '已接入', changed: '配置有变化', available: '待接入' };
const descriptions = { claude: '本轮完成时通知，也可提醒明确的权限请求。', codex: '连接本轮完成事件，兼容已有通知命令。', opencode: '通过独立插件，接住完成、异常与授权事件。' };
function renderTools() {
  $('#connected').textContent = latest.tools.filter(t => t.status === 'enabled').length.toString().padStart(2, '0');
  $('#detected').textContent = latest.tools.filter(t => t.binary).length.toString().padStart(2, '0');
  $('#tool-grid').innerHTML = latest.tools.map(t => {
    if (t.id === 'deepseek') return `<article class="coming"><span class="tool-icon codex">≈</span><div><strong>DeepSeek Harness</strong><p>${t.binary ? '已发现 dsh。' : ''}插件接入正在规划，首版暂不修改其配置。</p></div><a target="_blank" rel="noreferrer" href="https://deepseek.com/harness/en/">了解项目 ↗</a></article>`;
    const receipt = latest.receipts.find(r => r.tool === t.id);
    return `<article class="tool-card"><div class="tool-top"><span class="tool-icon ${t.id}">${{ claude: '✳', codex: '⌘', opencode: '>_' }[t.id]}</span><span class="tag ${t.status}">${labels[t.status]}</span></div><h3>${t.name}</h3><div class="tool-description">${descriptions[t.id]}</div><div class="tool-path">${escapeHtml(t.path)}</div><div class="detection"><span class="online"></span>${t.binary ? '已在本机发现' : t.exists ? '发现配置，未找到 CLI 命令' : '未找到 CLI，可先配置'}</div>${t.error ? `<p class="card-error">${escapeHtml(t.error)}</p>` : ''}${t.status === 'changed' ? '<p class="card-error">接入后文件有变化；恢复前需要处理差异，避免覆盖新配置。</p>' : ''}${receipt ? `<div class="receipt">最近收到事件 · ${new Date(receipt.at).toLocaleString('zh-CN')}<br>${receipt.desktop === 'submitted' ? '已提交系统通知' : receipt.desktop === 'failed' ? '系统通知发送失败' : '桌面通知关闭'} · ${receipt.sound === 'played' ? '提示音已播放' : receipt.sound === 'failed' ? '提示音播放失败' : '提示音关闭'}</div>` : ''}<div class="card-actions"><button class="${t.status === 'available' ? 'primary' : 'quiet'}" data-id="${t.id}" data-action="${t.status === 'available' ? 'enable' : 'restore'}" ${t.error ? 'disabled' : ''}>${t.status === 'available' ? '预览并接入' : '恢复原配置'}</button></div></article>`;
  }).join('');
  $('#system-note').textContent = latest.platform !== 'darwin' ? '首版通知运行时仅支持 macOS。' : latest.terminalNotifier ? '已发现 terminal-notifier：支持点击通知返回可识别的终端应用（暂不定位具体标签页）。系统通知是否显示仍取决于 macOS 通知设置。' : '使用 macOS 系统通知与本地声音，无需安装通知依赖。若没有看到横幅，请检查系统通知权限与专注模式。点击返回应用需要另行安装 terminal-notifier，首版不会自动安装。';
}
async function refresh(includePrefs = false) {
  latest = await api('status'); renderTools();
  if (includePrefs) {
    for (const key of ['desktop', 'sound', 'project', 'attention']) form.elements[key].checked = latest.preferences[key];
    form.elements.volume.value = Math.round(latest.preferences.volume * 100); $('#volume-label').textContent = form.elements.volume.value + '%';
  }
}
$('#tool-grid').addEventListener('click', event => {
  const button = event.target.closest('button[data-id]'); if (!button) return;
  busy(button, async () => {
    preview = await api('preview', { id: button.dataset.id, action: button.dataset.action });
    $('#preview-title').textContent = `${preview.action === 'enable' ? '接入' : '恢复'} ${latest.tools.find(t => t.id === preview.id).name}`;
    $('#preview-path').textContent = preview.file; $('#preview-code').textContent = preview.snippet;
    $('#preview-notes').replaceChildren(...preview.notes.map(note => { const li = document.createElement('li'); li.textContent = note; return li; }));
    $('#backup-note').textContent = '备份：' + preview.backup;
    $('#apply').textContent = preview.action === 'enable' ? '确认接入' : '确认恢复';
    $('#preview-dialog').showModal();
  });
});
$('#apply').addEventListener('click', e => busy(e.target, async () => { const result = await api('apply', { token: preview.token }); $('#preview-dialog').close(); await refresh(); toast(result.message); }));
for (const id of ['close-dialog', 'cancel-dialog']) $('#' + id).addEventListener('click', () => $('#preview-dialog').close());
$('#refresh').addEventListener('click', e => busy(e.target, async () => { await refresh(); await connectBrowser(); toast('已更新网页和本机工具状态。'); }));
$('#test-all').addEventListener('click', e => busy(e.target, async () => { const result = await api('test', {}); toast(result.message); }));
form.elements.volume.addEventListener('input', e => { $('#volume-label').textContent = e.target.value + '%'; $('#save-status').textContent = '有未保存的修改'; });
form.addEventListener('change', () => $('#save-status').textContent = '有未保存的修改');
form.addEventListener('submit', e => { e.preventDefault(); busy(form.querySelector('button'), async () => {
  const prefs = {}; for (const key of ['desktop', 'sound', 'project', 'attention']) prefs[key] = form.elements[key].checked;
  prefs.volume = Number(form.elements.volume.value) / 100;
  latest.preferences = await api('preferences', prefs); $('#save-status').textContent = '已保存';
  if (browserState) {
    try { browserState = { ...browserState, ...await window.relayBrowser.save(sharedSettings(prefs)) }; updateSharedStatus(); toast('网页与 CLI 的共同提醒偏好已保存。'); }
    catch (e) { await connectBrowser(); toast('本机偏好已保存，扩展同步失败。连接后请点击同步按钮。', true); }
  } else toast('本机偏好已保存；扩展未连接，网页设置未变更。');
}); });
refresh(true).then(connectBrowser).catch(e => toast(e.message, true));

// 定期读取实际设置；用户正在编辑时保留尚未保存的内容。
let polling = false;
setInterval(async () => {
  if (polling || document.hidden || busyCount > 0) return;
  polling = true;
  try {
    const dirty = $('#save-status').textContent === '有未保存的修改' || form.contains(document.activeElement);
    await refresh(!dirty);
    if (!browserForm.contains(document.activeElement)) await connectBrowser();
  } catch { /* 暂时离线时保留界面，后续自动重试。 */ }
  finally { polling = false; }
}, 5000);
