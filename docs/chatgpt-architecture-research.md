# ChatGPT 前端网络架构研究报告

> 研究日期：2026-03-23
> 研究方法：通过 Chrome 扩展的 `chrome.webRequest` API 和页面注入 `fetch` 劫持进行全量网络流量分析
> 目的：找到 ChatGPT 完成 AI 回答生成的精确结束信号

---

## 一、核心发现概要

| 发现 | 详情 |
|------|------|
| **AI 回答流不走 `fetch()`** | ChatGPT 前端对 `window.fetch` 进行了内部封装，真正的 AI 回答流不通过标准 `fetch()` API 传输 |
| **`/backend-api/f/conversation` 是"幽灵流"** | 该请求虽然是 SSE (`text/event-stream`)，但仅持续 250-600ms，只包含元数据，不含 AI 回答文本 |
| **真正的 AI 回答流对 `webRequest` 不可见** | 即使使用 `chrome.webRequest`（`xmlhttprequest` 类型），也无法看到承载 AI 回答的网络流 |
| **`/backend-api/lat/r` 是最佳完成信号** | 该 POST 请求在 AI 回答结束后**立刻**发出（秒级延迟），是最快且可靠的完成检测依据 |
| **`implicit_message_feedback` 延迟过大** | 虽然精准，但实测延迟约 30 秒，不适合作为主信号 |

---

## 二、ChatGPT 发送消息后的完整网络请求时序

当用户在 ChatGPT 中发送消息后，以下是通过 `chrome.webRequest`（`types: ['xmlhttprequest']`）捕获的完整请求时序：

### 阶段 1：发送前准备（瞬间完成）

| 请求路径 | 方法 | 作用 |
|----------|------|------|
| `/backend-api/sentinel/chat-requirements/prepare` | POST | 安全令牌准备 |
| `/backend-api/sentinel/ping` | POST | 保活心跳 |
| `/backend-api/f/conversation/prepare` | POST | 对话预处理（新发现的准备阶段端点） |

### 阶段 2：SSE "幽灵流"（250-600ms 极速结束）

| 请求路径 | 方法 | Content-Type | 持续时间 | 作用 |
|----------|------|-------------|----------|------|
| `/backend-api/f/conversation` | POST | `text/event-stream` | 250-600ms | **仅含元数据，不含回答内容** |
| `/backend-api/sentinel/chat-requirements/finalize` | POST | — | 瞬间 | 安全令牌确认 |

#### 幽灵流的 SSE 内容分析

通过 `fetch` 劫持 + `response.body.tee()` 解析得到的事件：

```
event: delta_encoding    ← 第1条: 编码声明
data: {...}              ← 第2条: 元数据（contentType: undefined, marker: undefined）
data: {...}              ← 第3条: 元数据
data: [DONE]             ← 第4条: 立刻结束
```

**关键特征**：
- 整个流只有 3-4 条 SSE 事件
- `contentType` 全部为 `undefined`
- 没有 `user_visible_token` marker
- 没有 `parts` 文本数据
- 没有 `reasoning_status`
- 持续时间极短（< 1 秒）

### 阶段 3：AI 回答生成中（不可见）

在幽灵流结束后，到 AI 打字完毕之前，**`webRequest` 几乎看不到任何与对话相关的请求**。
只有以下周期性请求：

| 请求路径 | 方法 | 频率 | 作用 |
|----------|------|------|------|
| `/backend-api/sentinel/ping` | POST | 每 5-10 秒 | 安全保活心跳 |
| `/ces/v1/t` | POST | 高频 | 遥测 / 事件追踪上报 |
| `/ces/v1/m` | POST | 中频 | 指标上报 |
| `/ces/statsc/flush` | POST | 每 10-20 秒 | 统计数据刷新 |

