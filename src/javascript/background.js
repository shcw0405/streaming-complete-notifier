// AI 回答完成提醒器 - 可扩展架构版
// ============================================================
// 添加新平台只需在 PLATFORMS 数组中添加配置对象即可
// ============================================================

// ===========================================
// 第一部分：平台配置（添加新平台请修改这里）
// ===========================================

/**
 * 平台配置说明：
 * - id: 平台唯一标识符（用于内部状态管理）
 * - name: 平台显示名称（用于通知标题）
 * - enabledKey: chrome.storage.sync 中的开关键名
 * - hosts: 需要监听的域名数组（支持通配符如 '*.example.com'）
 * - match: 请求匹配规则
 *   - method: HTTP 方法（'POST', 'GET' 等）
 *   - pathPattern: 路径匹配正则表达式，或字符串（精确匹配）
 *   - urlPattern: 完整 URL 匹配正则（用于跨域请求如 AI Studio）
 * - detection: 检测类型配置
 *   - type: 'request-complete' | 'sse-stream'
 *     - request-complete: 请求完成即通知（适用于普通 API）
 *     - sse-stream: SSE 流结束才通知（适用于流式传输）
 *   - trackStart: 是否记录开始时间（用于 followup 检测）
 * - streamEvents: SSE 流内事件配置（可选，需要 content script 支持）
 *   - reasoningEnd: 思考完成事件配置
 *     - enabledKey: 启用开关键名
 *     - notify: 通知配置
 * - followup: 备用完成信号配置（可选，用于长任务）
 *   - pathPattern: 备用信号的路径匹配
 *   - minDelayMs: 最小延迟时间（避免误报）
 * - notify: 通知配置
 *   - title: 通知标题
 *   - message: 通知内容
 *   - targetUrl: 点击通知后打开的 URL
 * - throttleMs: 节流时间（毫秒），同一标签页在此时间内不重复通知
 */

const PLATFORMS = [
  {
    id: 'gemini',
    name: 'Gemini',
    enabledKey: 'geminiEnabled',
    hosts: ['gemini.google.com'],
    match: {
      method: 'POST',
      pathPattern: /\/((?:Stream)?Generate(?:Content|Answer)?(?:V2)?|v\d+(?:beta)?\/.*:(?:generateContent|streamGenerateContent))/i
    },
    detection: { type: 'request-complete' },
    notify: {
      title: 'Gemini 生成完成',
      message: '当前页面的回答已生成完成。',
      targetUrl: 'https://gemini.google.com/app'
    },
    throttleMs: 2000
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    enabledKey: 'chatgptEnabled',
    hosts: ['chatgpt.com'],
    match: {
      method: 'POST',
      pathPattern: '/backend-api/lat/r'
    },
    detection: {
      type: 'request-complete'
    },
    // SSE 流内事件检测（需要 content script 支持）
    streamEvents: {
      reasoningEnd: {
        enabledKey: 'chatgptReasoningEndEnabled',
        notify: {
          title: 'ChatGPT 思考完成',
          message: '思考阶段已结束，正在生成回答...',
          targetUrl: 'https://chatgpt.com/'
        },
        throttleMs: 2000
      }
    },
    notify: {
      title: 'ChatGPT 生成完成',
      message: '检测到 ChatGPT 的生成流已结束。',
      targetUrl: 'https://chatgpt.com/'
    },
    throttleMs: 4000
  },
  {
    id: 'grok',
    name: 'Grok',
    enabledKey: 'grokEnabled',
    hosts: ['grok.com'],
    match: {
      method: 'POST',
      pathPattern: /^\/rest\/app-chat\/conversations\/[^/]+\/responses$/
    },
    detection: { type: 'request-complete' },
    notify: {
      title: 'Grok 生成完成',
      message: '当前页面的回答已生成完成。',
      targetUrl: 'https://grok.com/'
    },
    throttleMs: 2000
  },
  {
    id: 'aistudio',
    name: 'AI Studio',
    enabledKey: 'aistudioEnabled',
    hosts: ['aistudio.google.com', '*.clients6.google.com'],
    match: {
      method: 'POST',
      urlPattern: /^https:\/\/[\w.-]*clients6\.google\.com\/\$rpc\/google\.internal\.alkali\.applications\.makersuite\.v1\.MakerSuiteService\/(CreatePrompt|UpdatePrompt)$/
    },
    detection: { type: 'request-complete' },
    notify: {
      title: 'AI Studio 生成完成',
      message: 'AI Studio 的回答已生成完成。',
      targetUrl: 'https://aistudio.google.com/'
    },
    throttleMs: 2000
  }
];

// ===========================================
// 第二部分：常量与状态管理
// ===========================================

const DEFAULT_VOLUME = 1;
const MAX_VOLUME = 1.5;
const LONG_RUNNING_TIMEOUT_MS = 45 * 60 * 1000; // 45 分钟
const STATE_EXPIRY_MS = 60 * 60 * 1000; // 1 小时
const STATE_SAVE_INTERVAL_MS = 30000; // 30 秒

