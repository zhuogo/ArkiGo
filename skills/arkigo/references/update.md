# 维护已有设计

先用 query 定位目标模块、当前 revision、必要关系与来源，再读取影响到的代码或需求。只修改本次目标范围；沿用对象 ID，不借迭代重新排版或改名无关模块。

## 基线与候选

在当前输入旁的 `proposals/<change-id>/` 保存原文件的完整副本 `base.json` 和拟修改的 `candidate.json`，用正常文件复制，不将完整基线输出到 AI 上下文。按需记录简短请求/范围。候选更新 revision；新建议保持 proposed，真实需求和代码来源随改动维护。

```sh
node "<skill-dir>/scripts/diff.mjs" "<change-dir>/base.json" "<change-dir>/candidate.json"
node "<skill-dir>/scripts/apply.mjs" "<change-dir>/base.json" "<change-dir>/candidate.json" "<project>/docs/canvas.json" "<project>/docs/canvas.html"
```

路径按用户实际输入位置替换，模型输入也可走同一流程。`diff` 按稳定 ID 比较，区分内容、布局和 revision 元数据；默认输出字段名而非整段新旧正文。它不做业务影响推断，也不代替校验。查看全部必要差异页，若出现无关删除或修改先修正候选。布局导出仅坐标，不是内容差异。

`diff` 支持 `--offset`、`--limit`（默认20，上限100）、`--max-bytes`（默认12000，范围1024–65536）。输出 `pagination.nextOffset` 表示下一页；truncated 表示标识/字段被缩略，需回到对应对象查询，不能将缩略 ID 直接用于写入。视图/节点数组重排不列为内容变化；未显式指定根视图时，第一个视图变化会报告有效根变化。

## 应用与冲突

`apply` 要求四个路径互不相同，且当前输入内容与 base 一致；遇到 `BASE_CONFLICT` 重新读取当前设计并合并，不强行覆盖。它先校验候选和生成完整 HTML，再暂存并替换 JSON/HTML；正常写入失败时尝试恢复。保留 base/candidate 作为恢复依据，当前不承诺断电恢复或多个进程同时发布的事务。

候选改变时 revision 必须更新；文档 ID 与协议不可偷换。可选 `--layout <saved.layout.json>`，但导入布局必须匹配候选的文档 ID 和 revision；不要为了复用旧坐标忽略布局身份检查。

成功后按 query 回读目标模块，打开 HTML 检查改动及相邻关系。用户只要求讨论时可以只查询；不需要为了产生文件而修改设计。用户只要求理解已有系统时不修改业务代码。
