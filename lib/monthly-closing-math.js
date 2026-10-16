// A receita da NF de convênio é integral por documento fiscal; não por item.
const toCents=value=>{
 const n=Number(value??0);
 if(!Number.isFinite(n))throw new Error("Valor financeiro inválido");
 return Math.round(n*100);
};
export function monthlyCash(cash,expenses){
 const direct=toCents(cash.direct_received);
 const invoice=toCents(cash.insurance_invoice_received);
 const expense=toCents(expenses.paid_total);
 return {
  direct:direct/100,invoice:invoice/100,
  revenue:(direct+invoice)/100,
  expenses:expense/100,result:(direct+invoice-expense)/100
 };
}
export function canCloseMonthlySnapshot(snapshot){
 return snapshot.issued_invoices.without_net_amount===0 &&
  snapshot.cash.insurance_paid_invoices_without_net===0;
}