// ChatGPT 静默检测：lat/r 完成后等待这段时间。
// 设计动机：画图任务的"开始信号"在 lat/r 后 9-12 秒才出现于 WebSocket（pageHook 劫持后转发为
// chatgpt_image_gen_started 事件）。15 秒防抖能稳定捕获该信号，避免画图被误判为纯文字。
// 期间任何新 lat/r / file_download 都重置计时器；收到 image_gen_started 则取消防抖进入画图等待模式。
const CHATGPT_DEBOUNCE_MS = 15000;
const CHATGPT_MAX_WAIT_MS = 90000; // 90s 兜底，防止永远等下去
// 画图等待兜底：pageHook 报告"画图开始"后，最多等这么久就强制触发通知（应对画图失败/超时）
const CHATGPT_IMAGE_WAIT_MS = 5 * 60 * 1000;
// /backend-api/files/download/file_xxx 是 ChatGPT 文生图后下载图片的端点（响应是 JSON，含签名 URL）
const CHATGPT_FILE_DOWNLOAD_PATTERN = /^\/backend-api\/files\/download\/file_/;

// 统一状态存储
const requestState = new Map();      // requestId -> { platformId, tabId, isStream, startTime }
const lastNotifyAt = new Map();      // `${platformId}:${tabId}` -> timestamp
const lastStartAt = new Map();       // `${platformId}:${tabId}` -> timestamp
const longRunningTimeouts = new Map(); // `${platformId}:${tabId}` -> { requestId, timeoutId, startTime }
const latestRequestPerTab = new Map(); // `${platformId}:${tabId}` -> requestId
const chatgptPendingNotify = new Map(); // tabId -> { timeoutId, hasImage, startTime }
const chatgptExpectingImage = new Map(); // tabId -> { timeoutId, startTime }；pageHook 报告"画图中"，lat/r 期间跳过通知
const latestSnippetPerTab = new Map(); // tabId -> { prompt, snippet }

// 通知状态
const activeNotifications = new Map();
const testNotifications = new Map();

// ===========================================
// 第三部分：工具函数
// ===========================================

function stateKey(platformId, tabId) {
  return `${platformId}:${tabId ?? 'unknown'}`;
}

function clampVolume(value) {
  const numeric = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(numeric)) return DEFAULT_VOLUME;
  return Math.min(Math.max(numeric, 0), MAX_VOLUME);
}

function buildUrlFilters() {
  const urlSet = new Set();
  for (const platform of PLATFORMS) {
    for (const host of platform.hosts) {
      if (host.startsWith('*.')) {
        urlSet.add(`https://${host}/*`);
      } else {
        urlSet.add(`https://*.${host}/*`);
        urlSet.add(`https://${host}/*`);
      }
    }
  }
  return Array.from(urlSet);
}

function matchPath(pathname, pattern) {
  if (typeof pattern === 'string') {
    return pathname === pattern;
  }
  if (pattern instanceof RegExp) {
    return pattern.test(pathname);
  }
  return false;
}

function findPlatformForRequest(details, detectionTypeFilter = null) {
  let url;
  try {
    url = new URL(details.url);
  } catch {
    return null;
  }

  for (const platform of PLATFORMS) {
    // 检测类型过滤
    if (detectionTypeFilter && platform.detection.type !== detectionTypeFilter) {
      continue;
    }

    // 检查方法
    if (platform.match.method && details.method !== platform.match.method) {
      continue;
    }

    // 检查 URL 模式（用于跨域请求）
    if (platform.match.urlPattern) {
      if (platform.match.urlPattern.test(details.url)) {
        return platform;
      }
      continue;
    }

    // 检查域名
    const hostMatch = platform.hosts.some(host => {
      if (host.startsWith('*.')) {
        return url.hostname.endsWith(host.slice(1)) || url.hostname === host.slice(2);
      }
      return url.hostname === host;
    });
    if (!hostMatch) continue;

    // 检查路径
    if (platform.match.pathPattern) {
      if (matchPath(url.pathname, platform.match.pathPattern)) {
        return platform;
      }
    }
  }

  return null;
}

function findPlatformForFollowup(details) {
  let url;
  try {
    url = new URL(details.url);
  } catch {
    return null;
  }

  for (const platform of PLATFORMS) {
    if (!platform.followup) continue;

    // 检查域名
    const hostMatch = platform.hosts.some(host => {
      if (host.startsWith('*.')) {
        return url.hostname.endsWith(host.slice(1)) || url.hostname === host.slice(2);
      }
      return url.hostname === host;
    });
    if (!hostMatch) continue;

    // 检查 followup 路径
    if (matchPath(url.pathname, platform.followup.pathPattern)) {
      return platform;
    }
  }

  return null;
}

// ===========================================
// 第四部分：节流与状态清理
// ===========================================

function isThrottled(platformId, tabId, ms) {
  const key = stateKey(platformId, tabId);
  const now = Date.now();
  const last = lastNotifyAt.get(key) || 0;
  if (now - last < ms) return true;
  lastNotifyAt.set(key, now);
  return false;
}

function cleanupRequest(requestId, tabId, platformId = null) {
  const req = requestState.get(requestId);
  if (req) {
    platformId = platformId || req.platformId;
    requestState.delete(requestId);
  }

  if (platformId && tabId !== undefined) {
    const key = stateKey(platformId, tabId);
    const longReq = longRunningTimeouts.get(key);
    if (longReq && longReq.requestId === requestId) {
      clearTimeout(longReq.timeoutId);
      longRunningTimeouts.delete(key);
    }
  }

  debouncedSave();
}

