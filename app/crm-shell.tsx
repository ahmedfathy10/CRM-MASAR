"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Department = { id: number; name: string; color: string; isActive: number };
type JobTitle = { id: number; name: string; departmentId: number };
type Role = { id: number; name: string; description: string };
type Employee = { id: number; fullName: string; email: string; phone: string; status: "active" | "invited" | "disabled"; departmentId: number; jobTitleId: number; roleId: number; department: string; jobTitle: string; role: string };
type Field = { id: number; fieldKey: string; label: string; type: string; placeholder: string; required: number; visible: number; sortOrder: number; width: "full" | "half"; version: number };
type Setup = { departments: Department[]; jobTitles: JobTitle[]; roles: Role[]; employees: Employee[]; fields: Field[] };
type Tab = "team" | "permissions" | "forms";

const emptySetup: Setup = { departments: [], jobTitles: [], roles: [], employees: [], fields: [] };

export function CrmShell() {
  const [tab, setTab] = useState<Tab>("team");
  const [data, setData] = useState<Setup>(emptySetup);
  const [loading, setLoading] = useState(true);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch("/api/setup", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "تعذر تحميل البيانات");
    setData(payload);
  }

  useEffect(() => {
    load().catch((error) => setNotice(error.message)).finally(() => setLoading(false));
  }, []);

  async function mutate(payload: Record<string, unknown>) {
    const response = await fetch("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "تعذر الحفظ");
    await load();
  }

  return (
    <main className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">م</span><div><strong>مسار</strong><small>إدارة علاقات العملاء</small></div></div>
        <nav aria-label="التنقل الرئيسي">
          <NavItem active={tab === "team"} icon="◉" label="الفريق والموظفون" onClick={() => setTab("team")} />
          <NavItem active={tab === "permissions"} icon="⌾" label="الأدوار والصلاحيات" onClick={() => setTab("permissions")} />
          <NavItem active={tab === "forms"} icon="▤" label="مصمم النماذج" onClick={() => setTab("forms")} />
          <div className="nav-separator" />
          <NavItem disabled icon="◇" label="العملاء المحتملون" badge="المرحلة 2" />
          <NavItem disabled icon="◷" label="المتابعات" badge="المرحلة 3" />
          <NavItem disabled icon="◫" label="المدفوعات" badge="المرحلة 4" />
          <NavItem disabled icon="◎" label="الجروبات" badge="المرحلة 5" />
        </nav>
        <div className="phase-card"><span>المرحلة الحالية</span><strong>01 — الأساس والصلاحيات</strong><div className="progress"><i /></div><small>لن نبدأ الـLeads قبل اعتماد المرحلة</small></div>
        <div className="profile"><span className="avatar">أم</span><div><strong>أحمد منصور</strong><small>مدير النظام</small></div><button aria-label="إعدادات الحساب">•••</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><span className="eyebrow">مسار CRM <b>/</b> الإعدادات</span><h1>{tab === "team" ? "الفريق والموظفون" : tab === "permissions" ? "الأدوار والصلاحيات" : "مصمم النماذج"}</h1></div><div className="top-actions"><button className="icon-button" aria-label="الإشعارات">♢<i /></button>{tab === "team" && <button className="primary" onClick={() => setEmployeeOpen(true)}>＋ إضافة موظف</button>}{tab === "forms" && <button className="primary" onClick={() => setFieldOpen(true)}>＋ إضافة حقل</button>}</div></header>
        {notice && <div className="notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
        {loading ? <Loading /> : tab === "team" ? <Team data={data} onAdd={() => setEmployeeOpen(true)} /> : tab === "permissions" ? <Permissions roles={data.roles} /> : <FormBuilder fields={data.fields} mutate={mutate} onAdd={() => setFieldOpen(true)} />}
      </section>

      {employeeOpen && <EmployeeDialog data={data} fields={data.fields} onClose={() => setEmployeeOpen(false)} onSubmit={async (payload) => { await mutate({ action: "createEmployee", ...payload }); setEmployeeOpen(false); setNotice("تم إنشاء حساب الموظف وإرسال الدعوة بنجاح"); }} />}
      {fieldOpen && <FieldDialog onClose={() => setFieldOpen(false)} onSubmit={async (payload) => { await mutate({ action: "addField", ...payload }); setFieldOpen(false); setNotice("تمت إضافة الحقل وأصبح متاحًا في نموذج الموظف"); }} />}
    </main>
  );
}

function NavItem({ active, disabled, icon, label, badge, onClick }: { active?: boolean; disabled?: boolean; icon: string; label: string; badge?: string; onClick?: () => void }) {
  return <button className={`nav-item ${active ? "active" : ""} ${disabled ? "disabled" : ""}`} onClick={onClick} disabled={disabled}><span className="nav-icon">{icon}</span><span>{label}</span>{badge && <em>{badge}</em>}</button>;
}

function Loading() { return <div className="loading-grid"><div /><div /><div /><article /></div>; }

function Team({ data, onAdd }: { data: Setup; onAdd: () => void }) {
  const active = data.employees.filter((employee) => employee.status === "active").length;
  return <div className="content-stack">
    <section className="metrics"><Metric label="إجمالي الموظفين" value={data.employees.length} hint="كل الحسابات" tone="green" /><Metric label="الحسابات النشطة" value={active} hint="جاهزة للعمل" tone="blue" /><Metric label="الدعوات المعلقة" value={data.employees.filter((e) => e.status === "invited").length} hint="في انتظار التفعيل" tone="orange" /><Metric label="الأقسام" value={data.departments.length} hint="هيكل قابل للتعديل" tone="purple" /></section>
    <section className="panel">
      <div className="panel-head"><div><h2>دليل الموظفين</h2><p>كل موظف مربوط بقسم، مسمى وظيفي، ومجموعة صلاحيات.</p></div><div className="filters"><label className="search"><span>⌕</span><input placeholder="ابحث بالاسم أو البريد..." /></label><button className="secondary">≡ تصفية</button></div></div>
      {data.employees.length ? <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>القسم</th><th>المسمى الوظيفي</th><th>مجموعة الصلاحيات</th><th>الحالة</th><th /></tr></thead><tbody>{data.employees.map((employee) => <tr key={employee.id}><td><div className="employee"><span>{initials(employee.fullName)}</span><div><strong>{employee.fullName}</strong><small>{employee.email}</small></div></div></td><td><span className="department-dot" style={{ background: data.departments.find((d) => d.id === employee.departmentId)?.color }} />{employee.department}</td><td>{employee.jobTitle}</td><td><span className="role-chip">{employee.role}</span></td><td><Status status={employee.status} /></td><td><button className="row-menu" aria-label={`إجراءات ${employee.fullName}`}>•••</button></td></tr>)}</tbody></table></div> : <div className="empty"><span>◎</span><h3>ابدأ بإضافة أول موظف</h3><p>حدد القسم والمسمى والصلاحيات، ثم أرسل له دعوة الدخول.</p><button className="primary" onClick={onAdd}>＋ إضافة موظف</button></div>}
      <div className="table-footer"><span>عرض {data.employees.length} من {data.employees.length} موظفين</span><div><button disabled>→</button><button className="current">1</button><button disabled>←</button></div></div>
    </section>
  </div>;
}

function Metric({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: string }) { return <article className="metric"><span className={`metric-icon ${tone}`}>◆</span><div><small>{label}</small><strong>{String(value).padStart(2, "0")}</strong><p>{hint}</p></div></article>; }
function Status({ status }: { status: Employee["status"] }) { const map = { active: "نشط", invited: "دعوة معلقة", disabled: "موقوف" }; return <span className={`status ${status}`}><i />{map[status]}</span>; }
function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join(""); }

