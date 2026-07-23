import { env } from "cloudflare:workers";
import { ensureDatabase } from "./bootstrap";

let ready: Promise<void> | null = null;

const paymentMethodSeeds = [
  ["Klivvr POS Paymob",1],["TRU POS Paymob",1],["Halan POS Paymob",1],["Transferred from another track",1],["Value Link Paymob",1],["Sympl Link Paymob",1],["12M Bank Installment POS CIB",1],["6M Bank Installment POS CIB",1],["Seven POS Paymob",1],["Wallet Link Kashier",1],["Wallet POS Kashier",1],["Bank Installment POS Kashier",1],["Bank Installment Link Kashier",1],["Souhoola Link Kashier",1],["Aman Link Kashier",1],["Value Link Kashier",1],["Visa Link Kashier",1],["Visa POS CIB",1],["Souhoola POS Kashier",1],["Aman POS Kashier",1],["Value POS Kashier",1],["Visa POS Kashier",1],["Contact POS PayMob",1],["Khazna POS PayMob",1],["Forsa POS PayMob",1],["Souhoola POS PayMob",1],["Aman POS PayMob",1],["Symple POS PayMob",1],["Value POS PayMob",1],["Etisalat Cash",1],["Transferred from another Student",1],["Fawry Link",1],["Fawry Code",1],["Bank Transfer",1],["Paymob Link",1],["Visa POS PayMob",1],["Vodafone Cash",1],["Cash",0],
] as const;

const leadFields = [
  ["fullName", "اسم العميل", "text", "اكتب اسم العميل", 1, 1, 1, "full", "[]"],
  ["primaryPhone", "رقم الموبايل", "tel", "اكتب الرقم بكود الدولة", 1, 1, 2, "full", "[]"],
  ["secondaryPhone", "رقم الموبايل 2", "tel", "رقم بديل بكود الدولة", 0, 1, 3, "full", "[]"],
  ["source", "المصدر", "select", "اختر المصدر", 1, 1, 4, "full", "[]"],
  ["interest", "الـTrack", "select", "اختر الـTrack", 1, 1, 5, "full", "[]"],
  ["branchId", "الفرع", "select", "اختر الفرع", 1, 1, 6, "full", "[]"],
  ["notes", "ملاحظات", "textarea", "اكتب الملاحظات", 0, 1, 7, "full", "[]"],
];

const leadDetailsFields = [
  ["track", "المسار", "select", "اختر المسار", 0, 1, 1, "half", '["General","Conversation","Business","Kids","Exam Preparation"]'],
  ["course", "الكورس", "select", "اختر الكورس", 0, 1, 2, "half", '["English Course","German Course","Programming Course","Business Course","Other"]'],
  ["source", "المصدر", "select", "اختر المصدر", 0, 1, 3, "half", '["Facebook Call","Whatsapp Call","TikTok Call","Instagram Call","Google Call","Recommendation Call"]'],
  ["location", "الموقع / المحافظة", "text", "مثال: المعادي", 0, 1, 4, "half", "[]"],
  ["segment", "الشريحة", "select", "اختر الشريحة", 0, 1, 5, "half", '["Student","Graduate","Employee","Business Owner","Parent"]'],
  ["gender", "النوع", "select", "اختر النوع", 0, 1, 6, "half", '["Male","Female"]'],
  ["age", "العمر", "number", "اكتب العمر", 0, 1, 7, "half", "[]"],
  ["nationality", "الجنسية", "text", "اكتب الجنسية", 0, 1, 8, "half", "[]"],
  ["country", "الدولة", "text", "اكتب الدولة", 0, 1, 9, "half", "[]"],
  ["job", "الوظيفة", "text", "اكتب الوظيفة", 0, 1, 10, "half", "[]"],
  ["clientStatus", "حالة العميل", "select", "اختر الحالة", 0, 1, 11, "half", '["New","Interested","Not Interested","Follow Up","Registered"]'],
  ["offer", "العرض", "text", "العرض المناسب للعميل", 0, 1, 12, "half", "[]"],
  ["detailsNotes", "ملاحظات إضافية", "textarea", "اكتب باقي التفاصيل", 0, 1, 13, "full", "[]"],
];

const callFields = [
  ["phone", "رقم الهاتف", "tel", "رقم العميل", 1, 1, 1, "half", "[]"],
  ["direction", "نوع المكالمة", "select", "اختر النوع", 1, 1, 2, "half", '["صادرة","واردة"]'],
  ["result", "نتيجة المكالمة", "select", "اختر النتيجة", 1, 1, 3, "half", '["تم الرد","لم يرد","مشغول","رقم خاطئ","طلب معاودة الاتصال"]'],
  ["assignedEmployeeId", "الموظف المسؤول", "select", "اختر الموظف", 1, 1, 4, "half", "[]"],
  ["branchId", "الفرع", "select", "اختر الفرع", 1, 1, 5, "half", "[]"],
  ["callAt", "وقت المكالمة", "datetime-local", "", 1, 1, 6, "full", "[]"],
  ["notes", "ملاحظات المكالمة", "textarea", "اكتب ملخص المكالمة", 0, 1, 7, "full", "[]"],
];

