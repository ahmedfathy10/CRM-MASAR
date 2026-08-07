import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../", import.meta.url);
const previewRoot = new URL("../app/_sites-preview/", import.meta.url);

test("uses the Masar CRM shell as the home page", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", sourceRoot), "utf8"),
    readFile(new URL("app/layout.tsx", sourceRoot), "utf8"),
    readFile(new URL("package.json", sourceRoot), "utf8"),
  ]);

  assert.match(page, /import\s+\{\s*CrmShell\s*\}\s+from\s+["']\.\/crm-shell["']/);
  assert.match(page, /export const dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(page, /return\s+<CrmShell\s*\/>/);

  assert.match(layout, /title:\s*["'][^"']*CRM/);
  assert.match(layout, /<html lang=["']ar["'] dir=["']rtl["']>/);
  assert.match(packageJson, /"name":\s*"masar-crm"/);
  assert.doesNotMatch(layout, /codex-preview|Starter Project|_sites-preview/);
});

test("does not depend on the disposable starter preview", async () => {
  const [page, packageJson, previewFiles] = await Promise.all([
    readFile(new URL("app/page.tsx", sourceRoot), "utf8"),
    readFile(new URL("package.json", sourceRoot), "utf8"),
    readdir(previewRoot).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    }),
  ]);

  assert.deepEqual(previewFiles.filter((file) => file.endsWith(".tsx") || file.endsWith(".css")), []);
  assert.doesNotMatch(page, /SkeletonPreview|_sites-preview|react-loading-skeleton/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("loads MTD data for the selected date range", async () => {
  const [shell, setupRoute] = await Promise.all([
    readFile(new URL("app/crm-shell.tsx", sourceRoot), "utf8"),
    readFile(new URL("app/api/setup/route.ts", sourceRoot), "utf8"),
  ]);

  assert.match(shell, /<MtdDashboardPage data=\{data\} reload=\{reload\}/);
  assert.doesNotMatch(shell, /<MtdDashboardPage data=\{data\} reload=\{reloadPage\}/);
  assert.doesNotMatch(shell, /type="date" min=\{monthStart\}/);
  assert.match(setupRoute, /page==="mtd"[\s\S]*?\.bind\(paymentFrom,paymentTo,paymentFrom,paymentTo\)/);
  assert.match(setupRoute, /transferExcludedReportPages/);
  assert.match(setupRoute, /transferred from another track/);
  assert.match(setupRoute, /transferred from another student/);
});

test("provides a permission-scoped monthly employee schedule", async () => {
  const [shell, route, setupRoute, bootstrap, migration] = await Promise.all([
    readFile(new URL("app/crm-shell.tsx", sourceRoot), "utf8"),
    readFile(new URL("app/api/employee-schedule/route.ts", sourceRoot), "utf8"),
    readFile(new URL("app/api/setup/route.ts", sourceRoot), "utf8"),
    readFile(new URL("db/bootstrap.ts", sourceRoot), "utf8"),
    readFile(new URL("drizzle/0018_employee_schedules.sql", sourceRoot), "utf8"),
  ]);

  assert.match(shell, /label: "Employees Schedule", tab: "employeeSchedule"/);
  assert.match(shell, /tab === "employeeSchedule"\) return <EmployeeSchedulePage/);
  assert.match(route, /pageKey === "employeeSchedule"/);
  assert.match(route, /dataScope/);
  assert.match(route, /employee_id=\? AND work_date=\?/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS employee_schedules/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS `employee_schedules_employee_date_idx`/);
  assert.match(shell, /kind: "employee_leave_type"/);
  assert.match(setupRoute, /allowedKinds=new Set\(\[[^\]]*"employee_leave_type"/);
  assert.match(setupRoute, /allowedKinds=new Set\(\[[^\]]*"retention_nonrenewal_reason"/);
});
