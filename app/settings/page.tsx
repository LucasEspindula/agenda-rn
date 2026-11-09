import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Configurações foi incorporado a Organização (Equipe); links antigos continuam funcionando.
export default async function SettingsPage() {
  redirect("/organizacao?aba=equipe");
}
