# 回答完就通知

> **等待 AI 思考的时光，是属于我们的快乐摸鱼时刻。**
>
> 一个轻量的 Chrome 扩展，在 ChatGPT / Gemini / Grok / AI Studio 生成完成的瞬间，把你从摸鱼里拉回来。

![Hero](design/hero.png)

---

## 为什么做这个？

我们做这个产品的初衷，是为了减少 **使用 AI 过程中注意力分散** 的情况。

经常会有这样一个状态：发了消息给 ChatGPT 或 DeepSeek 之后，要等三分钟它才答完。这中间该干嘛呢？看眼别的窗口、刷下手机——很容易就忘了最初要做的那件事，注意力再也拉不回来。

所以我们做了它：**AI 答完就提醒你**。一声桌面通知 + 一段提示音，把你从摸鱼里温柔地拽回来，正好接住答案，立刻继续下一步。

> 摸鱼的爽，和不耽误事，可以兼得。

---

## 它适合谁？

### 🎓 赶期末周的大学生 —— _"等它想完，我来学！"_

线代、数据结构、操作系统四本一起上，让 AI 帮你梳理重点。它在思考，你刷会儿小红书。**叮——** 它写完了，回来抄作业。

### 👨‍💻 半夜 Vibe Coding 的程序员 —— _"让 AI 写，我来 Vibe~"_

凌晨两点，DEBUG OR DIE 招牌闪着光。Claude 正在生成 200 行 patch，你点开网易云。**叮——** patch 来了，复制、跑测试、Vibe 继续。

### 👩‍💼 被 AI 任务测试的产品经理 —— _"让 AI 测，我来摸~"_

今天的 to-do 是开会、写 PRD、提需求 AI、摸鱼软饭。让 AI 跑评估流程，你切到 IM 上聊会儿。**叮——** 报告出了，复制结论甩进群。

---

## 核心能力

