import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

type SessionEmployee = {
  id: number;
  fullName: string;
  jobTitleId: number | null;
  departmentId: number | null;
  branchId: number | null;
};

type SchedulePermission = {
  canView: number;
  canAdd: number;
  canEdit: number;
  canDelete: number;
  dataScope: "own" | "branch" | "department" | "all";
};

function tokenFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("masar_session="))?.slice("masar_session=".length) ?? "";
}

async function context(request: Request) {
  const db = env.DB;
  const token = tokenFrom(request);
  const session = token
    ? await db
        .prepare("SELECT e.id,e.full_name AS fullName,e.job_title_id AS jobTitleId,e.department_id AS departmentId,e.branch_id AS branchId FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1")
        .bind(token, new Date().toISOString())
        .first<SessionEmployee>()
    : null;
  if (!session) return null;

  const rows = await db
    .prepare("SELECT page_key AS pageKey,can_view AS canView,can_add AS canAdd,can_edit AS canEdit,can_delete AS canDelete,data_scope AS dataScope FROM job_title_permissions WHERE job_title_id=?")
    .bind(session.jobTitleId)
    .all<{ pageKey: string; canView: number; canAdd: number; canEdit: number; canDelete: number; dataScope: SchedulePermission["dataScope"] }>();
  const saved = rows.results.find((item: { pageKey: string; canView: number; canAdd: number; canEdit: number; canDelete: number; dataScope: SchedulePermission["dataScope"] }) => item.pageKey === "employeeSchedule");
  const legacyFullAccess = !rows.results.length || rows.results.every((item: { canView: number }) => Boolean(item.canView));
  const permission: SchedulePermission = saved
    ? { canView: saved.canView, canAdd: saved.canAdd, canEdit: saved.canEdit, canDelete: saved.canDelete, dataScope: saved.dataScope || "all" }
    : { canView: legacyFullAccess ? 1 : 0, canAdd: legacyFullAccess ? 1 : 0, canEdit: legacyFullAccess ? 1 : 0, canDelete: legacyFullAccess ? 1 : 0, dataScope: "all" };
  return { db, session, permission };
}

function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const from = `${month}-01`;
  const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function employeeScope(session: SessionEmployee, scope: SchedulePermission["dataScope"]) {
  if (scope === "own") return { sql: "e.id=?", values: [session.id] };
  if (scope === "branch") return { sql: "e.branch_id=?", values: [session.branchId ?? -1] };
  if (scope === "department") return { sql: "e.department_id=?", values: [session.departmentId ?? -1] };
  return { sql: "1=1", values: [] as number[] };
}

async function getSchedule(request: Request) {
  await ensureDatabase();
  const auth = await context(request);
  if (!auth) return Response.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
  if (!auth.permission.canView) return Response.json({ error: "ليس لديك صلاحية مشاهدة جداول الموظفين" }, { status: 403 });

  const month = new URL(request.url).searchParams.get("month") || "";
  const range = monthRange(month);
  if (!range) return Response.json({ error: "الشهر المحدد غير صحيح" }, { status: 400 });
  const scope = employeeScope(auth.session, auth.permission.dataScope);
  const employeeQuery = auth.db.prepare(`SELECT e.id,e.full_name AS fullName,e.status,e.department_id AS departmentId,e.branch_id AS branchId,d.name AS department,b.name AS branchName FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN branches b ON b.id=e.branch_id WHERE ${scope.sql} ORDER BY e.full_name`);
  const employees = await (scope.values.length ? employeeQuery.bind(...scope.values) : employeeQuery).all();
  const entries = await auth.db
    .prepare(`SELECT es.id,es.employee_id AS employeeId,e.full_name AS employeeName,es.work_date AS workDate,es.day_status AS dayStatus,es.leave_type AS leaveType,es.shift_from AS shiftFrom,es.shift_to AS shiftTo,es.notes,es.created_by_employee_id AS createdByEmployeeId,es.created_by_name AS createdByName,es.updated_at AS updatedAt FROM employee_schedules es JOIN employees e ON e.id=es.employee_id WHERE es.work_date BETWEEN ? AND ? AND ${scope.sql} ORDER BY es.work_date,e.full_name`)
    .bind(range.from, range.to, ...scope.values)
    .all();
  const leaveTypes = await auth.db.prepare("SELECT title FROM settings_entities WHERE kind='employee_leave_type' AND is_active=1 ORDER BY id").all<{ title: string }>();
  return Response.json({ employees: employees.results, entries: entries.results, leaveTypes: leaveTypes.results.map((item) => item.title), permission: auth.permission });
}

