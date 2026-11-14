# ArkiGo Skill 1.1

帮助用户理解与设计项目的本地 Skill。把用途、模块协作、流程与来源组织成可探索的系统地图；追求表达精炼、层次清楚，保留有意义的分支与边界。支持从想法设计系统、从代码理解已有系统、查询模块和维护设计迭代。默认产物是目标项目的 `docs/canvas.json` 与 `docs/canvas.html`，用户可指定位置。

## 运行与安装

需要 Node.js 22+，唯一直接运行依赖是锁定版本的 Ajv。没有服务、构建、数据库或 AI API 调用。首次安装依赖需要 npm 源；之后日常离线运行。

在本仓库直接使用：

```sh
npm --prefix skills/arkigo ci --omit=dev --ignore-scripts --no-audit --no-fund
```

独立安装，不携带测试、POC、开发产物或 node_modules：

```sh
node skills/arkigo/scripts/install.mjs --user
```

默认安装到用户的 `$CODEX_HOME/skills/arkigo`，未设置 CODEX_HOME 时使用 `~/.codex/skills/arkigo`；也可将 `--user` 换为明确的空目标目录，包括其他客户端的 Skill 目录。已有目录会拒绝覆盖。之后在安装目录运行一次 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`。Skill 指令与引用、脚本、Schema、模板全部自包含。目录被 Skill 客户端发现后可用 `$arkigo` 调用；本仓库直接使用时可明确指定 SKILL.md 路径。

## 日常流程

1. AI 按 SKILL.md 选择设计、代码理解或迭代路线，只读本次相关参考。
2. 默认先用 query 定位目标，再取目标模块和必要来源；不全文注入 HTML 或仓库。
3. AI 编写或更新 JSON；公共生成器校验并产出单文件 HTML。
4. 用户在画布中逐层浏览、查看来源、讨论修改。修改经基线/候选/程序差异后应用。

以当前 Skill 目录为工作目录：

```sh
node scripts/query.mjs "<project>/docs/canvas.json"
node scripts/query.mjs "<project>/docs/canvas.json" --search "注册"
node scripts/query.mjs "<project>/docs/canvas.json" --implementation planned
node scripts/query.mjs "<project>/docs/canvas.json" --view "registration"
node scripts/query.mjs "<project>/docs/canvas.json" --id "submit" --view "registration"
node scripts/render.mjs "<project>/docs/canvas.json" "<project>/docs/canvas.html"
node scripts/diff.mjs "<change>/base.json" "<change>/candidate.json"
node scripts/apply.mjs "<change>/base.json" "<change>/candidate.json" "<project>/docs/canvas.json" "<project>/docs/canvas.html"
```

查询默认最多 20 项、12,000 UTF-8 字节（包括换行），支持分页和字段选择；最大单次 65,536 字节。这不是 token 上限，也不约束 AI 其他工具的输出。省略项和未返回页需明确处理。详见 [查询约定](references/query.md)。

生成器兼容原 `0.1-draft` 模型：可直接把 model.json 交给 render。`validate.mjs <model.json> --json` 提供完整模型诊断。自定义画布由 render 校验；query 只做查询所需的身份、引用和层级检查。

更新工具将内容、布局与 revision 分开比较，先校验再发布；基线冲突时拒绝覆盖。保留候选和基线，正常写入失败尝试恢复，不承诺断电恢复或多进程发布事务。详见 [更新约定](references/update.md)。

## 画布能力与边界

实现情况使用可选 `implementation`，独立于设计决策：planned（蓝色虚线圆）、partial（琥珀色半圆）、implemented（绿色勾）、unknown（灰色问号）。缺省按未核对显示和查询，不迁移旧数据。已实现与部分实现需要非空来源，部分实现还需缺口说明；不推断父模块进度，不表示测试通过或上线。卡片与目录只显示图标，悬停、读屏和详情可读含义。具体字段见[实现情况](references/canvas.md#实现情况)。

统一离线 HTML 支持空间分区、节点、避障连线、详情和来源、模块逐层进入/返回、祖先面包屑、平移缩放、当前层搜索、浅深主题、节点拖动及布局保存/导出。模块卡片有独立样式；顶部保持简约。

详情由独立的紧凑卡片拼接，外层不绘制整块容器。桌面双列、窄屏单列，流程与长内容占整行；多彩图标、加粗标题与显式关键词强调帮助扫读。重要规则和边界直接可读，源码与核对依据按需展开。详情不设关闭按钮和可见滚动条，点击外部或按 Esc 收起，保留滚动操作。首次指针进入有短促动效，切换节点和键盘操作立即响应，并支持减少动态效果偏好。

每次显示一个活动层级。浏览器拖动不写回业务内容；来源是可复制定位文本。没有全层同时 LOD、无限图性能保证、浏览器内容编辑、浏览器变更对比、自动全仓理解或持续证据核验。程序查询和 diff 不等于自动业务影响分析。

## 开发验证

测试只保留在开发仓库，使用 Node 内置测试器：

```sh
npm --prefix skills/arkigo test
python -X utf8 skills/arkigo/tests/browser-smoke.py
python -X utf8 skills/arkigo/tests/browser-semantic.py
python -X utf8 skills/arkigo/tests/browser-implementation.py
python -X utf8 skills/arkigo/tests/browser-details.py
```

浏览器检查使用开发环境的 Python/Playwright/Chromium，不属于 Skill 运行依赖。合成万节点测试针对查询，不代表画布大图性能。真实使用仍需维护来源、范围和语义准确性。
