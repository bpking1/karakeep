# EnglishCD 阅读学习接入

## 已确认范围（2026-09-16）

Android 移动端对齐 MiniReader 的英语阅读功能。第一版只覆盖网页书签的 Reader 阅读模式，线上正文和现有离线正文共用。原始网页、PDF、截图、归档和 Markdown 文本书签暂不接入。保留 Karakeep 的批注、图片预览、链接和阅读进度。

按顺序完成：

1. 独立设置、连接检查、单词和已收藏短语高亮、原生词卡。
2. 选区查词、翻译和收藏，保留复制、长按及选区调整。
3. 本文词汇统计、搜索/状态/词典标签筛选、跨筛选选择、批量状态、加入学习和每轮最多 20 词的回忆练习。
4. 「导入英语」正文预览、编辑标题/正文、明确确认入库和打开资料。

本文词汇和导入放在已有底栏更多菜单，不新增工具栏。界面复用移动端 Button/Input/Text 和原生弹层，不引入 ArkUI 或 Web shadcn 控件。

## 职责与复用

- `lib/englishcd/types.ts`：现有 HTTP 契约的窄客户端类型，参考 EnglishCD OpenAPI，不新建 BFF。
- `lib/englishcd/client.ts`：唯一 EnglishCD 网络入口，独立 Bearer、超时、原始错误、幂等请求；不可用时不阻塞普通阅读。
- `lib/englishcd/settings.ts`：独立 SecureStore 配置，不复用 Karakeep API Key/customHeaders。Token 不进入 DOM、URL、日志或持久化查询键。
- `lib/englishcd/reading*`：纯提词/快照/筛选和 DOM 装饰，借鉴 EnglishCD shared/reading、phrases、study-words。保留来源说明和规则对照测试，不跨仓库运行时 import。
- `components/englishcd/`：原生词卡、词表和导入面板，各自维护异步生命周期，不建立万能服务。
- 阅读页局部上下文连接正文与 BottomActions；顶层异步函数 props 桥接 DOM。DOM 不接受任意 API 路径，不决定来源身份。
- 共享 BookmarkHTMLHighlighter 只增加必要的通用扩展点，不依赖 EnglishCD。生词不是 Karakeep 批注，不写回 HTML，不改变文字顺序。批注重建后重新装饰，避免 observer/渲染循环。

## 状态和留存

词键、词形、词典标签和掌握状态由 EnglishCD 决定；只有 known 计掌握，ignored 不计掌握。短语仅高亮已收藏项，不扫描完整词典。高亮批量提词后查询，每批最多 500，不发送整篇正文、不调用 AI 或上报查阅。

明确打开词卡才上报一次查阅。先读已保存查词结果，明确无记录且服务开启才自动查词一次；读失败不能视作无记录，生成失败不自动重试。AI 请求只带有界原句；AI 加载不阻塞掌握、收藏或关闭。普通翻译手动触发且不保存。收藏预览不自动 AI。

状态修改刷新本篇和词卡；重新回到前台刷新状态。请求合并/短期内存缓存按 EnglishCD 连接隔离，换连接与切篇丢弃旧结果。第一版不持久化学习查询，不复用 Karakeep 默认成功 query 落盘策略，不做离线写入重放。

本文词表按完整当前正文独立建立，不复用有扫描上限的高亮清单；最多 2 MiB、5000 不同词形和 100000 次出现，超限说明原因，不悄悄截断。勾选以服务器 termKey 保存，切标签不清空。加入学习复用 `/vocabulary/learning`，known/ignored 的保护由后端事务决定，练习翻面/下一词不自动改掌握、不自动查词或评分。

只在明确确认「导入英语」后发送全文；Karakeep 已保存文章不代表授权复制到 EnglishCD。收藏只发摘录、必要语境及来源。来源使用 kind=karakeep、真实书签 ID/URL/标题；不由正文指定服务地址或密钥。收藏/导入固定同一载荷的幂等键，手动重试复用，编辑后换键。导入可能触发服务器已配置的自动总结，预览中说明。

## 选区与平台约束

Expo 56 `use dom` 默认使用 @expo/dom-webview。首版优先扩展已有划线弹层的明确动作，保留系统原有复制和拖动；不为菜单强行替换底层 WebView。若后续使用 react-native-webview 自定义原生菜单，其菜单会替换默认动作，必须另行确认并实机验证。点词只响应短按高亮，不截获滚动、长按、链接或选区拖动。

## 验证与交付

按功能提交并推送；开始时工作树干净，不创建空检查点。纯函数、请求契约和生命周期使用隔离单元测试，执行改动范围格式、静态和 TypeScript 检查。沿用仓库 pnpm，不改锁文件管理器。不新增/运行端到端，不启动真实服务或调用付费模型。

TypeScript 通过不等于 Android/Metro 构建或真机通过。单独记录未执行的 Android 构建、WebView 手势/菜单、网络连接与设备验收。

## 实施进度

- 设计已确认，实现进行中。
- Android 构建及真机验收：待完成，不以纯逻辑测试代替。
