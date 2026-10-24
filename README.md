# ChatGPT Sidebar Tools

为 ChatGPT 原生侧边栏补充相对时间与可折叠日期分组的 Tampermonkey 脚本。

A small userscript that adds relative timestamps and collapsible date groups to ChatGPT's native sidebar. It observes existing responses and makes **no additional network requests**. The current UI uses Chinese labels.

[安装脚本](https://raw.githubusercontent.com/ahang39/chatgpt-sidebar-tools/main/chatgpt-sidebar-tools.user.js) · [反馈问题](https://github.com/ahang39/chatgpt-sidebar-tools/issues) · [更新记录](CHANGELOG.md)

## 功能

- 标题在左、时间在右，显示“刚刚”“8分钟前”“2小时前”等相对时间；悬停查看完整时间。
- 最近对话按“今天 / 昨天 / 最近一周 / 更多”分组，空分组隐藏，每组独立记住折叠状态。
- 置顶对话也显示时间，保留原生置顶顺序。
- 收到网页原生聊天响应时更新对应对话时间，不需要额外刷新列表。
- 保留原生链接、标题、菜单及项目区域。按会话 ID 关联数据，标题更新或重名不会串时间。

仅保留时间与分组，不提供批量归档、删除、主动刷新或加载全部功能。

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
- 会话元数据只留在当前页面内存中，聊天正文不落盘、不外传；流解析仅使用有大小上限的缓冲。
- 本站 `localStorage` 只保存分组折叠偏好。工作区切换时清空内存时间数据，并忽略旧请求的迟到结果。
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

测试覆盖零主动请求、429 不重试、聊天流增量、置顶响应、标题节点替换、会话节点复用、工作区切换、折叠记忆及左右布局。可通过 `SCREENSHOT_DIR=tests/artifacts npm run test:browser` 输出模拟页面截图。

参与贡献及问题反馈要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

项目代码使用 [MIT License](LICENSE)。内嵌 Lucide chevron-right 图标及 Feather 衍生部分的授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，相关声明也包含在单文件脚本中。
