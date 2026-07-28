import { redis } from "@/db/redis";

/**
 * Atomically marks the eventId as seen. Returns true if it was already seen
 * (duplicate -> skip), false if this is the first time (process it).
 *
 * If the processing fails afterwards, the caller MUST call releaseWebhookKey
 * so a nack()'d message can be retried.
 */
export async function checkDuplicatedWebhook({ eventId }: { eventId: string }): Promise<boolean> {
  const TTL_SEC = 60 * 60 * 4; // 4h
  const key = `zernio:event:${eventId}`;
  try {
    const result = await redis.set(key, "1", "EX", TTL_SEC, "NX");
    return result === null;
  } catch (error) {
    console.error("Error checking if event is processed in Redis:", error);
    // Fail-open: better to process a duplicate than lose data
    return false;
  }
}

/**
 * Deletes the idempotency key so the message can be retried after a failure.
 * Safe to call even if the key no longer exists.
 */
export async function releaseWebhookKey({ eventId }: { eventId: string }): Promise<void> {
  const key = `zernio:event:${eventId}`;
  try {
    await redis.del(key);
  } catch (error) {
    console.error("Error releasing webhook key in Redis:", error);
  }
}
