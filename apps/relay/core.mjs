import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

const here = path.dirname(fileURLToPath(import.meta.url));
export const digest = value => crypto.createHash('sha256').update(value ?? '<不存在>').digest('hex');
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const json = value => JSON.stringify(value, null, 2) + '\n';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('配置必须是对象，已停止写入。'); return value; }
export function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('配置为符号链接，请先在实际配置目录使用本应用。');
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, value, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

// 通过完整 TOML 解析验证修改，仅替换 notify 所占的原始行，保留其他注释与格式。
export function codexConfig(before, command) {
  const parsed = parseToml(before || '');
  const previous = parsed.notify;
  if (previous !== undefined && (!Array.isArray(previous) || previous.some(x => typeof x !== 'string'))) throw Error('Codex notify 格式异常，请检查原配置。');
  const line = `notify = ${JSON.stringify(command)}\n`;
  if (previous === undefined) return { after: line + (before || ''), previous: null };
  const lines = before.split(/(?<=\n)/);
  for (let start = 0; start < lines.length; start++) {
    if (!/^\s*(notify|"notify"|'notify')\s*=/.test(lines[start])) continue;
    for (let end = start + 1; end <= lines.length; end++) {
      const candidate = lines.slice(0, start).join('') + line + lines.slice(end).join('');
      try {
        const actual = parseToml(candidate);
        const expected = { ...parsed, notify: command };
        if (JSON.stringify(actual) === JSON.stringify(expected)) return { after: candidate, previous };
      } catch { /* 继续查找多行数组末尾。 */ }
    }
  }
  throw Error('无法在保留原配置的情况下替换 notify，未修改任何内容。');
}

