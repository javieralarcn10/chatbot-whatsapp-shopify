import { isStepCount, ModelMessage, ToolLoopAgent, type ToolSet } from "ai";
import { createShopifyTools } from "@/shopify/tools";
import { instructions } from "@/assistant/instructions/system-prompt";
import { phoneNumberContext } from "@/assistant/instructions/context-instructions";
import { memoryPrompt } from "@/assistant/instructions/memory-instructions";
import { whatsappFormat } from "@/assistant/instructions/format-instructions";
import { shopifyInstructions } from "@/assistant/instructions/shopify-instructions";
import { noAiSlopInstructions } from "@/assistant/instructions/no-ai-slop-instructions";
import { supermemoryTools } from "@supermemory/tools/ai-sdk";
import { AiErrorContext, logAiAgentError } from "@/assistant/errors-logging";

async function getAtcAgent({ phoneNumber, accountId }: { phoneNumber: string; accountId: string }): Promise<ToolLoopAgent> {
  try {
    return new ToolLoopAgent({
      model: "openai/gpt-5.6-luna",
      providerOptions: {
        gateway: {
          models: ["google/gemini-3.6-flash", "anthropic/claude-sonnet-5", "openai/gpt-4.1-mini"],
        },
      },
      reasoning: "high",
      stopWhen: isStepCount(10),
      instructions: `${instructions}\n${shopifyInstructions}\n${memoryPrompt}\n${phoneNumberContext(phoneNumber)}\n${whatsappFormat}\n${noAiSlopInstructions}`,
      tools: {
        ...createShopifyTools(phoneNumber),
        ...supermemoryTools(process.env.SUPERMEMORY_API_KEY!, {
          containerTags: [`${accountId}-${phoneNumber}`],
        }),
      } as ToolSet,
    });
  } catch (error) {
    logAiAgentError(error, {
      phoneNumber,
      accountId,
      messageCount: 0,
      phase: "init",
    });
    throw error;
  }
}

export async function generateMessage({
  messages,
  phoneNumber,
  accountId,
}: {
  messages: ModelMessage[];
  phoneNumber: string;
  accountId: string;
}): Promise<string | null> {
  const context: AiErrorContext = {
    phoneNumber,
    accountId,
    messageCount: messages.length,
    phase: "generate",
  };

  try {
    const agent = await getAtcAgent({ phoneNumber, accountId });
    const result = await agent.generate({
      messages,
    });

    if (!result.text) {
      console.error(`[AI Agent] Empty response (account=${accountId}, phone=${phoneNumber}, messages=${messages.length})`);
      return null;
    }

    return result.text;
  } catch (error) {
    logAiAgentError(error, context);
    return null;
  }
}
