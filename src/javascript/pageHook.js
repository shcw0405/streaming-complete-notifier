// ChatGPT SSE 流解析器 - 注入到页面上下文
// 用于检测"思考完成"和"开始输出"事件
(function() {
  'use strict';

  // 防止重复注入
  if (window.__chatgptReasoningTapInjected) return;
  window.__chatgptReasoningTapInjected = true;

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
