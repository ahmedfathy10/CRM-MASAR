import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const bin = process.platform === 'win32' ? 'C:/Program Files/nodejs/npx.cmd' : 'npx';
const runJson = (sql) => {
  const raw = execSync(`"${bin}" wrangler d1 execute masar-crm-production --remote --json --command ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
    shell: true,
  });
  return JSON.parse(raw)[0]?.results || [];
};

const normalizePhone = (value) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0020')) digits = `0${digits.slice(4)}`;
  if (digits.startsWith('20') && digits.length > 10) digits = `0${digits.slice(2)}`;
  return digits;
};
const normalizedLabel = (input) => String(input || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const value = (row, ...names) => {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null) return String(row[name]).trim();
  }
  return '';
};
const dateValue = (input) => {
  const raw = String(input || '').trim();
  const match = raw.match(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/);
  return match ? match[0] : raw;
};
const importDate = (input) => {
  const raw = String(input || '').trim();
  const direct = dateValue(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(direct)) return direct.slice(0, 10);
  const match = raw.match(/(?:\w+\s+)?(\d{1,2})\s+([A-Za-z]{3})/);
  if (!match) return '';
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = months.indexOf(match[2].toLowerCase());
  return month < 0 ? '' : `${new Date().getFullYear()}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
};

const students = runJson('SELECT id, full_name AS name, mobile, secondary_mobile AS secondary FROM students');
const levels = runJson("SELECT id, title FROM settings_entities WHERE kind='level'");
const groups = runJson("SELECT id, title, custom_data AS customData FROM settings_entities WHERE kind='group'");
const members = runJson('SELECT group_id AS groupId, student_reference AS studentId FROM group_members');

const groupIds = new Set(groups.map((item) => Number(item.id)));
const existingSet = new Set(members.map((item) => `${Number(item.groupId)}:${Number(item.studentId)}`));
const byPhone = new Map();
const byName = new Map();
const findId = (list, label) => list.find((item) => (item.title || item.name || '').trim().toLowerCase() === String(label || '').trim().toLowerCase())?.id || null;
for (const student of students) {
  for (const phone of [student.mobile, student.secondary]) {
    const normalized = normalizePhone(phone);
    if (normalized) {
      const current = byPhone.get(normalized) || [];
      current.push(student.id);
      byPhone.set(normalized, current);
    }
  }
  const normalizedName = normalizedLabel(student.name);
  const currentNames = byName.get(normalizedName) || [];
  currentNames.push(student.id);
  byName.set(normalizedName, currentNames);
}

const files = [
  'C:/Users/fathy/Downloads/B35 -English.xlsx',
  'C:/Users/fathy/Downloads/B36 -English.xlsx',
  'C:/Users/fathy/Downloads/B37-English.xlsx',
  'C:/Users/fathy/Downloads/B38 -English.xlsx',
  'C:/Users/fathy/Downloads/B39 -English.xlsx'
];

const statements = [];
let totalInserted = 0;
let totalSkipped = 0;
let totalInvalid = 0;

for (const file of files) {
  const workbook = XLSX.readFile(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  let inserted = 0;
  let skipped = 0;
  let invalid = 0;

  for (const row of rows) {
    const groupId = Number(value(row, 'Group Id', 'Group ID', 'Id'));
    if (!groupId || !groupIds.has(groupId)) {
      invalid++;
      continue;
    }
    const phones = [normalizePhone(value(row, 'Mobile 1')), normalizePhone(value(row, 'Mobile 2'))].filter(Boolean);
    const phoneMatches = [...new Set(phones.flatMap((phone) => byPhone.get(phone) || []))];
    const nameMatches = byName.get(normalizedLabel(value(row, 'Name', 'Student Name'))) || [];
    let studentId = phoneMatches.length === 1 ? phoneMatches[0] : nameMatches.length === 1 ? nameMatches[0] : phoneMatches.find((id) => nameMatches.includes(id));
    if (!studentId) {
      const name = value(row, 'Name', 'Student Name');
      const primaryPhone = normalizePhone(value(row, 'Mobile 1'));
      const secondaryPhone = normalizePhone(value(row, 'Mobile 2'));
      const levelId = findId(levels, value(row, 'Level')) || 0;
      const createdAt = new Date().toISOString();
      if (!name || (!primaryPhone && !secondaryPhone)) {
        invalid++;
        continue;
      }
      const detailJson = JSON.stringify({ importSource: file, groupId, level: value(row, 'Level'), gender: value(row, 'Gender'), location: value(row, 'Location') }).replace(/'/g, "''");
      const insert = runJson(`INSERT INTO students (full_name, mobile, secondary_mobile, email, level_id, track_id, branch_id, status, custom_data, created_at) VALUES (${JSON.stringify(name)}, ${JSON.stringify(primaryPhone)}, ${JSON.stringify(secondaryPhone)}, '', ${levelId}, NULL, NULL, 'active', '${detailJson}', ${JSON.stringify(createdAt)})`);
      const record = runJson('SELECT last_insert_rowid() AS id');
      studentId = Number(record[0]?.id || 0);
      if (!studentId) {
        invalid++;
        continue;
      }
      byPhone.set(primaryPhone, [...(byPhone.get(primaryPhone) || []), studentId]);
      if (secondaryPhone) byPhone.set(secondaryPhone, [...(byPhone.get(secondaryPhone) || []), studentId]);
      byName.set(normalizedLabel(name), [...(byName.get(normalizedLabel(name)) || []), studentId]);
    }
    const memberKey = `${groupId}:${studentId}`;
    if (existingSet.has(memberKey)) {
      skipped++;
      continue;
    }
    const joinedAt = importDate(row.Start) || new Date().toISOString();
    statements.push(`INSERT OR IGNORE INTO group_members (group_id, student_reference, added_by_employee_id, added_by_name, joined_at) VALUES (${groupId}, '${String(studentId)}', 6, 'Groups Excel Import', '${joinedAt}')`);
    existingSet.add(memberKey);
    inserted++;
  }

  console.log(path.basename(file), { inserted, skipped, invalid });
  totalInserted += inserted;
  totalSkipped += skipped;
  totalInvalid += invalid;
}

const sqlFile = path.resolve('scripts', 'group_students_insert.sql');
fs.writeFileSync(sqlFile, statements.map((statement) => `${statement};`).join('\n'), 'utf8');
console.log('WROTE', sqlFile, 'statements=', statements.length);
console.log('SUMMARY', { inserted: totalInserted, skipped: totalSkipped, invalid: totalInvalid });
