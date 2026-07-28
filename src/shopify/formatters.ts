const FULFILLMENT_STATUS_LABELS: Record<string, string> = {
  SUCCESS: "Preparando envío",
  FULFILLED: "Preparando envío",
  ATTEMPTED_DELIVERY: "Intento de entrega",
  CONFIRMED: "Confirmado",
  DELAYED: "Retrasado",
  DELIVERED: "Entregado",
  FAILURE: "Fallo en la entrega",
  IN_TRANSIT: "En tránsito",
  LABEL_PRINTED: "Etiqueta impresa",
  LABEL_PURCHASED: "Etiqueta comprada",
  OUT_FOR_DELIVERY: "En reparto",
  PICKED_UP: "Recogido",
  READY_FOR_PICKUP: "Depositado en punto pickup / listo para recoger",
  SUBMITTED: "Enviado al transportista",
};

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

export function buildPhoneSearchQuery(phone: string): string {
  const normalized = normalizePhone(phone).replace(/^\+/, "");
  return `phone:*${normalized}* OR phone:${normalized}`;
}

export function toProductGid(productId: string): string {
  if (productId.startsWith("gid://")) return productId;
  return `gid://shopify/Product/${productId}`;
}

export function toVariantGid(variantId: string): string {
  if (variantId.startsWith("gid://")) return variantId;
  return `gid://shopify/ProductVariant/${variantId}`;
}

export function formatFulfillmentStatus(status?: string | null): string | null {
  if (!status) return null;
  return FULFILLMENT_STATUS_LABELS[status] ?? status;
}

export function formatSearchProduct(product: any) {
  return {
    id: product.id,
    title: product.title,
    onlineStoreUrl: product.onlineStoreUrl,
    description: product.description,
    availableForSale: product.availableForSale,
    options: (product.options ?? []).map((option: any) => ({
      name: option.name,
      values: option.optionValues?.map(({ name }: any) => name) ?? [],
    })),
    priceRange: product.priceRange,
    // If you add custom metafields in queries.ts, map them here.
  };
}

export function formatVariant(variant: any) {
  return {
    id: variant.id,
    title: variant.title,
    sku: variant.sku,
    availableForSale: variant.availableForSale,
    selectedOptions: variant.selectedOptions,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    image: variant.image,
    // If you add custom variant-level metafields in queries.ts, map them here.
  };
}

export function formatProductDetails(product: any) {
  if (!product) return null;

  return {
    ...formatSearchProduct(product),
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    featuredImage: product.featuredImage,
    variants: product.variants?.edges?.map(({ node }: any) => formatVariant(node)) ?? [],
  };
}

export function formatCollectionProduct(product: any) {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    availableForSale: product.availableForSale,
  };
}

export function formatCollection(collection: any) {
  return {
    id: collection.id,
    title: collection.title,
    handle: collection.handle,
    products: collection.products?.edges?.map(({ node }: any) => formatCollectionProduct(node)) ?? [],
  };
}

export function formatOrderSummary(order: any) {
  if (!order) return null;

  return {
    id: order.id,
    name: order.name,
    phone: normalizePhone(order.shippingAddress?.phone || order.customer?.phone || order.phone || ""),
    email: order.email || order.customer?.email,
    createdAt: order.createdAt,
    displayFinancialStatus: order.displayFinancialStatus,
    customer: order?.customer?.displayName,
    shippingAddress: order.shippingAddress,
    lineItems:
      order.lineItems?.edges?.map(({ node }: any) => ({
        title: node.title,
        quantity: node.quantity,
        sku: node.sku,
        variantTitle: node.variantTitle,
      })) ?? [],
    fulfillments: (order.fulfillments ?? []).map((fulfillment: any) => ({
      displayStatus: formatFulfillmentStatus(fulfillment.displayStatus ?? fulfillment.status),
      createdAt: fulfillment.createdAt,
      deliveredAt: fulfillment.deliveredAt,
      trackingUrl: fulfillment?.trackingInfo?.at(0)?.url ?? null,
    })),
  };
}
