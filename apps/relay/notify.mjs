// 独立通知运行时：不依赖配置界面或第三方 Node 包。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const dir = path.dirname(fileURLToPath(import.meta.url));
const tool = process.argv[2];
const names = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', test: '回响 · 通知测试' };
function readJson(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return fallback; } }
function run(command, args, timeout = 5000) { execFileSync(command, args, { timeout, stdio: 'ignore' }); }
async function input() {
  if (process.argv[3]) return process.argv[3];
  if (process.stdin.isTTY) return '{}';
  return new Promise(resolve => {
    let value = ''; const timer = setTimeout(() => { process.stdin.destroy(); resolve(value || '{}'); }, 1200);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { value += chunk; if (value.length > 262144) { clearTimeout(timer); process.stdin.destroy(); resolve('{}'); } });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(value || '{}'); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve('{}'); });
  });
}
async function main() {
  if (!names[tool]) return;
  const raw = await input();
  // Codex 原有命令使用原始 JSON 参数继续运行，不经 shell 拼接。
  if (tool === 'codex') {
    const prior = readJson('codex-prior.json', null);
    if (Array.isArray(prior) && prior.length && prior.every(x => typeof x === 'string') && !prior.includes(fileURLToPath(import.meta.url))) {
      try { run(prior[0], [...prior.slice(1), raw], 2500); } catch { /* 旧命令失败不能阻止当前通知。 */ }
    }
  }
  let data; try { data = JSON.parse(raw); } catch { data = {}; }
  if (tool === 'codex' && data.type && data.type !== 'agent-turn-complete') return;
  const attention = data.hook_event_name === 'Notification' || data.type === 'permission.asked';
  const failure = data.type === 'session.error';
  const prefs = { desktop: true, sound: true, volume: 0.65, project: true, attention: false, ...readJson('preferences.json', {}) };
  if (attention && !prefs.attention) return;
  const title = names[tool];
  const status = attention ? '需要你确认权限' : failure ? '任务出现异常，请返回查看' : '本轮已完成，可以回来继续了';
  const project = prefs.project && typeof data.cwd === 'string' ? path.basename(data.cwd).slice(0, 60) : '';
  const message = project ? `${project} · ${status}` : status;
  const results = { tool, at: new Date().toISOString(), event: attention ? 'attention' : failure ? 'failed' : 'complete', desktop: 'off', sound: 'off' };
  if (process.platform === 'darwin') {
    if (prefs.desktop) {
      const notifier = ['/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier'].find(x => fs.existsSync(x));
      try {
        if (notifier) {
          const bundles = { 'iTerm.app': 'com.googlecode.iterm2', vscode: 'com.microsoft.VSCode', 'Apple_Terminal': 'com.apple.Terminal', 'ghostty': 'com.mitchellh.ghostty', 'WarpTerminal': 'dev.warp.Warp-Stable' };
          const target = bundles[process.env.TERM_PROGRAM];
          run(notifier, ['-title', title, '-message', message, ...(target ? ['-activate', target] : [])]);
        } else {
          run('/usr/bin/osascript', ['-e', 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run', title, message]);
        }
        results.desktop = 'submitted';
      } catch { results.desktop = 'failed'; }
    }
    if (prefs.sound) {
      try { run('/usr/bin/afplay', ['-v', String(Math.max(0, Math.min(1.5, Number(prefs.volume) || 0)) ** 2), path.join(dir, 'complete.mp3')]); results.sound = 'played'; }
      catch { results.sound = 'failed'; }
    }
  } else { results.desktop = 'unsupported'; results.sound = 'unsupported'; }
  // 仅记录结果与时间，不记录提问、回答、项目路径。
  fs.writeFileSync(path.join(dir, `receipt-${tool}.json`), JSON.stringify(results), { mode: 0o600 });
}
main().catch(() => {}).finally(() => { process.exitCode = 0; });
