let sourceId:string|undefined;
export function financialTabId(){return sourceId??=crypto.randomUUID();}
export function isExternalFinancialChange(message:unknown){return !message||typeof message!=='object'||!('source' in message)||message.source!==financialTabId();}
export function notifyFinancialChange(){
 window.dispatchEvent(new Event('rn-finance-changed'));
 if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('rn-finance');channel.postMessage({type:'changed',source:financialTabId()});channel.close();}
}
