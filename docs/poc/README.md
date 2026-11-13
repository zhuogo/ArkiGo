> 此文记录早期 POC 快照。当前 Skill 1.0 已增加有界 query、程序 diff 与候选 apply，并支持独立安装；最新验收见 [Skill 记录](../07-Skill验收.md)。以下“未安装/未实现”指当时阶段。

# ArkiGo POC 与画布引擎

2026-11-13：根据用户提供的 `E:/BenchGo/docs/总架构.html`，先落实可复用的空间画布引擎。分区、卡片和连线构成主要阅读空间，目录与详情按需打开。BenchGo 仅作为样式及交互参考，未修改其文件。

## 先体验画布引擎 v1

用浏览器直接打开 HTML，无需服务器、构建或联网。

| 示例 | 体验入口 | 输入 |
| --- | --- | --- |
| **用户注册** | [先打开注册画布](./canvas-engine/registration.html)，保留系统全景 → 用户模块 → 用户注册 → 创建用户记录四级结构 | [registration.canvas.json](./canvas-engine/registration.canvas.json)，待审阅示例设计，不代表已实现代码 |
| ArkiGo 引擎架构 | [打开画布](./canvas-engine/index.html)，总架构 / 生成流程 / 交互机制 | [arkigo.canvas.json](./canvas-engine/arkigo.canvas.json)，本轮源码的局部架构抽象，待审阅 |
| 任务清单设计 | [打开画布](./canvas-engine/tasks.html)，总架构 / 新增任务流程 | [tasks.canvas.json](./canvas-engine/tasks.canvas.json)，AI 演示建议，不是用户真实需求 |

三份数据使用同一个生成器和浏览器运行时。分区数量、节点数量、位置、关系和视图均来自 JSON。注册示例的页面标题为“用户注册”，突出四级模块导航；任务清单的新增流程采用横向主线和下方异常分支，展示不同的布局编排。AI 负责读取、分析和组织输入，生成器不自动扫描仓库。走读界面与执行行为已移除；旧 `walkthrough` 字段保留兼容校验但不展示或执行，新输入可写空数组，其他 Schema 字段不变。

本轮按用户指定的 `skills-emilkowalski` 中的 `emil-design-eng` 规范调整了公共界面，包含按压反馈、固定面板头部、状态提示、拖动性能和触屏细节，见 [实现与界面约定](./canvas-engine/README.md)。规范已体现在模板中，之后生成只需输入数据。

建议先试：

1. 打开注册画布，选中“用户模块”，点击“进入模块”、双击或继续放大；再进入“用户注册”和“创建用户记录”。
2. 像浏览文件夹一样点击上一级或任意祖先面包屑返回，也可缩小或使用 `Alt+Left`，检查父级相机与模块选中恢复；56px 页头没有独立返回箭头、Tabs 或选择框。
3. 拖动一个节点，观察连线重绘，刷新页面检查布局恢复；重叠落点会回到拖动前的位置。
4. 点击顶部搜索图标打开节点目录，搜索并定位内容；在任务清单中进入“任务创建”，看成功与失败分支。详情、来源和关联对象按需打开。
5. 点击浅色/深色图标切换主题；首次打开跟随系统，手动选择在浏览器存储可用时本地记忆。需要保留布局时，打开搜索目录，在底部点“导出布局”，再用 `--layout` 重新生成。

滚轮/双指一次手势最多跨一级；进入/返回用 230ms 空间展开/收回，键盘和减少动态效果时立即完成。当前每次渲染一层，尚未实现全层同时 LOD、关系聚合或复杂图自动排版，也未承诺无限图性能。拖动只调整坐标，内容修改仍由 AI 编辑 JSON 后重新生成。浏览器存储依赖当前环境；导出布局可作为显式保留方式。来源显示为可复制文本。

## 两种 Skill 入口的原始建模实验

下列模型保留，并已使用新引擎重新生成；它们验证从想法和已有代码整理设计的两种输入。

| 入口 | 输入 | 产物 |
| --- | --- | --- |
| 尚无系统，只有想法 | [任务清单演示需求](./new-system/request.md)，AI 演示需求 | [画布](./new-system/canvas.html) · [模型](./new-system/model.json)，14 个对象 |
| 已有系统，想深入理解 | 用户选择 ArkiGo；仅观察 validate 命令，[范围说明](./existing-system/request.md) | [画布](./existing-system/canvas.html) · [模型](./existing-system/model.json)，18 个对象 |

