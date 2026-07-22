import { env } from "cloudflare:workers";

let ready: Promise<void> | null = null;

const statements = [
  `CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#2f6b5f', parent_id INTEGER REFERENCES departments(id), support_enabled INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS job_titles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, department_id INTEGER REFERENCES departments(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS role_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER NOT NULL REFERENCES roles(id), resource TEXT NOT NULL, action TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', primary_phone TEXT NOT NULL DEFAULT '', secondary_phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', social_url TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1, custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', department_id INTEGER REFERENCES departments(id), job_title_id INTEGER REFERENCES job_titles(id), role_id INTEGER REFERENCES roles(id), branch_id INTEGER REFERENCES branches(id), status TEXT NOT NULL DEFAULT 'invited', custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS form_definitions (id INTEGER PRIMARY KEY AUTOINCREMENT, form_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS form_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL REFERENCES form_definitions(id), field_key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL, placeholder TEXT NOT NULL DEFAULT '', required INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, options_json TEXT NOT NULL DEFAULT '[]', width TEXT NOT NULL DEFAULT 'half')`,
  `CREATE INDEX IF NOT EXISTS employees_department_idx ON employees (department_id)`,
  `CREATE INDEX IF NOT EXISTS form_fields_form_idx ON form_fields (form_id, sort_order)`,
];

type FieldSeed = [string, string, string, string, number, number, number, string, string];

const employeeFields: FieldSeed[] = [
  ["fullName", "الاسم بالكامل", "text", "اكتب اسم الموظف", 1, 1, 1, "full", "[]"],
  ["gender", "النوع", "select", "اختر النوع", 1, 1, 2, "half", '["ذكر","أنثى"]'],
  ["birthDate", "تاريخ الميلاد", "date", "", 0, 1, 3, "half", "[]"],
  ["phone", "رقم الموبايل", "tel", "01xxxxxxxxx", 1, 1, 4, "half", "[]"],
  ["landline", "رقم الهاتف", "tel", "اكتب رقم الهاتف", 0, 1, 5, "half", "[]"],
  ["email", "البريد الإلكتروني", "email", "name@company.com", 1, 1, 6, "full", "[]"],
  ["address", "العنوان", "textarea", "اكتب عنوان الموظف", 0, 1, 7, "full", "[]"],
  ["nationalId", "الرقم القومي", "text", "اكتب الرقم القومي", 0, 1, 8, "half", "[]"],
  ["startDate", "تاريخ بداية العمل", "date", "", 1, 1, 9, "half", "[]"],
  ["salaryType", "نوع الراتب", "select", "اختر نوع الراتب", 0, 1, 10, "half", '["شهري","يومي","بالساعة","عمولة"]'],
  ["salary", "الراتب", "number", "اكتب الراتب", 0, 1, 11, "half", "[]"],
  ["branchId", "الفرع", "select", "اختر الفرع", 1, 1, 12, "full", "[]"],
  ["departmentId", "القسم", "select", "اختر القسم", 1, 1, 13, "half", "[]"],
  ["jobTitleId", "الدور الوظيفي", "select", "اختر القسم أولًا", 1, 1, 14, "half", "[]"],
  ["roleId", "مجموعة الصلاحيات", "select", "اختر الصلاحيات", 1, 1, 15, "full", "[]"],
  ["status", "حالة الموظف", "select", "اختر الحالة", 1, 1, 16, "half", '["نشط","تحت التجربة","إجازة","موقوف"]'],
  ["insuranceStatus", "حالة التأمين", "select", "اختر حالة التأمين", 0, 1, 17, "half", '["مؤمّن عليه","غير مؤمّن عليه","قيد الإجراء"]'],
  ["notes", "ملاحظات", "textarea", "اكتب أي ملاحظات إضافية", 0, 1, 18, "full", "[]"],
  ["documents", "المستندات المستلمة", "checkbox", "", 0, 1, 19, "full", '["البطاقة الشخصية","المؤهل الدراسي","شهادة الميلاد","فيش وتشبيه","صور شخصية","موقف التجنيد","شهادة الخبرة"]'],
];

const branchFields: FieldSeed[] = [
  ["name", "اسم الفرع", "text", "مثال: فرع المعادي", 1, 1, 1, "full", "[]"],
  ["address", "عنوان الفرع", "textarea", "اكتب العنوان بالتفصيل", 1, 1, 2, "full", "[]"],
  ["primaryPhone", "رقم الهاتف الأساسي", "tel", "02xxxxxxxx", 1, 1, 3, "half", "[]"],
  ["secondaryPhone", "رقم هاتف إضافي", "tel", "اختياري", 0, 1, 4, "half", "[]"],
  ["email", "البريد الإلكتروني", "email", "branch@company.com", 0, 1, 5, "half", "[]"],
  ["socialUrl", "صفحة التواصل الاجتماعي", "text", "https://...", 0, 1, 6, "half", "[]"],
  ["isActive", "حالة الفرع", "select", "اختر الحالة", 1, 1, 7, "full", '["نشط","غير نشط"]'],
];

export async function ensureDatabase() {
  if (!ready) ready = initialize();
  return ready;
}

