export type FinancialVersion = string | null;

/** Captures the optimistic-lock token when a financial modal opens. */
export function captureFinancialVersion(updatedAt: unknown): FinancialVersion {
 return typeof updatedAt === 'string' && updatedAt.length > 0 ? updatedAt : null;
}

/** Keeps a record edit bound to the version that opened its modal. */
export function withExpectedFinancialVersion<T extends Record<string, unknown>>(
 payload: T,
 editing: string,
 expectedRecordVersion: FinancialVersion,
): T {
 if (editing !== 'record' || !expectedRecordVersion) return payload;
 return {...payload,updated_at:expectedRecordVersion};
}

/** Mirrors the strict version equality required by the server-side optimistic lock. */
export function financialVersionIsStale(
 persistedVersion: FinancialVersion,
 expectedVersion: FinancialVersion,
): boolean {
 return !persistedVersion || !expectedVersion || persistedVersion !== expectedVersion;
}
