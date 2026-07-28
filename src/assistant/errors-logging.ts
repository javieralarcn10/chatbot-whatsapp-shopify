import { NoContentGeneratedError, NoOutputGeneratedError, APICallError } from "ai";

export type AiErrorContext = {
  phoneNumber: string;
  accountId: string;
  messageCount: number;
  phase: "init" | "generate";
};

export function logAiAgentError(error: unknown, context: AiErrorContext): void {
  const prefix = `[AI Agent] ${context.phase} failed (account=${context.accountId}, phone=${context.phoneNumber}, messages=${context.messageCount})`;

  if (APICallError.isInstance(error)) {
    console.error(prefix);
    console.error("APICallError:", error.message);
    console.error("Status:", error.statusCode);
    console.error("URL:", error.url);
    if (error.responseBody) console.error("Response body:", error.responseBody);
    if (error.cause) console.error("Cause:", error.cause);
    return;
  }

  if (NoOutputGeneratedError.isInstance(error)) {
    console.error(prefix);
    console.error("NoOutputGeneratedError:", error.message);
    if (error.cause) console.error("Cause:", error.cause);
    return;
  }

  if (NoContentGeneratedError.isInstance(error)) {
    console.error(prefix);
    console.error("NoContentGeneratedError:", error.message);
    if (error.cause) console.error("Cause:", error.cause);
    return;
  }

  console.error(prefix);
  console.error(error);
}