**结论**：AI 回答的实际流式传输使用了 `webRequest` 无法监控的通道。
可能的机制包括：
- **WebSocket**（`/backend-api/celsius/ws/user` 曾出现过相关路径）
- **`EventSource` API**（会被 `webRequest` 归类为 `other` 类型而非 `xmlhttprequest`）
- **Service Worker 内部的 `fetch`**（绕过页面上下文的 `window.fetch` 劫持）
- **HTTP/2 Server Push**

### 阶段 4：AI 回答结束后的收尾信号（核心！）

AI 回答完毕后，以下请求会按顺序出现：

| 请求路径 | 方法 | 时机 | 可靠性 |
|----------|------|------|--------|
| `/backend-api/conversation/{id}/stream_status` | GET | 回答快结束时 | ⚠️ 中（可能提前出现） |

> ⚠️ **以下信号按速度排序**，越靠前越快：
| `/backend-api/conversation/{id}/textdocs` | GET | 回答刚结束 | ✅ 高 |
| **`/backend-api/lat/r`** | **POST** | **回答结束后立刻** | **✅✅ 最佳（秒级延迟，已验证）** |
| `/backend-api/aip/connectors/links/list_accessible` | POST | 回答结束后 | ⚠️ 中（可能不出现） |
| `/backend-api/conversation/implicit_message_feedback` | POST | 回答结束后 ~30秒 | ✅ 精准但延迟太大 |

### 阶段 5：页面后续（与回答无关）

| 请求路径 | 方法 | 作用 |
|----------|------|------|
| `/backend-api/conversations` | GET | 刷新左侧对话列表 |
| `/backend-api/pins` | GET | 刷新置顶对话 |
| `/realtime/status` | POST | 实时功能状态检查 |

---

## 三、为什么 `/backend-api/lat/r` 是最佳完成信号

### 3.1 信号特征

- **速度快**：AI 回答结束后秒级送达（对比 `implicit_message_feedback` 延迟约 30 秒）
- **精准性**：只在 AI 回答完毕后才发出
- **稳定性**：不受 AI 模型类型（GPT-4o, GPT-4o-mini, o1, o3 等）影响
- **路径固定**：始终为 `POST /backend-api/lat/r`
- **不误报**：发送消息时**不会**触发此请求

### 3.2 匹配规则

```javascript
match: {
  method: 'POST',
  pathPattern: '/backend-api/lat/r'
},
detection: {
  type: 'request-complete'  // 请求完成即视为 AI 结束
}
```

### 3.3 不适用 `duration` 过滤

此请求本身是一个瞬间完成的 POST（通常 < 500ms），所以**不能使用 `duration > 1500ms` 的过滤条件**。
但由于它本身就是精确的完成信号，不需要时长过滤。

### 3.4 为什么不用 `implicit_message_feedback`

`implicit_message_feedback` 虽然每次 AI 回答后只发一次、且非常精准，但实测延迟约 **30 秒**，用户体验差。`lat/r` 在功能和精准性上与其一致，但速度快得多。

---

## 四、曾经尝试过但失败的方案

### 4.1 ❌ 劫持 `window.fetch` 检测 SSE 流结束

**思路**：在页面上下文注入脚本，劫持 `window.fetch`，拦截 SSE 响应并用 `response.body.tee()` 解析。

**失败原因**：
- ChatGPT 前端对 `/backend-api/f/conversation` 的 SSE 响应仅持续 250-600ms
- 该响应只包含元数据（`delta_encoding` 等），不含 AI 回答文本
- 真正的 AI 回答流不走 `window.fetch`，完全无法被劫持
- 即使成功拦截到 `[DONE]` 标记，也是幽灵流的 `[DONE]`，不是真正的回答结束

### 4.2 ❌ 监听 SSE 流的 `onCompleted` 事件

**思路**：通过 `chrome.webRequest.onCompleted` 监听 SSE 流结束。

**失败原因**：
- `onCompleted` 确实能捕获 `/backend-api/f/conversation` 的完成
- 但该请求在 600ms 内就结束了（幽灵流），此时 AI 还没开始打字
- 真正的 AI 回答完成信号不在此请求中

