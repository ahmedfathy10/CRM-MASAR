import { env } from "cloudflare:workers";

let ready: Promise<void> | null = null;

const statements = [
  `CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#2f6b5f', is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS job_titles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, department_id INTEGER REFERENCES departments(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS role_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER NOT NULL REFERENCES roles(id), resource TEXT NOT NULL, action TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', department_id INTEGER REFERENCES departments(id), job_title_id INTEGER REFERENCES job_titles(id), role_id INTEGER REFERENCES roles(id), status TEXT NOT NULL DEFAULT 'invited', custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS form_definitions (id INTEGER PRIMARY KEY AUTOINCREMENT, form_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS form_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL REFERENCES form_definitions(id), field_key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL, placeholder TEXT NOT NULL DEFAULT '', required INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, options_json TEXT NOT NULL DEFAULT '[]', width TEXT NOT NULL DEFAULT 'half')`,
  `CREATE INDEX IF NOT EXISTS employees_department_idx ON employees (department_id)`,
  `CREATE INDEX IF NOT EXISTS form_fields_form_idx ON form_fields (form_id, sort_order)`,
];

export async function ensureDatabase() {
  if (!ready) ready = initialize();
  return ready;
}

async function initialize() {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  await db.batch(statements.map((statement) => db.prepare(statement)));

  const seeded = await db.prepare("SELECT COUNT(*) AS count FROM departments").first<{ count: number }>();
  if ((seeded?.count ?? 0) > 0) return;

  await db.batch([
    db.prepare("INSERT INTO departments (name, color) VALUES (?, ?)").bind("المبيعات", "#2f6b5f"),
    db.prepare("INSERT INTO departments (name, color) VALUES (?, ?)").bind("خدمة العملاء", "#d9824b"),
    db.prepare("INSERT INTO departments (name, color) VALUES (?, ?)").bind("الإدارة", "#6b61a8"),
    db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)").bind("مدير النظام", "كل الصلاحيات والإعدادات"),
    db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)").bind("مسؤول مبيعات", "إدارة العملاء والمتابعات"),
    db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)").bind("موظف متابعة", "عرض وتحديث العملاء المسندين"),
    db.prepare("INSERT INTO form_definitions (form_key, name, description) VALUES (?, ?, ?)").bind("employee", "بيانات الموظف", "الحقول المستخدمة عند إضافة أو تعديل موظف"),
  ]);

  await db.batch([
    db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, 1)").bind("مسؤول مبيعات"),
    db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, 1)").bind("قائد فريق"),
    db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, 2)").bind("مسؤول متابعة"),
    db.prepare("INSERT INTO job_titles (name, department_id) VALUES (?, 3)").bind("مدير تشغيل"),
    db.prepare("INSERT INTO employees (full_name, email, phone, department_id, job_title_id, role_id, status) VALUES (?, ?, ?, 1, 2, 1, 'active')").bind("أحمد منصور", "ahmed@masar.app", "0100 123 4567"),
    db.prepare("INSERT INTO employees (full_name, email, phone, department_id, job_title_id, role_id, status) VALUES (?, ?, ?, 1, 1, 2, 'active')").bind("سارة علي", "sara@masar.app", "0111 234 5678"),
    db.prepare("INSERT INTO employees (full_name, email, phone, department_id, job_title_id, role_id, status) VALUES (?, ?, ?, 2, 3, 3, 'invited')").bind("عمر حسن", "omar@masar.app", "0122 345 6789"),
  ]);

  const form = await db.prepare("SELECT id FROM form_definitions WHERE form_key = 'employee'").first<{ id: number }>();
  if (!form) return;
  const fields = [
    ["fullName", "الاسم بالكامل", "text", "مثال: محمد أحمد", 1, 1, 1, "full"],
    ["email", "البريد الإلكتروني", "email", "name@company.com", 1, 1, 2, "half"],
    ["phone", "رقم الموبايل", "tel", "01xxxxxxxxx", 1, 1, 3, "half"],
    ["departmentId", "القسم", "select", "اختر القسم", 1, 1, 4, "half"],
    ["jobTitleId", "المسمى الوظيفي", "select", "اختر المسمى", 1, 1, 5, "half"],
    ["roleId", "مجموعة الصلاحيات", "select", "اختر الصلاحيات", 1, 1, 6, "full"],
  ];
  await db.batch(fields.map((field) => db.prepare("INSERT INTO form_fields (form_id, field_key, label, type, placeholder, required, visible, sort_order, width) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(form.id, ...field)));
}
