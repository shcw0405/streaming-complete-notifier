# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

这是一个 Chrome Manifest V3 扩展，监测 Gemini、ChatGPT、Grok、AI Studio 的生成完成事件并触发桌面通知 + 提示音。

**无构建流程**：所有代码均为浏览器原生 JavaScript，扩展直接从 `src/javascript/` 加载。

## 加载与调试

- 加载扩展：在 `chrome://extensions` 开启开发者模式，"加载已解压的扩展程序"，选择 `src/javascript/` 目录。
- 修改 `background.js` / `manifest.json` 后必须在扩展页面点"刷新"重载 service worker。
- 修改 content script / page hook（`content.js`、`pageHook.js` 等）后需要重载扩展并刷新目标 AI 页面。
- 调试 service worker：扩展页面点击"检视视图：service worker"。
- 调试 offscreen 文档：扩展页面点击"检视视图：offscreen.html"。
- 发布打包：将 `src/javascript/` 目录整体压缩为 zip（保持目录结构）。

## 整体架构

扩展由四种执行上下文协同工作，理解它们之间的隔离关系是修改代码的关键。

### 1. Service Worker（`background.js`）

整个扩展的指挥中心。监听 `chrome.webRequest`、管理通知、协调其他上下文。**所有逻辑都由文件顶部的 `PLATFORMS` 数组配置驱动** —— 添加新 AI 平台只需在该数组追加配置对象，无需改动检测/通知/节流逻辑。

平台配置的关键字段：
- `match.pathPattern` 或 `match.urlPattern`：识别"生成请求"的正则。
- `detection.type`：`'request-complete'`（请求结束即视为完成）或 `'sse-stream'`（必须是 SSE 流且持续 >2s 才视为完成，避免预检请求误报）。
- `streamEvents`：可选，需要 content script 向后台转发的流内事件（如 ChatGPT 的"思考结束"）。
- `throttleMs`：同 tab 节流窗口，防止重复通知。

请求生命周期：`onBeforeRequest` 记录开始时间 → `onHeadersReceived` 判定是否 SSE → `onCompleted` 进行**耗时校验 + 节流 + 通知**。Map 存储的状态会通过 `debouncedSave` 持久化到 `chrome.storage.local`，service worker 被回收后能恢复（1 小时内有效）。

### 2. Content Script（`content.js`）

运行在隔离世界（isolated world），只做两件事：
- 根据 hostname 把对应的 page hook 脚本（`pageHook.js` / `geminiHook.js` / `grokHook.js`）以 `<script>` 标签注入到**页面上下文**。
- 通过 `window.addEventListener('message')` 接收 page hook 的 `postMessage`，转发为 `chrome.runtime.sendMessage` 给 background。

### 3. Page Hooks（`pageHook.js`、`geminiHook.js`、`grokHook.js`、`visibilitySpoof.js`）

这些脚本必须运行在**页面主世界**才能劫持 `window.fetch` 或读取页面状态。它们通过 `manifest.json` 的 `web_accessible_resources` 暴露，由 content script 注入。

**为什么 ChatGPT 必须在页面层劫持？** 见 `docs/chatgpt-architecture-research.md`。关键结论：ChatGPT 真正承载 AI 回答的 SSE 流对 `chrome.webRequest` 不可见（疑似走 WebSocket 或 ServiceWorker 内部 fetch），因此 `pageHook.js` 通过劫持 `window.fetch` + `response.body.tee()` 直接解析 `/backend-api/f/conversation` 的 SSE 数据，提取 `reasoning_end`、`first_token`、`[DONE]` 等事件。

Page hook 的另一个职责是**捕获用户提问文本**作为通知标题：ChatGPT/Gemini 监听 `input` 事件并尝试解析请求体，Grok 直接解析 fetch 请求体。

`visibilitySpoof.js` 是独立的可选脚本，按 `tabKeepAliveEnabled` 设置注入，重写 `document.hidden` / `visibilityState` 并吞掉 `visibilitychange` 事件，避免 ChatGPT 等页面在后台标签页暂停流式传输。

### 4. Offscreen Document（`offscreen.html` / `offscreen.js`）

MV3 service worker 没有 DOM 也无法播放音频，所以必须创建 offscreen 文档来播放 `audio/streaming-complete.mp3`。Background 通过 `chrome.runtime.sendMessage({ action: 'playSound', volume })` 委托播放，并带有重试逻辑（offscreen 文档可能被回收，需要 `ensureOffscreenDocument` 重建）。

音量范围 0–150%：100% 以下走 `volume²` 对数曲线，100–150% 用 `DynamicsCompressor` 防削波 + makeup gain。

## 跨上下文消息流（修改时务必牢记）

```
Page (window.fetch hook) ──postMessage──▶ content.js ──chrome.runtime.sendMessage──▶ background.js
                                                                                          │
                                                            chrome.runtime.sendMessage    ▼
                                                                                  offscreen.js
```

- `content.js` 只转发 `source` 为 `chatgpt-reasoning-tap` / `gemini-prompt-tap` / `grok-prompt-tap` 的消息，新加 hook 必须更新此白名单。
- `background.js` 的 `onMessage` 监听器**不处理** `playSound` —— 该消息由 offscreen 接收。如果在 background 里返回 `true`/响应该 action，会切断消息端口导致播放失败。

## 设置项（`chrome.storage.sync`）

`popup.js` 与 `background.js` / `content.js` 共享以下键：
- 平台开关：`geminiEnabled` / `chatgptEnabled` / `grokEnabled` / `aistudioEnabled`
- ChatGPT 子开关：`chatgptReasoningEndEnabled`（思考结束通知）
- 全局开关：`notificationEnabled` / `soundEnabled` / `tabKeepAliveEnabled`
- 音量：`soundVolume`（0–1.5）

新增设置项时必须同步更新 `popup.js` 的默认值、`popup.html` 的 UI 和 `background.js` 中读取该键的位置。

## 添加新 AI 平台的步骤

1. 在 `background.js` 顶部 `PLATFORMS` 数组追加配置对象（参考 Gemini 条目作为最简模板）。
2. 在 `manifest.json` 的 `host_permissions` 加入新域名。
3. 如果需要捕获用户提问或解析流内事件，新建 `xxxHook.js`，在 `web_accessible_resources` 中暴露，在 `content.js` 的 `inject()` 添加 hostname 分支并把消息 `source` 加入 `content.js` 白名单。
4. 在 `popup.html` / `popup.js` 添加对应开关，使用 `<platformId>Enabled` 命名约定。

## 代码风格约定

- 注释、用户可见字符串、提交信息均使用中文（与现有代码一致）。
- `background.js` 用注释分割成"第 N 部分"块，新增功能请遵循该结构。
- 状态使用顶层 `Map` 存储；任何长期存活的 Map 在更新后必须调用 `debouncedSave()`。
