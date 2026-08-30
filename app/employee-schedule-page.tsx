"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ScheduleEmployee = {
  id: number;
  fullName: string;
  status: string;
  department: string | null;
  branchName: string | null;
};

type ScheduleEntry = {
  id: number;
  employeeId: number;
  employeeName: string;
  workDate: string;
  dayStatus: "work" | "leave";
  leaveType: string;
  shiftFrom: string;
  shiftTo: string;
  notes: string;
  createdByName: string;
  updatedAt: string;
};

type SchedulePermission = { canView: number; canAdd: number; canEdit: number; canDelete: number };

const defaultLeaveTypes = ["إجازة سنوية", "إجازة عارضة", "إجازة مرضية", "إجازة بدون مرتب", "عطلة رسمية", "أخرى"];
async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body) throw new Error(`تعذر إكمال الطلب (HTTP ${response.status})`);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`استجابة غير صالحة من الخادم (HTTP ${response.status})`);
  }
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(year, monthNumber - 1 + offset, 1)));
}

function monthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export function EmployeeSchedulePage() {
  const today = new Date(),
    currentMonth = monthKey(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
  const [month, setMonth] = useState(currentMonth);
  const [employees, setEmployees] = useState<ScheduleEmployee[]>([]);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [branchFilter, setBranchFilter] = useState("");
  const [leaveTypes, setLeaveTypes] = useState<string[]>(defaultLeaveTypes);
  const [permission, setPermission] = useState<SchedulePermission>({ canView: 0, canAdd: 0, canEdit: 0, canDelete: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<ScheduleEntry | null>(null);

  async function load(targetMonth = month) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/employee-schedule/?month=${encodeURIComponent(targetMonth)}`, { cache: "no-store" });
      const result = await readJson<{ employees?: ScheduleEmployee[]; entries?: ScheduleEntry[]; leaveTypes?: string[]; permission?: SchedulePermission; error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "تعذر تحميل جدول الموظفين");
      setEmployees(result.employees || []);
      setEntries(result.entries || []);
      setLeaveTypes(result.leaveTypes ?? defaultLeaveTypes);
      setPermission(result.permission || { canView: 0, canAdd: 0, canEdit: 0, canDelete: 0 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحميل جدول الموظفين");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(month);
  }, [month]);

  const dates = Array.from({ length: monthDays(month) }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`),
    entryByEmployeeDate = new Map(entries.map((entry) => [`${entry.employeeId}:${entry.workDate}`, entry])),
    branches = useMemo(
      () => Array.from(new Set(employees.map((employee) => employee.branchName).filter((branch): branch is string => Boolean(branch)))).sort((a, b) => a.localeCompare(b)),
      [employees],
    ),
    visibleEmployees = useMemo(
      () => employees.filter((employee) => !branchFilter || employee.branchName === branchFilter),
      [employees, branchFilter],
    ),
    employeeSummaries = useMemo(() => {
      const summaries = new Map<number, { work: number; leaves: Map<string, number> }>();
      entries.forEach((entry) => {
        const summary = summaries.get(entry.employeeId) || { work: 0, leaves: new Map<string, number>() };
        if (entry.dayStatus === "work") summary.work += 1;
        else {
          const leaveType = entry.leaveType || "Other leave";
          summary.leaves.set(leaveType, (summary.leaves.get(leaveType) || 0) + 1);
        }
        summaries.set(entry.employeeId, summary);
      });
      return summaries;
    }, [entries]);

  const openCell = (employeeId: number, date: string, entry: ScheduleEntry | null = null) => {
    if (entry ? !permission.canEdit : !permission.canAdd) return;
    setSelectedEmployeeId(employeeId);
    setSelectedEntry(entry);
    setSelectedDate(date);
  };

  return (
    <div className="content-stack employee-schedule-page">
      <section className="employee-schedule-hero">
        <div>
          <span>EMPLOYEES MANAGER</span>
          <h2>Employees Schedule</h2>
          <p>خطة العمل والإجازات الشهرية للموظفين ضمن نطاق صلاحيتك.</p>
        </div>
        <div className="employee-schedule-summary">
          <strong>{visibleEmployees.length}</strong>
          <small>موظف متاح</small>
        </div>
      </section>

      <section className="panel employee-schedule-toolbar">
        <button type="button" className="icon-button" title="الشهر السابق" onClick={() => setMonth((value) => shiftMonth(value, -1))}>‹</button>
        <div>
          <small>الشهر المعروض</small>
          <h3>{monthLabel(month)}</h3>
        </div>
        <button type="button" className="secondary" onClick={() => setMonth(currentMonth)}>الشهر الحالي</button>
        <button type="button" className="icon-button" title="الشهر التالي" onClick={() => setMonth((value) => shiftMonth(value, 1))}>›</button>
        <label className="employee-schedule-branch-filter">
          Branch
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            <option value="">All branches</option>
            {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
        </label>
      </section>

      {error && <div className="form-error">{error}</div>}
      <section className="panel employee-schedule-matrix-wrap" aria-busy={loading}>
        <table className="employee-schedule-matrix">
          <thead>
            <tr>
              <th className="employee-schedule-name-head">الموظف</th>
              {dates.map((date) => {
                const value = new Date(`${date}T00:00:00Z`);
                return <th key={date}><span>{new Intl.DateTimeFormat("ar-EG", { weekday: "short", timeZone: "UTC" }).format(value)}</span><strong>{Number(date.slice(8))}</strong></th>;
              })}
              <th className="employee-schedule-summary-head">Totals</th>
            </tr>
          </thead>
          <tbody>
            {visibleEmployees.map((employee) => {
              const summary = employeeSummaries.get(employee.id) || { work: 0, leaves: new Map<string, number>() };
              return (
              <tr key={employee.id}>
                <th className="employee-schedule-name-cell"><strong>{employee.fullName}</strong><small>{employee.branchName || employee.department || "بدون فرع"}</small></th>
                {dates.map((date) => {
                  const entry = entryByEmployeeDate.get(`${employee.id}:${date}`);
                  return (
                    <td key={date}>
                      <button type="button" className={`employee-schedule-cell ${entry?.dayStatus || "empty"}`} onClick={() => openCell(employee.id, date, entry || null)} title={`${employee.fullName} - ${date}`}>
                        {entry ? <><b>{entry.dayStatus === "work" ? "شغل" : "إجازة"}</b><small>{entry.dayStatus === "work" ? `${entry.shiftFrom} - ${entry.shiftTo}` : entry.leaveType}</small></> : <span>{permission.canAdd ? "+" : "-"}</span>}
                      </button>
                    </td>
                  );
                })}
                <td className="employee-schedule-summary-cell">
                  <div className="employee-schedule-totals">
                    <span className="work">Work {summary.work}</span>
                    {Array.from(summary.leaves.entries()).map(([leaveType, total]) => <span className="leave" key={leaveType}>{leaveType} {total}</span>)}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !employees.length && <div className="empty-state">لا يوجد موظفون ضمن نطاق صلاحيتك.</div>}
      </section>

      {selectedDate && (
        <EmployeeScheduleDialog
          date={selectedDate}
          employees={visibleEmployees}
          presetEmployeeId={selectedEmployeeId}
          leaveTypes={leaveTypes}
          entry={selectedEntry}
          canDelete={Boolean(permission.canDelete)}
          onClose={() => {
            setSelectedDate("");
            setSelectedEmployeeId(0);
            setSelectedEntry(null);
          }}
          onSaved={async () => {
            setSelectedDate("");
            setSelectedEmployeeId(0);
            setSelectedEntry(null);
            await load(month);
          }}
        />
      )}
    </div>
  );
}

function EmployeeScheduleDialog({ date, employees, presetEmployeeId, leaveTypes, entry, canDelete, onClose, onSaved }: { date: string; employees: ScheduleEmployee[]; presetEmployeeId: number; leaveTypes: string[]; entry: ScheduleEntry | null; canDelete: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [employeeId, setEmployeeId] = useState(String(entry?.employeeId || presetEmployeeId || ""));
  const [dayStatus, setDayStatus] = useState<"work" | "leave">(entry?.dayStatus || "work");
  const [leaveType, setLeaveType] = useState(entry?.leaveType || leaveTypes[0] || "");
  const [shiftFrom, setShiftFrom] = useState(entry?.shiftFrom || "09:00");
  const [shiftTo, setShiftTo] = useState(entry?.shiftTo || "17:00");
  const [notes, setNotes] = useState(entry?.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/employee-schedule/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save", employeeId: Number(employeeId), workDate: date, dayStatus, leaveType: dayStatus === "leave" ? leaveType : "", shiftFrom, shiftTo, notes }),
      });
      const result = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "تعذر حفظ اليوم");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر حفظ اليوم");
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry || !window.confirm(`حذف جدول ${entry.employeeName} ليوم ${date}؟`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/employee-schedule/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", id: entry.id }) });
      const result = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "تعذر حذف اليوم");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر حذف اليوم");
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="dialog employee-schedule-dialog" onSubmit={submit}>
        <div className="dialog-head">
          <div>
            <span className="dialog-icon">▦</span>
            <div><h2>{entry ? "تعديل جدول الموظف" : "إضافة جدول موظف"}</h2><p>{date}</p></div>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="employee-schedule-form">
          <label>
            الموظف
            <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required disabled={Boolean(entry || presetEmployeeId)}>
              <option value="">اختر الموظف</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} · {employee.branchName || employee.department || "بدون فرع"}</option>)}
            </select>
          </label>
          <fieldset>
            <legend>حالة اليوم</legend>
            <div className="employee-schedule-segmented">
              <button type="button" className={dayStatus === "work" ? "active work" : ""} onClick={() => setDayStatus("work")}>شغل</button>
              <button type="button" className={dayStatus === "leave" ? "active leave" : ""} onClick={() => setDayStatus("leave")}>إجازة</button>
            </div>
          </fieldset>
          {dayStatus === "work" && <div className="employee-shift-times"><label>الشفت من<input type="time" value={shiftFrom} onChange={(event) => setShiftFrom(event.target.value)} required /></label><label>الشفت إلى<input type="time" value={shiftTo} onChange={(event) => setShiftTo(event.target.value)} required /></label></div>}
          {dayStatus === "leave" && <label>نوع الإجازة<select value={leaveType} onChange={(event) => setLeaveType(event.target.value)} required><option value="">اختر نوع الإجازة</option>{leaveTypes.map((type) => <option key={type}>{type}</option>)}</select>{!leaveTypes.length && <small className="form-warning">أضف أنواع الإجازات أولًا من Admin Settings.</small>}</label>}
          <label>ملاحظات<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات اختيارية" rows={3} /></label>
        </div>
        <div className="dialog-foot">
          {entry && canDelete && <button type="button" className="delete" disabled={busy} onClick={remove}>حذف</button>}
          <button type="button" className="secondary" onClick={onClose}>إلغاء</button>
          <button className="primary" disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ اليوم"}</button>
        </div>
      </form>
    </div>
  );
}
