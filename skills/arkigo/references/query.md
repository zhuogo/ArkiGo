# 按模块读取，限制上下文

`query.mjs` 只读 JSON，支持 `arkigo-canvas/1` 和 `0.1-draft`，不需要渲染器或 Ajv。它检查身份、引用和层级以可靠定位，不执行完整业务/布局校验；生成前仍走 render。

## 从索引到详情

```sh
node "<skill-dir>/scripts/query.mjs" "<input.json>"
node "<skill-dir>/scripts/query.mjs" "<input.json>" --search "注册"
node "<skill-dir>/scripts/query.mjs" "<input.json>" --view "registration"
node "<skill-dir>/scripts/query.mjs" "<input.json>" --id "submit" --view "registration"
node "<skill-dir>/scripts/query.mjs" "<input.json>" --field "/views/2/nodes/0/details"
```

默认模式列画布视图索引，或模型中的模块/流程摘要。`--search` 对 ID、名称、摘要、类型和来源路径做文本匹配，不是语义检索，不全文检索冗长 details。`--view` 限定画布视图并返回节点摘要；模型没有视图，使用 `--id`。

`--id` 返回目标语义详情，以及分页的一跳关系、关联节点摘要、直接子节点；不递归展开依赖或所有后代。画布可在不同视图复用节点 ID，遇到 `AMBIGUOUS_ID` 根据候选补充 `--view`，不要任意选择第一个。

`--field` 使用相对输入文档根的 JSON Pointer，`~0` 表示 `~`，`~1` 表示 `/`。用查询返回的 locator/path 定位；它不是相对节点的字段名。可单独查询字段，或与 id/view 联用限制范围；不能和 search 联用。读取原文件的某个字段不代表整份文件已经校验通过。

## 上限与分页

默认 `--limit 20 --max-bytes 12000`。limit 范围 1–100；max-bytes 范围 1024–65536，按实际输出 UTF-8 字节计算并包括换行，不是 token 上限。

```sh
node "<skill-dir>/scripts/query.mjs" "<input.json>" --view "registration" --offset 20 --limit 20
```

每页查看 `pagination`：offset、total、returned、nextOffset。nextOffset 非 null 表示还有未返回项；使用它继续读取，不自行假定下一页是 offset+limit。关系、邻居和直接子节点共用一条分页序列，不能把第一页面当作完整影响范围。

`partial`、`truncatedPaths`、行上的 `omitted` 标识预览/省略；空指针 `""` 表示文档级元数据有省略。摘要投影本来就省略详情。目标详情、很长的来源、巨大数组和元数据都受字节预算控制，不能将未返回内容理解为不存在。需要时用更窄的 field 指针或显式提高预算；单个字段仍过大时使用文件工具读取具体片段。预算不能替代判断哪些内容与任务有关。

命令只限制自己的输出，不限制 AI 其他工具或整个会话总上下文。整个 JSON 会在本地进程中读取和建立索引；它不是磁盘数据库或无限规模流式引擎。万节点合成查询测试只证明该查询路径，不证明画布渲染性能。

退出码 0 为查询成功；参数、文件、结构或选择错误为 1，stderr 返回紧凑 JSON 诊断。未知/重复参数直接失败；不要遇错就全文打印文件。
