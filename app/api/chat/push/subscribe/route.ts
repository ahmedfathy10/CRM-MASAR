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
    if (!token) return Response.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    const session = await db.prepare("SELECT e.id FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token, new Date().toISOString()).first<{ id: number }>();
    if (!session) return Response.json({ error: "جلسة غير صالحة" }, { status: 401 });

    const payload = await request.json() as Record<string, any>;
    const subscription = payload.subscription;
    if (!subscription || !subscription.endpoint) return Response.json({ error: 'اشتراك غير صالح' }, { status: 400 });

    const p256dh = subscription.keys?.p256dh || "";
    const auth = subscription.keys?.auth || "";
    const endpoint = subscription.endpoint;

    // upsert
    await db.prepare("INSERT OR REPLACE INTO push_subscriptions (id, employee_id, endpoint, p256dh, auth, raw, created_at) VALUES ((SELECT id FROM push_subscriptions WHERE endpoint=? LIMIT 1),?,?,?,?,?,CURRENT_TIMESTAMP)").bind(endpoint, session.id, endpoint, p256dh, auth, JSON.stringify(subscription)).run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'تعذر حفظ الاشتراك' }, { status: 500 });
  }
}
