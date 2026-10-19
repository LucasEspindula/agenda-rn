export type MonthlyInvoiceStatusItem={
 id?:string;invoice_number?:string;
 status?:"ACTIVE"|"CANCELLED"|"REPLACED";
 replaced_by_invoice_id?:string|null;
 replacement_invoice_number?:string|null;
};
export function monthlyInvoiceStatus(invoice:MonthlyInvoiceStatusItem,allInvoices?:MonthlyInvoiceStatusItem[]):string;
