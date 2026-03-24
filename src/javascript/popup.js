// 简化的 Popup 菜单脚本
document.addEventListener('DOMContentLoaded', async () => {
  const geminiEnabled = document.getElementById('geminiEnabled');
  const chatgptEnabled = document.getElementById('chatgptEnabled');
  const chatgptReasoningEndEnabled = document.getElementById('chatgptReasoningEndEnabled');
  const grokEnabled = document.getElementById('grokEnabled');
  const aistudioEnabled = document.getElementById('aistudioEnabled');
  const notificationEnabled = document.getElementById('notificationEnabled');
  const soundEnabled = document.getElementById('soundEnabled');
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  const testButton = document.getElementById('testButton');

  const DEFAULT_VOLUME = 1;
  const MAX_VOLUME = 1.5;

  const clampVolume = (value) => {
    const numeric = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(numeric)) return DEFAULT_VOLUME;
    return Math.min(Math.max(numeric, 0), MAX_VOLUME);
  };

  let settings = {};

  // 加载设置
  await loadSettings();

  // 使用 requestAnimationFrame 确保 DOM 更新完成后再添加动画
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // 显示界面并启用动画
      document.body.classList.add('loaded');
    });
  });

  // 监听开关变化
  geminiEnabled.addEventListener('change', saveSettings);
  chatgptEnabled.addEventListener('change', () => {
    // 当 ChatGPT 主开关关闭时，子开关也禁用
    updateSubSwitchState();
    saveSettings();
  });
  if (chatgptReasoningEndEnabled) {
    chatgptReasoningEndEnabled.addEventListener('change', saveSettings);
  }
  if (aistudioEnabled) {
    aistudioEnabled.addEventListener('change', saveSettings);
  }
  if (grokEnabled) {
    grokEnabled.addEventListener('change', saveSettings);
  }
  if (notificationEnabled) {
    notificationEnabled.addEventListener('change', saveSettings);
  }
  if (soundEnabled) {
    soundEnabled.addEventListener('change', () => {
      updateSoundSubState();
      saveSettings();
    });
  }

  // 监听音量变化
  volumeSlider.addEventListener('input', () => {
    const clampedVolume = clampVolume(volumeSlider.value);
    volumeSlider.value = clampedVolume;
    volumeValue.textContent = Math.round(clampedVolume * 100) + '%';
    saveSettings();
  });

  // 测试按钮 - 支持快速连续点击
  let testClickCount = 0;
  testButton.addEventListener('click', async () => {
    testClickCount++;
    const currentCount = testClickCount;

    // 立即执行，不等待
    testSound(currentCount).catch(err => {
      console.error(`测试 #${currentCount} 失败:`, err);
    });
  });

  // 更新子开关状态（根据父开关）
  function updateSubSwitchState() {
    if (chatgptReasoningEndEnabled) {
      const parentEnabled = chatgptEnabled.checked;
      chatgptReasoningEndEnabled.disabled = !parentEnabled;
      // 视觉上显示禁用状态
      const subItem = chatgptReasoningEndEnabled.closest('.sub-item');
      if (subItem) {
        subItem.style.opacity = parentEnabled ? '1' : '0.5';
      }
    }
  }

  // 更新声音相关子项状态
  function updateSoundSubState() {
    if (soundEnabled && volumeSlider) {
      const parentEnabled = soundEnabled.checked;
      volumeSlider.disabled = !parentEnabled;
      const subItem = volumeSlider.closest('.sub-item');
      if (subItem) {
        subItem.style.opacity = parentEnabled ? '1' : '0.5';
        subItem.style.pointerEvents = parentEnabled ? 'auto' : 'none';
      }
    }
  }

  async function loadSettings() {
    try {
      settings = await chrome.storage.sync.get({
        geminiEnabled: true,
        chatgptEnabled: true,
        chatgptReasoningEndEnabled: true,
        grokEnabled: true,
        aistudioEnabled: true,
        notificationEnabled: true,
        soundEnabled: true,
        soundVolume: DEFAULT_VOLUME
      });

      // 直接设置状态，此时界面还是隐藏状态
      geminiEnabled.checked = settings.geminiEnabled;
      chatgptEnabled.checked = settings.chatgptEnabled;
      if (chatgptReasoningEndEnabled) {
        chatgptReasoningEndEnabled.checked = settings.chatgptReasoningEndEnabled;
      }
      if (grokEnabled) {
        grokEnabled.checked = settings.grokEnabled;
      }
      if (aistudioEnabled) {
        aistudioEnabled.checked = settings.aistudioEnabled;
      }
      if (notificationEnabled) {
        notificationEnabled.checked = settings.notificationEnabled;
      }
      if (soundEnabled) {
        soundEnabled.checked = settings.soundEnabled;
      }

      const sanitizedVolume = clampVolume(settings.soundVolume);
      settings.soundVolume = sanitizedVolume;
      volumeSlider.value = sanitizedVolume;
      volumeValue.textContent = Math.round(sanitizedVolume * 100) + '%';

      // 更新子开关状态
      updateSubSwitchState();
      updateSoundSubState();

    } catch (error) {
      console.error('加载设置失败:', error);
    }
  }

  async function saveSettings() {
    try {
      settings.geminiEnabled = geminiEnabled.checked;
      settings.chatgptEnabled = chatgptEnabled.checked;
      if (chatgptReasoningEndEnabled) {
        settings.chatgptReasoningEndEnabled = chatgptReasoningEndEnabled.checked;
      }
      if (grokEnabled) {
        settings.grokEnabled = grokEnabled.checked;
      }
      if (aistudioEnabled) {
        settings.aistudioEnabled = aistudioEnabled.checked;
      }
      if (notificationEnabled) {
        settings.notificationEnabled = notificationEnabled.checked;
      }
      if (soundEnabled) {
        settings.soundEnabled = soundEnabled.checked;
      }
      settings.soundVolume = clampVolume(volumeSlider.value);

      await chrome.storage.sync.set(settings);
    } catch (error) {
      console.error('保存设置失败:', error);
    }
  }

  async function testSound(clickId) {
    try {
      const volume = clampVolume(volumeSlider.value);

      // 立即发送消息，不等待响应
      chrome.runtime.sendMessage({
        action: 'testSound',
        soundFile: 'streaming-complete.mp3',
        soundType: 'custom',
        volume: volume,
        clickId: clickId
      }).catch(err => {
        console.error(`发送测试消息失败 #${clickId}:`, err);
      });
    } catch (error) {
      console.error(`测试音频失败 #${clickId}:`, error);
    }
  }
});
