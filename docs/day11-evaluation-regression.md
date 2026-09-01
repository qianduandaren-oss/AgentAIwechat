# Day 11 Evening: Evaluation Regression

Day 11 evening turns routing evaluation into a regression workflow.

Core loop:

```text
Production failure / discovered edge case
  -> classify failure
  -> add permanent eval case
  -> fix router or policy
  -> rerun dataset
  -> keep the case forever
```

Failure categories used by the teaching project:

- `routing_error`: router returned a valid but wrong specialist.
- `execution_error`: selection/evaluation could not complete because runtime or provider threw.
- `evaluation_data_error`: the expected answer or task boundary itself is wrong/ambiguous; this is intentionally a review classification rather than something the runner guesses automatically.

The dataset now includes regression cases for misleading keywords, paraphrases and negation. This prepares the project for later trajectory evaluation and observability work.
