"use client";
import type {InputHTMLAttributes} from 'react';
import {formatBRL,parseBRL,moneyInput} from '@/lib/money';
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'>&{value:number|string|null|undefined;onChange:(value:string)=>void};
export default function MoneyInput({value,onChange,...props}:Props){return <input {...props} type="text" inputMode="decimal" value={moneyInput(value)} onChange={e=>{e.target.setCustomValidity('');onChange(e.target.value)}} onBlur={e=>{try{const n=parseBRL(e.target.value);e.target.setCustomValidity('');onChange(n==null?'':formatBRL(n))}catch(error){e.target.setCustomValidity(error instanceof Error?error.message:'Valor inválido.')}}}/>}

