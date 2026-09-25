export const normalizeCPF=(value:string)=>value.replace(/\D/g,'');
export function formatCPF(value:string){const s=normalizeCPF(value).slice(0,11);return s.slice(0,3)+(s.length>3?'.'+s.slice(3,6):'')+(s.length>6?'.'+s.slice(6,9):'')+(s.length>9?'-'+s.slice(9):'');}
export function validCPF(value:string){const s=normalizeCPF(value);if(s.length!==11||/^(\d)\1{10}$/.test(s))return false;for(let n=10;n<=11;n++){let sum=0;for(let k=0;k<n-1;k++)sum+=Number(s[k])*(n-k);const digit=(sum*10)%11%10;if(digit!==Number(s[n-1]))return false;}return true;}
export const maskedCPF=(value:string)=>'***.'+normalizeCPF(value).slice(3,6)+'.***-**';
