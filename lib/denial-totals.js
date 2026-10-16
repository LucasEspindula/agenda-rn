// Valores de glosas em centavos para evitar acumulacao de imprecisao binaria.
export const denialCents=value=>{
 const number=Number(value);
 return Number.isFinite(number)&&number>=0?Math.round(number*100):0;
};
export function summarizeDenials(cases){
 const result={total:cases.length,denied:0,recovered:0,activeBalance:0,closedLoss:0};
 for(const item of cases){
  const denied=denialCents(item.denied_amount);
  const recovered=Math.min(denied,denialCents(item.recovered_amount));
  result.denied+=denied;
  result.recovered+=recovered;
  if(item.status==="CLOSED")result.closedLoss+=denied-recovered;
  else result.activeBalance+=denied-recovered;
 }
 return {total:result.total,denied:result.denied/100,recovered:result.recovered/100,
  activeBalance:result.activeBalance/100,closedLoss:result.closedLoss/100};
}
