
import jsPDF from "jspdf";
import jsdom from "jsdom";

// import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
// import { JSDOM } from "jsdom";

export async function generatePDF(htmlContent: any) {
    const { JSDOM } = jsdom;
    const { window } = new JSDOM(htmlContent);
    const htmlElement = window.document.body.firstChild;
    const pdf = new jsPDF("p", "mm", "a4");
    if (htmlElement instanceof HTMLElement) {
        const canvas = await html2canvas(htmlElement, { scale: 2 });

        const imgData = canvas.toDataURL("image/png");

        const imgProps = pdf.getImageProperties(imgData);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    } else {
        throw new Error("htmlElement is not an instance of HTMLElement");
    }
    return pdf.output('arraybuffer') as ArrayBuffer;
}

// interface PDFOptions {
//   format?: "a4" | "letter" | "legal";
//   orientation?: "p" | "l";
//   scale?: number;
//   margin?: {
//     top?: number;
//     right?: number;
//     bottom?: number;
//     left?: number;
//   };
// }

// export async function generatePDF(
//   htmlContent: string,
//   options: PDFOptions = {}
// ): Promise<Uint8Array> {
//   const {
//     format = "a4",
//     orientation = "p",
//     scale = 2,
//     margin = { top: 10, right: 10, bottom: 10, left: 10 },
//   } = options;

//   try {
//     // Create DOM from HTML content
//     const { window } = new JSDOM(htmlContent);
//     const htmlElement = window.document.body.firstElementChild;

//     if (!htmlElement) {
//       throw new Error("No HTML content found to convert to PDF");
//     }

//     // Initialize PDF
//     const pdf = new jsPDF({
//       orientation,
//       unit: "mm",
//       format,
//     });

//     // Convert HTML to canvas
//     const canvas = await html2canvas(htmlElement as HTMLElement, {
//       scale,
//       logging: false,
//       useCORS: true,
//       allowTaint: true,
//     });

//     const marginLeft = margin?.left || 0
//     const marginRight = margin?.right || 0

//     // Calculate dimensions with margins
//     const imgData = canvas.toDataURL("image/png");
//     const imgProps = pdf.getImageProperties(imgData);
//     const pageWidth = pdf.internal.pageSize.getWidth() - marginLeft - marginRight;
//     const pageHeight = (imgProps.height * pageWidth) / imgProps.width;

//     // Add image to PDF
//     pdf.addImage({
//       imageData: imgData,
//       format: "PNG",
//       x: margin?.left || 0,
//       y: margin?.top || 0,
//       width: pageWidth,
//       height: pageHeight,
//     });

//     // Return as Uint8Array (modern jsPDF output)
//        const arrayBuffer = pdf.output('arraybuffer');
    // return new Uint8Array(arrayBuffer);
//   } catch (error) {
//     console.error("PDF generation error:", error);
//     throw new Error(`Failed to generate PDF: ${error instanceof Error ? error.message : String(error)}`);
//   }
// }