function Permissions({ roles }: { roles: Role[] }) {
  const rows = ["الموظفون", "إعدادات النماذج", "الأقسام والمسميات", "العملاء المحتملون"];
  return <div className="split-layout"><section className="panel roles-list"><div className="panel-head"><div><h2>مجموعات الصلاحيات</h2><p>الصلاحيات تورّث حسب الوظيفة ويمكن تخصيصها لاحقًا.</p></div><button className="secondary">＋ دور جديد</button></div>{roles.map((role, index) => <button key={role.id} className={`role-row ${index === 0 ? "selected" : ""}`}><span className="role-symbol">{index === 0 ? "♛" : "◆"}</span><div><strong>{role.name}</strong><small>{role.description}</small></div><em>{index === 0 ? "3 موظفين" : "1 موظف"}</em></button>)}</section><section className="panel permission-matrix"><div className="panel-head"><div><span className="mini-label">صلاحيات الدور</span><h2>مدير النظام</h2></div><button className="primary">حفظ التغييرات</button></div><table><thead><tr><th>الصفحة / الوحدة</th><th>عرض</th><th>إضافة</th><th>تعديل</th><th>حذف</th></tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={row}><td><strong>{row}</strong></td>{[0,1,2,3].map((column) => <td key={column}><label className="check"><input type="checkbox" defaultChecked={rowIndex < 3 || column < 2} /><span>✓</span></label></td>)}</tr>)}</tbody></table><div className="guard-note"><span>◈</span><div><strong>حماية على مستوى السيرفر</strong><p>إخفاء الزر وحده لا يكفي؛ كل عملية إضافة أو تعديل تُراجع صلاحية الموظف قبل التنفيذ.</p></div></div></section></div>;
}

