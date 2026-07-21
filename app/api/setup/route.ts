import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabase();
    const db = env.DB;
    const [departments, jobTitles, roles, employees, forms] = await Promise.all([
      db.prepare("SELECT d.id, d.name, d.color, d.parent_id AS parentId, d.support_enabled AS supportEnabled, d.is_active AS isActive, p.name AS parentName, (SELECT COUNT(*) FROM job_titles j WHERE j.department_id=d.id) AS jobCount FROM departments d LEFT JOIN departments p ON p.id=d.parent_id ORDER BY d.id").all(),
      db.prepare("SELECT j.id, j.name, j.department_id AS departmentId, d.name AS department FROM job_titles j LEFT JOIN departments d ON d.id=j.department_id ORDER BY d.name, j.name").all(),
      db.prepare("SELECT id, name, description FROM roles ORDER BY id").all(),
      db.prepare(`SELECT e.id, e.full_name AS fullName, e.email, e.phone, e.status, e.department_id AS departmentId, e.job_title_id AS jobTitleId, e.role_id AS roleId, d.name AS department, j.name AS jobTitle, r.name AS role FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN roles r ON r.id=e.role_id ORDER BY e.id DESC`).all(),
      db.prepare(`SELECT f.id AS formId, f.form_key AS formKey, f.name AS formName, f.version, ff.id, ff.field_key AS fieldKey, ff.label, ff.type, ff.placeholder, ff.required, ff.visible, ff.sort_order AS sortOrder, ff.options_json AS optionsJson, ff.width FROM form_definitions f JOIN form_fields ff ON ff.form_id=f.id ORDER BY ff.sort_order`).all(),
    ]);
    return Response.json({ departments: departments.results, jobTitles: jobTitles.results, roles: roles.results, employees: employees.results, fields: forms.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر تحميل البيانات" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const db = env.DB;
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");

    if (action === "createEmployee") {
      const fullName = String(payload.fullName ?? "").trim();
      const email = String(payload.email ?? "").trim().toLowerCase();
      if (!fullName || !email) return Response.json({ error: "الاسم والبريد الإلكتروني مطلوبان" }, { status: 400 });
      const requestedStatus = String(payload.status ?? "");
      const status = requestedStatus === "نشط" ? "active" : requestedStatus === "موقوف" ? "disabled" : "invited";
      const result = await db.prepare("INSERT INTO employees (full_name, email, phone, department_id, job_title_id, role_id, status, custom_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(fullName, email, String(payload.phone ?? ""), Number(payload.departmentId) || null, Number(payload.jobTitleId) || null, Number(payload.roleId) || null, status, JSON.stringify(payload.customData ?? {})).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }

    if (action === "createDepartment") {
      const name = String(payload.name ?? "").trim();
      if (!name) return Response.json({ error: "اسم القسم مطلوب" }, { status: 400 });
      const result = await db.prepare("INSERT INTO departments (name, color, parent_id, support_enabled) VALUES (?, ?, ?, ?)")
        .bind(name, String(payload.color ?? "#2f6b5f"), Number(payload.parentId) || null, payload.supportEnabled ? 1 : 0).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }

    if (action === "createJobTitle") {
      const name = String(payload.name ?? "").trim();
      const departmentId = Number(payload.departmentId);
      if (!name || !departmentId) return Response.json({ error: "اسم الوظيفة والقسم مطلوبان" }, { status: 400 });
      const result = await db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, ?)").bind(name, departmentId).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }

    if (action === "deleteDepartment") {
      const id = Number(payload.id);
      const usage = await db.prepare("SELECT (SELECT COUNT(*) FROM employees WHERE department_id=?) + (SELECT COUNT(*) FROM job_titles WHERE department_id=?) + (SELECT COUNT(*) FROM departments WHERE parent_id=?) AS count").bind(id, id, id).first<{ count: number }>();
      if ((usage?.count ?? 0) > 0) return Response.json({ error: "لا يمكن حذف قسم مرتبط بموظفين أو وظائف أو أقسام فرعية" }, { status: 409 });
      await db.prepare("DELETE FROM departments WHERE id=?").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "deleteJobTitle") {
      const id = Number(payload.id);
      const usage = await db.prepare("SELECT COUNT(*) AS count FROM employees WHERE job_title_id=?").bind(id).first<{ count: number }>();
      if ((usage?.count ?? 0) > 0) return Response.json({ error: "لا يمكن حذف وظيفة مرتبطة بموظفين" }, { status: 409 });
      await db.prepare("DELETE FROM job_titles WHERE id=?").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "toggleField") {
      const id = Number(payload.id);
      const visible = payload.visible ? 1 : 0;
      const required = payload.required ? 1 : 0;
      await db.prepare("UPDATE form_fields SET visible=?, required=? WHERE id=?").bind(visible, required, id).run();
      await db.prepare("UPDATE form_definitions SET version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT form_id FROM form_fields WHERE id=?)").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "addField") {
      const label = String(payload.label ?? "").trim();
      if (!label) return Response.json({ error: "اسم الحقل مطلوب" }, { status: 400 });
      const form = await db.prepare("SELECT id FROM form_definitions WHERE form_key='employee'").first<{ id: number }>();
      if (!form) throw new Error("تعريف النموذج غير موجود");
      const order = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM form_fields WHERE form_id=?").bind(form.id).first<{ nextOrder: number }>();
      const fieldKey = `custom_${Date.now()}`;
      await db.prepare("INSERT INTO form_fields (form_id, field_key, label, type, placeholder, required, visible, sort_order, width) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)")
        .bind(form.id, fieldKey, label, String(payload.type ?? "text"), String(payload.placeholder ?? ""), payload.required ? 1 : 0, order?.nextOrder ?? 1, String(payload.width ?? "half")).run();
      return Response.json({ ok: true }, { status: 201 });
    }

    return Response.json({ error: "إجراء غير مدعوم" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر حفظ البيانات" }, { status: 500 });
  }
}
