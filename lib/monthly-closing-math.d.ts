export function monthlyCash(cash:{direct_received:number;insurance_invoice_received:number},
 expenses:{paid_total:number}):{direct:number;invoice:number;revenue:number;expenses:number;result:number};
export function canCloseMonthlySnapshot(snapshot:{
 issued_invoices:{without_net_amount:number};
 cash:{insurance_paid_invoices_without_net:number};
}):boolean;
