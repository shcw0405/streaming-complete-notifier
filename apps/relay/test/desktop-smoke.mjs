// 验收实际打包的 .app 与独立 MV3 扩展；所有配置写入隔离的临时目录。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { _electron, chromium } = require(process.env.RELAY_PLAYWRIGHT || 'playwright');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-desktop-test-'));
const executablePath = path.resolve('release/Relay-darwin-arm64/Relay.app/Contents/MacOS/Relay');
let desktop, browser;
try {
  desktop = await _electron.launch({ executablePath, env: { ...process.env, RELAY_DATA_HOME: home, RELAY_PORT: '0', CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), OPENCODE_CONFIG_DIR: path.join(home, '.config/opencode') }, timeout: 30000 });
  const page = await desktop.firstWindow();
  page.setDefaultTimeout(20000);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  assert.equal(await desktop.evaluate(({ app }) => app.dock.isVisible()), false);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  console.log('桌面窗口已创建', page.url());
  await page.locator('.tool-card').first().waitFor();
  console.log('桌面管理页已加载');
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const url = page.url();
  const runtime = path.join(home, '.relay-notifier/bin/node');
  assert.match(execFileSync(runtime, ['--version']).toString(), /^v24\./);
  execFileSync('ditto', ['-x', '-k', path.resolve('release/Relay-Browser-1.4.0.zip'), path.join(home, 'extension')]);
  const extension = path.join(home, 'extension/relay-browser');
  browser = await chromium.launchPersistentContext(path.join(home, 'browser-profile'), { headless: true, ignoreDefaultArgs: ['--disable-extensions'], executablePath: process.env.RELAY_BROWSER, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const popup = await browser.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`); await popup.locator('body.loaded').waitFor();
  assert.equal(await popup.locator('input[type="url"], #relayPairCode, #relayManagerStatus').count(), 0);
  assert.equal(await popup.locator('input[type="checkbox"]').count(), 6);
  // 随机测试端口通过旧连接记录提供，仅测试上下文使用，不扫描端口。
  await worker.evaluate(url => chrome.storage.local.set({ relayDesktop: { url, token: 'expired-test-token' } }), url);
  const options = await browser.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  await options.locator('#connect').waitFor({ state: 'visible' });
  assert.equal(await options.locator('#connection-address').innerText(), url);
  // 在隔离的 Electron 测试进程注入用户取消/允许，验证真实授权回调。
  await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
  await options.locator('#connect').click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('取消'));
  await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async (_window, opts) => { if (!opts.detail.includes('不读取对话内容')) throw Error('缺少授权范围说明'); return { response: 1 }; }; });
  await options.locator('#connect').click();
  await options.waitForFunction(() => document.querySelector('#connection-state').textContent.includes('已连接'));
  await page.locator('#connect-browser').click();
  await page.waitForFunction(() => document.querySelector('#browser-status').textContent.includes('扩展已连接'));
  await page.locator('input[name="grokEnabled"]').uncheck();
  await page.getByRole('button', { name: '保存网页设置' }).click();
  await page.waitForFunction(() => document.querySelector('#browser-save-status').textContent.startsWith('已写入'), null, { timeout: 45000 });
  assert.equal((await worker.evaluate(() => chrome.storage.sync.get('grokEnabled'))).grokEnabled, false);
  await worker.evaluate(() => chrome.storage.sync.set({ soundVolume: 1.25, soundEnabled: false }));
  await page.waitForFunction(() => document.querySelector('#prefs-form input[name="volume"]').value === '125');
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.relay-notifier/preferences.json'))).volume, 1.25);
  console.log('菜单栏启动、隐藏 Dock、双向设置同步通过');
  // 三种 CLI 使用真正内置运行时路径，不接触用户配置。
  for (const id of ['claude', 'codex', 'opencode']) {
    await page.locator(`button[data-id="${id}"]`).click(); await page.locator('#preview-dialog[open]').waitFor();
    assert.ok((await page.locator('#preview-code').innerText()).includes(runtime));
    await page.locator('#apply').click(); await page.locator(`button[data-id="${id}"][data-action="restore"]`).waitFor();
  }
  await page.locator('#prefs-form input[name="sound"]').uncheck();
  await page.locator('#prefs-form input[name="desktop"]').uncheck();
  await page.getByRole('button', { name: '保存偏好' }).click();
  await page.waitForFunction(() => document.querySelector('#shared-status').textContent.includes('已与本机偏好一致'), null, { timeout: 45000 });
  await page.locator('#test-all').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('测试已执行'));
  assert.ok(fs.existsSync(path.join(home, '.relay-notifier/complete.mp3')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.relay-notifier/receipt-test.json'))).sound, 'off');
  for (const id of ['claude', 'codex', 'opencode']) {
    await page.locator(`button[data-id="${id}"]`).click(); await page.locator('#preview-dialog[open]').waitFor();
    await page.locator('#apply').click(); await page.locator(`button[data-id="${id}"][data-action="enable"]`).waitFor();
  }
  await page.locator('#browser-tools').scrollIntoViewIfNeeded();
  fs.mkdirSync('.test-output', { recursive: true });
  await page.screenshot({ path: '.test-output/desktop-app.png' });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  assert.equal((await fetch(url)).status, 200);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await options.locator('#disconnect').click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.includes('已断开'));
  await page.locator('#connect-browser').click();
  await page.waitForFunction(() => document.querySelector('#browser-fields').disabled);
  assert.deepEqual(errors, []);
  console.log('内置运行时、三个 CLI 接入/恢复、共同偏好、测试通知、隐藏后服务存活、撤销配对通过');
} finally {
  if (browser) await browser.close(); if (desktop) await desktop.close();
  fs.rmSync(home, { recursive: true, force: true });
}
