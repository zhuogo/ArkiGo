# 兼容设计模型约定

字段和类型以 [Schema](../schemas/model-0.1-draft.schema.json) 为准；下文说明关键校验语义。仅在使用该模型且需要具体字段时读 Schema。

模型包含 `schemaVersion: "0.1-draft"`、`project`、`revision`、`nodes`、`relations`。项目保存 `id/title/goal/scope/assumptions`；范围之外的内容不能默认为不存在。

每个节点包含 `id/kind/title/summary/parentId/designStatus/provenance/details`。唯一 `system` 根的 `parentId` 为 `null`，其他归属组成无环树。
节点也支持与画布相同的可选 `implementation`，适配器保留其状态、说明和来源；缺省为未核对。字段与要求见[实现情况](canvas.md#实现情况)，不改变已有 designStatus 的含义。

| 类型 | details 必需内容 |
| --- | --- |
| system | audience、inScope、outOfScope、successCriteria，均为字符串数组 |
| module | responsibilities、boundaries、inputs、outputs，均为字符串数组 |
| flow | trigger 字符串、preconditions 数组、startStepId、非空 terminalStepIds 数组 |
| step | action；inputs、outputs、failureHandling 按需补充 |
| rule | when、constraint、exceptions 数组、rationale |
| acceptance | given 数组、when、非空 then 数组 |
| question | question、options 数组、blocks 数组 |

来源含 `origin`（user/ai/code/import/example）与非空 `references` 数组。状态为 proposed/accepted/retired。`details` 可补充业务说明，但不据此宣称有新类型或额外自动校验。

关系含 `id/kind/from/to`，另可有 label、condition、provenance。方向：流程或步骤 → 规则（governed_by）；验收 → 流程/步骤/规则（verifies）；步骤 → 步骤（next）；问题 → 受影响对象（questions）；依赖方 → 被依赖方（depends_on）。

步骤属于最近的流程祖先。起点、终点与 next 两端需属于同一流程；步骤须可从起点到达且有通向终点的路径，终点无后续 next。多个出口均需 condition；分支步骤写明 failureHandling，或用问题直接关联该步骤/流程说明暂未决定。该检查不能证明条件完整或异常处理合理。

规则无验收关联、问题未退役会产生提示，不阻止保存草案。问题解决后将决定写回流程或规则，再退役问题。
