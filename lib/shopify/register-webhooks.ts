import { DeliveryMethod, Session } from "@shopify/shopify-api";
import { setupGDPRWebHooks } from "./gdpr";
import shopify from "./initialize-context";
import { AppInstallations } from "../db/app-installations";

let webhooksInitialized = false;

export function addHandlers() {
  if (!webhooksInitialized) {
    setupGDPRWebHooks("/api/webhooks");
    shopify.webhooks.addHandlers({
      ["APP_UNINSTALLED"]: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/api/webhooks",
        callback: async (_topic, shop, _body) => {
          console.log("Uninstalled app from shop: " + shop);
          await AppInstallations.delete(shop);
        },
      },
      ["ORDERS_CREATE"]: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/api/webhooks/orderchanged",
        // callback: async (topic, shop, webhookRequestBody) => {
        //   try {

        //     const webhookBody = JSON.parse(webhookRequestBody);
        //     console.log("orderCreate", webhookBody);


        //   } catch (e) {
        //     console.log(e);
        //   }
        // },
      },
      ["ORDERS_UPDATED"]: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/api/webhooks/orderchanged",
      },
      ["ORDERS_EDITED"]: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/api/webhooks/orderchanged",
      },
    });
    console.log("Added handlers");
    webhooksInitialized = true;
  } else {
    console.log("Handlers already added");
  }
}

export async function registerWebhooks(session: Session) {
  addHandlers();
  const responses = await shopify.webhooks.register({ session });
  for (const [topic, results] of Object.entries(responses)) {
    for (const result of results) {
      if (result.success) {
        console.log(`Webhook registered: ${topic}`, result.result);
      } else {
        console.error(`Webhook registration failed: ${topic}`, result.result);
      }
    }
  }
  return responses;
}
