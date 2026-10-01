---
name: open-webbridge
description: |
  OpenWebBridge 允许 AI Agent 协同接管并驱动用户真实日常浏览器（Google Chrome / Microsoft Edge），复用用户现有的真实登录态、Cookie、企业 SSO 与插件环境。具备彩色标签页分组（Tab Groups）隔离、AXTree 无障碍语义树（@e 编号引用）、视口几何剪枝（--in-viewport 节省 50%+ Token）、多浏览器连接池精确路由（--browser chrome|edge）、人机断点接管（handoff 处理滑块/验证码）及原生 MCP 协议支持。当用户需要让 AI 访问网页、采集数据、自动化表单、进行端到端网页测试或多浏览器协同操作时使用。
metadata:
  version: "2.0.0"
---

# OpenWebBridge 浏览器协同技能

OpenWebBridge 是一款面向生产环境的**宿主寄生型（Host-Parasitic）**原生浏览器协同框架。
与传统的沙盒无头浏览器（如 Browser-Use / Playwright）不同，OpenWebBridge 寄生于用户日常使用的 Chrome 或 Edge 浏览器中，与本地守护进程（Daemon）在 `http://127.0.0.1:10087` 建立持久双工通信。

---

## 1. 核心特性优势

| 传统外部接管 (如 Browser-Use) | OpenWebBridge 宿主寄生模式 |
| :--- | :--- |
| 需关闭 Chrome 或启动临时新实例 | **常驻日常浏览器，随开随用，零重启** |
| 登录态隔离，需重新输入账密/扫码 | **原生继承用户所有登录态、Cookie、2FA 与内网权限** |
| 易与用户操作混杂，标签页混乱 | **自动建立彩色原生标签组（Tab Group），界限分明** |
| 传送整屏大图截图，巨量 Token 消耗 | **抽取 AXTree 语义树 (@e1, @e2)，结合 `--in-viewport` 节省 90% Token** |
| 遇到滑块/验证码任务直接失败挂死 | **内置 `handoff` 断点状态机，提示人类接管并在完成后自动恢复** |
| 仅支持单浏览器 | **支持多浏览器实例连接池（Chrome + Edge 并发，`--browser` 独立路由）** |

---

## 2. 工具能力矩阵 (Tools)

| 工具名称 | 核心参数 | 返回结构 | 核心说明 |
| :--- | :--- | :--- | :--- |
| `navigate` | `url`, `newTab` (bool), `group_title` | `{success, url, tabId}` | 导航到 URL。支持新建标签并自动归入彩色标签组 |
| `find_tab` | `url`, `active` (bool) | `{success, url, tabId, borrowed}` | 重选标签页；`active: true` 借调用户当前正看的页面 |
| `snapshot` | `inViewportOnly` (bool), `selector` (str) | `{url, title, tree, totalElements}` | 抽取 AXTree 无障碍树并生成 `@e` 编号引用；支持视口剪枝与容器限定 |
| `click` | `selector` (`@e1` 或 CSS 选择器) | `{success, tag, text}` | 自动居中滚动、派发可信/合成点击事件 |
| `fill` | `selector`, `value` | `{success, tag, mode}` | 支持原生输入框与 `contenteditable` 富文本编辑器（TipTap/ProseMirror等） |
| `evaluate` | `code` (JS 代码字符串) | `{type, value}` | 在页面上下文中安全执行 JS 脚本，返回真实值 |
| `screenshot`| `path`, `selector`, `quality` | `{format, path, sizeBytes, mimeType}` | 截图并**自动在本地磁盘落盘**，只返回文件路径，保护模型上下文 |
| `scroll` | `direction` (`up`\|`down`), `amount` (int) | `{success, scrollX, scrollY}` | 页面视口滚动控制 |
| `handoff` | `reason`, `selector`, `timeout` | `{status: "resolved"}` | 人机断点接管。遇到滑块或验证码时挂起并通知用户，用户操作完自动恢复 |
| `cdp` | `method`, `params` | raw JSON | 原始 Chrome DevTools Protocol (CDP) 逃生舱指令通道 |
| `list_tabs` | — | `{success, tabs: [...]}` | 枚举当前 Session 下受控的全部标签页 |
| `close_tab` | `tabId` (可选) | `{success, closed}` | 关闭当前活动标签或指定标签页 |
| `close_session` | — | `{success, closed: int}` | 一键关闭该任务所属的整个标签组并释放所有资源 |

---

## 3. 多浏览器路由机制 (`--browser`)

