# Day 78 午练：同库 Writer Epoch + Outbox Claim / ACK

新增 `SQLiteFencedOutboxDelivery` 候选实现：`rotate`、`claim`、`acknowledge` 均在 SQLite `BEGIN IMMEDIATE` 中执行；claim/ack 同事务校验 Writer Epoch、owner、lease 与 Outbox version CAS。测试双连接接管、旧 ACK 拒绝、重启后旧代次拒绝。运行 `npm run test:recovery-fenced-outbox`。

注意：ACK 方法只能在可信 Adapter 验证后由服务端调用；它自身不验证远端身份。旧 Dispatcher、raw acknowledge 与直接 SQL 仍可绕过，生产 NO_GO。