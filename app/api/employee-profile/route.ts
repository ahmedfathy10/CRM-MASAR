import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

function tokenFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("masar_session="))?.slice(14) || "";
}
function json(value: unknown) { try { return JSON.parse(String(value || "{}")) as Record<string, unknown>; } catch { return {}; } }
function monthBounds(offset = 0) {
  const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)), end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { key: start.toISOString().slice(0, 7), from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
function paymentAmount(row: { customData: string }) {
  const item = json(row.customData); if (item.voided) return 0;
  return Math.max(0, Number(item.netPaid ?? item.paid ?? 0) - Number(item.refunded || 0));
}
function paymentType(row: { customData: string }) { return String(json(row.customData).paymentType || "").toLowerCase(); }

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const db = env.DB, token = tokenFrom(request);
    const employee = token ? await db.prepare("SELECT e.id,e.full_name AS fullName,e.email,e.phone,e.department_id AS departmentId,d.name AS department,e.job_title_id AS jobTitleId,j.name AS jobTitle,e.branch_id AS branchId,b.name AS branchName FROM employee_sessions s JOIN employees e ON e.id=s.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN branches b ON b.id=e.branch_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token, new Date().toISOString()).first<Record<string, unknown>>() : null;
    if (!employee) return Response.json({ error: "يجب تسجيل الدخول أولًا" }, { status: 401 });
    const id = Number(employee.id), current = monthBounds(), previous = monthBounds(-1), department = String(employee.department || ""), jobTitle = String(employee.jobTitle || ""), mode = department === "Sales" || department === "Call Center" ? "sales" : /teacher/i.test(jobTitle) ? "teacher" : department === "Operations" ? "operations" : "general";

    const ownerField = mode === "teacher" ? "teacherId" : "adminId";
    const ownedStudentSql = `SELECT CAST(gm.student_reference AS INTEGER) FROM group_members gm JOIN settings_entities g ON g.id=gm.group_id WHERE g.kind='group' AND g.is_active=1 AND CAST(json_extract(g.custom_data,'$.${ownerField}') AS INTEGER)=?`;
    const studentsQuery = mode === "sales"
      ? db.prepare("SELECT id,full_name AS fullName,custom_data AS customData FROM students").all()
      : mode === "operations" || mode === "teacher"
        ? db.prepare(`SELECT id,full_name AS fullName,custom_data AS customData FROM students WHERE id IN (${ownedStudentSql})`).bind(id).all()
        : db.prepare("SELECT id,full_name AS fullName,custom_data AS customData FROM students WHERE 1=0").all();
    const recordsQuery = mode === "sales"
      ? db.prepare("SELECT student_id AS studentId,kind,record_date AS recordDate,status,custom_data AS customData FROM student_records WHERE kind='payment' AND substr(record_date,1,10)>=?").bind(previous.from).all()
      : mode === "operations" || mode === "teacher"
        ? db.prepare(`SELECT student_id AS studentId,kind,record_date AS recordDate,status,custom_data AS customData FROM student_records WHERE kind IN ('payment','attendance') AND student_id IN (${ownedStudentSql})`).bind(id).all()
        : db.prepare("SELECT student_id AS studentId,kind,record_date AS recordDate,status,custom_data AS customData FROM student_records WHERE 1=0").all();
    const [schedule, adjustments, classVisits, tasks, leads, calls, followups, groupsResult, membersResult, studentsResult, recordsResult, targetsResult, employeesResult] = await Promise.all([
      db.prepare("SELECT work_date AS workDate,day_status AS dayStatus,leave_type AS leaveType,shift_from AS shiftFrom,shift_to AS shiftTo FROM employee_schedules WHERE employee_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date").bind(id,current.from,current.to).all(),
      db.prepare("SELECT kind,title,value,notes,record_date AS recordDate FROM employee_adjustments WHERE employee_id=? ORDER BY record_date DESC,id DESC LIMIT 20").bind(id).all(),
      db.prepare("SELECT cv.id,cv.visit_date AS visitDate,cv.score,cv.notes,cv.visited_by_name AS visitedByName,g.title AS groupTitle FROM class_visits cv LEFT JOIN settings_entities g ON g.id=cv.group_id WHERE cv.teacher_id=? ORDER BY cv.visit_date DESC,cv.id DESC LIMIT 20").bind(id).all(),
      db.prepare("SELECT id,title,due_date AS dueDate,is_completed AS isCompleted,created_at AS createdAt FROM employee_tasks WHERE employee_id=? ORDER BY is_completed,due_date='',due_date,id DESC").bind(id).all(),
      db.prepare("SELECT id,assigned_employee_id AS assignedEmployeeId,created_at AS createdAt FROM leads").all(),
      db.prepare("SELECT id,lead_id AS leadId,assigned_employee_id AS assignedEmployeeId,call_at AS callAt FROM call_records").all(),
      db.prepare("SELECT f.id,f.lead_id AS leadId,f.scheduled_at AS scheduledAt,f.status,f.channel,f.notes,l.full_name AS leadName FROM followups f LEFT JOIN leads l ON l.id=f.lead_id WHERE f.assigned_employee_id=? ORDER BY f.scheduled_at").bind(id).all(),
      mode === "operations" || mode === "teacher" ? db.prepare(`SELECT id,title,custom_data AS customData FROM settings_entities WHERE kind='group' AND is_active=1 AND CAST(json_extract(custom_data,'$.${ownerField}') AS INTEGER)=?`).bind(id).all() : Promise.resolve({results:[]}),
      mode === "operations" || mode === "teacher" ? db.prepare(`SELECT group_id AS groupId,CAST(student_reference AS INTEGER) AS studentId FROM group_members WHERE CAST(student_reference AS INTEGER) IN (${ownedStudentSql})`).bind(id).all() : Promise.resolve({results:[]}),
      studentsQuery,
      recordsQuery,
      db.prepare("SELECT title,custom_data AS customData FROM settings_entities WHERE kind='retention_target' AND is_active=1").all(),
      db.prepare("SELECT id,department_id AS departmentId FROM employees WHERE status<>'inactive'").all(),
    ]);
    const leadRows = leads.results as Array<Record<string, unknown>>, callRows = calls.results as Array<Record<string, unknown>>, followupRows = followups.results as Array<Record<string, unknown>>, records = recordsResult.results as Array<{studentId:number;kind:string;recordDate:string;status:string;customData:string}>, students = studentsResult.results as Array<{id:number;fullName:string;customData:string}>;
    const leadIds = new Set(leadRows.filter((row) => Number(row.assignedEmployeeId) === id).map((row) => Number(row.id))), callIds = new Set(callRows.filter((row) => Number(row.assignedEmployeeId) === id).map((row) => Number(row.id)));
    const attributedStudents = new Set(students.filter((student) => { const detail=json(student.customData), linkedLeads=(Array.isArray(detail.linkedLeadIds)?detail.linkedLeadIds:[]).map(Number), linkedCalls=(Array.isArray(detail.linkedCallIds)?detail.linkedCallIds:[]).map(Number); return linkedLeads.some((value)=>leadIds.has(value))||linkedCalls.some((value)=>callIds.has(value)); }).map((student)=>student.id));
    const salesFor = (from:string,to:string,studentIds=attributedStudents) => records.filter((row)=>row.kind==="payment"&&row.recordDate.slice(0,10)>=from&&row.recordDate.slice(0,10)<=to&&studentIds.has(row.studentId)).reduce((sum,row)=>sum+paymentAmount(row),0);
    const salesPeople = (employeesResult.results as Array<{id:number;departmentId:number}>).filter((row)=>[1,2].includes(Number(row.departmentId))), salesRanking = salesPeople.map((person)=>{ const personLeadIds=new Set(leadRows.filter((row)=>Number(row.assignedEmployeeId)===person.id).map((row)=>Number(row.id))), personCallIds=new Set(callRows.filter((row)=>Number(row.assignedEmployeeId)===person.id).map((row)=>Number(row.id))), personStudents=new Set(students.filter((student)=>{const detail=json(student.customData);return (Array.isArray(detail.linkedLeadIds)?detail.linkedLeadIds:[]).map(Number).some((value)=>personLeadIds.has(value))||(Array.isArray(detail.linkedCallIds)?detail.linkedCallIds:[]).map(Number).some((value)=>personCallIds.has(value))}).map((student)=>student.id)); return {id:person.id,value:salesFor(current.from,current.to,personStudents)} }).sort((a,b)=>b.value-a.value);
    const sales = { leads: leadRows.filter((row)=>Number(row.assignedEmployeeId)===id&&String(row.createdAt).slice(0,10)>=current.from).length, calls: callRows.filter((row)=>Number(row.assignedEmployeeId)===id&&String(row.callAt).slice(0,10)>=current.from).length, followups: followupRows.filter((row)=>String(row.scheduledAt).slice(0,10)>=current.from&&String(row.scheduledAt).slice(0,10)<=current.to).length, upcoming: followupRows.filter((row)=>row.status==="pending"&&String(row.scheduledAt)>=new Date().toISOString()).slice(0,12), currentSales:salesFor(current.from,current.to), previousSales:salesFor(previous.from,previous.to), rank:Math.max(1,salesRanking.findIndex((row)=>row.id===id)+1), teamSize:salesRanking.length };

    const ownedGroups=(groupsResult.results as Array<{id:number;title:string;customData:string}>).map((group)=>({id:group.id,title:group.title,detail:json(group.customData)})).filter((group)=>mode==="teacher"?Number(group.detail.teacherId)===id:Number(group.detail.adminId)===id), groupIds=new Set(ownedGroups.map((group)=>group.id)), members=(membersResult.results as Array<{groupId:number;studentId:number}>).filter((row)=>groupIds.has(row.groupId)), studentIds=new Set(members.map((row)=>row.studentId));
    const groupDay=(group:{detail:Record<string,unknown>})=>{const date=new Date(`${String(group.detail.startDate||"").slice(0,10)}T12:00:00Z`),day=date.getUTCDay();return day===5?"الجمعة":day===6||day===2?"السبت والثلاثاء":day===0||day===3?"الأحد والأربعاء":"الاثنين والخميس"}, dayCounts=Object.fromEntries(["السبت والثلاثاء","الأحد والأربعاء","الاثنين والخميس","الجمعة"].map((label)=>[label,ownedGroups.filter((group)=>groupDay(group)===label).reduce((sum,group)=>sum+members.filter((member)=>member.groupId===group.id).length,0)]));
    const teamStudents=students.filter((student)=>studentIds.has(student.id)), renewed=teamStudents.filter((student)=>{const workflow=json(student.customData).retentionWorkflow as Record<string,unknown>|undefined;return String(workflow?.status||"")==="Renewed"}).length, pendingRetention=teamStudents.length-renewed, payments=records.filter((row)=>row.kind==="payment"&&studentIds.has(row.studentId)), retentionPayments=payments.filter((row)=>/retention|renewal/.test(paymentType(row))&&row.recordDate.slice(0,10)>=current.from&&row.recordDate.slice(0,10)<=current.to), retentionRevenue=retentionPayments.reduce((sum,row)=>sum+paymentAmount(row),0), debt=payments.reduce((sum,row)=>sum+Math.max(0,Number(json(row.customData).due||0)),0), collected=payments.reduce((sum,row)=>sum+paymentAmount(row),0), attendance=records.filter((row)=>row.kind==="attendance"&&studentIds.has(row.studentId)), absences=attendance.filter((row)=>String(row.status).toLowerCase()==="absent").length, books=payments.filter((row)=>paymentType(row).includes("book")&&paymentAmount(row)>0).length;
    const target=targetsResult.results.map((row:any)=>json(row.customData)).filter((detail)=>String(detail.month||"").slice(0,7)===current.key&&String(detail.targetType||"")==="admin"&&Number(detail.targetId)===id).reduce((sum,detail)=>sum+Number(detail.amount||0),0);
    const operations={groups:ownedGroups.map((group)=>({id:group.id,title:group.title,students:members.filter((row)=>row.groupId===group.id).length,days:groupDay(group)})),dayCounts,totalStudents:studentIds.size,retentionTotal:teamStudents.length,renewed,pendingRetention,renewalRate:teamStudents.length?Math.round(renewed*100/teamStudents.length):0,debt,collected,outstanding:Math.max(0,debt),collectionRate:debt+collected?Math.round(collected*100/(debt+collected)):0,absenceRate:attendance.length?Math.round(absences*100/attendance.length):0,books,booksRate:studentIds.size?Math.round(books*100/studentIds.size):0,target,retentionRevenue,targetRate:target?Math.round(retentionRevenue*100/target):0};
    return Response.json({ employee, mode, month:current.key, schedule:schedule.results, adjustments:adjustments.results, classVisits:classVisits.results, tasks:tasks.results, sales, operations });
  } catch (reason) { console.error("employee profile failed",reason); return Response.json({error:reason instanceof Error?reason.message:"تعذر تحميل بروفايل الموظف"},{status:500}); }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const db=env.DB,token=tokenFrom(request),employee=token?await db.prepare("SELECT e.id FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token,new Date().toISOString()).first<{id:number}>():null;
    if(!employee)return Response.json({error:"يجب تسجيل الدخول أولًا"},{status:401});
    const payload=await request.json() as Record<string,unknown>,action=String(payload.action||"create"),taskId=Number(payload.id)||0;
    if(action==="create"){
      const title=String(payload.title||"").trim(),dueDate=String(payload.dueDate||"").slice(0,10);
      if(!title)return Response.json({error:"اكتب اسم المهمة"},{status:400});
      const result=await db.prepare("INSERT INTO employee_tasks(employee_id,title,due_date,updated_at) VALUES(?,?,?,?)").bind(employee.id,title,dueDate,new Date().toISOString()).run();
      return Response.json({id:result.meta.last_row_id},{status:201});
    }
    const owned=await db.prepare("SELECT id FROM employee_tasks WHERE id=? AND employee_id=?").bind(taskId,employee.id).first();
    if(!owned)return Response.json({error:"المهمة غير موجودة"},{status:404});
    if(action==="toggle")await db.prepare("UPDATE employee_tasks SET is_completed=CASE is_completed WHEN 1 THEN 0 ELSE 1 END,updated_at=? WHERE id=?").bind(new Date().toISOString(),taskId).run();
    else if(action==="delete")await db.prepare("DELETE FROM employee_tasks WHERE id=?").bind(taskId).run();
    else return Response.json({error:"إجراء غير صحيح"},{status:400});
    return Response.json({ok:true});
  }catch(reason){return Response.json({error:reason instanceof Error?reason.message:"تعذر حفظ المهمة"},{status:500})}
}
