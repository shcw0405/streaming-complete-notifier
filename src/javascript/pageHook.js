// ChatGPT SSE 流解析器 - 注入到页面上下文
// 用于检测"思考完成"和"开始输出"事件
(function() {
  'use strict';

  // 防止重复注入
  if (window.__chatgptReasoningTapInjected) {
    console.log('[ChatGPT-Tap][Boot] pageHook 已注入过，跳过');
    return;
  }
  window.__chatgptReasoningTapInjected = true;

  // 无条件 boot 日志：用于确认 pageHook 已被注入到页面主世界
  console.log('[ChatGPT-Tap][Boot] pageHook 注入成功 @', new Date().toISOString(), 'href=', location.href);

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log('[ChatGPT-Tap]', ...args);

  // 稳妥提取用户提问：全局监听输入框输入
  let lastTypedPrompt = '';
  document.addEventListener('input', (e) => {
    const target = e.target;
    if (target && target.tagName && target.tagName.toLowerCase() !== 'input') {
      // 兼容 contenteditable 和原生 textarea
      const text = target.innerText || target.value || target.textContent;
      if (text && text.trim().length > 0) {
        lastTypedPrompt = text.trim();
      }
    }
  }, true);

  // ===========================================
  // WebSocket 劫持 - 检测画图工具调用
  // ===========================================
  // ChatGPT 的真实 AI 流走 wss://chatgpt.com/.../celsius/ws/user-...?verify=...
  // page-level fetch 看不见，但 WebSocket 劫持可以读到所有消息。
  // 画图任务的关键 WebSocket 信号：
  //   开始（lat/r 后 9-12s 出现）：
  //     - "image_gen.text2im" 工具调用响应（最稳）
  //     - "aspect_ratio" + "prompt" 同时出现于 commentary channel（画图入参 JSON）
  //     - analysis channel 中提到 "image_gen"（最早，模型推理过程）
  //     - "image_asset_pointer" / "ghostrider" 字段
  //   完成：
  //     - "image_asset_pointer" + channel:"final"（图最终展示）
  //     - "ghostrider":{"status":"final"}（异步任务最终完成）
  //     - "conversation_async_status":4（异步状态码 4=完成）
  const wsTapState = {
    hasEmittedStart: false,    // 当前 turn 是否已 emit 画图开始信号
    hasEmittedFinished: false  // 当前 turn 是否已 emit 画图完成信号
  };

  function resetWsTapState() {
    wsTapState.hasEmittedStart = false;
    wsTapState.hasEmittedFinished = false;
    // 新一轮 turn 开始时清掉上一轮的 DOM observer，避免跨 turn 触发
    stopImageMutationObserver();
  }

  function shouldTapWsUrl(url) {
    if (typeof url !== 'string') {
      try { url = String(url); } catch { return false; }
    }
    // ChatGPT 的 celsius user WebSocket：携带 ?verify= 查询参数
    return url.includes('chatgpt.com') && (url.includes('?verify=') || url.includes('/celsius/'));
  }

  function detectWsImageGenStart(text) {
    // 强信号 1：画图工具响应（明确含 image_gen.text2im）
    if (text.includes('image_gen.text2im')) return 'tool_response';
    // 强信号 2：commentary channel 的画图入参 JSON（aspect_ratio + prompt 同时出现）
    if (text.includes('"aspect_ratio"') && text.includes('"prompt"') && text.includes('"channel":"commentary"')) {
      return 'tool_input';
    }
    // 强信号 3：图片资产指针出现（即使是 commentary intermediate 阶段）
    if (text.includes('"image_asset_pointer"')) return 'image_asset_pointer';
    // 强信号 4：异步任务标记 ghostrider
    if (text.includes('"ghostrider"')) return 'ghostrider';
    // 中信号：analysis channel 中模型决策提到 image_gen
    if (text.includes('"channel":"analysis"') && text.includes('image_gen')) return 'analysis_intent';
    return null;
  }

  function detectWsImageGenFinished(text) {
    // 强信号 1：异步任务最终完成
    if (text.includes('"ghostrider":{"status":"final"}')) return 'ghostrider_final';
    // 强信号 2：图片在 final channel 出现（最终展示给用户）
    if (text.includes('"image_asset_pointer"') && text.includes('"channel":"final"')) return 'image_final';
    // 强信号 3：异步状态码 4 = 任务完成
    if (text.includes('"conversation_async_status":4')) return 'async_status_4';
    return null;
  }

  // ===========================================
  // JSON 优先解析：把 WS 文本帧切成结构化对象数组
  // ===========================================
  // ChatGPT 在不同上下文下 WS 帧可能是：
  //   A. 整条就是一个 JSON 对象
  //   B. SSE 风格："data: {...}\n\ndata: {...}"
  //   C. 多个 JSON 对象拼在一起："{...}{...}"
  // 三种策略依次尝试，全部失败则返回空数组（让字符串兜底接管）
  function parseWsTextToObjects(text) {
    // 策略 A：整条 JSON
    try {
      const obj = JSON.parse(text);
      return [obj];
    } catch {}

    const objects = [];

    // 策略 B：SSE-style 行
    if (text.indexOf('data:') >= 0) {
      const lines = text.split('\n');
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try { objects.push(JSON.parse(payload)); } catch {}
      }
      if (objects.length > 0) return objects;
    }

    // 策略 C：大括号深度扫描，提取嵌套 JSON 子串
    let depth = 0, start = -1, inString = false, escape = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (inString) {
        if (c === '\\') { escape = true; }
        else if (c === '"') { inString = false; }
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch {}
          start = -1;
        } else if (depth < 0) {
          depth = 0;
        }
      }
    }
    return objects;
  }

  // 递归检测：画图开始（OpenAI Responses API 风格 + ChatGPT celsius 工具调用）
  function detectImageGenStartFromObj(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;

    // Responses API：response.output_item.added + image_generation_call
    if (obj.type === 'response.output_item.added' && obj.item?.type === 'image_generation_call') {
      return 'output_item_added';
    }
    // celsius 工具调用：recipient = "image_gen.text2im" 或 "image_gen"
    if (typeof obj.recipient === 'string' && obj.recipient.indexOf('image_gen') === 0) {
      return 'tool_call_image_gen';
    }
    // 兼容多种 tool 字段命名
    if (obj.tool === 'image_gen' || obj.tool_name === 'image_gen' || obj.name === 'image_gen.text2im') {
      return 'tool_call_image_gen';
    }

    // 递归到子结构
    if (Array.isArray(obj)) {
      for (const v of obj) {
        const nested = detectImageGenStartFromObj(v, depth + 1);
        if (nested) return nested;
      }
    } else {
      for (const k in obj) {
        const v = obj[k];
        if (v && typeof v === 'object') {
          const nested = detectImageGenStartFromObj(v, depth + 1);
          if (nested) return nested;
        }
      }
    }
    return null;
  }

  // 递归检测：画图完成（强 → 弱）
  function detectImageGenFinishedFromObj(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;

    // 强信号：response.output_item.done + image_generation_call + result 存在
    if (obj.type === 'response.output_item.done'
        && obj.item?.type === 'image_generation_call'
        && obj.item?.result != null) {
      return 'output_item_done';
    }
    // 二级信号：response.completed + tool_usage.image_gen.images > 0
    if (obj.type === 'response.completed') {
      const imgs = obj.response?.tool_usage?.image_gen?.images;
      if (typeof imgs === 'number' && imgs > 0) return 'response_completed_with_images';
      if (Array.isArray(imgs) && imgs.length > 0) return 'response_completed_with_images';
    }

    // 递归到子结构
    if (Array.isArray(obj)) {
      for (const v of obj) {
        const nested = detectImageGenFinishedFromObj(v, depth + 1);
        if (nested) return nested;
      }
    } else {
      for (const k in obj) {
        const v = obj[k];
        if (v && typeof v === 'object') {
          const nested = detectImageGenFinishedFromObj(v, depth + 1);
          if (nested) return nested;
        }
      }
    }
    return null;
  }

  // 递归检测：画图失败/中断
  function detectImageGenFailedFromObj(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;

    if (obj.type === 'response.failed') return 'response_failed';
    if (obj.type === 'response.incomplete') return 'response_incomplete';
    if (obj.type === 'response.cancelled' || obj.type === 'response.canceled') return 'response_cancelled';

    // 递归到子结构
    if (Array.isArray(obj)) {
      for (const v of obj) {
        const nested = detectImageGenFailedFromObj(v, depth + 1);
        if (nested) return nested;
      }
    } else {
      for (const k in obj) {
        const v = obj[k];
        if (v && typeof v === 'object') {
          const nested = detectImageGenFailedFromObj(v, depth + 1);
          if (nested) return nested;
        }
      }
    }
    return null;
  }

  // ===========================================
  // DOM MutationObserver 兜底：等 <img> onload 触发完成
  // ===========================================
  // 仅在 chatgpt_image_gen_started 后启动。如果 WS 完成信号丢失（压缩/分片/二进制等），
  // 由这里捕获新增的图片资产 <img>，等 onload 后发出完成事件。
  // 6 分钟自动停（比 background 5 分钟兜底超时多 1 分钟，避免空跑）。
  const imgObserverState = {
    observer: null,
    startTime: 0,
    timeoutId: null
  };
  const IMG_OBSERVER_TIMEOUT_MS = 6 * 60 * 1000;

  function isLikelyChatgptImage(img) {
    if (!img) return false;
    const src = img.src || img.currentSrc || (typeof img.getAttribute === 'function' ? img.getAttribute('src') : '') || '';
    if (!src) return false;
    // ChatGPT 图片资产 URL 模式：oaiusercontent / sandbox / 后端文件下载 / openai CDN
    return /oaiusercontent\.com|sandbox:|\/backend-api\/files\/|cdn\.openai\.com|files\.oaiusercontent/i.test(src);
  }

  function handleObservedImageReady(reason) {
    if (wsTapState.hasEmittedFinished) {
      stopImageMutationObserver();
      return;
    }
    wsTapState.hasEmittedFinished = true;
    console.log('[ChatGPT-Tap][DOM] 画图完成信号 (img onload):', reason);
    emit('chatgpt_image_gen_finished', { source: 'dom', signal: reason });
    stopImageMutationObserver();
  }

  function startImageMutationObserver() {
    if (imgObserverState.observer) return;
    if (typeof MutationObserver !== 'function' || !document.body) return;

    imgObserverState.startTime = Date.now();

    const observer = new MutationObserver((mutations) => {
      if (wsTapState.hasEmittedFinished) {
        stopImageMutationObserver();
        return;
      }
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!node || node.nodeType !== 1) continue;  // ELEMENT_NODE
          const imgs = node.tagName === 'IMG'
            ? [node]
            : (typeof node.querySelectorAll === 'function' ? Array.from(node.querySelectorAll('img')) : []);
          for (const img of imgs) {
            if (!isLikelyChatgptImage(img)) continue;
            if (img.complete && img.naturalWidth > 0) {
              handleObservedImageReady('already_loaded');
              return;
            }
            img.addEventListener('load', () => handleObservedImageReady('img_load'), { once: true });
          }
        }
      }
    });

    try {
      observer.observe(document.body, { childList: true, subtree: true });
      imgObserverState.observer = observer;
      imgObserverState.timeoutId = setTimeout(() => {
        console.log('[ChatGPT-Tap][DOM] MutationObserver 超时自动停');
        stopImageMutationObserver();
      }, IMG_OBSERVER_TIMEOUT_MS);
      console.log('[ChatGPT-Tap][DOM] MutationObserver 启动');
    } catch (e) {
      console.warn('[ChatGPT-Tap][DOM] observer 启动失败:', e);
    }
  }

  function stopImageMutationObserver() {
    if (imgObserverState.observer) {
      try { imgObserverState.observer.disconnect(); } catch {}
      imgObserverState.observer = null;
    }
    if (imgObserverState.timeoutId) {
      clearTimeout(imgObserverState.timeoutId);
      imgObserverState.timeoutId = null;
    }
    imgObserverState.startTime = 0;
  }

  // ===========================================
  // WS 消息分级处理：失败优先 → 开始 → 完成
  // 每一级都先 JSON 结构化扫描，未命中再回退到字符串兜底（兼容 celsius 旧格式）
  // ===========================================
  function handleWsMessage(data) {
    let text;
    if (typeof data === 'string') {
      text = data;
    } else {
      // 二进制消息暂不解析（ChatGPT 的 celsius 消息基本是文本 JSON）
      return;
    }
    if (!text) return;

    // JSON 优先解析（解析失败返回空数组，纯字符串路径仍可工作）
    const objects = parseWsTextToObjects(text);

    // ===== 1. 失败信号最高优先级（避免被开始/完成挡住） =====
    if (wsTapState.hasEmittedStart && !wsTapState.hasEmittedFinished) {
      let failedSignal = null;
      for (const obj of objects) {
        failedSignal = detectImageGenFailedFromObj(obj);
        if (failedSignal) break;
      }
      if (failedSignal) {
        wsTapState.hasEmittedFinished = true;
        console.log('[ChatGPT-Tap][WS] 画图失败信号:', failedSignal);
        emit('chatgpt_image_gen_failed', { source: 'ws', signal: failedSignal });
        stopImageMutationObserver();
        return;
      }
    }

    // ===== 2. 检测画图开始 =====
    if (!wsTapState.hasEmittedStart) {
      let startSignal = null;
      for (const obj of objects) {
        startSignal = detectImageGenStartFromObj(obj);
        if (startSignal) break;
      }
      // 字符串兜底（兼容现有 ghostrider / aspect_ratio 等 celsius 信号）
      if (!startSignal) startSignal = detectWsImageGenStart(text);

      if (startSignal) {
        wsTapState.hasEmittedStart = true;
        console.log('[ChatGPT-Tap][WS] 画图开始信号:', startSignal);
        emit('chatgpt_image_gen_started', { source: 'ws', signal: startSignal });
        // 启动 DOM 兜底观察器
        startImageMutationObserver();
      }
    }

    // ===== 3. 检测画图完成（必须先有"开始"才会发"完成"，避免误报） =====
    if (wsTapState.hasEmittedStart && !wsTapState.hasEmittedFinished) {
      let finishSignal = null;
      for (const obj of objects) {
        finishSignal = detectImageGenFinishedFromObj(obj);
        if (finishSignal) break;
      }
      // 字符串兜底
      if (!finishSignal) finishSignal = detectWsImageGenFinished(text);

      if (finishSignal) {
        wsTapState.hasEmittedFinished = true;
        console.log('[ChatGPT-Tap][WS] 画图完成信号:', finishSignal);
        emit('chatgpt_image_gen_finished', { source: 'ws', signal: finishSignal });
        stopImageMutationObserver();
      }
    }
  }

  const OriginalWebSocket = window.WebSocket;
  if (OriginalWebSocket) {
    window.WebSocket = new Proxy(OriginalWebSocket, {
      construct(target, args) {
        const url = args[0];
        const ws = new target(...args);

        if (!shouldTapWsUrl(url)) return ws;

        console.log('[ChatGPT-Tap][WS] Connection opened:', String(url).slice(0, 120));

        // 拦截 addEventListener('message', ...)
        const origAddEventListener = ws.addEventListener.bind(ws);
        ws.addEventListener = function(type, listener, ...rest) {
          if (type === 'message' && typeof listener === 'function') {
            const wrapped = function(event) {
              try { handleWsMessage(event.data); } catch (e) { console.warn('[ChatGPT-Tap][WS] tap error:', e); }
              return listener.call(this, event);
            };
            return origAddEventListener.call(ws, type, wrapped, ...rest);
          }
          return origAddEventListener.call(ws, type, listener, ...rest);
        };

        // 拦截 ws.onmessage 的 setter（与 addEventListener 是两条独立通路，必须都覆盖）
        let userOnMessage = null;
        const protoDesc = Object.getOwnPropertyDescriptor(OriginalWebSocket.prototype, 'onmessage');
        Object.defineProperty(ws, 'onmessage', {
          get() { return userOnMessage; },
          set(handler) {
            userOnMessage = handler;
            const wrapped = function(event) {
              try { handleWsMessage(event.data); } catch {}
              if (userOnMessage) return userOnMessage.call(this, event);
            };
            if (protoDesc && protoDesc.set) {
              protoDesc.set.call(ws, handler ? wrapped : null);
            }
          },
          configurable: true
        });

        return ws;
      }
    });
  }

  // 事件发送函数
  function emit(type, data = {}) {
    window.postMessage({
      source: 'chatgpt-reasoning-tap',
      type,
      data,
      timestamp: Date.now()
    }, '*');
    log('Emitted:', type, data);
  }

  // SSE 流解析器
  class SSEParser {
    constructor(onEvent, startTime) {
      this.buffer = '';
      this.onEvent = onEvent;
      this.decoder = new TextDecoder();
      this.promptText = '';
      this.startTime = startTime;
      this.state = {
        isReasoning: false,
        reasoningStartTime: null,
        hasEmittedReasoningEnd: false,
        outputSnippet: '',
        hasEmittedFinished: false,
        hasSeenContent: false  // 只有看到了真实的 AI 回答内容才允许发出完成信号
      };
    }

    emitFinished() {
      // 只有当流中实际出现了用户可见的回答内容时，才视为真正的生成完成
      // 搜索/工具初始化等不含回答的 SSE 流会被静默过滤
      if (!this.state.hasEmittedFinished && this.state.hasSeenContent) {
        this.state.hasEmittedFinished = true;
        this.onEvent('chatgpt_generation_finished', {
          prompt: this.promptText,
          snippet: this.state.outputSnippet,
          durationMs: Date.now() - this.startTime
        });
      }
    }

    feed(chunk) {
      this.buffer += this.decoder.decode(chunk, { stream: true });
      this.processBuffer();
    }

    processBuffer() {
      // 支持 LF 和 CRLF 两种换行格式
      // 先统一将 \r\n 替换为 \n
      this.buffer = this.buffer.replace(/\r\n/g, '\n');

      let idx;
      while ((idx = this.buffer.indexOf('\n\n')) >= 0) {
        const message = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        this.parseMessage(message);
      }
    }

    parseMessage(message) {
      // 跳过 ping 消息
      if (message.startsWith(': ping')) return;

      // 处理 event: 行
      let eventType = null;
      const lines = message.split('\n');
      let dataLine = '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLine = line.slice(5).trim();
        }
      }

      if (!dataLine) return;
      if (dataLine === '[DONE]') {
        this.emitFinished();
        return;
      }

      try {
        const obj = JSON.parse(dataLine);
        this.handleParsedData(obj, eventType);
      } catch (e) {
        // 可能是多行 data，尝试合并
        const fullData = lines
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim())
          .join('');
        if (fullData && fullData !== '[DONE]') {
          try {
            const obj = JSON.parse(fullData);
            this.handleParsedData(obj, eventType);
          } catch (e2) {
            log('Parse error:', e2.message);
          }
        }
      }
    }

    handleParsedData(obj, eventType) {
      // 处理嵌套结构 - ChatGPT 的 delta 事件
      const data = obj.v?.message || obj.message || obj;
      const metadata = data.metadata || {};
      const contentType = data.content?.content_type;
      const reasoningStatus = metadata.reasoning_status;

      log('Parsed:', { contentType, reasoningStatus, eventType, marker: obj.marker });

      // 检测思考开始
      if (reasoningStatus === 'is_reasoning' && !this.state.isReasoning) {
        this.state.isReasoning = true;
        this.state.reasoningStartTime = Date.now();
        this.state.hasEmittedReasoningEnd = false;
        emit('reasoning_start', {
          messageId: data.id,
          model: metadata.model_slug
        });
      }

      // 检测思考结束
      if (reasoningStatus === 'reasoning_ended' && !this.state.hasEmittedReasoningEnd) {
        this.state.hasEmittedReasoningEnd = true;
        const duration = this.state.reasoningStartTime
          ? Math.round((Date.now() - this.state.reasoningStartTime) / 1000)
          : metadata.finished_duration_sec || 0;
        emit('reasoning_end', {
          messageId: data.id,
          durationSec: duration,
          model: metadata.model_slug
        });
      }

      // 检测开始输出（第一个用户可见 token）
      if (obj.marker === 'user_visible_token' && obj.event === 'first') {
        this.state.hasSeenContent = true;  // 标记这个流含有真实回答
        emit('first_token', {
          messageId: obj.message_id,
          conversationId: obj.conversation_id
        });
        // 重置状态，准备下一轮
        this.state.isReasoning = false;
        this.state.reasoningStartTime = null;
      }

      // 检测 cot_token（思考 token 开始）
      if (obj.marker === 'cot_token' && obj.event === 'first') {
        emit('cot_token_start', {
          messageId: obj.message_id
        });
      }

      // 检测最终通道开始输出
      if (data.channel === 'final' && contentType === 'text') {
        if (data.status === 'in_progress') {
          emit('final_output_start', { messageId: data.id });
        }
        
        if (data.parts && Array.isArray(data.parts) && data.parts.length > 0) {
          // ChatGPT 的 parts 通常是累计拼接好的完整字符串
          const currentText = data.parts.join('');
          if (currentText.length > 0) {
            this.state.hasSeenContent = true;  // 标记这个流含有真实回答
            // 截取前 50 个字符作为摘要
            this.state.outputSnippet = currentText.substring(0, 50).replace(/\n/g, ' ') + (currentText.length > 50 ? '...' : '');
          }
        }
      }
    }

    finish() {
      // 处理剩余缓冲区
      if (this.buffer.trim()) {
        this.parseMessage(this.buffer);
      }
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    // 尝试极其稳妥地提取 Prompt
    let promptExtracted = lastTypedPrompt;
    if (promptExtracted.length > 35) promptExtracted = promptExtracted.substring(0, 35) + '...';

    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const isConversationAPI = url && (url.includes('/backend-api/f/conversation') || url.includes('/backend-api/conversation'));

    // 如果网络包也能拆解成功，进一步确信
    if (isConversationAPI && args[1] && args[1].body) {
      try {
        let bodyContent = null;
        if (typeof args[1].body === 'string') {
          bodyContent = args[1].body;
        } else if (args[1].body instanceof Uint8Array) {
          bodyContent = new TextDecoder().decode(args[1].body);
        }

        if (bodyContent) {
          const reqData = JSON.parse(bodyContent);
          if (reqData.messages && Array.isArray(reqData.messages)) {
            const userMsgs = reqData.messages.filter(m => m.author?.role === 'user');
            const lastMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : reqData.messages[reqData.messages.length - 1];
            if (lastMsg && lastMsg.content && Array.isArray(lastMsg.content.parts)) {
              const textParts = lastMsg.content.parts.filter(p => typeof p === 'string').join(' ');
              if (textParts.length > 0) {
                promptExtracted = textParts;
                if (promptExtracted.length > 35) promptExtracted = promptExtracted.substring(0, 35) + '...';
              }
            }
          }
        }
      } catch (e) {
        log('Extract prompt error:', e);
      }
    }

    const response = await originalFetch.apply(this, args);

    if (!url) return response;

    const contentType = response.headers.get('content-type') || '';
    const isSSE = contentType.includes('text/event-stream');

    // 调试：记录 SSE 响应
    if (isSSE) {
      log('发现 SSE 响应:', url);
    }

    if (!isConversationAPI || !isSSE || !response.body) {
      return response;
    }

    log('Intercepted SSE stream:', url);

    // 通知 background 新一轮 turn 开始（清理上一轮残留的 expecting-image 状态）
    emit('chatgpt_turn_started', {});
    // 同步重置 WebSocket 劫持的 turn 状态，让本轮能重新检测画图信号
    resetWsTapState();

    // 立刻发送 prompt 数据到后台（不等流结束，因为真实回答流对 fetch 不可见）
    if (promptExtracted) {
      emit('chatgpt_prompt_captured', { prompt: promptExtracted });
    }

    try {
      // 克隆流：一份给原始消费者，一份用于解析
      const [originalStream, tapStream] = response.body.tee();

      // 异步解析 tap 流
      const streamStartTime = Date.now();
      const parser = new SSEParser((type, data) => emit(type, data), streamStartTime);
      parser.promptText = promptExtracted;

      (async () => {
        try {
          const reader = tapStream.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              parser.finish();
              // [DONE] 标记已在 parseMessage 中触发了 emitFinished
              // 这里做兜底：如果流正常结束但没收到 [DONE]（极罕见），也发出完成信号
              parser.emitFinished();
              break;
            }
            parser.feed(value);
          }
        } catch (e) {
          log('Stream read error:', e);
          // ⚠️ 关键修复：AbortError 不代表生成完成！
          // 当用户发送新消息时，ChatGPT 前端会 abort 掉旧的 SSE 连接
          // 此时绝对不能发出 emitFinished，否则会造成发送即误报
          // 真正的完成信号只来自 SSE 数据中的 [DONE] 标记
        }
      })();

      // 创建新的 Response，保留原始元数据
      const newResponse = new Response(originalStream, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      });

      // 尝试保留 url 和 redirected 属性（某些浏览器可能不支持）
      try {
        Object.defineProperties(newResponse, {
          url: { value: response.url, writable: false },
          redirected: { value: response.redirected, writable: false },
          type: { value: response.type, writable: false }
        });
      } catch (e) {
        // 忽略属性设置失败
      }

      return newResponse;
    } catch (e) {
      log('Tee error:', e);
      return response;
    }
  };

  log('ChatGPT reasoning tap installed');
})();
