// 可选的浏览器验收：RELAY_PLAYWRIGHT 指向已安装的 Playwright 模块。
import { createRequire } from 'node:module';
import { Manager, writeAtomic } from '../core.mjs';
import { createServer } from '../server.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.RELAY_PLAYWRIGHT || 'playwright');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-browser-'));
const m = new Manager({ home, env: { PATH: '' } });
writeAtomic(m.paths.claude, '{"env":{"TOKEN":"dont-display-this"}}');
writeAtomic(m.paths.codex, '# 保留注释\nmodel="test"\n');
const server = createServer(m);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.RELAY_BROWSER ? { executablePath: process.env.RELAY_BROWSER } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.tool-card').first().waitFor();
  for (const id of ['claude', 'codex', 'opencode']) {
    await page.locator(`button[data-id="${id}"]`).click();
    await page.locator('#preview-dialog[open]').waitFor();
    assert.ok(!(await page.locator('#preview-code').innerText()).includes('dont-display-this'));
    await page.locator('#apply').click();
    await page.locator(`button[data-id="${id}"][data-action="restore"]`).waitFor();
  }
  assert.equal(await page.locator('#connected').innerText(), '03');
  await page.locator('input[name="sound"]').uncheck();
  await page.locator('input[name="desktop"]').uncheck();
  await page.getByRole('button', { name: '保存偏好' }).click();
  await page.waitForFunction(() => document.querySelector('#save-status').textContent === '已保存');
  assert.equal(m.preferences().sound, false);
  for (const id of ['claude', 'codex', 'opencode']) {
    await page.locator(`button[data-id="${id}"]`).click();
    await page.locator('#preview-dialog[open]').waitFor();
    await page.locator('#apply').click();
    await page.locator(`button[data-id="${id}"][data-action="enable"]`).waitFor();
  }
  assert.equal(fs.readFileSync(m.paths.claude, 'utf8'), '{"env":{"TOKEN":"dont-display-this"}}');
  assert.equal(fs.existsSync(m.paths.opencode), false);
  fs.mkdirSync('.test-output', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.test-output/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.test-output/mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
  console.log('浏览器验收通过：三工具预览→接入→恢复；偏好保存；敏感值不显示；移动端无横向溢出。');
} finally { await browser.close(); server.close(); fs.rmSync(home, { recursive: true, force: true }); }
