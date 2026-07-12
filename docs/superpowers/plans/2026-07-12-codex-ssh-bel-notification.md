# Codex SSH BEL 完成提醒实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不运行本地常驻程序的前提下，让远端 Codex 的完成事件经 SSH BEL 信号触发本地 VS Code 提示音和视觉提醒，并用真实界面完成配置验证。

**Architecture:** 远端 Codex TUI 在 `agent-turn-complete` 时向当前 PTY 输出 BEL（`0x07`），SSH 原样传回本地，VS Code 集成终端负责播放内置提示音并显示视觉标记。配置分别落在本地 VS Code User Settings 和远端 `~/.codex/config.toml`，没有监听端口或额外进程。

**Tech Stack:** Codex CLI `config.toml`、SSH PTY、VS Code 集成终端、VS Code Terminal Bell、Computer Use

## Global Constraints

- 不安装或运行独立的本地常驻进程。
- 不建立反向端口转发、HTTP 服务或第三方推送服务。
- 不修改 Chrome 扩展逻辑。
- 不覆盖用户已有的 VS Code 设置或 Codex `[tui]` 其他键。
- 本次验证目标为 macOS 本地 VS Code 集成终端和普通 SSH 会话，不包含 tmux。
- 由于自动化无法判断扬声器是否真实发声，声音验收需要用户听觉确认；自动化同时验证 VS Code 视觉 Bell。

---

### Task 1: 配置并验证本地 VS Code Terminal Bell

**Files:**
- Modify: VS Code 本地 User Settings JSON（由 VS Code 界面定位，不假设磁盘路径）

**Interfaces:**
- Consumes: VS Code 集成终端输出的 BEL 字符 `0x07`
- Produces: VS Code 内置声音与终端标签视觉提醒

- [ ] **Step 1: 记录修改前的本地设置**

使用 Computer Use 打开命令面板，执行 `Preferences: Open User Settings (JSON)`，确认当前 JSON 可解析，并记录是否已存在以下键：

```json
"accessibility.signals.terminalBell"
"terminal.integrated.enableVisualBell"
```

- [ ] **Step 2: 写入最小设置**

在保留其他用户设置的前提下，将以下键合并到顶层对象：

```json
"accessibility.signals.terminalBell": {
  "sound": "on"
},
"terminal.integrated.enableVisualBell": true
```

保存文件，确认 VS Code 没有 JSON 语法错误提示。

- [ ] **Step 3: 发送本地测试信号**

使用 Computer Use 打开 VS Code 集成终端并运行：

```bash
printf '\a'
```

预期：终端标签出现视觉 Bell；用户能听到 VS Code 内置提示音。

- [ ] **Step 4: 记录本地测试结果**

如果视觉 Bell 未出现，打开 VS Code Settings UI 搜索 `Terminal Bell`，确认 `Terminal › Integrated: Enable Visual Bell` 已启用；再次运行 `printf '\a'`。如果视觉 Bell 出现但无声音，请用户确认 macOS 音量和 VS Code 是否被静音，不继续修改系统级音频设置。

### Task 2: 识别并验证当前 SSH 终端链路

**Files:**
- None

**Interfaces:**
- Consumes: 当前 VS Code 集成终端中的 SSH PTY
- Produces: BEL 能从远端服务器透传到本地 VS Code 的验证结果

- [ ] **Step 1: 检查当前 VS Code 终端**

使用 Computer Use 检查当前集成终端是否已经登录远端；只依据可见 shell 提示符和以下只读命令判断，不读取或输出凭据：

```bash
printf 'host=%s\n' "$(hostname)"
printf 'ssh=%s\n' "${SSH_CONNECTION:+yes}"
```

预期：`ssh=yes` 表示当前 shell 处于 SSH 会话。

- [ ] **Step 2: 发送远端测试信号**

在确认处于 SSH 会话的同一个终端运行：

```bash
printf '\a'
```

预期：本地 VS Code 出现与 Task 1 相同的视觉 Bell 和提示音。

- [ ] **Step 3: 处理没有活动 SSH 会话的情况**

如果当前没有已登录的 SSH 终端，停止远端配置，不从 SSH 配置文件猜测或自动连接服务器；保留已经验证的本地设置，并请用户打开其日常使用的 SSH 会话后继续。

### Task 3: 配置并验证远端 Codex TUI

**Files:**
- Modify: 远端 `~/.codex/config.toml`

**Interfaces:**
- Consumes: Codex TUI 事件 `agent-turn-complete`
- Produces: 当前 SSH PTY 上的 BEL 字符