function FormBuilder({ fields, mutate, onAdd }: { fields: Field[]; mutate: (payload: Record<string, unknown>) => Promise<void>; onAdd: () => void }) {
  const version = fields[0]?.version ?? 1;
  const [saving, setSaving] = useState<number | null>(null);
  return <div className="builder-layout"><section className="panel field-panel"><div className="panel-head"><div><span className="version">نسخة {version}</span><h2>نموذج بيانات الموظف</h2><p>غيّر ظهور وإلزام الحقول بدون نشر نسخة جديدة من النظام.</p></div><button className="secondary" onClick={onAdd}>＋ حقل جديد</button></div><div className="field-list">{fields.map((field, index) => <div className={`field-row ${!field.visible ? "muted" : ""}`} key={field.id}><span className="drag">⠿</span><span className="field-index">{String(index + 1).padStart(2, "0")}</span><div className="field-info"><strong>{field.label}</strong><small>{field.fieldKey} · {field.type}</small></div><label className="mini-toggle"><input type="checkbox" checked={!!field.required} onChange={async (event) => { setSaving(field.id); await mutate({ action: "toggleField", id: field.id, visible: !!field.visible, required: event.target.checked }); setSaving(null); }} /><span />إلزامي</label><label className="mini-toggle"><input type="checkbox" checked={!!field.visible} onChange={async (event) => { setSaving(field.id); await mutate({ action: "toggleField", id: field.id, visible: event.target.checked, required: !!field.required }); setSaving(null); }} /><span />ظاهر</label><button className="row-menu" aria-label={`إعدادات ${field.label}`}>{saving === field.id ? "…" : "•••"}</button></div>)}</div><div className="schema-note"><span>↻</span><p><strong>تغيير آمن للمستقبل:</strong> البيانات القديمة تظل محفوظة حتى لو أخفيت الحقل، وكل تعديل ينشئ إصدارًا جديدًا لتعريف النموذج.</p></div></section><section className="panel preview-panel"><div className="preview-head"><div><span className="live-dot" />معاينة مباشرة</div><span>نموذج إضافة موظف</span></div><div className="form-preview"><div className="preview-title"><span>＋</span><div><h3>موظف جديد</h3><p>الحقول الظاهرة فقط تظهر للموظف المسؤول.</p></div></div><div className="dynamic-grid">{fields.filter((field) => field.visible).map((field) => <label className={field.width === "full" ? "full" : ""} key={field.id}><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "select" ? <select disabled><option>{field.placeholder}</option></select> : <input disabled placeholder={field.placeholder} type={field.type === "email" ? "email" : "text"} />}</label>)}</div><div className="preview-actions"><button className="secondary">إلغاء</button><button className="primary">إرسال الدعوة</button></div></div></section></div>;
}

