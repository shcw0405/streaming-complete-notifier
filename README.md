# 回答完就通知

## 项目简介
用于监测 Gemini、ChatGPT、Grok 与 AI Studio 的生成请求，当检测到生成结束时弹出桌面通知并播放提示音，可快速跳转回对应页面。

## 功能亮点
- **多平台精准捕捉**：实时监测 Gemini、ChatGPT、Grok 与 AI Studio 的生成状态，支持对具有思考模型（Reasoning Phase）的过程检测。
- **智能防误报机制**：内置请求耗时校验（Duration Check），有效过滤回车发送瞬间引发的极速预检请求（<1.5s），杜绝误报响铃。
- **持久化系统通知与任意门跳转**：拥抱操作系统原生通知中心（支持 macOS / Windows 通知记录留存）。打破原有 8 秒强制销毁，支持随时点击历史通知，精准拉起/重装并激活触发提问的独立 AI 网页。
- **自定义后台提示音**：100% 为基准音量，150% 为最大音量。
- **标签页防休眠**：可选开启 Web Worker 保活，防止 Chrome 冻结后台标签页，确保长时间思考任务也能及时收到通知。

## 环境准备
- 任意支持 Chrome 扩展开发的操作系统（Windows / macOS / Linux）
- Google Chrome 或 Microsoft Edge 浏览器（建议 116+）

## 本地调试步骤
1. 克隆或下载本仓库：`git clone https://github.com/chixi4/streaming-complete-notifier.git`。
2. 打开浏览器 `chrome://extensions`（Edge 为 `edge://extensions`），开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择仓库中的 `src/javascript` 目录。
4. 在目标 AI 页面触发生成流程，确认通知与跳转逻辑工作正常。

## 发布打包
1. 将 `src/javascript` 目录下的文件打包为 zip（保持目录结构）。
2. 按 Chrome Web Store 或 Edge Add-ons 的要求上传该压缩包完成发布。

## 目录结构
```
streaming-complete-notifier/
├── src/
│   └── javascript/   # 扩展主体代码
└── design/           # 设计素材或原型
```

## 许可协议
MIT
