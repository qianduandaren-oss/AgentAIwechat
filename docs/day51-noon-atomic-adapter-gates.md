# Day 51 noon — Atomic adapter integration gates

Check that a single transaction owns Control, Command terminal snapshot, and Audit Outbox. Treat the Checkpoint version as read-only guard for control-only operations. Existing RecoveryOperationService must be rewired before claiming crash safety.
