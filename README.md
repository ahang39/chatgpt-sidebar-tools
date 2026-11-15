# ChatGPT Sidebar Tools

[中文](#中文) · [English](#english)

## 中文

为 ChatGPT 原生侧边栏补充相对时间、可折叠日期分组、本地收藏与右键菜单快捷操作的 Tampermonkey 脚本。

旁读网页已有响应，**不增加网络请求**。当前脚本界面使用中文；本 README 提供中英文说明。

[安装脚本](https://raw.githubusercontent.com/ahang39/chatgpt-sidebar-tools/main/chatgpt-sidebar-tools.user.js) · [反馈问题](https://github.com/ahang39/chatgpt-sidebar-tools/issues) · [更新记录](CHANGELOG.md)

## 功能

- 标题在左、时间在右，显示“刚刚”“8分钟前”“2小时前”等相对时间；悬停查看完整时间。
- 仅右侧时间按四档呈现：1 小时内深色半粗，1～6 小时中深色中等字重，6～24 小时常规灰，24 小时以前更淡；深色主题反向调整亮度。标题保留原生颜色和字重，不改变菜单及状态指示器。
- 最近对话按“今天 / 昨天 / 最近一周 / 更多”分组，空分组隐藏，每组独立记住折叠状态。
- 置顶对话也显示时间，保留原生置顶顺序。
- 自定义收藏分组：默认“稍后再看”，支持新建、改名、折叠、移除收藏与删除分组，一条对话可以加入多个组。
- 右键点击侧边栏的对话行，打开该行原生菜单；其他区域及输入控件的右键行为不变。菜单仍锚定在原生按钮旁。
- 收到网页原生聊天响应时更新对应对话时间，不需要额外刷新列表。
- 保留原生链接、标题、菜单及项目区域。按会话 ID 关联数据，标题更新或重名不会串时间。

提供时间、分组与原生菜单快捷操作，不提供批量归档、删除、主动刷新或加载全部功能。

## 本地收藏

在侧边栏对话的原生菜单中选择“收藏到分组…”，在收藏区出现的行内编辑器中勾选一个或多个分组；也可以输入新分组名并保存。支持原生菜单按钮与右键入口。

收藏区位于“最近”上方。点击“收藏”标题可折叠或展开整个区域，刷新后保留；各分组的展开状态独立保存。使用加号图标新建分组，铅笔图标编辑分组；新建、改名、调整分组及删除确认都在侧边栏内完成，不打开弹窗。输入框支持 Enter 保存、Esc 取消。所有图标保留悬停说明和无障碍名称。删除分组和移除收藏都不删除 ChatGPT 对话。

支持鼠标将最近或置顶列表中的对话直接拖到收藏分组标题上，目标会高亮，松手后加入该组；目标组折叠时会自动展开。将收藏从一个组拖到另一个组，会移动该条分组关系，其他组中的收藏不受影响。拖到空白处或按 Esc 取消不会保存。此操作仅修改本地收藏，不移动到 ChatGPT 云端项目。

已加入任一收藏分组的对话会从“最近”隐藏，并从日期分组计数中扣除，取消最后一个分组后恢复。原生节点仍保留，不归档或删除；置顶区域不受影响。折叠收藏区和刷新网页后仍按此规则显示。收藏行悬停时显示调整分组及移除图标，也可右键调整分组。

收藏区折叠时，拖到「收藏」标题即可展开并继续拖入子分组。按 Esc 或拖到空白处取消时会恢复折叠状态。普通点击在页面内切换聊天，不整页跳转。网页已渲染该会话时，收藏行镜像原生行结构和样式，保留相对时间、未读蓝点、处理中标记与选中状态，并通过原生链接执行切换；不会移动 React 管理的原始节点。尚未渲染的收藏通过页面的 History 路由切换，只显示已有时间信息，不推测未读状态。浏览器后退、前进以及 Ctrl/Cmd 点击保留原有行为。

收藏区标题和图标按钮复用当前原生侧边栏样式类；菜单项复用原生菜单的样式类及实际字体、字号、行高与内边距。行内编辑期间，网页原生更新不会重建输入框或丢失草稿。

收藏子分组与“今天 / 昨天”等日期分组共用字体、颜色、字重和间距；收藏对话行与最近列表的原生对话行对齐，不添加额外缩进。

收藏保存于当前网站的 `localStorage`，按网页的账号标记和工作区请求头隔离；未识别到原生账号请求头前不显示收藏，不会主动探测登录。刷新和重启后保留，同浏览器的其他标签页会更新；写入使用 Web Locks 避免多标签页修改相互覆盖，需要支持此 API 的现代浏览器。

只保存分组、折叠状态、对话 ID、标题快照和分组关系。网页已返回新标题时，当前页会使用新标题显示；不会为刷新标题请求接口。清除网站数据后收藏会丢失，不跨浏览器、设备或域名同步，也不备份聊天正文。原对话删除后，收藏入口不能恢复它。

存储配额不足、写入被禁用或数据格式异常时会明确提示；格式异常的数据不会被自动重置覆盖。

## 安装

1. 在浏览器中安装并启用 [Tampermonkey](https://www.tampermonkey.net/)。
2. 点击[安装脚本](https://raw.githubusercontent.com/ahang39/chatgpt-sidebar-tools/main/chatgpt-sidebar-tools.user.js)，在脚本管理器中确认安装。
3. 重新打开 ChatGPT 页面。

如果链接只显示源码，在 Tampermonkey 中新建脚本，用 [`chatgpt-sidebar-tools.user.js`](chatgpt-sidebar-tools.user.js) 的完整内容替换模板并保存。

升级旧版时请替换原脚本，只启用一份。已打开的页面不会自动卸载旧代码，需要关闭后重开或完整刷新。支持域名为 `chatgpt.com` 和 `chat.openai.com`；本项目不依赖外部运行时库，无需构建即可安装。

## 时间从哪里来

脚本旁读 ChatGPT 网页本来就会发出的同源 `fetch` 响应：

| 原生响应 | 用途 |
| --- | --- |
| `GET /backend-api/conversations`，未归档列表 | 对话时间与最近列表分组 |
| `GET /backend-api/pins` | 置顶对话时间 |
| `GET /backend-api/conversation/{id}` | 已打开对话的时间 |
| `POST /backend-api/conversation`、`/backend-api/f/conversation` 及其 `/resume` | 聊天过程中的时间更新 |

优先使用对话的 `update_time`，缺失时使用 `create_time`。置顶响应从 `item` 读取对话时间，不将 `pinned_at` 当成聊天时间。聊天流没有服务端时间时，使用本页实际收到消息的时刻，并在悬停提示中明确标注。

日期分组依据浏览器本地时区：“最近一周”包含今天之前第 2～6 天，其余更早对话放入“更多”。分组及计数只覆盖原生页面已经渲染的对话。

## 隐私与请求边界

**脚本主动网络请求数为 0。** 不获取访问令牌、不读取登录接口、不主动请求详情，不轮询、翻页、刷新、重试，也不发送归档或删除请求。没有统计、遥测或第三方资源加载。

- 原生请求仍只转发一次，保留参数、原始 Promise 和响应；旁读聊天流不会消费网页自己的响应流。
- 时间元数据只留在当前页面内存中，聊天正文不落盘、不外传；流解析仅使用有大小上限的缓冲。
- 本站 `localStorage` 保存日期分组折叠偏好及上述收藏元数据。工作区切换时清空内存时间数据，切换对应收藏并关闭编辑窗口，忽略旧请求的迟到结果。
- 每 30 秒按本地时钟更新相对时间文字和分组，此定时器不访问网络。

## 已知限制

- **网页没有返回时间时，时间就可能暂时为空。** 原生数据来自缓存、脚本启动较晚或网页被限流时，不会为了补时间额外请求。
- 完全没有时间数据时保留原生列表，不添加假分组；部分对话时间未知时暂放“更多”。
- 其他设备上的活动需等待网页自己的响应提供新数据，脚本不会主动同步。
- ChatGPT 内部接口及 DOM 可能变化，本项目不是 OpenAI 官方产品，也不承诺适配未来所有网页版本。
- 分组使用 CSS 视觉排序，不移动 React 管理的节点，键盘遍历仍沿用原生 DOM 顺序。原生滚动加载也由网页决定。
- 当前自动验证使用隔离的模拟页面，不能替代不同浏览器、脚本管理器及真实网页的安装验证。

## 开发与验证

需要 Node.js 22 或更新版本。

```sh
git clone https://github.com/ahang39/chatgpt-sidebar-tools.git
cd chatgpt-sidebar-tools
npm ci
npx playwright install chromium
npm run test:all
```

开发依赖只用于测试，不随用户脚本运行。Linux 环境可用 `npx playwright install --with-deps chromium` 安装所需浏览器系统依赖。

```text
chatgpt-sidebar-tools.user.js  可直接安装的单文件脚本
tests/core.test.cjs            时间、分组与响应解析测试
tests/browser.test.cjs         隔离页面的 DOM、流式响应和请求次数验证
.github/workflows/ci.yml       GitHub Actions 检查
```

测试覆盖零主动请求、429 不重试、聊天流增量、置顶响应、标题节点替换、会话节点复用、工作区切换、折叠记忆、左右布局，以及收藏刷新保留、多分组、整体折叠、原生菜单排版、鼠标拖入与组间移动、取消拖拽、存储错误、多标签页并发写入和键盘入口。可通过 `SCREENSHOT_DIR=tests/artifacts npm run test:browser` 输出模拟页面截图。

参与贡献及问题反馈要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

项目代码使用 [MIT License](LICENSE)。内嵌 Lucide chevron-right 图标及 Feather 衍生部分的授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，相关声明也包含在单文件脚本中。

---

## English

A Tampermonkey userscript that adds relative timestamps, collapsible date groups, local collections, and context-menu shortcuts to ChatGPT's native sidebar. It observes existing page responses and makes **no additional network requests**. The script UI currently uses Chinese labels; this README is bilingual.

[Install userscript](https://raw.githubusercontent.com/ahang39/chatgpt-sidebar-tools/main/chatgpt-sidebar-tools.user.js) · [Report an issue](https://github.com/ahang39/chatgpt-sidebar-tools/issues) · [Changelog, Chinese](CHANGELOG.md)

### Features

- Conversation titles stay on the left and relative timestamps on the right. Hover over a timestamp to see the full date and time.
- Only timestamps change color and weight with age: under 1 hour, 1–6 hours, 6–24 hours, and older. Dark mode uses corresponding brightness levels; native title and status styling is preserved.
- Recent chats are grouped into Today, Yesterday, Past week, and Older. Empty date groups are hidden, and collapse preferences persist.
- Pinned chats also show timestamps and retain their native order.
- Local collections support multiple memberships, custom groups, renaming, collapsing, removal, and drag-and-drop.
- Right-click a native sidebar conversation to open its native menu. Other areas and editable controls retain their normal context menus; native menus remain anchored to their original buttons.
- Existing native chat responses update timestamps without refreshing the conversation list. Data is associated by conversation ID, so duplicate or changing titles do not mix up timestamps.

There is no bulk archive, deletion, active refresh, or “load all” feature.

### Local collections

Choose **收藏到分组…** (Add to collection…) in a native conversation menu. An inline editor in the sidebar lets you select one or more groups or create a new one.

The **收藏** (Collections) section appears above Recents. Click its heading to collapse the entire section; each child group also remembers its own collapse state. Use the plus icon to create a group and the pencil icon to rename or delete one. Creation, membership changes, and deletion confirmation happen inline, without dialogs. Press Enter to save or Escape to cancel. Icons have tooltips and accessible names. Removing a bookmark or deleting a group does not delete a ChatGPT conversation.

Drag a conversation from Recents or Pinned onto a group heading. When Collections is collapsed, drag over its heading to reveal the groups. Canceling restores the previous collapse state. The target highlights and expands after a successful drop. Dragging a bookmark between groups moves only that membership and preserves its other memberships. Drop outside a group or press Escape to cancel. These operations change local collections only; they do not move conversations into ChatGPT cloud projects.

Collected conversations are hidden from Recents and excluded from date-group counts. Removing their final collection membership restores them to Recents. The original native nodes remain in place, and pinned chats are unaffected. This display rule survives reloads and collapsing Collections. Hover over a bookmark for membership and removal icons, or right-click it to adjust its groups.

Clicking a bookmark switches chats within the page. For conversations already rendered by ChatGPT, collection rows mirror native markup and styling, including timestamps, unread dots, processing indicators, and selection state; clicks are forwarded to the original native link. React-managed nodes are not moved. Bookmarks not currently rendered use the page's History routing, show only known timestamps, and do not invent unread status. Back, forward, and Ctrl/Cmd-click retain their normal behavior.

Collection headers and icon buttons reuse native sidebar classes. The added native-menu entry also reuses the menu's actual typography and spacing. Child collection headings share the date groups' typography, colors, and spacing, while conversation rows align with native Recents rows. Native updates do not rebuild an active inline input or discard its draft.

Collections are stored in this site's `localStorage`, scoped by the page's account marker and workspace request header. They appear only after a native request identifies the account; the script never probes login state. Data survives reloads and browser restarts. Other tabs in the same browser receive updates, and Web Locks coordinate concurrent writes, requiring a modern browser that supports this API.

Stored data includes group names, collapse preferences, conversation IDs, title snapshots, and memberships. Updated titles already received by the page are used for display without additional requests. Clearing site data removes collections. They do not sync across browsers, devices, or domains and do not back up chat contents. A bookmark cannot restore a deleted conversation. Storage failures are shown inline; malformed data is never silently reset or overwritten.

### Installation

1. Install and enable [Tampermonkey](https://www.tampermonkey.net/).
2. Open [the userscript](https://raw.githubusercontent.com/ahang39/chatgpt-sidebar-tools/main/chatgpt-sidebar-tools.user.js) and confirm installation in your script manager.
3. Reopen ChatGPT.

If the link displays source code, create a new Tampermonkey script, replace its template with the full contents of [`chatgpt-sidebar-tools.user.js`](chatgpt-sidebar-tools.user.js), and save.

When upgrading, replace the existing script and keep only one copy enabled. Reopen or fully reload existing ChatGPT tabs to unload the previous code. Supported domains are `chatgpt.com` and `chat.openai.com`. No build or external runtime library is required.

### Timestamp sources

The script passively observes same-origin `fetch` responses already requested by ChatGPT:

| Native response | Purpose |
| --- | --- |
| `GET /backend-api/conversations`, unarchived list | Conversation timestamps and Recents date groups |
| `GET /backend-api/pins` | Pinned conversation timestamps |
| `GET /backend-api/conversation/{id}` | Timestamps for an opened conversation |
| `POST /backend-api/conversation`, `/backend-api/f/conversation`, and their `/resume` variants | Timestamp updates during chat |

`update_time` takes precedence over `create_time`. Pinned records use the conversation inside `item`, rather than `pinned_at`. If a chat stream contains no server timestamp, the script uses the local receipt time and labels it explicitly in the timestamp tooltip.

Date groups use the browser's local timezone. Past week includes days 2–6 before today; earlier conversations go into Older. Counts and date grouping cover only conversations rendered by the native page.

### Privacy and network boundaries

**The script initiates zero network requests.** It does not retrieve access tokens, probe authentication, request conversation details, poll, paginate, refresh, retry, archive, or delete. There is no analytics, telemetry, or third-party resource loading.

- Native requests are forwarded once, preserving arguments, original promises, and responses. Reading a cloned chat stream does not consume the page's own response.
- Timestamp metadata stays in page memory. Chat contents are not persisted or transmitted; stream parsing uses bounded buffers.
- Site-local `localStorage` holds date-group collapse preferences and the collection metadata described above. Workspace changes clear in-memory timestamps, switch collection scope, close inline editors, and ignore late responses from the previous scope.
- A local timer updates relative labels and grouping every 30 seconds without accessing the network.

### Limitations

- Timestamps may remain blank until ChatGPT supplies them. Cached data, late script injection, and rate limiting never trigger extra requests to fill gaps.
- With no timestamp data, the native list is retained without fabricated date groups. Individual conversations with unknown times appear under Older.
- Activity on another device appears only when the page itself receives updated data.
- ChatGPT's internal APIs and DOM can change. This is an unofficial project and cannot guarantee compatibility with every future page version.
- Date ordering is visual CSS ordering. React-managed nodes remain in place, so native DOM keyboard order and native scroll loading still apply.
- Automated validation uses isolated fixtures, which do not replace installation testing across real browsers, script managers, and ChatGPT versions.

### Development and validation

Requires Node.js 22 or newer.

```sh
git clone https://github.com/ahang39/chatgpt-sidebar-tools.git
cd chatgpt-sidebar-tools
npm ci
npx playwright install chromium
npm run test:all
```

Development dependencies are used only for testing. On Linux, use `npx playwright install --with-deps chromium` when browser system dependencies are needed.

| File | Purpose |
| --- | --- |
| `chatgpt-sidebar-tools.user.js` | Installable single-file userscript |
| `tests/core.test.cjs` | Timestamp, grouping, validation, and response-parser tests |
| `tests/browser.test.cjs` | Isolated DOM, streaming, navigation, and request-count tests |
| `.github/workflows/ci.yml` | GitHub Actions checks |

Tests cover zero active requests, unchanged 429 responses, streaming updates, pinned metadata, renamed/recycled title nodes, workspace isolation, collapse persistence, layout, collections, native status indicators, inline editing, in-page navigation, drag-and-drop, storage errors, cross-tab writes, and keyboard access. Run `SCREENSHOT_DIR=tests/artifacts npm run test:browser` to generate fixture screenshots.

See [CONTRIBUTING.md, Chinese](CONTRIBUTING.md) for contribution and issue-reporting guidance. Reports should include versions, reproduction steps, and redacted screenshots. Never submit cookies, tokens, request headers, full HAR files, or chat contents.

### License

Project code is licensed under the [MIT License](LICENSE). Attribution for the embedded Lucide chevron-right icon and its Feather-derived parts is included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and in the standalone userscript.
