import type {
  AgentMessage,
  LLMProvider,
  LLMRequest,
  MockRawLLMResponse
} from "../types.js";
import { createId } from "../../shared/utils.js";

function lastUserMessage(messages: AgentMessage[]): string {
  return [...messages].reverse().find(m => m.role === "user")?.content ?? "";
}

function toolResult(messages: AgentMessage[], name: string): string | undefined {
  return [...messages].reverse().find(m => m.role === "tool" && m.name === name)?.content;
}

export class MockLLMProvider implements LLMProvider {
  async generate(request: LLMRequest): Promise<MockRawLLMResponse> {
    switch (request.task) {
      case "lead_analysis":
        return this.leadAnalysis(request);
      case "memory_extract":
        return this.memoryExtract(request);
      case "agent_turn":
        return this.agentTurn(request);
      case "intent_classification":
        return this.intentClassification(request);
      case "answer_with_context":
        return this.answerWithContext(request);
    }
  }

  private leadAnalysis(request: LLMRequest): MockRawLLMResponse {
    const text = lastUserMessage(request.messages);
    const high = /报名|价格|课程|想学|想了解/.test(text);
    const low = /不需要|没兴趣|别联系/.test(text);
    const intent = low ? "low" : high ? "high" : "medium";

    return {
      output: [{ type: "text", text: "Lead analysis completed." }],
      structured: {
        intent,
        reason: low
          ? "用户明确拒绝"
          : high
            ? "用户表达了明确课程兴趣"
            : "存在一定兴趣，但信息不足",
        nextAction: low ? "ignore" : high ? "sales_follow_up" : "later_follow_up",
        confidence: 0.9
      }
    };
  }

  private memoryExtract(request: LLMRequest): MockRawLLMResponse {
    const text = lastUserMessage(request.messages);
    const memories: Array<Record<string, unknown>> = [];

    if (/下午.*联系|联系.*下午/.test(text)) {
      memories.push({
        type: "preference",
        key: "contactTime",
        value: "afternoon",
        confidence: 0.98,
        source: "user_explicit"
      });
    }

    if (/担心.*就业|就业.*担心|找工作/.test(text)) {
      memories.push({
        type: "interest",
        key: "mainConcern",
        value: "employment",
        confidence: 0.92,
        source: "user_explicit"
      });
    }

    const name = text.match(/我叫([\u4e00-\u9fa5A-Za-z]{2,12})/);
    if (name) {
      memories.push({
        type: "identity",
        key: "name",
        value: name[1],
        confidence: 0.99,
        source: "user_explicit"
      });
    }

    return { output: [], structured: memories };
  }

  private agentTurn(request: LLMRequest): MockRawLLMResponse {
    const text = lastUserMessage(request.messages);
    const searched = toolResult(request.messages, "search_customer");
    const reminded = toolResult(request.messages, "create_reminder");

    if (!searched && /查|客户|张三|李四/.test(text)) {
      const keyword = text.includes("李四") ? "李四" : "张三";
      return {
        output: [
          {
            type: "tool_call",
            id: createId("call"),
            name: "search_customer",
            arguments: { keyword }
          }
        ]
      };
    }

    if (searched && /提醒|跟进/.test(text) && !reminded) {
      let customer: { id?: string; intent?: string; name?: string } = {};
      try {
        customer = JSON.parse(searched) as typeof customer;
      } catch {
        // 教学 Mock：解析失败时走最终回答。
      }

      if (customer.intent === "high") {
        return {
          output: [
            {
              type: "tool_call",
              id: createId("call"),
              name: "create_reminder",
              arguments: {
                customerId: customer.id ?? "unknown",
                topic: `跟进${customer.name ?? "客户"}`,
                time: "tomorrow 15:00",
                idempotencyKey: `${customer.id ?? "unknown"}:tomorrow-15`
              }
            }
          ]
        };
      }
    }

    if (reminded) {
      return {
        output: [{ type: "text", text: "已查询客户并创建了跟进提醒。" }]
      };
    }

    if (searched) {
      return {
        output: [{ type: "text", text: `客户查询完成：${searched}` }]
      };
    }

    return { output: [{ type: "text", text: "这轮不需要调用工具。" }] };
  }

  private intentClassification(request: LLMRequest): MockRawLLMResponse {
    const conversation = String(request.context?.conversation ?? "");
    const intent = /想了解|想学|报名|价格/.test(conversation)
      ? "high"
      : /没兴趣|不需要/.test(conversation)
        ? "low"
        : "medium";

    return {
      output: [],
      structured: {
        intent,
        reason: `根据客户备注判断为 ${intent}`
      }
    };
  }

  private answerWithContext(request: LLMRequest): MockRawLLMResponse {
    const memory = request.context?.memory as Array<{ key: string; value: unknown }> | undefined;
    const knowledge = request.context?.knowledge as Array<{ title: string; content: string }> | undefined;

    if (knowledge?.length) {
      return {
        output: [
          {
            type: "text",
            text: `根据《${knowledge[0].title}》：${knowledge[0].content}`
          }
        ]
      };
    }

    if (memory?.length) {
      const readable = memory.map(m => `${m.key}=${String(m.value)}`).join("，");
      return { output: [{ type: "text", text: `我检索到的相关记忆是：${readable}` }] };
    }

    return { output: [{ type: "text", text: "当前上下文没有足够信息。" }] };
  }
}
