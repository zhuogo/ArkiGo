---
name: arkigo
description: 将系统想法或已有项目整理为带代码来源的分层架构画布，按模块查询设计并维护后续迭代。适用于新系统设计、理解已有系统、架构讨论和更新设计；生成可离线打开的 HTML。
---

# ArkiGo

AI 分析内容，公共生成器校验和呈现。用户通过画布浏览，AI 通过 JSON 与有输出上限的查询读取。沿用现有引擎，不为每个项目编写 HTML/CSS/JS。

## 选择任务

- 只有想法：读 [新建设计](references/new-design.md)。
- 理解已有系统：读 [理解已有系统](references/existing-system.md)，只读本轮范围涉及的代码。
- 已有设计需要讨论或修改：先查询现有 JSON；需要写入时读 [更新设计](references/update.md)。
- 编排或生成画布时读 [画布指引](references/canvas.md)；已存在 `0.1-draft` 模型时再读 [模型约定](references/model.md)。其余资料按需加载。

## 文件与运行

新项目默认使用项目根目录的 `docs/canvas.json` 与 `docs/canvas.html`。用户指定位置优先；已有设计沿用原路径，先检查文件再创建，不自动迁移或覆盖无关文档。默认只维护一份 `arkigo-canvas/1` 输入；已有设计模型可直接渲染，无需再复制一份画布 JSON。

`<skill-dir>` 是本文件所在目录，`<project>` 是本轮目标项目。需要 Node.js 22+；首次运行渲染器前，若依赖未安装，在 Skill 目录执行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`。依赖安装一次；之后日常使用无需服务、构建、网络或 AI API。

```sh
node "<skill-dir>/scripts/query.mjs" "<project>/docs/canvas.json"
node "<skill-dir>/scripts/query.mjs" "<project>/docs/canvas.json" --search "注册"
node "<skill-dir>/scripts/query.mjs" "<project>/docs/canvas.json" --view "registration"
node "<skill-dir>/scripts/render.mjs" "<project>/docs/canvas.json" "<project>/docs/canvas.html"
```

## 控制上下文

先查目录/搜索，再按准确视图 ID 或节点 ID 展开。查询默认最多 20 项、12,000 UTF-8 字节（不是 token），带分页和省略标记；不要直接输出整份 HTML、JSON 或全仓代码。具体筛选与分页见 [查询工具](references/query.md)。

直接依赖先取摘要，不递归加载整个依赖链。检查 `pagination.nextOffset` 和省略标记；未返回或被截断的内容不能当作不存在。目标过大时缩小到节点/字段；名称或跨视图 ID 有歧义时先定位候选。只有调试引擎才读公共源码和模板。

## 内容约定

- 首轮先交付模块概览和一条有意义的核心流程，记录已覆盖与未深入范围。未知事实明确标记，缺失且影响核心方案时再追问。
- 建议保持 `proposed`，不能把代码观察或 AI 推测当成用户已确认决定。保留待定问题、分支、异常与验收预期。
- 来源使用项目根目录相对路径；已有模块记录实际读过的目录、文件与必要函数。未实现的模块保留需求来源，拟建路径写“计划位置”。来源是定位线索，不等于自动核验或测试通过。
- ID 在改名和移动时保持稳定。模块归属是单根树，业务依赖另用连线表达。详情指向对应对象，不把整份 PRD 填进每张卡片。
- JSON 是内容来源；HTML 是可重新生成的阅读副本。浏览器拖动只改布局，不写回业务设计。修改内容需更新 revision。

## 完成交付

新建时用生成器校验并输出 HTML；已有设计修改走基线 → 候选 → 程序差异 → 校验应用，见更新指引。失败先读诊断再修复，保留当前有效文件。

实际打开生成的 HTML 检查模块层级、关系、文字与详情；可用浏览器自动化时验证交互。交付 JSON/HTML 路径、本轮范围、待定问题与实际检查结果；无法做的检查说明清楚。结构校验不是业务完整性证明；代码分析、跨模块影响和性能结论仅限已验证范围。
