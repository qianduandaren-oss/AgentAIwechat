import { summarizeTrace } from "../observability/trace-summary.js";
import { TraceRecorder } from "../observability/trace-recorder.js";

const trace = new TraceRecorder("分析张三并给出跟进建议");

const llm = trace.startSpan({ name: "llm.turn.1", kind: "llm" });
trace.endSpan(llm, "ok", undefined, { inputTokens: 320, outputTokens: 88 });

const tool = trace.startSpan({ name: "tool.search_customer", kind: "tool" });
trace.endSpan(tool, "ok");

const result = trace.finish("ok");
console.log(JSON.stringify(result, null, 2));
console.log(JSON.stringify(summarizeTrace(result), null, 2));
