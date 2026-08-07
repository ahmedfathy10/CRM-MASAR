import { ensurePhaseTwo } from "@/db/phase-two";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

function tokenFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("masar_session="))?.slice("masar_session=".length) ?? "";
}

export async function GET(request: Request) {
  await ensurePhaseTwo();
  const db = env.DB;
  const token = tokenFrom(request);
  if (!token) return new Response(JSON.stringify({ error: "يجب تسجيل الدخول أولًا" }), { status: 401 });
  const session = await db.prepare("SELECT e.id,e.full_name AS fullName FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token, new Date().toISOString()).first<{ id: number; fullName: string }>();
  if (!session) return new Response(JSON.stringify({ error: "جلسة غير صالحة" }), { status: 401 });

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // store writer for employee id
  // @ts-ignore
  globalThis.__chatSSESubscribers = globalThis.__chatSSESubscribers || new Map();
  // @ts-ignore
  globalThis.__chatSSESubscribers.set(session.id, { write: (s: string) => writer.write(new TextEncoder().encode(s)), writable: true });

  // send initial comment to establish
  await writer.write(new TextEncoder().encode(`: connected\n\n`));

  const headers = new Headers({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const response = new Response(stream.readable, { status: 200, headers });

  // when closed, cleanup
  (async () => {
    try {
      // wait until closed by client
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          // nothing; keep alive
        }, 1000);
        response.headers;
      });
    } finally {
      // @ts-ignore
      const subs = globalThis.__chatSSESubscribers as Map<number, any> | undefined;
      if (subs) subs.delete(session.id);
      try { await writer.close(); } catch {}
    }
  })();

  return response;
}
