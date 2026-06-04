import "@shopify/shopify-api/adapters/web-api";
import {
  shopifyApi,
  LATEST_API_VERSION,
  LogSeverity,
} from "@shopify/shopify-api";

function resolveHostName(): string {
  const fromHost = process.env.HOST?.replace(/https?:\/\//, "");
  if (fromHost) return fromHost;
  const fromVercel = process.env.VERCEL_URL?.replace(/https?:\/\//, "");
  if (fromVercel) return fromVercel;
  // `next build` imports API routes; HOST is set at runtime by CLI/Vercel
  return "build-placeholder.local";
}

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  scopes: process.env.SCOPES?.split(",") || ["write_products"],
  hostName: resolveHostName(),
  hostScheme: "https",
  isEmbeddedApp: true,
  apiVersion: LATEST_API_VERSION,
  logger: {
    level:
      process.env.NODE_ENV === "development"
        ? LogSeverity.Debug
        : LogSeverity.Error,
  },
});

export default shopify;
