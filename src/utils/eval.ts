import { generateText, Output, APICallError, NoOutputGeneratedError } from "ai";
import { z } from "zod";

const negativeMessageSchema = z.object({
  isNegative: z
    .boolean()
    .describe(
      "true si el mensaje del usuario tiene un tono negativo (queja, enfado, frustración, insulto, sarcasmo agresivo, amenaza, etc.), false si es neutro, informativo o una duda normal",
    ),
  reason: z.string().describe("breve explicación en español (máx. 1 frase) de por qué el mensaje se considera negativo o no"),
});

export async function evalUserMessage(message: string): Promise<{ isNegative: boolean; reason: string } | null> {
  if (!message?.trim() || message.length < 3) return null;

  try {
    const { output } = await generateText({
      model: "openai/gpt-4.1-mini",
      providerOptions: {
        gateway: {
          models: ["google/gemini-3.5-flash", "zai/glm-5.2"],
          serviceTier: "flex",
        },
      },
      output: Output.object({ schema: negativeMessageSchema }),
      instructions: `
			Eres un moderador que analiza los mensajes que un cliente envía a un chatbot de atención al cliente.
			Determina si el mensaje tiene un tono negativo: quejas, enfado, frustración, insultos, sarcasmo agresivo, amenazas o cualquier expresión clara de descontento hacia el servicio, la empresa o el bot.
			Los mensajes neutros, informativos, con dudas normales o simplemente breves NO se consideran negativos.
			Responde siempre en español.`,
      prompt: message,
    });

    if (!output) return null;
    return output;
  } catch (error) {
    if (NoOutputGeneratedError.isInstance(error)) {
      console.error("[Eval] NoOutputGeneratedError al evaluar el mensaje del usuario");
      if (error.cause) console.error("Cause:", error.cause);
    } else if (APICallError.isInstance(error)) {
      console.error("[Eval] APICallError al evaluar el mensaje del usuario:", error.message);
    } else {
      console.error("[Eval] Error al evaluar el mensaje del usuario:", error);
    }
    return null;
  }
}
