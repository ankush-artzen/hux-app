class SevDeskAPI {
    private apiKey: string;
    private baseUrl = 'https://my.sevdesk.de/api/v1';
    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async fetchData(endpoint: string, method: string = "GET", bodyData: any = null, noParams = false) {
        // console.log(this.apiKey,'api key')
        const url = noParams ? `${this.baseUrl}/${endpoint}?token=${this.apiKey}` : `${this.baseUrl}/${endpoint}&token=${this.apiKey}`;
        const options: any = {
            method,
            headers: {
                "Content-Type": "application/json",
                 "Authorization": `${this.apiKey}`,
            },
        };

        if (bodyData) {
            options.body = JSON.stringify(bodyData);
        }

        const response = await fetch(url, options);
        const data = await response.json();

        // console.log(data,"data****************");
        //if data.objects is null console.log data.error.message 
        if (data.objects === null) {
            const message = data.error?.message ?? data.message ?? "Unknown SevDesk error";
            console.log("SevDesk Error: " + message);
            console.log(data);
            return [];
        }

        if (data.status) {
            console.log("SevDesk Error: " + data.message);
            console.log(data);
            return [];
        }

        return data.objects ?? [];
    }

    async getContactById(contactId: string) {
        return this.fetchData(`Contact?depth=1&customerNumber=${contactId}`);
    }

    async getSevUser() {
        return this.fetchData("SevUser?role=admin");
    }

    async getOrderNumber() {
        return this.fetchData("SevSequence/Factory/getByType?objectType=Invoice&type=RE");
    }

    async getCreditNoteNumber() {
        //v1/SevSequence/Factory/getByType?objectType=CreditNote&type=CN
        return this.fetchData("SevSequence/Factory/getByType?objectType=CreditNote&type=CN");
    }

    async findContactById(contactId: any) {
        return this.fetchData(`Contact/Mapper/checkCustomerNumberAvailability?depth=1&customerNumber=${contactId}`);
    }

    async createContact(contactData: {}) {
        const customer = this.fetchData("Contact", "POST", contactData, true);
        return customer;
    }

    async updateContact(contactId: any, contactData: {}) {
        return this.fetchData(`Contact/${contactId}`, "PUT", contactData, true);
    }

    async getAllContactAddresses() {
        return this.fetchData("ContactAddress");
    }

    async getContactAddressById(contactId: any) {
        return this.fetchData(`ContactAddress/${contactId}`);
    }

    async getContactAddressByContactId(contactId: any) {
        return this.fetchData(`ContactAddress?contact[id]=${contactId}&contact[objectName]=Contact`);
    }


    async createContactAddress(addressData: {}) {
        return this.fetchData("ContactAddress", "POST", addressData, true);
    }

    async updateContactAddress(contactAddressId: any, addressData: {}) {

        return this.fetchData(`ContactAddress/${contactAddressId}`, "PUT", addressData, true);
    }



    async getCustomerEmail(contactId: any) {
        return this.fetchData(`CommunicationWay?contact[objectName]=Contact&type=email&contact[id]=${contactId}`);
    }

    async setCustomerEmail(contactId: { toString: () => any; }, email: any) {
        const req = {
            "id": null,
            "contact": {
                "id": contactId.toString(),
                "objectName": "Contact"
            },
            "type": "EMAIL",
            "value": email,
            "key": {
                "id": 2,
                "objectName": "CommunicationWayKey"
            },
            "main": 0
        }; return this.fetchData("CommunicationWay", "POST", req, true);
    }

    async updateCustomerEmail(communicationWayId: any, email: any) {
        const req = {
            "value": email
        }; return this.fetchData(`CommunicationWay/${communicationWayId}`, "PUT", req, true);
    }

    async sendInvoiceViaMail(invoiceId: any, email: any, invoiceNr: any) {

        var text = "Vielen Dank für Ihren Einkauf.\nSollten Sie bereits im Onlineshop an der Kassa bezahlt haben, bitte betrachten Sie diese Rechnung als bezahlt.\nSie finden die Rechnung im Anhang dieser Mail im PDF Format.\nWir hoffen, Sie bald wieder als Kunden begrüßen zu dürfen.";

        const bodyData = {
            "toEmail": email,
            "subject": `Ihre Rechnung zum Auftrag ${invoiceNr}`,
            "text": text,
            "copy": false
        }; return this.fetchData(`Invoice/${invoiceId}/sendViaEmail`, "POST", bodyData, true);
    }

    async setInvoiceAsSent(invoiceId: any) {
        const req = {
            "sendType": "VM",
            "sendDraft": true
        }

        return this.fetchData(`Invoice/${invoiceId}/sendBy`, "PUT", req, true);
    }

    /** Moves invoice from draft (100) to open (200) — required before creating a credit note. */
    async markInvoiceOpen(invoiceId: string | number) {
        return this.fetchData(`Invoice/${invoiceId}/sendBy`, "PUT", {
            sendType: "VP",
            sendDraft: false,
        }, true);
    }

    async markCreditNoteOpen(creditNoteId: string | number) {
        return this.fetchData(`CreditNote/${creditNoteId}/sendBy`, "PUT", {
            sendType: "VP",
            sendDraft: false,
        }, true);
    }
    async getInvoiceByOrderId(invoiceId: string) {
        return this.fetchData(`Invoice?customerInternalNote=${invoiceId}`);
    }

    async createInvoice(invoiceData: {}) {
        const url = `${this.baseUrl}/Invoice/Factory/saveInvoice?token=${this.apiKey}`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: this.apiKey,
            },
            body: JSON.stringify(invoiceData),
        });
        const data = await response.json();

        if (data.objects == null) {
            const message =
                data.error?.message ?? data.message ?? "Unknown SevDesk error";
            console.log("SevDesk saveInvoice error:", message);
            console.log(JSON.stringify(data, null, 2));
            return null;
        }

        return data.objects;
    }

    async deleteInvoice(invoiceId: any) {
        return this.fetchData(`Invoice/${invoiceId}`, "DELETE", null, true);
    }


    async getInvoiceById(invoiceId: any) {
        return this.fetchData(`Invoice?invoiceNumber=${invoiceId}`);
    }

    async getInvoiceRecordById(invoiceId: string | number) {
        const url = `${this.baseUrl}/Invoice/${invoiceId}?token=${this.apiKey}`;
        const response = await fetch(url, {
            headers: { Authorization: this.apiKey },
        });
        const data = await response.json();
        const objects = data.objects;
        if (Array.isArray(objects)) {
            return objects[0] ?? null;
        }
        if (objects && typeof objects === "object") {
            return objects;
        }
        return null;
    }

    async getInvoicePositionsById(invoiceId: any) {
        return this.fetchData(`Invoice/${invoiceId}/getPositions`, "GET", null, true);
    }

    async bookInvoice(invoiceId: any, bookData: {}) {
        return this.fetchData(`Invoice/${invoiceId}/bookAmount`, "PUT", bookData, true);
    }

    async cancelInvoice(invoiceId: any, cancelData: number) {

        return this.fetchData(`Invoice/${invoiceId}/cancelInvoice`, "POST", cancelData, true);
    }

    async renderInvoice(invoiceId: any) {
        const invoiceData = {
            forceReload: true
        }
        return this.fetchData(`Invoice/${invoiceId}/render`, "POST", invoiceData, true);

    }

    async getEmail(contactId: any) {
        //https://my.sevdesk.de/api/v1/CommunicationWay
        return this.fetchData(`CommunicationWay?contact[objectName]=Contact&type=email&contact[id]=${contactId}`);
    }
    async sendCreditNoteViaEmail(creditNoteId: any, email: any, creditNoteNr: any) {


        var text = "Sehr geehrte/r Kunde/in. Sie erhalten heute Ihre Gutschrift zu Auftrag ";

        const bodyData = {
            "toEmail": email,
            "subject": `Gutschrift Nr. ${creditNoteNr}`,
            "text": "Email Text",
            "copy": false
        }; return this.fetchData(`CreditNote/${creditNoteId}/sendViaEmail`, "POST", bodyData, true);
    }

    async getCreditNotesByInvoiceId(invoiceId: string | number) {
        return this.fetchData(
            `CreditNote?refSrcInvoice[id]=${invoiceId}&refSrcInvoice[objectName]=Invoice&limit=100`,
        );
    }

    async createCreditNote(creditNoteData: {}) {
        const url = `${this.baseUrl}/CreditNote/Factory/saveCreditNote?token=${this.apiKey}`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: this.apiKey,
            },
            body: JSON.stringify(creditNoteData),
        });
        const data = await response.json();

        if (data.objects == null) {
            const message =
                data.error?.message ?? data.message ?? "Unknown SevDesk error";
            console.log("SevDesk saveCreditNote error:", message);
            console.log(JSON.stringify(data, null, 2));
            return null;
        }

        return data.objects;
    }

    async bookCreditNote(creditNoteId: any, bookData: {}) {


        return this.fetchData(`CreditNote/${creditNoteId}/bookAmount`, "PUT", bookData, true);
    }



    async getCheckAccountID() {
        const checkAccount = await this.fetchData("CheckAccount?name=Basiskonto");
        return checkAccount[0].id;
    }


    async getCountryId(countryName: any) {
        const countries = await this.fetchData("StaticCountry?limit=1000");

        const countryCode = countries.find((country: { nameEn: any; }) => country.nameEn === countryName);

        return countryCode ? countryCode.id : 1;
    }
}

export default SevDeskAPI;