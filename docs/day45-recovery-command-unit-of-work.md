# Day 45 Evening · Recovery Command Unit of Work

Day 45 evening introduces a SQLite transaction boundary for checkpoint mutation, recovery control mutation, durable command finalization, and outbox insertion. The goal is to ensure that stale-version conflicts roll back the entire unit of work and that pending outbox rows survive process restart for later dispatch.

This closes the storage-level atomicity gap demonstrated by the in-memory contracts. The existing RecoveryOperationService still needs a later integration step so that its domain transition is finalized through this unit of work instead of independent writes.
