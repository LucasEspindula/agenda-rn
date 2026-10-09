"use client";
import {useEffect,useRef,type ReactNode} from 'react';
export default function AppDialog({label,children,onClose,busy=false,compact=false,className=''}:{label:string;children:ReactNode;onClose:()=>void;busy?:boolean;compact?:boolean;className?:string}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close()},[]);
 return <dialog ref={ref} aria-label={label} className={'billing-modal native-dialog'+(compact?' compact':'')+(className?' '+className:'')} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>{children}</dialog>;
}

