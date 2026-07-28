import { DownloadError, generateText, NoContentGeneratedError, NoOutputGeneratedError, NoTranscriptGeneratedError, transcribe } from "ai";
import { Message } from "chat";

const ZERNIO_DOWNLOAD_MAX_ATTEMPTS = 3;
const ZERNIO_DOWNLOAD_RETRY_DELAY_MS = 1000;
const ZERNIO_DOWNLOAD_TIMEOUT_MS = 15000;

function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === "fetch failed") return true;

  const cause = (error as { cause?: unknown })?.cause;
  if (cause instanceof Error) {
    if (cause.name === "ConnectTimeoutError" || cause.name === "AbortError") return true;
    const code = (cause as NodeJS.ErrnoException).code;
    if (code && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) return true;
  }

  return false;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadZernioAsset(url: URL) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= ZERNIO_DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
        },
        signal: AbortSignal.timeout(ZERNIO_DOWNLOAD_TIMEOUT_MS),
      });

      if (!res.ok) {
        throw new Error(`Zernio download failed with status ${res.status} for ${url}`);
      }

      return {
        data: new Uint8Array(await res.arrayBuffer()),
        mediaType: res.headers.get("content-type") ?? undefined,
      };
    } catch (error) {
      lastError = error;
      const canRetry = attempt < ZERNIO_DOWNLOAD_MAX_ATTEMPTS && isRetryableDownloadError(error);

      console.error(
        `[downloadZernioAsset] Attempt ${attempt}/${ZERNIO_DOWNLOAD_MAX_ATTEMPTS} failed for ${url}${canRetry ? ", retrying..." : ""}`,
        error,
      );

      if (!canRetry) throw error;

      await delay(ZERNIO_DOWNLOAD_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

export function checkIsAudio(message: Message): boolean {
  if (
    message.attachments.length > 0 &&
    message.attachments[0].type === "audio" &&
    message.attachments[0].url !== undefined &&
    message.attachments[0].url !== ""
  ) {
    return true;
  }
  return false;
}

export async function transcribeAudio(url: string) {
  try {
    const transcript = await transcribe({
      model: "xai/grok-stt",
      providerOptions: {
        gateway: {
          models: ["openai/whisper-1"],
        },
      },
      audio: new URL(url),
      download: ({ url }) => downloadZernioAsset(url),
    });
    if (!transcript.text) {
      throw new Error("No se pudo transcribir el audio");
    }
    return transcript.text;
  } catch (error) {
    if (DownloadError.isInstance(error)) {
      return "Donwload failed";
    } else if (NoTranscriptGeneratedError.isInstance(error)) {
      console.error("NoTranscriptGeneratedError");
      console.error("Cause:", error.cause);
      console.error("Responses:", error.responses);
      return "Donwload failed";
    } else {
      console.error(`[AI SDK] Error transcribing audio: ${error}`);
      throw error;
    }
  }
}

export function checkIsImage(message: Message): boolean {
  if (
    message.attachments.length > 0 &&
    message.attachments[0].type === "image" &&
    message.attachments[0].url !== undefined &&
    message.attachments[0].url !== ""
  ) {
    return true;
  }
  return false;
}

export async function transcribeImage({ url, caption }: { url: string; caption?: string }) {
  try {
    const userText = caption?.trim();
    const promptText = userText
      ? `El usuario envió esta imagen junto con el siguiente mensaje: "${userText}". Ten en cuenta ese mensaje como contexto al analizar la imagen. Describe lo que ves. Si contiene texto, transcríbelo también.`
      : "Analiza esta imagen y describe lo que ves. Si contiene texto, transcríbelo también.";

    const result = await generateText({
      model: "openai/gpt-4.1-mini ",
      providerOptions: {
        gateway: {
          models: ["google/gemini-3.5-flash", "openai/gpt-5.6-luna"],
        },
      },
      instructions: `
			Analiza la imagen adjunta y responde en español.
			1. Describe con detalle lo que ves: objetos, personas, escena, colores y cualquier detalle relevante.
			2. Si hay texto visible en la imagen (carteles, capturas, documentos, etiquetas, etc.), transcríbelo literalmente en una sección aparte titulada "Texto en la imagen:".
			3. Si no hay texto visible, omite esa sección.
			4. Si se te proporciona el mensaje que el usuario escribió junto a la imagen, úsalo como contexto para enfocar la descripción, pero no lo repitas en tu respuesta.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
            {
              type: "file",
              mediaType: "image",
              data: new URL(url),
            },
          ],
        },
      ],
      experimental_download: async (requestedDownloads) => Promise.all(requestedDownloads.map(({ url }) => downloadZernioAsset(url))),
    });

    if (!result.text) {
      throw new Error("No se pudo analizar la imagen");
    }

    return result.text;
  } catch (error) {
    if (DownloadError.isInstance(error)) {
      return "Donwload failed";
    } else if (NoContentGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
      console.error("[AI SDK] No content generated for image analysis");
      if (error.cause) console.error("Cause:", error.cause);
      return "Donwload failed";
    } else {
      console.error(`[AI SDK] Error analyzing image: ${error}`);
      throw error;
    }
  }
}

export function checkIsVideo(message: Message): boolean {
  if (
    message.attachments.length > 0 &&
    message.attachments[0].type === "video" &&
    message.attachments[0].url !== undefined &&
    message.attachments[0].url !== ""
  ) {
    return true;
  }
  return false;
}

export function checkIsPdf(message: Message): boolean {
  if (message.attachments.length === 0) return false;

  const attachment = message.attachments[0];
  if (attachment.type !== "file" || !attachment.url) return false;
  if (attachment.mimeType === "application/pdf") return true;
  if (attachment.url?.toLowerCase().includes(".pdf")) return true;

  return false;
}

export async function transcribePdf({ url, caption }: { url: string; caption?: string }) {
  try {
    const userText = caption?.trim();
    const promptText = userText
      ? `El usuario envió este PDF junto con el siguiente mensaje: "${userText}". Ten en cuenta ese mensaje como contexto al analizar el documento. Extrae y resume el contenido relevante.`
      : "Analiza este documento PDF y extrae su contenido. Si contiene texto, transcríbelo. Resume la información principal.";

    const result = await generateText({
      model: "openai/gpt-4.1-mini ",
      providerOptions: {
        gateway: {
          models: ["google/gemini-3.5-flash", "openai/gpt-5.6-luna"],
        },
      },
      instructions: `
			Analiza el PDF adjunto y responde en español.
			1. Resume el contenido principal del documento.
			2. Si hay texto en el PDF, transcríbelo literalmente en una sección aparte titulada "Texto del documento:".
			3. Si el documento no contiene texto legible, indícalo y describe lo que puedas inferir.
			4. Si se te proporciona el mensaje que el usuario escribió junto al PDF, úsalo como contexto para enfocar el análisis, pero no lo repitas en tu respuesta.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
            {
              type: "file",
              mediaType: "application/pdf",
              data: new URL(url),
            },
          ],
        },
      ],
      experimental_download: async (requestedDownloads) => Promise.all(requestedDownloads.map(({ url }) => downloadZernioAsset(url))),
    });

    if (!result.text) {
      throw new Error("No se pudo analizar el PDF");
    }

    return result.text;
  } catch (error) {
    if (DownloadError.isInstance(error)) {
      return "Donwload failed";
    } else if (NoContentGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
      console.error("[AI SDK] No content generated for PDF analysis");
      if (error.cause) console.error("Cause:", error.cause);
      return "Donwload failed";
    } else {
      console.error(`[AI SDK] Error analyzing PDF: ${error}`);
      throw error;
    }
  }
}
