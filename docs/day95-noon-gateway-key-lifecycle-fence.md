# Day 95 午练：Gateway 密钥生命周期与策略双读

沿用 Day 94 pinned gateway verifier。基线策略与当前策略均是注入夹具；策略版本与审计水位独立。选定单把在线密钥，支持 active/retired/revoked、时间窗和累积撤销指纹；并未实现完整多密钥轮换或权威持久策略 CAS。更高审计水位仍需独立证明。读取前后复制快照，防止共享对象原地变更掩盖竞态。即使成功验签，二次读取发现撤销或策略变化也 HOLD；最终授权仍需要原子 fencing。所有结果 publishAuthorized=false。

运行：npm run test:recovery-writer-audit-gateway-key-lifecycle

测试覆盖真实临时 Ed25519 换钥、旧 key 签名、同 epoch 内容变化、撤销竞态、撤销列表丢失、审计水位倒退/分叉/未验证推进、共享对象变更与过期。无生产凭证。生产 NO_GO。
