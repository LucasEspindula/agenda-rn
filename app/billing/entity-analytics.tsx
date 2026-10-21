"use client";

import {useEffect,useMemo,useState} from "react";
import {ArrowLeft,BarChart3,Building2,CalendarDays,TrendingUp,Wallet} from "lucide-react";
import {Bar,BarChart,CartesianGrid,Cell,LabelList,Legend,Pie,PieChart,
 ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";

type Bucket={year:number;month:number;source:string;amount:number;operations:number};
type Entity={id:string;name:string;trade_name:string|null;tax_id:string;person_type:string};
type ResponseData={entity:Entity;buckets:Bucket[]};
const months=["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
const colors=["#286083","#168f88","#74a4d4","#ecb35b","#8b73b3","#5c9b70",
 "#e18567","#50709b","#d19aaf","#7d91a5","#83b3aa","#aa8f65"];
const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
const compact=(v:number)=>{
 if(v>=1_000_000)return "R$ "+(v/1_000_000).toLocaleString("pt-BR",{maximumFractionDigits:1})+" mi";
 if(v>=10_000)return "R$ "+(v/1_000).toLocaleString("pt-BR",{maximumFractionDigits:0})+" mil";
 return "R$ "+v.toLocaleString("pt-BR",{maximumFractionDigits:0});
};
const originName=(name:string)=>name.replace("Particular - ","Particular · ");
const asPercent=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"percent",maximumFractionDigits:1}).format(v);
const whole=(v:number)=>new Intl.NumberFormat("pt-BR").format(v);
const numberValue=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:0;

