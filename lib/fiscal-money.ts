/** Decimal rounding once, half away from zero, followed by exact integer cents. */
export function cents(value:number|string):number {
 const raw=String(value).trim(),match=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
 if(!match)throw Error('Valor inválido.');
 const digits=match[2]+(match[3]||''),places=(match[3]||'').length-Number(match[4]||0)-2;
 if(Math.abs(places)>100)throw Error('Valor fora do limite.');
 let n=BigInt(digits);
 if(places>0){const divisor=BigInt(10)**BigInt(places);n=n/divisor+(n%divisor*BigInt(2)>=divisor?BigInt(1):BigInt(0));}else n*=BigInt(10)**BigInt(-places);
 const result=Number(match[1]==='-'?-n:n);if(!Number.isSafeInteger(result))throw Error('Valor fora do limite.');return result;
}
export type PaymentPart={id?:string;billing_record_id?:string|null;invoice_id?:string|null;method:string;amount:number;installments?:number|null;notes?:string|null};
export const paymentMethods:Record<string,string>={PIX:'PIX',CASH:'Dinheiro',CREDIT_CARD:'Cartão de crédito',DEBIT_CARD:'Cartão de débito',TRANSFER:'Transferência',BOLETO:'Boleto',CHECK:'Cheque',OTHER:'Outro'};
export function paymentDifference(parts:PaymentPart[],amount:number){return cents(amount)-parts.reduce((n,p)=>n+cents(p.amount),0);}
export function validPaymentParts(parts:PaymentPart[],amount:number){return parts.length>0&&parts.every(p=>p.method in paymentMethods&&p.amount>=0&&(p.method!=='CREDIT_CARD'||Number.isInteger(p.installments)&&Number(p.installments)>=1))&&paymentDifference(parts,amount)===0;}
