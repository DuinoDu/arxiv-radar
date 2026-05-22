# Paper Chat AI 回复不自动更新问题

## 现象

在 paper chat 页面里，用户发送消息后，AI 的最终回复不会自动出现在聊天列表里。手动刷新页面后，回复可以正常显示。

这说明消息已经成功写入 Conductor 的 task history，但实时更新链路没有把最终 AI 消息送进前端的 `ChatProvider` state。

## 当前链路

- `src/components/arxiv/PaperChat.tsx` 使用 `@love-moon/app-sdk/react` 的 `ChatProvider`。
- `ChatProvider` 首屏通过 adapter 的 `fetchHistory()` 读取历史消息。
- 实时更新通过 adapter 的 `subscribe()` 连接 `/api/conductor/tasks/:taskId/events`。
- `/api/conductor/[...path]/route.ts` 里的 SSE route 使用 `client.tasks.subscribe(taskId)` 转发 Conductor 事件。
- SDK 的 React reducer 只有收到 `message_appended` 或 `message_updated` 才会更新消息列表。

## 初步判断

刷新页面能看到 AI 回复，说明 `GET /api/conductor/tasks/:taskId/messages` 返回的 history 是完整的。

不自动更新，说明实时 SSE 流里没有送达最终 AI 回复的 `message_appended` 事件，或者 Conductor 发出的最终回复 envelope 没有被 `@love-moon/app-sdk/server` 映射成 `message_appended`。

当前 SDK server 侧只把这些 envelope 映射成消息：

- `task_user_message`
- `task_sdk_message`

如果实际最终 AI 回复使用了其他 envelope 类型，或者只通过 runtime status / history 持久化呈现，那么前端就只能在刷新后通过 history 看到。

## 为什么不是 MessageList 渲染问题

项目自定义的 `src/components/arxiv/chat/MessageList.tsx` 是从 `useChat().state.messages` 读取数据。

`ChatProvider` 收到 `message_appended` 后会 dispatch 到同一个 state。因此只要 SSE 事件进入 `ChatProvider`，自定义列表会渲染出来。

现在刷新后能显示，实时不能显示，更符合“缺实时 append 事件”而不是“组件没重渲染”。

## 建议修复方案

优先在 `PaperChat.tsx` 的 adapter 层包一层 `createRestAdapter()`，不要改 `node_modules`。

思路：

1. 保留现有 REST adapter。
2. 包装 `subscribe(taskId, handler)`。
3. 正常转发所有 SSE event。
4. 当收到 `task_finished`，或收到 `runtime_status` 且 `replyInProgress === false` 时，延迟拉一次 `fetchHistory(taskId, { limit: 20 })`。
5. 把 history 里的消息作为 `message_appended` 重新喂给 `ChatProvider`。
6. SDK reducer 已经按 message id 去重，所以重复 append 通常安全。

这样可以把“实时事件缺最终消息”的问题局部兜底在 paper chat 页面，不影响 Conductor BFF 的其他调用。

## 可能存在的问题

- **重复消息风险**：如果 SSE 本来发了最终 `message_appended`，history backfill 又发一次同 id 消息。当前 SDK reducer 会按 id 去重，风险较低。
- **时序风险**：`task_finished` 到 history 持久化完成之间可能有短暂延迟。需要延迟 300-800ms 后拉 history，必要时重试一次。
- **过早 catch-up 风险**：某些 runtime status 可能短暂出现 `replyInProgress === false`，但任务还没真正完成。应只在状态明确结束时触发，或加防抖。
- **无 id 去重依赖**：如果 Conductor 对同一条最终回复在 SSE 和 history 中给出不同 id，前端可能仍重复显示。需要实际观察 event payload。
- **额外请求成本**：每轮 AI 回复完成后会多一次 history 请求。paper chat 使用频率较低，成本可接受。
- **漏补历史窗口**：如果一次回复产生多条 assistant 消息，`limit: 20` 通常足够；后续如果消息量异常，应按需要提高 limit。
- **错误可见性**：如果 catch-up fetch 失败，最好只 `console.warn`，不要影响用户当前聊天状态。

## 验证方式

1. 打开浏览器 Network，观察 `/api/conductor/tasks/:taskId/events`。
2. 发送一条消息，等待 AI 完成。
3. 检查 SSE 中是否出现最终 AI 回复的 `message_appended`。
4. 同时检查 `/api/conductor/tasks/:taskId/messages` 是否已经包含该回复。
5. 修复后，确认不刷新页面也能显示 AI 回复。
6. 再确认刷新后没有重复消息。

## 相关文件

- `src/components/arxiv/PaperChat.tsx`
- `src/components/arxiv/chat/MessageList.tsx`
- `src/app/api/conductor/[...path]/route.ts`
- `node_modules/@love-moon/app-sdk/dist/react/index.js`
- `node_modules/@love-moon/app-sdk/dist/server/index.js`
