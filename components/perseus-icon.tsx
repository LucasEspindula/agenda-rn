type Props={size?:number;className?:string};
export default function PerseusIcon({size=20,className}:Props){
 return <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
  <path d="M14 39c3-4 4-7 3-12-1-4 1-8 4-10 2-2 2-5 1-8 5-4 12-3 16 2 3 4 3 10 1 14-2 3-4 4-6 5l-1 7c-5 3-12 4-18 2Z" fill="currentColor" opacity=".16"/>
  <path d="M14 39c3-4 4-7 3-12-1-4 1-8 4-10 2-2 2-5 1-8 5-4 12-3 16 2 3 4 3 10 1 14-2 3-4 4-6 5l-1 7c-5 3-12 4-18 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
  <path d="M21 10c-4-1-7 1-9 4m11-5c-1-3 2-5 5-4m-11 9c-3-2-6 0-7 3m28-8c3 1 5 4 5 7m-5-9c-1-3-4-4-7-3M18 18c-4-1-7 2-7 5m10-8c-1-3-4-4-7-3m20 16c2-1 4-3 4-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  <path d="M27 18c2 0 4 1 5 3l-3 1m-4 8 5 1-2 3m-10-1c2 1 4 1 6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M17 39c5 3 12 3 17-1M15 42h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
 </svg>;
}

