import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const root = "C:/CRM";
const sourceFile = "C:/Users/fathy/Desktop/Groups IDs.xlsx";
const normalize = (value) => String(value ?? "").replace(/\u00a0/g, " ").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const quote = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const workbook = XLSX.readFile(sourceFile);
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null })
  .filter((row) => ["B50-German", "B51-English"].includes(String(row.Batch)));
const input = fs.readFileSync(0, "utf8");
const state = JSON.parse(input.slice(input.indexOf("[")));
const groups = state[0].results;
const employees = state[1].results;
const groupById = new Map(groups.map((group) => [Number(group.id), group]));
const employeesByName = new Map();
for (const employee of employees) {
  const key = normalize(employee.fullName);
  employeesByName.set(key, [...(employeesByName.get(key) || []), employee]);
}
const placeholders = new Set(["", "no show", normalize("مفيش مدرس"), normalize("ضم ونقل")]);
const employeeMatches = (sourceName) => {
  const key = normalize(sourceName);
  if (placeholders.has(key)) return [];
  const exact = employeesByName.get(key) || [];
  if (exact.length) return exact;
  return employees.filter((employee) => normalize(employee.fullName).startsWith(`${key} `));
};

const unresolved = [];
const updates = [];
for (const row of rows) {
  const id = Number(row.Id);
  const group = groupById.get(id);
  const teacherName = String(row.Teacher ?? "").replace(/\u00a0/g, " ").trim();
  const adminName = String(row.Admin ?? "").replace(/\u00a0/g, " ").trim();
  const teacherMatches = employeeMatches(teacherName);
  const adminMatches = employeeMatches(adminName);
  const teacherRequired = !placeholders.has(normalize(teacherName));
  const adminRequired = !placeholders.has(normalize(adminName));
  if (!group) {
    unresolved.push({ id, group: Boolean(group), teacherName, teacherMatches: teacherMatches.map((item) => item.id), adminName, adminMatches: adminMatches.map((item) => item.id) });
    continue;
  }
  let details = {};
  try { details = JSON.parse(group.customData || "{}"); } catch {}
  const currentTeacher = teacherMatches.find((item) => Number(item.id) === Number(details.teacherId));
  const currentAdmin = adminMatches.find((item) => Number(item.id) === Number(details.adminId));
  const teacher = teacherMatches.length === 1 ? teacherMatches[0] : currentTeacher;
  const admin = adminMatches.length === 1 ? adminMatches[0] : currentAdmin;
  if ((teacherRequired && !teacher) || (adminRequired && !admin)) {
    unresolved.push({ id, group: true, teacherName, teacherMatches: teacherMatches.map((item) => item.id), adminName, adminMatches: adminMatches.map((item) => item.id) });
    continue;
  }
  const updatedDetails = {
    ...details,
    ...(teacher ? { teacherId: Number(teacher.id) } : {}),
    ...(admin ? { adminId: Number(admin.id) } : {}),
    sourceTeacherName: teacherName,
    sourceAdminName: adminName,
  };
  if (!teacherRequired) delete updatedDetails.teacherId;
  if (!adminRequired) delete updatedDetails.adminId;
  updates.push({
    id,
    details: updatedDetails,
  });
}

if (unresolved.length) {
  console.log(JSON.stringify({ rows: rows.length, resolved: updates.length, unresolved }, null, 2));
  process.exit(2);
}

const stamp = new Date().toISOString().replaceAll(":", "-").replace("T", "_").slice(0, 19);
const backupDir = path.join(root, "backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `b50-b51-group-staff-before-${stamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), groups }, null, 2));
const sqlPath = path.join(root, ".wrangler", `update-b50-b51-group-staff-${stamp}.sql`);
fs.mkdirSync(path.dirname(sqlPath), { recursive: true });
fs.writeFileSync(sqlPath, updates.map(({ id, details }) => `UPDATE settings_entities SET custom_data=${quote(JSON.stringify(details))} WHERE id=${id} AND kind='group';`).join("\n"));
console.log(JSON.stringify({ rows: rows.length, updates: updates.length, backupPath, sqlPath }, null, 2));
