import { generateText, Output, APICallError, NoOutputGeneratedError } from "ai";
import { z } from "zod";
import { getGithubConfig, getBranchSha, getFileContent, createBranch, updateFile, createPullRequest } from "@/services/github";

// System prompt auto-improvement (OPTIONAL).
//
// When a customer message is marked as negative (see src/utils/eval.ts),
// this utility can automatically analyze the conversation and open a Pull
// Request in GitHub proposing an improvement to the system prompt.
//
// It is disabled by default. To enable it, define the following in your .env:
//   AUTO_IMPROVE_SYSTEM_PROMPT=true
//   GITHUB_TOKEN=<personal access token with "contents" and "pull requests" permissions on the repo>
//   GITHUB_REPO=<owner/repo>            (e.g. "my-organization/chatbot-shopify")
//   GITHUB_BASE_BRANCH=main             (optional, defaults to "main")

const SYSTEM_PROMPT_PATH = "src/assistant/instructions/system-prompt.ts";

export type ConversationMessage = { role: string; content: string };

const improvementSchema = z.object({
  summary: z.string().describe("Resumen en español de qué salió mal en la conversación y qué causó la valoración negativa del cliente."),
  howToImprove: z
    .string()
    .describe("Explicación en español de cómo se debería mejorar el system prompt del bot para evitar que este problema se repita."),
  updatedSystemPrompt: z
    .string()
    .describe(
      `Contenido completo y final del archivo "${SYSTEM_PROMPT_PATH}" con los cambios aplicados, listo para sobrescribir el archivo tal cual (código TypeScript completo, sin bloques de código markdown ni explicaciones adicionales).`,
    ),
});

type Improvement = z.infer<typeof improvementSchema>;

function isAutoImproveEnabled(): boolean {
  return process.env.AUTO_IMPROVE_SYSTEM_PROMPT === "true";
}

async function generateImprovement({
  negativeMessage,
  reason,
  recentMessages,
  currentFileContent,
}: {
  negativeMessage: string;
  reason: string;
  recentMessages: ConversationMessage[];
  currentFileContent: string;
}): Promise<Improvement | null> {
  const conversation = recentMessages.map((m) => `${m.role}: ${m.content}`).join("\n\n");

  try {
    const { output } = await generateText({
      model: "anthropic/claude-sonnet-5",
      providerOptions: {
        gateway: {
          models: ["xai/grok-4.5", "openai/gpt-5.6-terra"],
        },
      },
      reasoning: "high",
      output: Output.object({ schema: improvementSchema }),
      instructions: `
Eres un ingeniero de prompts encargado de mejorar el system prompt de un chatbot de atención al cliente cuando un cliente ha reaccionado de forma negativa.

Se te proporciona:
- El contenido íntegro y actual del archivo "${SYSTEM_PROMPT_PATH}".
- El mensaje del cliente que generó la valoración negativa.
- El motivo por el que ese mensaje se consideró negativo.
- Las últimas mensajes de la conversación como contexto.

Tu tarea:
1. Analiza qué parte del comportamiento del bot (definido por el system prompt) pudo causar o contribuir a la reacción negativa del cliente.
2. Propón cómo mejorar el system prompt para evitar que se repita ese problema, sin romper ninguna de las reglas de seguridad, privacidad o negocio ya existentes.
3. Genera el CONTENIDO COMPLETO Y FINAL del archivo "${SYSTEM_PROMPT_PATH}" con los cambios aplicados. Debes:
   - Mantener la estructura del archivo (comentarios de cabecera, "export const instructions = \`...\`;").
   - Conservar todas las reglas que no estén relacionadas con el problema detectado.
   - Aplicar cambios mínimos y quirúrgicos, no reescribas el prompt entero desde cero.
   - No inventar información de negocio (precios, políticas, nombre de marca) que no esté ya en el archivo original.
   - Si consideras que no hace falta ningún cambio, devuelve el archivo original sin modificar.

Responde siempre en español.

## Contenido actual de "${SYSTEM_PROMPT_PATH}"

${currentFileContent}
`,
      prompt: `
## Mensaje del cliente que generó la valoración negativa

${negativeMessage}

## Motivo de la valoración negativa

${reason}

## Contexto: últimos mensajes de la conversación

${conversation || "(sin contexto adicional disponible)"}
`,
    });

    if (!output) return null;
    return output;
  } catch (error) {
    if (NoOutputGeneratedError.isInstance(error)) {
      console.error("[AutoImprove] NoOutputGeneratedError while generating the system prompt improvement");
      if (error.cause) console.error("Cause:", error.cause);
    } else if (APICallError.isInstance(error)) {
      console.error("[AutoImprove] APICallError while generating the system prompt improvement:", error.message);
    } else {
      console.error("[AutoImprove] Error while generating the system prompt improvement:", error);
    }
    return null;
  }
}

/**
 * Analyzes a negative customer message together with the conversation context and,
 * if auto-improve is enabled (AUTO_IMPROVE_SYSTEM_PROMPT=true + GitHub credentials
 * configured), opens a Pull Request proposing an improvement to the system prompt.
 *
 * Never throws: any failure is logged and swallowed so it doesn't affect the bot flow.
 */
export async function autoImproveSystemPrompt({
  negativeMessage,
  reason,
  recentMessages,
  userKey,
}: {
  negativeMessage: string;
  reason: string;
  recentMessages: ConversationMessage[];
  userKey: string;
}): Promise<void> {
  if (!isAutoImproveEnabled()) return;

  const config = getGithubConfig();
  if (!config) {
    console.error("[AutoImprove] AUTO_IMPROVE_SYSTEM_PROMPT is enabled but GITHUB_TOKEN and/or GITHUB_REPO are missing.");
    return;
  }

  const { token, repo, baseBranch } = config;

  try {
    const { content: currentFileContent, sha: fileSha } = await getFileContent({ repo, path: SYSTEM_PROMPT_PATH, ref: baseBranch, token });

    const improvement = await generateImprovement({ negativeMessage, reason, recentMessages, currentFileContent });
    if (!improvement) return;
    if (improvement.updatedSystemPrompt.trim() === currentFileContent.trim()) {
      console.log(`[AutoImprove][${userKey}] No se proponen cambios en el system prompt.`);
      return;
    }

    const branch = `auto-improve/system-prompt-${Date.now()}`;
    const baseSha = await getBranchSha({ repo, branch: baseBranch, token });
    await createBranch({ repo, branch, fromSha: baseSha, token });
    await updateFile({
      repo,
      path: SYSTEM_PROMPT_PATH,
      branch,
      sha: fileSha,
      content: improvement.updatedSystemPrompt,
      message: "chore: auto-mejora del system prompt tras feedback negativo",
      token,
    });

    const quotedMessage = negativeMessage
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

    const prBody = `## Resumen de lo ocurrido

${improvement.summary}

## Cómo mejorarlo

${improvement.howToImprove}

---

**Mensaje que generó la valoración negativa:**

${quotedMessage}

**Motivo:** ${reason}

_Pull Request generada automáticamente por el sistema de auto-mejora del chatbot. Revisa los cambios antes de mergear._`;

    const prUrl = await createPullRequest({
      repo,
      branch,
      baseBranch,
      title: "Auto-mejora del system prompt tras feedback negativo",
      body: prBody,
      token,
    });

    console.log(`[AutoImprove][${userKey}] Pull Request de auto-mejora creada: ${prUrl}`);
  } catch (error) {
    console.error(`[AutoImprove][${userKey}] Error while running the system prompt auto-improve flow:`, error);
  }
}
