export const PERSEUS_CHAT_MAX_MESSAGE = 8_000;
export const PERSEUS_CHAT_MAX_HISTORY = 18;
export const PERSEUS_CHAT_MAX_TOOL_CALLS = 6;
export const PERSEUS_CHAT_MAX_TOOL_RESULTS = 100;

export type PerseusChatRole = "USER" | "ASSISTANT" | "SYSTEM";
export type PerseusChatEventStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "WAITING" | "CANCELLED";
export type PerseusToolName =
  | "consultar_documentos" | "consultar_medicos" | "consultar_pacientes"
  | "consultar_atendimentos" | "consultar_convenios" | "consultar_glosas"
  | "consultar_faturamentos" | "consultar_notas_fiscais" | "consultar_despesas"
  | "consultar_documentos_relacionados" | "preparar_relatorio";

export type PerseusChatToolCall = { callId: string; name: PerseusToolName; arguments: Record<string, unknown> };
export type PerseusChatActivity = { id?: string; title: string; detail?: string; status: PerseusChatEventStatus; toolName?: string; source?: string; resultCount?: number; startedAt?: string; completedAt?: string };
export type PerseusChatMessage = { id: string; role: PerseusChatRole; content: string; createdAt: string; metadata?: Record<string, unknown> };

export function validChatMessage(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= PERSEUS_CHAT_MAX_MESSAGE;
}

export function safeToolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
