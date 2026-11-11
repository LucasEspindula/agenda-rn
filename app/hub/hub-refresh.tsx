"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Mantém o Hub atual: recarrega os dados a cada 5 min e ao voltar para a aba (sem recarregar a página).
export default function HubRefresh() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => { if (Date.now() - last < 60_000) return; last = Date.now(); router.refresh(); };
    const timer = window.setInterval(() => { last = 0; refresh(); }, 300_000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [router]);
  return null;
}
