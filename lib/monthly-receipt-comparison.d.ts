export type MonthlyReceiptAttendance={
 billing_method:string;
 payment_status:string;
 insurance_name?:string|null;
 invoice_item_received?:number|string|null;
 received_amount?:number|string|null;
};
export type MonthlyReceiptGroup={
 label:string;receivedCents:number;paidCount:number;missingPaidAmounts:number
};
export function monthlyReceiptComparison(attendances?:readonly MonthlyReceiptAttendance[]):{
 groups:MonthlyReceiptGroup[];
 totalCents:number;
 missingPaidAmounts:number
};
