import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Manager, codexConfig, writeAtomic } from '../core.mjs';
import { parse } from 'smol-toml';
import { createServer } from '../server.mjs';
import http from 'node:http';

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return new Manager({ home, env: { PATH: '' } });
}
test('Claude 合并其他 Hook，重复接入被阻止，恢复字节级原配置', t => {
  const m = setup(t); const before = '{"env":{"KEY":"private-value"},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo old"}]}]}}';
  writeAtomic(m.paths.claude, before);
  const plan = m.plan('claude', 'enable'); assert.ok(!JSON.stringify(plan).includes('private-value'));
  assert.equal(fs.readFileSync(m.paths.claude, 'utf8'), before);
  m.apply(plan.token);
  const after = JSON.parse(fs.readFileSync(m.paths.claude, 'utf8'));
  assert.equal(after.env.KEY, 'private-value'); assert.equal(after.hooks.Stop.length, 2);
  assert.equal(after.hooks.Notification[0].matcher, 'permission_prompt|elicitation_dialog');
  assert.throws(() => m.plan('claude', 'enable'), /已接入/);
  assert.equal(m.status().tools[0].status, 'enabled');
  m.apply(m.plan('claude', 'restore').token);
  assert.equal(fs.readFileSync(m.paths.claude, 'utf8'), before);
});
test('Codex 处理多行和带注释数组，不破坏其他 TOML 设置', t => {
  const m = setup(t);
  const before = '# 顶部\nmodel="test"\n"notify" = [\n  "old", # 注释\n  "a b",\n]\n\n[other]\nkey = "保留"\n';
  const result = codexConfig(before, ['node', '/tmp/a $ b/notify.mjs', 'codex']);
  assert.deepEqual(result.previous, ['old', 'a b']); assert.equal(parse(result.after).other.key, '保留');
  assert.ok(result.after.startsWith('# 顶部\nmodel="test"\n')); assert.ok(result.after.endsWith('[other]\nkey = "保留"\n'));
  writeAtomic(m.paths.codex, before); m.apply(m.plan('codex', 'enable').token);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(m.dir, 'codex-prior.json'))), ['old', 'a b']);
  m.apply(m.plan('codex', 'restore').token); assert.equal(fs.readFileSync(m.paths.codex, 'utf8'), before);
});
test('Codex 无 notify 时插在根区，并保留嵌套同名字段', () => {
  const before = '[tui]\nnotifications=true\n[other]\nnotify=["nested"]\n';
  const result = codexConfig(before, ['node', 'x']);
  assert.deepEqual(parse(result.after).notify, ['node', 'x']); assert.deepEqual(parse(result.after).other.notify, ['nested']);
});
test('原配置有语法错误时不写入', t => {
  const m = setup(t); writeAtomic(m.paths.claude, '{ broken');
  assert.throws(() => m.plan('claude', 'enable'));
  writeAtomic(m.paths.codex, 'notify = [broken'); assert.throws(() => m.plan('codex', 'enable'));
  assert.equal(fs.existsSync(m.runtime), false);
});
test('预览后变化、重复确认、接入后变化均有保护', t => {
  const m = setup(t); const p = m.plan('claude', 'enable'); writeAtomic(m.paths.claude, '{}');
  assert.throws(() => m.apply(p.token), /发生变化/);
  const p2 = m.plan('claude', 'enable'); m.apply(p2.token);
  assert.throws(() => m.apply(p2.token), /失效/);
  fs.appendFileSync(m.paths.claude, '\n');
  assert.throws(() => m.plan('claude', 'restore'), /自动恢复已暂停/);
  assert.equal(m.status().tools[0].status, 'changed');
});
test('OpenCode 插件可加载，只响应支持的事件，恢复时移除新增文件', async t => {
  const m = setup(t); m.apply(m.plan('opencode', 'enable').token);
  const mod = await import(pathToFileURL(m.paths.opencode));
  const hooks = await mod.RelayPlugin({ directory: '/tmp/project' });
  await hooks.event({ event: { type: 'session.created' } });
  assert.ok(fs.existsSync(m.runtime));
  assert.throws(() => m.plan('opencode', 'enable'), /已接入/);
  m.apply(m.plan('opencode', 'restore').token); assert.equal(fs.existsSync(m.paths.opencode), false);
});
test('自定义目录与带引号路径正确处理', t => {
  const m = setup(t);
  const special = new Manager({ home: path.join(m.home, "a ' b $ c"), env: { CLAUDE_CONFIG_DIR: path.join(m.home, 'claude-custom'), CODEX_HOME: path.join(m.home, 'codex-custom') } });
  special.apply(special.plan('claude', 'enable').token);
  special.savePreferences({ desktop: false, sound: false, volume: 0, project: false, attention: false });
  const cfg = JSON.parse(fs.readFileSync(special.paths.claude));
  execFileSync('/bin/sh', ['-c', cfg.hooks.Stop[0].hooks[0].command], { input: '{"hook_event_name":"Stop"}', timeout: 10000 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(special.dir, 'receipt-claude.json'))).desktop, 'off');
});
test('通知运行时转发旧 Codex 命令的原始载荷，通知不保存内容', t => {
  const m = setup(t); const target = path.join(m.home, 'payload.json'); const raw = '{"type":"agent-turn-complete","last-assistant-message":"SECRET"}';
  const previous = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(target)}, process.argv[1])`];
  writeAtomic(m.paths.codex, `notify = ${JSON.stringify(previous)}\n`); m.apply(m.plan('codex', 'enable').token);
  m.savePreferences({ desktop: false, sound: false, project: true, attention: false, volume: .5 });
  execFileSync(process.execPath, [m.runtime, 'codex', raw], { timeout: 10000 });
  assert.equal(fs.readFileSync(target, 'utf8'), raw);
  assert.ok(!fs.readFileSync(path.join(m.dir, 'receipt-codex.json'), 'utf8').includes('SECRET'));
});
test('拒绝目标符号链接和未知工具，参数校验', t => {
  const m = setup(t); const target = path.join(m.home, 'target'); writeAtomic(target, '{}'); fs.mkdirSync(path.dirname(m.paths.claude), { recursive: true }); fs.symlinkSync(target, m.paths.claude);
  assert.throws(() => m.plan('claude', 'enable'), /符号链接/); assert.throws(() => m.plan('__proto__', 'enable'), /不支持/);
  assert.throws(() => m.savePreferences({ sound: true }), /格式/);
});
test('HTTP 限制跨站、错误 Host 和无令牌请求，真实预览应用闭环', async t => {
  const m = setup(t); const server = createServer(m);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(url)).text(); const token = html.match(/name="relay-token" content="([^"]+)"/)[1];
  assert.equal((await fetch(url + '/api/status')).status, 403);
  assert.equal((await fetch(url, { headers: { Origin: 'https://other.example' } })).status, 403);
  const navStatus = await new Promise(resolve => http.get(url, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } }, res => { res.resume(); resolve(res.statusCode); }));
  assert.equal(navStatus, 200);
  const crossApiStatus = await new Promise(resolve => http.get(url + '/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site', 'x-relay-token': token } }, res => { res.resume(); resolve(res.statusCode); }));
  assert.equal(crossApiStatus, 403);
  const badHostStatus = await new Promise(resolve => http.get(url, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }));
  assert.equal(badHostStatus, 403);
  const headers = { 'x-relay-token': token, 'Content-Type': 'application/json' };
  const plan = await (await fetch(url + '/api/preview', { method: 'POST', headers, body: JSON.stringify({ id: 'claude', action: 'enable' }) })).json();
  assert.equal(fs.existsSync(m.paths.claude), false);
  const result = await fetch(url + '/api/apply', { method: 'POST', headers, body: JSON.stringify({ token: plan.token }) });
  assert.equal(result.status, 200); assert.equal(m.status().tools[0].status, 'enabled');
});
test('扩展配对 API 限定来源和能力，不授予本机配置访问', async t => {
  const m = setup(t); const server = createServer(m);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(url)).text()).match(/name="relay-token" content="([^"]+)"/)[1];
  const headers = { 'x-relay-token': token, 'Content-Type': 'application/json' };
  const { code } = await (await fetch(url + '/api/pair', { method: 'POST', headers, body: '{}' })).json();
  const extensionHeaders = { 'Content-Type': 'application/json', Origin: 'chrome-extension://' + 'a'.repeat(32) };
  const website = await fetch(url + '/bridge/pair', { method: 'POST', headers: { ...extensionHeaders, Origin: 'https://evil.example' }, body: JSON.stringify({ code }) });
  assert.equal(website.status, 403);
  const paired = await fetch(url + '/bridge/pair', { method: 'POST', headers: extensionHeaders, body: JSON.stringify({ code }) });
  assert.equal(paired.status, 200);
  const pair = await paired.json(); assert.ok(pair.token);
  assert.equal((await fetch(url + '/api/status', { headers: { ...extensionHeaders, 'x-relay-token': token, 'x-relay-pair': pair.token } })).status, 403);
  const preflight = await fetch(url + '/bridge/sync', { method: 'OPTIONS', headers: { Origin: extensionHeaders.Origin } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), extensionHeaders.Origin);
});
test('自动发现不发放令牌，连接必须通过本机确认，取消不落盘', async t => {
  const m = setup(t); let allow = false;
  const server = createServer(m, { approveConnection: async () => allow });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', Origin: 'chrome-extension://' + 'a'.repeat(32) };
  const post = (route, extra = {}) => fetch(url + '/bridge/' + route, { method: 'POST', headers: { ...headers, ...extra }, body: '{}' });
  const discovered = await (await post('discover')).json();
  assert.equal(discovered.product, 'relay-notifier'); assert.equal(discovered.token, undefined); assert.equal(discovered.connected, false);
  assert.equal((await post('connect')).status, 403);
  assert.equal(fs.existsSync(path.join(m.dir, 'browser-pair.json')), false);
  allow = true; const connected = await (await post('connect')).json(); assert.ok(connected.token);
  assert.equal((await (await post('discover', { 'x-relay-pair': connected.token })).json()).connected, true);
  assert.equal((await post('disconnect', { 'x-relay-pair': 'bad' })).status, 403);
  assert.equal((await post('disconnect', { 'x-relay-pair': connected.token })).status, 200);
});
