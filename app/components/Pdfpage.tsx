// "use client";

// import { useState, useEffect } from "react";
// import {
//   Card,
//   Page,
//   Layout,
//   TextContainer,
//   Text,
//   Button,
// } from "@shopify/polaris";
// import { TitleBar } from "@shopify/app-bridge-react";
// import jsPDF from "jspdf";
// import html2canvas from "html2canvas";
// import { Document, Page as PDFPage } from "react-pdf";
// import pdfjs from "pdfjs-dist";

// // Set the workerSrc for PDF.js
// pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

// export default function PdfPage() {
//   const [pdfUrl, setPdfUrl] = useState<any | null>(null);
//   const [pdfOpened, setPdfOpened] = useState<boolean>(false);
//   const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
//   const [pdf, setPdf] = useState<jsPDF | null>(null);

//   useEffect(() => {
//     async function createPdf() {
//       try {
//         const orderId = new URLSearchParams(window.location.search).get("id");
//         const response = await fetch(`/api/getLieferscheinPDF?id=${orderId}`);

//         const data = await response.json();

//         if (data.htmlContent) {
//           const styleElement = document.createElement("style");
//           styleElement.innerHTML = data.cssContent;
//           document.head.appendChild(styleElement);

//           const htmlElement = document.createElement("div");
//           htmlElement.innerHTML = data.htmlContent;
//           document.body.appendChild(htmlElement);

//           //remove the style and html element
//           // console.log("styleElement", styleElement);
//           // console.log("htmlElement", htmlElement);

//           const canvas = await html2canvas(htmlElement, {
//             useCORS: true,
//             scale: 2,
//           });
//           //remove the style and html element
//           document.head.removeChild(styleElement);
//           document.body.removeChild(htmlElement);

//           const imgData = canvas.toDataURL("image/png");
//           const pdf = new jsPDF("p", "mm", "a4");
//           const imgProps = pdf.getImageProperties(imgData);
//           const pdfWidth = pdf.internal.pageSize.getWidth();
//           const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
//           pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
//           setPdf(pdf);
//           setPdfOpened(true);
//           setPdfUrl(pdf.output("bloburl"));

//           // Add the following line to set the pdfBlobUrl state
//         //   setPdfBlobUrl(URL.createObjectURL(pdf.output("blob")));

//           pdf.save("lieferschein_" + data.order.name + ".pdf");
//         } else {
//           console.error("No URL received from the server.");
//         }
//       } catch (error) {
//         console.error("Error creating PDF:", error);
//       }
//     }

//     createPdf();
//   }, []);

//   const handlePrint1 = () => {
//     if (pdf) {
//       pdf.autoPrint();
//       window.open(pdf.output("bloburl"), "_blank");
//     }
//   };

//   const handlePrint2 = () => {
//     if (pdf) {
//       const link:any = document.createElement("a");
//       link.href = pdf.output("bloburl");
//       link.download = "lieferschein.pdf";
//       link.target = "_blank";
//       document.body.appendChild(link);
//       link.click();
//       document.body.removeChild(link);
//     }
//   };

//   const handlePrint3 = () => {
//     if (pdf) {
//       pdf.save("lieferschein.pdf");
//     }
//   };

//   const handlePrint4 = () => {
//     if (pdf) {
//       pdf.save("lieferschein.pdf");
//     }
//   };

//   return (
//     <Page narrowWidth>
//       <TitleBar title="Lieferschein erstellen" />
//       <Layout>
//         <Layout.Section>
//           <Card>
//             <TextContainer spacing="loose">
//               <Text as="h3" variant="headingSm" fontWeight="medium">
//                 {pdfOpened ? "Lieferschein geladen" : "Lade PDF..."}
//               </Text>
//               {pdfOpened && (
//                 <>
//                   <Document
//                     file={pdfUrl}
//                     onLoadSuccess={() => console.log("PDF loaded successfully")}
//                     onLoadError={(error) =>
//                       console.log("Error loading PDF:", error)
//                     }
//                   >
//                     <PDFPage pageNumber={1} width={window.innerWidth - 40} />
//                   </Document>
//                   <br />
//                   <Button variant="primary" onClick={() => window.print()}>
//                     PDF drucken
//                   </Button>
//                 </>
//               )}
//             </TextContainer>
//           </Card>
//         </Layout.Section>
//       </Layout>
//     </Page>
//   );
// }

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Layout,
  Page as PolarisPage,
  TextContainer,
  Text,
  Button,
} from "@shopify/polaris";
// import html2canvas from "html2canvas";
// import * as pdfjs from "pdfjs-dist";
// import { Document, Page as PDFPage } from "react-pdf";

