export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function checkMutationOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN;
  const origins = configured ? [new URL(configured).origin] : [];
  if (process.env.VERCEL === '1') for (const host of [process.env.VERCEL_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL]) if (host) origins.push(new URL(`https://${host}`).origin);
  if (!origins.length && process.env.NODE_ENV !== 'production') origins.push(new URL(request.url).origin);
  if (!origins.length) throw new HttpError(503, 'Origem da aplicação não configurada.');
  if (!origins.includes(request.headers.get('origin') || '') ||
      ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') || '')) {
    throw new HttpError(403, 'Origem da solicitação inválida.');
  }
}

// Legacy JSON boundary: callers validate their operation-specific fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(request: Request, maximum = 64 * 1024): Promise<Record<string, any>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new HttpError(415, 'Envie JSON.');
  const length = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(length) || length > maximum) throw new HttpError(413, 'Solicitação muito grande.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'JSON inválido.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new HttpError(413, 'Solicitação muito grande.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('object');
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'JSON inválido.');
  } finally { reader.releaseLock(); }
}

export function secureMutation(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      checkMutationOrigin(request);
      const response = await handler(request);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    } catch (error) {
      // Falhas inesperadas (e HttpError 5xx) vão para o monitoramento; erros de validação não.
      if (!(error instanceof HttpError) || error.status >= 500) {
        const { reportError } = await import('@/lib/monitor/report');
        await reportError(error, { source: 'server', route: new URL(request.url).pathname, method: request.method, severity: error instanceof HttpError ? 'warning' : 'error' });
      }
      return Response.json({ error: error instanceof HttpError ? error.message : 'Não foi possível concluir a operação.' },
        { status: error instanceof HttpError ? error.status : 500, headers: { 'Cache-Control': 'private, no-store' } });
    }
  };
}