function cleanupTab(platformId, tabId) {
  const key = stateKey(platformId, tabId);

  // 清理该 tab 相关的所有请求
  for (const [requestId, req] of requestState.entries()) {
    if (req.platformId === platformId && req.tabId === tabId) {
      requestState.delete(requestId);
    }
  }

  // 清理长时间运行记录
  const longReq = longRunningTimeouts.get(key);
  if (longReq) {
    clearTimeout(longReq.timeoutId);
    longRunningTimeouts.delete(key);
  }

  // 清理开始时间记录
  lastStartAt.delete(key);

  debouncedSave();
}

function setupLongRunningTimeout(requestId, tabId, platformId) {
  const key = stateKey(platformId, tabId);

  const timeoutId = setTimeout(() => {
    requestState.delete(requestId);
    longRunningTimeouts.delete(key);
    debouncedSave();
  }, LONG_RUNNING_TIMEOUT_MS);

  longRunningTimeouts.set(key, {
    requestId,
    timeoutId,
    startTime: Date.now()
  });

  debouncedSave();
}

// ===========================================
// 第五部分：状态持久化（带防抖）
// ===========================================

let saveTimeoutId = null;

function debouncedSave() {
  if (saveTimeoutId) return;
  saveTimeoutId = setTimeout(() => {
    saveTimeoutId = null;
    savePersistentState();
  }, 1000);
}

async function savePersistentState() {
  try {
    const state = {
      requestState: Array.from(requestState.entries()),
      longRunningTimeouts: Array.from(longRunningTimeouts.entries()).map(([key, data]) => [
        key,
        { requestId: data.requestId, startTime: data.startTime }
      ]),
      lastStartAt: Array.from(lastStartAt.entries()),
      lastNotifyAt: Array.from(lastNotifyAt.entries()),
      timestamp: Date.now()
    };
    await chrome.storage.local.set({ notifierState: state });
  } catch (e) {
    console.error('保存状态失败:', e);
  }
}

async function loadPersistentState() {
  try {
    const result = await chrome.storage.local.get(['notifierState']);
    if (!result.notifierState) return;

    const state = result.notifierState;
    const now = Date.now();

    // 只恢复最近 1 小时内的状态
    if (now - state.timestamp >= STATE_EXPIRY_MS) return;

    // 恢复请求状态
    state.requestState?.forEach(([key, value]) => requestState.set(key, value));

    // 恢复长时间运行记录（重建超时）
    state.longRunningTimeouts?.forEach(([key, value]) => {
      if (value.startTime && now - value.startTime < LONG_RUNNING_TIMEOUT_MS) {
        const remaining = LONG_RUNNING_TIMEOUT_MS - (now - value.startTime);
        const timeoutId = setTimeout(() => {
          requestState.delete(value.requestId);
          longRunningTimeouts.delete(key);
          debouncedSave();
        }, remaining);
        longRunningTimeouts.set(key, { ...value, timeoutId });
      }
    });

    // 恢复开始时间（过滤过期的）
    state.lastStartAt?.forEach(([key, value]) => {
      if (now - value < STATE_EXPIRY_MS) {
        lastStartAt.set(key, value);
      }
    });

    // 恢复通知时间
    state.lastNotifyAt?.forEach(([key, value]) => lastNotifyAt.set(key, value));

    console.log('已恢复持久化状态');
  } catch (e) {
    console.error('加载状态失败:', e);
  }
}

// 定期保存状态
setInterval(savePersistentState, STATE_SAVE_INTERVAL_MS);

// ===========================================
// 第六部分：Offscreen 文档管理
// ===========================================

let offscreenReady = false;

async function ensureOffscreenDocument() {
  try {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: '播放通知提示音'
      });
      // 新创建的文档需要等待加载
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    offscreenReady = true;
  } catch (error) {
    console.error('创建 offscreen 文档失败:', error);
    offscreenReady = false;
    throw error;
  }
}

// ===========================================
// 第七部分：音频播放
// ===========================================

// 发送播放消息（带重试）
async function sendPlayMessage(volume, retryCount = 0) {
  const MAX_RETRIES = 2;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'playSound',
      volume: volume
    });

    // 检查 offscreen 返回的结果
    if (response && !response.success) {
      console.warn('[Background] Offscreen 播放失败:', response.error);
      // 如果 offscreen 内部失败，重置状态以便下次重建
      if (retryCount < MAX_RETRIES) {
        offscreenReady = false;
        await ensureOffscreenDocument();
        return sendPlayMessage(volume, retryCount + 1);
      }
    }
  } catch (error) {
    const errorMsg = error?.message || String(error);

    // 如果是 "receiving end does not exist" 错误，尝试重建 offscreen
    if (errorMsg.includes('Receiving end does not exist') && retryCount < MAX_RETRIES) {
      console.warn(`[Background] 播放消息失败，重试 ${retryCount + 1}/${MAX_RETRIES}`);
      offscreenReady = false;
      await ensureOffscreenDocument();
      return sendPlayMessage(volume, retryCount + 1);
    }

    throw error;
  }
}

