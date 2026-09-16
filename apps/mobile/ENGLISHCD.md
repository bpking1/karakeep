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

- 设置、单词/收藏短语高亮、原生词卡、选区查词/翻译/收藏已接入 Reader。词卡/原生接口/DOM 共 46 项隔离测试通过，范围 Oxlint、Oxfmt、diff 检查通过。
- 本文词汇已接入更多菜单：完整词表、标签统计/筛选、跨筛选选择、批量状态、后端保护性加入学习及 20 词分轮回忆。8 项词表/练习纯逻辑测试通过，词卡叠层不卸载词表和练习状态。
- 导入英语已接入更多菜单：预览完整正文、编辑标题/正文、明确确认上传、同载荷手动重试幂等和成功资料链接。2 项导入纯逻辑测试通过，正文校验与本文词表复用 reading 的纯函数。
- 共享阅读器补 3 项真实 React 19 隔离测试：稳定 innerHTML 防止弹层重渲染丢失批注/高亮，重复选区通知保留未保存笔记和颜色，未启用学习的 Web 入口无额外学习菜单/监听。
- 最终共 59 项隔离测试通过；完整移动端 TypeScript、31 个相关文件的 Oxlint/Oxfmt、diff 检查通过。依赖使用原 pnpm 锁，首次下载超时后重试成功。
- Expo Android JS/Hermes 和阅读 DOM 双 bundle 导出成功；未生成 APK、未运行 Android 原生编译或真机测试。无端到端、无个人后端/真实 AI 调用。

## 使用与开发验证

1. 在设置 → **EnglishCD 英语学习**填写服务器根地址和 EnglishCD Key（不是 Karakeep Key），测试连接、选择高亮词典标签、启用并保存。支持已有的 HTTP home server 网络配置。
2. 打开网页书签，切到 **Reader**。高亮词短按打开原生卡片；长按选区后在已有批注弹层中选择查词、翻译或收藏。正文更新、切篇或换连接会丢弃旧会话。
3. 底栏更多 → **本文词汇学习 / 导入英语**。未配置时显示禁用入口；PDF、原始网页等非 Reader 模式不显示这些操作。
4. 导入后的浏览器链接不携带 Key，浏览器需独立连接 EnglishCD。后端需要包含 `/vocabulary/learning` 等当前接口；如果出现路由级 404，检查运行的后端二进制版本，不修改客户端伪装成功。

```sh
pnpm --filter @karakeep/mobile test:englishcd
pnpm --filter @karakeep/mobile typecheck
```

学习代码不会自动保存文章副本或重放离线写入。当前 WebView 不支持 CSS Custom Highlight 时会明确提示，选区、词表与显式导入仍可用；可更新 Android System WebView 后再验证高亮。真机重点确认：长按复制和选区拖动、原批注保存、点词与链接互不抢手势、词卡外部关闭后回到练习原位置、手机键盘与弹层布局。

## GitHub Actions APK 与长期分支

英语学习改动和独立 APK 流程维护在 `feature/englishcd-mobile`。该分支从已有英语学习提交之后创建；此前已推送到 `main` 的提交保持原样，不改写远端历史。后续自己的功能提交到这个分支，上游更新通过 merge 合入，原来的商店发布工作流不改动。

- 每次 push `feature/englishcd-mobile`，触发 [EnglishCD Android APK](../../.github/workflows/mobile-apk.yml)。同分支有新提交时取消旧构建，避免重复消耗。
- 安装锁定依赖，执行移动端 TypeScript 和 EnglishCD 单元测试，通过 Expo prebuild + Gradle `assembleRelease` 生成 APK；不调用 EAS、不需要 Expo/Sentry Token、不跑端到端。
- SDK 初始化显式指定 `packages: platform-tools`，覆盖锁定版 setup-android 中包含旧 `tools` 包的默认值；命令行工具由 Action 安装，SDK 36、Build Tools、NDK 和 CMake 继续由后续步骤安装。首次运行在默认 `tools` 包不存在处失败，不是 App 代码编译错误。
- 包名 `app.hoarder.hoardermobile.dev`，名称 `Karakeep (Dev)`，仅 ARM64 手机。虽然使用 development 名称，构建类型是 Release，内置 JS/阅读器资源，不需要 Expo Go 或 Metro。
- 使用 Expo 模板附带的公开测试签名，仅供个人测试，不用于商店发布或可信正式分发。与官方版并装，首次安装需重新登录 Karakeep、配置 EnglishCD。后续模板签名未变时可以覆盖更新；将来更换签名需迁移或重装，卸载会清掉本地配置。
- 构建成功后打开仓库 **Actions → EnglishCD Android APK → 对应运行 → Artifacts**，下载 `karakeep-englishcd-arm64-运行序号`，解压安装 `app-release.apk`。产物保留 14 天，下载需登录 GitHub。
- Fork 若禁用 Actions，先在仓库 Actions 页启用，再向该分支 push。工作流虽然声明 `workflow_dispatch`，但 GitHub 要求其存在于默认分支才支持手动触发；仅放在功能分支时，以 push 触发为准，已有运行可用 **Re-run jobs** 重跑。不为显示手动按钮修改默认分支或污染 `main`。

同步上游示例（`upstream` 只需配置一次；先确认本地工作区干净）：

```sh
git remote add upstream https://github.com/karakeep-app/karakeep.git
git fetch upstream
git switch feature/englishcd-mobile
git merge upstream/main
git push origin feature/englishcd-mobile
```

本轮已通过 actionlint、YAML 解析/格式与 diff 检查、完整移动端类型检查、59 项单元测试和 Android prebuild；生成的包名、Release 签名、HTTP 网络配置已核对，prebuild 未改变 package.json 或锁文件。本机仍未安装 Android SDK/JDK；APK 原生编译是否通过，以 Actions 实际运行结果为准，不以配置已提交代替成功产物。
