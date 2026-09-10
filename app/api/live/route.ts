import { GET as readState } from "../state/route";
import { GET as readWorkflow } from "../workflow/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Only the existing, session-authorized responses enter this stream.
// Recheck authorization on every refresh, including permission revocations.
export async function GET(request: Request) {
  const initial = await readState();
  if (!initial.ok) return initial;
  const encoder = new TextEncoder();
  let stopped = false;
  const stream = new ReadableStream({
    async start(controller) {
      const deadline = Date.now() + 45000;
      let previous = "";
      try {
        while (!stopped && !request.signal.aborted && Date.now() < deadline) {
          const [state, workflow] = await Promise.all([readState(), readWorkflow()]);
          if (!state.ok || !workflow.ok) {
            controller.enqueue(encoder.encode("event: unauthorized\ndata: {}\n\n"));
            break;
          }
          const payload = JSON.stringify({ ...(await state.json()), workflow: await workflow.json() });
          if (payload !== previous) {
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            previous = payload;
          } else controller.enqueue(encoder.encode(": heartbeat\n\n"));
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch {
        // Closing lets EventSource reconnect and recover its full snapshot.
      } finally { if (!stopped) controller.close(); }
    },
    cancel() { stopped = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
