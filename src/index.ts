import "dotenv/config";
import Fastify from "fastify";
import { checkDuplicatedWebhook, releaseWebhookKey } from "@/utils/check-duplicated-webhook";
import { verifyWebhookSignature } from "@/utils/verify-webhook-signature";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/utils/rate-limit";
import { publishMessage, verifyQStashSignature } from "@/services/qstash";
import { sendWhatsappMessage } from "@/services/zernio";
import { bot, zernioAdapter } from "@/assistant/bot";
import type { ZernioWebhookPayload, ZernioRawMessage } from "@zernio/chat-sdk-adapter";

let isShuttingDown = false;

const port = parseInt(process.env.PORT || "3000");
const fastify = Fastify({
  logger: {
    level: "error",
  },
});

fastify.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
  // @ts-ignore
  request.rawBody = body as string;
  try {
    const json = body.length ? JSON.parse(body as string) : {};
    done(null, json);
  } catch (err) {
    done(err as Error, undefined);
  }
});

fastify.get("/up", async (request, reply) => {
  if (isShuttingDown) {
    return reply.code(503).send({ message: "Shutting down" });
  }
  return { message: "Ok" };
});

fastify.post(
  "/zernio/new-message",
  {
    preHandler: async (request, reply) => {
      const { "x-zernio-event-id": eventId, "x-zernio-event": eventName, "x-zernio-signature": signature } = request.headers;
      if (!eventId || !eventName || !signature) {
        return reply.code(400).send({ message: "Invalid headers" });
      }

      const isValidSignature = verifyWebhookSignature({
        // @ts-ignore
        rawBody: request.rawBody,
        signature: signature as string,
      });
      if (!isValidSignature) {
        return reply.code(401).send({ message: "Invalid signature" });
      }

      const isDuplicated = await checkDuplicatedWebhook({ eventId: eventId! as string });
      if (isDuplicated) {
        return reply.code(200).send({ message: "Event already processed" });
      }
      if (eventName !== "message.received") {
        return reply.code(400).send({ message: "Invalid event name" });
      }
    },
  },
  async (request, reply) => {
    const payload = request.body as unknown as ZernioWebhookPayload;
    const { message, account } = payload;
    const eventId = request.headers["x-zernio-event-id"] as string;

    const ALLOWED_PHONES = (process.env.ALLOWED_PHONES ?? "")
      .split(",")
      .map((phone) => phone.trim())
      .filter(Boolean);

    const isEligibleMessage =
      message.platform === "whatsapp" &&
      message.direction === "incoming" &&
      !!message.sender.phoneNumber &&
      (ALLOWED_PHONES.length === 0 || ALLOWED_PHONES.includes(message.sender.phoneNumber));

    if (isEligibleMessage) {
      try {
        const rateLimit = await checkRateLimit(`${account.id}-${message.sender.phoneNumber!}`);
        if (rateLimit.limited) {
          if (rateLimit.notify) {
            await sendWhatsappMessage({
              conversationId: message.conversationId,
              accountId: payload.account.id,
              message: RATE_LIMIT_MESSAGE,
            });
          }
        } else {
          await publishMessage({ payload, deduplicationId: message.id });
        }
      } catch (error) {
        console.error("[Webhook] Failed to publish message to QStash:", error);
        // The event was marked as seen in the preHandler but never made it
        // to the queue: release the key so Zernio's retry isn't dropped as
        // a duplicate, and ask it to retry.
        await releaseWebhookKey({ eventId });
        return reply.code(503).send({ message: "Failed to enqueue message, please retry" });
      }
    }

    return reply.code(200).send({ message: "Webhook received" });
  },
);

fastify.post(
  "/qstash/new-message",
  {
    preHandler: async (request, reply) => {
      const signature = request.headers["upstash-signature"];
      if (!signature) {
        return reply.code(401).send({ message: "Missing QStash signature" });
      }

      try {
        await verifyQStashSignature({
          signature: signature as string,
          body: (request as any).rawBody as string,
        });
      } catch {
        return reply.code(401).send({ message: "Invalid QStash signature" });
      }
    },
  },
  async (request, reply) => {
    const payload = request.body as unknown as ZernioWebhookPayload;

    const threadId = zernioAdapter.encodeThreadId({
      accountId: payload.account.id,
      conversationId: payload.message.conversationId,
    });

    const rawMessage: ZernioRawMessage = payload.metadata ? { ...payload.message, metadata: payload.metadata } : payload.message;
    const factory = async () => zernioAdapter.parseMessage(rawMessage);

    try {
      await bot.processMessage(zernioAdapter, threadId, factory);
    } catch (err) {
      return reply.code(500).send({ message: "Message processing failed" });
    }
    return reply.code(200).send({ message: "Message processed" });
  },
);

// Start server
const start = async () => {
  try {
    await bot.initialize();
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`Chatbot Agent service ready and listening on port ${process.env.PORT || 3000}!`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

const SHUTDOWN_TIMEOUT = 30000;
const LB_DRAIN_DELAY = 5000;

async function shutdown(signal: "SIGTERM" | "SIGINT") {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}. Starting graceful shutdown...`);

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Shutdown timeout reached")), SHUTDOWN_TIMEOUT);
  });

  try {
    await Promise.race([
      (async () => {
        // Let the load balancer stop routing new traffic (/up already returns 503).
        await new Promise<void>((resolve) => setTimeout(resolve, LB_DRAIN_DELAY));
        console.log("LB drain delay elapsed. Closing Fastify (waiting for in-flight requests)...");

        // fastify.close() stops accepting new connections and waits for
        // in-flight requests (e.g. /qstash/new-message) to finish.
        await fastify.close();
        console.log("Fastify server closed.");
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
  } finally {
    clearTimeout(timeoutId!);
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
