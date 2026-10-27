type StatusRecord = { id?: string; status?: string } | null | undefined;

// O status legado "realized" representa "Atendido" na interface.
// Toda entrada ou saída desse estado precisa de autenticação reforçada.
export function touchesAttendedStatus(before: StatusRecord, after: StatusRecord) {
  return before?.status !== after?.status && (before?.status === "realized" || after?.status === "realized");
}

export function hasUnverifiedAttendedTransition(
  before: Array<{ id: string; status?: string }>,
  after: Array<{ id: string; status?: string }>,
) {
  const previous = new Map(before.map((row) => [row.id, row]));
  return after.some((row) => touchesAttendedStatus(previous.get(row.id), row));
}