已有系统的具体来源见 [sources.json](./existing-system/sources.json)，记录当时读取文件的 SHA-256。模型是人工阅读与抽象产物；渲染命令不会重新读代码或刷新来源。源码中观察到“分支异常检查只强制多出口步骤”的行为，已保留为待决策问题，没有擅自扩大校验范围。

## 已执行的验证

本轮已通过浅色/深色切换、纯图标搜索、文件夹式面包屑导航，以及移除走读和独立返回箭头的回归。主题检查包含首次跟随系统、双向切换、刷新首帧记忆、手动覆盖系统和存储不可用。

- 此前 Node 自动测试 **84 项通过**：原校验器、画布 Schema/引用/布局、单根层级与导航投影门槛、模型适配、避障折线、自环、标签选择、相机变换、布局回放、JSON 保真、文本安全与 CLI 错误时保留产物。
- 此前模块导航的 10 项浏览器场景通过：四级往返、滚轮/双指自动进退与单手势一级、父级相机/焦点恢复、有效及损坏深链、过渡中断、键盘与减少动态效果、窗口变化、卡片上双指缩放、取消拖动不保存、手机导航，以及跨层逐帧检查旧画面不回闪。报告在 `.artifacts/canvas-engine/semantic/results.json`。
- 本轮 Python Playwright + 无界面 Chromium 的基础回归通过：离线画布、深链导航、详情、关系高亮、来源、搜索、节点拖动与路径变化、重叠恢复、刷新保存、导出、重置、鼠标位置缩放、平移、键盘。
- 已检查 1440×1000 桌面、320/375px 小屏幕与深色模式的截图，深层路径和模块操作栏在手机宽度下可见；小屏幕全景缩小用于定位，通过聚焦或缩放阅读。未测量百节点规模性能。
- 已检查数据中的脚本字符串保持普通文本、浏览器存储被禁用时仍可显示。页面加载未出现脚本错误，未请求网络资源。
- 已检查键盘无过渡、减少动态效果、按钮按压反馈、长详情头部固定、手机导出及触控模拟双指缩放；没有物理手机验收。
- 未增加运行依赖；可选浏览器测试使用开发环境已有的 Python Playwright。
- 最小 Skill 格式已检查，未全局安装；当前会话执行了两条建模路线，尚未在独立新会话验证自动触发或行为稳定性。

浏览器自动化和截图检查证明这些技术行为已运行，不代替用户对样式、准确性和维护价值的体验判断。

## 重新生成与检查

在项目根目录运行：

```sh
node skills/arkigo/scripts/render.mjs docs/poc/canvas-engine/arkigo.canvas.json docs/poc/canvas-engine/index.html
node skills/arkigo/scripts/render.mjs docs/poc/canvas-engine/tasks.canvas.json docs/poc/canvas-engine/tasks.html
node skills/arkigo/scripts/render.mjs docs/poc/canvas-engine/registration.canvas.json docs/poc/canvas-engine/registration.html
node skills/arkigo/scripts/render.mjs docs/poc/new-system/model.json docs/poc/new-system/canvas.html
node skills/arkigo/scripts/render.mjs docs/poc/existing-system/model.json docs/poc/existing-system/canvas.html
npm --prefix skills/arkigo test
python -X utf8 skills/arkigo/tests/browser-smoke.py
python -X utf8 skills/arkigo/tests/browser-semantic.py
```

浏览器检查是开发期可选步骤，需已安装 Python Playwright 和 Chromium；生成或打开画布不需要它们。更多输入约定和布局导入方式见 [工具说明](../../skills/arkigo/README.md) 和 [画布指引](../../skills/arkigo/references/canvas.md)。

## 尚需用户验证

| 要验证的事情 | 当前结果 |
| --- | --- |
| 空间画布是否符合想要的阅读方式 | 待体验 |
| 能看图讲清核心流程与异常，区分观察、建议与未知项 | 待体验 |
| 能根据来源找到代码，讨论一次修改 | 已提供定位文本，效果待体验 |
| 生成与维护成本是否比普通对话更值得 | 未测量 |
| 新会话能否按 Skill 重复产出准确且可读的画布 | 待验证 |

先验证四级模块导航和编排规则，再决定全层同时 LOD、关系聚合、diff/context 与持续证据机制的优先级。
