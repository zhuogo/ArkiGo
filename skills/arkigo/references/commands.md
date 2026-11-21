# 命令

下文的 `arkigo` 指 `node <本技能目录>/scripts/arkigo.mjs`。

## 共同约定

- **目录**：程序从当前目录向上找 `docs/arkigo/design.json`。设计放在别处时用 `--dir <设计目录>` 指定，指向的是放 `design.json` 的那个目录。项目根是设计目录向上最近的 Git 仓库根；命令里和设计里的路径都相对项目根。
- **输出**：单行 JSON，写到标准输出；`context` 和 `export md` 输出 Markdown。
- **出错**：错误是单行 JSON，写到标准错误，形如 `{ "ok": false, "code": "…", "message": "…" }`。
- **退出码**：0 成功；1 内容问题（校验失败、`verify` 发现需要复查、`check --strict` 有提醒）；2 用法或读写错误；3 版本冲突。
- **输出上限**：读取类命令默认最多返回 20 项、12,000 字节。输出里的 `total` 是总数，`omitted` 为真表示还有没返回的，用 `--offset <nextOffset>` 继续读；`--limit`（1 到 100）和 `--max-bytes`（1024 到 65536）可以调整。没读完时不要当作「设计里没有」。
- **版本**：`rev` 是设计内容的指纹，内容一变就变。
- 未知参数和重复参数会直接报错。

## `version`

```bash
arkigo version
```

输出版本号、Node 版本、技能目录和 `dependencies.ajv`。`ajv` 为 `false` 时在技能目录执行一次：

```bash
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
```

## `init`

```bash
arkigo init --id shop --title "小店"
```

在当前目录建立 `docs/arkigo/`（`design.json`、`history/`、`assets/`、`index.html`），设计里只有一个 `system` 对象，`id` 就是 `--id`。同时把一段项目规则写进项目根的 `AGENTS.md`（没有就创建；有 `CLAUDE.md` 时也写入），告诉以后在这个项目里工作的 AI：改代码前先读设计，改完后回写。这段规则用 `<!-- arkigo:start -->` 和 `<!-- arkigo:end -->` 包住，重复执行只更新这一段。不想改这两个文件时加 `--no-rules`。

## `query`

```bash
arkigo query                                   # 目录：项目、各类型数量、未决数量、两层对象
arkigo query --id order.refund                 # 完整对象、和它相连的关系、直接下级的摘要
arkigo query --search "退款"                    # 全文搜索，结果带命中的字段路径
arkigo query --type rule --under order         # 筛选，条件可以组合
arkigo query --status proposed
arkigo query --implementation stale
arkigo query --field order.refund /body/steps/3/failure
```

- `--id` 的输出里，`items` 每项带 `role`：`object` 是对象本身，`relation` 是一条关系，`child` 是一个直接下级。
- `--search` 搜索 `id`、标题、摘要、`body`、内容块和依据。同一个对象在几处命中就出现几次，`path` 指出是哪个字段。
- `--implementation` 可取 `planned`、`partial`、`implemented`、`unknown`（没有核对过）、`stale`（依据文件变了或不见了）。
- `--field` 的第二个参数是 JSON 指针：用 `/` 分隔，数组用下标（从 0 开始）。它和 `update` 的路径写法不同。

## `context`

```bash
arkigo context order.refund
```

输出实现这个对象所需的材料（Markdown）：对象全文、它在树里的位置和项目的目标范围、直接下级、约束它的规则、验证它的验收、它读写的数据和调用的接口、卡住它的未决问题、已记录的实现依据。默认最多 24,000 字节，`--max-bytes` 可调；放不下的部分列在末尾的省略清单里，需要时用 `query --id` 读。

写代码前用它，比自己一次次 `query` 拼材料更全，也不会漏掉规则和未决问题。

## `change`

```bash
arkigo change --reason "补充退款失败时的处理" --ops ops.json
arkigo change --reason "…" --ops - < ops.json          # 从标准输入读
arkigo change --reason "…" --ops ops.json --dry-run     # 只校验，不写入
arkigo change --reason "…" --ops ops.json --base 4c6a1a2f9e57
arkigo change --reason "…" --ops ops.json --by "向阳"
arkigo change --from-decisions decisions.json --reason "用户在页面上拍板"
```

