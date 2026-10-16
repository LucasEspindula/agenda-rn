export function denialCents(value:unknown):number;
export function summarizeDenials(cases:{denied_amount:number;recovered_amount:number;status:string}[]):{
 total:number;denied:number;recovered:number;activeBalance:number;closedLoss:number;
};
