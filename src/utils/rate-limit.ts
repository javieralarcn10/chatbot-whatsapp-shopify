import { redis } from "@/db/redis";

// Layer 1: message window restrictions per user.
const BURST_WINDOW_SEC = 2 * 60; // 2 minutes
const BURST_LIMIT = 30; // max. 30 messages every 2 minutes

const DAILY_WINDOW_SEC = 24 * 60 * 60; // 24 hours
const DAILY_LIMIT = 150; // max. 150 messages per day

// Layer 3: temporary block after repeated offenses.
const STRIKES_WINDOW_SEC = 30 * 60; // 30 minutes
const STRIKES_LIMIT = 3; // 3 infractions in that hour -> block
const BLOCK_TTL_SEC = 24 * 60 * 60; // blocked for 24 hours

export const RATE_LIMIT_MESSAGE = "Has alcanzado el límite de mensajes permitidos. Por favor, vuelve a intentarlo mañana.";

export type RateLimitResult = {
  /** true if this message should not be processed (don't call the AI either). */
  limited: boolean;
  /** true if the user should be notified (only notify once per period). */
  notify: boolean;
};

function keysFor(userKey: string) {
  return {
    burst: `ratelimit:burst:${userKey}`,
    daily: `ratelimit:daily:${userKey}`,
    strikes: `ratelimit:strikes:${userKey}`,
    blocked: `ratelimit:blocked:${userKey}`,
    notified: `ratelimit:notified:${userKey}`,
  };
}

async function incrWithExpire(key: string, ttlSec: number): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttlSec);
  return count;
}

/** Marks the user as notified. Returns true only the first time (avoids repeated notifications in a loop). */
async function markNotified(userKey: string, ttlSec: number): Promise<boolean> {
  const result = await redis.set(keysFor(userKey).notified, "1", "EX", ttlSec, "NX");
  return result !== null;
}

/**
 * Checks if the user can keep using the AI service or if their
 * message limits have been exceeded. Should be called BEFORE transcribing/analysing attachments
 * or invoking the agent, to avoid spending tokens on limited users.
 *
 * Fail-open: if Redis fails, let the message through (better to allow one extra message than not reply to legit users).
 */
export async function checkRateLimit(userKey: string): Promise<RateLimitResult> {
  try {
    const { blocked, strikes } = keysFor(userKey);

    // Already blocked due to repeated offenses (layer 3).
    if (await redis.exists(blocked)) {
      return { limited: true, notify: await markNotified(userKey, BLOCK_TTL_SEC) };
    }

    const [burstCount, dailyCount] = await Promise.all([
      incrWithExpire(keysFor(userKey).burst, BURST_WINDOW_SEC),
      incrWithExpire(keysFor(userKey).daily, DAILY_WINDOW_SEC),
    ]);

    if (burstCount <= BURST_LIMIT && dailyCount <= DAILY_LIMIT) {
      return { limited: false, notify: false };
    }

    // Limit exceeded (layer 1): counts as an infraction towards automatic block.
    const strikeCount = await incrWithExpire(strikes, STRIKES_WINDOW_SEC);
    if (strikeCount >= STRIKES_LIMIT) {
      await redis.set(blocked, "1", "EX", BLOCK_TTL_SEC);
      await redis.del(strikes);
      return { limited: true, notify: await markNotified(userKey, BLOCK_TTL_SEC) };
    }

    return { limited: true, notify: await markNotified(userKey, DAILY_WINDOW_SEC) };
  } catch (error) {
    console.error("[RateLimit] Error checking rate limit, allowing message through:", error);
    return { limited: false, notify: false };
  }
}