export async function GET(request: Request) {
  try {
    return await getSchedule(request);
  } catch (reason) {
    console.error("employee-schedule GET failed", reason);
    return Response.json({ error: reason instanceof Error ? reason.message : "تعذر تحميل جدول الموظفين" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  await ensureDatabase();
  const auth = await context(request);
  if (!auth) return Response.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
  const payload = (await request.json()) as Record<string, unknown>;
  const action = String(payload.action || "save");
  const id = Number(payload.id) || 0;

  if (action === "delete") {
    if (!auth.permission.canDelete) return Response.json({ error: "ليس لديك صلاحية حذف الجدول" }, { status: 403 });
    const existing = await auth.db.prepare("SELECT employee_id AS employeeId FROM employee_schedules WHERE id=?").bind(id).first<{ employeeId: number }>();
    if (!existing) return Response.json({ error: "السجل غير موجود" }, { status: 404 });
    const scope = employeeScope(auth.session, auth.permission.dataScope);
    const allowed = await auth.db.prepare(`SELECT e.id FROM employees e WHERE e.id=? AND ${scope.sql}`).bind(existing.employeeId, ...scope.values).first();
    if (!allowed) return Response.json({ error: "الموظف خارج نطاق صلاحيتك" }, { status: 403 });
    await auth.db.prepare("DELETE FROM employee_schedules WHERE id=?").bind(id).run();
    return Response.json({ ok: true });
  }

  const employeeId = Number(payload.employeeId) || 0;
  const workDate = String(payload.workDate || "").slice(0, 10);
  const dayStatus = String(payload.dayStatus || "");
  const leaveType = dayStatus === "leave" ? String(payload.leaveType || "").trim() : "";
  const shiftFrom = dayStatus === "work" ? String(payload.shiftFrom || "").trim() : "";
  const shiftTo = dayStatus === "work" ? String(payload.shiftTo || "").trim() : "";
  const notes = String(payload.notes || "").trim();
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !["work", "leave"].includes(dayStatus)) return Response.json({ error: "بيانات اليوم غير مكتملة" }, { status: 400 });
  if (dayStatus === "leave" && !leaveType) return Response.json({ error: "اختر نوع الإجازة" }, { status: 400 });
  if (dayStatus === "leave") {
    const configuredLeave = await auth.db.prepare("SELECT id FROM settings_entities WHERE kind='employee_leave_type' AND title=? AND is_active=1 LIMIT 1").bind(leaveType).first();
    if (!configuredLeave) return Response.json({ error: "اختر نوع إجازة مسجلًا في Admin Settings" }, { status: 400 });
  }
  if (dayStatus === "work" && (!/^\d{2}:\d{2}$/.test(shiftFrom) || !/^\d{2}:\d{2}$/.test(shiftTo))) return Response.json({ error: "حدد وقت بداية ونهاية الشفت" }, { status: 400 });
  const scope = employeeScope(auth.session, auth.permission.dataScope);
  const employee = await auth.db.prepare(`SELECT e.id FROM employees e WHERE e.id=? AND ${scope.sql}`).bind(employeeId, ...scope.values).first();
  if (!employee) return Response.json({ error: "الموظف خارج نطاق صلاحيتك" }, { status: 403 });

  const existing = await auth.db.prepare("SELECT id FROM employee_schedules WHERE employee_id=? AND work_date=?").bind(employeeId, workDate).first<{ id: number }>();
  if (existing && !auth.permission.canEdit) return Response.json({ error: "ليس لديك صلاحية تعديل الجدول" }, { status: 403 });
  if (!existing && !auth.permission.canAdd) return Response.json({ error: "ليس لديك صلاحية إضافة جدول" }, { status: 403 });
  if (existing) {
    await auth.db.prepare("UPDATE employee_schedules SET day_status=?,leave_type=?,shift_from=?,shift_to=?,notes=?,created_by_employee_id=?,created_by_name=?,updated_at=? WHERE id=?").bind(dayStatus, leaveType, shiftFrom, shiftTo, notes, auth.session.id, auth.session.fullName, new Date().toISOString(), existing.id).run();
    return Response.json({ ok: true, id: existing.id });
  }
  const result = await auth.db.prepare("INSERT INTO employee_schedules (employee_id,work_date,day_status,leave_type,shift_from,shift_to,notes,created_by_employee_id,created_by_name,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(employeeId, workDate, dayStatus, leaveType, shiftFrom, shiftTo, notes, auth.session.id, auth.session.fullName, new Date().toISOString()).run();
  return Response.json({ ok: true, id: result.meta.last_row_id });
}
