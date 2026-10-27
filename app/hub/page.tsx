import { getSession } from "@/app/authz";
import { doctorHome } from "@/lib/doctor-services";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Keep the former administrative URL as a permission-aware redirect.
// No hub content is rendered while the separate landing page is disabled.
export default async function HubPage() {
  const session = await getSession();
  if (!session) redirect("/");
  redirect(doctorHome(session));
}
