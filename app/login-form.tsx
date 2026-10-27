"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error || "Não foi possível entrar. Tente novamente.");
        return;
      }

      window.location.assign("/");
    } catch {
      setError("Não foi possível conectar. Verifique sua internet e tente novamente.");
    } finally {
      setLoading(false);
    }
  }
  return <form onSubmit={submit} className="mt-7 space-y-5">
    <div className="space-y-2"><Label htmlFor="email" className="text-slate-700">E-mail</Label><Input id="email" name="email" type="email" autoComplete="username" placeholder="seu@email.com" required className="h-12 border-slate-200 bg-white/80" /></div>
    <div className="space-y-2"><Label htmlFor="password" className="text-slate-700">Senha</Label><Input id="password" name="password" type="password" autoComplete="current-password" placeholder="Digite sua senha" required className="h-12 border-slate-200 bg-white/80" /></div>
    {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <Button type="submit" disabled={loading} className="h-12 w-full bg-[#129e98] text-base font-semibold text-white shadow-[0_10px_24px_rgba(18,158,152,0.24)] hover:bg-[#0f817c]">{loading ? "Entrando…" : "Entrar"}</Button>
  </form>;
}
