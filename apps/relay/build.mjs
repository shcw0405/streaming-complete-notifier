import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { packager } from '@electron/packager';
import { buildIcon } from './build-icon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('首版打包目标为 macOS Apple Silicon，请在对应主机上构建。');
const cache = path.join(here, '.build-cache'); fs.mkdirSync(cache, { recursive: true });
const release = path.join(here, 'release'); fs.mkdirSync(release, { recursive: true });
const electronVersion = JSON.parse(fs.readFileSync(path.join(here, 'node_modules/electron/package.json'))).version;
// 使用 npm 包自带的校验值复用缓存，避免再请求 GitHub 校验文件。
const electronZip = path.join(cache, `electron-v${electronVersion}-darwin-arm64.zip`);
const electronRequire = createRequire(path.join(here, 'node_modules/electron/package.json'));
const checksums = electronRequire('./checksums.json');
if (!fs.existsSync(electronZip)) {
  const { downloadArtifact } = electronRequire('@electron/get');
  const cached = await downloadArtifact({ version: electronVersion, artifactName: 'electron', platform: 'darwin', arch: 'arm64', checksums });
  fs.copyFileSync(cached, electronZip);
}
if (crypto.createHash('sha256').update(fs.readFileSync(electronZip)).digest('hex') !== checksums[path.basename(electronZip)]) throw Error('Electron 运行时校验失败。');
const get = url => execFileSync('curl', ['--fail', '--location', '--retry', '2', '--silent', '--show-error', url], { maxBuffer: 100 * 1024 * 1024 });
// 使用官方独立 Node 运行时，不携带开发机的 Homebrew 动态库依赖。
const nodeVersion = 'v24.14.0';
const archive = `node-${nodeVersion}-darwin-arm64.tar.gz`;
if (!fs.existsSync(path.join(cache, 'node'))) {
  const base = `https://nodejs.org/dist/${nodeVersion}/`;
  const data = get(base + archive);
  const expected = get(base + 'SHASUMS256.txt').toString().split('\n').find(line => line.endsWith('  ' + archive))?.split(' ')[0];
  if (!expected || crypto.createHash('sha256').update(data).digest('hex') !== expected) throw Error('Node 运行时校验失败。');
  const tar = path.join(cache, archive); fs.writeFileSync(tar, data);
  execFileSync('tar', ['-xzf', tar, '-C', cache]);
  fs.copyFileSync(path.join(cache, `node-${nodeVersion}-darwin-arm64/bin/node`), path.join(cache, 'node'));
  fs.copyFileSync(path.join(cache, `node-${nodeVersion}-darwin-arm64/LICENSE`), path.join(cache, 'NODE-LICENSE'));
}
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-package-'));
const icon = buildIcon(cache);
for (const size of [16, 48, 128]) execFileSync('sips', ['-z', String(size), String(size), path.join(cache, 'relay-icon.png'), '--out', path.join(here, `../../src/javascript/icon${size}.png`)], { stdio: 'ignore' });
fs.copyFileSync(path.join(here, '../../src/javascript/icon128.png'), path.join(here, 'public/icon.png'));
for (const file of ['desktop.mjs', 'server.mjs', 'core.mjs', 'bridge.mjs', 'notify.mjs', 'package.json', 'package-lock.json']) fs.copyFileSync(path.join(here, file), path.join(stage, file));
fs.cpSync(path.join(here, 'public'), path.join(stage, 'public'), { recursive: true });
fs.mkdirSync(path.join(stage, 'node_modules'), { recursive: true });
fs.cpSync(path.join(here, 'node_modules/smol-toml'), path.join(stage, 'node_modules/smol-toml'), { recursive: true });
fs.mkdirSync(path.join(stage, 'bin')); fs.copyFileSync(path.join(cache, 'node'), path.join(stage, 'bin/node')); fs.chmodSync(path.join(stage, 'bin/node'), 0o755);
fs.copyFileSync(path.join(cache, 'NODE-LICENSE'), path.join(stage, 'bin/NODE-LICENSE'));
fs.mkdirSync(path.join(stage, 'assets'));
fs.copyFileSync(path.join(here, '../../src/javascript/audio/streaming-complete.mp3'), path.join(stage, 'assets/complete.mp3'));
const [appDir] = await packager({ dir: stage, out: release, name: 'Relay', icon, executableName: 'Relay', appBundleId: 'app.relay.notifier', appVersion: '0.3.1', platform: 'darwin', arch: 'arm64', asar: false, overwrite: true, prune: false, electronVersion, electronZipDir: cache, extendInfo: { LSUIElement: true, CFBundleDisplayName: '回响 Relay', NSHumanReadableCopyright: '回响 Relay · 本地试用版' } });
execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(appDir, 'Relay.app')]);
execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(appDir, 'Relay.app'), path.join(release, 'Relay-0.3.1-mac-arm64.zip')]);
const extensionStage = path.join(stage, 'relay-browser');
fs.cpSync(path.join(here, '../../src/javascript'), extensionStage, { recursive: true, filter: file => !path.basename(file).startsWith('.') });
execFileSync('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', extensionStage, path.join(release, 'Relay-Browser-1.4.0.zip')]);
fs.copyFileSync(path.join(here, 'INSTALL.md'), path.join(release, '安装与试用说明.md'));
const hashes = ['Relay-0.3.1-mac-arm64.zip', 'Relay-Browser-1.4.0.zip'].map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(release, name))).digest('hex')}  ${name}`).join('\n');
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), hashes + '\n');
console.log(`两个产品已打包到 ${release}\n构建暂存目录：${stage}`);
