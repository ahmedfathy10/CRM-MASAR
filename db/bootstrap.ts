import { env } from "cloudflare:workers";

let ready: Promise<void> | null = null;

const statements = [
  `CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#2f6b5f', parent_id INTEGER REFERENCES departments(id), support_enabled INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS job_titles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, department_id INTEGER REFERENCES departments(id), reports_to_id INTEGER REFERENCES job_titles(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS role_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER NOT NULL REFERENCES roles(id), resource TEXT NOT NULL, action TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS job_title_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, job_title_id INTEGER NOT NULL REFERENCES job_titles(id), page_key TEXT NOT NULL, can_view INTEGER NOT NULL DEFAULT 0, can_add INTEGER NOT NULL DEFAULT 0, can_edit INTEGER NOT NULL DEFAULT 0, can_delete INTEGER NOT NULL DEFAULT 0)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS job_title_permissions_unique_idx ON job_title_permissions (job_title_id, page_key)`,
  `CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', primary_phone TEXT NOT NULL DEFAULT '', secondary_phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', social_url TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1, custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS classrooms (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER NOT NULL REFERENCES branches(id), name TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1, custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS time_slots (id INTEGER PRIMARY KEY AUTOINCREMENT, track_id INTEGER REFERENCES tracks(id), title TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS settings_entities (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS settings_entities_kind_idx ON settings_entities (kind, title)`,
  `CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, mobile TEXT NOT NULL DEFAULT '', level_id INTEGER NOT NULL REFERENCES settings_entities(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS students_level_idx ON students (level_id, full_name)`,
  `CREATE INDEX IF NOT EXISTS students_created_at_idx ON students (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS student_records (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL REFERENCES students(id), kind TEXT NOT NULL, record_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, status TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS student_records_student_idx ON student_records (student_id, kind, record_date)`,
  `CREATE INDEX IF NOT EXISTS student_records_kind_date_idx ON student_records (kind, record_date)`,
  `CREATE TABLE IF NOT EXISTS group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES settings_entities(id), student_reference TEXT NOT NULL, added_by_employee_id INTEGER, added_by_name TEXT NOT NULL DEFAULT '', joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS group_members_unique_idx ON group_members (group_id, student_reference)`,
  `CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, hr_id TEXT NOT NULL DEFAULT '', full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL DEFAULT '', department_id INTEGER REFERENCES departments(id), job_title_id INTEGER REFERENCES job_titles(id), role_id INTEGER REFERENCES roles(id), branch_id INTEGER REFERENCES branches(id), status TEXT NOT NULL DEFAULT 'invited', custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS employee_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, employee_id INTEGER NOT NULL REFERENCES employees(id), expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS employee_schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL, day_status TEXT NOT NULL CHECK(day_status IN ('work','leave')), leave_type TEXT NOT NULL DEFAULT '', shift_from TEXT NOT NULL DEFAULT '', shift_to TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_by_employee_id INTEGER REFERENCES employees(id), created_by_name TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS employee_adjustments (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id), kind TEXT NOT NULL CHECK(kind IN ('reward','deduction')), title TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', record_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by_employee_id INTEGER REFERENCES employees(id))`,
  `CREATE TABLE IF NOT EXISTS class_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL REFERENCES employees(id), group_id INTEGER REFERENCES settings_entities(id), visit_date TEXT NOT NULL, score REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', visited_by_employee_id INTEGER REFERENCES employees(id), visited_by_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS employee_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id), title TEXT NOT NULL, due_date TEXT NOT NULL DEFAULT '', is_completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS employee_schedules_employee_date_idx ON employee_schedules (employee_id, work_date)`,
  `CREATE INDEX IF NOT EXISTS employee_schedules_date_idx ON employee_schedules (work_date, employee_id)`,
  `CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', is_group INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES employees(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS conversation_members (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES conversations(id), employee_id INTEGER NOT NULL REFERENCES employees(id), joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES conversations(id), sender_id INTEGER NOT NULL REFERENCES employees(id), content TEXT NOT NULL DEFAULT '', content_type TEXT NOT NULL DEFAULT 'text', is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id), message_id INTEGER REFERENCES messages(id), type TEXT NOT NULL DEFAULT 'message', data TEXT NOT NULL DEFAULT '{}', is_seen INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id), endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, raw TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, actor_id INTEGER REFERENCES employees(id), actor_name TEXT NOT NULL DEFAULT 'System', subject_type TEXT NOT NULL DEFAULT '', subject_id INTEGER, subject_reference TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS system_logs_created_idx ON system_logs (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS form_definitions (id INTEGER PRIMARY KEY AUTOINCREMENT, form_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS form_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL REFERENCES form_definitions(id), field_key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL, placeholder TEXT NOT NULL DEFAULT '', required INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, options_json TEXT NOT NULL DEFAULT '[]', width TEXT NOT NULL DEFAULT 'half')`,
  `CREATE INDEX IF NOT EXISTS employees_department_idx ON employees (department_id)`,
  `CREATE INDEX IF NOT EXISTS employee_sessions_token_idx ON employee_sessions (token)`,
  `CREATE INDEX IF NOT EXISTS classrooms_branch_idx ON classrooms (branch_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS conversation_members_unique_idx ON conversation_members (conversation_id, employee_id)`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS notifications_employee_seen_idx ON notifications (employee_id, is_seen, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_idx ON push_subscriptions (endpoint)`,
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
  ["employmentType", "نوع التعاقد", "select", "اختر نوع التعاقد", 1, 1, 10, "half", '["Full Time","Part Time","Freelance","Internship"]'],
  ["salary", "الراتب", "number", "اكتب الراتب", 0, 1, 11, "half", "[]"],
  ["branchId", "الفرع", "select", "اختر الفرع", 1, 1, 12, "full", "[]"],
  ["departmentId", "القسم", "select", "اختر القسم", 1, 1, 13, "half", "[]"],
  ["jobTitleId", "الدور الوظيفي", "select", "اختر القسم أولًا", 1, 1, 14, "half", "[]"],
  ["status", "حالة الموظف", "select", "اختر الحالة", 1, 1, 16, "half", '["نشط","تحت التجربة","إجازة","استقالة","انقطاع عن العمل","إنهاء العمل"]'],
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

const classroomFields: FieldSeed[] = [
  ["name", "اسم القاعة", "text", "مثال: Room 1", 1, 1, 1, "full", "[]"],
  ["branchId", "الفرع", "select", "اختر الفرع", 1, 1, 2, "half", "[]"],
  ["capacity", "السعة", "number", "عدد الطلاب", 1, 1, 3, "half", "[]"],
  ["isActive", "الحالة", "select", "اختر الحالة", 1, 1, 4, "full", '["نشط","غير نشط"]'],
];

const trackFields: FieldSeed[] = [
  ["title", "اسم الـTrack", "text", "مثال: English", 1, 1, 1, "full", "[]"],
  ["isActive", "الحالة", "select", "اختر الحالة", 1, 1, 2, "full", '["نشط","غير نشط"]'],
];

const timeSlotFields: FieldSeed[] = [
  ["title", "اسم الفترة", "text", "مثال: الفترة الصباحية", 1, 1, 1, "full", "[]"],
  ["trackId", "الـTrack", "select", "اختر الـTrack", 1, 1, 2, "full", "[]"],
  ["startTime", "وقت البداية", "time", "", 1, 1, 3, "half", "[]"],
  ["endTime", "وقت النهاية", "time", "", 1, 1, 4, "half", "[]"],
  ["isActive", "الحالة", "select", "اختر الحالة", 1, 1, 5, "full", '["نشط","غير نشط"]'],
];

const catalogForms:{key:string;name:string;description:string;fields:FieldSeed[]}[] = [
  {key:"exam",name:"الامتحان",description:"بيانات Exams",fields:[["title","اسم الامتحان","text","مثال: English Level 1 Final",1,1,1,"full","[]"],["trackId","الـTrack","select","اختر الـTrack",1,1,2,"half","[]"],["levelId","المستوى","select","اختر المستوى",1,1,3,"half","[]"],["duration","المدة بالدقائق","number","60",1,1,4,"half","[]"],["totalGrade","الدرجة النهائية","number","100",1,1,5,"half","[]"],["passGrade","درجة النجاح","number","50",1,1,6,"half","[]"],["isActive","الحالة","select","اختر الحالة",1,1,7,"half",'["نشط","غير نشط"]']]},
  {key:"round",name:"الجولة",description:"بيانات Rounds",fields:[["title","اسم الجولة","text","مثال: Round 1",1,1,1,"full","[]"],["trackId","الـTrack","select","اختر الـTrack",1,1,2,"full","[]"],["lectureCount","عدد المحاضرات","number","مثال: 12",1,1,3,"half","[]"],["lectureDuration","مدة المحاضرة بالدقائق","number","مثال: 90",1,1,4,"half","[]"],["isActive","الحالة","select","اختر الحالة",1,1,5,"full",'["نشط","غير نشط"]']]},
  {key:"study_type",name:"نوع الدراسة",description:"بيانات Study Types",fields:[["title","نوع الدراسة","text","مثال: Group أو Private",1,1,1,"full","[]"],["maxStudents","الحد الأقصى للطلاب","number","مثال: 12",1,1,2,"half","[]"],["isActive","الحالة","select","اختر الحالة",1,1,3,"half",'["نشط","غير نشط"]']]},
  {key:"level",name:"المستوى",description:"بيانات Levels",fields:[["title","اسم المستوى","text","مثال: Level 1",1,1,1,"full","[]"],["trackId","الـTrack","select","اختر الـTrack",1,1,2,"half","[]"],["sortOrder","الترتيب","number","1",1,1,3,"half","[]"],["isActive","الحالة","select","اختر الحالة",1,1,4,"full",'["نشط","غير نشط"]']]},
  {key:"education_batch",name:"الدفعة التعليمية",description:"بيانات Education Batches",fields:[["trackId","الـTrack","select","اختر الـTrack",1,1,1,"full","[]"],["title","اسم الدفعة","text","مثال: B15 - English",1,1,2,"full","[]"],["startDate","تاريخ البداية","date","",1,1,3,"half","[]"],["batchStatus","حالة الدفعة","select","اختر حالة الدفعة",1,1,4,"half",'["Current Batch","Not Current"]'],["isActive","الحالة","select","اختر الحالة",1,1,5,"half",'["نشط","غير نشط"]']]},
  {key:"group",name:"المجموعة",description:"بيانات Groups",fields:[["batchId","الدفعة","select","اختر الدفعة",1,1,1,"full","[]"],["roundId","الروند","select","اختر الروند",1,1,2,"half","[]"],["levelId","المستوى","select","اختر المستوى",1,1,3,"half","[]"],["branchId","الفرع","select","اختر الفرع",1,1,4,"half","[]"],["studyTypeId","نوع الدراسة","select","اختر النوع",1,1,5,"half","[]"],["timeSlotId","موعد الدراسة","select","اختر الموعد",1,1,6,"half","[]"],["classroomId","القاعة","select","اختر القاعة",1,1,7,"half","[]"],["startDate","تاريخ بداية الجروب","date","",1,1,8,"half","[]"],["notes","ملاحظات خاصة بالجروب","textarea","اكتب ملاحظات الجروب",0,1,9,"full","[]"]]},
  {key:"setup_card",name:"كارت الإعداد",description:"بيانات Setup Cards",fields:[["title","اسم الكارت","text","مثال: New Student",1,1,1,"full","[]"],["color","اللون","text","#2f6b5f",0,1,2,"half","[]"],["isActive","الحالة","select","اختر الحالة",1,1,3,"half",'["نشط","غير نشط"]']]},
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
  const jobTitleColumns = await db.prepare("PRAGMA table_info(job_titles)").all<{ name: string }>();
  if (!jobTitleColumns.results.some((column) => column.name === "reports_to_id")) await db.prepare("ALTER TABLE job_titles ADD COLUMN reports_to_id INTEGER REFERENCES job_titles(id)").run();
  const permissionColumns = await db.prepare("PRAGMA table_info(job_title_permissions)").all<{ name: string }>();
  if (!permissionColumns.results.some((column) => column.name === "data_scope")) await db.prepare("ALTER TABLE job_title_permissions ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'all'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'utilization',can_view,0,0,0,data_scope FROM job_title_permissions WHERE page_key='groups'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'groupUtilization',can_view,0,0,0,data_scope FROM job_title_permissions WHERE page_key='groups'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'floorSchedule',can_view,0,0,0,data_scope FROM job_title_permissions WHERE page_key='groups'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'scheduleFinal',can_view,0,0,0,data_scope FROM job_title_permissions WHERE page_key='groups'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'debtors',can_view,0,can_edit,0,data_scope FROM job_title_permissions WHERE page_key='payments'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'refunds',can_view,0,can_edit,0,data_scope FROM job_title_permissions WHERE page_key='payments'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'debtReset',can_view,0,can_edit,0,data_scope FROM job_title_permissions WHERE page_key='payments'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'debtInstallments',can_view,0,can_edit,0,data_scope FROM job_title_permissions WHERE page_key='payments'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'marketingExpenses',can_view,can_add,can_edit,can_delete,data_scope FROM job_title_permissions WHERE page_key='payments'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'mtd',can_view,0,0,0,data_scope FROM job_title_permissions WHERE page_key='marketingExpenses'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'adsSpendingTargets',can_view,can_add,can_edit,can_delete,data_scope FROM job_title_permissions WHERE page_key='marketingExpenses'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT job_title_id,'employeeSchedule',can_view,can_add,can_edit,can_delete,data_scope FROM job_title_permissions WHERE page_key='employees'").run();
  await db.prepare("INSERT OR IGNORE INTO job_title_permissions (job_title_id,page_key,can_view,can_add,can_edit,can_delete,data_scope) SELECT id,'employeeProfile',1,0,0,0,'own' FROM job_titles").run();
  for (const leaveType of ["إجازة سنوية", "إجازة عارضة", "إجازة مرضية", "إجازة بدون مرتب", "عطلة رسمية", "أخرى"]) {
    await db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) SELECT 'employee_leave_type',?,1,'{}' WHERE NOT EXISTS (SELECT 1 FROM settings_entities WHERE kind='employee_leave_type' AND title=?)").bind(leaveType, leaveType).run();
  }
  const scheduleColumns = await db.prepare("PRAGMA table_info(employee_schedules)").all<{ name: string }>();
  if (!scheduleColumns.results.some((column) => column.name === "shift_from")) await db.prepare("ALTER TABLE employee_schedules ADD COLUMN shift_from TEXT NOT NULL DEFAULT ''").run();
  if (!scheduleColumns.results.some((column) => column.name === "shift_to")) await db.prepare("ALTER TABLE employee_schedules ADD COLUMN shift_to TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS job_titles_reports_to_idx ON job_titles (reports_to_id)").run();
  const employeeColumns = await db.prepare("PRAGMA table_info(employees)").all<{ name: string }>();
  if (!employeeColumns.results.some((column) => column.name === "branch_id")) await db.prepare("ALTER TABLE employees ADD COLUMN branch_id INTEGER REFERENCES branches(id)").run();
  if (!employeeColumns.results.some((column) => column.name === "hr_id")) await db.prepare("ALTER TABLE employees ADD COLUMN hr_id TEXT NOT NULL DEFAULT ''").run();
  if (!employeeColumns.results.some((column) => column.name === "password_hash")) await db.prepare("ALTER TABLE employees ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS employees_hr_id_idx ON employees (hr_id) WHERE hr_id<>''").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS form_fields_key_idx ON form_fields (form_id, field_key)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS employees_branch_idx ON employees (branch_id)").run();
  const branchColumns = await db.prepare("PRAGMA table_info(branches)").all<{ name: string }>();
  if (!branchColumns.results.some((column) => column.name === "custom_data")) await db.prepare("ALTER TABLE branches ADD COLUMN custom_data TEXT NOT NULL DEFAULT '{}'").run();
  const timeSlotColumns = await db.prepare("PRAGMA table_info(time_slots)").all<{ name: string }>();
  if (!timeSlotColumns.results.some((column) => column.name === "track_id")) await db.prepare("ALTER TABLE time_slots ADD COLUMN track_id INTEGER REFERENCES tracks(id)").run();
  const studentColumns=await db.prepare("PRAGMA table_info(students)").all<{name:string}>();
  const studentColumnNames=new Set(studentColumns.results.map((column)=>column.name));
  if(!studentColumnNames.has("secondary_mobile"))await db.prepare("ALTER TABLE students ADD COLUMN secondary_mobile TEXT NOT NULL DEFAULT ''").run();
  if(!studentColumnNames.has("email"))await db.prepare("ALTER TABLE students ADD COLUMN email TEXT NOT NULL DEFAULT ''").run();
  if(!studentColumnNames.has("track_id"))await db.prepare("ALTER TABLE students ADD COLUMN track_id INTEGER REFERENCES tracks(id)").run();
  if(!studentColumnNames.has("branch_id"))await db.prepare("ALTER TABLE students ADD COLUMN branch_id INTEGER REFERENCES branches(id)").run();
  if(!studentColumnNames.has("status"))await db.prepare("ALTER TABLE students ADD COLUMN status TEXT NOT NULL DEFAULT 'active'").run();
  if(!studentColumnNames.has("custom_data"))await db.prepare("ALTER TABLE students ADD COLUMN custom_data TEXT NOT NULL DEFAULT '{}'").run();
  const groupMemberColumns=await db.prepare("PRAGMA table_info(group_members)").all<{name:string}>();
  const groupMemberColumnNames=new Set(groupMemberColumns.results.map((column)=>column.name));
  if(!groupMemberColumnNames.has("added_by_employee_id"))await db.prepare("ALTER TABLE group_members ADD COLUMN added_by_employee_id INTEGER").run();
  if(!groupMemberColumnNames.has("added_by_name"))await db.prepare("ALTER TABLE group_members ADD COLUMN added_by_name TEXT NOT NULL DEFAULT ''").run();
  const systemLogColumns=await db.prepare("PRAGMA table_info(system_logs)").all<{name:string}>();
  const systemLogColumnNames=new Set(systemLogColumns.results.map((column)=>column.name));
  if(!systemLogColumnNames.has("subject_type"))await db.prepare("ALTER TABLE system_logs ADD COLUMN subject_type TEXT NOT NULL DEFAULT ''").run();
  if(!systemLogColumnNames.has("subject_id"))await db.prepare("ALTER TABLE system_logs ADD COLUMN subject_id INTEGER").run();
  if(!systemLogColumnNames.has("subject_reference"))await db.prepare("ALTER TABLE system_logs ADD COLUMN subject_reference TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS system_logs_subject_idx ON system_logs (subject_type,subject_id,subject_reference)").run();

  const branchCount = await db.prepare("SELECT COUNT(*) AS count FROM branches").first<{ count: number }>();
  if ((branchCount?.count ?? 0) === 0) await db.batch([
    db.prepare("INSERT INTO branches (name, address, primary_phone, email) VALUES (?, ?, ?, ?)").bind("الفرع الرئيسي", "القاهرة", "02 0000 0000", "main@masar.app"),
    db.prepare("INSERT INTO branches (name, address, primary_phone) VALUES (?, ?, ?)").bind("فرع القاهرة الجديدة", "القاهرة الجديدة", "02 0000 0001"),
    db.prepare("INSERT INTO branches (name, address, primary_phone) VALUES (?, ?, ?)").bind("فرع الإسكندرية", "الإسكندرية", "03 0000 0000"),
  ]);

  const trackCount = await db.prepare("SELECT COUNT(*) AS count FROM tracks").first<{ count: number }>();
  if ((trackCount?.count ?? 0) === 0) await db.batch([
    db.prepare("INSERT INTO tracks (title) VALUES (?)").bind("English"),
    db.prepare("INSERT INTO tracks (title) VALUES (?)").bind("German"),
    db.prepare("INSERT INTO tracks (title) VALUES (?)").bind("English Kids 1"),
    db.prepare("INSERT INTO tracks (title) VALUES (?)").bind("English Kids 2"),
    db.prepare("INSERT INTO tracks (title) VALUES (?)").bind("German Kids 1"),
    db.prepare("INSERT INTO tracks (title) VALUES (?)").bind("German Kids 2"),
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
  await db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('classroom', 'بيانات القاعة', 'الحقول المستخدمة عند إضافة أو تعديل قاعة')").run();
  await db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('track', 'بيانات الـTrack', 'الحقول المستخدمة عند إضافة أو تعديل Track')").run();
  await db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES ('time_slot', 'بيانات الفترة الزمنية', 'الحقول المستخدمة عند إضافة أو تعديل فترة زمنية')").run();
  for (const formSeed of catalogForms) await db.prepare("INSERT OR IGNORE INTO form_definitions (form_key, name, description) VALUES (?, ?, ?)").bind(formSeed.key,formSeed.name,formSeed.description).run();
  const form = await db.prepare("SELECT id FROM form_definitions WHERE form_key = 'employee'").first<{ id: number }>();
  if (!form) return;
  await db.prepare("DELETE FROM form_fields WHERE form_id=? AND field_key='branch'").bind(form.id).run();
  await db.prepare("DELETE FROM form_fields WHERE form_id=? AND field_key IN ('salaryType','roleId')").bind(form.id).run();
  const query = `INSERT INTO form_fields (form_id, field_key, label, type, placeholder, required, visible, sort_order, width, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(form_id, field_key) DO UPDATE SET label=excluded.label, type=excluded.type, placeholder=excluded.placeholder, sort_order=excluded.sort_order, width=excluded.width, options_json=excluded.options_json`;
  await db.batch(employeeFields.map((field) => db.prepare(query).bind(form.id, ...field)));
  const branchForm = await db.prepare("SELECT id FROM form_definitions WHERE form_key = 'branch'").first<{ id: number }>();
  if (branchForm) await db.batch(branchFields.map((field) => db.prepare(query).bind(branchForm.id, ...field)));
  const classroomForm = await db.prepare("SELECT id FROM form_definitions WHERE form_key = 'classroom'").first<{ id: number }>();
  if (classroomForm) await db.batch(classroomFields.map((field) => db.prepare(query).bind(classroomForm.id, ...field)));
  const trackForm = await db.prepare("SELECT id FROM form_definitions WHERE form_key = 'track'").first<{ id: number }>();
  if (trackForm) await db.batch(trackFields.map((field) => db.prepare(query).bind(trackForm.id, ...field)));
  const timeSlotForm = await db.prepare("SELECT id FROM form_definitions WHERE form_key = 'time_slot'").first<{ id: number }>();
  if (timeSlotForm) await db.batch(timeSlotFields.map((field) => db.prepare(query).bind(timeSlotForm.id, ...field)));
  for (const formSeed of catalogForms) { const definition=await db.prepare("SELECT id FROM form_definitions WHERE form_key=?").bind(formSeed.key).first<{id:number}>(); if(definition) await db.batch(formSeed.fields.map((field)=>db.prepare(query).bind(definition.id,...field))); }
  const levelForm = await db.prepare("SELECT id FROM form_definitions WHERE form_key='level'").first<{id:number}>();
  if (levelForm) await db.batch([
    db.prepare(query).bind(levelForm.id,"maxStudents","الحد الأقصى للطلاب","number","12",1,1,4,"half","[]"),
    db.prepare("UPDATE form_fields SET sort_order=5 WHERE form_id=? AND field_key='isActive'").bind(levelForm.id),
  ]);
  await db.prepare("UPDATE settings_entities SET custom_data=json_set(custom_data, '$.maxStudents', 12) WHERE kind='level' AND json_type(custom_data, '$.maxStudents') IS NULL").run();
  await db.prepare("UPDATE settings_entities SET custom_data=json_set(custom_data, '$.maxStudents', CASE WHEN LOWER(title) LIKE '%private 1%' THEN 1 WHEN LOWER(title) LIKE '%private 2%' THEN 2 WHEN LOWER(title) LIKE '%private 3%' THEN 3 ELSE 12 END) WHERE kind='study_type' AND json_type(custom_data, '$.maxStudents') IS NULL").run();
  const roundForm = await db.prepare("SELECT id FROM form_definitions WHERE form_key='round'").first<{id:number}>();
  if (roundForm) await db.prepare("DELETE FROM form_fields WHERE form_id=? AND field_key='duration'").bind(roundForm.id).run();
  const batchForm = await db.prepare("SELECT id FROM form_definitions WHERE form_key='education_batch'").first<{id:number}>();
  if (batchForm) await db.prepare("DELETE FROM form_fields WHERE form_id=? AND field_key IN ('branchId','levelId','studyTypeId','timeSlotId','endDate')").bind(batchForm.id).run();
  const studentDropdownsSeeded = await db.prepare("SELECT id FROM settings_entities WHERE kind='system_meta' AND title='student_dropdowns_v1'").first<{id:number}>();
  if (!studentDropdownsSeeded) {
    const studentDropdownDefaults:[string,string][] = [
      ["student_age_group","Under 13"],["student_age_group","13-17"],["student_age_group","18-24"],["student_age_group","25-34"],["student_age_group","35-44"],["student_age_group","45-54"],["student_age_group","55-64"],["student_age_group","65+"],
      ["student_gender","Male"],["student_gender","Female"],
      ["student_referral","Recommendation"],["student_referral","Student Referral"],["student_referral","Employee Referral"],["student_referral","Walk-in"],["student_referral","Other"],
      ["student_platform","Facebook"],["student_platform","Instagram"],["student_platform","TikTok"],["student_platform","Google"],["student_platform","WhatsApp"],
      ["student_study_reason","Career Development"],["student_study_reason","Travel"],["student_study_reason","Study"],["student_study_reason","Work"],["student_study_reason","Personal Interest"],["student_study_reason","Other"],
    ];
    await db.batch([
      ...studentDropdownDefaults.map(([kind,title])=>db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) SELECT ?,?,1,'{}' WHERE NOT EXISTS (SELECT 1 FROM settings_entities WHERE kind=? AND LOWER(title)=LOWER(?))").bind(kind,title,kind,title)),
      db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) VALUES ('system_meta','student_dropdowns_v1',0,'{}')"),
    ]);
  }
  await db.prepare("UPDATE settings_entities SET custom_data=json_set(custom_data, '$.batchStatus', 'Current Batch') WHERE kind='education_batch' AND json_type(custom_data, '$.batchStatus') IS NULL").run();
  const groupForm = await db.prepare("SELECT id FROM form_definitions WHERE form_key='group'").first<{id:number}>();
  if (groupForm) await db.batch([
    db.prepare("DELETE FROM form_fields WHERE form_id=? AND field_key IN ('title','capacity','isActive')").bind(groupForm.id),
    db.prepare("UPDATE form_fields SET sort_order=6 WHERE form_id=? AND field_key='startDate'").bind(groupForm.id),
    db.prepare("UPDATE form_fields SET sort_order=7 WHERE form_id=? AND field_key='timeSlotId'").bind(groupForm.id),
    db.prepare("UPDATE form_fields SET sort_order=8 WHERE form_id=? AND field_key='classroomId'").bind(groupForm.id),
    db.prepare("UPDATE form_fields SET sort_order=9 WHERE form_id=? AND field_key='notes'").bind(groupForm.id),
  ]);
  await db.prepare("UPDATE settings_entities SET title=CAST(id AS TEXT) WHERE kind='group' AND title LIKE 'GRP-%'").run();
}
