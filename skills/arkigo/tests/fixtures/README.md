# 失败模型

每个 JSON 都是一份独立模型，刻意保留一个主要错误。它们是工具测试数据，不是业务设计。

在项目根目录执行，例如：

```sh
node skills/arkigo/scripts/validate.mjs skills/arkigo/tests/fixtures/foreign-start.json --json
```

| 文件 | 主要诊断 | 对象 / 字段 |
| --- | --- | --- |
| `duplicate-id.json` | `DUPLICATE_ID` | `step-end`，`/nodes/4/id` |
| `dangling-reference.json` | `REFERENCE_MISSING` | `rel-main`，`/relations/0/to` |
| `parent-cycle.json` | `PARENT_CYCLE` | `flow-main`，`/nodes/1/parentId` |
| `multiple-roots.json` | `ROOT_COUNT` | `/nodes` |
| `foreign-start.json` | `FLOW_STEP_MEMBERSHIP` | `flow-main`，`/nodes/1/details/startStepId` |
| `foreign-terminal.json` | `FLOW_STEP_MEMBERSHIP` | `flow-main`，`/nodes/1/details/terminalStepIds/0` |
| `unreachable-step.json` | `STEP_UNREACHABLE` | `step-orphan`，`/nodes/4/id` |

断开的引用也可能造成步骤不可达等后续诊断；测试核对上表中的主要诊断、对象和字段位置。
