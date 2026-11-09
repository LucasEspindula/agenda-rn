import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Cadastros foi incorporado a Organização; links antigos continuam funcionando.
export default async function DoctorsPage({ searchParams }: { searchParams: Promise<{ view?: string; doctor_id?: string }> }) {
  const { view, doctor_id } = await searchParams;
  if (view === "agenda" && doctor_id) redirect(`/organizacao/agenda?doctor_id=${encodeURIComponent(doctor_id)}`);
  redirect("/organizacao?aba=medicos");
}
