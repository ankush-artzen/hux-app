import type SevDeskAPI from "./index";

/** Sevdesk settings for the current environment (test vs production). */
export function getSevDeskConfig() {
  return {
    defaultContact: process.env.SEVDESK_DEFAULT_CONTACT ?? "CPDCustomer",
    userId: process.env.SEVDESK_USER_ID ?? "",
    taxIdStandard: process.env.SEVDESK_TAX_ID_STANDARD ?? "",
    taxIdExempt: process.env.SEVDESK_TAX_ID_EXEMPT ?? "",
    paymentMethodId: process.env.SEVDESK_PAYMENT_METHOD_ID ?? "",
    agbUrl: process.env.SEVDESK_AGB_URL ?? "",
    appUrl: process.env.SEVDESK_APP_URL ?? "https://my.sevdesk.de",
    shopName: process.env.SEVDESK_SHOP_NAME ?? "Shop",
    shopEmail: process.env.SEVDESK_SHOP_EMAIL ?? "",
    shopDomain: process.env.SEVDESK_SHOP_DOMAIN ?? "",
    shopAddress: process.env.SEVDESK_SHOP_ADDRESS ?? "",
  };
}

export function requireSevDeskApiKey(): string {
  const apiKey = process.env.SEVDESK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("SEVDESK_API_KEY is not set in .env");
  }
  return apiKey;
}

/** Resolves SevUser id from env or first admin user in the connected Sevdesk account. */
export async function resolveSevUserId(
  sevDesk: SevDeskAPI,
): Promise<string | number> {
  const fromEnv = process.env.SEVDESK_USER_ID?.trim();
  if (fromEnv) {
    const asNumber = Number(fromEnv);
    return Number.isNaN(asNumber) ? fromEnv : asNumber;
  }

  const users = await sevDesk.getSevUser();
  const first = Array.isArray(users) ? users[0] : undefined;
  if (first?.id != null) {
    return first.id;
  }

  throw new Error(
    "Set SEVDESK_USER_ID in .env (Sevdesk → Settings → Users, use the user id from the API)",
  );
}

export function invoiceDetailUrl(invoiceId: string | number): string {
  const base = getSevDeskConfig().appUrl.replace(/\/$/, "");
  return `${base}/#/fi/detail/type/RE/id/${invoiceId}`;
}
