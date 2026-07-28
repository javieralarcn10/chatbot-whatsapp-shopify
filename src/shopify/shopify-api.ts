export class ShopifyApiError extends Error {
  status?: number;
  errors?: string[];

  constructor(message: string, { status, errors }: { status?: number; errors?: string[] } = {}) {
    super(message);
    this.name = "ShopifyApiError";
    if (status !== undefined) this.status = status;
    if (errors !== undefined) this.errors = errors;
  }
}

function formatGraphqlError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return JSON.stringify(error);
}

function getShopifyErrors(data: any): string[] {
  if (Array.isArray(data?.errors)) {
    return data.errors.map(formatGraphqlError);
  }
  if (typeof data?.errors === "string") {
    return [data.errors];
  }
  return [];
}

function getShopDomain(): string {
  const domain = process.env.SHOPIFY_DOMAIN;
  if (!domain) {
    throw new ShopifyApiError("SHOPIFY_DOMAIN is not configured.");
  }
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function getApiVersion(): string {
  return process.env.SHOPIFY_API_VERSION ?? "2026-01";
}

async function executeGraphql({
  url,
  headers,
  query,
  variables,
}: {
  url: string;
  headers: Record<string, string>;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data: any = await response.json().catch(() => ({}));
  const errors = getShopifyErrors(data);

  if (!response.ok || errors.length > 0) {
    throw new ShopifyApiError(errors.join("; ") || `Shopify request failed with status ${response.status}`, {
      status: response.status,
      errors,
    });
  }

  return data.data;
}

export async function storefrontGraphql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const shopDomain = getShopDomain();
  const apiVersion = getApiVersion();
  const url = `https://${shopDomain}/api/${apiVersion}/graphql.json`;

  const token = process.env.SHOPIFY_STORE_FRONT_TOKEN;
  if (!token) {
    throw new ShopifyApiError("SHOPIFY_STORE_FRONT_TOKEN is not configured.");
  }

  return executeGraphql({
    url,
    headers: {
      "X-Shopify-Storefront-Access-Token": token,
    },
    query,
    variables,
  });
}

export async function adminGraphql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const shopDomain = getShopDomain();
  const apiVersion = getApiVersion();
  const url = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!token) {
    throw new ShopifyApiError("SHOPIFY_ACCESS_TOKEN is not configured.");
  }

  return executeGraphql({
    url,
    headers: {
      "X-Shopify-Access-Token": token,
    },
    query,
    variables,
  });
}
