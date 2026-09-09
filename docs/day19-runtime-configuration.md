# Day 19 早课：Runtime Configuration Boundary

进入生产化后，Agent 不应该把 Provider、模型、超时、重试和环境差异散落在业务代码中。

## 配置分层

- 代码：稳定的默认行为与类型约束。
- 环境变量：部署环境差异，例如 Provider、模型、超时和重试次数。
- Secret Store / Runtime：API Key、Token 等凭证，只在运行时注入，不提交仓库。

## 当前实现

`src/config/runtime-config.ts` 提供统一 `RuntimeConfig` 和 `loadRuntimeConfig()`，集中解析并校验非敏感运行配置。

下一步会增加 Provider Factory，让 Agent 层继续只依赖 `LLMProvider` 接口，而不是在业务代码里读取环境变量或实例化具体 SDK。
