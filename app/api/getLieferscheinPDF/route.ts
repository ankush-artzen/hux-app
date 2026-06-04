import { NextResponse } from 'next/server';
import { getOrder } from '@/lib/orders';
import { generateHTML } from '@/lib/pdf-generator';
import { getSessionByShop } from '@/lib/db/session-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const orderId = searchParams.get('orderId');
        const shop = searchParams.get('shop');

        if (!orderId || !shop) {
            return NextResponse.json(
                { error: 'Order ID is required' },
                { status: 400 }
            );
        }

        const session = await getSessionByShop(shop)

        const accessToken = session?.accessToken;
        if (!accessToken) {
            return NextResponse.json(
                { error: 'Shop Access token is required' },
                { status: 400 }
            );
        }

        const order = await getOrder(orderId, shop, accessToken);
        const htmlContent = await generateHTML(order);

        return NextResponse.json(htmlContent, { status: 200 });

    } catch (error) {
        console.error('Error generating delivery note PDF:', error);
        return NextResponse.json(
            { error: 'Failed to generate delivery note' },
            { status: 500 }
        );
    }
}