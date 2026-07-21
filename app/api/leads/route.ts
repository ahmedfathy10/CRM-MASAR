import { env } from "cloudflare:workers";
import { ensurePhaseTwo, normalizePhone } from "@/db/phase-two";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensurePhaseTwo();
    const db = env.DB;
    const [leads, calls, forms] = await Promise.all([
      db.prepare(`SELECT l.id, l.full_name AS fullName, l.primary_phone AS primaryPhone, l.secondary_phone AS secondaryPhone, l.email, l.source, l.campaign, l.interest, l.status, l.priority, l.notes, l.custom_data AS customData, l.assigned_employee_id AS assignedEmployeeId, l.branch_id AS branchId, l.created_at AS createdAt, e.full_name AS assignedEmployee, b.name AS branchName, (SELECT COUNT(*) FROM call_records c WHERE c.lead_id=l.id) AS callCount, (SELECT c.result FROM call_records c WHERE c.lead_id=l.id ORDER BY c.call_at DESC, c.id DESC LIMIT 1) AS lastCallResult, (SELECT ce.full_name FROM call_records c LEFT JOIN employees ce ON ce.id=c.assigned_employee_id WHERE c.lead_id=l.id ORDER BY c.call_at DESC, c.id DESC LIMIT 1) AS lastCallBy FROM leads l LEFT JOIN employees e ON e.id=l.assigned_employee_id LEFT JOIN branches b ON b.id=l.branch_id ORDER BY l.id DESC LIMIT 200`).all(),
      db.prepare(`SELECT c.id, c.lead_id AS leadId, c.phone, c.direction, c.result, c.assigned_employee_id AS assignedEmployeeId, c.branch_id AS branchId, c.call_at AS callAt, c.notes, e.full_name AS assignedEmployee, l.full_name AS leadName, b.name AS branchName FROM call_records c LEFT JOIN employees e ON e.id=c.assigned_employee_id LEFT JOIN leads l ON l.id=c.lead_id LEFT JOIN branches b ON b.id=c.branch_id ORDER BY c.call_at DESC, c.id DESC LIMIT 200`).all(),
      db.prepare(`SELECT f.form_key AS formKey, f.version, ff.id, ff.field_key AS fieldKey, ff.label, ff.type, ff.placeholder, ff.required, ff.visible, ff.sort_order AS sortOrder, ff.options_json AS optionsJson, ff.width FROM form_definitions f JOIN form_fields ff ON ff.form_id=f.id WHERE f.form_key IN ('lead','call','lead_details') ORDER BY f.form_key, ff.sort_order`).all(),
    ]);
    return Response.json({ leads: leads.results, calls: calls.results, leadFields: forms.results.filter((field) => field.formKey === "lead"), callFields: forms.results.filter((field) => field.formKey === "call"), leadDetailsFields: forms.results.filter((field) => field.formKey === "lead_details") });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر تحميل بيانات العملاء" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensurePhaseTwo();
    const db = env.DB;
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    if (action === "createLead") {
      const fullName = String(payload.fullName ?? "").trim();
      const primaryPhone = String(payload.primaryPhone ?? "").trim();
      const normalizedPhone = normalizePhone(primaryPhone);
      if (!fullName || normalizedPhone.length < 8) return Response.json({ error: "اسم العميل ورقم موبايل صحيح مطلوبان" }, { status: 400 });
      const duplicate = await db.prepare("SELECT id, full_name AS fullName FROM leads WHERE normalized_phone=?").bind(normalizedPhone).first<{ id: number; fullName: string }>();
      if (duplicate) return Response.json({ error: `رقم الهاتف مسجل بالفعل للعميل: ${duplicate.fullName}`, duplicate }, { status: 409 });
      const assignee = Number(payload.assignedEmployeeId) || (await db.prepare("SELECT id FROM employees WHERE status='active' ORDER BY id LIMIT 1").first<{ id: number }>())?.id || null;
      const customData = (payload.customData as Record<string, unknown>) ?? {};
      const result = await db.prepare(`INSERT INTO leads (full_name, primary_phone, normalized_phone, secondary_phone, email, source, campaign, interest, assigned_employee_id, branch_id, priority, notes, custom_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(fullName, primaryPhone, normalizedPhone, String(payload.secondaryPhone ?? ""), "", String(payload.source ?? "غير محدد"), "", String(payload.course ?? ""), assignee, Number(payload.branchId) || null, "normal", String(payload.notes ?? ""), JSON.stringify(customData)).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }
    if (action === "updateLeadDetails") {
      const id = Number(payload.id);
      const lead = await db.prepare("SELECT custom_data AS customData FROM leads WHERE id=?").bind(id).first<{ customData: string }>();
      if (!lead) return Response.json({ error: "العميل غير موجود" }, { status: 404 });
      let current: Record<string, unknown> = {};
      try { current = JSON.parse(lead.customData || "{}"); } catch { current = {}; }
      const details = (payload.details as Record<string, unknown>) ?? {};
      const merged = { ...current, ...details };
      await db.prepare("UPDATE leads SET source=?, interest=?, notes=?, custom_data=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(String(details.source ?? payload.source ?? "غير محدد"), String(details.course ?? ""), String(details.detailsNotes ?? payload.notes ?? ""), JSON.stringify(merged), id).run();
      return Response.json({ ok: true });
    }
    if (action === "recordLeadCallResult") {
      const id = Number(payload.id);
      const lead = await db.prepare("SELECT id, primary_phone AS phone, assigned_employee_id AS assignedEmployeeId, branch_id AS branchId FROM leads WHERE id=?").bind(id).first<{ id: number; phone: string; assignedEmployeeId: number | null; branchId: number | null }>();
      if (!lead) return Response.json({ error: "العميل غير موجود" }, { status: 404 });
      const resultMap: Record<string, string> = { "No Answer": "no_answer", "Answered": "answered", "Interested": "interested", "Not Interested": "not_interested", "Busy": "busy", "Wrong Number": "wrong_number", "Call Back": "callback" };
      const resultValue = resultMap[String(payload.result)] ?? "no_answer";
      await db.prepare("INSERT INTO call_records (lead_id, phone, direction, result, assigned_employee_id, branch_id, call_at, notes) VALUES (?, ?, 'outgoing', ?, ?, ?, CURRENT_TIMESTAMP, ?)")
        .bind(lead.id, lead.phone, resultValue, lead.assignedEmployeeId, lead.branchId, String(payload.notes ?? "")).run();
      await db.prepare("UPDATE leads SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(resultValue === "interested" ? "qualified" : resultValue === "not_interested" ? "unqualified" : "contacted", id).run();
      return Response.json({ ok: true }, { status: 201 });
    }
    if (action === "createCall") {
      const phone = String(payload.phone ?? "").trim(); const normalizedPhone = normalizePhone(phone);
      if (normalizedPhone.length < 8) return Response.json({ error: "رقم هاتف صحيح مطلوب" }, { status: 400 });
      const lead = await db.prepare("SELECT id, branch_id AS branchId FROM leads WHERE normalized_phone=?").bind(normalizedPhone).first<{ id: number; branchId: number | null }>();
      const direction = String(payload.direction) === "واردة" ? "incoming" : "outgoing";
      const resultMap: Record<string, string> = { "تم الرد": "answered", "لم يرد": "no_answer", "مشغول": "busy", "رقم خاطئ": "wrong_number", "طلب معاودة الاتصال": "callback" };
      const result = await db.prepare(`INSERT INTO call_records (lead_id, phone, direction, result, assigned_employee_id, branch_id, call_at, notes, custom_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(lead?.id ?? null, phone, direction, resultMap[String(payload.result)] ?? "no_answer", Number(payload.assignedEmployeeId) || null, lead?.branchId ?? (Number(payload.branchId) || null), String(payload.callAt ?? new Date().toISOString()), String(payload.notes ?? ""), JSON.stringify(payload.customData ?? {})).run();
      return Response.json({ id: result.meta.last_row_id, matchedLead: Boolean(lead) }, { status: 201 });
    }
    return Response.json({ error: "إجراء غير مدعوم" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر حفظ البيانات" }, { status: 500 });
  }
}
