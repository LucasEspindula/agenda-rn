"use client";
import { useState } from "react";
export default function HubLogout() {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  return <><button className="hub-icon" aria-label="Sair" title="Sair" disabled={busy} onClick={async()=>{
    setBusy(true);setError("");
    try { const response=await fetch("/api/auth/logout",{method:"POST"});
      if(!response.ok) throw new Error();
      window.location.assign("/");
    } catch {setError("Não foi possível sair. Tente novamente.");setBusy(false);}
  }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 5H4v14h5M14 8l4 4-4 4M8 12h12"/></svg></button>{error&&<span role="alert">{error}</span>}</>;
}