async function initialize() {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  await db.batch(statements.map((statement) => db.prepare(statement)));

  const departmentColumns = await db.prepare("PRAGMA table_info(departments)").all<{ name: string }>();
  const columnNames = new Set(departmentColumns.results.map((column) => column.name));
  if (!columnNames.has("parent_id")) await db.prepare("ALTER TABLE departments ADD COLUMN parent_id INTEGER REFERENCES departments(id)").run();
  if (!columnNames.has("support_enabled")) await db.prepare("ALTER TABLE departments ADD COLUMN support_enabled INTEGER NOT NULL DEFAULT 0").run();
  const employeeColumns = await db.prepare("PRAGMA table_info(employees)").all<{ name: string }>();
  if (!employeeColumns.results.some((column) => column.name === "branch_id")) await db.prepare("ALTER TABLE employees ADD COLUMN branch_id INTEGER REFERENCES branches(id)").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS form_fields_key_idx ON form_fields (form_id, field_key)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS employees_branch_idx ON employees (branch_id)").run();
  const branchColumns = await db.prepare("PRAGMA table_info(branches)").all<{ name: string }>();
  if (!branchColumns.results.some((column) => column.name === "custom_data")) await db.prepare("ALTER TABLE branches ADD COLUMN custom_data TEXT NOT NULL DEFAULT '{}'").run();

  const branchCount = await db.prepare("SELECT COUNT(*) AS count FROM branches").first<{ count: number }>();
  if ((branchCount?.count ?? 0) === 0) await db.batch([
    db.prepare("INSERT INTO branches (name, address, primary_phone, email) VALUES (?, ?, ?, ?)").bind("الفرع الرئيسي", "القاهرة", "02 0000 0000", "main@masar.app"),
    db.prepare("INSERT INTO branches (name, address, primary_phone) VALUES (?, ?, ?)").bind("فرع القاهرة الجديدة", "القاهرة الجديدة", "02 0000 0001"),
    db.prepare("INSERT INTO branches (name, address, primary_phone) VALUES (?, ?, ?)").bind("فرع الإسكندرية", "الإسكندرية", "03 0000 0000"),
  ]);

  const seeded = await db.prepare("SELECT COUNT(*) AS count FROM departments").first<{ count: number }>();
  if ((seeded?.count ?? 0) === 0) {
    await db.batch([
      db.prepare("INSERT INTO departments (name, color, support_enabled) VALUES (?, ?, ?)").bind("الإدارة", "#6b61a8", 1),
      db.prepare("INSERT INTO departments (name, color, support_enabled) VALUES (?, ?, ?)").bind("المبيعات", "#2f6b5f", 1),
      db.prepare("INSERT INTO departments (name, color, parent_id, support_enabled) VALUES (?, ?, 2, ?)").bind("خدمة العملاء", "#d9824b", 1),
      db.prepare("INSERT INTO departments (name, color, support_enabled) VALUES (?, ?, ?)").bind("الموارد البشرية", "#3f7298", 0),
      db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)").bind("مدير النظام", "كل الصلاحيات والإعدادات"),
      db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)").bind("مسؤول مبيعات", "إدارة العملاء والمتابعات"),
      db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)").bind("موظف متابعة", "عرض وتحديث العملاء المسندين"),
      db.prepare("INSERT INTO form_definitions (form_key, name, description) VALUES (?, ?, ?)").bind("employee", "بيانات الموظف", "الحقول المستخدمة عند إضافة أو تعديل موظف"),
    ]);
    await db.batch([
      db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, 1)").bind("مدير تشغيل"),
      db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, 2)").bind("مدير مبيعات"),
      db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, 2)").bind("مسؤول مبيعات"),
      db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, 3)").bind("مسؤول متابعة"),
      db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, 4)").bind("أخصائي موارد بشرية"),
      db.prepare("INSERT INTO employees (full_name, email, phone, department_id, job_title_id, role_id, status) VALUES (?, ?, ?, 2, 2, 1, 'active')").bind("أحمد منصور", "ahmed@masar.app", "0100 123 4567"),
      db.prepare("INSERT INTO employees (full_name, email, phone, department_id, job_title_id, role_id, status) VALUES (?, ?, ?, 2, 3, 2, 'active')").bind("سارة علي", "sara@masar.app", "0111 234 5678"),
      db.prepare("INSERT INTO employees (full_name, email, phone, department_id, job_title_id, role_id, status) VALUES (?, ?, ?, 3, 4, 3, 'invited')").bind("عمر حسن", "omar@masar.app", "0122 345 6789"),
    ]);
  }

  await db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('employee', 'بيانات الموظف', 'الحقول المستخدمة عند إضافة أو تعديل موظف')").run();
  await db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('branch', 'بيانات الفرع', 'الحقول المستخدمة عند إضافة أو تعديل فرع')").run();
  const form = await db.prepare("SELECT id FROM form_definitions WHERE form_key = 'employee'").first<{ id: number }>();
  if (!form) return;
  await db.prepare("DELETE FROM form_fields WHERE form_id=? AND field_key='branch'").bind(form.id).run();
  const query = `INSERT INTO form_fields (form_id, field_key, label, type, placeholder, required, visible, sort_order, width, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(form_id, field_key) DO UPDATE SET label=excluded.label, type=excluded.type, placeholder=excluded.placeholder, sort_order=excluded.sort_order, width=excluded.width, options_json=excluded.options_json`;
  await db.batch(employeeFields.map((field) => db.prepare(query).bind(form.id, ...field)));
  const branchForm = await db.prepare("SELECT id FROM form_definitions WHERE form_key = 'branch'").first<{ id: number }>();
  if (branchForm) await db.batch(branchFields.map((field) => db.prepare(query).bind(branchForm.id, ...field)));
}
