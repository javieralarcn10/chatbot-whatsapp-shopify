import { Chat, Message } from "chat";
import { createZernioAdapter } from "@zernio/chat-sdk-adapter";
import { generateMessage } from "@/assistant/agent";
import { checkIsAudio, checkIsImage, checkIsPdf, checkIsVideo, transcribeAudio, transcribeImage, transcribePdf } from "@/assistant/media";
import { createIoRedisState } from "@chat-adapter/state-ioredis";
import { redis } from "@/db/redis";
import { evalUserMessage } from "@/utils/eval";
import { autoImproveSystemPrompt } from "@/utils/auto-improve-system-prompt";

export const zernioAdapter = createZernioAdapter();

export const bot = new Chat({
  userName: "customer-support-bot",
  adapters: {
    zernio: zernioAdapter,
  },
  state: createIoRedisState({ client: redis }),
  concurrency: {
    strategy: "burst",
    debounceMs: 4000,
  },
  logger: "error",
  identity: ({ author }) => author.userId ?? null,
  transcripts: {
    retention: "45d",
    maxPerUser: 200,
  },
});

async function resolveText(message: Message): Promise<string | null> {
  const text = message.text || "";

  // Text message (not audio, image or pdf)
  if (!checkIsAudio(message) && !checkIsImage(message) && !checkIsPdf(message)) {
    return text;
  }

  // Audio message
  if (checkIsAudio(message)) {
    const url = message.attachments?.[0]?.url as string | undefined;
    if (url) {
      const transcript = await transcribeAudio(url);
      return transcript === "Donwload failed" ? null : transcript;
    }
    return text;
  }

  // Image message, combine caption text with image analysis
  if (checkIsImage(message)) {
    const url = message.attachments?.[0]?.url as string | undefined;
    if (url) {
      const transcript = await transcribeImage({ url, caption: text });
      if (transcript === "Donwload failed") return null;
      return text ? `${text}\n\n${transcript}` : transcript;
    }
    return text;
  }

  // PDF message, combine caption text with document analysis
  if (checkIsPdf(message)) {
    const url = message.attachments?.[0]?.url as string | undefined;
    if (url) {
      const transcript = await transcribePdf({ url, caption: text });
      if (transcript === "Donwload failed") return null;
      return text ? `${text}\n\n${transcript}` : transcript;
    }
    return text;
  }

  return null;
}

bot.onDirectMessage(async (thread, message, channel, context) => {
  const { accountId } = zernioAdapter.decodeThreadId(thread.id);
  await thread.startTyping()

  const skippedText = (
    await Promise.all(
      (context?.skipped ?? []).map(async (skipped) => {
        const text = await resolveText(skipped);
        return text ? `${text}\n\n` : "";
      }),
    )
  ).join("");

  if (checkIsVideo(message)) {
    const errorMessage = "De momento no puedo procesar videos. Por favor envía tu consulta en texto o audio.";
    await thread.post(errorMessage);
    await bot.transcripts.append(thread, { role: "assistant", text: errorMessage }, { userKey: message.userKey! });
    return;
  }

  const text = await resolveText(message);
  if (text === null) {
    const errorMessage = checkIsAudio(message)
      ? "No se pudo transcribir el audio, por favor inténtalo de nuevo o escribe tu mensaje en texto."
      : checkIsImage(message)
        ? "No se pudo analizar la imagen, por favor inténtalo de nuevo o describe tu mensaje en texto."
        : checkIsPdf(message)
          ? "No se pudo analizar el PDF, por favor inténtalo de nuevo o describe tu mensaje en texto."
          : "No se pudo procesar el archivo adjunto, por favor inténtalo de nuevo o escribe tu mensaje en texto.";
    await thread.post(errorMessage);
    await bot.transcripts.append(thread, { role: "assistant", text: errorMessage }, { userKey: message.userKey! });
    return;
  }

  await bot.transcripts.append(thread, { role: "user", text: `${skippedText}${text}` }, { userKey: message.userKey! });

  const recent = await bot.transcripts.list({ userKey: message.userKey!, limit: 20 });
  const response = await generateMessage({
    messages: recent.map((item) => ({ role: item.role, content: item.text })),
    phoneNumber: message.author.userId,
    accountId: accountId,
  });

  if (!response) throw new Error("No response from AI");
  await thread.post(response);
  await bot.transcripts.append(thread, { role: "assistant", text: response }, { userKey: message.userKey! });
  const evalResult = await evalUserMessage(`${skippedText}${text}`);
  if (evalResult) {
    const { isNegative, reason } = evalResult;
    if (isNegative === true) {
      console.log(`[Eval][${message.userKey!}] Mensaje negativo detectado -> "${skippedText}${text}" | Motivo: ${reason}`);

      // Auto-improvement of the system prompt (optional, see src/utils/auto-improve-system-prompt.ts).
      const context = await bot.transcripts.list({ userKey: message.userKey!, limit: 20 });
      void autoImproveSystemPrompt({
        negativeMessage: `${skippedText}${text}`,
        reason,
        recentMessages: context.map((item) => ({ role: item.role, content: item.text })),
        userKey: message.userKey!,
      });
    }
  }
});