export function generateHTML(order: any) {
    const shop = {
        name: process.env.SEVDESK_SHOP_NAME || 'Shop',
        email: process.env.SEVDESK_SHOP_EMAIL || '',
        domain: process.env.SEVDESK_SHOP_DOMAIN || '',
        address: {
            summary: process.env.SEVDESK_SHOP_ADDRESS || '',
        },
    };

    const delivery_method = {
        instructions: '',
    };

    let pickup_location_id = '';
    let pickup_date = '';
    let pickup_time = '';
    let pickup_location_company = '';
    let pickup_location_address_line_1 = '';
    let pickup_location_city = '';
    let pickup_location_region = '';
    let pickup_location_postal_code = '';
    let pickup_location_country = '';

    const isPickupOrder = order.tags.includes('Pickup Order');




    order.note_attributes.forEach((note_attribute: { name: any; value: string; }) => {
        switch (note_attribute.name) {
            case 'Pickup-Location-Id':
                pickup_location_id = note_attribute.value;
                break;
            case 'Pickup-Date':
                pickup_date = note_attribute.value;

                const dateParts = pickup_date.split("/");
                pickup_date = dateParts[2] + "." + dateParts[1] + "." + dateParts[0];


                break;
            case 'Pickup-Time':
                pickup_time = note_attribute.value;
                break;
            case 'Pickup-Location-Company':
                pickup_location_company = note_attribute.value;
                break;
            case 'Pickup-Location-Address-Line-1':
                pickup_location_address_line_1 = note_attribute.value;
                break;
            case 'Pickup-Location-City':
                pickup_location_city = note_attribute.value;
                break;
            case 'Pickup-Location-Region':
                pickup_location_region = note_attribute.value;
                break;
            case 'Pickup-Location-Postal-Code':
                pickup_location_postal_code = note_attribute.value;
                break;
            case 'Pickup-Location-Country':
                pickup_location_country = note_attribute.value;
                break;
            default:
                break;
        }
    });


    let hasMwStBefreiung = false;

    if (order.discount_applications) {

        hasMwStBefreiung = order.discount_applications.some((app: { title: string; }) => app.title && app.title.toLowerCase().includes("mwst"));

    }

    if (order.discounts) {
        hasMwStBefreiung = order.discounts.some((discount: { code: string; }) => discount.code.toLowerCase().includes("mwst"));
    }



    const lineItemsHTML = order.line_items.map((lineItem: { image: { src: any; }; title: any; variant_title: string; id: any; quantity: any; }) => {
        const imageSrc = lineItem.image && lineItem.image.src ? lineItem.image.src : '';

        return `
          <tr>
            <td>${lineItem.title} ${lineItem.variant_title ? '<br>' + lineItem.variant_title : ''}</td>
            <td>${lineItem.id}</td>
            <td>${lineItem.quantity}</td>
          </tr>
        `;
    }).join('');

    // Fill in the rest of the packaging slip HTML with the appropriate values from the order object.
    // Replace '{{variable}}' with the corresponding values from the order object.
    const html = ``
    const packagingSlipHTML = `
    <div class="lieferschein">
    <div class="shop-info">
        <div class="shop-name">${shop.name}</div>
        <div>${shop.domain}</div>
        <div>${shop.email}</div>
    </div>

<section class="details">
    <div>Auftrag: ${order.name}</div>
    ${isPickupOrder ? ` <div>Abholdatum: ${pickup_date}, ${pickup_time}</div>
    <div>Abholort: ${pickup_location_company}</div>` : ''}
    <div>${order.customer ? `Kunde: ${order.customer.first_name} ${order.customer.last_name}` : 'Kein Kunde'}</div>
    ${order.customer ? `<div>Kundennummer: ${order.customer.id}</div>` : ''}
    ${order.billing_address ? `<div>Rechnungsadresse: ${order.billing_address.address1},${order.billing_address.address2 ? " " + order.billing_address.address2 + "," : ""}${order.billing_address.city}, ${order.billing_address.zip}</div>` : ''}
</section>

<table>
    <thead>
        <tr>
            <th>Artikel</th>
            <th>Artikelnummer</th>
            <th>Stückzahl</th>
        </tr>
    </thead>
    <tbody>
    {{line_items}}
    </tbody>
</table>

<div class="pickupdate signature">
   Abgeholt am: _________________
</div>

<div class="signature">
   Unterschrift: _________________
</div>

${true ? `<div class="footer"><p>Die Mehrwertsteuerbefreiung - Auszug Umsatzsteuergesetz - gemäß §12 Absatz 3 UStZ: „Die Steuer ermäßigt sich auf 0 Prozent für die folgenden Umsätze:\n\n1. Die Lieferungen von Solarmodulen an den Betreiber einer Photovoltaikanlage, einschließlich der für den Betrieb einer Photovoltaikanlage wesentlichen Komponenten und der Speicher, die dazu dienen, den mit Solarmodulen erzeugten Strom zu speichern, wenn die Photovoltaikanlage auf oder in der Nähe von Privatwohnungen, Wohnungen sowie öffentlichen und anderen Gebäuden, die für dem Gemeinwohl dienende Tätigkeiten genutzt werden, installiert wird. Die Voraussetzungen des Satzes 1 gelten als erfüllt, wenn die installierte Bruttoleistung der Photovoltaikanlage laut Marktstammdatenregister nicht mehr als 30 Kilowatt (peak) beträgt oder betragen wird;\n2. Den innergemeinschaftlichen Erwerb der in Nummer 1 bezeichneten Gegenstände, die die Voraussetzungen der Nummer 1 erfüllen;\n3. Die Einfuhr der in Nummer 1 bezeichneten Gegenstände, die die Voraussetzungen der Nummer 1 erfüllen;\n4. Die Installation von Photovoltaikanlagen sowie der Speicher, die dazu dienen, den mit Solarmodulen erzeugten Strom zu speichern, wenn die Lieferung der installierten Komponenten die Voraussetzungen der Nummer 1 erfüllt.“\n\nSie haben bestätigt, dass Sie die Voraussetzungen für die Befreiung von Mehrwertsteuer gemäß §12 Absatz 3 Umsatzsteuergesetz erfüllen, und dass die Liefer- und Rechnungsadressen in Deutschland liegen. Im Falle, dass diese Bedingungen nicht erfüllt werden, sind wir berechtigt, eine Mehrwertsteuer von 19% nachzuberechnen. Bitte informieren Sie uns sofort, falls dies der Fall ist."</p></div>` : ''}
`;

    // Replace the line items placeholder with the generated line items HTML
    const filledHTML = packagingSlipHTML.replace('{{line_items}}', lineItemsHTML);

    return { htmlContent: filledHTML, cssContent: getCss(), order };


}


function getCss() {
    return `
        body {
            font-family: Arial, sans-serif;
            font-size: 15px;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
        }

        .lieferschein {
            padding: 80px;
        }

        .shop-info {
            text-align: center;
        }

        .shop-name {
            font-size: 35px;
            font-weight: bold;
        }

        .address {
            font-size: 15px;
            margin-bottom: 20px;
        }

        .details {
            margin-bottom: 20px;
        }

        .signature{
            margin: 20px 0;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th, td {
            border: 1px solid #000;
            padding: 8px;
            text-align: left;
        }

        th {
            background-color: #f2f2f2;
        }

        .footer {
            font-size: 14px;
            text-align: center;
            margin-top: 50px;
        }
`;


}
