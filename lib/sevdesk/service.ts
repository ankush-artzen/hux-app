import SevDeskAPI from ".";
import { getSevDeskConfig, resolveSevUserId } from "./config";

interface Address {
  company: string;
  address1: string;
  address2: string;
  zip: string;
  city: string;
  country: string;
}

interface FormattedDateTime {
  formattedDate: string;
  formattedTime: string;
}

interface Customer {
  id: string;
  surename?: string;
  familyname?: string;
  email?: string;
  tags?: string[];
  [key: string]: any;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  contact: { id: string };
  sumGross: number;
  [key: string]: any;
}

interface CreditNote {
  id: string;
  sumGross: number;
  [key: string]: any;
}

interface RefundData {
  id: string;
  paid: boolean;
  order_id: string;
  amount: number;
  creditnote_id: string;
}

class SevDesk {
  private sevDesk: SevDeskAPI;
  private readonly cfg = getSevDeskConfig();

  constructor(api: SevDeskAPI) {
    this.sevDesk = api;
  }

  private taxRuleRef(ruleId: string | number) {
    return { id: String(ruleId), objectName: "TaxRule" };
  }

  private normalizeTaxRuleRef(taxRule: unknown): { id: string; objectName: string } | undefined {
    if (taxRule == null) return undefined;
    if (
      typeof taxRule === "object" &&
      taxRule !== null &&
      "id" in taxRule &&
      (taxRule as { id: unknown }).id != null
    ) {
      const id = (taxRule as { id: string | number }).id;
      return { id: String(id), objectName: "TaxRule" };
    }
    if (typeof taxRule === "number" || typeof taxRule === "string") {
      return this.taxRuleRef(taxRule);
    }
    return undefined;
  }

  /** Invoice header tax fields (legacy TaxSet or Sevdesk 2.0 taxRule). */
  private invoiceTaxFields(standard: boolean): Record<string, unknown> {
    const taxRate = standard ? "19" : "0";
    const taxText = standard
      ? "zzgl. Umsatzsteuer 19%"
      : "Steuerfrei 0% lt. § 12 Absatz 3 UStG";

    if (standard) {
      const id = this.cfg.taxIdStandard;
      if (id) {
        return {
          taxRate,
          taxText,
          taxType: "custom",
          taxSet: { id, objectName: "TaxSet" },
        };
      }
      return {
        taxRate,
        taxText,
        taxRule: this.taxRuleRef(1),
      };
    }

    const id = this.cfg.taxIdExempt;
    if (id) {
      return {
        taxRate,
        taxText,
        taxType: "custom",
        taxSet: { id, objectName: "TaxSet" },
      };
    }
    return {
      taxRate,
      taxText,
      taxRule: this.taxRuleRef(11),
    };
  }

  private requirePaymentMethodId(): string {
    if (!this.cfg.paymentMethodId) {
      throw new Error("SEVDESK_PAYMENT_METHOD_ID is not set in .env");
    }
    return this.cfg.paymentMethodId;
  }

  private footTextForB2c(): string {
    const agb = this.cfg.agbUrl;
    const agbLine = agb ? `\nUnsere AGBs: ${agb}\n` : "\n";
    return `\r\nSollten Sie bereits im Onlineshop an der Kassa bezahlt haben, bitte betrachten Sie diese Rechnung als bezahlt.${agbLine}`;
  }

  /** Shopify tags may be a string, comma-separated string, or array. */
  private hasB2BTag(tags: unknown): boolean {
    if (tags == null) return false;
    if (Array.isArray(tags)) {
      return tags.some((t) => String(t).includes("B2B"));
    }
    return String(tags).includes("B2B");
  }

  private footTextForB2b(): string {
    return "Für B2b Kunden (sollten Sie nicht schon im Shop bezahlt haben): Der Gesamtbetrag ist ohne Abzug innerhalb von 7 Tagen zahlbar. Die Warenausgabe am Abholtag ist ausschließlich für die vollständig im Voraus bezahlten Bestellungen möglich. Sollte nach 7 Tagen kein Zahlungseingang zu verzeichnen sein, wird die Bestellung automatisch storniert.";
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /** Gross refund amount for a Shopify refund line item (tax-inclusive shops). */
  private refundLineItemGross(item: any): number {
    const subtotal = parseFloat(String(item.subtotal)) || 0;
    const totalTax = parseFloat(String(item.total_tax)) || 0;
    if (totalTax > 0) {
      return subtotal + totalTax;
    }
    return subtotal;
  }

  private creditNotePositionsGross(positions: any[]): number {
    return this.roundMoney(
      positions.reduce(
        (sum, pos) =>
          sum + (parseFloat(String(pos.priceGross)) || 0) * (pos.quantity || 1),
        0,
      ),
    );
  }

  /** Scale credit note positions so total gross matches targetGross. */
  private scaleCreditNotePositions(
    positions: any[],
    currentGross: number,
    targetGross: number,
    taxRateNum: number,
  ) {
    if (currentGross <= 0 || targetGross <= 0 || positions.length === 0) return;

    const factor = targetGross / currentGross;
    for (const pos of positions) {
      pos.priceGross = this.roundMoney(pos.priceGross * factor);
      pos.price = this.roundMoney(pos.priceGross / (1 + taxRateNum / 100));
      pos.priceTax = this.roundMoney(pos.priceGross - pos.price);
    }
  }

  private async remainingCreditableGross(invoice: any): Promise<number> {
    const invoiceGross = parseFloat(String(invoice.sumGross)) || 0;
    const existing = await this.sevDesk.getCreditNotesByInvoiceId(invoice.id);
    const notes = Array.isArray(existing) ? existing : [];
    const credited = notes.reduce(
      (sum, cn) => sum + (parseFloat(String(cn.sumGross)) || 0),
      0,
    );
    const remaining = this.roundMoney(invoiceGross - credited);
    console.log(
      "Credit note capacity:",
      { invoiceGross, credited, remaining, existingCount: notes.length },
    );
    return Math.max(0, remaining);
  }

  private mapShopifyAddress(address: any) {
    return {
      company: address?.company ?? "",
      address1: address?.address1 ?? "",
      address2: address?.address2 ?? "",
      zip: address?.zip ?? "",
      city: address?.city ?? "",
      country: address?.country ?? "Germany",
    };
  }

  getBillingAddress(order: any) {
    const shopCustomer = order?.customer;
    const empty = {
      company: "",
      address1: "",
      address2: "",
      zip: "",
      city: "",
      country: "Germany",
    };

    if (order?.billing_address) {
      return this.mapShopifyAddress(order.billing_address);
    }

    if (order?.shipping_address) {
      return this.mapShopifyAddress(order.shipping_address);
    }

    if (shopCustomer?.billing_address) {
      return this.mapShopifyAddress(shopCustomer.billing_address);
    }

    if (shopCustomer?.default_address) {
      return this.mapShopifyAddress(shopCustomer.default_address);
    }

    return empty;
  }

  formatDateTime(dateTimeString: string) {
    // Parse the input string into a Date object
    const date = new Date(dateTimeString);

    // Create the Intl.DateTimeFormat options
    const dateOptions: any = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Europe/Berlin",
    };
    const timeOptions: any = {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Europe/Berlin",
    };

    // Format the date and time using the options
    const formattedDate = new Intl.DateTimeFormat("de-DE", dateOptions).format(
      date
    );
    const formattedTime = new Intl.DateTimeFormat("de-DE", timeOptions).format(
      date
    );

    return { formattedDate, formattedTime };
  }

  async checkIfDefaultContactExists() {
    const defaultContact = await this.sevDesk.getContactById(
      this.cfg.defaultContact,
    );
    const contacts = Array.isArray(defaultContact) ? defaultContact : [];

    if (contacts.length === 0) {
      const newCustomer = {
        customerNumber: this.cfg.defaultContact,
        surename: "Shopify",
        familyname: "Kunde",
        category: { id: 3, objectName: "Category" },
      };

      const customer = await this.sevDesk.createContact(newCustomer);

      const { id } = customer;
      const contactId = id;

      const customerAddress = {
        contact: { id: contactId, objectName: "Contact" },
        street: " ",
        zip: " ",
        city: " ",
        country: { id: 1, objectName: "StaticCountry" },
        name: " ",
      };

      await this.sevDesk.createContactAddress(customerAddress);
      await this.sevDesk.setCustomerEmail(contactId, " ");

      return customer;
    }
    return contacts[0];
  }

