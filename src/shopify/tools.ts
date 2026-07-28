import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { adminGraphql, storefrontGraphql } from "@/shopify/shopify-api";
import {
  buildPhoneSearchQuery,
  formatCollection,
  formatOrderSummary,
  formatProductDetails,
  formatSearchProduct,
  normalizePhone,
  toProductGid,
  toVariantGid,
} from "@/shopify/formatters";
import { CREATE_CART, GET_PRODUCT_BY_ID, GET_PRODUCT_RECOMMENDATIONS, LIST_COLLECTIONS, SEARCH_ORDERS, SEARCH_PRODUCTS } from "./queries";

function formatCartLine({ node }: any) {
  const variant = node.merchandise;
  const title = variant.title === "Default Title" ? variant.product.title : `${variant.product.title} - ${variant.title}`;

  return {
    id: node.id,
    variantId: variant.id,
    title,
    sku: variant.sku,
    quantity: node.quantity,
    lineTotal: node.cost.totalAmount,
  };
}

const searchProducts = tool({
  description: "Busca productos en la tienda Shopify por nombre o término de búsqueda. Usa la Storefront API tokenless.",
  inputSchema: z.object({
    query: z.string().describe("Nombre o término de búsqueda del producto"),
    limit: z.number().int().min(1).max(25).optional().describe("Número máximo de resultados (por defecto 10)"),
  }),
  execute: async ({ query, limit = 10 }) => {
    const data = await storefrontGraphql(SEARCH_PRODUCTS, {
      query,
      first: Math.min(Math.max(limit, 1), 25),
    });

    const products = data.search?.nodes ?? [];

    return {
      query,
      count: products.length,
      products: products.map(formatSearchProduct),
    };
  },
});

const getProductDetails = tool({
  description: "Obtiene la información completa de un producto, incluyendo variantes, precios y disponibilidad.",
  inputSchema: z.object({
    product_id: z.string().describe("ID numérico o GID del producto (gid://shopify/Product/...)"),
  }),
  execute: async ({ product_id }) => {
    const data = await storefrontGraphql(GET_PRODUCT_BY_ID, {
      id: toProductGid(product_id),
    });

    if (!data.product) {
      throw new Error("Producto no encontrado.");
    }

    return formatProductDetails(data.product);
  },
});

const getProductRecommendations = tool({
  description:
    "Devuelve productos relacionados o complementarios a un producto dado, útil para sugerir cross-selling, alternativas o packs. Usa la Storefront API tokenless.",
  inputSchema: z.object({
    product_id: z.string().describe("ID numérico o GID del producto de referencia (gid://shopify/Product/...)"),
    intent: z
      .enum(["RELATED", "COMPLEMENTARY"])
      .optional()
      .describe(
        "RELATED para productos similares/alternativos (por defecto), COMPLEMENTARY para productos que combinan bien con el de referencia",
      ),
  }),
  execute: async ({ product_id, intent = "RELATED" }) => {
    const data = await storefrontGraphql(GET_PRODUCT_RECOMMENDATIONS, {
      productId: toProductGid(product_id),
      intent,
    });

    const products = data.productRecommendations ?? [];

    return {
      product_id,
      intent,
      count: products.length,
      products: products.map(formatSearchProduct),
    };
  },
});

const createCheckout = tool({
  description:
    "Crea un carrito con varios productos mediante cartCreate y devuelve la checkoutUrl para que el cliente finalice la compra. Usa variant_id y quantity de cada producto.",
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          variant_id: z.string().describe("ID numérico o GID de la variante (gid://shopify/ProductVariant/...)"),
          quantity: z.number().int().min(1).describe("Cantidad del producto"),
        }),
      )
      .min(1)
      .describe("Lista de productos para el checkout"),
    discount_codes: z.array(z.string()).optional().describe("Códigos de descuento opcionales para aplicar al carrito"),
  }),
  execute: async ({ items, discount_codes = [] }) => {
    const input: Record<string, unknown> = {
      lines: items.map(({ variant_id, quantity }) => ({
        merchandiseId: toVariantGid(variant_id),
        quantity,
      })),
    };

    if (discount_codes.length > 0) {
      input.discountCodes = discount_codes;
    }

    const data = await storefrontGraphql(CREATE_CART, { input });
    const result = data.cartCreate;
    const userErrors = result?.userErrors ?? [];

    if (userErrors.length > 0) {
      throw new Error(userErrors.map((error: any) => error.message).join("; "));
    }

    const cart = result?.cart;

    if (!cart?.checkoutUrl) {
      throw new Error("No se pudo crear el carrito de checkout.");
    }

    return {
      cartId: cart.id,
      checkoutUrl: cart.checkoutUrl,
      totalQuantity: cart.totalQuantity,
      subtotal: cart.cost.subtotalAmount,
      total: cart.cost.totalAmount,
      items: cart.lines.edges.map(formatCartLine),
      warnings: result.warnings ?? [],
    };
  },
});

const listCollections = tool({
  description: "Lista las colecciones de la tienda Shopify con su título, handle y los productos que contiene. Usa la Storefront API.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(25).optional().describe("Número máximo de colecciones a devolver (por defecto 10)"),
    products_limit: z.number().int().min(1).max(50).optional().describe("Número máximo de productos por colección (por defecto 25)"),
  }),
  execute: async ({ limit = 10, products_limit = 25 }) => {
    const data = await storefrontGraphql(LIST_COLLECTIONS, {
      first: Math.min(Math.max(limit, 1), 25),
      productsFirst: Math.min(Math.max(products_limit, 1), 50),
    });

    const collections = data.collections?.edges?.map(({ node }: any) => formatCollection(node)) ?? [];

    return {
      count: collections.length,
      collections,
    };
  },
});

/**
 * `search_orders` is created per-conversation (see createShopifyTools) using
 * the phone number verified by the inbound webhook. The model no longer
 * supplies (or can override) the phone number: this closes an IDOR where a
 * prompt injection could ask for another customer's orders by passing a
 * different phone number as a tool argument.
 */
function createSearchOrdersTool(verifiedPhone: string) {
  return tool({
    description: "Busca los pedidos del cliente de esta conversación. Usa la Admin API de Shopify.",
    inputSchema: z.object({}),
    execute: async () => {
      const normalizedVerified = normalizePhone(verifiedPhone).replace(/^\+/, "");

      const data = await adminGraphql(SEARCH_ORDERS, {
        query: buildPhoneSearchQuery(verifiedPhone),
        first: 250,
      });

      const orders =
        data.orders?.edges
          ?.map(({ node }: any) => formatOrderSummary(node))
          ?.filter((order: any) => order.phone?.includes(normalizedVerified)) ?? [];

      return {
        count: orders.length,
        orders,
      };
    },
  });
}

/**
 * Builds the Shopify tool set for a single conversation. `verifiedPhone` must
 * come from the authenticated webhook context (never from user-supplied text)
 * so `search_orders` can reject attempts to look up other customers' orders.
 */
export function createShopifyTools(verifiedPhone: string): ToolSet {
  return {
    search_products: searchProducts,
    get_product_details: getProductDetails,
    get_product_recommendations: getProductRecommendations,
    create_checkout: createCheckout,
    list_collections: listCollections,
    search_orders: createSearchOrdersTool(verifiedPhone),
  };
}
