// 录制真实产品界面。所有配置写入隔离演示目录，不使用个人账号或对话。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Manager } from '../../../apps/relay/core.mjs';
import { createServer } from '../../../apps/relay/server.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.join(here, 'build/clean'); fs.mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.RELAY_PLAYWRIGHT);
const home = fs.mkdtempSync('/tmp/relay-demo-');
const manager = new Manager({ home, env: { PATH: '' } });
const server = createServer(manager);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const extension = path.join(root, 'src/javascript');
const context = await chromium.launchPersistentContext(path.join(home, 'browser'), {
  executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', bypassCSP: true,
  recordVideo: { dir: out, size: { width: 1600, height: 900 } }
});
const recordings = [];
async function prepare(page) {
  await page.addStyleTag({ content: 'html{scroll-behavior:smooth}*{caret-color:transparent!important}#film-pointer{pointer-events:none;position:fixed;z-index:2147483647;width:18px;height:18px;background:#fff;border:2px solid #33503e;box-shadow:0 2px 8px #0003;border-radius:50%;left:-40px;top:-40px;transform:translate(-50%,-50%)}' });
  await page.evaluate(() => {
    const pointer = document.createElement('div'); pointer.id = 'film-pointer'; document.body.append(pointer);
    addEventListener('mousemove', e => { pointer.style.left = e.clientX + 'px'; pointer.style.top = e.clientY + 'px'; });
    addEventListener('mousedown', () => pointer.animate([{boxShadow:'0 0 0 0 #50755b80'},{boxShadow:'0 0 0 24px #50755b00'}], {duration:650}));
  });
}
const hold = ms => new Promise(resolve => setTimeout(resolve, ms));
async function point(page, selector, click = false) {
  const el = page.locator(selector); await el.scrollIntoViewIfNeeded(); await hold(450);
  const b = await el.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 30 }); await hold(600);
  if (click) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
async function finish(page, name) { const video = page.video(); await page.close(); const file = path.join(out, name + '.webm'); await video.saveAs(file); recordings.push({ name, file }); }
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  // 建立演示连接：只把已存在的扩展设置带入本地界面，不伪造任务完成事件。
  const html = await (await fetch(url)).text(); const secret = html.match(/name="relay-token" content="([^"]+)"/)[1];
  const { code } = await (await fetch(url + 'api/pair', { method:'POST', headers:{'Content-Type':'application/json','x-relay-token':secret},body:'{}' })).json();
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`); await popup.locator('body.loaded').waitFor();
  await popup.evaluate(async ({url,code}) => { await chrome.runtime.sendMessage({action:'relayPairDesktop',url,code}); }, {url,code});
  await popup.addStyleTag({content:'body.popup{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%) scale(1.55);transform-origin:center;background:#f6f8f4;border:1px solid #dce4da;border-radius:18px;box-shadow:0 25px 70px #24382b18}html{background:#edf1e9}'});
  await prepare(popup); await hold(2200); await point(popup,'#grokEnabled',true); await hold(1400); await point(popup,'#grokEnabled',true);
  await point(popup,'#volumeSlider'); await popup.locator('#volumeSlider').fill('0.65'); await popup.locator('#volumeSlider').dispatchEvent('input'); await hold(2300); await point(popup,'#openOptions'); await hold(1300); await finish(popup,'01-popup');
  console.log('完成镜头：精简弹窗');
  const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`); await options.locator('#disconnect').waitFor({state:'visible'}); await prepare(options); await hold(2000);
  await options.evaluate(() => window.scrollTo({top:380,behavior:'smooth'})); await hold(1800);
  await point(options,'[data-setting="chatgptReasoningEndEnabled"]',true); await hold(1500); await point(options,'[data-setting="chatgptReasoningEndEnabled"]',true); await hold(2200); await finish(options,'02-options');
  console.log('完成镜头：插件管理页');
  const page = await context.newPage(); await page.goto(url); await page.locator('.tool-card').first().waitFor(); await prepare(page); await hold(3500);
  await page.evaluate(() => document.querySelector('#tool-grid').scrollIntoView({behavior:'smooth',block:'center'})); await hold(2500);
  for (const tool of ['claude','codex','opencode']) {
    await point(page,`button[data-id="${tool}"]`,true); await page.locator('#preview-dialog[open]').waitFor(); await hold(3400);
    await point(page,'#apply',true); await page.locator(`button[data-id="${tool}"][data-action="restore"]`).waitFor(); await hold(2300);
    console.log('完成镜头：'+tool+' 配置预览与接入');
  }
  await page.evaluate(() => document.querySelector('#preferences').scrollIntoView({behavior:'smooth',block:'center'})); await hold(2300);
  await point(page,'input[name="attention"]',true); await hold(1500); await point(page,'input[name="volume"]'); await page.locator('input[name="volume"]').fill('50'); await page.locator('input[name="volume"]').dispatchEvent('input');
  await point(page,'#prefs-form button',true);
  // 打开扩展页触发真实即时同步，等待后端确认，不模拟保存成功。
  const syncPage = await context.newPage(); await syncPage.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForFunction(() => document.querySelector('#shared-status').textContent.includes('已与本机偏好一致'), null, {timeout:45000});
  await syncPage.close(); await hold(2500);
  await page.evaluate(() => document.querySelector('#tool-grid').scrollIntoView({behavior:'smooth',block:'center'})); await hold(2000);
  await point(page,'button[data-id="claude"]',true); await page.locator('#preview-dialog[open]').waitFor(); await hold(2800); await point(page,'#apply',true); await hold(2200);
  await page.evaluate(() => window.scrollTo({top:0,behavior:'smooth'})); await hold(4000); await finish(page,'03-workflow');
  fs.writeFileSync(path.join(out,'recordings.json'),JSON.stringify(recordings,null,2));
} finally { await context.close(); await new Promise(resolve=>server.close(resolve)); fs.rmSync(home,{recursive:true,force:true}); }
