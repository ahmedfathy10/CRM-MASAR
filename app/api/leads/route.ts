import { env } from "cloudflare:workers";
import { ensurePhaseTwo, normalizePhone } from "@/db/phase-two";

export const dynamic = "force-dynamic";

function tokenFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("masar_session="))?.slice("masar_session=".length) ?? "";
}

export async function GET() {
  try {
    await ensurePhaseTwo();
    const db = env.DB;
    const [leads, calls, followups, forms] = await Promise.all([
      db.prepare(`SELECT l.id, l.full_name AS fullName, l.primary_phone AS primaryPhone, l.secondary_phone AS secondaryPhone, l.email, l.source, l.campaign, l.interest, l.status, CASE WHEN l.status='paid' THEN 'Paid' WHEN l.status='registered' THEN 'Registered' ELSE 'Not Yet' END AS finalStatus, l.priority, l.notes, l.custom_data AS customData, l.assigned_employee_id AS assignedEmployeeId, l.branch_id AS branchId, l.created_at AS createdAt, e.full_name AS assignedEmployee, b.name AS branchName, (SELECT COUNT(*) FROM call_records c WHERE c.lead_id=l.id) AS callCount, (SELECT c.result FROM call_records c WHERE c.lead_id=l.id ORDER BY c.call_at DESC, c.id DESC LIMIT 1) AS lastCallResult, (SELECT ce.full_name FROM call_records c LEFT JOIN employees ce ON ce.id=c.assigned_employee_id WHERE c.lead_id=l.id ORDER BY c.call_at DESC, c.id DESC LIMIT 1) AS lastCallBy FROM leads l LEFT JOIN employees e ON e.id=l.assigned_employee_id LEFT JOIN branches b ON b.id=l.branch_id ORDER BY l.id DESC LIMIT 200`).all(),
      db.prepare(`SELECT c.id, c.lead_id AS leadId, c.phone, c.direction, c.result, c.assigned_employee_id AS assignedEmployeeId, c.branch_id AS branchId, c.call_at AS callAt, c.notes, c.custom_data AS customData, e.full_name AS assignedEmployee, l.full_name AS leadName, b.name AS branchName FROM call_records c LEFT JOIN employees e ON e.id=c.assigned_employee_id LEFT JOIN leads l ON l.id=c.lead_id LEFT JOIN branches b ON b.id=c.branch_id ORDER BY c.call_at DESC, c.id DESC LIMIT 200`).all(),
      db.prepare(`SELECT f.id, f.lead_id AS leadId, f.assigned_employee_id AS assignedEmployeeId, f.branch_id AS branchId, f.scheduled_at AS scheduledAt, f.channel, f.status, f.priority, f.notes, f.outcome, f.custom_data AS customData, f.completed_at AS completedAt, f.created_at AS createdAt, l.full_name AS leadName, l.primary_phone AS leadPhone, e.full_name AS assignedEmployee, b.name AS branchName FROM followups f JOIN leads l ON l.id=f.lead_id LEFT JOIN employees e ON e.id=f.assigned_employee_id LEFT JOIN branches b ON b.id=f.branch_id ORDER BY CASE WHEN f.status='pending' THEN 0 ELSE 1 END, f.scheduled_at ASC, f.id DESC LIMIT 300`).all(),
      db.prepare(`SELECT f.form_key AS formKey, f.version, ff.id, ff.field_key AS fieldKey, ff.label, ff.type, ff.placeholder, ff.required, ff.visible, ff.sort_order AS sortOrder, ff.options_json AS optionsJson, ff.width FROM form_definitions f JOIN form_fields ff ON ff.form_id=f.id WHERE f.form_key IN ('lead','call','lead_details','followup') ORDER BY f.form_key, ff.sort_order`).all(),
    ]);
    return Response.json({ leads: leads.results, calls: calls.results, followups: followups.results, leadFields: forms.results.filter((field) => field.formKey === "lead"), callFields: forms.results.filter((field) => field.formKey === "call"), leadDetailsFields: forms.results.filter((field) => field.formKey === "lead_details"), followupFields: forms.results.filter((field) => field.formKey === "followup") });
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
        .bind(fullName, primaryPhone, normalizedPhone, String(payload.secondaryPhone ?? ""), "", String(payload.source ?? "غير محدد"), "", String(payload.interest ?? payload.course ?? ""), assignee, Number(payload.branchId) || null, "normal", String(payload.notes ?? ""), JSON.stringify(customData)).run();
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
        .bind(String(details.source ?? payload.source ?? "غير محدد"), String(details.interest ?? details.course ?? ""), String(details.detailsNotes ?? payload.notes ?? ""), JSON.stringify(merged), id).run();
      return Response.json({ ok: true });
    }
    if (action === "convertLeadToStudent") {
      const leadId = Number(payload.leadId);
      if (!leadId) return Response.json({ error: "العميل غير محدد" }, { status: 400 });
      const lead = await db.prepare("SELECT id, full_name AS fullName, primary_phone AS mobile, custom_data AS customData FROM leads WHERE id=?").bind(leadId).first<{ id:number; fullName:string; mobile:string; customData:string }>();
      const level = await db.prepare("SELECT id FROM settings_entities WHERE kind='level' AND is_active=1 ORDER BY id LIMIT 1").first<{id:number}>();
      if (!lead || !level) return Response.json({ error: "العميل أو المستوى غير موجود" }, { status: 404 });
      const existing = await db.prepare("SELECT id FROM students WHERE mobile=?").bind(lead.mobile).first<{ id:number }>();
      if (existing) return Response.json({ error: "هذا العميل مسجل كطالب بالفعل" }, { status: 409 });
      const result = await db.prepare("INSERT INTO students (full_name, mobile, level_id) VALUES (?, ?, ?)").bind(lead.fullName, lead.mobile, level.id).run();
      let customData:Record<string,unknown>={}; try { customData=JSON.parse(lead.customData||"{}") as Record<string,unknown>; } catch {}
      await db.prepare("UPDATE leads SET status='registered', custom_data=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify({ ...customData, studentId:result.meta.last_row_id, convertedAt:new Date().toISOString() }), leadId).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
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
      const token=tokenFrom(request);
      const sessionEmployee=token?await db.prepare("SELECT e.id FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token,new Date().toISOString()).first<{id:number}>():null;
      const assignee=Number(payload.assignedEmployeeId)||sessionEmployee?.id||(await db.prepare("SELECT id FROM employees WHERE status IN ('active','نشط') ORDER BY id LIMIT 1").first<{id:number}>())?.id||null;
      const direction = String(payload.direction) === "واردة" ? "incoming" : "outgoing";
      const resultMap: Record<string, string> = { "تم الرد": "answered", "لم يرد": "no_answer", "مشغول": "busy", "رقم خاطئ": "wrong_number", "طلب معاودة الاتصال": "callback" };
      const result = await db.prepare(`INSERT INTO call_records (lead_id, phone, direction, result, assigned_employee_id, branch_id, call_at, notes, custom_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(lead?.id ?? null, phone, direction, resultMap[String(payload.result)] ?? "no_answer", assignee, lead?.branchId ?? (Number(payload.branchId) || null), String(payload.callAt ?? new Date().toISOString()), String(payload.notes ?? ""), JSON.stringify(payload.customData ?? {})).run();
      return Response.json({ id: result.meta.last_row_id, matchedLead: Boolean(lead) }, { status: 201 });
    }
    if (action === "createFollowup") {
      const leadId = Number(payload.leadId);
      const scheduledDate = new Date(String(payload.scheduledAt ?? ""));
      if (!leadId || Number.isNaN(scheduledDate.getTime())) return Response.json({ error: "العميل وموعد المتابعة مطلوبان" }, { status: 400 });
      const lead = await db.prepare("SELECT id, assigned_employee_id AS assignedEmployeeId, branch_id AS branchId FROM leads WHERE id=?").bind(leadId).first<{ id: number; assignedEmployeeId: number | null; branchId: number | null }>();
      if (!lead) return Response.json({ error: "العميل غير موجود" }, { status: 404 });
      const channelMap: Record<string, string> = { "مكالمة": "call", "واتساب": "whatsapp", "رسالة": "message", "زيارة": "visit", "اجتماع أونلاين": "online_meeting" };
      const priorityMap: Record<string, string> = { "عادية": "normal", "مرتفعة": "high", "عاجلة": "urgent" };
      const standard = new Set(["scheduledAt", "assignedEmployeeId", "channel", "priority", "notes"]);
      const customData = Object.fromEntries(Object.entries(payload).filter(([key]) => !standard.has(key) && key !== "action" && key !== "leadId"));
      const result = await db.prepare("INSERT INTO followups (lead_id, assigned_employee_id, branch_id, scheduled_at, channel, priority, notes, custom_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(lead.id, Number(payload.assignedEmployeeId) || lead.assignedEmployeeId, lead.branchId, scheduledDate.toISOString(), channelMap[String(payload.channel)] ?? "call", priorityMap[String(payload.priority)] ?? "normal", String(payload.notes ?? "").trim(), JSON.stringify(customData)).run();
      await db.prepare("UPDATE leads SET status='followup', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(lead.id).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }
    if (action === "completeFollowup") {
      const id = Number(payload.id);
      const followup = await db.prepare("SELECT lead_id AS leadId FROM followups WHERE id=? AND status='pending'").bind(id).first<{ leadId: number }>();
      if (!followup) return Response.json({ error: "المتابعة غير موجودة أو تم إنهاؤها" }, { status: 404 });
      const outcome = String(payload.outcome ?? "").trim();
      if (!outcome) return Response.json({ error: "نتيجة المتابعة مطلوبة" }, { status: 400 });
      await db.prepare("UPDATE followups SET status='completed', outcome=?, completed_at=CURRENT_TIMESTAMP WHERE id=?").bind(outcome, id).run();
      const pending = await db.prepare("SELECT COUNT(*) AS count FROM followups WHERE lead_id=? AND status='pending'").bind(followup.leadId).first<{ count: number }>();
      if ((pending?.count ?? 0) === 0) await db.prepare("UPDATE leads SET status='contacted', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(followup.leadId).run();
      return Response.json({ ok: true });
    }
    if (action === "rescheduleFollowup") {
      const id = Number(payload.id);
      const scheduledDate = new Date(String(payload.scheduledAt ?? ""));
      if (!id || Number.isNaN(scheduledDate.getTime())) return Response.json({ error: "موعد جديد صحيح مطلوب" }, { status: 400 });
      await db.prepare("UPDATE followups SET scheduled_at=?, status='pending', completed_at=NULL WHERE id=?").bind(scheduledDate.toISOString(), id).run();
      return Response.json({ ok: true });
    }
    return Response.json({ error: "إجراء غير مدعوم" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر حفظ البيانات" }, { status: 500 });
  }
}
