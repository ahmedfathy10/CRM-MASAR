import { env } from "cloudflare:workers";
import { ensurePhaseTwo } from "@/db/phase-two";

export const dynamic = "force-dynamic";

function tokenFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("masar_session="))?.slice("masar_session=".length) ?? "";
}

export async function POST(request: Request) {
  try {
    await ensurePhaseTwo();
    const db = env.DB;
    const token = tokenFrom(request);
    if (!token) return Response.json({ error: "يجب تسجيل الدخول أولًا" }, { status: 401 });
    const session = await db.prepare("SELECT e.id FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token, new Date().toISOString()).first<{ id: number }>();
    if (!session) return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });

    const payload = await request.json() as Record<string, any>;
    const action = String(payload.action ?? "");

    if (action === 'markSeen') {
      const conversationId = Number(payload.conversationId || 0);
      if (!conversationId) return Response.json({ error: 'conversationId مطلوب' }, { status: 400 });
      // mark notifications related to messages in conversation as seen for this user
      await db.prepare("UPDATE notifications SET is_seen=1 WHERE employee_id=? AND type='message' AND message_id IN (SELECT id FROM messages WHERE conversation_id=?)").bind(session.id, conversationId).run();
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'تعذر معالجة الإشعار' }, { status: 500 });
  }
}