export class Manager {
  constructor({ home = os.homedir(), env = process.env, node = process.execPath, soundSource = path.join(here, '../../src/javascript/audio/streaming-complete.mp3') } = {}) {
    this.home = home; this.env = env; this.node = node;
    this.soundSource = soundSource;
    this.dir = path.join(home, '.relay-notifier');
    this.runtime = path.join(this.dir, 'notify.mjs');
    this.paths = {
      claude: path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'settings.json'),
      codex: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'),
      opencode: path.join(env.OPENCODE_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode'), 'plugins', 'relay-notifier.js')
    };
    this.plans = new Map();
  }
  state() { return JSON.parse(read(path.join(this.dir, 'state.json')) || '{"tools":{}}'); }
  saveState(value) { writeAtomic(path.join(this.dir, 'state.json'), json(value)); }
  preferences() { return { sound: true, desktop: true, volume: 0.65, project: true, attention: false, ...JSON.parse(read(path.join(this.dir, 'preferences.json')) || '{}') }; }
  savePreferences(input) {
    const prefs = this.preferences();
    for (const key of ['sound', 'desktop', 'project', 'attention']) {
      if (typeof input[key] !== 'boolean') throw Error('提醒设置格式不正确。');
      prefs[key] = input[key];
    }
    if (!Number.isFinite(input.volume) || input.volume < 0 || input.volume > 1.5) throw Error('音量必须在 0–150% 之间。');
    prefs.volume = input.volume;
    writeAtomic(path.join(this.dir, 'preferences.json'), json(prefs)); return prefs;
  }
  installRuntime() {
    writeAtomic(this.runtime, fs.readFileSync(path.join(here, 'notify.mjs'), 'utf8'));
    const sound = path.join(this.dir, 'complete.mp3');
    if (!fs.existsSync(sound)) {
      fs.copyFileSync(this.soundSource, sound);
      fs.chmodSync(sound, 0o600);
    }
  }
  executable(name) {
    for (const folder of (this.env.PATH || '').split(path.delimiter)) {
      const target = path.join(folder, name);
      try { fs.accessSync(target, fs.constants.X_OK); if (fs.statSync(target).isFile()) return target; } catch { /* 检查下一个目录。 */ }
    }
    return null;
  }
  status() {
    const state = this.state();
    const tools = [['claude', 'Claude Code', 'claude'], ['codex', 'Codex', 'codex'], ['opencode', 'OpenCode', 'opencode'], ['deepseek', 'DeepSeek Harness', 'dsh']].map(([id, name, binary]) => {
      const target = this.paths[id]; const record = state.tools[id];
      let content = null, error = null;
      try { content = target ? read(target) : null; } catch { error = '无法读取配置，请检查文件权限。'; }
      let status = record ? (digest(content) === record.afterHash ? 'enabled' : 'changed') : 'available';
      if (!target) status = 'planned';
      let existing = false;
      try {
        if (id === 'claude' && content) { const v = object(JSON.parse(content)); existing = Boolean(v.hooks?.Stop?.length || v.hooks?.Notification?.length); }
        if (id === 'codex' && content) existing = parseToml(content).notify !== undefined;
        if (id === 'opencode' && content && !record) error = '目标插件文件已存在；请先移开同名文件，避免覆盖。';
      } catch { error = '配置格式无效，无法安全修改。'; }
      return { id, name, binary: this.executable(binary), path: target, exists: content !== null, status, existing, error, installedAt: record?.at };
    });
    const entries = fs.existsSync(this.dir) ? fs.readdirSync(this.dir).filter(x => /^receipt-.*\.json$/.test(x)) : [];
    const receipts = entries.map(x => { try { return JSON.parse(read(path.join(this.dir, x))); } catch { return null; } }).filter(Boolean);
    return { tools, preferences: this.preferences(), receipts, platform: process.platform, terminalNotifier: Boolean(this.executable('terminal-notifier')), dataDir: this.dir };
  }
  plan(id, action) {
    if (!Object.hasOwn(this.paths, id) || !['enable', 'restore'].includes(action)) throw Error('不支持这个操作。');
    const file = this.paths[id];
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('配置为符号链接，首版不自动替换链接。');
    const before = read(file); const state = this.state(); const record = state.tools[id];
    let after, previous = null, snippet, notes = [];
    if (action === 'restore') {
      if (!record) throw Error('该工具没有由回响管理的配置。');
      if (digest(before) !== record.afterHash) throw Error('配置在接入后被修改，为保留你的新改动，自动恢复已暂停。原始备份位于：' + record.backup);
      after = record.existed ? fs.readFileSync(record.backup, 'utf8') : null;
      snippet = '恢复接入前的配置快照。' + (record.existed ? '' : '\n移除回响创建的配置文件。');
    } else {
      if (record) throw Error('此工具已接入；如需重新配置，请先恢复。');
      const args = [this.node, this.runtime, id];
      if (id === 'claude') {
        const data = object(JSON.parse(before || '{}'));
        data.hooks = data.hooks === undefined ? {} : object(data.hooks);
        const added = {};
        for (const event of ['Stop', 'Notification']) {
          if (data.hooks[event] !== undefined && !Array.isArray(data.hooks[event])) throw Error('Claude Hook 格式无效。');
          const group = { hooks: [{ type: 'command', command: args.map(quote).join(' '), timeout: 8 }] };
          if (event === 'Notification') group.matcher = 'permission_prompt|elicitation_dialog';
          data.hooks[event] = [...(data.hooks[event] || []), group]; added[event] = [group];
        }
        after = json(data); snippet = json({ hooks: added });
        notes.push('保留原有 Hook；完成事件默认提醒，权限请求提醒可在设置中开启。');
      } else if (id === 'codex') {
        ({ after, previous } = codexConfig(before || '', args));
        snippet = `notify = ${JSON.stringify(args)}`;
        if (previous?.length) notes.push('已发现旧 notify：会先调用旧命令，再发送回响通知。旧命令本身发声时可能出现两次提醒。');
        notes.push('本次不调整已有 Stop Hook 或终端内置提示设置。');
      } else {
        if (before !== null) throw Error('同名插件已存在，无法覆盖。');
        after = `// 回响管理的 OpenCode 通知插件。\nimport { spawn } from 'node:child_process';\nexport const RelayPlugin = async ({ directory }) => ({\n  event: async ({ event }) => {\n    if (!['session.idle', 'session.error', 'permission.asked'].includes(event.type)) return;\n    const payload = JSON.stringify({ type: event.type, cwd: directory });\n    const child = spawn(${JSON.stringify(this.node)}, [${JSON.stringify(this.runtime)}, 'opencode', payload], { detached: true, stdio: 'ignore' });\n    child.on('error', () => {});\n    child.unref();\n  }\n});\n`;
        snippet = after; notes.push('创建独立插件，保留 opencode.json 和其他插件。');
      }
      notes.push('接入后请重新启动对应 CLI；自定义 --settings 或项目级覆盖可能影响生效。');
    }
    const token = crypto.randomUUID();
    const plan = { token, id, action, file, before, after, previous, hash: digest(before), created: Date.now(), snippet, notes };
    // 预览只存内存，十分钟后失效，不向浏览器暴露原配置中的凭据。
    for (const [key, p] of this.plans) if (Date.now() - p.created > 600000) this.plans.delete(key);
    this.plans.set(token, plan);
    return { token, id, action, file, snippet, notes, backup: action === 'restore' ? record.backup : '修改前自动创建仅本用户可读的备份' };
  }
  apply(token) {
    const p = this.plans.get(token);
    if (!p || Date.now() - p.created > 600000) throw Error('预览已失效，请重新预览。');
    this.plans.delete(token);
    if (digest(read(p.file)) !== p.hash) throw Error('预览后配置发生变化，请重新预览。');
    const state = this.state();
    if (p.action === 'enable') {
      if (state.tools[p.id]) throw Error('工具已经接入，请刷新。');
      this.installRuntime();
      const backup = path.join(this.dir, 'backups', `${p.id}-${Date.now()}-${crypto.randomUUID()}.bak`);
      writeAtomic(backup, p.before || '');
      const prior = path.join(this.dir, 'codex-prior.json');
      const oldPrior = read(prior);
      if (p.id === 'codex') writeAtomic(prior, json(p.previous));
      state.tools[p.id] = { backup, existed: p.before !== null, afterHash: digest(p.after), at: new Date().toISOString() };
      try { writeAtomic(p.file, p.after); this.saveState(state); }
      catch (e) {
        if (p.before === null) { if (fs.existsSync(p.file)) fs.unlinkSync(p.file); }
        else writeAtomic(p.file, p.before);
        if (p.id === 'codex') { if (oldPrior === null) fs.unlinkSync(prior); else writeAtomic(prior, oldPrior); }
        throw e;
      }
    } else {
      delete state.tools[p.id];
      if (p.after === null) fs.unlinkSync(p.file); else writeAtomic(p.file, p.after);
      try { this.saveState(state); } catch (e) { writeAtomic(p.file, p.before); throw e; }
    }
    return { ok: true, message: p.action === 'enable' ? '已接入。重新启动对应编程工具后生效。' : '已恢复接入前的配置；备份仍保留。' };
  }
}
