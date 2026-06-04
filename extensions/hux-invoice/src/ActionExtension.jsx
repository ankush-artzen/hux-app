import {
  extension,
  AdminAction,
  BlockStack,
  Button,
  Text,
  Link,
} from "@shopify/ui-extensions/admin";

const TARGET = "admin.order-details.action.render";

export default extension(TARGET, async (root, api) => {
  const orderNumber = api.data?.selected?.[0]?.id?.split("/").pop();
  let invoiceUrl;

  if (orderNumber) {
    try {
      const response = await fetch(`/api/getinvoiceid?id=${orderNumber}`);
      const result = await response.json();
      invoiceUrl = result.url;
    } catch (error) {
      console.error("Error fetching invoice URL:", error);
    }
  }

  const content = [
    root.createComponent(
      Text,
      { fontWeight: "bold" },
      "Check the invoice for your order here",
    ),
  ];

  if (invoiceUrl) {
    content.push(
      root.createComponent(Link, { href: invoiceUrl }, "Open invoice in Sevdesk"),
    );
  } else {
    content.push(
      root.createComponent(
        Text,
        {},
        orderNumber
          ? "No URL received from Sevdesk server."
          : "Loading...",
      ),
    );
  }

  root.append(
    root.createComponent(
      AdminAction,
      {
        secondaryAction: root.createComponent(
          Button,
          { onPress: () => api.close() },
          "Close",
        ),
      },
      [root.createComponent(BlockStack, {}, content)],
    ),
  );
});