async function playNotificationSound() {
  try {
    const settings = await chrome.storage.sync.get({ soundVolume: DEFAULT_VOLUME });
    const volume = clampVolume(settings.soundVolume);

    if (volume === 0) {
      console.log('[Background] 音量为 0，跳过播放');
      return;
    }

    if (!offscreenReady) {
      await ensureOffscreenDocument();
    }

    await sendPlayMessage(volume);
  } catch (error) {
    console.error('[Background] 播放通知声音失败:', error);
  }
}

async function playTestSound(soundFile, soundType, volume) {
  try {
    // 清除旧的测试通知
    for (const [notificationId, info] of testNotifications.entries()) {
      clearTimeout(info.timerId);
      chrome.notifications.clear(notificationId);
      testNotifications.delete(notificationId);
    }

    const normalizedVolume = clampVolume(volume);
    const percent = Math.round(normalizedVolume * 100);
    let message = `正在播放测试音效，音量：${percent}%`;
    if (normalizedVolume === 0) {
      message = '音量已设为静音 (0%)';
    } else if (Math.abs(normalizedVolume - MAX_VOLUME) < 0.001) {
      message = `音量已设为最大 (${Math.round(MAX_VOLUME * 100)}%)`;
    } else if (Math.abs(normalizedVolume - DEFAULT_VOLUME) < 0.001) {
      message = `音量已设为默认值 (${Math.round(DEFAULT_VOLUME * 100)}%)`;
    }

    const testNotificationId = `test_${Date.now()}`;

    chrome.notifications.create(testNotificationId, {
      type: 'basic',
      iconUrl: 'icon128.png',
      title: '🔊 音效测试',
      message: message,
      silent: true
    }, (notificationId) => {
      if (notificationId) {
        const timerId = setTimeout(() => {
          chrome.notifications.clear(notificationId);
          testNotifications.delete(notificationId);
        }, 3000);

        testNotifications.set(notificationId, {
          timerId: timerId,
          timestamp: Date.now()
        });
      }
    });

    if (!offscreenReady) {
      await ensureOffscreenDocument();
    }

    await sendPlayMessage(normalizedVolume);
  } catch (error) {
    console.error('[Background] 测试功能出错:', error);
  }
}

// ===========================================
// 第八部分：通知系统
// ===========================================

async function sendNotification(platform, options = {}) {
  try {
    // 检查平台是否启用以及全局开关
    const settings = await chrome.storage.sync.get({ 
      [platform.enabledKey]: true,
      notificationEnabled: true,
      soundEnabled: true
    });
    if (!settings[platform.enabledKey]) return;
    if (!settings.notificationEnabled && !settings.soundEnabled) return;

    const { title, message, targetUrl } = platform.notify;

    const finalTitle = options.dynamicTitle || title;
    const finalMessage = options.dynamicMessage || message;
    const finalIconUrl = options.iconUrl ? options.iconUrl : 'icon128.png';

    if (settings.notificationEnabled) {
      // 生成新通知 ID
      const notificationId = 'ai_notification_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
      const normalizedTabId = typeof options.tabId === 'number' && options.tabId >= 0 ? options.tabId : undefined;
      const normalizedUrl = options.targetUrl || targetUrl;
  
      if (normalizedTabId !== undefined || normalizedUrl) {
        activeNotifications.set(notificationId, {
          tabId: normalizedTabId,
          targetUrl: normalizedUrl
        });
      }
  
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: finalIconUrl,
        title: finalTitle,
        message: finalMessage,
        priority: 1,
        silent: true,
        requireInteraction: false // 允许去通知中心
      });
  
      // 设置较长的有效期来清理内存
      setTimeout(() => {
        activeNotifications.delete(notificationId);
      }, 24 * 60 * 60 * 1000); // 1天后清理此条记录的内存
    }

    if (settings.soundEnabled) {
      playNotificationSound();
    }
  } catch (e) {
    console.error('发送通知失败:', e);
  }
}

// 通知事件监听
chrome.notifications.onClosed.addListener((notificationId, byUser) => {
  activeNotifications.delete(notificationId);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const target = activeNotifications.get(notificationId);
  if (!target) return;
  
  activeNotifications.delete(notificationId);
  chrome.notifications.clear(notificationId);

  const { tabId, targetUrl } = target;
  if (typeof tabId === 'number') {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        // 如果标签页刚才被关了，新开一个网址
        if (targetUrl) chrome.tabs.create({ url: targetUrl });
        return;
      }

      // 拉起目标窗口
      if (typeof tab.windowId === 'number') {
        chrome.windows.update(tab.windowId, { focused: true }, () => {
          if (chrome.runtime.lastError) { /* 忽略 */ }
        });
      }
      // 激活标签页
      chrome.tabs.update(tabId, { active: true });
    });
    return;
  }

  if (targetUrl) {
    chrome.tabs.create({ url: targetUrl });
  }
});

// ===========================================
// 第八点五部分：ChatGPT 静默检测（处理文生图等工具调用场景）
// ===========================================

// ChatGPT 在文生图时 lat/r 会在文字段结束就发出（count_tokens=0），但图片可能还要 30-60s 才生成完。
// 此外混合场景（文字+画图、画图+文字）的 lat/r 也可能在 turn 中间发出。
// 解决方案：把"lat/r 触发即通知"改为"lat/r 之后等待若干静默时间，期间任何新事件都重置计时器"。
// 监听的事件：
//   - lat/r：每次完成都重置计时器
//   - files/download/file_*：仅在已有 pending 状态时计入（避免误把"用户单独下载附件"当成回答完成）

