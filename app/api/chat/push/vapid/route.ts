import { env } from "cloudflare:workers";
export async function GET() {
  // Return VAPID public key (set in environment) or empty
  return new Response(JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY || "" }), { headers: { 'Content-Type': 'application/json' } });
}
