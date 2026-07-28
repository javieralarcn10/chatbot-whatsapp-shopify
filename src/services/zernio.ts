import Zernio from "@zernio/node";

const zernio = new Zernio({ apiKey: process.env.ZERNIO_API_KEY! });

export async function sendWhatsappMessage({
  conversationId,
  accountId,
  message,
}: {
  conversationId: string;
  accountId: string;
  message: string;
}) {
  try {
    const { data } = await zernio.messages.sendInboxMessage({
      path: {
        conversationId,
      },
      body: {
        accountId,
        message,
      },
    });
    return data;
  } catch (error) {
    console.error(`[Zernio] Error sending message: ${error}`);
    throw error;
  }
}
