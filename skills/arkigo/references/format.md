# 格式

`design.json` 由对象和关系组成。你不直接编辑它，但 `change --ops` 里新增的对象、修改的字段就是这里的结构。写错时程序拒绝写入，并指出是哪个对象的哪个字段。

## 对象的公共字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 小写字母、数字、`.`、`_`、`-`，以字母或数字开头，最长 64 个字符。整份设计里唯一，以后改标题、移动位置都不改它 |
| `type` | 是 | 见下一节 |
| `title` | 是 | 最长 80 个字符 |
| `summary` | 是 | 一两句话，最长 300 个字符；超过 90 个字符时卡片上显示不全，程序会提醒 |
| `parent` | 是 | 上级对象的 `id`。只有树根 `system` 的 `parent` 是 `null` |
| `group` | 否 | 同级之间的分组名，地图按它分区 |
| `order` | 否 | 数字，同级之间的阅读顺序 |
| `status` | 是 | `proposed`、`accepted`、`retired` |
| `origin` | 是 | `user`、`ai`、`code`、`doc` |
| `body` | 是 | 按类型的结构化内容，可以是 `{}` |
| `notes` | 否 | 内容块数组，放 `body` 装不下的说明 |
| `sources` | 否 | 依据数组，说明这项内容的出处，见下 |

`implementation` 和 `verification` 不手写，用 `implement` 和 `verify` 修改项写入，见本文末尾。

`sources` 的每一项是 `{ "kind", "ref", "symbol"? }`：

| `kind` | `ref` 写什么 |
| --- | --- |
| `file` | 项目里的文件（代码或文档），相对项目根的路径。`symbol` 写函数、类、路由或章节名。`verify` 会检查文件还在不在 |
| `doc` | 不在项目里的文档，写名称和位置 |
| `conversation` | 用户在对话里说的，写日期和要点 |
| `url` | 网址 |

```json
[
  { "kind": "file", "ref": "docs/prd.md", "symbol": "3.2 退款" },
  { "kind": "conversation", "ref": "2026-11-20 用户说明：未发货的订单不需要审核" }
]
```

`id` 建议用带层级的英文短名，例如 `order`、`order.refund`、`order.refund.needs-audit`。它会出现在命令、引用和页面地址里，取一个以后不用改的名字。

`parent` 表达归属：一个对象属于哪个模块。归属是一棵树。「谁调用谁」「谁受哪条规则约束」这类业务关系用关系表达，不用归属表达。

## 类型与 `body`

没有标必填的字段都可以省略。没有注明元素结构的数组是字符串数组。

| `type` | 含义 | `body` 字段 |
| --- | --- | --- |
| `system` | 整个项目，树根，只有一个 | `audience`[]、`goals`[]、`scopeIn`[]、`scopeOut`[]、`success`[]、`assumptions`[] |
| `actor` | 角色 | `description`、`goals`[] |
| `module` | 模块或能力 | `responsibilities`[]、`boundaries`[]、`inputs`[]、`outputs`[] |
| `flow` | 流程 | `trigger`、`preconditions`[]、`steps`[步骤]（必填）、`transitions`[流转]、`start`（必填）、`ends`[]（必填） |
| `rule` | 规则 | `when`、`constraint`（必填）、`exceptions`[]、`rationale` |
| `entity` | 数据 | `fields`[字段]、`states`[`{ name, description? }`]、`stateTransitions`[`{ from, to, when? }`]、`ownership`、`retention` |
| `interface` | 接口 | `kind`（`http`、`event`、`function`、`cli`、`other`）、`signature`（必填）、`request`[字段]、`response`[字段]、`errors`[`{ code, when }`]、`auth` |
| `screen` | 界面 | `route`、`purpose`、`elements`[]、`states`[]、`media`[`{ path, caption? }`] |
| `acceptance` | 验收 | `given`[]、`when`（必填）、`then`[]（必填） |
| `decision` | 待定与决策 | `question`（必填）、`options`[`{ title, detail? }`]、`chosen`、`rationale`、`decidedBy`、`decidedAt` |

