import { Client, Receiver } from "@upstash/qstash";

const client = new Client({
  baseUrl: process.env.QSTASH_URL!,
  token: process.env.QSTASH_TOKEN!,
  devMode: process.env.NODE_ENV === "development",
});

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
  devMode: process.env.NODE_ENV === "development",
});

export async function verifyQStashSignature({ signature, body, url }: { signature: string; body: string; url?: string }) {
  const verifyRequest = url ? { signature, body, url } : { signature, body };

  return receiver.verify(verifyRequest);
}

export async function publishMessage({ payload, deduplicationId }: { payload: any; deduplicationId: string }) {
  const result = await client.publishJSON({
    url: `${process.env.APP_URL}/qstash/new-message`,
    body: payload,
    retries: 3,
    timeout: 600, //10 minutes,
    deduplicationId,
  });
  return result;
}