  async createCustomer(order: any, shop_domain: string) {
    const shopCustomer = order.customer;
    let newCustomer: any = {
      customerNumber: shopCustomer.id,
      surename: shopCustomer.first_name,
      familyname: shopCustomer.last_name,
      category: { id: 3, objectName: "Category" },
    };

    //if shop_domain includes b2b add name of company to customer
    if (
      this.hasB2BTag(shopCustomer.tags) &&
      shopCustomer.current_company?.name
    ) {
      newCustomer = {
        name: shopCustomer.current_company.name,
        customerNumber: shopCustomer.id,
        surename: shopCustomer.first_name,
        familyname: shopCustomer.last_name,
        tags: shopCustomer.tags,
        category: { id: 3, objectName: "Category" },
      };
    }

    try {
      let customer = await this.sevDesk.createContact(newCustomer);

      const { first_name, last_name, billing_address, default_address } =
        shopCustomer;
      const { id } = customer;

      // console.log(shopCustomer);

      let address = this.getBillingAddress(order);

      // console.log(address);

      const { company, address1, address2, zip, city, country } = address;
      const contactId = id;
      const countryId = await this.sevDesk.getCountryId(country);

      let customerAddress: any = {
        contact: { id: contactId, objectName: "Contact" },
        street: `${address1} ${address2}`,
        zip,
        city,
        country: { id: countryId, objectName: "StaticCountry" },
        name2: `${first_name} ${last_name}`,
      };

      if (this.hasB2BTag(shopCustomer.tags) && company) {
        customerAddress = {
          name: company,
          contact: { id: contactId, objectName: "Contact" },
          street: `${address1} ${address2}`,
          zip,
          city,
          country: { id: countryId, objectName: "StaticCountry" },
          name2: `${first_name} ${last_name}`,
        };
      }

      var customerEmail = shopCustomer.email;

      if (
        customerEmail === null ||
        customerEmail === undefined ||
        customerEmail === ""
      ) {
      }

      await this.sevDesk.createContactAddress(customerAddress);
      await this.sevDesk.setCustomerEmail(contactId, customerEmail);

      return customer;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async updateCustomer(customer: any, order: any, shop_domain: string) {
    const shopCustomer = order?.customer;

    if (!shopCustomer) {
      return customer;
    }

    try {
      const { id, surename, familyname } = customer;
      const contactId = id;
      const customerId = shopCustomer.id;
      const { first_name, last_name } = shopCustomer;

      const communicationWay = await this.sevDesk.getEmail(customer.id);
      const email = communicationWay[0]?.value;
      console.log(communicationWay, "communicationWay");

      const shopEmail = shopCustomer.email ?? "";

      if (
        surename !== first_name ||
        familyname !== last_name ||
        email !== shopEmail
      ) {
        let updatedCustomer: any = {
          customerNumber: customerId,
          surename: first_name,
          familyname: last_name,
          category: { id: 3, objectName: "Category" },
        };

        if (
          this.hasB2BTag(shopCustomer.tags) &&
          shopCustomer.current_company?.name
        ) {
          updatedCustomer = {
            name: shopCustomer.current_company.name,
            customerNumber: customerId,
            surename: first_name,
            familyname: last_name,
            category: { id: 3, objectName: "Category" },
          };
        }

        customer = await this.sevDesk.updateContact(id, updatedCustomer);

        if (
          shopEmail &&
          (email === null ||
            email === undefined ||
            email === "" ||
            email !== shopEmail)
        ) {
          await this.sevDesk.setCustomerEmail(customer.id, shopEmail);
        } else if (
          email != null &&
          email !== "" &&
          shopEmail &&
          email !== shopEmail &&
          communicationWay[0]?.id
        ) {
          await this.sevDesk.updateCustomerEmail(
            communicationWay[0].id,
            shopEmail,
          );
        }
      }

      //if address is different
      const address = this.getBillingAddress(order);

      const { company, address1, address2, zip, city, country } = address;

      if (country != "") {
        console.log("country: " + country);
        const countryId = await this.sevDesk.getCountryId(country);

        let customerAddress = {
          contact: { id: contactId, objectName: "Contact" },
          street: `${address1} ${address2}`,
          zip,
          city,
          country: { id: countryId, objectName: "StaticCountry" },
          name: company,
          name2: `${first_name} ${last_name}`,
        };

        let contactAddress = await this.sevDesk.getContactAddressByContactId(
          contactId
        );

        console.log(contactAddress, "contactAddress");
        console.log(customerAddress, "customerAddress");

        if (contactAddress.length > 0) {
          const updatedAddress = await this.sevDesk.updateContactAddress(
            contactAddress[0].id,
            customerAddress
          );
        } else {
          await this.sevDesk.createContactAddress(customerAddress);
        }
      }

      return customer;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  roundToTwoDecimals(value: any) {
    return Math.round(value * 100) / 100;
  }

  getPercentageFromTitle(title: string) {
    const match = title.match(/\((\d+)%\)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
    return null;
  }

  // async createInvoice(order: any, customer: any, shop_domain: string) {
  //   console.log("###############################");
  //   // const sevUser = await this.sevDesk.getSevUser();
  //   // console.log(sevUser,'sevUser*********')
  //   // const sevUserId = sevUser[0].id;
  //   const sevUserId = 836992;

  //   let number = await this.sevDesk.getOrderNumber();
  //   number = number.format.replace("%NUMBER", number.nextSequence);

  //   let marktplatz = "Shopify";

  //   if (order.note) {
  //     const note = order.note;
  //     const marktplatzIndex = note.indexOf("Marktplatz:");
  //     if (marktplatzIndex !== -1) {
  //       const endOfLineIndex = note.indexOf("\n", marktplatzIndex);
  //       const value = note.substring(
  //         marktplatzIndex + "Marktplatz:".length,
  //         endOfLineIndex
  //       );
  //       marktplatz = value.trim();
  //     }
  //   }

  //   let paidStatus = "200";

  //   if (
  //     order.fulfillment_status == "fulfilled" ||
  //     order.fulfillment_status == "partial"
  //   ) {
  //     paidStatus = "200";
  //   }

  //   const nl = "\n";

  //   let addressFields = this.getBillingAddress(order);

  //   let { company, address1, address2, zip, city, country } = addressFields;

  //   const countryId = await this.sevDesk.getCountryId(country);
  //   let vorname = "";
  //   if (customer.surename) {
  //     vorname = customer.surename + " ";
  //   }

  //   let nachname = "";
  //   if (customer.familyname) {
  //     nachname = customer.familyname;
  //   }

  //   let name = vorname + nachname;

  //   if (name === "" && customer.email) {
  //     name = customer.email;
  //   }

  //   if (order.note_attributes && order.note_attributes.length > 0) {
  //     const pickupLocationCompanyAttr = order.note_attributes.find(
  //       (attr: any) => attr.name === "Pickup-Location-Company"
  //     );
  //     const pickupLocationCompany = pickupLocationCompanyAttr?.value;
  //     const isSameCompany = pickupLocationCompany === company;

  //     if (isSameCompany) {
  //       company = "";
  //     }
  //   }

  //   const address = [company, name, address1, address2, zip, city]
  //     .filter(Boolean)
  //     .join(nl);

  //   const { formattedDate, formattedTime } = this.formatDateTime(
  //     order.created_at
  //   );

  //   let totalPrice = 0.0;
  //   let totalDiscount = 0.0;

  //   const variantTitle = order?.line_items[0].variant_title || "Default Title";
  //   console.log(variantTitle, "variantTitle***************");

  //   let variant_type = this.getPercentageFromTitle(variantTitle);
  //   console.log(variant_type, "variant_type***************");

  //   order.line_items.forEach((item: any) => {
  //     const { quantity, price } = item;
  //     totalPrice += quantity * price;

  //     item.discount_allocations.forEach((discount: any) => {
  //       totalDiscount += parseFloat(discount.amount);
  //     });
  //   });
  //   const totalPriceWithTax = totalPrice / (1 + 19 / 100);
  //   console.log(shop_domain, "shop_domain***************");
  //   //if b2b
  //   let totalTax = totalPrice - totalPriceWithTax;
  //   // if (customer.tags.includes("B2B")) {
  //   //   totalTax = order.total_tax;
  //   // }

  //   let hasMwStBefreiung = false;

  //   if (order.discount_applications) {
  //     order.discount_applications.forEach((app: any) => {
  //       if (app.title && app.title.toLowerCase().includes("mwst")) {
  //         hasMwStBefreiung = true;
  //       }
  //     });
  //   }

  //   if (order.discounts) {
  //     order.discounts.forEach((discount: any) => {
  //       if (discount.code && discount.code.toLowerCase().includes("mwst")) {
  //         hasMwStBefreiung = true;
  //       }
  //     });
  //   }

  //   if (!hasMwStBefreiung) {
  //     hasMwStBefreiung = Math.abs(totalDiscount - totalTax) < 0.01;
  //   }

  //   console.log(hasMwStBefreiung, "hasMwStBefreiung");

  //   console.log("brutto: " + totalPrice);
  //   console.log("totalDiscount: " + totalDiscount);
  //   console.log("netto: " + totalPriceWithTax);
  //   console.log("totalTax: " + totalTax);

  //   // const taxText = hasMwStBefreiung
  //   //   ? "Steuerfrei 0% lt. § 12 Absatz 3 UStG"
  //   //   : "zzgl. Umsatzsteuer 19%";
  //   // const taxId = hasMwStBefreiung ? "83858" : "83859";
  //   // //const taxId = hasMwStBefreiung ? "88970" : "88971";

  //   // const taxRate = hasMwStBefreiung ? "0" : "19";
  //   console.log(variant_type, "variant type checking****************");
  //   let taxText =
  //     variant_type === null || variant_type === 0
  //       ? "Steuerfrei 0% lt. § 12 Absatz 3 UStG"
  //       : "zzgl. Umsatzsteuer 19%";

  //   let taxId = variant_type === null || variant_type === 0 ? "83858" : "83859";

  //   if (taxText === "zzgl. Umsatzsteuer 19%" && customer.tags.includes("B2B")) {
  //     taxText = "Umsatzsteuer 19%";
  //   }

  //   //const taxId = hasMwStBefreiung ? "88970" : "88971";

  //   // let taxRate: any = variant_type === null || variant_type === 0 ? "0" : "19";
  //   let taxRate: any = "19";
  //   console.log(
  //     taxText,
  //     taxId,
  //     taxRate,
  //     "variant type checking****************"
  //   );

  //   if (order.source_name === "pos" && order.financial_status === "pending") {
  //     taxText = "Steuerfrei 0% lt. § 12 Absatz 3 UStG";
  //     taxId = "83858";
  //     taxRate = "0";
  //   }

  //   let kundenVorname = "Shopify";
  //   let kundenNachname = "Kunde";

  //   if (customer.surename) {
  //     kundenVorname = customer.surename + " ";
  //   }

  //   if (customer.familyname) {
  //     kundenNachname = customer.familyname;
  //   }

  //   let headText = `<em>Hallo ${kundenVorname} ${kundenNachname},  \t vielen Dank für Ihre Bestellung vom ${formattedDate} um ${formattedTime} Uhr.  \t Sie erhalten heute Ihre Rechnung über die folgenden Positionen zu Auftrag ${order.name}.</em>`;

  //   //if shop_domain contains b2b
  //   console.log("shop_domain: " + shop_domain);
  //   let footText = "";
  //   // if (customer.tags.includes("B2B")) {
  //   //   footText =
  //   //     "Für B2b Kunden (sollten Sie nicht schon im Shop bezahlt haben): Der Gesamtbetrag ist ohne Abzug innerhalb von 7 Tagen zahlbar. Die Warenausgabe am Abholtag ist ausschließlich für die vollständig im Voraus bezahlten Bestellungen möglich. Sollte nach 7 Tagen kein Zahlungseingang zu verzeichnen sein, wird die Bestellung automatisch storniert.";
  //   // } else {
  //     footText = `\r\nSollten Sie bereits im Onlineshop an der Kassa bezahlt haben, bitte betrachten Sie diese Rechnung als bezahlt.\nMit der Begleichung dieser Rechnung bestätigt der Kunde, unsere Allgemeinen Geschäftsbedingungen (AGBs) gelesen, verstanden und akzeptiert zu haben. Unsere AGBs können jederzeit auf unserer Webseite (https://isolarpro.de/policies/terms-of-service) eingesehen werden.\n`;
  //   // }

  //   if (hasMwStBefreiung) {
  //     footText += `\n\nDie Mehrwertsteuerbefreiung - Auszug Umsatzsteuergesetz - gemäß §12 Absatz 3 UStG: „Die Steuer ermäßigt sich auf 0 Prozent für die folgenden Umsätze:\n\n1. Die Lieferungen von Solarmodulen an den Betreiber einer Photovoltaikanlage, einschließlich der für den Betrieb einer Photovoltaikanlage wesentlichen Komponenten und der Speicher, die dazu dienen, den mit Solarmodulen erzeugten Strom zu speichern, wenn die Photovoltaikanlage auf oder in der Nähe von Privatwohnungen, Wohnungen sowie öffentlichen und anderen Gebäuden, die für dem Gemeinwohl dienende Tätigkeiten genutzt werden, installiert wird. Die Voraussetzungen des Satzes 1 gelten als erfüllt, wenn die installierte Bruttoleistung der Photovoltaikanlage laut Marktstammdatenregister nicht mehr als 30 Kilowatt (peak) beträgt oder betragen wird;\n2. Den innergemeinschaftlichen Erwerb der in Nummer 1 bezeichneten Gegenstände, die die Voraussetzungen der Nummer 1 erfüllen;\n3. Die Einfuhr der in Nummer 1 bezeichneten Gegenstände, die die Voraussetzungen der Nummer 1 erfüllen;\n4. Die Installation von Photovoltaikanlagen sowie der Speicher, die dazu dienen, den mit Solarmodulen erzeugten Strom zu speichern, wenn die Lieferung der installierten Komponenten die Voraussetzungen der Nummer 1 erfüllt.“\n\nSie haben bestätigt, dass Sie die Voraussetzungen für die Befreiung von Mehrwertsteuer gemäß §12 Absatz 3 Umsatzsteuergesetz erfüllen, und dass die Liefer- und Rechnungsadressen in Deutschland liegen. Im Falle, dass diese Bedingungen nicht erfüllt werden, sind wir berechtigt, eine Mehrwertsteuer von 19% nachzuberechnen. Bitte informieren Sie uns sofort, falls dies der Fall ist."`;
  //   }

  //   footText += `<br/><b>Bestellung von: ${marktplatz}</b>`;
  //   let invoiceData: any = {
  //     invoice: {
  //       header: `Rechnung Nr. ${number}`,
  //       headText,
  //       footText,
  //       invoiceDate: order.created_at,
  //       contact: { id: customer.id, objectName: "Contact" },
  //       status: paidStatus,
  //       address,
  //       addressCountry: { id: countryId, objectName: "StaticCountry" },
  //       contactPerson: { id: sevUserId, objectName: "SevUser" },
  //       paymentMethod: { id: "21919", objectName: "PaymentMethod" },
  //       taxRate,
  //       taxText,
  //       taxType: "custom",
  //       taxSet: { id: taxId, objectName: "TaxSet" },
  //       invoiceType: "RE",
  //       currency: "EUR",
  //       mapAll: "true",
  //       id: null,
  //       invoiceNumber: number,
  //       objectName: "Invoice",
  //       customerInternalNote: order.id,
  //     },
  //     invoicePosSave: [],
  //   };

  //   //if b2b
  //   // if (customer.tags.includes("B2B")) {
  //   //   invoiceData = {
  //   //     invoice: {
  //   //       header: `Rechnung Nr. ${number}`,
  //   //       headText,
  //   //       footText,
  //   //       invoiceDate: order.created_at,
  //   //       contact: { id: customer.id, objectName: "Contact" },
  //   //       status: paidStatus,
  //   //       address,
  //   //       addressCountry: { id: countryId, objectName: "StaticCountry" },
  //   //       contactPerson: { id: sevUserId, objectName: "SevUser" },
  //   //       paymentMethod: { id: "21919", objectName: "PaymentMethod" },
  //   //       taxRate,
  //   //       taxText,
  //   //       taxType: "custom",
  //   //       showNet: "0",
  //   //       taxSet: { id: taxId, objectName: "TaxSet" },
  //   //       invoiceType: "RE",
  //   //       currency: "EUR",
  //   //       mapAll: "true",
  //   //       id: null,
  //   //       invoiceNumber: number,
  //   //       objectName: "Invoice",
  //   //       customerInternalNote: order.id,
  //   //     },
  //   //     invoicePosSave: [],
  //   //   };
  //   // }

  //   let discountedTotalPrice = 0;
  //   let roundedTotalPrice = 0;

  //   let totalTaxBeforeRounding = 0.0; // initialize it to 0
  //   let roundedTotalTax = 0.0; // initialize it to 0

  //   order.line_items.forEach((item: any) => {
  //     console.log("item: " + item);
  //     let { quantity, price, title, total_discount }: {
  //       quantity: number, price: number, title: string, total_discount: number
  //     } = item;

  //     let proportionalDiscount: number =
  //       ((quantity * price) / totalPrice) * totalDiscount;

  //     const discountedPrice = parseFloat(
  //       (price - proportionalDiscount / quantity).toString()
  //     );
  //     const roundedDiscountedPrice = Math.round(discountedPrice * 100) / 100;

  //     let priceTaxBeforeRounding =
  //       discountedPrice - discountedPrice / (1 + taxRate / 100);
  //     totalTaxBeforeRounding += priceTaxBeforeRounding * quantity;

  //     let priceTax =
  //       roundedDiscountedPrice - roundedDiscountedPrice / (1 + taxRate / 100);
  //     roundedTotalTax += priceTax * quantity;

  //     discountedTotalPrice += discountedPrice * quantity;
  //     roundedTotalPrice += roundedDiscountedPrice * quantity;

  //     const priceDifference = discountedTotalPrice - roundedTotalPrice;

  //     let priceGross = roundedDiscountedPrice;
  //     price = roundedDiscountedPrice / (1 + taxRate / 100);

  //     //if b2b

  //     let invoicePos = {
  //       objectName: "InvoicePos",
  //       mapAll: true,
  //       quantity,
  //       price,
  //       priceGross,
  //       taxRate,
  //       name: title,
  //       priceTax,
  //       unity: { id: 1, objectName: "Unity" },
  //     };

  //     // if (customer.tags.includes("B2B")) {
  //     //   invoicePos = {
  //     //     objectName: "InvoicePos",
  //     //     mapAll: true,
  //     //     quantity,
  //     //     price: item.price,
  //     //     priceGross: item.price,
  //     //     taxRate,
  //     //     name: title,
  //     //     priceTax: item.price - item.price / (1 + taxRate / 100),
  //     //     unity: { id: 1, objectName: "Unity" },
  //     //   };
  //     // }
  //     console.log(invoicePos);

  //     invoiceData.invoicePosSave.push(invoicePos);
  //   });

  //   //if foreach order.discount_applications is not empty and has item with title "Benutzerdefinierter Rabatt"
  //   let discountSave: any = [];

  //   if (order.discount_applications.length > 0) {
  //     order.discount_applications.forEach((item: any) => {
  //       //if item.title to lower doesnt contain "mwst" or "mehrwertsteuer"

  //       // if (!item.title.toLowerCase().includes("mwst") && !item.title.toLowerCase().includes("mehrwertsteuer") && item.value_type == "fixed_amount") {
  //       if (
  //         item.title == "Benutzerdefinierter Rabatt" &&
  //         item.value_type == "fixed_amount"
  //       ) {
  //         let { value } = item;

  //         if (customer.tags.includes("B2B")) {
  //           discountSave = [
  //             {
  //               objectName: "Discounts",
  //               mapAll: true,
  //               discount: true,
  //               value: order?.total_discounts_set?.shop_money.amount,
  //               text: "B2B Rabatt",
  //               percentage: false,
  //             },
  //           ];
  //         } else {
  //           discountSave.push({
  //             objectName: "Discounts",
  //             mapAll: true,
  //             discount: true,
  //             value,
  //             text: customer.tags.includes("B2B")
  //               ? "B2B Rabatt"
  //               : "Benutzerdefinierter Rabatt",
  //             percentage: false,
  //           });
  //         }
  //       } else if (
  //         (customer.tags.includes("B2B")) &&
  //         !item.title.toLowerCase().includes("mwst") &&
  //         !item.title.toLowerCase().includes("mehrwertsteuer") &&
  //         item.value_type == "fixed_amount" &&
  //         item.type == "manual"
  //       ) {
  //         let { value } = item;
  //         if (customer.tags.includes("B2B")) {
  //           discountSave = [
  //             {
  //               objectName: "Discounts",
  //               mapAll: true,
  //               discount: true,
  //               value: order?.total_discounts_set?.shop_money.amount,
  //               text: "B2B Rabatt",
  //               percentage: false,
  //             },
  //           ];
  //         } else {
  //           discountSave.push({
  //             objectName: "Discounts",
  //             mapAll: true,
  //             discount: true,
  //             value,
  //             text: customer.tags.includes("B2B")
  //               ? "B2B Rabatt"
  //               : "Benutzerdefinierter Rabatt",
  //             percentage: false,
  //           });
  //         }
  //       }
  //     });
  //   }

  //   if (discountSave.length > 0) {
  //     invoiceData.discountSave = discountSave;
  //   }

  //   // Adjust the rounding difference for the last invoice position
  //   // Adjust the rounding difference for the last invoice position
  //   const roundingDifference = discountedTotalPrice - roundedTotalPrice;

  //   //if b2b
  //   // if (!shop_domain.includes("b2b")) {
  //   //   let lastInvoicePos: any =
  //   //     invoiceData.invoicePosSave[invoiceData.invoicePosSave.length - 1];
  //   //   lastInvoicePos.price += roundingDifference / lastInvoicePos.quantity;
  //   //   lastInvoicePos.priceGross += roundingDifference / lastInvoicePos.quantity; // Update the priceGross as well
  //   // }
  //   const taxRoundingDifference = totalTax - roundedTotalTax;
  //   console.log(taxRoundingDifference, "taxRoundingDifference");

  //   // let priceTaxTotal = 0;
  //   // while(priceTaxTotal != totalTax) {
  //   //     priceTaxTotal = 0;
  //   //     for(let i = 0; i < invoiceData.invoicePosSave.length; i++) {
  //   //         priceTaxTotal += invoiceData.invoicePosSave[i].priceTax * invoiceData.invoicePosSave[i].quantity;
  //   //     }
  //   //     priceTaxTotal = Math.round(priceTaxTotal * 100) / 100;
  //   //     if(priceTaxTotal > totalTax) {
  //   //         invoiceData.invoicePosSave[invoiceData.invoicePosSave.length - 1].priceTax -= 0.0001;
  //   //     } else if(priceTaxTotal < totalTax) {
  //   //         invoiceData.invoicePosSave[invoiceData.invoicePosSave.length - 1].priceTax += 0.0001;
  //   //     }
  //   // }

  //   if ("total_shipping_price_set" in order) {
  //     const shippingFee = parseFloat(
  //       order.total_shipping_price_set.shop_money.amount
  //     );
  //     if (shippingFee > 0) {
  //       // console.log(taxRate);
  //       let taxRateNum = parseFloat(taxRate);
  //       let shippingNet =
  //         taxRateNum === 19 ? shippingFee / (1 + taxRate / 100) : shippingFee;

  //       let invoicePos = {
  //         objectName: "InvoicePos",
  //         mapAll: true,
  //         quantity: 1,
  //         price: shippingNet, // Verwenden Sie den Nettobetrag
  //         priceGross: shippingFee, // Bruttobetrag bleibt gleich
  //         taxRate: taxRate, // Verwenden Sie die Steuerrate
  //         name: "Versand",
  //         priceTax: shippingFee - shippingNet, // Mehrwertsteuer für den Versand
  //         unity: { id: 1, objectName: "Unity" },
  //       };

  //       invoiceData.invoicePosSave.push(invoicePos);
  //     }
  //   }

  //   // console.log(discountedTotalPrice, "discountedTotalPrice");
  //   // console.log(roundedTotalPrice + roundingDifference, "roundedTotalPrice (adjusted)");
  //   // console.log(totalTaxBeforeRounding, "totalTaxBeforeRounding");
  //   // console.log(roundedTotalTax + taxRoundingDifference, "roundedTotalTax (adjusted)");

  //   // invoiceData.discountSave = [ {
  //   //     "discount": "true",
  //   //     "text": "Rabatt",
  //   //     "percentage": false,
  //   //     "value": discountAmount,
  //   //     "objectName": "Discounts",
  //   //     "mapAll": "true"
  //   // }];

  //   console.log("invoiceData", invoiceData);
  //   // return invoiceData;
  //   const invoice = await this.sevDesk.createInvoice(invoiceData);
  //   console.log("invoice", invoice);

  //   return invoice.invoice;
  // }

  async createInvoice(order: any, customer: any, shop_domain: string) {
    console.log("###############################");
    const sevUserId = await resolveSevUserId(this.sevDesk);

    // Get and format invoice number
    let number = await this.sevDesk.getOrderNumber();
    number = number.format.replace("%NUMBER", number.nextSequence);

    // Determine marketplace source
    let marktplatz = "Shopify";
    if (order.note) {
      const marktplatzIndex = order.note.indexOf("Marktplatz:");
      if (marktplatzIndex !== -1) {
        const endOfLineIndex = order.note.indexOf("\n", marktplatzIndex);
        marktplatz = order.note.substring(
          marktplatzIndex + "Marktplatz:".length,
          endOfLineIndex
        ).trim();
      }
    }

    // Set paid status
    const paidStatus = (order.fulfillment_status === "fulfilled" || order.fulfillment_status === "partial")
      ? "200"
      : "100";

    // Process customer address
    const addressFields = this.getBillingAddress(order);
    let { company, address1, address2, zip, city, country } = addressFields;
    const countryId = await this.sevDesk.getCountryId(country);

    // Format customer name
    let name = [customer.surename ? customer.surename + " " : "", customer.familyname || ""].join("");
    if (!name && customer.email) name = customer.email;

    // Handle pickup location special case
    if (order.note_attributes?.length > 0) {
      const pickupLocationCompanyAttr = order.note_attributes.find(
        (attr: any) => attr.name === "Pickup-Location-Company"
      );
      if (pickupLocationCompanyAttr?.value === company) {
        company = "";
      }
    }

    // Format complete address
    const nl = "\n";
    const address = [company, name, address1, address2, zip, city]
      .filter(Boolean)
      .join(nl);

    // Format dates
    const { formattedDate, formattedTime } = this.formatDateTime(order.created_at);

    // Calculate order totals with fixed 19% tax
    let totalPrice = 0.0;
    let totalDiscount = 0.0;

    order.line_items.forEach((item: any) => {
      totalPrice += item.quantity * item.price;
      item.discount_allocations?.forEach((discount: any) => {
        totalDiscount += parseFloat(discount.amount);
      });
    });

    const taxFields = this.invoiceTaxFields(true);
    const taxRate = taxFields.taxRate as string;

    // Format customer name for greeting
    let kundenVorname = customer.surename ? customer.surename + " " : "Shopify ";
    let kundenNachname = customer.familyname || "Kunde";

    // Create invoice header text
    let headText = `<em>Hallo ${kundenVorname}${kundenNachname},  \t vielen Dank für Ihre Bestellung vom ${formattedDate} um ${formattedTime} Uhr.  \t Sie erhalten heute Ihre Rechnung über die folgenden Positionen zu Auftrag ${order.name}.</em>`;

    // Create invoice footer text
    let footText = this.footTextForB2c();
    footText += `<br/><b>Bestellung von: ${marktplatz}</b>`;

    // Create base invoice data structure
    let invoiceData: any = {
      invoice: {
        header: `Rechnung Nr. ${number}`,
        headText,
        footText,
        invoiceDate: order.created_at,
        contact: { id: customer.id, objectName: "Contact" },
        status: paidStatus,
        address,
        addressCountry: { id: countryId, objectName: "StaticCountry" },
        contactPerson: { id: sevUserId, objectName: "SevUser" },
        paymentMethod: {
          id: this.requirePaymentMethodId(),
          objectName: "PaymentMethod",
        },
        showNet: "0",
        ...taxFields,
        invoiceType: "RE",
        currency: "EUR",
        mapAll: "true",
        id: null,
        invoiceNumber: number,
        objectName: "Invoice",
        customerInternalNote: order.id,
      },
      invoicePosSave: [],
    };

    // Process each line item with 19% tax
    let discountedTotalPrice = 0;
    let roundedTotalPrice = 0;

    order.line_items.forEach((item: any) => {
      const { quantity, price, title } = item;

      // Calculate proportional discount
      const proportionalDiscount = ((quantity * price) / totalPrice) * totalDiscount;
      const discountedPrice = price - (proportionalDiscount / quantity);
      const roundedDiscountedPrice = Math.round(discountedPrice * 100) / 100;

      // Calculate prices with 19% tax
      const priceGross = roundedDiscountedPrice;
      const priceNet = roundedDiscountedPrice / 1.19;
      const priceTax = priceGross - priceNet;

      discountedTotalPrice += discountedPrice * quantity;
      roundedTotalPrice += roundedDiscountedPrice * quantity;

      // Add invoice position
      invoiceData.invoicePosSave.push({
        objectName: "InvoicePos",
        mapAll: true,
        quantity,
        price: priceNet,
        priceGross,
        taxRate,
        name: title,
        priceTax,
        unity: { id: 1, objectName: "Unity" },
      });
    });

    // Process shipping with 19% tax
    if ("total_shipping_price_set" in order) {
      const shippingFee = parseFloat(order.total_shipping_price_set.shop_money.amount);
      if (shippingFee > 0) {
        const shippingNet = shippingFee / 1.19;

        invoiceData.invoicePosSave.push({
          objectName: "InvoicePos",
          mapAll: true,
          quantity: 1,
          price: shippingNet,
          priceGross: shippingFee,
          taxRate,
          name: "Versand",
          priceTax: shippingFee - shippingNet,
          unity: { id: 1, objectName: "Unity" },
        });
      }
    }

    // Process discounts
    if (order.discount_applications?.length > 0) {
      const discountSave = [];

      for (const item of order.discount_applications) {
        if (item.value_type === "fixed_amount" && item.type === "manual") {
          discountSave.push({
            objectName: "Discounts",
            mapAll: true,
            discount: true,
            value: item.value,
            text: "Rabatt",
            percentage: false,
          });
        }
      }

      if (discountSave.length > 0) {
        invoiceData.discountSave = discountSave;
      }
    }

    // Handle rounding differences
    const roundingDifference = discountedTotalPrice - roundedTotalPrice;
    if (Math.abs(roundingDifference) > 0.001) {
      const lastItem = invoiceData.invoicePosSave[invoiceData.invoicePosSave.length - 1];
      lastItem.price += roundingDifference / lastItem.quantity;
      lastItem.priceGross += roundingDifference / lastItem.quantity;
      lastItem.priceTax = lastItem.priceGross - (lastItem.priceGross / 1.19);
    }




    console.log("Final invoice data:", invoiceData);

    const result = await this.sevDesk.createInvoice(invoiceData);
    const invoice =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as { invoice?: { id: string | number } }).invoice
        : undefined;

    if (!invoice?.id) {
      throw new Error("SevDesk saveInvoice failed — check server logs for API error");
    }

    console.log(
      "Created Sevdesk invoice:",
      invoice.id,
      (invoice as { invoiceNumber?: string }).invoiceNumber,
    );

    await this.sevDesk.renderInvoice(invoice.id);
    return invoice;
  }




  //   const invoice = await this.sevDesk.createInvoice(invoiceData);
  //   return invoice.invoice;
  // }

  // async updateInvoice(order: any, customer: any, existingInvoice: any, shop_domain: string) {
  //   // const sevUser = await this.sevDesk.getSevUser();
  //   // const sevUserId = sevUser[0].id;
  //   const sevUserId = 836992;

  //   let number = await this.sevDesk.getOrderNumber();
  //   number = number.format.replace("%NUMBER", number.nextSequence);

  //   let totalPrice = 0.0;
  //   let totalDiscount = 0.0;

  //   const variantTitle = order?.line_items[0].variant_title || "Default Title";
  //   console.log(variantTitle, "variantTitle***************");

  //   let variant_type = this.getPercentageFromTitle(variantTitle);
  //   console.log(variant_type, "variant_type***************");

  //   order.line_items.forEach((item: any) => {
  //     const { quantity, price } = item;
  //     totalPrice += quantity * price;

  //     item.discount_allocations.forEach((discount: any) => {
  //       totalDiscount += parseFloat(discount.amount);
  //     });
  //   });

  //   const totalPriceWithTax = totalPrice / (1 + 19 / 100);
  //   const totalTax = totalPrice - totalPriceWithTax;

  //   let hasMwStBefreiung = false;

  //   if (order.discount_applications) {
  //     order.discount_applications.forEach((app: any) => {
  //       if (app.title && app.title.toLowerCase().includes("mwst")) {
  //         hasMwStBefreiung = true;
  //       }
  //     });
  //   }

  //   if (order.discounts) {
  //     order.discounts.forEach((discount: any) => {
  //       if (discount.code && discount.code.toLowerCase().includes("mwst")) {
  //         hasMwStBefreiung = true;
  //       }
  //     });
  //   }

  //   if (!hasMwStBefreiung) {
  //     hasMwStBefreiung = Math.abs(totalDiscount - totalTax) < 0.01;
  //   }
  //   // let taxRate = hasMwStBefreiung ? "0" : "19";
  //   // let taxText = hasMwStBefreiung
  //   //   ? "Steuerfrei 0% lt. § 12 Absatz 3 UStG"
  //   //   : "zzgl. Umsatzsteuer 19%";
  //   // let taxId = hasMwStBefreiung ? "83858" : "83859";
  //   console.log(variant_type, "variant type checking****************");
  //   let taxText =
  //     variant_type === null || variant_type === 0
  //       ? "Steuerfrei 0% lt. § 12 Absatz 3 UStG"
  //       : "zzgl. Umsatzsteuer 19%";

  //   let taxId = variant_type === null || variant_type === 0 ? "83858" : "83859";

  //   if (taxText === "zzgl. Umsatzsteuer 19%" && customer.tags.includes("B2B")) {
  //     taxText = "Umsatzsteuer 19%";
  //   }

  //   //const taxId = hasMwStBefreiung ? "88970" : "88971";

  //   let taxRate: any = variant_type === null || variant_type === 0 ? "0" : "19";
  //   console.log(
  //     taxText,
  //     taxId,
  //     taxRate,
  //     "variant type checking****************"
  //   );

  //   //const taxId = hasMwStBefreiung ? "88970" : "88971";
  //   // const taxId = hasMwStBefreiung ? "86295" : "86294";
  //   // const taxId = hasMwStBefreiung ? "84290" : "84291";
  //   console.log(taxText, "taxText application*******************847");

  //   if (order.source_name === "pos" && order.financial_status === "pending") {
  //     console.log(
  //       "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@update invoice api**************"
  //     );
  //     taxText = "Steuerfrei 0% lt. § 12 Absatz 3 UStG";
  //     taxId = "83858";
  //     taxRate = "0";
  //   }

  //   let kundenVorname = "Shopify";
  //   let kundenNachname = "Kunde";

  //   if (customer.surename) {
  //     kundenVorname = customer.surename + " ";
  //   }

  //   if (customer.familyname) {
  //     kundenNachname = customer.familyname;
  //   }

  //   const { formattedDate, formattedTime } = this.formatDateTime(
  //     order.created_at
  //   );

  //   let headText = `<em>Hallo ${kundenVorname} ${kundenNachname},  \t vielen Dank für Ihre Bestellung vom ${formattedDate} um ${formattedTime} Uhr.  \t Sie erhalten heute Ihre Rechnung über die folgenden Positionen zu Auftrag ${order.name}.</em>`;

  //   //if shop_domain contains b2b
  //   console.log("shop_domain: " + shop_domain);
  //   let footText = "";
  //   if (customer.tags === "B2B") {
  //     footText =
  //       "Für B2b Kunden (sollten Sie nicht schon im Shop bezahlt haben): Der Gesamtbetrag ist ohne Abzug innerhalb von 7 Tagen zahlbar. Die Warenausgabe am Abholtag ist ausschließlich für die vollständig im Voraus bezahlten Bestellungen möglich. Sollte nach 7 Tagen kein Zahlungseingang zu verzeichnen sein, wird die Bestellung automatisch storniert.";
  //   } else {
  //     footText = `\r\nSollten Sie bereits im Onlineshop an der Kassa bezahlt haben, bitte betrachten Sie diese Rechnung als bezahlt.\nMit der Begleichung dieser Rechnung bestätigt der Kunde, unsere Allgemeinen Geschäftsbedingungen (AGBs) gelesen, verstanden und akzeptiert zu haben. Unsere AGBs können jederzeit auf unserer Webseite (https://isolarpro.de/policies/terms-of-service) eingesehen werden.\n`;
  //   }

  //   let paidStatus = "200";

  //   if (
  //     order.fulfillment_status === "fulfilled" ||
  //     order.fulfillment_status === "partial"
  //   ) {
  //     paidStatus = "200";
  //   }

  //   const nl = "\n";

  //   const addressFields = this.getBillingAddress(order);

  //   const { company, address1, address2, zip, city, country } = addressFields;

  //   const countryId = await this.sevDesk.getCountryId(country);

  //   const existingInvoicePos = await this.sevDesk.getInvoicePositionsById(
  //     existingInvoice.id
  //   );

  //   const name = customer.surename + " " + customer.familyname;

  //   console.log("name: " + name);

  //   const address = [company, name, address1, address2, zip, city]
  //     .filter(Boolean)
  //     .join(nl);

  //   console.log("address: " + address);

  //   console.log(existingInvoice.invoiceNumber);

  //   let invoiceData: any = {
  //     invoice: {
  //       header: `Rechnung Nr. ${existingInvoice.invoiceNumber}`,
  //       contact: { id: customer.id, objectName: "Contact" },
  //       status: paidStatus,
  //       address,
  //       addressCountry: { id: countryId, objectName: "StaticCountry" },
  //       contactPerson: { id: sevUserId, objectName: "SevUser" },
  //       paymentMethod: { id: "21919", objectName: "PaymentMethod" },
  //       taxRate,
  //       taxText,
  //       taxType: "custom",
  //       taxSet: { id: taxId, objectName: "TaxSet" },
  //       invoiceType: "RE",
  //       currency: "EUR",
  //       mapAll: "true",
  //       id: existingInvoice.id,
  //       invoiceNumber: existingInvoice.invoiceNumber,
  //       objectName: "Invoice",
  //       customerInternalNote: order.id,
  //     },
  //   };

  //   if (customer.tags === "B2B") {
  //     invoiceData = {
  //       invoice: {
  //         header: `Rechnung Nr. ${number}`,
  //         headText,
  //         footText,
  //         invoiceDate: order.created_at,
  //         contact: { id: customer.id, objectName: "Contact" },
  //         status: paidStatus,
  //         address,
  //         addressCountry: { id: countryId, objectName: "StaticCountry" },
  //         contactPerson: { id: sevUserId, objectName: "SevUser" },
  //         paymentMethod: { id: "21919", objectName: "PaymentMethod" },
  //         taxRate,
  //         taxText,
  //         taxType: "custom",
  //         showNet: "0",
  //         taxSet: { id: taxId, objectName: "TaxSet" },
  //         invoiceType: "RE",
  //         currency: "EUR",
  //         mapAll: "true",
  //         id: null,
  //         invoiceNumber: number,
  //         objectName: "Invoice",
  //         customerInternalNote: order.id,
  //       },
  //       invoicePosSave: [],
  //     };
  //   }

  //   if (paidStatus === "100") {
  //     invoiceData.invoicePosSave = [];

  //     const refundedQuantities: any = {};
  //     order.refunds.forEach((refund: any) => {
  //       refund.refund_line_items.forEach((refundedItem: any) => {
  //         refundedQuantities[refundedItem.line_item.id] =
  //           (refundedQuantities[refundedItem.line_item.id] || 0) +
  //           refundedItem.quantity;
  //       });
  //     });

  //     let discountedTotalPrice = 0;
  //     let roundedTotalPrice = 0;

  //     order.line_items.forEach((item: any) => {
  //       const { quantity, price, title, total_discount } = item;

  //       const refundedQuantity = refundedQuantities[item.id] || 0;

  //       // Calculate the remaining quantity after refunds
  //       const remainingQuantity = quantity - refundedQuantity;

  //       // Only create an invoice position if the remaining quantity is greater than 0
  //       if (remainingQuantity > 0) {
  //         let proportionalDiscount =
  //           ((quantity * price) / totalPrice) * totalDiscount;

  //         const discountedPrice = parseFloat(
  //           (price - proportionalDiscount / quantity).toString()
  //         );
  //         const roundedDiscountedPrice =
  //           Math.round(discountedPrice * 100) / 100;

  //         discountedTotalPrice += discountedPrice * quantity;
  //         roundedTotalPrice += roundedDiscountedPrice * quantity;

  //         const priceTax =
  //           roundedDiscountedPrice -
  //           roundedDiscountedPrice / (1 + taxRate / 100);

  //         let invoicePos = {
  //           objectName: "InvoicePos",
  //           mapAll: true,
  //           quantity,
  //           price: roundedDiscountedPrice / (1 + taxRate / 100),
  //           priceGross: roundedDiscountedPrice,
  //           taxRate,
  //           name: title,
  //           priceTax,
  //           unity: { id: 1, objectName: "Unity" },
  //         };

  //         if (customer.tags === "B2B") {
  //           invoicePos = {
  //             objectName: "InvoicePos",
  //             mapAll: true,
  //             quantity,
  //             price: item.price,
  //             priceGross: item.price,
  //             taxRate,
  //             name: title,
  //             priceTax: item.price - item.price / (1 + taxRate / 100),
  //             unity: { id: 1, objectName: "Unity" },
  //           };
  //         }

  //         invoiceData.invoicePosSave.push(invoicePos);
  //       }
  //     });

  //     // Adjust the rounding difference for the position with the highest value
  //     const roundingDifference = discountedTotalPrice - roundedTotalPrice;
  //     let highestValueIndex = 0;
  //     let highestValue = 0;

  //     invoiceData.invoicePosSave.forEach((pos: any, index: number) => {
  //       const posValue = pos.price * pos.quantity;
  //       if (posValue > highestValue) {
  //         highestValue = posValue;
  //         highestValueIndex = index;
  //       }
  //     });

  //     const highestValuePos = invoiceData.invoicePosSave[highestValueIndex];
  //     highestValuePos.price += roundingDifference / highestValuePos.quantity;

  //     invoiceData.invoicePosDelete = existingInvoicePos;
  //   }

  //   console.log("invoiceData******************", invoiceData);

  //   const invoice = await this.sevDesk.createInvoice(invoiceData);

  //   if (invoice == null || invoice.invoice == null) {
  //     return null;
  //   }
  //   return invoice.invoice;
  // }

  async updateInvoice(order: any, customer: any, existingInvoice: any, shop_domain: string) {
    if (existingInvoice.enshrined) {
      console.log(
        `Invoice ${existingInvoice.id} is enshrined — skipping SevDesk update`,
      );
      return existingInvoice;
    }

    const sevUserId = await resolveSevUserId(this.sevDesk);

    let totalPrice = 0.0;
    let totalDiscount = 0.0;

    order.line_items.forEach((item: any) => {
      const { quantity, price } = item;
      totalPrice += quantity * price;

      item.discount_allocations?.forEach((discount: any) => {
        totalDiscount += parseFloat(discount.amount);
      });
    });

    const taxFields = this.invoiceTaxFields(true);
    const taxRate = taxFields.taxRate as string;
    const taxRateNum = parseFloat(taxRate) || 19;

    let kundenVorname = "Shopify";
    let kundenNachname = "Kunde";

    if (customer.surename) {
      kundenVorname = customer.surename + " ";
    }

    if (customer.familyname) {
      kundenNachname = customer.familyname;
    }

    const { formattedDate, formattedTime } = this.formatDateTime(
      order.created_at
    );

    const headText = `<em>Hallo ${kundenVorname}${kundenNachname},  \t vielen Dank für Ihre Bestellung vom ${formattedDate} um ${formattedTime} Uhr.  \t Sie erhalten heute Ihre Rechnung über die folgenden Positionen zu Auftrag ${order.name}.</em>`;

    const isB2B =
      this.hasB2BTag(customer.tags) || this.hasB2BTag(order.customer?.tags);
    let footText = isB2B ? this.footTextForB2b() : this.footTextForB2c();

    console.log("shop_domain: " + shop_domain);

    const invoiceStatus = String(existingInvoice.status ?? "100");
    const invoiceDate =
      existingInvoice.invoiceDate ||
      existingInvoice.deliveryDate ||
      order.created_at;
    const deliveryDate =
      existingInvoice.deliveryDate ||
      existingInvoice.invoiceDate ||
      invoiceDate;

    const nl = "\n";
    const addressFields = this.getBillingAddress(order);
    const { company, address1, address2, zip, city, country } = addressFields;
    const countryId = await this.sevDesk.getCountryId(country);

    const existingInvoicePos = await this.sevDesk.getInvoicePositionsById(
      existingInvoice.id
    );

    const name = [customer.surename, customer.familyname].filter(Boolean).join(" ");
    const address = [company, name, address1, address2, zip, city]
      .filter(Boolean)
      .join(nl);

    let invoiceData: any = {
      invoice: {
        header: `Rechnung Nr. ${existingInvoice.invoiceNumber}`,
        headText,
        footText,
        invoiceDate,
        deliveryDate,
        ...(existingInvoice.deliveryDateUntil
          ? { deliveryDateUntil: existingInvoice.deliveryDateUntil }
          : {}),
        contact: { id: customer.id, objectName: "Contact" },
        status: invoiceStatus,
        address,
        addressCountry: { id: countryId, objectName: "StaticCountry" },
        contactPerson: { id: sevUserId, objectName: "SevUser" },
        paymentMethod: {
          id: this.requirePaymentMethodId(),
          objectName: "PaymentMethod",
        },
        showNet: "0",
        ...taxFields,
        invoiceType: "RE",
        currency: "EUR",
        mapAll: "true",
        id: existingInvoice.id,
        invoiceNumber: existingInvoice.invoiceNumber,
        objectName: "Invoice",
        customerInternalNote: order.id,
      },
    };

    // Draft + refunds: rebuild line items. Open/paid invoices use credit notes instead.
    if (invoiceStatus === "100" && order.refunds?.length > 0) {
      invoiceData.invoicePosSave = [];
      const refundedQuantities: Record<string, number> = {};
      order.refunds?.forEach((refund: any) => {
        refund.refund_line_items?.forEach((refundedItem: any) => {
          const lineItemId = refundedItem.line_item.id;
          refundedQuantities[lineItemId] =
            (refundedQuantities[lineItemId] || 0) + refundedItem.quantity;
        });
      });

      let discountedTotalPrice = 0;
      let roundedTotalPrice = 0;

      order.line_items.forEach((item: any) => {
        const { quantity, price, title } = item;
        const refundedQuantity = refundedQuantities[item.id] || 0;
        const remainingQuantity = quantity - refundedQuantity;

        if (remainingQuantity <= 0) return;

        const proportionalDiscount =
          totalPrice > 0 ? ((quantity * price) / totalPrice) * totalDiscount : 0;

        const discountedPrice = price - proportionalDiscount / quantity;
        const roundedDiscountedPrice =
          Math.round(discountedPrice * 100) / 100;

        discountedTotalPrice += discountedPrice * remainingQuantity;
        roundedTotalPrice += roundedDiscountedPrice * remainingQuantity;

        const priceGross = roundedDiscountedPrice;
        const priceNet = roundedDiscountedPrice / (1 + taxRateNum / 100);
        const priceTax = priceGross - priceNet;

        invoiceData.invoicePosSave.push({
          objectName: "InvoicePos",
          mapAll: true,
          quantity: remainingQuantity,
          price: isB2B ? item.price / (1 + taxRateNum / 100) : priceNet,
          priceGross: isB2B ? item.price : priceGross,
          taxRate,
          name: title,
          priceTax: isB2B
            ? item.price - item.price / (1 + taxRateNum / 100)
            : priceTax,
          unity: { id: 1, objectName: "Unity" },
        });
      });

      if ("total_shipping_price_set" in order) {
        const shippingFee = parseFloat(
          order.total_shipping_price_set.shop_money.amount
        );
        if (shippingFee > 0) {
          const shippingNet = shippingFee / (1 + taxRateNum / 100);
          invoiceData.invoicePosSave.push({
            objectName: "InvoicePos",
            mapAll: true,
            quantity: 1,
            price: shippingNet,
            priceGross: shippingFee,
            taxRate,
            name: "Versand",
            priceTax: shippingFee - shippingNet,
            unity: { id: 1, objectName: "Unity" },
          });
        }
      }

      if (order.discount_applications?.length > 0) {
        const discountSave = [];
        for (const item of order.discount_applications) {
          if (item.value_type === "fixed_amount" && item.type === "manual") {
            discountSave.push({
              objectName: "Discounts",
              mapAll: true,
              discount: true,
              value: item.value,
              text: isB2B ? "B2B Rabatt" : "Rabatt",
              percentage: false,
            });
          }
        }
        if (discountSave.length > 0) {
          invoiceData.discountSave = discountSave;
        }
      }

      const roundingDifference = discountedTotalPrice - roundedTotalPrice;
      if (
        Math.abs(roundingDifference) > 0.001 &&
        invoiceData.invoicePosSave.length > 0
      ) {
        const lastItem =
          invoiceData.invoicePosSave[invoiceData.invoicePosSave.length - 1];
        lastItem.price += roundingDifference / lastItem.quantity;
        lastItem.priceGross += roundingDifference / lastItem.quantity;
        lastItem.priceTax =
          lastItem.priceGross - lastItem.priceGross / (1 + taxRateNum / 100);
      }

      if (existingInvoicePos?.length > 0) {
        invoiceData.invoicePosDelete = existingInvoicePos;
      }
    }

    console.log("updateInvoice payload:", JSON.stringify(invoiceData, null, 2));

    const result = await this.sevDesk.createInvoice(invoiceData);
    const invoice =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as { invoice?: { id: string | number } }).invoice
        : undefined;

    if (!invoice?.id) {
      console.log(
        "SevDesk saveInvoice (update) failed — check server logs for API error",
      );
      return null;
    }

    console.log("Updated Sevdesk invoice:", invoice.id);
    await this.sevDesk.renderInvoice(invoice.id);
    return invoice;
  }


  async bookInvoice(invoice: any) {
    try {
      const checkAccountID = await this.sevDesk.getCheckAccountID();
      const bookData = {
        amount: invoice.sumGross,
        date: new Date(),
        type: "N",
        checkAccount: {
          id: checkAccountID,
          objectName: "CheckAccount",
        },
      };

      const bookedInvoice = await this.sevDesk.bookInvoice(
        invoice.id,
        bookData
      );

      return bookedInvoice;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  /**
   * Sevdesk validates credit note deliveryDate against refSrc invoice deliveryDate.
   * Use the invoice's exact date strings (not Shopify refund timestamps).
   */
  private creditNoteDatesFromInvoice(invoice: any): {
    creditNoteDate: string;
    deliveryDate: string;
    deliveryDateUntil?: string;
  } {
    const deliveryDate =
      invoice.deliveryDate || invoice.invoiceDate || invoice.create;
    if (!deliveryDate) {
      throw new Error(
        "Invoice has no deliveryDate — cannot create linked credit note",
      );
    }
    return {
      creditNoteDate: deliveryDate,
      deliveryDate,
      ...(invoice.deliveryDateUntil
        ? { deliveryDateUntil: invoice.deliveryDateUntil }
        : {}),
    };
  }

  private async loadInvoiceForCreditNote(invoice: any) {
    let current = { ...invoice };
    const status = String(current.status ?? "");

    if (status === "100" || status === "50") {
      console.log("Opening draft invoice before credit note:", current.id);
      const opened = await this.sevDesk.markInvoiceOpen(current.id);
      if (opened && typeof opened === "object" && !Array.isArray(opened)) {
        current = { ...current, ...opened };
      } else {
        current = { ...current, status: "200" };
      }
    }

    const fresh = await this.sevDesk.getInvoiceRecordById(current.id);
    if (fresh) {
      current = { ...current, ...fresh };
    }

    console.log(
      "Credit note source invoice deliveryDate:",
      current.deliveryDate,
    );
    return current;
  }

  async createCreditNote(refund: any, order: any, customer: any, invoice: any) {
    console.log("createCreditNote", order);
    invoice = await this.loadInvoiceForCreditNote(invoice);
    const { creditNoteDate, deliveryDate, deliveryDateUntil } =
      this.creditNoteDatesFromInvoice(invoice);
    const sevUserId = await resolveSevUserId(this.sevDesk);

    let number = await this.sevDesk.getCreditNoteNumber();
    number = number.format.replace("%NUMBER", number.nextSequence);

    const invoiceNumber = number;

    const nl = "\n";
    const addressFields = this.getBillingAddress(order);
    const { company, address1, address2, zip, city, country } = addressFields;
    const countryId = await this.sevDesk.getCountryId(country);

    let vorname = "";
    if (customer.surename) {
      vorname = customer.surename + " ";
    }

    let nachname = "";
    if (customer.familyname) {
      nachname = customer.familyname;
    }
    let name = vorname + nachname;

    if (name === "" && customer.email) {
      name = customer.email;
    }

    // console.log(order);

    const address = [company, name, address1, address2, zip, city]
      .filter(Boolean)
      .join(nl);

    // let hasMwStBefreiung = order.discount_applications.some((app: any) =>
    //   app.title.toLowerCase().includes("mwst")
    // );

    let hasMwStBefreiung = order.discount_applications?.some((app: any) =>
      app?.title?.toLowerCase()?.includes("mwst")
    ) || false;
    if (order.discounts) {
      // hasMwStBefreiung = order.discounts.some((discount: any) =>
      //   discount.code.toLowerCase().includes("mwst")
      // );
      hasMwStBefreiung = order.discounts?.some((discount: any) =>
        discount?.code?.toLowerCase()?.includes("mwst")
      ) || false;
    }

    console.log("hasMwStBefreiung", hasMwStBefreiung);

    const fallbackTax = this.invoiceTaxFields(!hasMwStBefreiung);
    const taxRate = invoice.taxRate ?? fallbackTax.taxRate;
    const taxText = invoice.taxText ?? fallbackTax.taxText;
    const taxSet = invoice.taxSet ?? fallbackTax.taxSet;
    const taxType = invoice.taxType ?? fallbackTax.taxType;
    const taxRule =
      this.normalizeTaxRuleRef(invoice.taxRule) ??
      (fallbackTax.taxRule as { id: string; objectName: string } | undefined);
    const taxRateNum = parseFloat(String(taxRate)) || 0;
    console.log("taxRate", taxRate);

    // console.log("taxRate", taxRate);
    // console.log("taxText", taxText);
    // console.log("taxSet", taxSet);

    let alreadyPayedAmount = 0;

    refund.transactions.forEach((transaction: any) => {
      if (transaction.kind === "refund" && transaction.status === "success") {
        alreadyPayedAmount += parseFloat(String(transaction.amount)) || 0;
      }
    });

    let creditNoteData: any = {
      creditNote: {
        creditNoteNumber: invoiceNumber,
        creditNoteDate,
        creditNoteType: "CN",
        contact: { id: customer.id, objectName: "Contact" },
        status: "100",
        addressCountry: { id: countryId, objectName: "StaticCountry" },
        contactPerson: { id: sevUserId, objectName: "SevUser" },
        deliveryTerms: "string",
        deliveryDate,
        ...(deliveryDateUntil ? { deliveryDateUntil } : {}),
        taxRate,
        bookingCategory: "UNDERACHIEVEMENT",
        taxText,
        ...(taxSet ? { taxSet } : {}),
        ...(taxRule ? { taxRule } : {}),
        ...(!taxSet && !taxRule ? { taxType: taxType ?? "default" } : {}),
        currency: "EUR",
        header:
          "Gutschrift Nr. " +
          invoiceNumber +
          " zur Rechnung Nr. " +
          invoice.invoiceNumber,
        mapAll: true,
        objectName: "CreditNote",
        address,
        customerInternalNote: order.id,
        refSrcInvoice: {
          id: invoice.id,
          objectName: "Invoice",
        },
      },

      creditNotePosSave: [],
    };

    let lineItemsPrice = 0;

    refund.refund_line_items?.forEach((item: any) => {
      const { quantity, line_item } = item;
      const { title } = line_item;

      const lineGross = this.refundLineItemGross(item);
      lineItemsPrice += lineGross;

      const priceGross = lineGross / quantity;
      const priceNet = priceGross / (1 + taxRateNum / 100);
      const priceTax = priceGross - priceNet;

      const creditNotePos = {
        unity: { id: 1, objectName: "Unity" },
        quantity,
        mapAll: "true",
        taxText,
        ...(taxSet ? { taxSet } : {}),
        ...(taxRule ? { taxRule } : {}),
        ...(!taxSet && !taxRule ? { taxType: taxType ?? "default" } : {}),
        objectName: "CreditNotePos",
        taxRate,
        priceGross,
        priceTax,
        price: priceNet,
        name: title,
      };

      creditNoteData.creditNotePosSave.push(creditNotePos);
    });

    if (creditNoteData.creditNotePosSave.length === 0) {
      refund.order_adjustments?.forEach((item: any) => {
        let { amount } = item;

        //if amount is negative set it to positive
        if (amount < 0) {
          amount = amount * -1;
        }

        const priceGross = parseFloat(String(amount)) || 0;
        lineItemsPrice += priceGross;
        const priceNet = priceGross / (1 + taxRateNum / 100);
        const priceTax = priceGross - priceNet;

        let refundReason = refund.note;

        if (refundReason === "") {
          refundReason = "Rückerstattung";
        }

        const creditNotePos: any = {
          unity: { id: 1, objectName: "Unity" },
          quantity: 1,
          mapAll: "true",
          taxText,
          ...(taxSet ? { taxSet } : {}),
          ...(taxRule ? { taxRule } : {}),
          ...(!taxSet && !taxRule ? { taxType: taxType ?? "default" } : {}),
          objectName: "CreditNotePos",
          taxRate,
          priceGross,
          priceTax,
          price: priceNet,
          name: refundReason,
        };

        creditNoteData.creditNotePosSave.push(creditNotePos);
      });
    }

    lineItemsPrice = this.roundMoney(lineItemsPrice);

    let paid = false;

    if (parseFloat(String(alreadyPayedAmount)) >= lineItemsPrice) {
      paid = true;
    }

    if (creditNoteData.creditNotePosSave.length === 0) {
      throw new Error(
        "Credit note has no positions — refund has no line items or adjustments",
      );
    }

    const remainingCreditable = await this.remainingCreditableGross(invoice);
    if (remainingCreditable <= 0.001) {
      console.warn(
        "Skipping credit note — invoice already fully credited:",
        invoice.id,
        "refund:",
        refund.id,
      );
      const existing = await this.sevDesk.getCreditNotesByInvoiceId(invoice.id);
      const notes = Array.isArray(existing) ? existing : [];
      return {
        id: refund.id,
        paid: false,
        order_id: order.id,
        amount: lineItemsPrice,
        creditnote_id: notes[notes.length - 1]?.id ?? null,
      };
    }

    const requestedGross = this.creditNotePositionsGross(
      creditNoteData.creditNotePosSave,
    );
    const targetGross = Math.min(requestedGross, remainingCreditable);

    if (targetGross < requestedGross - 0.001) {
      console.warn(
        `Capping credit note gross from ${requestedGross} to ${targetGross} for invoice ${invoice.id}`,
      );
      this.scaleCreditNotePositions(
        creditNoteData.creditNotePosSave,
        requestedGross,
        targetGross,
        taxRateNum,
      );
      lineItemsPrice = targetGross;
    }

    console.log("creditNoteData", creditNoteData);

    const result = await this.sevDesk.createCreditNote(creditNoteData);
    const created =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as { creditNote?: { id: string | number } }).creditNote
        : undefined;

    if (!created?.id) {
      throw new Error(
        "SevDesk saveCreditNote failed — check server logs for API error",
      );
    }

    console.log("Created Sevdesk credit note:", created.id);

    await this.sevDesk.markCreditNoteOpen(created.id);

    if (paid) {
      await this.bookCreditNote({
        id: created.id,
        sumGross: lineItemsPrice,
      });
    }

    return {
      id: refund.id,
      paid,
      order_id: order.id,
      amount: lineItemsPrice,
      creditnote_id: created.id,
    };
  }



  async updateCreditNoteStatus(refund: any, creditNote: any) {
    let alreadyPayedAmount = 0;

    refund.transactions.forEach((transaction: any) => {
      if (transaction.kind === "refund" && transaction.status === "success") {
        alreadyPayedAmount += parseFloat(String(transaction.amount)) || 0;
      }
    });

    if (parseFloat(String(alreadyPayedAmount)) >= creditNote.amount) {
      const updatedCreditNote = await this.bookCreditNote({
        id: creditNote.creditnote_id,
        sumGross: creditNote.amount,
      });
      // console.log(updatedCreditNote, "updatedCreditNote");
      if (updatedCreditNote) {
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }

  async bookCreditNote(creditNote: any) {
    try {
      const checkAccountID = await this.sevDesk.getCheckAccountID();

      const bookData = {
        amount: -creditNote.sumGross,
        date: new Date(),
        type: "N",
        checkAccount: {
          id: checkAccountID,
          objectName: "CheckAccount",
        },
      };

      const bookedCreditNote = await this.sevDesk.bookCreditNote(
        creditNote.id,
        bookData
      );
      return bookedCreditNote;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async cancelInvoice(invoice: any, creditnoteId = 0, order: any) {
    const invoiceId = invoice.id;
    const contactID = invoice.contact.id;
    try {
      const invoiceData: any = {
        invoiceId: parseFloat(invoiceId),
      };

      const invoiceRender = await this.sevDesk.renderInvoice(invoiceId);

      const cancelledInvoice = await this.sevDesk.cancelInvoice(
        invoiceId,
        invoiceData
      );

      if (
        (cancelledInvoice != null &&
          cancelledInvoice.objectName === "CreditNote") ||
        creditnoteId != 0
      ) {
        var getEmail = await this.sevDesk.getEmail(contactID);
        var email = getEmail[0].value;

        const sendCreditNoteViaEmail =
          await this.sevDesk.sendCreditNoteViaEmail(
            cancelledInvoice.id,
            email,
            order.name
          );

        console.log(sendCreditNoteViaEmail, "sendCreditNoteViaEmail");
        const checkAccountID = await this.sevDesk.getCheckAccountID();

        const bookData = {
          amount: -cancelledInvoice.sumGross,
          date: new Date(),
          type: "N",
          checkAccount: {
            id: checkAccountID,
            objectName: "CheckAccount",
          },
        };

        const bookedCreditNote = await this.sevDesk.bookCreditNote(
          cancelledInvoice.id,
          bookData
        );
        // console.log(bookedCreditNote, "bookedCreditNote");
      }

      return cancelledInvoice;
    } catch (error) {
      console.error(error);
      return null;
    }
  }
}
export default SevDesk;
