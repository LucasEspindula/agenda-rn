// Tipos de organização (mesmos valores aceitos pelo banco).
export const ORGANIZATION_KINDS: Array<[string, string]> = [["MANAGEMENT_COMPANY", "Empresa de gestão"], ["CLINIC", "Clínica"], ["SOLO_DOCTOR", "Médico autônomo"]];
export function organizationKindLabel(kind?: string) {
  return ORGANIZATION_KINDS.find(([value]) => value === kind)?.[1] || "Organização";
}
export const ROLE_LABELS: Record<string, string> = { general_manager: "Gerente geral", secretary: "Secretaria", doctor: "Médico(a)" };
