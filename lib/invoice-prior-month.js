export function currentFiscalMonth(now=new Date()){
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit"}).formatToParts(now);
 const part=name=>parts.find(item=>item.type===name)?.value||"";
 return part("year")+"-"+part("month");
}
export function isInvoiceFromEarlierMonth(date,now=new Date()){
 const text=String(date||"");
 if(text.length<10||text[4]!=="-"||text[7]!=="-")throw new Error("Data fiscal inválida");
 return text.slice(0,7)<currentFiscalMonth(now);
}