当系统内同时打开了多个浏览器（如 Chrome 和 Edge 均加载了扩展）时，Daemon 会自动维护连接池：

- **显式指定浏览器**：
  - 路由到 Chrome：`--browser chrome`
  - 路由到 Edge：`--browser edge`
  - 路由到特定实例：`--browser edge-2`
- **默认策略**：若不指定 `--browser`，系统将自动路由至**最近活跃（Most Recently Active）**的浏览器实例。
- **状态探测**：执行 `status` 命令即可查看当前所有在线浏览器及活跃浏览器：
  ```bash
  node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" status
  ```

---

## 4. Agent 调用指引（三种主流方式）

### 方式一：CLI 命令行（推荐 · 跨平台零字符损坏）

Agent 直接调用 CLI 工具。在 Windows 环境下无需担心 JSON 转义与中文字符编码问题：

```bash
# 1. 状态检查
node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" status

# 2. 导航并建立分组 (支持 --browser 指定目标浏览器)
node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" navigate https://github.com/trending --browser chrome --group-title "趋势调研"

# 3. 抽取视口内无障碍快照 (开启视口剪枝节省 Token)
node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" snapshot --in-viewport --browser chrome

# 4. 点击元素或填充输入框
node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" click "@e2" --browser chrome
node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" fill "@e5" "搜索关键词" --browser chrome

# 5. 网页全屏/局部截图 (自动落盘)
node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" screenshot "./output.png" --browser chrome

# 6. 人机接管断点 (遇到滑块/验证码时)
node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" handoff "检测到安全验证码，请在浏览器中完成滑动验证" --selector ".geetest_radar_tip"

# 7. 任务结束清理标签组
node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" close-session --browser chrome
```

---

### 方式二：HTTP API 接口 (`POST http://127.0.0.1:10087/command`)

与 `kimi-webbridge` 保持高度兼容的 REST 通信。

**Windows PowerShell 避坑规范**：
PowerShell 原生管线会破坏中文非 ASCII 字符编码，导致中文字符变成 `?`。
如果直接发起 HTTP 调用，请通过写临时 JSON 文件后调用 `curl.exe`：

```powershell
# 1. 写入临时请求体 (保持 UTF-8)
# 2. 调用 curl.exe 发送
curl.exe -s -X POST http://127.0.0.1:10087/command -H "Content-Type: application/json" --data-binary "@$env:TEMP\owb-req.json"
```

**请求格式：**
```json
{
  "action": "navigate",
  "args": {
    "url": "https://www.xiaohongshu.com",
    "newTab": true,
    "group_title": "小红书调研"
  },
  "browser": "edge",
  "session": "task-xhs-1"
}
```

---

### 方式三：Python / Node.js SDK

在批量脚本与高级 Agent 智能体中直接通过代码调用：

```python
from sdk.python.open_webbridge import OpenWebBridge

bridge = OpenWebBridge(port=10087, browser="chrome", session="my-session")
bridge.navigate("https://github.com", group_title="GitHub任务")
snap = bridge.snapshot(in_viewport=True)
print("当前元素：", snap["tree"])
bridge.close_session()
```

---

### 方式四：Model Context Protocol (MCP) 原生接入

OpenWebBridge 内置了针对 Claude Code / Cursor / Trae / Antigravity 的标准 MCP Server：

```bash
node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\cli\open-webbridge.js" mcp
```
在 MCP 客户端配置中直接将上述命令登记为 stdio 工具源，即可在 IDE 中直接获得 12 项浏览器原生工具。

---

## 5. 守护进程故障自愈与保活规范

1. **端口定义**：默认监听 `http://127.0.0.1:10087`（WebSocket: `ws://127.0.0.1:10087/ws`）。
2. **离线自拉起**：若调用报错 `connect ECONNREFUSED` 或探活返回非 `ok`，Agent 应当自动在后台启动守护进程：
   ```bash
   node "D:\Data\Documents\agent_recognition\kimi网桥\open-webbridge\daemon\index.js" start --port 10087
   ```
3. **扩展休眠保活**：由于 Chromium MV3 Service Worker 在空闲 30 秒后会自动进入挂起状态，Daemon 与扩展内置了 15 秒双向 Ping-Pong 保活机制，保持会话始终在线。
4. **扩展未安装/未连接**：若返回 `extension_not_connected`，提示用户在目标浏览器访问 `chrome://extensions/` 或 `edge://extensions/` 确认已加载 `extension` 目录。