function Summary({label,value,meta,Icon}:{label:string;value:string;meta?:string;Icon:typeof Wallet}){
 return <div className="entity-analytics-kpi">
  <span className="entity-analytics-kpi-top"><span>{label}</span><Icon size={18} aria-hidden="true"/></span>
  <strong>{value}</strong>{meta&&<small>{meta}</small>}
 </div>;
}
function EmptyChart(){
 return <div className="entity-analytics-empty">Nenhum recebimento registrado para este período.</div>;
}
export default function EntityAnalytics({entityId}:{entityId:string}){
 const [response,setResponse]=useState<ResponseData|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 const [pickedYear,setPickedYear]=useState<number|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setError("");
  fetch("/api/billing/entity-analytics?entity="+encodeURIComponent(entityId),
   {cache:"no-store",signal:controller.signal})
   .then(async res=>{
    const body=await res.json();
    if(!res.ok)throw Error(body.error||"Não foi possível carregar os indicadores.");
    return body as ResponseData;
   })
   .then(d=>{setResponse(d);setLoading(false);})
   .catch(err=>{if(!controller.signal.aborted){setError(err instanceof Error?err.message:"Erro ao carregar os dados.");setLoading(false);}});
  return ()=>controller.abort();
 },[entityId]);
 const buckets=response?.buckets||[];
 const years=useMemo(()=>[...new Set(buckets.map(b=>b.year))].sort((a,b)=>a-b),[buckets]);
 const initialYear=years.includes(new Date().getFullYear())?new Date().getFullYear():
   years.at(-1)||new Date().getFullYear();
 const year=pickedYear!==null&&years.includes(pickedYear)?pickedYear:initialYear;

 const byOrigin=useMemo(()=>{
  const amounts=new Map<string,{amount:number;operations:number}>();
  for(const b of buckets)if(b.year===year){
   const old=amounts.get(b.source)||{amount:0,operations:0};
   amounts.set(b.source,{amount:old.amount+b.amount,operations:old.operations+b.operations});
  }
  return [...amounts].map(([source,row])=>({source,label:originName(source),...row}))
   .sort((a,b)=>b.amount-a.amount||a.label.localeCompare(b.label,"pt-BR"));
 },[buckets,year]);
 const grandTotal=byOrigin.reduce((a,b)=>a+b.amount,0);
 const privateTotal=byOrigin.filter(x=>x.source.startsWith("Particular - "))
  .reduce((a,b)=>a+b.amount,0);
 const insurerTotal=grandTotal-privateTotal;
 const operations=byOrigin.reduce((a,b)=>a+b.operations,0);
 const sources=useMemo(()=>[...new Set(buckets.map(x=>x.source))].sort((a,b)=>a.localeCompare(b,"pt-BR")),[buckets]);
 const sourceColor=(name:string)=>colors[Math.max(0,sources.indexOf(name))%colors.length];

 const annual=useMemo(()=>{
  const sums=new Map<number,number>();
  for(const b of buckets)sums.set(b.year,(sums.get(b.year)||0)+b.amount);
  return [...sums].map(([y,amount])=>({year:String(y),amount}))
   .sort((a,b)=>Number(b.year)-Number(a.year));
 },[buckets]);
 const yearsForMonthly=years.slice(-7);
 const monthly=useMemo(()=>months.map((label,i)=>{
  const item:Record<string,number|string>={month:label};
  for(const y of yearsForMonthly)item[String(y)]=0;
  for(const b of buckets)if(b.month===i+1&&yearsForMonthly.includes(b.year)){
   const k=String(b.year);item[k]=numberValue(item[k])+b.amount;
  }
  return item;
 }),[buckets,yearsForMonthly.join(",")]);
 const noYearData=byOrigin.length===0;
 const previous=annual.find(y=>Number(y.year)===year-1)?.amount||0;
 const yoy=previous?((grandTotal-previous)/previous):null;
 const graphWidth=Math.max(650,byOrigin.length*110);

 return <section className="entity-analytics-shell">
  <a className="entity-analytics-return" href="/billing?view=entities">
   <ArrowLeft size={16} aria-hidden="true"/> Entidades recebedoras
  </a>
  <header className="entity-analytics-heading">
   <div><div className="entity-analytics-eyebrow"><Building2 size={15}/> Indicadores da entidade recebedora</div>
    <h1>{response?.entity.trade_name||response?.entity.name||"Indicadores financeiros"}</h1>
    {response?.entity&&<p>{response.entity.name} · {response.entity.person_type} · {response.entity.tax_id}</p>}
   </div>
   <label className="entity-analytics-select">Ano de referência
    <select value={year} onChange={e=>setPickedYear(Number(e.target.value))}
      disabled={loading||years.length===0} aria-label="Ano dos gráficos por origem">
      {years.length?years.map(y=><option key={y} value={y}>{y}</option>):
       <option value={initialYear}>{initialYear}</option>}
    </select>
   </label>
  </header>
  {loading?<div className="entity-analytics-state">Carregando indicadores financeiros...</div>:
   error?<p className="entity-analytics-error" role="alert">{error}</p>:
   <>
    <div className="entity-analytics-kpis">
     <Summary label={"Recebimentos de "+year} value={money(grandTotal)} meta="Entradas de caixa" Icon={Wallet}/>
     <Summary label="Particular" value={money(privateTotal)} meta={asPercent(grandTotal?privateTotal/grandTotal:0)+" do total"} Icon={BarChart3}/>
     <Summary label="Convênios" value={money(insurerTotal)} meta={asPercent(grandTotal?insurerTotal/grandTotal:0)+" do total"} Icon={Building2}/>
     <Summary label="Recebimentos registrados" value={whole(operations)}
      meta={yoy===null?"Sem base para variação anual":"Variação anual: "+(yoy>0?"+":"")+asPercent(yoy)} Icon={TrendingUp}/>
    </div>
    <div className="entity-analytics-charts">
     <article className="entity-analytics-panel entity-analytics-panel-wide">
      <header><h2>Valor por origem — {year}</h2><span>Recebimentos em R$</span></header>
      {noYearData?<EmptyChart/>:
      <div className="entity-analytics-xscroll">
       <div style={{minWidth:graphWidth,height:365}}>
        <ResponsiveContainer width="100%" height="100%">
         <BarChart data={byOrigin} margin={{top:32,right:18,left:10,bottom:73}} barCategoryGap="24%">
          <CartesianGrid stroke="#e3eaf0" vertical={false}/>
          <XAxis dataKey="label" tick={{fontSize:11,fill:"#375064"}} angle={-20}
            textAnchor="end" height={95} interval={0} axisLine={false} tickLine={false}/>
          <YAxis tickFormatter={compact} tick={{fontSize:11,fill:"#61778a"}}
            axisLine={false} tickLine={false} width={92}/>
          <Tooltip formatter={v=>[money(Number(v||0)),"Recebido"]}
            cursor={{fill:"rgba(30,80,118,.05)"}}/>
          <Bar dataKey="amount" radius={[5,5,0,0]} maxBarSize={68}>
           {byOrigin.map(item=><Cell key={item.source} fill={sourceColor(item.source)}/>)}
           <LabelList dataKey="amount" position="top"
            formatter={v=>compact(Number(v||0))} fill="#234459" fontSize={10}/>
          </Bar>
         </BarChart>
        </ResponsiveContainer>
       </div>
      </div>}
     </article>
     <article className="entity-analytics-panel entity-analytics-panel-percent">
      <header><h2>Participação por origem — {year}</h2><span>Percentual sobre o total recebido</span></header>
      {noYearData?<EmptyChart/>:
       <div className="entity-analytics-participation">
        <div className="entity-analytics-donut">
         <ResponsiveContainer width="100%" height="100%">
          <PieChart>
           <Pie data={byOrigin} nameKey="label" dataKey="amount" cx="50%" cy="50%"
            innerRadius="55%" outerRadius="79%" paddingAngle={2} minAngle={1}>
            {byOrigin.map(item=><Cell key={item.source} fill={sourceColor(item.source)}/>)}
           </Pie>
           <Tooltip formatter={v=>[money(Number(v||0)),"Recebido"]}/>
          </PieChart>
         </ResponsiveContainer>
         <div className="entity-analytics-donut-center" aria-hidden="true">
          <strong>{money(grandTotal)}</strong><span>Total</span>
         </div>
        </div>
        <div className="entity-analytics-legend">
         {byOrigin.map(item=><div className="entity-analytics-legend-row" key={item.source}>
           <span className="entity-analytics-color" style={{background:sourceColor(item.source)}}/>
           <span className="entity-analytics-legend-name">{item.label}</span>
           <strong>{asPercent(grandTotal?item.amount/grandTotal:0)}</strong>
         </div>)}
        </div>
       </div>}
     </article>
     <article className="entity-analytics-panel entity-analytics-panel-wide">
      <header><h2>Comparativo mensal de recebimentos</h2><span>Histórico anual por data do pagamento</span></header>
      {years.length===0?<EmptyChart/>:
       <div className="entity-analytics-xscroll">
        <div style={{minWidth:720,height:370}}>
         <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthly} margin={{top:18,right:16,left:12,bottom:10}} barCategoryGap="14%">
           <CartesianGrid stroke="#e3eaf0" vertical={false}/>
           <XAxis dataKey="month" tick={{fontSize:11,fill:"#375064"}} axisLine={false} tickLine={false}/>
           <YAxis tickFormatter={compact} tick={{fontSize:11,fill:"#61778a"}}
             axisLine={false} tickLine={false} width={92}/>
           <Tooltip formatter={v=>[money(Number(v||0)),"Recebido"]}/>
           <Legend wrapperStyle={{fontSize:12,paddingTop:10}}/>
           {yearsForMonthly.map((y,i)=><Bar key={y} name={String(y)} dataKey={String(y)}
              fill={colors[i%colors.length]} radius={[3,3,0,0]} maxBarSize={34}/>)}
          </BarChart>
         </ResponsiveContainer>
        </div>
       </div>}
     </article>
     <article className="entity-analytics-panel entity-analytics-panel-wide">
      <header><h2>Comparativo anual de crescimento</h2><span>Recebimentos totais por ano</span></header>
      {!annual.length?<EmptyChart/>:
       <div style={{height:Math.max(220,annual.length*48+68)}}>
        <ResponsiveContainer width="100%" height="100%">
         <BarChart layout="vertical" data={annual} margin={{top:12,right:104,bottom:12,left:0}} barCategoryGap="25%">
          <CartesianGrid stroke="#e3eaf0" horizontal={false}/>
          <XAxis type="number" tickFormatter={compact} tick={{fontSize:11,fill:"#61778a"}}
            axisLine={false} tickLine={false}/>
          <YAxis type="category" dataKey="year" tick={{fontSize:12,fill:"#375064"}}
            width={54} axisLine={false} tickLine={false}/>
          <Tooltip formatter={v=>[money(Number(v||0)),"Recebido"]}/>
          <Bar dataKey="amount" fill="#4a91c7" radius={[0,5,5,0]} maxBarSize={32}>
           {annual.map(item=><Cell key={item.year} fill={Number(item.year)===year?"#168f88":"#659dca"}/>)}
           <LabelList dataKey="amount" position="right" formatter={v=>money(Number(v||0))}
              fontSize={11} fill="#2f5167"/>
          </Bar>
         </BarChart>
        </ResponsiveContainer>
       </div>}
     </article>
    </div>
    <div className="entity-analytics-footnote"><CalendarDays size={14}/>
      Critério: pagamento confirmado; particular pelo valor recebido e convênio pelo valor líquido da NF paga.
    </div>
   </>
  }
 </section>;
}
