# Codex SSH 极简完成提醒设计

## 背景

仓库当前 README 使用 Codex hook 调用 `afplay` 和 `terminal-notifier`。当 Codex 直接运行在本地 macOS 时，这种方式能够工作；当 Codex 运行在 SSH 服务器上时，hook 也会在服务器执行，无法访问本地 macOS 的音频播放器和通知中心。

本设计不建立额外的网络通知链路，而是复用 SSH 已经存在的终端数据流：远端 Codex 在一轮任务完成时输出终端 BEL 字符，本地 VS Code 集成终端接收 BEL 后播放提示音并显示视觉标记。

## 目标

- 用户每次仍然只执行原有的 `ssh` 命令，不增加参数或包装命令。
- 不安装或运行独立的本地常驻进程。
- 不建立反向端口转发、HTTP 服务或第三方推送服务。
- 提醒仅随当前 SSH 终端会话存在；关闭会话后自然失效。
- Codex 每轮回答完成后，在本地 VS Code 播放可感知的提示音。
- 配置步骤足够短，能够直接加入 README 教程。

## 非目标

- 不复用仓库中的自定义 MP3。
- 不显示 macOS 系统通知横幅。
- 不支持点击提醒后跳转到特定终端或 Codex 会话。
- 不在 SSH 已断开后继续发送提醒。
- 本阶段不开发 VS Code 扩展或本地通知桥。
- 本阶段不改动 Chrome 扩展的任何逻辑。

## 方案概述

```text
远端 Codex 完成一轮回答
        │
        ▼
Codex TUI 输出 BEL（0x07）
        │
        ▼
现有 SSH PTY 数据流
        │
        ▼
本地 VS Code 集成终端
        │
        ├── 播放 VS Code 的 Terminal Bell 提示音
        └── 在终端标签上显示视觉提示
```

该链路没有监听端口，也没有额外进程。BEL 与普通终端输出一样通过 SSH 返回本地；SSH 会话关闭后，PTY 和提醒链路同时消失。

## 用户配置

### 1. 本地 VS Code

用户在 VS Code 的本地 User Settings JSON 中加入：

```json
{
  "accessibility.signals.terminalBell": {
    "sound": "on"
  },
  "terminal.integrated.enableVisualBell": true
}
```

必须修改本地 User Settings，而不是仅修改服务器上的 Remote Settings。提示音由本地 VS Code 进程播放。

这两个设置的职责分别为：

- `accessibility.signals.terminalBell.sound`：收到 BEL 时播放 VS Code 内置声音。
- `terminal.integrated.enableVisualBell`：收到 BEL 时在终端标签显示视觉反馈。

### 2. 远端 Codex

用户在服务器的 `~/.codex/config.toml` 中加入：

```toml
[tui]
notifications = ["agent-turn-complete"]
notification_method = "bel"
notification_condition = "always"
```

配置含义：

- 只为 `agent-turn-complete` 事件提醒。
- 明确使用 BEL，避免依赖终端对 OSC 9 的兼容性判断。
- 无论终端是否处于焦点状态都发出提醒，避免 SSH 和 VS Code 的焦点状态传递不一致造成漏报。

如果用户已有 `[tui]` 配置块，只追加或更新上述三个键，不能重复声明 `[tui]`。

修改配置后需要重启当前 Codex CLI 进程。SSH 连接本身不需要重启。

## README 调整设计

实现阶段只调整 README 中的 Codex CLI 教程：

1. 将 BEL 方案设为 Codex 在本地和 SSH 环境下的默认方案。
2. 在配置前增加一个最短链路测试：

   ```bash
   printf '\a'
   ```

   如果本地 VS Code 能响并出现视觉提示，说明 SSH 与 VS Code 链路正常，再继续配置 Codex。
3. 明确区分“本地 VS Code User Settings”和“服务器 Codex config.toml”。
4. 删除 Codex 主教程中对 `terminal-notifier`、`afplay`、绝对 MP3 路径和 `Stop hook` 的依赖。
5. 保留 Claude Code 现有教程，不在本次范围内改造。
6. 在限制说明中明确：BEL 方案没有自定义 MP3、系统通知横幅和点击跳转。
7. 将现有 Codex `notify` 或 hook 配置导致重复提醒列入排查项。

## 错误处理与排查顺序

按照链路从近到远排查，避免用户一开始修改多处配置：

1. **直接测试 VS Code Bell**：在本地 VS Code 终端运行 `printf '\a'`。
2. **测试 SSH 透传**：登录服务器后运行同一命令。
3. **检查设置位置**：确认 Terminal Bell 开关配置在本地 User Settings。
4. **检查 Codex 配置加载**：确认修改的是服务器实际使用的 `~/.codex/config.toml`，并已重启 Codex。
5. **检查重复配置**：确认不存在旧的 Codex `notify`、`Stop hook` 或其他完成提醒。
6. **检查系统音频**：确认 VS Code、macOS 输出设备、静音和专注模式没有阻止声音。

如果步骤 1 失败，问题位于本地 VS Code 或系统音频；如果步骤 1 成功而步骤 2 失败，问题位于终端或 SSH 对控制字符的处理；如果步骤 2 成功但 Codex 不提醒，问题位于 Codex 配置。

## 兼容性与限制

- 目标环境为 macOS 本地 VS Code 集成终端，通过普通 SSH 运行远端 Codex CLI。
- 方案依赖当前终端存在 PTY；无 PTY 的非交互式 SSH 命令不在支持范围内。
- 启用 VS Code Terminal Bell 后，其他程序输出 BEL 时也会触发同一种提示音。
- VS Code 使用其内置提示音，无法由本仓库指定声音文件或音量。
- `notification_condition = "always"` 会在用户正看着 Codex 时同样响铃，这是保证不漏报的明确取舍。
- macOS 或 VS Code 静音时不保证产生声音，视觉提示仍可作为辅助。

## 验收标准

在一台远端服务器和 macOS VS Code 上完成以下验证：

1. 本地 VS Code 终端运行 `printf '\a'`，能听到提示音并看到视觉提示。
2. SSH 登录服务器后运行 `printf '\a'`，效果与本地一致。
3. 在远端 Codex 发起一轮纯文字请求，完成后只提醒一次。
4. 在远端 Codex 发起一轮包含工具调用的请求，完成后只提醒一次。
5. VS Code 终端处于非焦点状态时，完成提醒仍能播放。
6. 关闭 SSH 会话后，没有本项目留下的本地监听进程或开放端口。
7. Chrome 扩展原有网页提醒功能不受影响。

## 后续增强条件

只有当真实使用反馈明确要求以下能力时，才考虑 VS Code 扩展增强方案：

- 自定义仓库 MP3；
- 带问题摘要的通知内容；
- 点击提醒跳回对应 VS Code 窗口或终端；
- 对不同远端主机使用不同提示。

增强方案必须继续遵守“不运行独立常驻程序”的约束：接收逻辑只能随 VS Code 扩展宿主启动和退出。它不是本次极简方案的一部分。

## 参考依据

- Codex Advanced Configuration 的 Notifications 章节：`tui.notifications`、`tui.notification_method` 和 `tui.notification_condition` 为官方支持的 TUI 通知配置，`bel` 是明确支持的通知方式。
- VS Code `terminalConfiguration.ts`：`accessibility.signals.terminalBell` 控制终端铃声，`terminal.integrated.enableVisualBell` 控制终端标签的视觉提示。