function scheduleChatgptNotify(tabId, eventType) {
  if (typeof tabId !== 'number' || tabId < 0) return;

  console.log('[BG-Diag][scheduleChatgptNotify]', 'tab=' + tabId, 'eventType=' + eventType, 'expectingImage=' + chatgptExpectingImage.has(tabId), 'pending=' + chatgptPendingNotify.has(tabId));

  // 画图模式下：lat/r 完成不立即通知，等待真正的 file_download 才触发
  if (eventType === 'lat_r' && chatgptExpectingImage.has(tabId)) {
    return;
  }

  const existing = chatgptPendingNotify.get(tabId);
  const now = Date.now();
  const startTime = existing?.startTime || now;
  const hasImage = (existing?.hasImage) || (eventType === 'image_download');

  // 兜底：超过最大等待时间立即触发
  if (now - startTime > CHATGPT_MAX_WAIT_MS) {
    if (existing) clearTimeout(existing.timeoutId);
    chatgptPendingNotify.delete(tabId);
    fireChatgptNotify(tabId, hasImage);
    return;
  }

  if (existing) clearTimeout(existing.timeoutId);

  const timeoutId = setTimeout(() => {
    const state = chatgptPendingNotify.get(tabId);
    chatgptPendingNotify.delete(tabId);
    fireChatgptNotify(tabId, state?.hasImage || false);
  }, CHATGPT_DEBOUNCE_MS);

  chatgptPendingNotify.set(tabId, { timeoutId, hasImage, startTime });
}

function fireChatgptNotify(tabId, hasImage) {
  console.log('[BG-Diag][fireChatgptNotify] 触发通知', 'tab=' + tabId, 'hasImage=' + hasImage);
  const platform = PLATFORMS.find(p => p.id === 'chatgpt');
  if (!platform) return;
  if (isThrottled(platform.id, tabId, platform.throttleMs)) return;

  let dynamicTitle;
  let dynamicMessage;

  // 优先使用 pageHook 捕获的用户提问作为标题
  const snippetData = latestSnippetPerTab.get(tabId);
  if (snippetData?.prompt) {
    dynamicTitle = snippetData.prompt;
    dynamicMessage = hasImage
      ? '🎨 图片已生成完成，点击查看'
      : (snippetData.snippet || platform.notify.message);
    latestSnippetPerTab.delete(tabId);
  } else if (hasImage) {
    dynamicTitle = '🎨 ChatGPT 图片生成完成';
    dynamicMessage = '点击通知打开对话查看图片。';
  }
  // 否则使用平台默认标题/消息

  sendNotification(platform, {
    tabId,
    dynamicTitle,
    dynamicMessage,
    iconUrl: 'chatgpt.png'
  });
}

// 画图失败/中断专用通知：标题加 ⚠️，消息说明被中断的原因（signal 名）。
// 与 fireChatgptNotify 共用平台节流（4s），避免与同一 turn 的其他通知重复。
function fireChatgptFailedNotify(tabId, signal) {
  console.log('[BG-Diag][fireChatgptFailedNotify] 触发失败通知', 'tab=' + tabId, 'signal=' + (signal || ''));
  const platform = PLATFORMS.find(p => p.id === 'chatgpt');
  if (!platform) return;
  if (isThrottled(platform.id, tabId, platform.throttleMs)) return;

  // 把 signal 名翻译成更友好的描述
  const reasonMap = {
    response_failed: '生成失败',
    response_incomplete: '生成中断（未完成）',
    response_cancelled: '生成被取消'
  };
  const reasonText = reasonMap[signal] || signal || '未知原因';

  let dynamicTitle = '⚠️ ChatGPT 画图失败';
  let dynamicMessage = `图片生成被中断（${reasonText}），点击查看详情。`;

  // 优先使用 pageHook 捕获的用户提问作为标题（前缀加 ⚠️）
  const snippetData = latestSnippetPerTab.get(tabId);
  if (snippetData?.prompt) {
    dynamicTitle = '⚠️ ' + snippetData.prompt;
    latestSnippetPerTab.delete(tabId);
  }

  sendNotification(platform, {
    tabId,
    dynamicTitle,
    dynamicMessage,
    iconUrl: 'chatgpt.png'
  });
}

function isChatgptFileDownload(details) {
  let url;
  try {
    url = new URL(details.url);
  } catch {
    return false;
  }
  return url.hostname === 'chatgpt.com'
    && details.method === 'GET'
    && CHATGPT_FILE_DOWNLOAD_PATTERN.test(url.pathname);
}

// pageHook 报告 SSE 流中检测到画图工具调用时调用：
// 把 tab 标记为"画图中"，让 lat/r 完成时跳过通知，等真正的 file_download 才触发。
// 5 分钟兜底超时：画图失败/超时也能保证最终发出通知。
function setChatgptExpectingImage(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) return;

  // 如果 image-gen 信号晚于 lat/r 到达（lat/r 已启动 1.5s 防抖），
  // 这里取消 pending 通知，避免防抖到期还误发"开始画图"通知。
  const pending = chatgptPendingNotify.get(tabId);
  if (pending) {
    clearTimeout(pending.timeoutId);
    chatgptPendingNotify.delete(tabId);
  }

  const existing = chatgptExpectingImage.get(tabId);
  if (existing) clearTimeout(existing.timeoutId);

  const timeoutId = setTimeout(() => {
    chatgptExpectingImage.delete(tabId);
    // 兜底：图始终没下载下来，仍然发一次通知（hasImage=false）
    fireChatgptNotify(tabId, false);
  }, CHATGPT_IMAGE_WAIT_MS);

  chatgptExpectingImage.set(tabId, { timeoutId, startTime: Date.now() });
}

