import {cents} from './fiscal-money';
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
export const formatBRL=(value:number|null|undefined)=>value==null?'—':brl.format(value);
export function parseBRL(value:unknown):number|null {
 if(value==null||typeof value==='string'&&!value.trim())return null;
 if(typeof value==='number'){if(Number.isFinite(value)&&value>=0)return cents(value)/100;throw new Error('Valor inválido.');}
 const text=String(value).trim().replace(/^R\$\s*/,'').replace(/[\s\u00a0]/g,'');
 if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text))throw new Error('Use um valor como R$ 1.500,00.');
 const result=Number(text.replace(/\./g,'').replace(',','.'));
 if(!Number.isFinite(result))throw new Error('Valor inválido.');
 return cents(result)/100;
}
export const moneyInput=(value:number|string|null|undefined)=>value==null?'':typeof value==='number'?formatBRL(value):value;