- [ ] **Step 1: 检查远端 Codex 配置**

在已确认的 SSH 会话中运行：

```bash
codex --version
sed -n '1,240p' ~/.codex/config.toml
```

确认 Codex 可用，并检查是否已有 `[tui]`、`notify` 或 `hooks.Stop`。不得把配置中可能存在的 token 或凭据复制到对话输出。

- [ ] **Step 2: 备份远端配置**

运行：

```bash
cp ~/.codex/config.toml ~/.codex/config.toml.before-bel-notification
```

预期：备份文件存在，原配置内容不变。

- [ ] **Step 3: 合并 TUI 通知设置**

使用远端现有编辑器打开 `~/.codex/config.toml`，在已有 `[tui]` 块中更新键，或在没有该块时追加：

```toml
[tui]
notifications = ["agent-turn-complete"]
notification_method = "bel"
notification_condition = "always"
```

不得创建第二个 `[tui]` 块；不得删除 `[tui]` 中其他键。旧的 `notify` 或 `hooks.Stop` 先保持不变，只有实际发生重复提醒时才停用，以免扩大配置变更。

- [ ] **Step 4: 验证配置可加载**

退出旧 Codex 进程并在同一 SSH 终端重新启动：

```bash
codex
```

预期：Codex 正常启动，没有 TOML 解析或未知配置键错误。

- [ ] **Step 5: 运行端到端完成测试**

在新 Codex 会话中发送一条不调用工具的短消息：

```text
只回复：BEL 测试完成
```

预期：回答结束后本地 VS Code 只出现一次视觉 Bell，用户只听到一次提示音。

- [ ] **Step 6: 必要时排除重复提醒**

只有当 Step 5 实际出现两次提醒时，检查并停用旧的顶层 `notify` 或 Codex `Stop hook`，保留本计划的 `[tui]` 配置，然后重新启动 Codex 并重复 Step 5。

### Task 4: 更新仓库教程并验证文档

**Files:**
- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-07-12-codex-ssh-bel-notification-design.md`

**Interfaces:**
- Consumes: Tasks 1–3 验证通过的真实配置和排查顺序
- Produces: 本地与 SSH 用户都可复现的 Codex 极简提醒教程

- [ ] **Step 1: 将 README 的 Codex 主方案替换为 BEL**

删除 Codex 小节对 `codex_hooks`、`hooks.Stop`、`afplay`、`terminal-notifier` 和绝对 MP3 路径的依赖，写入以下远端配置：

```toml
[tui]
notifications = ["agent-turn-complete"]
notification_method = "bel"
notification_condition = "always"
```

- [ ] **Step 2: 添加 VS Code 本地设置和两段测试**

加入本计划 Task 1 的 VS Code User Settings JSON，并按顺序说明本地和 SSH 中各运行一次：

```bash
printf '\a'
```

- [ ] **Step 3: 写明限制和排查项**

明确说明此方案使用 VS Code 内置声音，没有自定义 MP3、macOS 系统通知横幅或点击跳转；补充本地 User Settings、Codex 重启、旧 `notify`/hook 重复提醒三个排查项。

- [ ] **Step 4: 检查文档差异**

运行：

```bash
rg -n "Codex CLI|notification_method|terminalBell|hooks.Stop|codex_hooks" README.md
git diff --check
```

预期：Codex 主教程包含 `notification_method = "bel"` 和 `terminalBell`；不再要求 Codex 使用 `hooks.Stop` 或 `codex_hooks`；`git diff --check` 无输出。

- [ ] **Step 5: 提交 README 修改**

```bash
git add README.md
git commit -m "docs: 添加 Codex SSH 极简提醒教程"
```

预期：提交成功，提交只包含 `README.md`。

### Task 5: 最终验证

**Files:**
- Verify: `README.md`
- Verify: `docs/superpowers/specs/2026-07-12-codex-ssh-bel-notification-design.md`

**Interfaces:**
- Consumes: 已完成的本地设置、远端设置和 README
- Produces: 可交付的验证记录

- [ ] **Step 1: 检查仓库状态和提交范围**

运行：

```bash
git status --short
git show --stat --oneline HEAD
```

预期：工作区干净；最新提交只修改 `README.md`。

- [ ] **Step 2: 汇总验证结果**

向用户分别报告：本地 BEL、SSH BEL、Codex 完成事件、重复提醒检查、README 校验。声音部分只报告用户实际确认的结果，不以视觉 Bell 推断声音已经播放。