function clearChatgptExpectingImage(tabId) {
  const existing = chatgptExpectingImage.get(tabId);
  if (!existing) return;
  clearTimeout(existing.timeoutId);
  chatgptExpectingImage.delete(tabId);
}

// ===========================================
// 第九部分：Service Worker 保活
// ===========================================

function keepServiceWorkerAlive() {
  chrome.alarms.create('notifier-keep-alive', { periodInMinutes: 0.4 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'notifier-keep-alive') {
    chrome.runtime.getPlatformInfo(() => { /* 保活 ping */ });
  }
});

// ===========================================
// 第十部分：请求监听器
// ===========================================

const webRequestFilter = {
  urls: buildUrlFilters(),
  types: ['xmlhttprequest']
};

// 诊断辅助：记录画图任务期间所有 chatgpt.com 的关键请求，便于逆向真实流量
function diagLogChatgptRequest(stage, details) {
  try {
    const u = new URL(details.url);
    if (u.hostname !== 'chatgpt.com') return;
    // 过滤掉静态资源/统计/CDN，只看 backend-api
    if (!u.pathname.startsWith('/backend-api/')) return;
    const status = details.statusCode !== undefined ? ' status=' + details.statusCode : '';
    console.log('[BG-Diag][' + stage + ']', details.method || 'GET', u.pathname, 'tab=' + details.tabId, 'reqId=' + details.requestId + status);
  } catch { /* ignore */ }
}

chrome.webRequest.onBeforeRequest.addListener((details) => {
  diagLogChatgptRequest('onBeforeRequest', details);
}, { urls: ['https://chatgpt.com/backend-api/*'], types: ['xmlhttprequest'] });

chrome.webRequest.onCompleted.addListener((details) => {
  diagLogChatgptRequest('onCompleted', details);
}, { urls: ['https://chatgpt.com/backend-api/*'], types: ['xmlhttprequest'] });

// 监听器 1: onBeforeRequest - 捕获匹配的请求开始时间（用于过滤瞬间完成的误报）
chrome.webRequest.onBeforeRequest.addListener((details) => {
  const platform = findPlatformForRequest(details); // 捕获所有，不过滤 detectionType
  if (!platform) return;

  requestState.set(details.requestId, {
    platformId: platform.id,
    tabId: details.tabId,
    isStream: false,
    startTime: Date.now()
  });

  const key = stateKey(platform.id, details.tabId);
  latestRequestPerTab.set(key, details.requestId);

  if (platform.detection.trackStart) {
    lastStartAt.set(key, Date.now());

    // 1 小时后自动清理开始时间记录
    setTimeout(() => {
      lastStartAt.delete(key);
      debouncedSave();
    }, STATE_EXPIRY_MS);
  }

  debouncedSave();
}, webRequestFilter);

// 监听器 2: onHeadersReceived - 确认是否为 SSE 流
chrome.webRequest.onHeadersReceived.addListener((details) => {
  const req = requestState.get(details.requestId);
  if (!req) return;

  const isEventStream = details.responseHeaders?.some(h =>
    h.name.toLowerCase() === 'content-type' && (h.value || '').includes('text/event-stream')
  );

  if (isEventStream) {
    req.isStream = true;
    setupLongRunningTimeout(details.requestId, req.tabId, req.platformId);
  } else {
    // 判断平台配置
    const platform = PLATFORMS.find(p => p.id === req.platformId);
    if (!platform) {
      requestState.delete(details.requestId);
      return;
    }
    
    // 只有强依赖 sse-stream 的平台才在这里提前删除非流请求记录，
    // request-complete 等类型的请求需要保留状态以供计算耗时使用
    if (platform.detection.type === 'sse-stream') {
      requestState.delete(details.requestId);
      if (platform.detection.trackStart) {
        lastStartAt.delete(stateKey(req.platformId, req.tabId));
      }
    }
  }
}, webRequestFilter, ['responseHeaders']);

