type Props={size?:number;className?:string;alt?:string};

export default function PerseusMark({size=24,className,alt=''}:Props){
 return <img src="/perseu.png" width={size} height={size} className={className} alt={alt} aria-hidden={alt?undefined:true}/>;
}
