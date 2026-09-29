/** One in-flight fetch per view. Focus refresh only when data is stale. */
export function financialRefresh<T>(fetcher:()=>Promise<T>,now=Date.now){
 let pending:Promise<T>|null=null,lastSuccess=0;
 return {run(staleOnly=false):Promise<T|undefined>{
  if(pending)return pending;
  if(staleOnly&&now()-lastSuccess<30000)return Promise.resolve(undefined);
  pending=fetcher().then(value=>{lastSuccess=now();return value}).finally(()=>{pending=null});return pending;
 }};
}
