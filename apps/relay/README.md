# 回响 Relay · 桌面与浏览器试用版

统一管理网页 AI 与编程工具的完成提醒。桌面安装包支持 **macOS Apple Silicon**，内置 Electron、本地服务与独立 Node 运行时；用户无需安装 Node。Chrome / Edge 配套扩展仍可独立运行。配置与通知不调用模型，不上传对话内容。

## 安装包与桌面开发

`npm ci && npm run package` 生成 `release/Relay-0.2.0-mac-arm64.zip` 与 `release/Relay-Browser-1.4.0.zip`。首次构建下载经校验的 Electron 和官方 Node 24.14.0，之后复用缓存。当前为本机 ad-hoc 签名，未 Apple 公证，未上架扩展商店。安装步骤见 [INSTALL.md](INSTALL.md)。

先构建后可 `npm run desktop` 开发桌面应用。`desktop.mjs` 管理单实例、菜单栏、窗口与服务生命周期；关闭窗口不退出，退出应用停止本地管理服务。CLI 通知脚本使用 `~/.relay-notifier/bin/node`，不依赖 Electron 是否运行或安装目录是否移动。

0.2 / 扩展 1.4 起，扩展 `options.html` 管理页自动检测默认和已连接地址，在桌面系统确认框授权连接，不再输入地址或配对码。弹窗只保留常用提醒开关、音量、试听和「管理」入口。`bridge.mjs` 只暴露白名单提醒设置，令牌绑定扩展来源，不授权本机文件操作。每 30 秒及弹窗打开时同步，桌面保存等待真实扩展确认后才显示成功。一次绑定一个浏览器配置，支持在管理页撤销；首次连接不覆盖原设置。旧配对码 API 暂留兼容测试，不再展示。

自动化测试：`npm test`。可通过 `RELAY_PLAYWRIGHT`、`RELAY_BROWSER` 指定 Playwright 和 Edge 路径，运行 `node test/desktop-smoke.mjs` 验收真实安装包与扩展，运行 `node test/browser-smoke.mjs`、`node test/extension-smoke.mjs` 回归浏览器界面与旧标签页授权。桌面验收使用临时配置目录。

## 纯本地网页开发模式（需要 Node.js 20+）

双击本目录的 **启动回响.command**。首次运行自动执行 `npm ci` 安装 TOML 解析库，随后打开本机界面。

也可以在本目录运行：

```sh
npm ci
npm start
```

默认地址为 `http://127.0.0.1:62348/`。服务只绑定 `127.0.0.1`，不开放到局域网。可用 `RELAY_PORT` 指定其他端口。按 Ctrl+C 停止配置服务；已安装通知脚本依然生效。

## 网页与 CLI 统一管理

1. 在 Chrome / Edge 扩展管理页重新加载仓库的 `src/javascript/`（桥接从扩展 1.2.0 开始提供）。
2. 启动回响桌面端，在扩展弹窗中点击「管理」，自动发现后连接并在桌面端确认，然后点击「打开统一工作台」。新用户请使用桌面版；纯 Node 开发服务默认不提供无配对码授权回调。
3. 此时打开的管理台标签页获得扩展授权，能显示真实网页平台开关，并直接写入 `chrome.storage.sync`。
4. 同一界面下方继续管理 Claude Code、Codex、OpenCode 的本机配置。
5. 在扩展已连接时保存提醒偏好，会同步桌面通知、声音和 0–150% 音量。首次连接只读取，不自动覆盖任意一边的设置；可手动「同步本机提醒偏好到扩展」。

Chrome / Edge 的扩展不会自动出现在另一个浏览器配置中。请从安装扩展的浏览器管理页面连接桌面端；连接后桌面窗口可统一管理。未连接时，CLI 设置仍可操作，网页控件禁用并显示连接说明。

浏览器弹窗的快捷设置仍有效，管理台重新检查连接时读取最新值。旧标签页桥接不轮询；新版桌面配对通道通过后台轮询同步并显式确认写入。扩展断开时保存只影响 CLI，并明确报告网页未同步。后台保活修改需要刷新 AI 页面，目前注入覆盖 ChatGPT、Gemini、Grok。

## 两个运行端，一个管理入口

| 职责 | 浏览器扩展 | 本机后端 |
| --- | --- | --- |
| 捕获事件 | 现有网页 Hook / webRequest | Claude Hook / Codex notify / OpenCode 插件 |
| 保存设置 | Chrome storage.sync | 本机 JSON / TOML / 独立插件 |
| 发送通知 | Chrome 通知 + offscreen 音频 | macOS 通知 + afplay |
| 返回任务 | 定位网页标签页 | 支持时激活终端应用 |
| 关闭管理台后 | 独立运行 | 独立通知脚本运行 |

