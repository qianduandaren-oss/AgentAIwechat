# Day 47 Morning — Durable Recovery Operation Orchestrator

Day 47 starts assembling Durable Command, Human Recovery, and the Day 46 transaction-aware commit path into a crash-recoverable command processor.

The same `commandId` represents the same immutable Human Recovery request. A terminal command must replay its durable result instead of executing Recovery again; an `accepted` or `executing` command must reload Checkpoint, Control, and Command facts before it resumes.

```text
commandId not found
→ accept_new

terminal command
→ replay_terminal
→ never run Recovery again

accepted / executing
→ resume_in_flight
→ reload durable facts before continuing
```

Day 47 noon will turn this entry policy into runnable orchestration code and add duplicate-submission regression tests.
