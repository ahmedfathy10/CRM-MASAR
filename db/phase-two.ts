import { env } from "cloudflare:workers";
import { ensureDatabase } from "./bootstrap";

let ready: Promise<void> | null = null;

const leadFields = [
  ["fullName", "اسم العميل", "text", "اكتب اسم العميل", 1, 1, 1, "full", "[]"],
  ["primaryPhone", "رقم الموبايل الأساسي", "tel", "01xxxxxxxxx", 1, 1, 2, "half", "[]"],
  ["secondaryPhone", "رقم بديل", "tel", "رقم موبايل آخر", 0, 1, 3, "half", "[]"],
  ["email", "البريد الإلكتروني", "email", "name@example.com", 0, 1, 4, "full", "[]"],
  ["source", "مصدر العميل", "select", "اختر المصدر", 1, 1, 5, "half", '["Facebook","Instagram","TikTok","إعلان Google","ترشيح","زيارة مباشرة","مكالمة واردة","أخرى"]'],
  ["campaign", "الحملة الإعلانية", "text", "اسم الحملة إن وجد", 0, 1, 6, "half", "[]"],
  ["interest", "الخدمة المطلوبة", "text", "ما الذي يهتم به العميل؟", 1, 1, 7, "full", "[]"],
  ["priority", "الأولوية", "select", "اختر الأولوية", 1, 1, 8, "half", '["عادية","مرتفعة","عاجلة"]'],
  ["assignedEmployeeId", "الموظف المسؤول", "select", "اختر الموظف", 1, 1, 9, "half", "[]"],
  ["notes", "ملاحظات أولية", "textarea", "تفاصيل أو احتياج العميل", 0, 1, 10, "full", "[]"],
];

const callFields = [
  ["phone", "رقم الهاتف", "tel", "رقم العميل", 1, 1, 1, "half", "[]"],
  ["direction", "نوع المكالمة", "select", "اختر النوع", 1, 1, 2, "half", '["صادرة","واردة"]'],
  ["result", "نتيجة المكالمة", "select", "اختر النتيجة", 1, 1, 3, "half", '["تم الرد","لم يرد","مشغول","رقم خاطئ","طلب معاودة الاتصال"]'],
  ["assignedEmployeeId", "الموظف المسؤول", "select", "اختر الموظف", 1, 1, 4, "half", "[]"],
  ["callAt", "وقت المكالمة", "datetime-local", "", 1, 1, 5, "full", "[]"],
  ["notes", "ملاحظات المكالمة", "textarea", "اكتب ملخص المكالمة", 0, 1, 6, "full", "[]"],
];

export async function ensurePhaseTwo() {
  if (!ready) ready = initialize();
  return ready;
}

async function initialize() {
  await ensureDatabase();
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, primary_phone TEXT NOT NULL, normalized_phone TEXT NOT NULL, secondary_phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'غير محدد', campaign TEXT NOT NULL DEFAULT '', interest TEXT NOT NULL DEFAULT '', assigned_employee_id INTEGER REFERENCES employees(id), status TEXT NOT NULL DEFAULT 'new', priority TEXT NOT NULL DEFAULT 'normal', notes TEXT NOT NULL DEFAULT '', custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS call_records (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER REFERENCES leads(id), phone TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'outgoing', result TEXT NOT NULL DEFAULT 'no_answer', assigned_employee_id INTEGER REFERENCES employees(id), call_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, notes TEXT NOT NULL DEFAULT '', custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_idx ON leads (normalized_phone)"),
    db.prepare("CREATE INDEX IF NOT EXISTS calls_lead_idx ON call_records (lead_id, call_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS leads_assignee_idx ON leads (assigned_employee_id, status)"),
  ]);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('lead', 'بيانات العميل المحتمل', 'الحقول المستخدمة عند تسجيل Lead جديدة')"),
    db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('call', 'بيانات المكالمة', 'الحقول المستخدمة عند تسجيل مكالمة')"),
  ]);
  const forms = await db.prepare("SELECT id, form_key AS formKey FROM form_definitions WHERE form_key IN ('lead','call')").all<{ id: number; formKey: string }>();
  const query = `INSERT INTO form_fields (form_id, field_key, label, type, placeholder, required, visible, sort_order, width, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(form_id, field_key) DO UPDATE SET label=excluded.label, type=excluded.type, placeholder=excluded.placeholder, sort_order=excluded.sort_order, width=excluded.width, options_json=excluded.options_json`;
  const batches = forms.results.flatMap((form) => (form.formKey === "lead" ? leadFields : callFields).map((field) => db.prepare(query).bind(form.id, ...field)));
  if (batches.length) await db.batch(batches);
}

export function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = `0${digits.slice(4)}`;
  if (digits.startsWith("20") && digits.length > 10) digits = `0${digits.slice(2)}`;
  return digits;
}