- 步骤：`{ "id", "title", "action", "actor"?, "inputs"?, "outputs"?, "failure"? }`。`id` 只需在本流程内唯一；`actor` 是某个 `actor` 对象的 `id`；`failure` 写这一步失败时怎么办。
- 流转：`{ "from", "to", "when"? }`，两端是本流程的步骤 `id`。一个步骤有多个出口时，每个出口都要写 `when`。
- 字段：`{ "name", "type", "required"?, "description"? }`。
- `decision` 的 `chosen` 是选项的下标，从 0 开始；还没定时不写。`chosen`、`decidedBy`、`decidedAt` 用 `decide` 修改项写入。
- `media` 的 `path` 相对 `docs/arkigo/assets/`，图片要先放进这个目录。

流程会被检查：`start` 和 `ends` 必须是本流程的步骤；每个步骤都要能从 `start` 走到；不是终点的步骤必须有出口。

### 例子

带分支的流程：

```json
{
  "id": "order.refund",
  "type": "flow",
  "title": "申请退款",
  "summary": "买家提交退款申请，小额自动通过，大额转人工审核。",
  "parent": "order",
  "status": "accepted",
  "origin": "user",
  "body": {
    "trigger": "买家在订单详情点击「申请退款」",
    "steps": [
      { "id": "submit", "title": "提交申请", "action": "买家填写原因并提交", "actor": "buyer" },
      { "id": "check", "title": "判断金额", "action": "按 [[order.refund.needs-audit]] 判断是否需要人工审核" },
      { "id": "audit", "title": "人工审核", "action": "客服核对订单后通过或驳回", "actor": "support",
        "failure": "48 小时内无人处理时提醒客服主管" },
      { "id": "pay", "title": "原路退回", "action": "调用支付渠道退款",
        "failure": "渠道失败时保留申请并每小时重试，三次后转人工" },
      { "id": "reject", "title": "驳回", "action": "通知买家驳回原因" }
    ],
    "transitions": [
      { "from": "submit", "to": "check" },
      { "from": "check", "to": "pay", "when": "金额不超过 200 元" },
      { "from": "check", "to": "audit", "when": "金额超过 200 元" },
      { "from": "audit", "to": "pay", "when": "审核通过" },
      { "from": "audit", "to": "reject", "when": "审核驳回" }
    ],
    "start": "submit",
    "ends": ["pay", "reject"]
  }
}
```

规则、验收和待定项：

```json
{
  "id": "order.refund.needs-audit",
  "type": "rule",
  "title": "大额退款需要人工审核",
  "summary": "单笔退款超过 200 元时必须由客服审核后才能退回。",
  "parent": "order",
  "status": "accepted",
  "origin": "user",
  "body": {
    "when": "买家提交退款申请",
    "constraint": "退款金额超过 200 元时，申请进入人工审核，审核通过前不发起退款",
    "exceptions": ["订单尚未发货时不需要审核"],
    "rationale": "防止大额恶意退款"
  }
}
```

```json
{
  "id": "order.refund.audit-check",
  "type": "acceptance",
  "title": "大额退款不会自动退回",
  "summary": "超过 200 元的退款申请停在待审核。",
  "parent": "order",
  "status": "accepted",
  "origin": "user",
  "body": {
    "given": ["一笔已发货、金额 300 元的订单"],
    "when": "买家提交退款申请",
    "then": ["申请状态为待审核", "没有发起渠道退款"]
  }
}
```

```json
{
  "id": "order.refund.partial",
  "type": "decision",
  "title": "是否支持部分退款",
  "summary": "一笔订单多件商品时能否只退其中几件。",
  "parent": "order",
  "status": "proposed",
  "origin": "ai",
  "body": {
    "question": "一笔订单里有多件商品时，买家能不能只退其中几件？",
    "options": [
      { "title": "只能整单退", "detail": "实现简单；买家想退一件时要先整单退再重新下单" },
      { "title": "可以按件退", "detail": "需要按件记录退款金额和库存回补" }
    ]
  }
}
```

数据和接口：