### 4.3 ✅ 使用 `lat/r` 路径作为主信号（最终方案）

**思路**：ChatGPT 在回答结束后会发出 `/backend-api/lat/r` 请求，可直接作为完成信号。

**最终采用**：
- `lat/r` 在回答结束后**秒级**送达
- 将 ChatGPT 的 `match.pathPattern` 改为 `/backend-api/lat/r`
- `detection.type` 设为 `request-complete`（不是 SSE 流）
- 无需 followup 机制，直接在 `onCompleted` 中触发通知

### 4.4 ⚠️ 使用 `implicit_message_feedback`（可行但延迟大）

**思路**：`implicit_message_feedback` 仅在 AI 完全回答完毕后才发出。

**问题**：
- 实测延迟约 **30 秒**，用户体验差
- 作为信号本身是精准的，但速度不可接受

### 4.4 ❌ 在 `catch` 块中发出完成信号

**思路**：当 SSE 流被 ChatGPT 前端 `abort` 时，在 `catch` 块中调用 `emitFinished()` 发出结束通知。

**失败原因**：
- 用户发送新消息时，ChatGPT 会 abort 掉旧的 SSE 连接
- `catch` 块捕获到 `AbortError` 并错误地发出了"生成完成"信号
- 造成"发送即弹窗"的误报

---

## 五、Prompt 提取方案

### 5.1 方案一：`fetch` 请求体解析 + 即时发送（最终方案 ✅）

由于真实 AI 回答流对 `fetch` 不可见，`emitFinished()` 永远不会触发（`hasSeenContent` 始终为 `false`）。
因此必须在**拦截到 fetch 请求时立刻发送 prompt 数据**，而不是等流结束。

```javascript
// 在 pageHook.js 的 fetch 劫持中，拦截到 conversation API 后立刻发送：
if (promptExtracted) {
  emit('chatgpt_prompt_captured', { prompt: promptExtracted });
}
```

后台 `background.js` 收到后立刻存储：
```javascript
if (eventType === 'chatgpt_prompt_captured') {
  latestSnippetPerTab.set(tabId, { prompt: eventData.prompt, snippet: '' });
  return;
}
```

当 `lat/r` 触发通知时，从 `latestSnippetPerTab` 读取已存储的 prompt 作为通知标题。

**Prompt 解析代码**：

```javascript
// 解析 fetch 请求体
if (typeof args[1].body === 'string') {
  bodyContent = args[1].body;
} else if (args[1].body instanceof Uint8Array) {
  // ChatGPT 有时用二进制传输！
  bodyContent = new TextDecoder().decode(args[1].body);
}

const reqData = JSON.parse(bodyContent);
const userMsgs = reqData.messages.filter(m => m.author?.role === 'user');
const lastMsg = userMsgs[userMsgs.length - 1];
const prompt = lastMsg.content.parts.filter(p => typeof p === 'string').join(' ');
```

**注意事项**：
- 请求体可能是 `string` 也可能是 `Uint8Array`，需要兼容两种格式
- `messages` 数组中可能包含系统消息，需要用 `author.role === 'user'` 过滤
- `content.parts` 可能包含非字符串元素（如图片引用），需要 `typeof p === 'string'` 过滤

### 5.2 方案二：全局 `input` 事件监听（备选）

```javascript
let lastTypedPrompt = '';
document.addEventListener('input', (e) => {
  const target = e.target;
  // ChatGPT 使用 contenteditable div，不是 <input> 或 <textarea>
  if (target && target.tagName && target.tagName.toLowerCase() !== 'input') {
    const text = target.innerText || target.value || target.textContent;
    if (text && text.trim().length > 0) {
      lastTypedPrompt = text.trim();
    }
  }
}, true);
```

**注意事项**：
- ChatGPT 的输入框是 `<div contenteditable>`，不是标准的 `<input>` 或 `<textarea>`
- 需要使用 `innerText` 而非 `value` 获取内容
- 用户按发送后，React 会立刻清空 DOM，所以必须在发送前就保存