修改项的写法见 [format.md](format.md#修改项)。一组修改要么全部写入，要么完全不写。成功时：

```json
{ "ok": true, "rev": "新版本", "base": "原版本", "applied": 3, "changed": ["order.refund"],
  "history": "docs/arkigo/history/….json", "warnings": [], "page": { "ok": true, "path": "docs/arkigo/index.html" } }
```

- 每次写入都会在 `history/` 留一条记录，并重新生成页面。
- `warnings` 是这次改动新带来的提醒，改动之前就有的不重复列出；要看全部用 `check`，含义也见下文 `check`。提醒不阻止写入。
- `--by` 记录是谁改的，默认 `ai`。替用户记录他的决定时写用户的名字。
- `--base` 写你读设计时看到的 `rev`。设计在那之后被改过时，命令以退出码 3 拒绝（`BASE_CONFLICT`）：重新读取，确认你的修改仍然成立，再写。
- `--from-decisions` 应用用户在页面上导出的拍板结果，用法见 [loop.md](loop.md#用户在页面上拍板之后)。

校验失败时（退出码 1）：

```json
{ "ok": false, "code": "VALIDATION_FAILED", "errors": [
  { "code": "BRANCH_WHEN_REQUIRED", "id": "order.refund", "path": "/objects/2/body/transitions/0/when", "message": "Branch requires a condition." } ] }
```

每条错误指出对象和字段。改正修改项后重新执行，不要绕过程序去改文件。

| 常见错误 | 原因与处理 |
| --- | --- |
| `SCHEMA_INVALID` | 字段名、类型或取值不符合格式。对照 [format.md](format.md) |
| `ID_DUPLICATE`、`PARENT_NOT_FOUND`、`PARENT_CYCLE` | `id` 重复；上级不存在；归属成环 |
| `STEP_UNREACHABLE`、`STEP_NO_EXIT`、`BRANCH_WHEN_REQUIRED`、`STEP_NOT_FOUND` | 流程里有走不到的步骤；非终点步骤没有出口；分支没写条件；引用的步骤不存在 |
| `REFERENCE_NOT_FOUND` | 文字里的 `[[…]]` 指向不存在的对象或步骤 |
| `RELATION_ENDPOINT_NOT_FOUND`、`RELATION_ENDPOINT_TYPE`、`RELATION_DUPLICATE` | 关系的端点不存在；端点类型不符合该关系的限制；关系已存在 |
| `REMOVE_REFERENCED` | 要删的对象有下级或还被指向。改用 `retire`，或确认后加 `cascade` |
| `EVIDENCE_MISSING` | 实现依据的文件不存在。路径要相对项目根 |
| `ASSET_MISSING` | 图片不在 `docs/arkigo/assets/` 里 |
| `OP_INVALID` | 修改项本身不成立，例如对验收用 `implement`，或用 `update` 改 `implementation` |

## `check`

```bash
arkigo check
arkigo check --under order
arkigo check --strict        # 有提醒时退出码 1
```

列出设计里值得看一眼的地方。它只列清单，不打分，也不替你判断该不该改。

| 提醒 | 情况 | 通常怎么办 |
| --- | --- | --- |
| `SYSTEM_INCOMPLETE` | 项目缺用户、目标或范围 | 补上；不知道就问用户 |
| `THIN_MODULE` | 模块没有职责也没有下级 | 写清它负责什么，或删掉这个空壳 |
| `FLOW_NO_FAILURE` | 流程没有任何一步说明失败时怎么办 | 找出会失败的步骤，写 `failure` |
| `RULE_NO_ACCEPTANCE` | 规则没有验收指向它 | 加一条验收并用 `verifies` 连上 |
| `OPEN_DECISION` | 有未决的待定项 | 等用户定，不要替他选 |
| `ACCEPTED_BUT_BLOCKED` | 已接受的对象被未决问题卡住 | 先让用户定那个问题，再实现 |
| `SUMMARY_LONG` | 摘要超过 90 个字符 | 缩短，细节移进 `body` |
| `NO_SOURCE` | 来源是代码或文档，但没有依据 | 补 `sources` |
| `UNUSED_ENTITY`、`UNUSED_INTERFACE` | 没有关系指向这个数据或接口 | 补上谁读写、谁调用它 |
| `NOT_CHECKED` | 可实现的对象没有实现情况 | 核对代码后用 `implement` 写入；还在设计阶段时可以先不管 |
| `STALE_EVIDENCE` | 实现依据的文件变了或不见了 | 见 [loop.md](loop.md#代码变了之后) |

## `verify`

```bash
arkigo verify
arkigo verify --under order
arkigo verify --since HEAD~5
```

逐条检查实现依据指向的文件：`ok` 没变，`changed` 内容变了，`missing` 文件不见了，`unrecorded` 没有记录过指纹。`sources` 里指向文件的依据只检查文件是否存在。`--since` 另外标出自那个提交以来被改动过的依据文件。

有 `changed` 或 `missing` 时退出码是 1，结果写在标准错误（`code` 为 `EVIDENCE_STALE`）。这不是命令执行失败，而是它要告诉你的结果：这些对象需要对照代码复查。文件变了不等于设计过时了，程序判断不了这一点，要你读代码。

## `history` 与 `diff`

```bash
arkigo history                       # 变更记录，新的在前：时间、谁、原因、改了几处
arkigo history --show d10b724f7ec4   # 一条记录的字段级改动，参数是文件名或 rev
arkigo diff 另一份/design.json       # 当前设计与另一份文件的字段级差异
```

`diff` 的每条差异里，`before` 是当前设计，`after` 是另一份文件。用它比较两个分支、或备份与现状。

## `render`

```bash
arkigo render
arkigo render --editor vscode        # 或 cursor
```

校验并重新生成 `docs/arkigo/index.html`。`change` 已经会自动生成，需要单独执行的情况是：代码变了，想让页面上的依据核对结果跟上；或者想让页面里的文件路径能点开编辑器（`--editor`）。输出里的 `evidence` 是四种核对结果各有多少条。

带 `--editor` 生成的页面里有本机的项目绝对路径，只适合本机使用，之后 `change` 自动生成时会沿用这个设置。要发给别人或提交到仓库时，执行一次不带 `--editor` 的 `render`。

## `export md`

```bash
arkigo export md
arkigo export md --under order --out docs/order.md
```

按阅读顺序导出 Markdown，流程和状态流转画成 Mermaid 图。`--out` 的路径必须在项目里。导出的文件是给别处用的副本，不要改它再指望设计跟着变。

## `layout`

```bash
arkigo layout import layout.json     # 导入用户在页面上拖好后导出的位置
arkigo layout reset                  # 清空，回到自动排布
```

位置存在 `docs/arkigo/layout.json`，只影响地图上卡片摆在哪里，不是设计内容。你不需要也不应该手写坐标。

## `install`

```bash
arkigo install --user                # 装到 ${CODEX_HOME:-~/.codex}/skills/arkigo
arkigo install <目标目录>
```

把本技能复制到目标目录，并输出接下来要在那里执行的依赖安装命令。
