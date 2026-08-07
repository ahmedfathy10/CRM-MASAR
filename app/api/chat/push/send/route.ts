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
    const payload = await request.json() as Record<string, any>;
    const subscription = payload.subscription;
    const payloadData = payload.payload || {};
    if (!subscription || !subscription.endpoint) return Response.json({ error: 'اشتراك غير صالح' }, { status: 400 });

    // Try to send push using web-push if available on the runtime.
    try {
      // dynamic import may fail on Cloudflare Workers; wrap in try
      // @ts-ignore
      const webpush = await import('web-push');
      const vapidPublic = env.VAPID_PUBLIC_KEY || '';
      const vapidPrivate = env.VAPID_PRIVATE_KEY || '';
      if (!vapidPublic || !vapidPrivate) return Response.json({ error: 'VAPID keys not configured' }, { status: 500 });
      webpush.setVapidDetails('mailto:admin@example.com', vapidPublic, vapidPrivate);
      await webpush.sendNotification(subscription, JSON.stringify(payloadData));
      return Response.json({ ok: true });
    } catch (e) {
      // Could not send from this runtime — return ok and rely on stored subscriptions for later delivery by another process
      return Response.json({ ok: false, error: 'send_failed', detail: String(e) });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'تعذر إرسال الإشعار' }, { status: 500 });
  }
}
