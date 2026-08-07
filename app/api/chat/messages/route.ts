import { env } from "cloudflare:workers";
import { ensurePhaseTwo } from "@/db/phase-two";

export const dynamic = "force-dynamic";

function tokenFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("masar_session="))?.slice("masar_session=".length) ?? "";
}

export async function GET(request: Request) {
  try {
    await ensurePhaseTwo();
    const db = env.DB;
    const token = tokenFrom(request);
    if (!token) return Response.json({ error: "يجب تسجيل الدخول أولًا" }, { status: 401 });
    const session = await db.prepare("SELECT e.id FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token, new Date().toISOString()).first<{ id: number }>();
    if (!session) return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });
    const url = new URL(request.url);
    const convId = Number(url.searchParams.get("conversationId") || 0);
    if (!convId) return Response.json({ error: "conversationId مطلوب" }, { status: 400 });
    // verify membership
    const member = await db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND employee_id=? LIMIT 1").bind(convId, session.id).first();
    if (!member) return Response.json({ error: "غير مسموح" }, { status: 403 });
    const messages = await db.prepare("SELECT id,conversation_id AS conversationId,sender_id AS senderId,content,content_type AS contentType,is_read AS isRead,created_at AS createdAt FROM messages WHERE conversation_id=? ORDER BY created_at ASC, id ASC LIMIT 1000").bind(convId).all();
    return Response.json({ ok: true, messages: messages.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر جلب الرسائل" }, { status: 500 });
  }
}
