import type { PlannerAction, PlannerState } from "./types.js";

export interface Planner {
  planNext(state: PlannerState): Promise<PlannerAction>;
}

export class CustomerPlanner implements Planner {
  async planNext(state: PlannerState): Promise<PlannerAction> {
    const customerObservation = state.observations.find(
      item => item.action === "search_customer"
    );

    if (!customerObservation) {
      return {
        type: "search_customer",
        input: {
          name: "张三"
        }
      };
    }

    const customer = customerObservation.result as {
      id: string;
      product: string;
    };

    const chatObservation = state.observations.find(
      item => item.action === "search_chat_history"
    );

    if (!chatObservation) {
      return {
        type: "search_chat_history",
        input: {
          customerId: customer.id
        }
      };
    }

    const chat = chatObservation.result as {
      concern: string;
    };

    const knowledgeObservation = state.observations.find(
      item => item.action === "search_knowledge"
    );

    if (!knowledgeObservation) {
      return {
        type: "search_knowledge",
        input: {
          query: `${customer.product} ${chat.concern}`
        }
      };
    }

    return {
      type: "finish",
      input: {
        answer:
          "客户主要顾虑是学习时间。" +
          "建议重点说明周末班安排，" +
          "而不是继续强调价格优惠。"
      }
    };
  }
}
