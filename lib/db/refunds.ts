/** Matches production `refunds` table: id, order_id, creditnote_id, amount, paid */
export type RefundRow = {
  id: number;
  order_id: number;
  creditnote_id: string | null;
  amount: number | null;
  paid: boolean;
};

export function toRefundRow(result: {
  id: number | string;
  order_id: number | string;
  paid: boolean;
  amount?: number | string | null;
  creditnote_id?: string | number | null;
}): RefundRow {
  const amount =
    result.amount == null ? null : Number(parseFloat(String(result.amount)));

  return {
    id: Number(result.id),
    order_id: Number(result.order_id),
    paid: Boolean(result.paid),
    amount: amount != null && !Number.isNaN(amount) ? amount : null,
    creditnote_id:
      result.creditnote_id != null ? String(result.creditnote_id) : null,
  };
}
