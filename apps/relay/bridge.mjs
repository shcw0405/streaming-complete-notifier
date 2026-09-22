import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeAtomic } from './core.mjs';

const keys = ['geminiEnabled', 'chatgptEnabled', 'grokEnabled', 'aistudioEnabled', 'chatgptReasoningEndEnabled', 'tabKeepAliveEnabled', 'notificationEnabled', 'soundEnabled', 'soundVolume'];
export function validateSettings(input, complete = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('浏览器设置格式不正确。');
  if (complete && keys.some(k => !Object.hasOwn(input, k))) throw Error('浏览器状态不完整。');
  for (const [k, v] of Object.entries(input)) {
    if (!keys.includes(k) || (k === 'soundVolume' ? !Number.isFinite(v) || v < 0 || v > 1.5 : typeof v !== 'boolean')) throw Error('浏览器设置项无效。');
  }
  return input;
}
export class BrowserBridge {
  constructor(dir, { onSharedChange = () => {} } = {}) {
    this.onSharedChange = onSharedChange;
    this.file = path.join(dir, 'browser-pair.json');
    try { this.pair = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.pending = null;
  }
  issue() {
    this.code = crypto.randomBytes(16).toString('hex'); this.expires = Date.now() + 300000;
    return { code: this.code, expires: this.expires };
  }
  revoke() {
    writeAtomic(this.file, 'null'); this.pair = null; this.last = null; this.code = null;
    if (this.pending) this.pending.finish(Error('配对已取消。'));
    return { ok: true };
  }
  connect(code, origin) {
    if (!this.code || Date.now() > this.expires || code !== this.code) throw Error('配对码无效或已过期，请在桌面端重新生成。');
    const pair = { token: crypto.randomBytes(32).toString('hex'), origin };
    writeAtomic(this.file, JSON.stringify(pair)); this.pair = pair; this.code = null; this.last = null;
    if (this.pending) this.pending.finish(Error('已切换到新的浏览器。'));
    return { token: pair.token };
  }
  sync(token, origin, body) {
    if (!this.pair || token !== this.pair.token || origin !== this.pair.origin) throw Error('配对失效，请重新连接。');
    validateSettings(body.settings, true);
    // 首次连接保留双方设置。之后仅合并发生变化的公共字段，避免覆盖本机独有偏好。
    const sharedKeys = ['notificationEnabled', 'soundEnabled', 'soundVolume'];
    const acknowledged = this.pending && body.ack === this.pending.id && Object.entries(this.pending.settings).every(([k, v]) => body.settings[k] === v);
    if (!this.pending || acknowledged) {
      const previous = this.pair.shared;
      const shared = Object.fromEntries(sharedKeys.map(key => [key, body.settings[key]]));
      const changes = Object.fromEntries(sharedKeys.filter(key => previous && previous[key] !== shared[key]).map(key => [key, shared[key]]));
      if (Object.keys(changes).length) this.onSharedChange(changes);
      if (!previous || Object.keys(changes).length) {
        const pair = { ...this.pair, shared };
        writeAtomic(this.file, JSON.stringify(pair)); this.pair = pair;
      }
    }
    this.last = { ok: true, settings: body.settings, version: String(body.version || '').slice(0, 24), at: Date.now() };
    if (this.pending && body.ack === this.pending.id && Object.entries(this.pending.settings).every(([k,v]) => body.settings[k] === v)) this.pending.finish(null, this.last);
    return { ok: true, pending: this.pending ? { id: this.pending.id, settings: this.pending.settings } : null };
  }
  status() {
    if (!this.last || Date.now() - this.last.at > 65000) throw Error(this.pair ? '已连接，等待浏览器上线。请打开浏览器，再检查连接。' : '请在浏览器扩展的管理页面自动检测本机回响并连接。');
    return this.last;
  }
  save(settings) {
    validateSettings(settings); this.status();
    if (this.pending) throw Error('正在等待上一项设置写入，请稍后重试。');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.pending?.finish(Error('扩展未确认写入，请打开扩展弹窗后重试。')), 40000);
      this.pending = { id: crypto.randomUUID(), settings, finish: (error, result) => { clearTimeout(timer); this.pending = null; error ? reject(error) : resolve(result); } };
    });
  }
}
