import { env } from "cloudflare:workers";
import { ensurePhaseTwo, normalizePhone } from "@/db/phase-two";

export const dynamic = "force-dynamic";

type SessionEmployee = { id: number; fullName: string; phone: string; status: string; jobTitle: string | null; jobTitleId:number|null; departmentId:number|null; branchId:number|null };

function tokenFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("masar_session="))?.slice("masar_session=".length) ?? "";
}

async function hashPassword(password: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function cookie(request: Request, token = "", maxAge = 0) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `masar_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function GET(request: Request) {
  await ensurePhaseTwo();
  const token = tokenFrom(request); if (!token) return Response.json({ employee: null });
  const employee = await env.DB.prepare("SELECT e.id, e.full_name AS fullName, e.phone, e.status, e.job_title_id AS jobTitleId, e.department_id AS departmentId, e.branch_id AS branchId, j.name AS jobTitle FROM employee_sessions s JOIN employees e ON e.id=s.employee_id LEFT JOIN job_titles j ON j.id=e.job_title_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token, new Date().toISOString()).first<SessionEmployee>();
  return Response.json({ employee: employee ?? null });
}

export async function POST(request: Request) {
  await ensurePhaseTwo();
  const payload = await request.json() as Record<string, unknown>;
  const db = env.DB;
  if (payload.action === "logout") {
    const token = tokenFrom(request); if (token) await db.prepare("DELETE FROM employee_sessions WHERE token=?").bind(token).run();
    return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie(request) } });
  }
  const phone = String(payload.phone ?? "").trim(); const normalizedPhone=normalizePhone(phone); const password = String(payload.password ?? "");
  if (!normalizedPhone || !password) return Response.json({ error: "أدخل رقم الموبايل وكلمة المرور" }, { status: 400 });
  const employeeRows=await db.prepare("SELECT e.id, e.full_name AS fullName, e.phone, e.status, e.password_hash AS passwordHash, e.job_title_id AS jobTitleId, e.department_id AS departmentId, e.branch_id AS branchId, j.name AS jobTitle FROM employees e LEFT JOIN job_titles j ON j.id=e.job_title_id").all<SessionEmployee & { passwordHash: string }>();
  const employee=employeeRows.results.find((item)=>normalizePhone(item.phone)===normalizedPhone);
  const passwordHash = await hashPassword(password);
  if (!employee || (employee.passwordHash && employee.passwordHash !== passwordHash) || (!employee.passwordHash && password !== "12345")) return Response.json({ error: "بيانات الدخول غير صحيحة" }, { status: 401 });
  if (["موقوف", "disabled", "إنهاء العمل", "استقالة", "انقطاع عن العمل"].includes(employee.status)) return Response.json({ error: "هذا الحساب غير متاح للدخول" }, { status: 403 });
  if (!employee.passwordHash) await db.prepare("UPDATE employees SET password_hash=? WHERE id=?").bind(passwordHash, employee.id).run();
  await db.prepare("DELETE FROM employee_sessions WHERE expires_at<=?").bind(new Date().toISOString()).run();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`; const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await db.prepare("INSERT INTO employee_sessions (token, employee_id, expires_at) VALUES (?, ?, ?)").bind(token, employee.id, expiresAt).run();
  const { passwordHash: _passwordHash, ...safeEmployee } = employee;
  return Response.json({ employee: safeEmployee }, { headers: { "Set-Cookie": cookie(request, token, 60 * 60 * 24 * 30) } });
}
