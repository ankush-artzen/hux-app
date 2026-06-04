import { NextResponse } from "next/server";
import { createSevDeskApi } from "@/lib/sevdesk/client";
import { getSevDeskConfig, invoiceDetailUrl } from "@/lib/sevdesk/config";

export const dynamic = "force-dynamic";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("id");

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400, headers },
      );
    }

    const sevDeskApi = createSevDeskApi();
    const invoices = await sevDeskApi.getInvoiceByOrderId(orderId);
    const invoice = Array.isArray(invoices) ? invoices[0] : undefined;

    if (invoice) {
      return NextResponse.json(
        { url: invoiceDetailUrl(invoice.id) },
        { status: 200, headers },
      );
    }

    const { appUrl } = getSevDeskConfig();
    return NextResponse.json({ url: appUrl }, { status: 200, headers });
  } catch (error) {
    console.error("Error fetching invoice:", error);
    const { appUrl } = getSevDeskConfig();
    return NextResponse.json({ url: `${appUrl}/` }, { status: 500, headers });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers,
  });
}
