# 数据一致性与事务

流程会写数据时，编排前先判断是哪种场景；只读流程不用管。先用 `catalog.mjs` 核实当前数据库包有哪些节点（如 `buildify/mysql` 的 `TransactionExecuteNode`：同一事务里按顺序执行多条 SQL，**任一步 SQL 报错**才整体回滚；`ExecuteSqlNode`：单条语句，写入输出 `output.affectedRows`，查询输出 `output.data` / `output.rowCount`）。build 会对「多个节点分别写库」「UPDATE / DELETE 没有 WHERE」「SQL 用 `${}` 拼请求值」给 WARNING。

- **同一个库，多条写入要一起成功**（下单时写订单、扣库存、写流水）：放进一个 `TransactionExecuteNode` 的 `steps`，不要串几个 `InsertNode` / `UpdateNode` / `ExecuteSqlNode`，中途失败时前面写进去的收不回来。`Failure` 接失败应答或告警。
- **影响 0 行不算失败。** 条件不满足（库存不够、状态不对）时 `UPDATE` 只是 0 行，事务照常提交。后一步要依赖前一步时，在 SQL 里接上，如 `INSERT … SELECT … FROM DUAL WHERE ROW_COUNT() > 0`；事务后再查一次结果，用 `IfNode` 决定应答。见 [recipes.md](recipes.md)「事务与幂等」。
- **并发抢同一份数据**（扣库存、领券、改状态）：用带条件的更新 `UPDATE stock SET qty = qty - #{msg.body.qty} WHERE id = #{msg.body.skuId} AND qty >= #{msg.body.qty}`，再按影响行数或回查结果分支。不要先 SELECT、在 JS 里判断、再 UPDATE。
- **跨系统，进不了一个事务**（本地库 + 支付 / 第三方接口 / 发消息）：先写一条「处理中」记录，再调外部，成功改「成功」；外部调用的 `Failure` 把状态改「失败」并告警。外部成功、本地更新失败时记待补偿并告警，不要静默丢掉。要不要自动冲正（如退款）由用户定，和其他缺口放在同一次提问里问。
- **会被重复触发**（支付回调、Webhook 重试、定时任务重跑）：按业务唯一键（订单号、回调交易号）做幂等，配唯一索引，写入用条件判断（`NOT EXISTS`、按状态的条件更新）。处理过的直接返回成功，不重复扣款、发货、通知。
- SQL 参数一律 `#{}` 绑定，`${}` 只用于表名这类可信标识。
- 数据库包没有事务节点时，不要用 JS 或多个节点拼「假事务」：说明一致性风险，按「环境里没有对应节点」补节点，或请用户确认接受风险。
- 汇报里加一行「数据一致性」：哪几步在同一事务里、幂等键、失败怎么补偿。
