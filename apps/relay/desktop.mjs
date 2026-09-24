import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Manager } from './core.mjs';
import { createServer } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let window, tray, server, quitting = false;
app.setName('回响 Relay');
if (process.env.RELAY_DATA_HOME) app.setPath('userData', path.join(process.env.RELAY_DATA_HOME, 'electron-profile'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  const show = () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } };
  app.on('second-instance', show);
  app.on('activate', show);
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; server?.close(); });
  app.whenReady().then(async () => {
    // 作为菜单栏应用运行，不占用 Dock；窗口仅在用户主动打开时显示。
    if (process.platform === 'darwin') app.dock.hide();
    const home = process.env.RELAY_DATA_HOME || os.homedir();
    const runtimeDir = path.join(home, '.relay-notifier', 'bin');
    const bundledNode = path.join(here, 'bin', 'node');
    const sourceNode = fs.existsSync(bundledNode) ? bundledNode : path.join(here, '.build-cache', 'node');
    if (!fs.existsSync(sourceNode)) throw Error('缺少内置运行时。开发环境请先运行 npm run package。');
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    const node = path.join(runtimeDir, 'node');
    if (fs.existsSync(node) && fs.lstatSync(node).isSymbolicLink()) throw Error('运行时路径是符号链接，已停止写入。');
    const temporary = path.join(runtimeDir, 'node-' + process.pid);
    fs.copyFileSync(sourceNode, temporary); fs.chmodSync(temporary, 0o700); fs.renameSync(temporary, node);
    const env = { ...process.env, PATH: [path.join(home, '.local/bin'), path.join(home, '.bun/bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH, '/usr/bin', '/bin'].filter(Boolean).join(':') };
    const soundSource = app.isPackaged ? path.join(here, 'assets', 'complete.mp3') : path.join(here, '../../src/javascript/audio/streaming-complete.mp3');
    server = createServer(new Manager({ home, env, node, soundSource }), {
      approveConnection: async ({ extensionOrigin, url }) => {
        show();
        const result = await dialog.showMessageBox(window, { type: 'question', title: '连接浏览器扩展', message: '允许浏览器扩展连接回响？', detail: `本机地址：${url}\n扩展 ID：${extensionOrigin.replace('chrome-extension://', '')}\n\n仅同步提醒设置，不读取对话内容或授权修改 CLI 配置。已有浏览器连接会被替换。`, buttons: ['取消', '允许连接'], defaultId: 1, cancelId: 0, noLink: true });
        return result.response === 1;
      }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.RELAY_PORT || 62348), '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    window = new BrowserWindow({ width: 1220, height: 850, minWidth: 780, minHeight: 600, title: '回响 Relay', backgroundColor: '#f7f8f4', show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    window.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      if (target === 'https://deepseek.com/harness/en/') shell.openExternal(target);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, target) => { if (target !== url) event.preventDefault(); });
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    // 模板图标由代码生成，适配 macOS 深浅菜单栏。
    const pixels = Buffer.alloc(18 * 18 * 4);
    for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) {
      const radius = Math.hypot(x - 8.5, y - 8.5);
      if ((radius > 5.8 && radius < 7.6) || (radius > 2.3 && radius < 3.8)) pixels[(y * 18 + x) * 4 + 3] = 255;
    }
    const icon = nativeImage.createFromBitmap(pixels, { width: 18, height: 18 }); icon.setTemplateImage(true);
    tray = new Tray(icon); tray.setToolTip('回响 Relay · 后台运行'); tray.on('click', show);
    const menu = () => Menu.buildFromTemplate([
      { label: '打开回响', click: show },
      { label: '在浏览器打开管理台', click: () => shell.openExternal(url) },
      { label: '登录时启动', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
      { type: 'separator' }, { label: '退出回响', click: () => app.quit() }
    ]);
    tray.setContextMenu(menu());
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '回响 Relay', submenu: [{ label: '关于回响', click: () => dialog.showMessageBox(window, { message: '回响 Relay 0.3.0 试用版', detail: '网页 AI 与本地编程工具的统一提醒入口。关闭窗口后仍在菜单栏运行；退出后已接入的工具仍可独立通知。' }) }, { type: 'separator' }, { role: 'quit', label: '退出回响' }] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '窗口', submenu: [{ role: 'minimize' }, { label: '显示回响', click: show }] }
    ]));
    await window.loadURL(url);
  }).catch(error => {
    dialog.showErrorBox('回响未能启动', error.code === 'EADDRINUSE' ? '本地端口 62348 已被占用。请关闭旧版回响服务后重新打开；不会自动终止其他程序。' : error.message);
    app.quit();
  });
}