```json
{
  "id": "order.refund-request",
  "type": "entity",
  "title": "退款申请",
  "summary": "一次退款申请及其处理状态。",
  "parent": "order",
  "status": "accepted",
  "origin": "user",
  "body": {
    "fields": [
      { "name": "id", "type": "string", "required": true },
      { "name": "amount", "type": "decimal", "required": true, "description": "退款金额，单位元" },
      { "name": "reason", "type": "string" }
    ],
    "states": [
      { "name": "pending", "description": "待审核" },
      { "name": "refunded", "description": "已退回" },
      { "name": "rejected", "description": "已驳回" }
    ],
    "stateTransitions": [
      { "from": "pending", "to": "refunded", "when": "审核通过且渠道退款成功" },
      { "from": "pending", "to": "rejected", "when": "审核驳回" }
    ],
    "ownership": "订单模块"
  }
}
```

```json
{
  "id": "order.refund-api",
  "type": "interface",
  "title": "提交退款申请接口",
  "summary": "买家端提交退款申请。",
  "parent": "order",
  "status": "accepted",
  "origin": "user",
  "body": {
    "kind": "http",
    "signature": "POST /orders/{id}/refunds",
    "request": [{ "name": "reason", "type": "string", "required": true }],
    "response": [{ "name": "status", "type": "string", "description": "pending 或 refunded" }],
    "errors": [{ "code": "409", "when": "该订单已有处理中的退款申请" }],
    "auth": "买家本人"
  }
}
```

## 内容块

`notes` 是内容块数组，用来放 `body` 的结构化字段装不下的说明。每种块都可以带一个 `title` 作小标题。

| `type` | 字段 |
| --- | --- |
| `text` | `text` |
| `list` | `items`[]、`ordered`? |
| `table` | `columns`[]、`rows`[][] |
| `code` | `text`、`lang`? |
| `image` | `path`（相对 `assets/`）、`caption`? |
| `callout` | `tone`（`info` 或 `warn`）、`text` |

```json
[
  { "type": "callout", "tone": "warn", "text": "渠道退款的到账时间没有核实，文档写的是 1 到 3 个工作日。" },
  { "type": "table", "title": "各渠道的退款上限", "columns": ["渠道", "单笔上限"], "rows": [["微信", "5 万元"], ["支付宝", "5 万元"]] }
]
```

## 行内标记

`body` 和内容块里的字符串可以用三种标记，其余文字原样显示。标题和摘要是纯文字，不解析标记：

- `**粗体**`
- `` `代码` ``
- `[[对象id]]` 或 `[[对象id|显示文字]]`，引用流程步骤写 `[[流程id#步骤id]]`

文字里提到设计中的另一个对象时，用引用而不是只写它的名字。页面上引用可以点击跳转；被引用的对象必须存在，所以对象被删除时程序会指出还有哪些文字引用着它。

## 关系

每条关系是 `{ "from", "to", "type", "label"?, "when"? }`。端点是对象 `id`，或流程步骤 `流程id#步骤id`。`when` 写这条关系在什么条件下成立。同样的 `from`、`type`、`to` 只能有一条。

| `type` | 含义 | 限制 |
| --- | --- | --- |
| `depends_on` | `from` 的设计依赖 `to` | 无 |
| `calls` | `from` 调用 `to` | 无 |
| `reads`、`writes` | `from` 读取、写入 `to` | `to` 必须是 `entity` |
| `governed_by` | `from` 受规则 `to` 约束 | `to` 必须是 `rule` |
| `verifies` | 验收 `from` 验证 `to` | `from` 必须是 `acceptance` |
| `blocks` | 待定项 `from` 卡住 `to` | `from` 必须是 `decision` |
| `uses` | 角色 `from` 使用 `to` | `from` 必须是 `actor` |
| `relates` | 其他关系 | 必须写 `label` |

`depends_on`、`calls`、`reads`、`writes`、`uses`、`relates` 在地图上画成连线，`label` 显示在线上，写成短语。`governed_by`、`verifies`、`blocks` 不画线，显示为卡片上的数量标记，并出现在详情和开工材料里。

关系用 `link` 修改项增加：

```json
[
  { "op": "link", "relation": { "from": "buyer", "to": "order.refund", "type": "uses" } },
  { "op": "link", "relation": { "from": "order.refund", "to": "order.refund-request", "type": "writes", "label": "创建申请" } },
  { "op": "link", "relation": { "from": "order.refund#check", "to": "order.refund.needs-audit", "type": "governed_by" } },
  { "op": "link", "relation": { "from": "order.refund.audit-check", "to": "order.refund.needs-audit", "type": "verifies" } },
  { "op": "link", "relation": { "from": "order.refund.partial", "to": "order.refund", "type": "blocks" } }
]
```

