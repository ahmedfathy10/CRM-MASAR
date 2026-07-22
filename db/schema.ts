import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const departments = sqliteTable("departments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#2f6b5f"),
  parentId: integer("parent_id"),
  supportEnabled: integer("support_enabled", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const jobTitles = sqliteTable("job_titles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  departmentId: integer("department_id").references(() => departments.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rolePermissions = sqliteTable("role_permissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roleId: integer("role_id").notNull().references(() => roles.id),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  allowed: integer("allowed", { mode: "boolean" }).notNull().default(false),
});

export const branches = sqliteTable("branches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  primaryPhone: text("primary_phone").notNull().default(""),
  secondaryPhone: text("secondary_phone").notNull().default(""),
  email: text("email").notNull().default(""),
  socialUrl: text("social_url").notNull().default(""),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  customData: text("custom_data").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  departmentId: integer("department_id").references(() => departments.id),
  jobTitleId: integer("job_title_id").references(() => jobTitles.id),
  roleId: integer("role_id").references(() => roles.id),
  branchId: integer("branch_id").references(() => branches.id),
  status: text("status", { enum: ["active", "invited", "disabled"] })
    .notNull()
    .default("invited"),
  customData: text("custom_data").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("employees_email_idx").on(table.email)]);

export const formDefinitions = sqliteTable("form_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  formKey: text("form_key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const formFields = sqliteTable("form_fields", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  formId: integer("form_id").notNull().references(() => formDefinitions.id),
  fieldKey: text("field_key").notNull(),
  label: text("label").notNull(),
  type: text("type", { enum: ["text", "email", "tel", "number", "date", "datetime-local", "select", "textarea", "checkbox"] }).notNull(),
  placeholder: text("placeholder").notNull().default(""),
  required: integer("required", { mode: "boolean" }).notNull().default(false),
  visible: integer("visible", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  optionsJson: text("options_json").notNull().default("[]"),
  width: text("width", { enum: ["full", "half"] }).notNull().default("half"),
}, (table) => [uniqueIndex("form_fields_key_idx").on(table.formId, table.fieldKey)]);

export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fullName: text("full_name").notNull(),
  primaryPhone: text("primary_phone").notNull(),
  normalizedPhone: text("normalized_phone").notNull(),
  secondaryPhone: text("secondary_phone").notNull().default(""),
  email: text("email").notNull().default(""),
  source: text("source").notNull().default("غير محدد"),
  campaign: text("campaign").notNull().default(""),
  interest: text("interest").notNull().default(""),
  assignedEmployeeId: integer("assigned_employee_id").references(() => employees.id),
  branchId: integer("branch_id").references(() => branches.id),
  status: text("status").notNull().default("new"),
  priority: text("priority").notNull().default("normal"),
  notes: text("notes").notNull().default(""),
  customData: text("custom_data").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("leads_phone_idx").on(table.normalizedPhone)]);

export const callRecords = sqliteTable("call_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").references(() => leads.id),
  phone: text("phone").notNull(),
  direction: text("direction").notNull().default("outgoing"),
  result: text("result").notNull().default("no_answer"),
  assignedEmployeeId: integer("assigned_employee_id").references(() => employees.id),
  branchId: integer("branch_id").references(() => branches.id),
  callAt: text("call_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  notes: text("notes").notNull().default(""),
  customData: text("custom_data").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const followups = sqliteTable("followups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull().references(() => leads.id),
  assignedEmployeeId: integer("assigned_employee_id").references(() => employees.id),
  branchId: integer("branch_id").references(() => branches.id),
  scheduledAt: text("scheduled_at").notNull(),
  channel: text("channel").notNull().default("call"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("normal"),
  notes: text("notes").notNull().default(""),
  outcome: text("outcome").notNull().default(""),
  customData: text("custom_data").notNull().default("{}"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
