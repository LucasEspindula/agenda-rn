import Link from "next/link";
import { TERMS_VERSION } from "@/lib/legal";

const DOCS: Array<[string, string]> = [["/termos", "Termos de uso"], ["/privacidade", "Política de privacidade"], ["/contrato-operador", "Contrato de tratamento de dados"]];

// Campos ainda não preenchidos ([RAZÃO SOCIAL] etc.) ficam destacados.
function withBlanks(text: string) {
  return text.split(/(\[[^\]]+\])/).map((part, i) => /^\[[^\]]+\]$/.test(part)
    ? <mark key={i} className="rounded bg-amber-100 px-1 text-amber-900">{part}</mark> : part);
}

// Página de texto jurídico. Enquanto a versão for rascunho, o aviso fica visível.
export default function LegalPage({ title, intro, sections, current }: { title: string; intro?: string; sections: Array<[string, string[]]>; current: string }) {
  const draft = TERMS_VERSION.includes("rascunho");
  return <main className="min-h-screen bg-[#f3f7f9] px-5 py-10 text-[#1f2a37]">
    <article className="mx-auto max-w-3xl rounded-3xl bg-white p-7 shadow-sm sm:p-10">
      <Link href="/" className="text-sm text-slate-500 underline">RN Integra</Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#12374f]">{title}</h1>
      <p className="mt-1 text-xs text-slate-500">Versão {TERMS_VERSION}</p>
      {draft && <p role="note" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Rascunho em revisão jurídica. O texto final substituirá esta versão antes da abertura do cadastro ao público.</p>}
      {intro && <p className="mt-5 text-sm leading-7 text-slate-700">{withBlanks(intro)}</p>}
      {sections.map(([heading, paragraphs]) => <section key={heading} className="mt-7">
        <h2 className="text-lg font-semibold text-[#12374f]">{heading}</h2>
        {paragraphs.map((p, i) => <p key={i} className="mt-2 text-sm leading-7 text-slate-700">{withBlanks(p)}</p>)}
      </section>)}
      <nav aria-label="Documentos" className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-5 text-sm">
        {DOCS.filter(([href]) => href !== current).map(([href, label]) => <Link key={href} href={href} className="text-[#12857f] underline">{label}</Link>)}
      </nav>
    </article>
  </main>;
}