---

## 六、AI 回答摘要提取

通过 SSE 幽灵流虽然拿不到完整回答，但 `pageHook.js` 仍能从中提取以下信息：

| 数据 | SSE 字段路径 | 说明 |
|------|-------------|------|
| 思考状态 | `metadata.reasoning_status` | `is_reasoning` / `reasoning_ended` |
| 输出通道 | `data.channel` | `final` 表示最终输出 |
| 内容类型 | `data.content.content_type` | `text` 表示文本回答 |
| 文本片段 | `data.parts[]` | 累计拼接的回答文本（在幽灵流中为空） |
| 可见 token 标记 | `obj.marker === 'user_visible_token'` | 第一个用户可见 token |

> ⚠️ 在当前架构下，这些字段在幽灵流中**全部为空**。Snippet 提取功能暂时无法工作。
> 若未来 ChatGPT 恢复使用 `fetch` 传输回答流，这些提取逻辑将自动恢复生效。

---

## 七、其他重要的 ChatGPT 网络端点

以下端点在调试中被发现，可能在未来的功能扩展中有用：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/backend-api/f/conversation/prepare` | POST | 对话预处理 |
| `/backend-api/conversation/{id}/stream_status` | GET | 流状态查询 |
| `/backend-api/conversation/{id}/textdocs` | GET | 获取生成的文本文档 |
| `/backend-api/lat/r` | POST | 标题生成 / 延迟确认 |
| `/backend-api/conversation/implicit_message_feedback` | POST | **隐式反馈（最佳完成信号）** |
| `/backend-api/conversation/init` | POST | 对话初始化 |
| `/backend-api/celsius/ws/user` | GET | WebSocket 用户端点 |
| `/backend-api/files/process_upload_stream` | POST | 文件上传流处理 |
| `/backend-api/files/download/file_{id}` | GET | 文件下载 |
| `/backend-api/sentinel/ping` | POST | 安全保活心跳（每 5-10 秒） |
| `/backend-api/sentinel/chat-requirements/prepare` | POST | 安全令牌准备 |
| `/backend-api/sentinel/chat-requirements/finalize` | POST | 安全令牌确认 |
| `/ces/v1/t` | POST | 遥测事件追踪（高频） |
| `/ces/v1/m` | POST | 指标上报 |
| `/ces/v1/p` | POST | 性能上报 |
| `/ces/v1/i` | POST | 信息上报 |
| `/ces/statsc/flush` | POST | 统计数据刷新 |
| `/ces/v1/telemetry/intake` | POST | 遥测数据摄入 |

---

## 八、调试方法备忘

### 8.1 前端调试（pageHook.js）

```javascript
const DEBUG = true;
const log = (...args) => console.log('[ChatGPT-Tap]', ...args);
```

在 ChatGPT 页面按 F12 打开 DevTools → Console 查看日志。

### 8.2 后台调试（background.js Service Worker）

```javascript
// 在 onBeforeRequest 中加入：
try {
  const urlObj = new URL(details.url);
  if (urlObj.hostname.includes('chatgpt.com')) {
    console.log('[BG-DEBUG] onBeforeRequest:', details.method, urlObj.pathname, 'type:', details.type);
  }
} catch(e) {}
```

查看日志：`chrome://extensions` → 找到扩展 → 点击 **"Service Worker"** 链接 → Console。

### 8.3 SSE 流全量捕获

```javascript
// 在 fetch 劫持中，对所有 SSE 响应打日志：
if (isSSE) {
  console.log('🔍 发现 SSE 响应:', url, 'isConversationAPI:', isConversationAPI);
}
```

---

## 九、版本兼容性说明

> **重要**：此文档基于 2026 年 3 月的 ChatGPT 前端架构。
> ChatGPT 的前端架构更新频繁，以上发现可能随时失效。
> 如果 `implicit_message_feedback` 端点消失或行为改变，需要重新进行网络流量分析。
