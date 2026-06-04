import { NextResponse } from 'next/server';
import Database from '@/lib/db/pg-database';
import SevDeskAPI from '@/lib/sevdesk';
import SevDesk from '@/lib/sevdesk/service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const dataBase = new Database(process.env.POSTGRES_DATABASE_URL!);
        const body = await request.json();
        const order = body;

        const webhookTopic = request.headers.get('x-shopify-topic');
        const shopDomain = request.headers.get('x-shopify-shop-domain');

        if (!shopDomain) {
            return NextResponse.json(
                { error: 'Order ID is required' },
                { status: 400 }
            );
        }

        if (!order.id) {
            return NextResponse.json(
                { error: 'Order ID is required' },
                { status: 400 }
            );
        }
        console.log("Processing order webhook", webhookTopic);
        console.log(`Processing order ${order.id} from ${shopDomain}`);

        // Date validations
        const orderDate = new Date(order.created_at);
        const cutoffDate = new Date("2023-04-12T17:00:00");
        // const b2bCutoffDate = new Date("2023-05-17T09:30:00");

        // Skip processing for specific cases
        // if (orderDate < b2bCutoffDate && !order.tags?.includes("rebuild")) {
        //     console.log("B2B order created before cutoff date");
        //     return NextResponse.json({ status: 'skipped' }, { status: 200 });
        // }

        if (orderDate < cutoffDate && !order.tags?.includes("rebuild")) {
            console.log("Order created before cutoff date");
            return NextResponse.json({ status: 'skipped' }, { status: 200 });
        }

        // Initialize SevDesk API
        const sevDeskApi = new SevDeskAPI(process.env.SEVDESK_API_KEY!);
        const sevDesk = new SevDesk(sevDeskApi);

        // Customer handling
        const customerId = order.customer?.id || "CPDCustomer";
        let customer = null;

        try {
            const [existingCustomer] = await sevDeskApi.getContactById(customerId);
            console.log("Existing customer:", existingCustomer);
            if (existingCustomer) {
                customer = await sevDesk.updateCustomer(existingCustomer, order, shopDomain);
            } else if (order.customer) {
                customer = await sevDesk.createCustomer(order, shopDomain);
            } else {
                customer = await sevDesk.checkIfDefaultContactExists();
            }

            if (!customer) {
                throw new Error('Failed to process customer');
            }
        } catch (error) {
            console.error('Customer processing error:', error);
            return NextResponse.json(
                { error: 'Customer processing failed' },
                { status: 500 }
            );
        }
        // // test
        // const newInvoice = await sevDesk.createInvoice(order, customer, shopDomain);
        // return NextResponse.json(
        //     { newInvoice },
        //     { status: 200 }
        // );
        // Invoice processing
        try {
            const [existingInvoice] = await sevDeskApi.getInvoiceByOrderId(order.id);
            console.log("Existing Invoice:", existingInvoice);
            if (existingInvoice) {
                // Handle existing invoice (update, cancel, refund, etc.)
                const result = await handleExistingInvoice(
                    existingInvoice,
                    order,
                    customer,
                    shopDomain,
                    sevDesk,
                    sevDeskApi,
                    dataBase
                );
                return NextResponse.json(result, { status: 200 });
            } else {
                const newInvoice = await sevDesk.createInvoice(
                    order,
                    customer,
                    shopDomain
                );

                if (!newInvoice?.id) {
                    throw new Error("Invoice creation failed");
                }

                await sevDeskApi.renderInvoice(newInvoice.id);

                // Handle email notification if needed
                await handleInvoiceEmail(newInvoice, order, dataBase, sevDeskApi);

                // Book invoice if paid
                if (order.financial_status === "paid") {
                    await sevDesk.bookInvoice(newInvoice);
                }

                return NextResponse.json(
                    { status: 'created', invoiceId: newInvoice.id },
                    { status: 200 }
                );
            }
        } catch (error) {
            console.error('Invoice processing error:', error);
            return NextResponse.json(
                { error: 'Invoice processing failed' },
                { status: 500 }
            );
        }

    } catch (error) {
        console.error('Webhook processing error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// Helper functions
async function handleExistingInvoice(
    invoice: any,
    order: any,
    customer: any,
    shopDomain: string,
    sevDesk: SevDesk,
    sevDeskApi: SevDeskAPI,
    dataBase: Database
) {
    // Handle canceled orders
    if (order.cancelled_at) {
        const result = await sevDeskApi.cancelInvoice(invoice.id, 0);
        return { status: 'canceled', invoiceId: invoice.id };
    }

    // Handle refunds
    if (order.refunds?.length > 0) {
        await processRefunds(order, invoice, customer, sevDesk, dataBase);
    }

    // Update draft/open invoices only; enshrined (finalized) invoices cannot be changed in SevDesk
    const canUpdate =
        ['100', '200'].includes(String(invoice.status)) && !invoice.enshrined;

    if (canUpdate) {
        const updatedInvoice = await sevDesk.updateInvoice(
            order,
            customer,
            invoice,
            shopDomain
        );
        if (updatedInvoice?.id) {
            await sevDeskApi.renderInvoice(updatedInvoice.id);
        } else {
            console.log(
                `Invoice ${invoice.id} update failed — continuing with existing invoice`,
            );
        }
    } else if (invoice.enshrined) {
        console.log(
            `Invoice ${invoice.id} is enshrined — skipping update`,
        );
    }

    // Handle email notification
    await handleInvoiceEmail(invoice, order, dataBase, sevDeskApi);

    // Book invoice if paid
    if (order.financial_status === "paid") {
        await sevDesk.bookInvoice(invoice);
    }

    return { status: 'processed', invoiceId: invoice.id };
}

async function handleInvoiceEmail(
    invoice: any,
    order: any,
    dataBase: Database,
    sevDeskApi: SevDeskAPI
) {
    const orderData = await dataBase.selectData("orders", { id: order.id });
    const emailSent = orderData.length > 0 ? orderData[0].email_sent : false;

    if (!emailSent) {
        const [contactEmail] = await sevDeskApi.getEmail(invoice.contact.id);
        if (contactEmail?.value) {
            const sendResult = await sevDeskApi.sendInvoiceViaMail(
                invoice.id,
                contactEmail.value,
                order.name
            );
            if (Array.isArray(sendResult) && sendResult.length === 0) {
                console.log(
                    `Invoice email not sent for order ${order.id} — SevDesk mail API failed (e.g. unconfirmed sender email)`,
                );
                return;
            }
            await dataBase.updateData(
                "orders",
                { email_sent: true },
                { id: order.id }
            );
        }
    }
}

function toRefundRow(creditNote: {
    id: number | string;
    order_id: number | string;
    paid?: boolean;
    amount?: number;
    creditnote_id?: string | number | null;
    skipped?: boolean;
}) {
    return {
        id: creditNote.id,
        order_id: creditNote.order_id,
        paid: creditNote.paid ?? false,
        amount: creditNote.amount ?? null,
        creditnote_id:
            creditNote.creditnote_id != null
                ? String(creditNote.creditnote_id)
                : null,
    };
}

async function processRefunds(
    order: any,
    invoice: any,
    customer: any,
    sevDesk: SevDesk,
    dataBase: Database
) {
    const refundCutoffDate = new Date("2023-07-28T00:00:00");

    for (const refund of order.refunds) {
        if (!refund.transactions?.length) continue;

        const refundDate = new Date(refund.created_at);
        if (refundDate <= refundCutoffDate) continue;

        const existingRefund = await dataBase.selectData("refunds", { id: refund.id });

        if (existingRefund.length === 0) {
            const creditNote = await sevDesk.createCreditNote(
                refund,
                order,
                customer,
                invoice
            );
            if (creditNote.skipped) {
                console.log(
                    `Refund ${refund.id} skipped — invoice already fully credited`,
                );
            }
            await dataBase.insertData("refunds", toRefundRow(creditNote));
        } else if (!existingRefund[0].paid) {
            // Update existing credit note
            await sevDesk.updateCreditNoteStatus(refund, existingRefund[0]);
            await dataBase.updateData(
                "refunds",
                { paid: true },
                { id: existingRefund[0].id }
            );
        }
    }
}