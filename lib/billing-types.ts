export type Entity={id:string;name:string;tax_id:string;person_type:string;trade_name:string;active:boolean;updated_at:string};
export type Doctor={id:string;name:string};
export type Link={id:string;doctor_id:string;billing_entity_id:string;active:boolean;updated_at:string};
export type Financial={id:string;appointment_id:string;billing_entity_id:string;billing_method:string;payment_status:string;invoice_number:string|null;received_amount:number|null;paid_at:string|null;notes:string|null;updated_at:string;updated_by:number};
export type Invoice={id:string;billing_entity_id:string;invoice_number:string;payer:string;issue_date:string;paid_at:string|null;total_amount:number|null;net_amount:number|null;notes:string|null;updated_at:string};
export type BillingRow={appointment_id:string;date:string;time:string;patient:string;doctor_id:string;anesthetist_id:string;procedure:string;insurance:string;status_atendimento:string;forma_cobranca:string|null;invoice_item?:{received_amount:number|null}|null;record:Financial|null;invoice:Invoice|null;legacy_payment:number|null;legacy_invoice:string|null};
export type BillingData={rows:BillingRow[];payers:string[];entities:Entity[];doctors:Doctor[];links:Link[];invoices:Invoice[];items:{invoice_id:string;billing_record_id:string;received_amount?:number|null}[]};
