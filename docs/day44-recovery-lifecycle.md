# Day 44 evening · Recovery Operation Lifecycle

Human recovery must submit commands through authorization, checkpoint/control version checks, the recovery coordinator, and audit. Operational state is separate from resume boundary.

State flow:

```text
active -> quarantined -> active
active/quarantined -> dead_lettered
```

`resume` is only valid from `quarantined`: it releases the operational block and re-enters the existing recovery coordinator. `dead_lettered` is terminal in the current learning runtime.