## 修改项

`change --ops <文件>` 读取一个 JSON 数组，`--ops -` 从标准输入读取。修改项按顺序应用，全部成功才写入。

| 修改项 | 作用 |
| --- | --- |
| `{ "op": "add", "object": { … } }` | 新增对象 |
| `{ "op": "update", "id", "set": { "<路径>": 值 } }` | 修改字段 |
| `{ "op": "move", "id", "parent" }` | 调整归属 |
| `{ "op": "remove", "id", "cascade"? }` | 删除对象 |
| `{ "op": "link", "relation": { … } }` | 增加关系 |
| `{ "op": "unlink", "relation": { "from", "type", "to" } }` | 删除关系 |
| `{ "op": "accept", "id" }`、`{ "op": "retire", "id" }` | 把状态改为已接受、已作废 |
| `{ "op": "decide", "id", "chosen", "rationale"?, "by"? }` | 记录用户对待定项的选择。状态是 `proposed` 时同时变为 `accepted` |
| `{ "op": "implement", "id", "status", "note"?, "evidence": [ … ] }` | 写实现情况 |
| `{ "op": "confirm-evidence", "id" }` | 复查后确认实现依据仍然成立 |
| `{ "op": "verify", "id", "status", "note"?, "evidence"? }` | 写验收结果 |

同一组里后面的修改项可以用到前面新增的对象，所以新增对象和连接它的关系可以放在一次 `change` 里。

### `update` 的路径

路径用点分隔。数组元素用方括号选中，`[+]` 表示追加，值为 `null` 表示删除。

```json
[
  { "op": "update", "id": "order.refund", "set": {
    "summary": "买家提交退款申请，小额自动通过，大额转人工审核。",
    "body.steps[pay].failure": "渠道失败时保留申请并每小时重试，三次后转人工",
    "body.preconditions[+]": "订单已支付",
    "body.trigger": null,
    "notes[+]": { "type": "callout", "tone": "info", "text": "重试间隔来自支付渠道文档。" }
  } }
]
```

- `body.steps[pay]` 按元素的 `id` 选中步骤；字段数组按 `name` 选中，例如 `body.fields[amount].description`。
- 给数组整体赋值会替换整个数组。数组的顺序是内容的一部分，不会被程序重排。

### 删除与作废

- 用户否决的提议、不再需要但值得留下记录的内容，用 `retire`。它仍在设计里，显示为已作废。
- 写错的、重复的对象用 `remove`。对象有下级，或被关系、行内引用指向时会被拒绝；加 `"cascade": true` 会连同下级和相关关系一起删除，输出里列出删了什么。别处文字里还有指向它的 `[[…]]` 时，要在同一组修改里把那些文字改掉。

### 实现情况与验收结果

```json
[
  { "op": "implement", "id": "order.refund", "status": "partial",
    "note": "自动退回已完成；人工审核的超时提醒还没做。",
    "evidence": [ { "path": "src/order/refund.ts", "symbol": "submitRefund" } ] },
  { "op": "verify", "id": "order.refund.audit-check", "status": "passed",
    "note": "npm test -- refund，12 项通过。",
    "evidence": [ { "kind": "file", "ref": "tests/refund.test.ts" } ] }
]
```

- `implement` 只能用在 `module`、`flow`、`rule`、`entity`、`interface`、`screen` 上。`status` 是 `planned`、`partial`、`implemented`，或 `null`（清除记录，回到未核对）。
- `implemented` 和 `partial` 至少要有一条 `evidence`；`partial` 必须用 `note` 写明还缺什么。`planned` 还没有代码，写 `"evidence": []`。
- `evidence` 的 `path` 相对项目根，文件必须存在；`symbol` 写函数、类或路由名，方便定位。程序会记下文件当时的内容指纹和核对时间，之后文件变了就能发现。不要自己填 `hash` 和 `checkedAt`。
- `verify` 只能用在 `acceptance` 上，`status` 是 `passed` 或 `failed`。`note` 写实际执行的命令和结果。验收结果不能清除，重新验证后用新的结果覆盖。
- `confirm-evidence` 用在依据文件变了、你重新读过代码并确认它仍然做到这个对象描述的事之后。
