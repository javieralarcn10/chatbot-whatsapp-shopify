// Add your store's custom metafields here if needed, for example:
//   subtitle: metafield(namespace: "custom", key: "subtitle") {
//     value
//     type
//   }
// Remember to also update src/shopify/formatters.ts to expose them in the response.
const PRODUCT_SUMMARY_FIELDS = `
  id
  title
  onlineStoreUrl
  description
  availableForSale
  options(first: 50) {
    name
    optionValues {
      name
    }
  }
  priceRange {
    minVariantPrice {
      amount
      currencyCode
    }
    maxVariantPrice {
      amount
      currencyCode
    }
  }
`;

export const SEARCH_PRODUCTS = `
  query SearchProducts($query: String!, $first: Int!) {
    search(query: $query, types: [PRODUCT], first: $first) {
      nodes {
        ... on Product {
          ${PRODUCT_SUMMARY_FIELDS}
        }
      }
    }
  }
`;

export const GET_PRODUCT_RECOMMENDATIONS = `
  query ProductRecommendations($productId: ID!, $intent: ProductRecommendationIntent) {
    productRecommendations(productId: $productId, intent: $intent) {
      ${PRODUCT_SUMMARY_FIELDS}
    }
  }
`;

// Same as above: add variant-level metafields here if your catalog uses them
// (for example, technical sheet, composition, sizes, etc.).
const PRODUCT_DETAILS_FIELDS = `
  ${PRODUCT_SUMMARY_FIELDS}
  variants(first: 100) {
    edges {
      node {
        id
        title
        sku
        availableForSale
        selectedOptions {
          name
          value
        }
        price {
          amount
          currencyCode
        }
      }
    }
  }
`;

export const GET_PRODUCT_BY_ID = `
  query GetProductById($id: ID!) {
    product(id: $id) {
      ${PRODUCT_DETAILS_FIELDS}
    }
  }
`;

export const CREATE_CART = `
  mutation CreateCart($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        totalQuantity
        cost {
          subtotalAmount {
            amount
            currencyCode
          }
          totalAmount {
            amount
            currencyCode
          }
        }
        lines(first: 50) {
          edges {
            node {
              id
              quantity
              merchandise {
                ... on ProductVariant {
                  id
                  title
                  sku
                  product {
                    title
                  }
                }
              }
              cost {
                totalAmount {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
      userErrors {
        field
        message
        code
      }
      warnings {
        code
        message
      }
    }
  }
`;

export const LIST_COLLECTIONS = `
  query ListCollections($first: Int!, $productsFirst: Int!) {
    collections(first: $first) {
      edges {
        node {
          id
          title
          handle
          products(first: $productsFirst) {
            edges {
              node {
                id
                title
                handle
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`;

export const SEARCH_ORDERS = `
  query SearchOrders($query: String!, $first: Int!) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          phone
          email
          createdAt
          displayFinancialStatus
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                sku
                variantTitle
              }
            }
          }
          customer {
            displayName
            phone
            email
          }
          shippingAddress {
            zip
            phone
            city
            province
            country
          }
          fulfillments {
            status
            displayStatus
            createdAt
            deliveredAt
            trackingInfo {
              url
            }
          }
        }
      }
    }
  }
`;