// 监听器 3: onCompleted - 处理请求完成
chrome.webRequest.onCompleted.addListener((details) => {
  // 检查是否有之前保存的请求状态
  const req = requestState.get(details.requestId);
  if (req) {
    const platform = PLATFORMS.find(p => p.id === req.platformId);
    if (platform) {
      const key = stateKey(platform.id, details.tabId);
      const isLatest = latestRequestPerTab.get(key) === details.requestId;

      const duration = Date.now() - req.startTime;

      // 判断核心逻辑：
      const isValidStream = req.isStream && duration > 2000;
      const isValidRequest = platform.detection.type === 'request-complete';

      if (isLatest && (isValidStream || isValidRequest)) {
        // ChatGPT 走静默检测：lat/r 不立即通知，重置防抖计时器，等真正"安静"再触发。
        // 这样能正确处理文生图（lat/r 早于图片完成）、文字+画图混合等场景。
        if (platform.id === 'chatgpt') {
          scheduleChatgptNotify(details.tabId, 'lat_r');
        } else if (!isThrottled(platform.id, details.tabId, platform.throttleMs)) {
          // 其他平台保持立即通知逻辑

          // 稍微等待一下让 hook 脚本的 Prompt 数据到位
          const delayMs = (platform.id === 'gemini' || platform.id === 'grok') ? 500 : 0;
          const capturedTabId = details.tabId;
          const capturedPlatform = platform;

          setTimeout(() => {
            let dynamicTitle = undefined;
            let dynamicMessage = undefined;
            let iconUrl = undefined;

            if (capturedPlatform.id === 'gemini') {
              iconUrl = 'gemini-color.png';
            } else if (capturedPlatform.id === 'grok') {
              iconUrl = 'grok.png';
            }

            // 读取 hook 捕获的 prompt 数据
            const snippetData = latestSnippetPerTab.get(capturedTabId);
            if (snippetData) {
              if (snippetData.prompt) dynamicTitle = snippetData.prompt;
              if (snippetData.snippet) dynamicMessage = snippetData.snippet;
              latestSnippetPerTab.delete(capturedTabId);
            }

            sendNotification(capturedPlatform, {
              tabId: capturedTabId,
              dynamicTitle,
              dynamicMessage,
              iconUrl
            });
          }, delayMs);
        }
      }
    }
    // 无论是否触发通知，请求结束必须清理以防内存泄漏
    cleanupRequest(details.requestId, details.tabId, req.platformId);
    return;
  }

  // ChatGPT 文生图完成的兜底信号：files/download/file_*
  // 主路径：WebSocket image_gen_finished 信号触发通知（更早、更可靠）。
  // 兜底：万一 WebSocket 信号丢失，file_download 出现时如果 tab 仍在画图等待状态，
  // 直接触发"画图完成"通知（不走 15s 防抖，否则要等太久）。
  // fireChatgptNotify 内部已有 4s 节流，能防多图情况下的重复通知。
  if (isChatgptFileDownload(details)) {
    if (chatgptExpectingImage.has(details.tabId)) {
      clearChatgptExpectingImage(details.tabId);
      fireChatgptNotify(details.tabId, true);
    }
    // 否则忽略：要么 WebSocket 已经触发过通知（节流挡住后续），要么是用户单独下载附件
    return;
  }

  // 检查是否匹配 followup 请求
  const followupPlatform = findPlatformForFollowup(details);
  if (followupPlatform) {
    const key = stateKey(followupPlatform.id, details.tabId);
    const startTime = lastStartAt.get(key);
    const now = Date.now();

    if (startTime && (now - startTime > followupPlatform.followup.minDelayMs)) {
      if (!isThrottled(followupPlatform.id, details.tabId, followupPlatform.throttleMs)) {
        sendNotification(followupPlatform, { tabId: details.tabId });
      }
      cleanupTab(followupPlatform.id, details.tabId);
    }
    return;
  }
}, webRequestFilter);

// 监听器 4: onErrorOccurred - 请求出错时清理
chrome.webRequest.onErrorOccurred.addListener((details) => {
  cleanupRequest(details.requestId, details.tabId);
}, webRequestFilter);

// ===========================================
// 第十一部分：消息处理
// ===========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 注意：playSound 消息由 offscreen 文档处理，这里不要处理它
  // 否则会导致消息端口提前关闭

  if (message.action === 'testSound') {
    playTestSound(message.soundFile, message.soundType, message.volume);
    sendResponse({ success: true });
    return true; // 表示会异步响应
  }

  // 处理来自 content script 的 SSE 流事件
  if (message.action === 'chatgptStreamEvent') {
    handleStreamEvent(message, sender);
    sendResponse({ success: true });
    return true; // 表示会异步响应
  }

  // 未处理的消息，不返回值让其他监听器（如 offscreen）处理
});

// ===========================================
// 第十二部分：SSE 流事件处理
// ===========================================