// ⬇️  load react‑pdf only in the browser
// const ReactPDF = dynamic(() => import("react-pdf"), { ssr: false });
// const { Document, Page: PDFPage } = ReactPDF;
// console.log("pdfjs.version", pdfjs, pdfjs?.version);

// PDF.js worker
// pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs?.version}/pdf.worker.min.js`;

export default function PdfPage() {
  const [blobUrl, setBlobUrl] = useState<any | null>(null);
  const [ready, setReady] = useState(false);

  // const generatePdf = useCallback(async () => {
  //   try {
  //     const { default: jsPDF } = await import("jspdf");

  //     const orderId =
  //       new URLSearchParams(window.location.search).get("id") ?? "";
  //     const res = await fetch(`/api/getLieferscheinPDF?id=${orderId}`);
  //     const { htmlContent, cssContent, order } = await res.json();

  //     if (!htmlContent) throw new Error("Server returned no HTML.");

  //     // ---- inject markup so html2canvas can render it
  //     const wrapper = document.createElement("div");
  //     wrapper.id = "tmp‑pdf‑wrapper";
  //     wrapper.style.position = "fixed";
  //     wrapper.style.top = "-9999px";
  //     wrapper.innerHTML = htmlContent;

  //     const style = document.createElement("style");
  //     style.textContent = cssContent;
  //     document.head.appendChild(style);
  //     document.body.appendChild(wrapper);

  //     // ---- rasterise
  //     const canvas = await html2canvas(wrapper, { useCORS: true, scale: 2 });

  //     // ---- clean up DOM
  //     document.body.removeChild(wrapper);
  //     document.head.removeChild(style);

  //     // ---- build PDF
  //     const pdf = new jsPDF("p", "mm", "a4");
  //     const img = canvas.toDataURL("image/png");
  //     const props = pdf.getImageProperties(img);
  //     const pdfW = pdf.internal.pageSize.getWidth();
  //     const pdfH = (props.height * pdfW) / props.width;

  //     pdf.addImage(img, "PNG", 0, 0, pdfW, pdfH);

  //     // 👉 comment out if you don’t want auto‑download
  //     // pdf.save(`lieferschein_${order.name}.pdf`);

  //     setBlobUrl(pdf.output("bloburl"));
  //     setReady(true);
  //   } catch (err) {
  //     /* eslint-disable-next-line no-console */
  //     console.error("Failed to create PDF:", err);
  //   }
  // }, []);

  // useEffect(() => {
  //   generatePdf();
  // }, [generatePdf]);

  // const print = () => window.print();
  // const download = () => {
  //   if (!blobUrl) return;
  //   const a = document.createElement("a");
  //   a.href = blobUrl;
  //   a.download = "lieferschein.pdf";
  //   document.body.appendChild(a);
  //   a.click();
  //   document.body.removeChild(a);
  // };

  return (
    <PolarisPage title="Lieferschein erstellen">
      <Layout>
        <Layout.Section>
          <Card>
            <TextContainer spacing="loose">
              <Text as="h3" variant="headingSm" fontWeight="medium">
                {ready ? "Lieferschein geladen" : "Lade PDF…"}
              </Text>

              {/* {ready && blobUrl && (
                <>
                  <Document file={blobUrl}>
                    <PDFPage
                      pageNumber={1}
                      width={Math.min(800, window.innerWidth - 40)}
                    />
                  </Document>
                  <br />
                  <Button onClick={print}>PDF drucken</Button>
                  <Button
                    variant="secondary"
                    // onClick={download}
                  >
                    PDF herunterladen
                  </Button>
                </>
              )} */}
            </TextContainer>
          </Card>
        </Layout.Section>
      </Layout>
    </PolarisPage>
  );
}