管理台通过受限的扩展消息接口管理网页设置，通过鉴权本机 API 管理 CLI 文件。网页完成事件不转发给本机重复通知。共享的是用户设置和管理入口；通知执行保留在最接近任务的环境。

标签页桥接仅接受由扩展管理页面主动打开的顶层标签页，检查标签页 ID、精确来源和路径；只开放状态读取与白名单设置写入，不开放任意脚本执行。授权随标签页关闭失效。自动发现不发放令牌，连接令牌只有在桌面系统确认后才签发。实现参考 [Chrome 扩展外部连接机制](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)。

## 试用流程

1. 界面自动扫描 PATH 和默认配置路径；支持继承 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`XDG_CONFIG_HOME`、`OPENCODE_CONFIG_DIR`。
2. 点击工具的「预览并接入」，查看路径、添加内容与已有配置处理方式。
3. 点击「确认接入」：先保存备份，再写入配置。预览之后文件变化会阻止写入。
4. 「体验一声回响」测试本机声音和系统通知。测试不会证明对应 CLI 的事件已经触发。
5. **重新启动对应 CLI**，运行一轮真实任务，收到通知后可刷新界面查看最后事件时间。
6. 「恢复原配置」恢复接入前的原始文件。文件被其他软件或用户修改后，恢复会暂停并显示备份路径，不覆盖新改动。

## 接入范围

| 工具 | 方式 | 支持事件 |
| --- | --- | --- |
| Claude Code | 合并用户 settings.json 中的 Stop 与 Notification Hook | 本轮结束；可选权限/输入请求 |
| Codex | 根级 notify 命令；转发原始 JSON 给已有 notify 命令 | agent-turn-complete |
| OpenCode | 全局 plugins/relay-notifier.js 独立插件 | session.idle、session.error、可选 permission.asked |
| DeepSeek Harness（dsh） | 检测与官方文档入口 | 首版暂未实现插件安装 |

Claude Hook 的成功是“本轮结束”，不承诺整个项目完成。其他配置文件（如自定义 `--settings`、项目级覆盖）、已有通知插件或 Hook 可能造成不生效或重复提醒；首版不会静默移除这些设置。

## 通知与配置文件

独立运行时、音频、偏好与备份位于 `~/.relay-notifier/`。Hook 使用 Node 和运行时的绝对路径，移动仓库不影响已安装提醒；卸载或移动 Node 后需重新接入。运行时仅保留每个工具最后一次通知的发送状态和时间，不保留对话正文或项目路径。

macOS 默认使用 osascript 和 afplay。已有 terminal-notifier 时优先使用，并尽力返回识别出的终端应用；只定位应用，**不保证具体窗口或会话**。系统专注模式和通知权限可能隐藏横幅，即使命令返回成功。未安装 terminal-notifier 时也可以使用声音和普通系统通知。

恢复的原始快照和全量备份可能包含配置里的凭据，因此文件权限为仅用户可读写。界面只显示新增配置片段，不显示原始配置内容。

首版为本地配置助手，未包含 SSH 自动部署、CLI 安装/认证、模型和 API Key 编辑、后台守护或签名原生安装包。

## 开发与验证

```sh
npm test
```

测试使用临时用户目录，覆盖 JSON Hook 合并、TOML 多行数组和注释保留、旧 notify 转发、无变更恢复、配置冲突、符号链接、通知数据最小化以及 HTTP 防跨站访问。

## 接口依据

- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Codex 配置参考](https://developers.openai.com/codex/config-reference)
- [OpenCode 插件](https://opencode.ai/docs/plugins/)
- [DeepSeek Harness](https://deepseek.com/harness/en/)

核对日期：2026-09-06。接入逻辑在 core.mjs，通知运行时在 notify.mjs，本机 API 在 server.mjs，界面在 public/。

连接后的公共设置支持双向同步：浏览器修改声音、音量或桌面通知会写入本机通知偏好，桌面界面每 5 秒刷新且保留未保存的编辑。首次连接保留双方设置，可主动同步本机偏好。离线期间两端独立工作，本机离线修改可在重连后手动同步；同时修改同一项时，以扩展确认的写入为准。两端音频实现不同，相同音量数值不保证相同响度。