// 处理来自 content script 的 SSE 流事件
async function handleStreamEvent(message, sender) {
  const { eventType, eventData, url } = message;
  const tabId = sender.tab?.id;

  // 根据 URL 确定平台
  let platform = null;
  try {
    const urlObj = new URL(url);
    platform = PLATFORMS.find(p =>
      p.hosts.some(host => {
        if (host.startsWith('*.')) {
          return urlObj.hostname.endsWith(host.slice(1)) || urlObj.hostname === host.slice(2);
        }
        return urlObj.hostname === host;
      })
    );
  } catch (e) {
    return;
  }

  // pageHook/geminiHook 在拦截到请求时立刻发送的 prompt 数据
  if (eventType === 'chatgpt_prompt_captured' || eventType === 'gemini_prompt_captured' || eventType === 'grok_prompt_captured') {
    latestSnippetPerTab.set(tabId, {
      prompt: eventData.prompt,
      snippet: ''
    });
    return;
  }

  // pageHook 报告新一轮 SSE 流开始：清理上一轮残留的 expecting-image 状态，
  // 避免上一轮画图任务的状态影响这一轮（比如用户没等画完就发新消息）
  if (eventType === 'chatgpt_turn_started') {
    clearChatgptExpectingImage(tabId);
    return;
  }

  // pageHook 在 SSE 流中检测到画图工具调用：标记 tab 为"画图中"
  // 此后 lat/r 完成时会跳过通知，等真正的 file_download 才触发
  if (eventType === 'chatgpt_image_gen_started') {
    console.log('[BG-Diag][image_gen_started] 收到画图信号', 'tab=' + tabId, 'signal=' + (eventData?.signal || ''));
    setChatgptExpectingImage(tabId);
    return;
  }

  // pageHook 从 WebSocket 检测到画图最终完成（image_asset_pointer in final / ghostrider:final /
  // conversation_async_status:4）。这是比 file_download 更早、更可靠的完成信号。
  // 立即触发通知（不走 15s 防抖），并清掉 expecting 状态。
  if (eventType === 'chatgpt_image_gen_finished') {
    console.log('[BG-Diag][image_gen_finished] 收到画图完成信号', 'tab=' + tabId, 'signal=' + (eventData?.signal || ''), 'source=' + (eventData?.source || ''));
    clearChatgptExpectingImage(tabId);
    // 也清掉可能的 pending（理论上 expecting 模式下 lat/r 应已被跳过，pending 不会有，这里是保险）
    const pending = chatgptPendingNotify.get(tabId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      chatgptPendingNotify.delete(tabId);
    }
    fireChatgptNotify(tabId, true);
    return;
  }

  // pageHook 从 WebSocket 检测到画图失败/中断（response.failed / response.incomplete / response.cancelled）。
  // 清掉 expecting 状态避免 5 分钟兜底再发一次错误的"完成"通知，并发出"画图失败"通知。
  if (eventType === 'chatgpt_image_gen_failed') {
    console.log('[BG-Diag][image_gen_failed] 收到画图失败信号', 'tab=' + tabId, 'signal=' + (eventData?.signal || ''), 'source=' + (eventData?.source || ''));
    clearChatgptExpectingImage(tabId);
    const pending = chatgptPendingNotify.get(tabId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      chatgptPendingNotify.delete(tabId);
    }
    fireChatgptFailedNotify(tabId, eventData?.signal);
    return;
  }

  // pageHook 提供的 ChatGPT 对话快照（流结束时更新，含 snippet）
  if (eventType === 'chatgpt_generation_finished') {
    const existing = latestSnippetPerTab.get(tabId) || {};
    latestSnippetPerTab.set(tabId, {
      prompt: eventData.prompt || existing.prompt,
      snippet: eventData.snippet || existing.snippet
    });
    return;
  }

  if (!platform || !platform.streamEvents) return;

  // 处理思考完成事件
  if (eventType === 'reasoning_end' && platform.streamEvents.reasoningEnd) {
    const config = platform.streamEvents.reasoningEnd;

    // 检查主开关是否启用
    const mainSettings = await chrome.storage.sync.get({ [platform.enabledKey]: true });
    if (!mainSettings[platform.enabledKey]) return;

    // 检查子功能是否启用
    const settings = await chrome.storage.sync.get({ [config.enabledKey]: true });
    if (!settings[config.enabledKey]) return;

    // 节流检查
    const throttleKey = `${platform.id}:reasoning:${tabId}`;
    if (isThrottledByKey(throttleKey, config.throttleMs || 2000)) return;

    // 发送通知
    const durationText = eventData.durationSec ? `（思考了 ${eventData.durationSec} 秒）` : '';
    await sendNotificationDirect({
      title: config.notify.title,
      message: config.notify.message + durationText,
      targetUrl: config.notify.targetUrl,
      iconUrl: platform.id === 'chatgpt' ? 'chatgpt.png' : 'icon128.png',
      tabId
    });
  }
}

// 直接发送通知（不通过平台配置）
async function sendNotificationDirect(options) {
  const { title, message, targetUrl, tabId, iconUrl } = options;

  const settings = await chrome.storage.sync.get({ 
    notificationEnabled: true,
    soundEnabled: true
  });

  if (!settings.notificationEnabled && !settings.soundEnabled) return;

  if (settings.notificationEnabled) {
    const notificationId = 'ai_notification_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const normalizedTabId = typeof tabId === 'number' && tabId >= 0 ? tabId : undefined;
  
    if (normalizedTabId !== undefined || targetUrl) {
      activeNotifications.set(notificationId, {
        tabId: normalizedTabId,
        targetUrl
      });
    }
  
    const finalIconUrl = iconUrl ? iconUrl : 'icon128.png';
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: finalIconUrl,
      title,
      message,
      priority: 1,
      silent: true,
      requireInteraction: false
    });
  
    setTimeout(() => {
      activeNotifications.delete(notificationId);
    }, 24 * 60 * 60 * 1000);
  }

  if (settings.soundEnabled) {
    playNotificationSound();
  }
}

// 独立的节流函数（用于流事件）
function isThrottledByKey(key, ms) {
  const now = Date.now();
  const last = lastNotifyAt.get(key) || 0;
  if (now - last < ms) return true;
  lastNotifyAt.set(key, now);
  return false;
}

// ===========================================
// 第十二部分：初始化
// ===========================================

async function initialize() {
  await loadPersistentState();
  await ensureOffscreenDocument();
  keepServiceWorkerAlive();
  console.log('AI 回答完成提醒器已启动，监控平台:', PLATFORMS.map(p => p.name).join(', '));
}

initialize();