const followupFields = [
  ["scheduledAt", "موعد المتابعة", "datetime-local", "", 1, 1, 1, "full", "[]"],
  ["assignedEmployeeId", "الموظف المسؤول", "select", "اختر الموظف", 1, 1, 2, "half", "[]"],
  ["channel", "وسيلة المتابعة", "select", "اختر الوسيلة", 1, 1, 3, "half", '["مكالمة","واتساب","رسالة","زيارة","اجتماع أونلاين"]'],
  ["priority", "الأولوية", "select", "اختر الأولوية", 1, 1, 4, "half", '["عادية","مرتفعة","عاجلة"]'],
  ["notes", "هدف المتابعة وملاحظاتها", "textarea", "اكتب ما يجب متابعته مع العميل", 1, 1, 5, "full", "[]"],
];

export async function ensurePhaseTwo() {
  if (!ready) ready = initialize();
  return ready;
}

async function initialize() {
  await ensureDatabase();
  const db = env.DB;
  const paymentSeedMarker=await db.prepare("SELECT id FROM settings_entities WHERE kind='_seed_marker' AND title='payment_methods_v1'").first();
  if(!paymentSeedMarker) await db.batch([...paymentMethodSeeds.map(([title,reference])=>db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) SELECT 'payment_method',?,1,? WHERE NOT EXISTS (SELECT 1 FROM settings_entities WHERE kind='payment_method' AND LOWER(title)=LOWER(?))").bind(title,JSON.stringify({reference:reference?"Yes":"No"}),title)),db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) VALUES ('_seed_marker','payment_methods_v1',1,'{}')")]);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, primary_phone TEXT NOT NULL, normalized_phone TEXT NOT NULL, secondary_phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'غير محدد', campaign TEXT NOT NULL DEFAULT '', interest TEXT NOT NULL DEFAULT '', assigned_employee_id INTEGER REFERENCES employees(id), status TEXT NOT NULL DEFAULT 'new', priority TEXT NOT NULL DEFAULT 'normal', notes TEXT NOT NULL DEFAULT '', custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS call_records (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER REFERENCES leads(id), phone TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'outgoing', result TEXT NOT NULL DEFAULT 'no_answer', assigned_employee_id INTEGER REFERENCES employees(id), call_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, notes TEXT NOT NULL DEFAULT '', custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS followups (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id), assigned_employee_id INTEGER REFERENCES employees(id), branch_id INTEGER REFERENCES branches(id), scheduled_at TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'call', status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'normal', notes TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT '', custom_data TEXT NOT NULL DEFAULT '{}', completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_idx ON leads (normalized_phone)"),
    db.prepare("CREATE INDEX IF NOT EXISTS calls_lead_idx ON call_records (lead_id, call_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS leads_assignee_idx ON leads (assigned_employee_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS followups_due_idx ON followups (status, scheduled_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS followups_employee_idx ON followups (assigned_employee_id, status)"),
  ]);
  const leadColumns = await db.prepare("PRAGMA table_info(leads)").all<{ name: string }>();
  if (!leadColumns.results.some((column) => column.name === "branch_id")) await db.prepare("ALTER TABLE leads ADD COLUMN branch_id INTEGER REFERENCES branches(id)").run();
  const callColumns = await db.prepare("PRAGMA table_info(call_records)").all<{ name: string }>();
  if (!callColumns.results.some((column) => column.name === "branch_id")) await db.prepare("ALTER TABLE call_records ADD COLUMN branch_id INTEGER REFERENCES branches(id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS leads_branch_idx ON leads (branch_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS calls_branch_idx ON call_records (branch_id)").run();
  const followupColumns = await db.prepare("PRAGMA table_info(followups)").all<{ name: string }>();
  if (!followupColumns.results.some((column) => column.name === "custom_data")) await db.prepare("ALTER TABLE followups ADD COLUMN custom_data TEXT NOT NULL DEFAULT '{}'").run();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('lead', 'بيانات العميل المحتمل', 'الحقول المستخدمة عند تسجيل Lead جديدة')"),
    db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('call', 'بيانات المكالمة', 'الحقول المستخدمة عند تسجيل مكالمة')"),
    db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('lead_details', 'استكمال بيانات العميل', 'البيانات التفصيلية التي يضيفها موظف المبيعات')"),
    db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('followup', 'بيانات المتابعة', 'الحقول المستخدمة عند جدولة متابعة للعميل')"),
  ]);
  const forms = await db.prepare("SELECT id, form_key AS formKey FROM form_definitions WHERE form_key IN ('lead','call','lead_details','followup')").all<{ id: number; formKey: string }>();
  const leadForm = forms.results.find((form) => form.formKey === "lead");
  if (leadForm) await db.prepare("DELETE FROM form_fields WHERE form_id=? AND field_key NOT IN ('fullName','primaryPhone','secondaryPhone','source','interest','branchId','notes')").bind(leadForm.id).run();
  const query = `INSERT INTO form_fields (form_id, field_key, label, type, placeholder, required, visible, sort_order, width, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(form_id, field_key) DO UPDATE SET label=excluded.label, type=excluded.type, placeholder=excluded.placeholder, sort_order=excluded.sort_order, width=excluded.width, options_json=excluded.options_json`;
  const batches = forms.results.flatMap((form) => (form.formKey === "lead" ? leadFields : form.formKey === "call" ? callFields : form.formKey === "followup" ? followupFields : leadDetailsFields).map((field) => db.prepare(query).bind(form.id, ...field)));
  if (batches.length) await db.batch(batches);
}

export function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = `0${digits.slice(4)}`;
  if (digits.startsWith("20") && digits.length > 10) digits = `0${digits.slice(2)}`;
  return digits;
}
