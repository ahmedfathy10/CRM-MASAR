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
    const session = await db.prepare("SELECT e.id,e.full_name AS fullName,e.email FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token, new Date().toISOString()).first<{ id: number; fullName: string; email: string }>();
    if (!session) return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });

    // Fetch conversations where the employee is a member
    const convs = await db.prepare(`SELECT c.id, c.title, c.is_group AS isGroup, c.created_by AS createdBy, c.created_at AS createdAt
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id=c.id
      WHERE cm.employee_id=?
      ORDER BY c.created_at DESC
      LIMIT 200`).bind(session.id).all();

    const conversations = [] as any[];
    for (const c of convs.results) {
      const convId = c.id;
      const lastMsg = await db.prepare("SELECT id,conversation_id AS conversationId,sender_id AS senderId,content,content_type AS contentType,created_at AS createdAt FROM messages WHERE conversation_id=? ORDER BY created_at DESC, id DESC LIMIT 1").bind(convId).first();
      const unread = await db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE employee_id=? AND is_seen=0 AND type='message' AND message_id IN (SELECT id FROM messages WHERE conversation_id=?)").bind(session.id, convId).first<{ count: number }>();
      const members = await db.prepare("SELECT e.id,e.full_name AS fullName,e.email,e.job_title_id AS jobTitleId FROM conversation_members cm JOIN employees e ON e.id=cm.employee_id WHERE cm.conversation_id=?").bind(convId).all();
      conversations.push({
        id: convId,
        title: c.title || null,
        isGroup: Boolean(c.isGroup),
        createdBy: c.createdBy || null,
        createdAt: c.createdAt || null,
        lastMessage: lastMsg || null,
        unreadCount: (unread?.count as number) || 0,
        members: members.results || [],
      });
    }

    return Response.json({ ok: true, conversations }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر جلب المحادثات" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensurePhaseTwo();
    const db = env.DB;
    const token = tokenFrom(request);
    if (!token) return Response.json({ error: "يجب تسجيل الدخول أولًا" }, { status: 401 });
    const session = await db.prepare("SELECT e.id,e.full_name AS fullName FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token, new Date().toISOString()).first<{ id: number; fullName: string }>();
    if (!session) return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });

    const payload = await request.json() as Record<string, any>;
    const action = String(payload.action ?? "");

    if (action === "createConversation") {
      const title = String(payload.title ?? "").trim();
      const memberIds = Array.isArray(payload.memberIds) ? payload.memberIds.map(Number).filter(Boolean) : [];
      if (!memberIds.length) return Response.json({ error: "يجب تحديد أعضاء المحادثة" }, { status: 400 });
      const inserted = await db.prepare("INSERT INTO conversations (title,is_group,created_by) VALUES (?,?,?)").bind(title, memberIds.length > 2 ? 1 : 0, session.id).run();
      const convId = Number(inserted.meta.last_row_id);
      const stmts = [] as ReturnType<typeof db.prepare>[];
      for (const id of memberIds) stmts.push(db.prepare("INSERT INTO conversation_members (conversation_id,employee_id) VALUES (?,?)").bind(convId, id));
      // ensure creator is member
      if (!memberIds.includes(session.id)) stmts.push(db.prepare("INSERT INTO conversation_members (conversation_id,employee_id) VALUES (?,?)").bind(convId, session.id));
      if (stmts.length) await db.batch(stmts);
      return Response.json({ ok: true, id: convId }, { status: 201 });
    }

    if (action === "sendMessage") {
      const conversationId = Number(payload.conversationId);
      const content = String(payload.content ?? "").trim();
      const contentType = String(payload.contentType ?? "text");
      if (!conversationId || !content) return Response.json({ error: "معرّف المحادثة ومحتوى الرسالة مطلوبان" }, { status: 400 });
      // verify membership
      const member = await db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND employee_id=? LIMIT 1").bind(conversationId, session.id).first();
      if (!member) return Response.json({ error: "غير مسموح لك بإرسال رسالة في هذه المحادثة" }, { status: 403 });
      const inserted = await db.prepare("INSERT INTO messages (conversation_id,sender_id,content,content_type) VALUES (?,?,?,?)").bind(conversationId, session.id, content, contentType).run();
      const messageId = Number(inserted.meta.last_row_id);
      // create notifications for members except sender
      const recipients = await db.prepare("SELECT employee_id AS id FROM conversation_members WHERE conversation_id=? AND employee_id!=?").bind(conversationId, session.id).all<{ id: number }>();
      const notifStmts: ReturnType<typeof db.prepare>[] = [];
      for (const r of recipients.results) notifStmts.push(db.prepare("INSERT INTO notifications (employee_id,message_id,type,data) VALUES (?,?,?,?)").bind(r.id, messageId, "message", JSON.stringify({ conversationId })));
      if (notifStmts.length) await db.batch(notifStmts);
      // send browser push for subscribed recipients (non-blocking)
      try {
        const subs = await db.prepare("SELECT endpoint, p256dh, auth, raw FROM push_subscriptions WHERE employee_id IN (SELECT employee_id FROM conversation_members WHERE conversation_id=? AND employee_id!=?)").bind(conversationId, session.id).all();
        for (const s of subs.results) {
          try {
            const subscription = JSON.parse(s.raw || '{}');
            // fire-and-forget internal endpoint to attempt send
            await fetch(new URL('/api/chat/push/send', request.url).toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription, payload: { title: 'رسالة جديدة', body: content, conversationId, messageId } }) }).catch(()=>{});
          } catch (e) {}
        }
      } catch (e) {}
      // push real-time event to SSE subscribers (in-memory)
      try {
        // @ts-ignore globalThis may carry a server-wide map of subscribers
        const subs: Map<number, any> = (globalThis.__chatSSESubscribers ||= new Map());
        for (const r of recipients.results) {
          const client = subs.get(Number(r.id));
          if (client && client.writable) {
            try {
              client.write(`event: message\ndata: ${JSON.stringify({ conversationId, messageId, content, senderId: session.id, createdAt: new Date().toISOString() })}\n\n`);
            } catch (e) {
              // ignore write errors
            }
          }
        }
      } catch (e) {
        // ignore pubsub errors
      }
      const msg = await db.prepare("SELECT id,conversation_id AS conversationId,sender_id AS senderId,content,content_type AS contentType,created_at AS createdAt FROM messages WHERE id=? LIMIT 1").bind(messageId).first();
      return Response.json({ ok: true, message: msg }, { status: 201 });
    }

    return Response.json({ error: "إجراء غير معروف" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر تنفيذ الإجراء" }, { status: 500 });
  }
}
