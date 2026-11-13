# ArkiGo

把产品想法编织成分层、可视化、可演进的系统设计。

## 命名

- **项目名称**：ArkiGo。
- **仓库与目录名称**：`arkigo`。
- **Skill 名称**：`arkigo`，与项目同名。
- **名称含义**：Arki 借用 Architecture（架构）开头的发音，是品牌造词，并非表示架构的标准英文词；Go 表达从设计走向实现与持续迭代。

## 项目定位

探索一种面向 AI 开发的系统设计范式，用结构化设计与语义缩放画布，替代传统 PRD 作为主要设计载体，并保留需求、边界、异常和验收依据。

用户表达想法后，AI 按统一方法梳理设计；人通过画布阅读和编辑，AI 通过同一份结构化模型理解和更新。设计随开发与迭代持续维护。

## 核心组成

| 组成 | 职责 |
| --- | --- |
| `arkigo` Skill | 引导 AI 澄清目标、拆解模块、梳理流程与异常、标记待决策问题、生成和维护设计 |
| 结构化设计模型 | 保存稳定的对象 ID、层级、关系、业务规则、验收条件、版本与代码映射 |
| 语义缩放画布 | 缩远显示系统全景，放大逐步显示模块、业务逻辑、界面、实现关联与验证结果 |
| 变更记录 | 区分设计计划与实现状态，展示新增、修改、删除与影响范围，区分内容变化和布局移动 |
| MCP 接口（按需增加） | 在需要多个 AI 客户端访问独立画布工具时，提供设计查询和更新能力 |

## 使用流程

表达想法 → 梳理目标与边界 → 生成设计草案 → 在画布中查看与修订 → 指导实现与验收 → 同步设计、代码关联和迭代变化。

## 设计原则

- 支持层级嵌套，也支持跨模块依赖；不把所有关系强制塞进树形结构。
- 文本、图片、原型等内容关联到明确的设计对象。
- 明确区分用户已确认要求、AI 建议、假设和待决策问题。
- 根据风险和复杂度展开设计，允许原型与实际反馈修正前置设计。
- 设计与实现的关联需要维护和验证，不把预期自动当作已实现事实。

## 名称核查

核查日期：2026-11-11。

GitHub 搜索 API 的公开仓库查询结果（`incomplete_results: false`）：

| 查询 | 结果 |
| --- | --- |
| [`arkigo in:name`](https://github.com/search?q=arkigo+in%3Aname&type=repositories) | 0 个仓库 |

当前未发现该名称对应的公开仓库。结果以当时可检索的公开仓库为限，不代表名称预留、商标核查或未来唯一性；GitHub 仓库的实际标识为 `owner/repository`。

## 当前状态

项目与 Skill 统一命名为 `arkigo`。已形成可独立安装的 Skill 1.0：新系统设计、已有系统理解和设计迭代，共用有界查询、校验、程序差异、候选应用与离线画布。使用方法见[Skill 与本地工具](./skills/arkigo/README.md)。新项目默认输出 `docs/canvas.json` 与 `docs/canvas.html`。

先打开 **[用户注册四级画布](./docs/poc/canvas-engine/registration.html)**：系统全景 → 用户模块 → 用户注册 → 创建用户记录。选中模块后点击进入、双击或放大深入；缩小、祖先面包屑或 `Alt+Left` 返回，恢复父级相机与选中。另有 [ArkiGo 引擎架构](./docs/poc/canvas-engine/index.html) 和 [任务清单画布](./docs/poc/canvas-engine/tasks.html)，三份通用 JSON 共用离线运行时，支持详情、搜索、主题切换、拖动及布局保存/导出。

本轮自动测试与独立安装验证见 [Skill 验收记录](./docs/07-Skill验收.md)；原画布阶段已通过基础浏览器回归与 10 项模块导航场景，检查了桌面和 320/375px 手机布局。历史样例与范围见 [POC](./docs/poc/README.md)。

Archify 源码快照仅供本地研究，不纳入本仓库，也不作为运行依赖；来源提交与下载记录见 [参考资源说明](./resource/README.md)，研究文档链接到对应的上游固定版本。

2026-11-13 当前工作以[起步范围](./docs/00-起步范围.md)与 Skill 实际命令为准。AI 读取、分析和组织 JSON；query 控制单次返回范围与字节量，diff 计算结构化变化，apply 校验并应用候选，公共生成器交付 HTML。生成器不自动扫描仓库，不承诺无限图性能、自动业务影响推断、持续证据核验或多进程事务。

在此目录快速验证：

```sh
npm --prefix skills/arkigo ci
node skills/arkigo/scripts/validate.mjs docs/examples/login.candidate.json
node skills/arkigo/scripts/render.mjs docs/poc/canvas-engine/arkigo.canvas.json docs/poc/canvas-engine/index.html
node skills/arkigo/scripts/render.mjs docs/poc/canvas-engine/registration.canvas.json docs/poc/canvas-engine/registration.html
npm --prefix skills/arkigo test
```
