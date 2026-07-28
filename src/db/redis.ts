import Redis from "ioredis";

// Compatible with Upstash Redis: use the "rediss://" (TLS) URL provided in the dashboard.
export const redis = new Redis(process.env.REDIS_URL!);
