import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const root = "C:/CRM";
const batchIds = [4410, 4411];
const files = [
  "C:/Users/fathy/Downloads/B50-German.xlsx",
  "C:/Users/fathy/Downloads/B51-English.xlsx",
];
const idsFile = "C:/Users/fathy/Desktop/Groups IDs.xlsx";

const readRows = (file) => {
  const workbook = XLSX.readFile(file);
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null });
};
const normalizePhone = (input) => {
  let phone = String(input ?? "").replace(/\D/g, "");
  if (phone.startsWith("0020") && phone.length === 14) phone = `0${phone.slice(4)}`;
  else if (phone.startsWith("20") && phone.length === 12) phone = `0${phone.slice(2)}`;
  else if (phone.startsWith("002")) phone = phone.slice(3);
  else if (phone.startsWith("00")) phone = phone.slice(2);
  return phone;
};
const normalizedName = (input) => String(input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const sqlText = (input) => `'${String(input ?? "").replaceAll("'", "''")}'`;
const desiredGroups = readRows(idsFile).filter((row) => ["B50-German", "B51-English"].includes(String(row.Batch)));
const desiredGroupIds = new Set(desiredGroups.map((row) => Number(row.Id)));
const assignmentRows = files.flatMap((file) => readRows(file).map((row) => ({ ...row, sourceFile: path.basename(file) })));
const input = fs.readFileSync(0, "utf8");
const state = JSON.parse(input.slice(input.indexOf("[")));
const currentGroups = state[0].results;
const currentMembers = state[1].results;
const students = state[2].results;
const currentGroupIds = new Set(currentGroups.map((row) => Number(row.id)));
const missingGroupDefinitions = new Map([
  [18260, {
    batchId: 4411, roundId: 13, levelId: 213, branchId: 10, studyTypeId: 15,
    timeSlotId: 10, startDate: "2026-08-07", endDate: "2026-09-04",
    notes: "Imported from Groups IDs.xlsx with original Group ID #18260",
    sourceTeacherName: "Abdelwahab Mohammed", sourceAdminName: "Ahella Waleed",
    legacyExternalId: 18260, legacyImportSource: "Groups IDs.xlsx", legacyStudentCount: 3,
    sourceZoomFlag: false, capacityImportOverride: false, groupStatus: "Running",
    teacherId: 124, adminId: 32,
  }],
  [18234, {
    batchId: 4410, roundId: 14, levelId: 215, branchId: 1, studyTypeId: 15,
    timeSlotId: 17, startDate: "2026-07-31", endDate: "2026-08-28",
    notes: "Imported from Groups IDs.xlsx with original Group ID #18234",
    sourceTeacherName: "Esraa Mohamed", sourceAdminName: "Shahd Hossam",
    legacyExternalId: 18234, legacyImportSource: "Groups IDs.xlsx", legacyStudentCount: 0,
    sourceZoomFlag: false, capacityImportOverride: false, groupStatus: "Running",
    teacherId: 107, adminId: 64,
  }],
]);
const currentBatchStudentIds = new Set(currentMembers.map((row) => Number(row.studentReference)));
const currentStudentsByGroup = new Map();
for (const member of currentMembers) {
  const groupId = Number(member.groupId);
  currentStudentsByGroup.set(groupId, new Set([...(currentStudentsByGroup.get(groupId) || []), Number(member.studentReference)]));
}

const studentsByPhone = new Map();
const studentsByPrimaryPhone = new Map();
const studentsByName = new Map();
for (const student of students) {
  for (const phone of [student.mobile, student.secondaryMobile]) {
    const key = normalizePhone(phone);
    if (key) studentsByPhone.set(key, [...(studentsByPhone.get(key) || []), student]);
  }
  const primaryKey = normalizePhone(student.mobile);
  if (primaryKey) studentsByPrimaryPhone.set(primaryKey, [...(studentsByPrimaryPhone.get(primaryKey) || []), student]);
  const name = normalizedName(student.fullName);
  studentsByName.set(name, [...(studentsByName.get(name) || []), student]);
}

const assignments = [];
const unresolved = [];
const verifiedOverrides = new Map([
  ["15342|mohamed sabry", 14432],
  ["18115|youssef waled", 10879],
  ["18260|mahmoud saber", 14436],
  ["18260|ahmed salama", 14148],
  ["18260|mohamed abdelaziz", 15055],
]);
for (const row of assignmentRows) {
  const groupId = Number(row["Group Id"]);
  const name = normalizedName(row.Name);
  const primary = studentsByPrimaryPhone.get(normalizePhone(row["Mobile 1"])) || [];
  const secondary = studentsByPhone.get(normalizePhone(row["Mobile 2"])) || [];
  const phoneMatches = [...new Map([...primary, ...secondary].map((student) => [student.id, student])).values()];
  const exactPhoneName = phoneMatches.filter((student) => normalizedName(student.fullName) === name);
  const nameMatches = studentsByName.get(name) || [];
  const candidates = [...new Map([...phoneMatches, ...nameMatches].map((student) => [student.id, student])).values()];
  const sameGroup = candidates.filter((student) => currentStudentsByGroup.get(groupId)?.has(Number(student.id)));
  const sameBatch = candidates.filter((student) => currentBatchStudentIds.has(Number(student.id)));
  const overrideId = verifiedOverrides.get(`${groupId}|${name}`);
  let student = overrideId ? students.find((item) => Number(item.id) === overrideId) : undefined;
  if (exactPhoneName.length === 1) student = exactPhoneName[0];
  else if (primary.length === 1) student = primary[0];
  else if (phoneMatches.length === 1) student = phoneMatches[0];
  else if (nameMatches.length === 1) student = nameMatches[0];
  else if (sameGroup.length === 1) student = sameGroup[0];
  else if (sameBatch.length === 1) student = sameBatch[0];
  if (!student || !desiredGroupIds.has(groupId)) {
    unresolved.push({ groupId, name: row.Name, mobile1: row["Mobile 1"], candidates: candidates.map((item) => item.id) });
    continue;
  }
  assignments.push({ groupId, studentId: Number(student.id), joinedAt: String(row.Start || new Date().toISOString()).slice(0, 10), sourceFile: row.sourceFile });
}

if (unresolved.length) throw new Error(`Unresolved assignments: ${JSON.stringify(unresolved, null, 2)}`);
const duplicateKeys = assignments.map((row) => `${row.groupId}:${row.studentId}`).filter((key, index, all) => all.indexOf(key) !== index);
if (duplicateKeys.length) throw new Error(`Duplicate group assignments: ${[...new Set(duplicateKeys)].join(", ")}`);

const backupDir = path.join(root, "backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-").replace("T", "_").slice(0, 19);
const backupPath = path.join(backupDir, `b50-b51-groups-before-${stamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), batchIds, currentGroups, currentMembers }, null, 2));

const extraGroupIds = currentGroups.map((row) => Number(row.id)).filter((id) => !desiredGroupIds.has(id));
const missingGroupIds = [...desiredGroupIds].filter((id) => !currentGroupIds.has(id));
const undefinedMissingGroups = missingGroupIds.filter((id) => !missingGroupDefinitions.has(id));
if (undefinedMissingGroups.length) throw new Error(`Missing group definitions: ${undefinedMissingGroups.join(", ")}`);
const allCurrentIds = currentGroups.map((row) => Number(row.id));
const statements = [
  `DELETE FROM group_members WHERE group_id IN (${allCurrentIds.join(",")});`,
  ...(extraGroupIds.length ? [`DELETE FROM settings_entities WHERE kind='group' AND id IN (${extraGroupIds.join(",")});`] : []),
  ...missingGroupIds.map((id) => `INSERT INTO settings_entities (id,kind,title,is_active,custom_data) VALUES (${id},'group',${sqlText(id)},1,${sqlText(JSON.stringify(missingGroupDefinitions.get(id)))});`),
  ...assignments.map((row) => `INSERT INTO group_members (group_id,student_reference,added_by_employee_id,added_by_name,joined_at) VALUES (${row.groupId},${sqlText(row.studentId)},NULL,'Batch Excel Import',${sqlText(`${row.joinedAt}T12:00:00+03:00`)});`),
];
const sqlPath = path.join(root, ".wrangler", `replace-b50-b51-groups-${stamp}.sql`);
fs.mkdirSync(path.dirname(sqlPath), { recursive: true });
fs.writeFileSync(sqlPath, statements.join("\n"));
console.log(JSON.stringify({ backupPath, sqlPath, desiredGroups: desiredGroupIds.size, missingGroupIds, extraGroupIds, assignments: assignments.length }, null, 2));
