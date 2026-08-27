export type WorkflowStep =
  | "LOAD_CUSTOMER"
  | "CHECK_INTENT"
  | "CHECK_FOLLOWUP"
  | "CREATE_FOLLOWUP"
  | "WRITE_LOG"
  | "SEND_NOTIFICATION"
  | "WAITING_APPROVAL"
  | "DONE"
  | "FAILED";

export type StepStatus = "pending" | "running" | "success" | "failed" | "waiting";

export type StepRecord = {
  step: WorkflowStep;
  status: StepStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export type WorkflowCustomer = {
  id: string;
  name: string;
  phone: string;
  notes: string;
  intent?: "high" | "medium" | "low";
};

export type Approval = {
  status: "pending" | "approved" | "rejected";
  reviewerId?: string;
  reviewedAt?: string;
  comment?: string;
};

export type WorkflowState = {
  requestId: string;
  userId: string;
  customerKeyword: string;
  currentStep: WorkflowStep;
  customer?: WorkflowCustomer;
  followupExists?: boolean;
  followupId?: string;
  approval?: Approval;
  steps: Partial<Record<WorkflowStep, StepRecord>>;
  history: WorkflowStep[];
  error?: { step: WorkflowStep; message: string };
};