function EmployeeDialog({ data, fields, onClose, onSubmit }: { data: Setup; fields: Field[]; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const visibleFields = useMemo(() => fields.filter((field) => field.visible), [fields]);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { const standard = new Set(["fullName", "email", "phone", "departmentId", "jobTitleId", "roleId"]); const customData = Object.fromEntries(Object.entries(values).filter(([key]) => !standard.has(key))); await onSubmit({ ...values, customData }); } catch (err) { setError(err instanceof Error ? err.message : "تعذر الحفظ"); setBusy(false); } }
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog" onSubmit={submit}><div className="dialog-head"><div><span className="dialog-icon">＋</span><div><h2>إضافة موظف جديد</h2><p>سيتم إرسال دعوة للدخول بعد حفظ الحساب.</p></div></div><button type="button" onClick={onClose}>×</button></div>{error && <p className="form-error">{error}</p>}<div className="dynamic-grid dialog-fields">{visibleFields.map((field) => <DynamicField key={field.id} field={field} value={values[field.fieldKey] ?? ""} setValue={(value) => setValues((current) => ({ ...current, [field.fieldKey]: value }))} data={data} />)}</div><div className="dialog-foot"><button className="secondary" type="button" onClick={onClose}>إلغاء</button><button className="primary" disabled={busy}>{busy ? "جارٍ الحفظ..." : "إنشاء الحساب وإرسال الدعوة"}</button></div></form></div>;
}

function DynamicField({ field, value, setValue, data }: { field: Field; value: string; setValue: (value: string) => void; data: Setup }) {
  const options = field.fieldKey === "departmentId" ? data.departments : field.fieldKey === "jobTitleId" ? data.jobTitles : field.fieldKey === "roleId" ? data.roles : [];
  return <label className={field.width === "full" ? "full" : ""}><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "select" ? <select value={value} required={!!field.required} onChange={(e) => setValue(e.target.value)}><option value="">{field.placeholder}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select> : <input value={value} required={!!field.required} placeholder={field.placeholder} type={field.type} onChange={(e) => setValue(e.target.value)} />}</label>;
}

function FieldDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { await onSubmit({ label: form.get("label"), type: form.get("type"), placeholder: form.get("placeholder"), width: form.get("width"), required: form.get("required") === "on" }); } catch (err) { setError(err instanceof Error ? err.message : "تعذر الحفظ"); setBusy(false); } }
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog compact" onSubmit={submit}><div className="dialog-head"><div><span className="dialog-icon">▤</span><div><h2>حقل جديد</h2><p>سيظهر فورًا في نموذج الموظف.</p></div></div><button type="button" onClick={onClose}>×</button></div>{error && <p className="form-error">{error}</p>}<div className="dynamic-grid dialog-fields"><label className="full"><span>اسم الحقل *</span><input name="label" required placeholder="مثال: تاريخ التعيين" /></label><label><span>نوع الحقل</span><select name="type"><option value="text">نص</option><option value="number">رقم</option><option value="date">تاريخ</option><option value="textarea">نص طويل</option><option value="checkbox">اختيار</option></select></label><label><span>عرض الحقل</span><select name="width"><option value="half">نصف صف</option><option value="full">صف كامل</option></select></label><label className="full"><span>النص الإرشادي</span><input name="placeholder" placeholder="النص الذي يظهر داخل الحقل" /></label><label className="inline-check full"><input type="checkbox" name="required" /> هذا الحقل إلزامي</label></div><div className="dialog-foot"><button className="secondary" type="button" onClick={onClose}>إلغاء</button><button className="primary" disabled={busy}>{busy ? "جارٍ الإضافة..." : "إضافة الحقل"}</button></div></form></div>;
}
