import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Manager } from './core.mjs';
import { BrowserBridge } from './bridge.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const execute = promisify(execFile);
export function createServer(manager = new Manager(), { approveConnection } = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const bridge = new BrowserBridge(manager.dir, { onSharedChange(settings) {
    const prefs = manager.preferences();
    const mapping = { notificationEnabled: 'desktop', soundEnabled: 'sound', soundVolume: 'volume' };
    for (const [key, value] of Object.entries(settings)) prefs[mapping[key]] = value;
    manager.savePreferences(prefs);
  } });
  let approving = false;
  const files = { '/': ['index.html', 'text/html'], '/icon.png': ['icon.png', 'image/png'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/browser.js': ['browser.js', 'text/javascript'] };
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    // 扩展打开管理台属于顶层跨来源导航；允许打开静态首页，API 仍需同源和令牌。
    const landingNavigation = req.method === 'GET' && req.url?.split(/[?#]/)[0] === '/' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers.host !== `127.0.0.1:${server.address().port}`) return send(403, { error: '仅允许本机界面访问。' });
    // 扩展只拿到浏览器设置专用能力，不能读取或修改 CLI 文件。
    if (['/bridge/discover', '/bridge/connect', '/bridge/disconnect', '/bridge/pair', '/bridge/sync'].includes(req.url) && /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || '')) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type, x-relay-pair' }); return res.end();
      }
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') return send(400, { error: '请求格式不正确。' });
      try {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16000) return send(413, { error: '请求过大。' }); }
        const body = JSON.parse(raw);
        const paired = bridge.pair && bridge.pair.origin === req.headers.origin && bridge.pair.token === req.headers['x-relay-pair'];
        if (req.url === '/bridge/discover') return send(200, { product: 'relay-notifier', protocol: 1, name: '回响 Relay', url: origin + '/', connected: Boolean(paired), canConnect: Boolean(approveConnection) });
        if (req.url === '/bridge/disconnect') {
          if (!paired) throw Error('连接已失效。');
          return send(200, bridge.revoke());
        }
        if (req.url === '/bridge/connect') {
          if (paired) return send(200, { token: bridge.pair.token });
          if (!approveConnection) throw Error('请启动回响桌面应用后连接。');
          if (approving) throw Error('已有连接请求等待确认，请查看桌面应用。');
          approving = true;
          try {
            if (!await approveConnection({ extensionOrigin: req.headers.origin, url: origin + '/' })) throw Error('你已取消连接，未修改任何设置。');
            return send(200, bridge.connect(bridge.issue().code, req.headers.origin));
          } finally { approving = false; }
        }
        return send(200, req.url === '/bridge/pair' ? bridge.connect(body.code, req.headers.origin) : bridge.sync(req.headers['x-relay-pair'], req.headers.origin, body));
      } catch (e) { return send(403, { error: e.message }); }
    }
    if ((req.headers.origin && req.headers.origin !== origin) || (req.headers['sec-fetch-site'] === 'cross-site' && !landingNavigation)) return send(403, { error: '仅允许本机界面访问。' });
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && files[url.pathname]) {
      const [name, type] = files[url.pathname];
      let content = fs.readFileSync(path.join(here, 'public', name), type === 'image/png' ? undefined : 'utf8');
      if (name === 'index.html') content = content.replace('__TOKEN__', secret);
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'X-Content-Type-Options': 'nosniff' }); return res.end(content);
    }
    if (req.headers['x-relay-token'] !== secret) return send(403, { error: '请刷新回响界面后重试。' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/status') return send(200, manager.status());
      if (req.method === 'GET' && url.pathname === '/api/browser') return send(200, bridge.status());
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') return send(400, { error: '请求格式不正确。' });
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16000) return send(413, { error: '请求过大。' }); }
      const body = JSON.parse(raw || '{}');
      if (url.pathname === '/api/pair') return send(200, bridge.issue());
      if (url.pathname === '/api/unpair') return send(200, bridge.revoke());
      if (url.pathname === '/api/browser') return send(200, await bridge.save(body));
      if (url.pathname === '/api/preview') return send(200, manager.plan(body.id, body.action));
      if (url.pathname === '/api/apply') return send(200, manager.apply(body.token));
      if (url.pathname === '/api/preferences') return send(200, manager.savePreferences(body));
      if (url.pathname === '/api/test') {
        manager.installRuntime();
        await execute(manager.node, [manager.runtime, 'test', '{}'], { timeout: 15000 });
        return send(200, { ok: true, message: '测试已执行。系统命令成功不代表通知可见，请确认是否收到声音与横幅。' });
      }
      return send(404, { error: '未找到此操作。' });
    } catch (e) { return send(409, { error: e.message }); }
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '回响端口已占用。已有实例可访问 http://127.0.0.1:62348/；或用 RELAY_PORT 指定另一端口，并在扩展弹窗更新地址。' : error.message);
    process.exitCode = 1;
  });
  server.listen(Number(process.env.RELAY_PORT || 62348), '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    console.log(`回响已启动：${url}\n通知脚本独立工作；配置完成后可关闭此窗口。`);
    if (process.argv.includes('--open')) execFile('open', [url]);
  });
}
