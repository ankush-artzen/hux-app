import type Database from "./pg-database";

export async function ensureOrderRecord(
  dataBase: Database,
  order: { id: number | string },
  opts?: { shopDomain?: string | null; sevdeskInvoiceId?: string | number },
) {
  const id = Number(order.id);
  const rows = (await dataBase.selectData("orders", { id })) ?? [];

  if (rows.length === 0) {
    await dataBase.insertData("orders", {
      id,
      email_sent: false,
      sevdesk_invoice_id: opts?.sevdeskInvoiceId
        ? String(opts.sevdeskInvoiceId)
        : null,
      shop_domain: opts?.shopDomain ?? null,
    });
    return;
  }

  if (opts?.sevdeskInvoiceId && !rows[0].sevdesk_invoice_id) {
    await dataBase.updateData(
      "orders",
      {
        sevdesk_invoice_id: String(opts.sevdeskInvoiceId),
        updated_at: new Date(),
      },
      { id },
    );
  }
}