| 能力                    | 说明                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔔 **多平台精准捕捉**   | 同时盯着 ChatGPT / Gemini / Grok / AI Studio 四个站，每家都有针对性识别策略，不放过任何一次完成。                                                                                                                                                                                                                   |
| 🧠 **思考完成单独提醒** | 对带 Reasoning 阶段的 ChatGPT 模型（o1 / o3 等），在"思考结束"时单独发一次通知，让你比首字符更早回到屏幕前。                                                                                                                                                                                                        |
| 🎨 **画图任务多重兜底** | 文生图任务有 WebSocket 信号、图片下载请求、DOM 图片加载三层冗余识别，画完立刻通知，失败也会单独告诉你"画图被中断"。                                                                                                                                                                                                 |
| 🛡️ **智能防误报**       | 内置请求耗时与流式判定双重校验，回车瞬间触发的极速预检请求 (<2s) 一律不弹窗，杜绝"刚发完消息就响"的尴尬。                                                                                                                                                                                                           |
| 📌 **历史通知任意门**   | 通知不会 8 秒就消失，进系统通知中心可长期留存。任何时刻点一下，自动拉起对应标签页或重开 AI 站点，不再丢上下文。                                                                                                                                                                                                     |
| 🔊 **可调音量提示音**   | 0%–150% 自由调节，100% 以上用 DynamicsCompressor 防爆音。再小的提示也能听清，再大也不刺耳。                                                                                                                                                                                                                         |
| 🌙 **后台保活伪装**     | ChatGPT 等站点会通过 [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) 检测标签页是否在前台，[切走会暂停流式传输](https://community.openai.com/t/chatgpt-pausing-completion-if-you-switch-tabs-30-11-2023/535273)。开启此项后扩展会伪装可见状态，让你大胆切走、放心摸鱼。 |
| 💬 **通知带原始提问**   | 标题直接用你刚刚的提问截取的前 35 个字，一眼就知道这是哪条对话出结果了。                                                                                                                                                                                                                                            |

---

## 支持的平台

| 平台      | 网址                | 状态                                    |
| --------- | ------------------- | --------------------------------------- |
| ChatGPT   | chatgpt.com         | ✅ 含思考完成 / 画图完成 / 画图失败检测 |
| Gemini    | gemini.google.com   | ✅                                      |
| Grok      | grok.com            | ✅                                      |
| AI Studio | aistudio.google.com | ✅                                      |

---

## 立刻开始用

### 环境

- Google Chrome / Microsoft Edge（建议 116+）
- Windows / macOS / Linux 都行

### 安装步骤

1. **下载源码**
   ```bash
   git clone https://github.com/shcw0405/streaming-complete-notifier.git
   ```
2. **打开扩展管理页**
   - Chrome：地址栏输入 `chrome://extensions`
   - Edge：地址栏输入 `edge://extensions`
3. **开启开发者模式**（右上角开关）
4. **加载扩展**：点击「加载已解压的扩展程序」，选择仓库内的 `src/javascript/` 目录
5. **测试**：去任意 AI 站点发一条消息试试，等回答出现时应该收到桌面通知 + 提示音

### 强烈推荐：把 AI 站点加入 Chrome 保活白名单

Chrome 会自动休眠后台标签页，导致回答完成后通知发不出来。**加入白名单后才能保证通知绝对到达**：

1. Chrome 右上角 **⋮** → **设置**
2. 左侧 **系统和性能** → **性能**
3. 找到 **「使这些站点保持活动状态」** → 点击 **添加站点**
4. 把以下地址依次加进去：
   - `https://chatgpt.com`
   - `https://gemini.google.com`
   - `https://grok.com`
   - `https://aistudio.google.com`

加完之后，这些标签页就不会被 Chrome 休眠或丢弃了。

---

## 个性化设置

点击浏览器右上角扩展图标即可打开设置面板：

- ✅ 各平台独立开关（只想要 ChatGPT 提醒？关掉其他三个就行）
- ✅ ChatGPT 「思考完成」单独开关
- ✅ 桌面通知 / 提示音 总开关
- ✅ 提示音音量 0%–150% 滑块（带试听按钮）
- ✅ 标签页防休眠（Visibility 伪装）开关

---

## 彩蛋：终端 AI 编程助手，也能响这一声

如果你除了网页 AI，还在用 [Claude Code](https://claude.com/claude-code) 或 [Codex CLI](https://github.com/openai/codex) 之类的终端 AI 编程助手——等它写完一段 patch 同样煎熬。**本仓库的提示音 mp3 可以无缝复用过去**，把那条"叮"也搬进终端。

更妙的是，借助 [`terminal-notifier`](https://github.com/julienXX/terminal-notifier) 这个 macOS 小工具，**点击通知就能自动跳回你跑 AI 的那个 App**（iTerm / VSCode / Terminal / Warp 等），和本扩展在网页上的体验完全一致。

### 准备：装一下 terminal-notifier

```bash
brew install terminal-notifier
```

首次运行后还需要在 **系统设置 → 通知** 里找到 **terminal-notifier** 一项，把"允许通知"打开。否则 macOS 会静默吞掉所有通知。

### Claude Code 配置

打开你的 Claude Code 设置文件：

- 默认启动用的是 `~/.claude/settings.json`
- 启动时如果加了 `--settings xxx.json`，那就改那个文件（`--settings` **会替代**默认文件，不是叠加）

在 JSON 顶层添加 `hooks` 字段：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "case \"$TERM_PROGRAM\" in iTerm.app) APP=com.googlecode.iterm2 ;; Apple_Terminal) APP=com.apple.Terminal ;; WarpTerminal) APP=dev.warp.Warp-Stable ;; ghostty) APP=com.mitchellh.ghostty ;; vscode) APP=com.microsoft.VSCode ;; *) APP=com.apple.Terminal ;; esac; afplay /绝对路径/to/streaming-complete-notifier/src/javascript/audio/streaming-complete.mp3 & terminal-notifier -title 'Claude Code' -message '完成了' -activate \"$APP\" 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

改完之后**重启 Claude Code**，hooks 才会重新加载。

> **为什么只用 Stop hook？** Claude Code 还有一个 `Notification` 事件，但它在空闲等待时也会触发，容易导致"明明没任务却突然响一声"。Stop hook 只在 agentic 任务（工具调用、写文件、运行命令）完成后触发，不会误响。纯文字闲聊不会触发 Stop，这是设计上的妥协，避免每说一句话都响一下。

### Codex CLI 配置

打开 Codex CLI 的配置文件 `~/.codex/config.toml`，添加以下内容：

```toml
# 1. 开启 hooks 功能
[features]
codex_hooks = true

# 2. 添加 Stop hook
[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = """case "$TERM_PROGRAM" in iTerm.app) APP=com.googlecode.iterm2 ;; Apple_Terminal) APP=com.apple.Terminal ;; WarpTerminal) APP=dev.warp.Warp-Stable ;; ghostty) APP=com.mitchellh.ghostty ;; vscode) APP=com.microsoft.VSCode ;; *) APP=com.apple.Terminal ;; esac; afplay /绝对路径/to/streaming-complete-notifier/src/javascript/audio/streaming-complete.mp3 & terminal-notifier -title 'Codex CLI' -message '完成了' -activate "$APP" 2>/dev/null || true"""
timeout = 30
```

如果你的 `config.toml` 里已经有 `[features]` 块，把 `codex_hooks = true` 加到那个块里即可，不要重复声明。

改完之后**重启 Codex CLI**，hooks 才会重新加载。

### 通用说明

- 把 `/绝对路径/to/...` 替换成你本地 clone 下来的路径，或换成任意你喜欢的 mp3。
- `case` 那段会读 `$TERM_PROGRAM` 自动判断你用的哪个终端 App，然后把 bundle ID 喂给 `terminal-notifier -activate`，**这样点击通知就会跳回那个 App**。
- 已内置识别：iTerm2 / Terminal.app / Warp / Ghostty / VSCode（含集成终端）。其他终端会 fallback 到 Terminal.app，按需自己加分支即可。

### 排查 checklist

- **完全没响？** 先确认加载的是哪个配置文件。Claude Code 注意 `--settings` 标志；Codex CLI 检查 `~/.codex/config.toml` 里 `codex_hooks = true` 是否已开启。
- **响了但点击没反应？** 检查系统设置里 terminal-notifier 的通知是不是允许的；以及 `$TERM_PROGRAM` 在你的终端里是什么值（命令行跑 `echo $TERM_PROGRAM` 看一眼，对照 case 分支）。
- **改完没生效？** 必须重启对应的 CLI 进程，运行中的会话不会热加载 hooks。
- **想确认 hook 是不是真触发了？** 在 command 前加一行日志：
  ```bash
  echo "$(date +%T) fired" >> /tmp/hook.log;
  ```
  随便聊几轮再 `cat /tmp/hook.log` 看有没有写入。

---

## 发布打包

把 `src/javascript/` 目录整体打包为 zip（保留目录结构），按 [Chrome Web Store 开发者文档](https://developer.chrome.com/docs/webstore/publish) 或 Edge Add-ons 要求上传即可。

---

## 目录结构

```
streaming-complete-notifier/
├── src/
│   └── javascript/   # 扩展主体代码（manifest + 各 hook 脚本）
├── design/           # 设计素材（hero 图、图标 PSD、提示音源文件）
├── docs/             # 架构研究文档
└── CLAUDE.md         # AI 助手开发指南
```

---

## 许可

MIT
