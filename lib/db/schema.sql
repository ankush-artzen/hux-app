-- Shopify order ↔ Sevdesk invoice tracking (test / production)
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY,
  email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  sevdesk_invoice_id TEXT,
  shop_domain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refunds (
  id BIGINT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  creditnote_id TEXT,
  amount NUMERIC(12, 2),
  paid BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds (order_id);
