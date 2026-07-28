import crypto from "crypto";

export function verifyWebhookSignature({ rawBody, signature }: { rawBody: string; signature: string }): boolean {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("ZERNIO_WEBHOOK_SECRET is not set");
  }

  const computedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const computedBuffer = Buffer.from(computedSignature);

  // Lengths must match before timingSafeEqual, otherwise it throws
  if (signatureBuffer.length !== computedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, computedBuffer);
}
