import { env } from "cloudflare:workers";
import { ensurePhaseTwo, normalizePhone } from "@/db/phase-two";
import { normalizeSourceName } from "@/lib/source-normalization";

export const dynamic = "force-dynamic";

function tokenFrom(request:Request){return request.headers.get("cookie")?.split(";").map((item)=>item.trim()).find((item)=>item.startsWith("masar_session="))?.slice("masar_session=".length)??""}
function scheduledWeekdays(startDate:string,roundTitle=""){const normalized=roundTitle.toLowerCase(),start=new Date(`${startDate.slice(0,10)}T12:00:00Z`),day=start.getUTCDay();if(/(?:intensive\s*1\s*day|1\s*day|one\s*day|يوم\s*واحد)/i.test(normalized))return new Set([5]);if(/(?:intensive\s*3\s*days|3\s*days|three\s*days|3\s*ايام|ثلاث)/i.test(normalized))return new Set([6,1,3].includes(day)?[6,1,3]:[0,2,4]);if(day===6||day===2)return new Set([6,2]);if(day===0||day===3)return new Set([0,3]);if(day===1||day===4)return new Set([1,4]);return new Set([5])}
function expectedSessionNumber(startDate:string,targetDate:string,roundTitle=""){if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate.slice(0,10))||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate.slice(0,10)))return 0;const start=new Date(`${startDate.slice(0,10)}T12:00:00Z`),target=new Date(`${targetDate.slice(0,10)}T12:00:00Z`);if(target<start)return 0;const weekdays=scheduledWeekdays(startDate,roundTitle);if(!weekdays.has(target.getUTCDay()))return 0;let count=0;for(const date=new Date(start);date<=target;date.setUTCDate(date.getUTCDate()+1))if(weekdays.has(date.getUTCDay()))count++;return count}
function scheduledSessionDates(startDate:string,roundTitle:string,lectureCount:number){if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate.slice(0,10)))return [] as string[];const weekdays=scheduledWeekdays(startDate,roundTitle),targetCount=Math.max(1,Number.isFinite(lectureCount)&&lectureCount>0?Math.floor(lectureCount):120),dates:string[]=[],cursor=new Date(`${startDate.slice(0,10)}T12:00:00Z`);for(let guard=0;dates.length<targetCount&&guard<1095;guard++,cursor.setUTCDate(cursor.getUTCDate()+1))if(weekdays.has(cursor.getUTCDay()))dates.push(cursor.toISOString().slice(0,10));return dates}
function clockMinutes(value:string){const match=value.match(/^(\d{1,2}):(\d{2})/);return match?Number(match[1])*60+Number(match[2]):Number.NaN}
function timesOverlap(firstStart:string,firstEnd:string,secondStart:string,secondEnd:string){const a=clockMinutes(firstStart),b=clockMinutes(firstEnd),c=clockMinutes(secondStart),d=clockMinutes(secondEnd);return [a,b,c,d].every(Number.isFinite)&&a<d&&c<b}
function cairoDateKey(value:string|Date){const date=value instanceof Date?value:new Date(value),parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date),part=(type:string)=>parts.find((item)=>item.type===type)?.value||"";return `${part("year")}-${part("month")}-${part("day")}`}
function zeroLevelPaymentType(title:string){const value=title.toLowerCase().replace(/[\s_-]+/g," ").trim();if(/material book|\bbooks?\b/.test(value))return "Books";if(/make up|makeup/.test(value))return "Make Up";if(/delivery|shipping|courier/.test(value))return "Delivery";if(/certificate/.test(value))return "Certificate";if(/placement/.test(value))return "Placement Test";if(/\bexam\b|\btest\b/.test(value))return "Test";return "Other"}

async function hashPassword(password: string) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function GET(request:Request) {
  try {
    await ensurePhaseTwo();
    const db = env.DB;
    const url=new URL(request.url),page=url.searchParams.get("page")||"",token=tokenFrom(request),session=token?await db.prepare("SELECT e.id,e.job_title_id AS jobTitleId,e.department_id AS departmentId,e.branch_id AS branchId FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token,new Date().toISOString()).first<{id:number;jobTitleId:number|null;departmentId:number|null;branchId:number|null}>():null,transferSummaryId=Number(url.searchParams.get("paymentTransferSummary"))||0;
    if(!session)return Response.json({error:"يجب تسجيل الدخول أولًا"},{status:401});
    if(transferSummaryId){if(!session)return Response.json({error:"يجب تسجيل الدخول أولًا"},{status:401});const receipt=await db.prepare("SELECT student_id AS studentId,custom_data AS customData FROM student_records WHERE id=? AND kind='payment'").bind(transferSummaryId).first<{studentId:number;customData:string}>();if(!receipt)return Response.json({error:"الإيصال غير موجود"},{status:404});let receiptDetails:Record<string,unknown>={};try{receiptDetails=JSON.parse(receipt.customData||"{}")}catch{}const main=String(receiptDetails.main||"");if(!main)return Response.json({error:"رقم الـMain غير موجود على الإيصال"},{status:409});const [payments,transfers]=await Promise.all([db.prepare("SELECT custom_data AS customData FROM student_records WHERE student_id=? AND kind='payment' AND json_extract(custom_data,'$.main')=?").bind(receipt.studentId,main).all<{customData:string}>(),db.prepare("SELECT custom_data AS customData FROM student_records WHERE kind='payment_transfer' AND CAST(json_extract(custom_data,'$.sourceStudentId') AS INTEGER)=? AND json_extract(custom_data,'$.main')=? AND status<>'Cancelled'").bind(receipt.studentId,main).all<{customData:string}>()]),mainPaidTotal=payments.results.reduce((sum,item)=>{try{const value=JSON.parse(item.customData||"{}") as Record<string,unknown>;return value.voided?sum:sum+Math.max(0,Number(value.paid||0)-Number(value.refunded||0))}catch{return sum}},0),transferredTotal=transfers.results.reduce((sum,item)=>{try{return sum+Number((JSON.parse(item.customData||"{}") as Record<string,unknown>).amount||0)}catch{return sum}},0);return Response.json({main,mainPaidTotal:Number(mainPaidTotal.toFixed(2)),transferredTotal:Number(transferredTotal.toFixed(2)),available:Number(Math.max(0,mainPaidTotal-transferredTotal).toFixed(2))})}
    const permissionRows=session?await db.prepare("SELECT page_key AS pageKey,can_view AS canView,data_scope AS dataScope FROM job_title_permissions WHERE job_title_id=?").bind(session.jobTitleId).all<{pageKey:string;canView:number;dataScope:string}>():{results:[]},studentCallPages=["studentMissingCalls","studentRemainingCalls","studentVisitorCalls","operationCalls"],pagePermission=page?(permissionRows.results.find((item)=>item.pageKey===page)||(page==="oralResults"?permissionRows.results.find((item)=>item.pageKey==="studentAttendance"):["studentsStatus","operationsRetention","retentionMoney","retentionTargets","operationsAbsenceReports","operationsAbsenceCalls",...studentCallPages].includes(page)?permissionRows.results.find((item)=>item.pageKey==="studentsList"):["mtd","adsSpendingTargets","leadsCallsReport","leadsReport","callsReport"].includes(page)?permissionRows.results.find((item)=>item.pageKey==="marketingExpenses"):["financialReports","studentTransfers","trackTransfers"].includes(page)?permissionRows.results.find((item)=>item.pageKey==="payments"):undefined)):undefined,legacyFullAccess=!permissionRows.results.length||permissionRows.results.every((item)=>Boolean(item.canView)),pageAllowed=!session||!page||(pagePermission?Boolean(pagePermission.canView):legacyFullAccess),dataScope=pagePermission?.dataScope||"all";
    const today=cairoDateKey(new Date()),monthStart=`${today.slice(0,7)}-01`,requestedFrom=url.searchParams.get("from")||"",requestedTo=url.searchParams.get("to")||"",paymentSearch=(url.searchParams.get("search")||"").trim(),paymentFrom=requestedFrom||(page==="payments"&&paymentSearch?"0000-01-01":["overview","financialReports","mtd","retentionMoney"].includes(page)?monthStart:today),paymentTo=requestedTo||(page==="payments"&&paymentSearch?"9999-12-31":today),studentSearch=paymentSearch.toLowerCase(),studentPhoneSearch=/\d{8,}/.test(studentSearch)?normalizePhone(studentSearch):"",studentLevel=url.searchParams.get("level")||"",studentBranch=url.searchParams.get("branch")||"",studentStatus=url.searchParams.get("status")||"",hasStudentFilters=Boolean(requestedFrom||requestedTo||studentSearch||studentLevel||studentBranch||studentStatus),studentDateFrom=requestedFrom|| (hasStudentFilters?"0000-01-01":today),studentDateTo=requestedTo|| (hasStudentFilters?"9999-12-31":today),studentListWhere=`s.created_at>=? AND s.created_at<? AND (?='' OR LOWER(s.full_name) LIKE ? OR s.mobile LIKE ? OR s.secondary_mobile LIKE ? OR LOWER(COALESCE(s.email,'')) LIKE ? OR LOWER(COALESCE(json_extract(s.custom_data,'$.createdBy'),'')) LIKE ?) AND (?='' OR CAST(s.level_id AS TEXT)=?) AND (?='' OR CAST(s.branch_id AS TEXT)=?) AND (?='' OR s.status=?)`,studentListBindings=[studentDateFrom,`${studentDateTo}~`,studentSearch,`%${studentSearch}%`,`%${studentPhoneSearch||studentSearch}%`,`%${studentPhoneSearch||studentSearch}%`,`%${studentSearch}%`,`%${studentSearch}%`,studentLevel,studentLevel,studentBranch,studentBranch,studentStatus,studentStatus];
    const studentRecordCustomData=page==="mtd"?`json_object('isMainPayment',json_extract(sr.custom_data,'$.isMainPayment'),'levels',json_extract(sr.custom_data,'$.levels'),'paymentType',json_extract(sr.custom_data,'$.paymentType'),'main',json_extract(sr.custom_data,'$.main'),'paid',json_extract(sr.custom_data,'$.paid'),'refunded',json_extract(sr.custom_data,'$.refunded'),'netPaid',json_extract(sr.custom_data,'$.netPaid'),'total',json_extract(sr.custom_data,'$.total'),'trackId',json_extract(sr.custom_data,'$.trackId'),'track',json_extract(sr.custom_data,'$.track'),'trackName',json_extract(sr.custom_data,'$.trackName'),'branchId',json_extract(sr.custom_data,'$.branchId'),'branch',json_extract(sr.custom_data,'$.branch'),'branchName',json_extract(sr.custom_data,'$.branchName'),'voided',json_extract(sr.custom_data,'$.voided'))`:`sr.custom_data`;
    const transferExcludedReportPages=new Set(["overview","mtd","leadsCallsReport","leadsReport","callsReport","financialReports","retentionMoney","operationsRetention","operationsAbsenceReports","operationsAbsenceCalls"]),incomingTransferPayment=`lower(trim(COALESCE(json_extract(sr.custom_data,'$.method'),''))) IN ('transferred from another track','transferred from another student')`,studentRecordSelect=`SELECT sr.id, sr.student_id AS studentId, s.full_name AS studentName, sr.kind, sr.record_date AS recordDate, sr.status, ${page==="mtd"?"''":"sr.notes"} AS notes, ${studentRecordCustomData} AS customData, sr.created_at AS createdAt FROM student_records sr JOIN students s ON s.id=sr.student_id${transferExcludedReportPages.has(page)?` AND NOT (${incomingTransferPayment})`:""}`;
    const recordlessPages=new Set(["employeeProfile","departments","jobs","employees","employeeSchedule","permissions","forms","settings","classes","tracks","sources","adminSettings","offers","paymentMethods","timeSystem","rounds","studyTypes","levels","batches","setupCards","exams","marketingExpenses","adsSpendingTargets","retentionTargets","leads","inboundCalls","leadSequence","followups","receivedFollowups","callCenterCalls"]);
    let studentRecordsRequest;
    if(["groups","utilization","groupUtilization","floorSchedule","scheduleFinal","studentAttendance","studentAbsence","oralResults"].includes(page))studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE 1=0`).all();
    else if(page==="payments")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ? ORDER BY sr.record_date DESC,sr.id DESC`).bind(paymentFrom,paymentTo).all();
    else if(page==="overview")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE (sr.kind='payment' AND (substr(sr.record_date,1,10) BETWEEN ? AND ? OR sr.student_id IN (SELECT s2.id FROM students s2 WHERE substr(s2.created_at,1,10) BETWEEN ? AND ?))) OR (sr.kind='attendance' AND sr.status='Absent' AND (substr(sr.record_date,1,10) BETWEEN ? AND ? OR EXISTS (SELECT 1 FROM json_each(sr.custom_data,'$.callWorkflow.history') workflow WHERE substr(json_extract(workflow.value,'$.updatedAt'),1,10) BETWEEN ? AND ?))) ORDER BY sr.record_date DESC,sr.id DESC`).bind(paymentFrom,paymentTo,paymentFrom,paymentTo,paymentFrom,paymentTo,paymentFrom,paymentTo).all();
    else if(page==="mtd")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='payment' AND (substr(sr.record_date,1,10) BETWEEN ? AND ? OR (json_extract(sr.custom_data,'$.isMainPayment')=1 AND sr.student_id IN (SELECT selected_period.student_id FROM student_records selected_period WHERE selected_period.kind='payment' AND json_extract(selected_period.custom_data,'$.isMainPayment')=1 AND substr(selected_period.record_date,1,10) BETWEEN ? AND ?))) ORDER BY sr.record_date DESC,sr.id DESC`).bind(paymentFrom,paymentTo,paymentFrom,paymentTo).all();
    else if(["leadsCallsReport","leadsReport","callsReport"].includes(page))studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='payment' ORDER BY sr.record_date DESC,sr.id DESC`).all();
    else if(page==="financialReports")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind IN ('payment','payment_transfer') AND substr(sr.record_date,1,10) BETWEEN ? AND ? ORDER BY sr.record_date DESC,sr.id DESC`).bind(paymentFrom,paymentTo).all();
    else if(page==="retentionMoney")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='payment' AND sr.student_id IN (SELECT DISTINCT current_period.student_id FROM student_records current_period WHERE current_period.kind='payment' AND substr(current_period.record_date,1,10) BETWEEN ? AND ?) ORDER BY sr.record_date DESC,sr.id DESC`).bind(paymentFrom,paymentTo).all();
    else if(page==="operationsRetention")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='payment' AND sr.student_id IN (SELECT DISTINCT CAST(student_reference AS INTEGER) FROM group_members) ORDER BY sr.record_date DESC,sr.id DESC`).all();
    else if(page==="operationsAbsenceReports"||page==="operationsAbsenceCalls")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='attendance' AND sr.status='Absent' ORDER BY sr.record_date DESC,sr.id DESC`).all();
    else if(page==="debtors"||page==="debtInstallments")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='payment' AND json_extract(sr.custom_data,'$.isMainPayment')=1 AND COALESCE(CAST(json_extract(sr.custom_data,'$.due') AS REAL),0)>0 ORDER BY sr.record_date DESC,sr.id DESC`).all();
    else if(page==="debtReset")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='payment' AND json_type(sr.custom_data,'$.debtReset') IS NOT NULL ORDER BY sr.record_date DESC,sr.id DESC`).all();
    else if(page==="refunds")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='payment' AND (json_type(sr.custom_data,'$.refunds') IS NOT NULL OR json_type(sr.custom_data,'$.refundHistory') IS NOT NULL) ORDER BY sr.record_date DESC,sr.id DESC`).all();
    else if(page==="studentTransfers"||page==="trackTransfers")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='payment_transfer' AND json_extract(sr.custom_data,'$.transferType')=? ORDER BY sr.record_date DESC,sr.id DESC`).bind(page==="studentTransfers"?"student":"track").all();
    else if(page==="studentsList")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind IN ('payment','placement') AND sr.student_id IN (SELECT s.id FROM students s WHERE ${studentListWhere}) ORDER BY sr.record_date DESC,sr.id DESC`).bind(...studentListBindings).all();
    else if(page==="studentVisitorCalls")studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind='student_call_task' AND json_extract(sr.custom_data,'$.callTaskType')='visitor' ORDER BY sr.record_date DESC,sr.id DESC`).all();
    else if(studentCallPages.includes(page))studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE sr.kind IN ('payment','student_call_task') ORDER BY sr.record_date DESC,sr.id DESC`).all();
    else if(recordlessPages.has(page))studentRecordsRequest=db.prepare(`${studentRecordSelect} WHERE 1=0`).all();
    else studentRecordsRequest=db.prepare(`${studentRecordSelect} ORDER BY sr.record_date DESC,sr.id DESC`).all();
    const studentSelect=`SELECT s.id, s.full_name AS fullName, s.mobile, s.secondary_mobile AS secondaryMobile, ${page==="mtd"?"''":"s.email"} AS email, s.level_id AS levelId, l.title AS levelName, s.track_id AS trackId, t.title AS trackName, s.branch_id AS branchId, b.name AS branchName, s.status, ${page==="mtd"?"'{}'":"s.custom_data"} AS customData, s.created_at AS createdAt FROM students s LEFT JOIN settings_entities l ON l.id=s.level_id LEFT JOIN tracks t ON t.id=s.track_id LEFT JOIN branches b ON b.id=s.branch_id`;
    let studentsRequest,groupMembersRequest;
    if(page==="mtd"){
      studentsRequest=db.prepare(`${studentSelect} WHERE substr(s.created_at,1,10) BETWEEN ? AND ? OR EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ?) ORDER BY s.id DESC`).bind(paymentFrom,paymentTo,paymentFrom,paymentTo).all();
      groupMembersRequest=db.prepare("SELECT id,group_id AS groupId,0 AS studentId,'' AS joinedAt,NULL AS addedByEmployeeId,'' AS addedByName,'' AS fullName,'' AS mobile,0 AS levelId FROM group_members WHERE 1=0").all();
    }else if(page==="overview"){
      studentsRequest=db.prepare(`${studentSelect} WHERE substr(s.created_at,1,10) BETWEEN ? AND ? OR EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND ((sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ?) OR (sr.kind='attendance' AND sr.status='Absent' AND (substr(sr.record_date,1,10) BETWEEN ? AND ? OR EXISTS (SELECT 1 FROM json_each(sr.custom_data,'$.callWorkflow.history') workflow WHERE substr(json_extract(workflow.value,'$.updatedAt'),1,10) BETWEEN ? AND ?))))) OR substr(json_extract(s.custom_data,'$.retentionWorkflow.updatedAt'),1,10) BETWEEN ? AND ? OR EXISTS (SELECT 1 FROM json_each(s.custom_data,'$.retentionNonRenewal.history') retention WHERE substr(json_extract(retention.value,'$.updatedAt'),1,10) BETWEEN ? AND ?) ORDER BY s.id DESC`).bind(paymentFrom,paymentTo,paymentFrom,paymentTo,paymentFrom,paymentTo,paymentFrom,paymentTo,paymentFrom,paymentTo,paymentFrom,paymentTo).all();
      groupMembersRequest=db.prepare("SELECT id,group_id AS groupId,0 AS studentId,'' AS joinedAt,NULL AS addedByEmployeeId,'' AS addedByName,'' AS fullName,'' AS mobile,0 AS levelId FROM group_members WHERE 1=0").all();
    }else if(["leadsCallsReport","leadsReport","callsReport"].includes(page)){
      studentsRequest=db.prepare(`${studentSelect} WHERE EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND sr.kind='payment') OR COALESCE(json_array_length(json_extract(s.custom_data,'$.linkedLeadIds')),0)>0 OR COALESCE(json_array_length(json_extract(s.custom_data,'$.linkedCallIds')),0)>0 ORDER BY s.id DESC`).all();
      groupMembersRequest=db.prepare("SELECT id,group_id AS groupId,0 AS studentId,'' AS joinedAt,NULL AS addedByEmployeeId,'' AS addedByName,'' AS fullName,'' AS mobile,0 AS levelId FROM group_members WHERE 1=0").all();
    }else if(["groups","utilization","groupUtilization","floorSchedule","scheduleFinal","studentAttendance","studentAbsence","oralResults"].includes(page)){
      studentsRequest=db.prepare(`${studentSelect} WHERE s.id IN (SELECT CAST(student_reference AS INTEGER) FROM group_members) ORDER BY s.id DESC`).all();
      groupMembersRequest=db.prepare(`SELECT gm.id, gm.group_id AS groupId, CAST(gm.student_reference AS INTEGER) AS studentId, gm.joined_at AS joinedAt, gm.added_by_employee_id AS addedByEmployeeId, COALESCE(NULLIF(gm.added_by_name,''),creator.full_name,'') AS addedByName, s.full_name AS fullName, s.mobile, s.level_id AS levelId FROM group_members gm JOIN students s ON s.id=CAST(gm.student_reference AS INTEGER) LEFT JOIN employees creator ON creator.id=gm.added_by_employee_id ORDER BY gm.joined_at DESC`).all();
    }else if(page==="payments"){
      studentsRequest=db.prepare(`${studentSelect} WHERE EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ?) ORDER BY s.id DESC`).bind(paymentFrom,paymentTo).all();
      groupMembersRequest=db.prepare(`SELECT gm.id, gm.group_id AS groupId, CAST(gm.student_reference AS INTEGER) AS studentId, gm.joined_at AS joinedAt, gm.added_by_employee_id AS addedByEmployeeId, COALESCE(NULLIF(gm.added_by_name,''),creator.full_name,'') AS addedByName, s.full_name AS fullName, s.mobile, s.level_id AS levelId FROM group_members gm JOIN students s ON s.id=CAST(gm.student_reference AS INTEGER) LEFT JOIN employees creator ON creator.id=gm.added_by_employee_id WHERE EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ?) ORDER BY gm.joined_at DESC`).bind(paymentFrom,paymentTo).all();
    }else if(page==="financialReports"){
      studentsRequest=db.prepare(`${studentSelect} WHERE EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ?) ORDER BY s.id DESC`).bind(paymentFrom,paymentTo).all();
      groupMembersRequest=db.prepare("SELECT id,group_id AS groupId,0 AS studentId,'' AS joinedAt,NULL AS addedByEmployeeId,'' AS addedByName,'' AS fullName,'' AS mobile,0 AS levelId FROM group_members WHERE 1=0").all();
    }else if(page==="retentionMoney"){
      studentsRequest=db.prepare(`${studentSelect} WHERE EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ?) ORDER BY s.id DESC`).bind(paymentFrom,paymentTo).all();
      groupMembersRequest=db.prepare(`SELECT gm.id, gm.group_id AS groupId, CAST(gm.student_reference AS INTEGER) AS studentId, gm.joined_at AS joinedAt, gm.added_by_employee_id AS addedByEmployeeId, COALESCE(NULLIF(gm.added_by_name,''),creator.full_name,'') AS addedByName, s.full_name AS fullName, s.mobile, s.level_id AS levelId FROM group_members gm JOIN students s ON s.id=CAST(gm.student_reference AS INTEGER) LEFT JOIN employees creator ON creator.id=gm.added_by_employee_id WHERE EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ?) ORDER BY gm.joined_at DESC`).bind(paymentFrom,paymentTo).all();
    }else if(page==="operationsRetention"){
      studentsRequest=db.prepare(`${studentSelect} WHERE s.id IN (SELECT DISTINCT CAST(gm.student_reference AS INTEGER) FROM group_members gm WHERE CAST(gm.student_reference AS INTEGER) IN (SELECT DISTINCT student_id FROM student_records WHERE kind='payment')) ORDER BY s.id DESC`).all();
      groupMembersRequest=db.prepare(`SELECT gm.id, gm.group_id AS groupId, CAST(gm.student_reference AS INTEGER) AS studentId, gm.joined_at AS joinedAt, gm.added_by_employee_id AS addedByEmployeeId, COALESCE(NULLIF(gm.added_by_name,''),creator.full_name,'') AS addedByName, s.full_name AS fullName, s.mobile, s.level_id AS levelId FROM group_members gm JOIN students s ON s.id=CAST(gm.student_reference AS INTEGER) LEFT JOIN employees creator ON creator.id=gm.added_by_employee_id WHERE CAST(gm.student_reference AS INTEGER) IN (SELECT DISTINCT student_id FROM student_records WHERE kind='payment') ORDER BY gm.joined_at DESC`).all();
    }else if(page==="operationsAbsenceReports"||page==="operationsAbsenceCalls"){
      studentsRequest=db.prepare(`${studentSelect} WHERE EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND sr.kind='attendance' AND sr.status='Absent') ORDER BY s.id DESC`).all();
      groupMembersRequest=db.prepare("SELECT id,group_id AS groupId,0 AS studentId,'' AS joinedAt,NULL AS addedByEmployeeId,'' AS addedByName,'' AS fullName,'' AS mobile,0 AS levelId FROM group_members WHERE 1=0").all();
    }else if(page==="studentsList"){
      studentsRequest=db.prepare(`${studentSelect} WHERE ${studentListWhere} ORDER BY s.created_at DESC,s.id DESC LIMIT 1000`).bind(...studentListBindings).all();
      groupMembersRequest=db.prepare("SELECT id,group_id AS groupId,0 AS studentId,'' AS joinedAt,NULL AS addedByEmployeeId,'' AS addedByName,'' AS fullName,'' AS mobile,0 AS levelId FROM group_members WHERE 1=0").all();
    }else if(page==="studentVisitorCalls"){
      const activePaidLevels=`sr.kind='payment' AND json_extract(sr.custom_data,'$.isMainPayment')=1 AND COALESCE(json_extract(sr.custom_data,'$.voided'),0)<>1 AND (COALESCE(CAST(json_extract(sr.custom_data,'$.levels') AS REAL),0)-COALESCE(CAST(json_extract(sr.custom_data,'$.refundedLevels') AS REAL),0)-COALESCE(CAST(json_extract(sr.custom_data,'$.transferredLevels') AS REAL),0))>0`;
      studentsRequest=db.prepare(`${studentSelect} WHERE NOT EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND ${activePaidLevels}) AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE CAST(gm.student_reference AS INTEGER)=s.id) ORDER BY s.created_at DESC,s.id DESC`).all();
      groupMembersRequest=db.prepare("SELECT id,group_id AS groupId,0 AS studentId,'' AS joinedAt,NULL AS addedByEmployeeId,'' AS addedByName,'' AS fullName,'' AS mobile,0 AS levelId FROM group_members WHERE 1=0").all();
    }else if(studentCallPages.includes(page)){
      studentsRequest=db.prepare(`${studentSelect} ORDER BY s.created_at DESC,s.id DESC`).all();
      groupMembersRequest=db.prepare(`SELECT gm.id, gm.group_id AS groupId, CAST(gm.student_reference AS INTEGER) AS studentId, gm.joined_at AS joinedAt, gm.added_by_employee_id AS addedByEmployeeId, COALESCE(NULLIF(gm.added_by_name,''),creator.full_name,'') AS addedByName, s.full_name AS fullName, s.mobile, s.level_id AS levelId FROM group_members gm JOIN students s ON s.id=CAST(gm.student_reference AS INTEGER) LEFT JOIN employees creator ON creator.id=gm.added_by_employee_id ORDER BY gm.joined_at DESC`).all();
    }else if(page==="studentTransfers"||page==="trackTransfers"){
      studentsRequest=db.prepare(`${studentSelect} WHERE EXISTS (SELECT 1 FROM student_records sr WHERE sr.student_id=s.id AND sr.kind='payment_transfer' AND json_extract(sr.custom_data,'$.transferType')=?) OR EXISTS (SELECT 1 FROM student_records sr WHERE sr.kind='payment_transfer' AND CAST(json_extract(sr.custom_data,'$.targetStudentId') AS INTEGER)=s.id AND json_extract(sr.custom_data,'$.transferType')=?) ORDER BY s.id DESC`).bind(page==="studentTransfers"?"student":"track",page==="studentTransfers"?"student":"track").all();groupMembersRequest=db.prepare("SELECT id,group_id AS groupId,0 AS studentId,'' AS joinedAt,NULL AS addedByEmployeeId,'' AS addedByName,'' AS fullName,'' AS mobile,0 AS levelId FROM group_members WHERE 1=0").all();
    }else if(recordlessPages.has(page)){
      studentsRequest=db.prepare(`${studentSelect} WHERE 1=0`).all();groupMembersRequest=db.prepare("SELECT id,group_id AS groupId,0 AS studentId,'' AS joinedAt,NULL AS addedByEmployeeId,'' AS addedByName,'' AS fullName,'' AS mobile,0 AS levelId FROM group_members WHERE 1=0").all();
    }else{
      studentsRequest=db.prepare(`${studentSelect} ORDER BY s.id DESC`).all();groupMembersRequest=db.prepare(`SELECT gm.id, gm.group_id AS groupId, CAST(gm.student_reference AS INTEGER) AS studentId, gm.joined_at AS joinedAt, gm.added_by_employee_id AS addedByEmployeeId, COALESCE(NULLIF(gm.added_by_name,''),creator.full_name,'') AS addedByName, s.full_name AS fullName, s.mobile, s.level_id AS levelId FROM group_members gm JOIN students s ON s.id=CAST(gm.student_reference AS INTEGER) LEFT JOIN employees creator ON creator.id=gm.added_by_employee_id ORDER BY gm.joined_at DESC`).all();
    }
    const paymentSummaryPage=page==="payments"||page==="financialReports"||page==="mtd"||["leadsCallsReport","leadsReport","callsReport"].includes(page);
    const settingsEntitiesRequest=page==="payments"
      ?db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, 0 AS studentCount FROM settings_entities se WHERE se.kind='payment_method' OR (se.kind='group' AND se.id IN (SELECT DISTINCT gm.group_id FROM group_members gm WHERE CAST(gm.student_reference AS INTEGER) IN (SELECT DISTINCT sr.student_id FROM student_records sr WHERE sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ?))) OR (se.kind='education_batch' AND se.id IN (SELECT DISTINCT CAST(json_extract(g.custom_data,'$.batchId') AS INTEGER) FROM settings_entities g JOIN group_members gm ON gm.group_id=g.id WHERE g.kind='group' AND CAST(gm.student_reference AS INTEGER) IN (SELECT DISTINCT sr.student_id FROM student_records sr WHERE sr.kind='payment' AND substr(sr.record_date,1,10) BETWEEN ? AND ?))) ORDER BY se.kind,se.title`).bind(paymentFrom,paymentTo,paymentFrom,paymentTo).all()
      :page==="mtd"
        ?db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, 0 AS studentCount FROM settings_entities se WHERE (se.kind='marketing_expense' AND se.is_active=1 AND substr(json_extract(se.custom_data,'$.expenseDate'),1,10) BETWEEN ? AND ?) OR se.kind IN ('source','offer') ORDER BY se.kind,json_extract(se.custom_data,'$.expenseDate'),se.title,se.id`).bind(paymentFrom,paymentTo).all()
      :page==="overview"
        ?db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, 0 AS studentCount FROM settings_entities se WHERE se.kind IN ('call_result','source','offer') OR (se.kind='marketing_expense' AND se.is_active=1 AND substr(json_extract(se.custom_data,'$.expenseDate'),1,10) BETWEEN ? AND ?) ORDER BY se.kind,se.title`).bind(paymentFrom,paymentTo).all()
      :page==="financialReports"
        ?db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, 0 AS studentCount FROM settings_entities se WHERE 1=0`).all()
      :["groups","utilization","groupUtilization","floorSchedule","scheduleFinal","studentAttendance","studentAbsence","oralResults"].includes(page)
        ?db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, CASE WHEN se.kind='group' THEN (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=se.id) ELSE 0 END AS studentCount FROM settings_entities se WHERE se.kind IN ('group','office_hours') ORDER BY se.kind, se.title`).all()
      :page==="operationsRetention"
        ?db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, 0 AS studentCount FROM settings_entities se WHERE se.kind='retention_nonrenewal_reason' OR (se.kind='education_batch' AND se.is_active=1 AND LOWER(COALESCE(json_extract(se.custom_data,'$.batchStatus'),''))='current batch') OR (se.kind='group' AND se.id IN (SELECT DISTINCT gm.group_id FROM group_members gm WHERE CAST(gm.student_reference AS INTEGER) IN (SELECT DISTINCT student_id FROM student_records WHERE kind='payment'))) ORDER BY se.kind,se.title`).all()
        :page==="operationsAbsenceReports"||page==="operationsAbsenceCalls"
          ?db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, 0 AS studentCount FROM settings_entities se WHERE 1=0`).all()
          :page==="studentVisitorCalls"
            ?db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, 0 AS studentCount FROM settings_entities se WHERE se.kind IN ('visitor_call_reason','call_result') ORDER BY se.kind,se.title`).all()
        :db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, CASE WHEN se.kind='group' THEN (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=se.id) ELSE 0 END AS studentCount FROM settings_entities se WHERE se.kind<>'marketing_expense' OR se.is_active=1 ORDER BY se.kind, se.title`).all();
    const lightweightPage=paymentSummaryPage||page=="overview"||page=="operationsRetention"||page=="operationsAbsenceReports"||page=="operationsAbsenceCalls"||studentCallPages.includes(page)||["groups","utilization","groupUtilization","floorSchedule","scheduleFinal","studentAttendance","studentAbsence","oralResults"].includes(page);
    const formsRequest=lightweightPage?db.prepare(`SELECT f.id AS formId, f.form_key AS formKey, f.name AS formName, f.version, ff.id, ff.field_key AS fieldKey, ff.label, ff.type, ff.placeholder, ff.required, ff.visible, ff.sort_order AS sortOrder, ff.options_json AS optionsJson, ff.width FROM form_definitions f JOIN form_fields ff ON ff.form_id=f.id WHERE 1=0`).all():db.prepare(`SELECT f.id AS formId, f.form_key AS formKey, f.name AS formName, f.version, ff.id, ff.field_key AS fieldKey, ff.label, ff.type, ff.placeholder, ff.required, ff.visible, ff.sort_order AS sortOrder, ff.options_json AS optionsJson, ff.width FROM form_definitions f JOIN form_fields ff ON ff.form_id=f.id ORDER BY f.form_key, ff.sort_order`).all();
    const systemLogsRequest=lightweightPage?db.prepare(`SELECT id,action,actor_id AS actorId,actor_name AS actorName,subject_type AS subjectType,subject_id AS subjectId,subject_reference AS subjectReference,details,created_at AS createdAt FROM system_logs WHERE 1=0`).all():db.prepare(`SELECT id,action,actor_id AS actorId,actor_name AS actorName,subject_type AS subjectType,subject_id AS subjectId,subject_reference AS subjectReference,details,created_at AS createdAt FROM system_logs ORDER BY id DESC LIMIT 1000`).all();
    const [departments, jobTitles, roles, jobTitlePermissions, employees, branches, classrooms, tracks, timeSlots, settingsEntities, forms, students, groupMembers, studentRecords, systemLogs] = await Promise.all([
      db.prepare("SELECT d.id, d.name, d.color, d.parent_id AS parentId, d.support_enabled AS supportEnabled, d.is_active AS isActive, p.name AS parentName, (SELECT COUNT(*) FROM job_titles j WHERE j.department_id=d.id) AS jobCount FROM departments d LEFT JOIN departments p ON p.id=d.parent_id ORDER BY d.id").all(),
      db.prepare("SELECT j.id, j.name, j.department_id AS departmentId, j.reports_to_id AS reportsToId, d.name AS department, manager.name AS reportsToName FROM job_titles j LEFT JOIN departments d ON d.id=j.department_id LEFT JOIN job_titles manager ON manager.id=j.reports_to_id ORDER BY d.name, j.name").all(),
      db.prepare("SELECT id, name, description FROM roles ORDER BY id").all(),
      db.prepare("SELECT job_title_id AS jobTitleId, page_key AS pageKey, can_view AS canView, can_add AS canAdd, can_edit AS canEdit, can_delete AS canDelete, data_scope AS dataScope FROM job_title_permissions ORDER BY job_title_id, page_key").all(),
      db.prepare(`SELECT e.id, e.hr_id AS hrId, e.full_name AS fullName, e.email, e.phone, e.status, e.custom_data AS customData, e.department_id AS departmentId, e.job_title_id AS jobTitleId, e.role_id AS roleId, e.branch_id AS branchId, d.name AS department, j.name AS jobTitle, r.name AS role, b.name AS branchName FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN roles r ON r.id=e.role_id LEFT JOIN branches b ON b.id=e.branch_id ORDER BY e.id DESC`).all(),
      db.prepare(`SELECT b.id, b.name, b.address, b.primary_phone AS primaryPhone, b.secondary_phone AS secondaryPhone, b.email, b.social_url AS socialUrl, b.is_active AS isActive, b.custom_data AS customData, (SELECT COUNT(*) FROM employees e WHERE e.branch_id=b.id) AS employeeCount, (SELECT COUNT(*) FROM leads l WHERE l.branch_id=b.id) AS leadCount, (SELECT COUNT(*) FROM call_records c WHERE c.branch_id=b.id) AS callCount FROM branches b ORDER BY b.id`).all(),
      db.prepare(`SELECT c.id, c.branch_id AS branchId, b.name AS branchName, c.name, c.capacity, c.is_active AS isActive, c.custom_data AS customData FROM classrooms c JOIN branches b ON b.id=c.branch_id ORDER BY b.name, c.name`).all(),
      db.prepare(`SELECT id, title, is_active AS isActive, custom_data AS customData FROM tracks ORDER BY title`).all(),
      db.prepare(`SELECT ts.id, ts.track_id AS trackId, t.title AS trackName, ts.title, ts.start_time AS startTime, ts.end_time AS endTime, ts.is_active AS isActive, ts.custom_data AS customData FROM time_slots ts LEFT JOIN tracks t ON t.id=ts.track_id ORDER BY t.title, ts.start_time`).all(),
      settingsEntitiesRequest,
      formsRequest,
      studentsRequest,
      groupMembersRequest,
      studentRecordsRequest,
      systemLogsRequest,
    ]);
    if(!pageAllowed)return Response.json({departments:[],jobTitles:[],roles:[],jobTitlePermissions:jobTitlePermissions.results,employees:[],branches:[],classrooms:[],tracks:[],timeSlots:[],settingsEntities:[],students:[],groupMembers:[],studentRecords:[],systemLogs:[],fields:[],branchFields:[],classroomFields:[],trackFields:[],timeSlotFields:[],catalogFields:{}});
    let employeeRows=employees.results as Array<Record<string,unknown>>,settingRows=settingsEntities.results as Array<Record<string,unknown>>,studentRows=students.results as Array<Record<string,unknown>>,memberRows=groupMembers.results as Array<Record<string,unknown>>,recordRows=studentRecords.results as Array<Record<string,unknown>>,logRows=systemLogs.results as Array<Record<string,unknown>>;
    if(session&&dataScope!=="all"){
      const allEmployees=employeeRows,employeeById=(id:unknown)=>allEmployees.find((item)=>Number(item.id)===Number(id)),employeeMatches=(id:unknown)=>{const employee=employeeById(id);if(!employee)return false;if(dataScope==="own")return Number(employee.id)===session.id;if(dataScope==="branch")return Boolean(session.branchId)&&Number(employee.branchId)===session.branchId;return Boolean(session.departmentId)&&Number(employee.departmentId)===session.departmentId};
      const parse=(value:unknown)=>{try{return JSON.parse(String(value||"{}")) as Record<string,unknown>}catch{return {}}},leadOwners=await db.prepare("SELECT id,assigned_employee_id AS assignedEmployeeId FROM leads").all<{id:number;assignedEmployeeId:number|null}>(),leadOwnerById=new Map(leadOwners.results.map((item)=>[item.id,item.assignedEmployeeId]));
      const studentMatches=(student:Record<string,unknown>)=>{const details=parse(student.customData),creatorId=Number(details.createdById)||0,linkedLeadIds=(Array.isArray(details.linkedLeadIds)?details.linkedLeadIds:[]).map(Number);if(dataScope==="branch")return Boolean(session.branchId)&&Number(student.branchId)===session.branchId;if(dataScope==="own")return creatorId===session.id||linkedLeadIds.some((id)=>Number(leadOwnerById.get(id))===session.id);return employeeMatches(creatorId)||linkedLeadIds.some((id)=>employeeMatches(leadOwnerById.get(id)))};
      const groupMatches=(group:Record<string,unknown>)=>{const details=parse(group.customData);if(dataScope==="branch")return Boolean(session.branchId)&&Number(details.branchId)===session.branchId;if(dataScope==="own")return Number(details.teacherId)===session.id||Number(details.adminId)===session.id;return employeeMatches(details.teacherId)||employeeMatches(details.adminId)};
      if(page==="employees")employeeRows=employeeRows.filter((item)=>employeeMatches(item.id));
      if(page==="groups"||page==="utilization"||page==="groupUtilization"||page==="floorSchedule"||page==="scheduleFinal"||page==="studentAttendance"||page==="studentAbsence"||page==="oralResults"){
        const visibleGroups=settingRows.filter((item)=>item.kind==="group"&&groupMatches(item)),groupIds=new Set(visibleGroups.map((item)=>Number(item.id)));settingRows=settingRows.filter((item)=>item.kind==="group"?groupIds.has(Number(item.id)):item.kind==="office_hours"?groupMatches(item):true);memberRows=memberRows.filter((item)=>groupIds.has(Number(item.groupId)));const studentIds=new Set(memberRows.map((item)=>Number(item.studentId)));studentRows=studentRows.filter((item)=>studentIds.has(Number(item.id)));recordRows=recordRows.filter((item)=>page==="groups"||page==="utilization"||page==="groupUtilization"||page==="floorSchedule"||page==="scheduleFinal"?studentIds.has(Number(item.studentId)):page==="studentAttendance"?studentIds.has(Number(item.studentId))&&["attendance","misplaced","oral","lesson_evaluation","supervisor_report"].includes(String(item.kind)):page==="oralResults"?item.kind==="oral"&&groupIds.has(Number(parse(item.customData).groupId)):item.kind==="attendance"&&groupIds.has(Number(parse(item.customData).groupId)));logRows=logRows.filter((item)=>item.subjectType!=="student"||studentIds.has(Number(item.subjectId)));
      }else if(["studentsList","studentPlacement","studentComplaints","studentInformations","studentMisplaced","studentReported","studentsStatus","operationsRetention","retentionMoney","operationsAbsenceReports","operationsAbsenceCalls","studentTransfers","trackTransfers",...studentCallPages].includes(page)||page==="overview"){
        studentRows=studentRows.filter(studentMatches);const studentIds=new Set(studentRows.map((item)=>Number(item.id)));memberRows=memberRows.filter((item)=>studentIds.has(Number(item.studentId)));recordRows=recordRows.filter((item)=>studentIds.has(Number(item.studentId)));logRows=logRows.filter((item)=>item.subjectType!=="student"||studentIds.has(Number(item.subjectId)));if(page==="overview"){employeeRows=employeeRows.filter((item)=>employeeMatches(item.id));settingRows=settingRows.filter((item)=>{if(item.kind!=="marketing_expense")return true;const details=parse(item.customData);if(dataScope==="own")return Number(details.createdById)===session.id;if(dataScope==="branch")return Boolean(session.branchId)&&Number(details.branchId)===session.branchId;return employeeMatches(details.createdById)})}
      }else if(page==="marketingExpenses"||page==="mtd"){
        settingRows=settingRows.filter((item)=>{if(item.kind!=="marketing_expense")return true;const details=parse(item.customData);if(dataScope==="own")return Number(details.createdById)===session.id;if(dataScope==="branch")return Boolean(session.branchId)&&Number(details.branchId)===session.branchId;return employeeMatches(details.createdById)});
      }else if(["leadsCallsReport","leadsReport","callsReport"].includes(page)){
        studentRows=studentRows.filter(studentMatches);const studentIds=new Set(studentRows.map((item)=>Number(item.id)));recordRows=recordRows.filter((item)=>studentIds.has(Number(item.studentId)));
      }
    }
    return Response.json({ departments: departments.results, jobTitles: jobTitles.results, roles: roles.results, jobTitlePermissions: jobTitlePermissions.results, employees: employeeRows, branches: branches.results, classrooms: classrooms.results, tracks: tracks.results, timeSlots: timeSlots.results, settingsEntities: settingRows, students:studentRows, groupMembers:memberRows, studentRecords:recordRows, systemLogs:logRows, fields: forms.results.filter((field) => field.formKey === "employee"), branchFields: forms.results.filter((field) => field.formKey === "branch"), classroomFields: forms.results.filter((field) => field.formKey === "classroom"), trackFields: forms.results.filter((field) => field.formKey === "track"), timeSlotFields: forms.results.filter((field) => field.formKey === "time_slot"), catalogFields: Object.fromEntries(["round","study_type","level","education_batch","group","setup_card","exam"].map((key)=>[key,forms.results.filter((field)=>field.formKey===key)])) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر تحميل البيانات" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensurePhaseTwo();
    const db = env.DB;
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const token=tokenFrom(request),sessionEmployee=token?await db.prepare("SELECT e.id,e.full_name AS fullName,e.job_title_id AS jobTitleId,e.branch_id AS branchId,b.name AS branchName FROM employee_sessions s JOIN employees e ON e.id=s.employee_id LEFT JOIN branches b ON b.id=e.branch_id WHERE s.token=? AND s.expires_at>? LIMIT 1").bind(token,new Date().toISOString()).first<{id:number;fullName:string;jobTitleId:number|null;branchId:number|null;branchName:string|null}>():null;
    if(!sessionEmployee)return Response.json({error:"يجب تسجيل الدخول أولًا"},{status:401});
    const permissionTarget=async():Promise<{page:string;capability:"can_add"|"can_edit"|"can_delete"}|null>=>{
      if(action==="recordStudentCallTask")return {page:"studentsList",capability:"can_add"};
      const direct:Record<string,[string,"can_add"|"can_edit"|"can_delete"]>={createEmployee:["employees","can_add"],updateEmployee:["employees","can_edit"],resetEmployeePassword:["employees","can_edit"],deactivateEmployee:["employees","can_edit"],deleteEmployee:["employees","can_delete"],createBranch:["settings","can_add"],updateBranch:["settings","can_edit"],deleteBranch:["settings","can_delete"],createClassroom:["classes","can_add"],updateClassroom:["classes","can_edit"],deleteClassroom:["classes","can_delete"],createTrack:["tracks","can_add"],updateTrack:["tracks","can_edit"],deleteTrack:["tracks","can_delete"],createTimeSlot:["timeSystem","can_add"],updateTimeSlot:["timeSystem","can_edit"],deleteTimeSlot:["timeSystem","can_delete"],assignGroupStaff:["groups","can_edit"],addGroupStudent:["groups","can_edit"],removeGroupStudent:["groups","can_edit"],deleteEmptyGroups:["groups","can_delete"],updateGroupZoom:["groups","can_edit"],createDepartment:["departments","can_add"],updateDepartment:["departments","can_edit"],deleteDepartment:["departments","can_delete"],createJobTitle:["jobs","can_add"],updateJobTitle:["jobs","can_edit"],deleteJobTitle:["jobs","can_delete"],saveJobTitlePermissions:["permissions","can_edit"],createStudent:["studentsList","can_add"],updateStudent:["studentsList","can_edit"],deleteStudent:["studentsList","can_delete"],saveGroupAttendance:["studentAttendance","can_edit"],updateAbsenceCall:["operationsAbsenceCalls","can_edit"],completeMisplacedFeedback:["studentMisplaced","can_edit"],completeSupervisorReport:["studentReported","can_edit"],updateRetentionStatus:["retentionStatus","can_edit"],saveRetentionNonRenewal:["operationsRetention","can_edit"],updateComplaintWorkflow:["studentComplaints","can_edit"],completePlacementTest:["studentPlacement","can_edit"],payStudentInstallment:["payments","can_add"],refundPayment:["payments","can_edit"],cancelRefund:["payments","can_edit"],transferPayment:["payments","can_edit"],resetStudentDebt:["payments","can_edit"],cancelDebtReset:["payments","can_edit"],updatePaymentReceipt:["payments","can_edit"],voidPaymentReceipt:["payments","can_delete"],toggleField:["forms","can_edit"],addField:["forms","can_add"],importMarketingExpensesBatch:["marketingExpenses","can_add"],discardMarketingExpensesImport:["marketingExpenses","can_add"],commitMarketingExpensesImport:["marketingExpenses","can_add"]};
      if(direct[action])return {page:direct[action][0],capability:direct[action][1]};
      if(action==="createStudentRecord"){const kind=String(payload.kind||"");if(kind==="complaint")return {page:"studentComplaints",capability:"can_add"};if(kind==="information")return {page:"studentInformations",capability:"can_add"};if(kind==="placement")return {page:"studentPlacement",capability:"can_add"};if(kind==="attendance"||kind==="oral"||kind==="lesson_evaluation")return {page:"studentAttendance",capability:"can_add"};if(kind==="misplaced")return {page:"studentMisplaced",capability:"can_add"};if(kind==="supervisor_report")return {page:"studentReported",capability:"can_add"};if(kind==="payment")return {page:"payments",capability:"can_add"};return null}
      if(action==="updateStudentRecord"||action==="deleteStudentRecord"){const record=await db.prepare("SELECT kind FROM student_records WHERE id=?").bind(Number(payload.id)).first<{kind:string}>(),page=record?.kind==="complaint"?"studentComplaints":record?.kind==="information"?"studentInformations":record?.kind==="placement"?"studentPlacement":record?.kind==="attendance"||record?.kind==="oral"||record?.kind==="lesson_evaluation"?"studentAttendance":record?.kind==="misplaced"?"studentMisplaced":record?.kind==="supervisor_report"?"studentReported":"";return page?{page,capability:action==="deleteStudentRecord"?"can_delete":"can_edit"}:null}
      if(["createSettingsEntity","updateSettingsEntity","deleteSettingsEntity"].includes(action)){let kind=String(payload.kind||"");if(!kind&&payload.id){const entity=await db.prepare("SELECT kind FROM settings_entities WHERE id=?").bind(Number(payload.id)).first<{kind:string}>();kind=entity?.kind||""}const pageByKind:Record<string,string>={round:"rounds",study_type:"studyTypes",level:"levels",education_batch:"batches",group:"groups",office_hours:"groups",source:"sources",offer:"offers",payment_method:"paymentMethods",setup_card:"setupCards",exam:"exams",marketing_expense:"marketingExpenses",ads_spending_target:"adsSpendingTargets",retention_target:"retentionTargets",system_setting:"adminSettings"},page=pageByKind[kind]||"adminSettings";return {page,capability:action==="createSettingsEntity"?"can_add":action==="deleteSettingsEntity"?"can_delete":"can_edit"}}
      return null;
    };
    const target=await permissionTarget();if(target){const rows=await db.prepare("SELECT page_key AS pageKey,can_view AS canView,can_add AS canAdd,can_edit AS canEdit,can_delete AS canDelete FROM job_title_permissions WHERE job_title_id=?").bind(sessionEmployee.jobTitleId).all<{pageKey:string;canView:number;canAdd:number;canEdit:number;canDelete:number}>(),saved=rows.results.find((item)=>item.pageKey===target.page)||(["operationsRetention","retentionMoney","retentionTargets","operationsAbsenceReports","operationsAbsenceCalls"].includes(target.page)?rows.results.find((item)=>item.pageKey==="studentsList"):undefined),legacyFullAccess=!rows.results.length||rows.results.every((item)=>Boolean(item.canView)),allowed=saved?Boolean(target.capability==="can_add"?saved.canAdd:target.capability==="can_edit"?saved.canEdit:saved.canDelete):legacyFullAccess;if(!allowed)return Response.json({error:"ليس لديك صلاحية لتنفيذ هذا الإجراء"},{status:403})}
    if(action){
      const hidden=new Set(["password","passwordHash","customData","notes"]),safeDetails:Record<string,unknown>=Object.fromEntries(Object.entries(payload).filter(([key])=>key!=="action"&&!hidden.has(key)).map(([key,value])=>[key,typeof value==="object"?"[data]":value]));
      const studentActions=new Set(["createStudent","updateStudent","deleteStudent","createStudentRecord","recordStudentCallTask","updateStudentRecord","updateComplaintWorkflow","completeMisplacedFeedback","completeSupervisorReport","updateRetentionStatus","saveRetentionNonRenewal","updateAbsenceCall","deleteStudentRecord","completePlacementTest","payStudentInstallment","refundPayment","cancelRefund","transferPayment","resetStudentDebt","cancelDebtReset","voidPaymentReceipt"]);
      let subjectId=Number(payload.studentId)||0,subjectReference=action==="createStudent"?String(payload.mobile||""):"";
      if(studentActions.has(action)&&!subjectId){
        if(action==="updateStudent"||action==="deleteStudent")subjectId=Number(payload.id)||0;
        else {const recordId=Number(payload.paymentId||payload.recordId||payload.id)||0;if(recordId){const linked=await db.prepare("SELECT student_id AS studentId,custom_data AS customData FROM student_records WHERE id=?").bind(recordId).first<{studentId:number;customData:string}>();subjectId=linked?.studentId||0;if(linked?.customData){try{const payment=JSON.parse(linked.customData) as Record<string,unknown>;if(payment.main)safeDetails.main=payment.main;if(payment.invoice)safeDetails.invoice=payment.invoice;if(payment.offer)safeDetails.offer=payment.offer}catch{}}}}
      }
      if(subjectId&&!subjectReference){const subject=await db.prepare("SELECT mobile FROM students WHERE id=?").bind(subjectId).first<{mobile:string}>();subjectReference=subject?.mobile||""}
      await db.prepare("INSERT INTO system_logs (action,actor_id,actor_name,subject_type,subject_id,subject_reference,details) VALUES (?,?,?,?,?,?,?)").bind(action,sessionEmployee?.id||null,sessionEmployee?.fullName||"System",studentActions.has(action)?"student":"",subjectId||null,subjectReference,JSON.stringify(safeDetails)).run()
    }
    if(action==="createStudent"||action==="updateStudent"){
      const id=Number(payload.id),fullName=String(payload.fullName??"").trim(),mobile=String(payload.mobile??"").trim(),secondaryMobile=String(payload.secondaryMobile??"").trim(),primaryPhone=normalizePhone(mobile),secondPhone=normalizePhone(secondaryMobile);
      if(!fullName||primaryPhone.length<8)return Response.json({error:"اسم الطالب ورقم الموبايل الأول الصحيح مطلوبان"},{status:400});
      if(secondPhone&&secondPhone.length<8)return Response.json({error:"رقم الموبايل الثاني غير صحيح"},{status:400});
      const levelId=Number(payload.levelId)||(await db.prepare("SELECT id FROM settings_entities WHERE kind='level' AND is_active=1 ORDER BY id LIMIT 1").first<{id:number}>())?.id;
      if(!levelId)return Response.json({error:"أضف مستوى دراسي أولًا"},{status:409});
      const otherStudents=await db.prepare("SELECT id,mobile FROM students WHERE id<>?").bind(id).all<{id:number;mobile:string}>(),duplicate=otherStudents.results.find((item)=>normalizePhone(item.mobile)===primaryPhone);
      if(duplicate)return Response.json({error:"رقم الموبايل الأول مسجل لطالب آخر"},{status:409});
      const details=payload.customData&&typeof payload.customData==="object"?{...(payload.customData as Record<string,unknown>)}:{};if(details.fbMobile)details.fbMobile=normalizePhone(String(details.fbMobile));const customData=JSON.stringify(details),email=String(payload.email??""),trackId=Number(payload.trackId)||null,branchId=Number(payload.branchId)||null,status=String(payload.status??"active");
      if(action==="updateStudent"){
        const submittedCreatedAt=String(payload.createdAt??"").trim().replace("T"," "),createdAt=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(submittedCreatedAt)?`${submittedCreatedAt}:00`:/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(submittedCreatedAt)?submittedCreatedAt:"";
        if(submittedCreatedAt&&!createdAt)return Response.json({error:"تاريخ البروفايل غير صحيح"},{status:400});
        if(createdAt)await db.prepare("UPDATE students SET full_name=?,mobile=?,secondary_mobile=?,email=?,level_id=?,track_id=?,branch_id=?,status=?,custom_data=?,created_at=? WHERE id=?").bind(fullName,primaryPhone,secondPhone,email,levelId,trackId,branchId,status,customData,createdAt,id).run();
        else await db.prepare("UPDATE students SET full_name=?,mobile=?,secondary_mobile=?,email=?,level_id=?,track_id=?,branch_id=?,status=?,custom_data=? WHERE id=?").bind(fullName,primaryPhone,secondPhone,email,levelId,trackId,branchId,status,customData,id).run();
        return Response.json({ok:true})
      }
      const result=await db.prepare("INSERT INTO students (full_name,mobile,secondary_mobile,email,level_id,track_id,branch_id,status,custom_data) VALUES (?,?,?,?,?,?,?,?,?)").bind(fullName,primaryPhone,secondPhone,email,levelId,trackId,branchId,status,customData).run(),studentId=Number(result.meta.last_row_id),normalizedMobile=primaryPhone;
      const linkedLeads=await db.prepare("SELECT id,custom_data AS customData FROM leads WHERE normalized_phone=?").bind(normalizedMobile).all<{id:number;customData:string}>(),allCalls=await db.prepare("SELECT id,lead_id AS leadId,phone,direction,custom_data AS customData FROM call_records").all<{id:number;leadId:number|null;phone:string;direction:string;customData:string}>(),linkedCalls=allCalls.results.filter((call)=>normalizePhone(call.phone)===normalizedMobile),primaryLeadId=linkedLeads.results[0]?.id||null;
      const updates=[] as Array<ReturnType<typeof db.prepare>>;for(const lead of linkedLeads.results){let details:Record<string,unknown>={};try{details=JSON.parse(lead.customData||"{}")}catch{}updates.push(db.prepare("UPDATE leads SET status='registered',custom_data=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify({...details,studentId,registeredAt:new Date().toISOString(),registeredBefore:false}),lead.id))}for(const call of linkedCalls){let details:Record<string,unknown>={};try{details=JSON.parse(call.customData||"{}")}catch{}updates.push(db.prepare("UPDATE call_records SET lead_id=COALESCE(lead_id,?),custom_data=? WHERE id=?").bind(primaryLeadId,JSON.stringify({...details,studentId,finalStatus:"Registered",registeredBefore:false}),call.id))}
      const originTypes=[linkedLeads.results.length?"Lead":"",linkedCalls.some((call)=>call.direction==="incoming")?"Inbound Call":""].filter(Boolean),studentDetails={...details,createdById:sessionEmployee?.id||null,createdBy:sessionEmployee?.fullName||"System",originTypes,linkedLeadIds:linkedLeads.results.map((lead)=>lead.id),linkedCallIds:linkedCalls.map((call)=>call.id)};updates.push(db.prepare("UPDATE students SET custom_data=? WHERE id=?").bind(JSON.stringify(studentDetails),studentId));if(updates.length)await db.batch(updates);
      return Response.json({id:studentId,originTypes,linkedLeads:linkedLeads.results.length,linkedCalls:linkedCalls.length},{status:201});
    }
    if(action==="deleteStudent"){const id=Number(payload.id);await db.batch([db.prepare("DELETE FROM group_members WHERE student_reference=?").bind(String(id)),db.prepare("DELETE FROM student_records WHERE student_id=?").bind(id),db.prepare("DELETE FROM students WHERE id=?").bind(id)]);return Response.json({ok:true})}
    if(action==="saveGroupAttendance"){
      const groupId=Number(payload.groupId),recordDate=String(payload.recordDate||"").slice(0,10),requestedSessionNumber=Math.max(1,Number(payload.sessionNumber)||1),requestedEntries=Array.isArray(payload.entries)?payload.entries as Array<Record<string,unknown>>:[];
      if(!groupId||!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)||!requestedEntries.length)return Response.json({error:"بيانات حضور الجروب غير مكتملة"},{status:400});
      const group=await db.prepare("SELECT id,title,custom_data AS customData FROM settings_entities WHERE id=? AND kind='group'").bind(groupId).first<{id:number;title:string;customData:string}>();if(!group)return Response.json({error:"الجروب غير موجود"},{status:404});let groupDetails:Record<string,unknown>={};try{groupDetails=JSON.parse(group.customData||"{}")}catch{}const startDate=String(groupDetails.startDate||"").slice(0,10),expectedSession=expectedSessionNumber(startDate,recordDate);if(!expectedSession)return Response.json({error:"التاريخ المحدد ليس من أيام محاضرات الجروب أو يسبق تاريخ بداية الجروب"},{status:400});const overridePermission=await db.prepare("SELECT can_edit AS canEdit FROM job_title_permissions WHERE job_title_id=? AND page_key='studentAttendanceSession' LIMIT 1").bind(sessionEmployee.jobTitleId).first<{canEdit:number}>(),sessionNumber=overridePermission?.canEdit?requestedSessionNumber:expectedSession;
      const members=await db.prepare("SELECT CAST(student_reference AS INTEGER) AS studentId FROM group_members WHERE group_id=?").bind(groupId).all<{studentId:number}>(),memberIds=new Set(members.results.map((item)=>Number(item.studentId))),allowedStatuses=new Set(["Present","Absent","Late","Excused"]);
      const entries=requestedEntries.map((item)=>({studentId:Number(item.studentId),status:String(item.status||"Present"),notes:String(item.notes||"").trim()})).filter((item)=>memberIds.has(item.studentId)&&allowedStatuses.has(item.status));
      if(!entries.length)return Response.json({error:"لا يوجد طلاب صالحون لتسجيل الحضور"},{status:400});
      const existing=await db.prepare("SELECT id,student_id AS studentId,custom_data AS customData FROM student_records WHERE kind='attendance' AND substr(record_date,1,10)=?").bind(recordDate).all<{id:number;studentId:number;customData:string}>(),existingByStudent=new Map<number,{id:number;customData:string}>();
      for(const item of existing.results){try{if(Number(JSON.parse(item.customData||"{}").groupId)===groupId)existingByStudent.set(Number(item.studentId),item)}catch{}}
      const timestamp=`${recordDate}T00:00:00.000Z`,statements=entries.map((entry)=>{const found=existingByStudent.get(entry.studentId),details={groupId,groupTitle:group.title,sessionNumber,recordedById:sessionEmployee?.id||null,recordedBy:sessionEmployee?.fullName||"System",savedAt:new Date().toISOString()};return found?db.prepare("UPDATE student_records SET record_date=?,status=?,notes=?,custom_data=? WHERE id=?").bind(timestamp,entry.status,entry.notes,JSON.stringify(details),found.id):db.prepare("INSERT INTO student_records (student_id,kind,record_date,status,notes,custom_data) VALUES (?,'attendance',?,?,?,?)").bind(entry.studentId,timestamp,entry.status,entry.notes,JSON.stringify(details))});
      await db.batch(statements);return Response.json({ok:true,count:statements.length});
    }
    if(action==="updateAbsenceCall"){
      const recordId=Number(payload.recordId),status=String(payload.status||""),note=String(payload.note||"").trim(),followUpDate=String(payload.followUpDate||"").slice(0,10),allowed=new Set(["Pending","Contacted","No Answer","Wrong Number","Follow Up"]);
      if(!recordId||!allowed.has(status))return Response.json({error:"نتيجة المكالمة غير صحيحة"},{status:400});
      if(status==="Follow Up"&&!/^\d{4}-\d{2}-\d{2}$/.test(followUpDate))return Response.json({error:"حدد تاريخ المتابعة القادمة"},{status:400});
      const record=await db.prepare("SELECT custom_data AS customData FROM student_records WHERE id=? AND kind='attendance' AND status='Absent'").bind(recordId).first<{customData:string}>();
      if(!record)return Response.json({error:"سجل الغياب غير موجود"},{status:404});
      let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}
      const previous=(details.callWorkflow||{}) as Record<string,unknown>,entry={status,note,followUpDate:status==="Follow Up"?followUpDate:"",updatedById:sessionEmployee.id,updatedBy:sessionEmployee.fullName,updatedAt:new Date().toISOString()},history=[...(Array.isArray(previous.history)?previous.history:[]),entry];
      details.callWorkflow={...entry,history};
      await db.prepare("UPDATE student_records SET custom_data=? WHERE id=?").bind(JSON.stringify(details),recordId).run();
      return Response.json({ok:true,status});
    }
    if(action==="completeMisplacedFeedback"){
      const id=Number(payload.id),decision=String(payload.decision||""),targetLevelId=Number(payload.targetLevelId)||0,supervisorNotes=String(payload.notes||"").trim();
      if(!id||!["Up Level","Down Level","Same Level"].includes(decision)||!supervisorNotes)return Response.json({error:"قرار المشرف والملاحظات مطلوبان"},{status:400});
      const record=await db.prepare("SELECT student_id AS studentId,status,custom_data AS customData FROM student_records WHERE id=? AND kind='misplaced'").bind(id).first<{studentId:number;status:string;customData:string}>();
      if(!record)return Response.json({error:"طلب Misplaced غير موجود"},{status:404});
      if(record.status!=="Open")return Response.json({error:"تم تسجيل Feedback لهذا الطلب بالفعل"},{status:409});
      const student=await db.prepare("SELECT level_id AS levelId,track_id AS trackId,custom_data AS customData FROM students WHERE id=?").bind(record.studentId).first<{levelId:number|null;trackId:number|null;customData:string}>();
      if(!student)return Response.json({error:"الطالب غير موجود"},{status:404});
      const currentLevelId=Number(student.levelId)||0,currentLevel=currentLevelId?await db.prepare("SELECT id,title,custom_data AS customData FROM settings_entities WHERE id=? AND kind='level'").bind(currentLevelId).first<{id:number;title:string;customData:string}>():null;
      const targetLevel=decision==="Same Level"?currentLevel:(targetLevelId?await db.prepare("SELECT id,title,custom_data AS customData FROM settings_entities WHERE id=? AND kind='level' AND is_active=1").bind(targetLevelId).first<{id:number;title:string;customData:string}>():null);
      if(!currentLevel||!targetLevel)return Response.json({error:"حدد مستوى الطالب الحالي والمستوى الجديد أولًا"},{status:400});
      let currentDetails:Record<string,unknown>={},targetDetails:Record<string,unknown>={},studentDetails:Record<string,unknown>={},recordDetails:Record<string,unknown>={};try{currentDetails=JSON.parse(currentLevel.customData||"{}")}catch{}try{targetDetails=JSON.parse(targetLevel.customData||"{}")}catch{}try{studentDetails=JSON.parse(student.customData||"{}")}catch{}try{recordDetails=JSON.parse(record.customData||"{}")}catch{}
      const currentSort=Number(currentDetails.sortOrder)||currentLevel.id,targetSort=Number(targetDetails.sortOrder)||targetLevel.id,currentTrack=Number(currentDetails.trackId||student.trackId),targetTrack=Number(targetDetails.trackId||student.trackId);
      if(currentTrack&&targetTrack&&currentTrack!==targetTrack)return Response.json({error:"المستوى الجديد يجب أن يكون في نفس Track الطالب"},{status:400});
      if(decision==="Up Level"&&targetSort<=currentSort)return Response.json({error:"اختر Level أعلى من مستوى الطالب الحالي"},{status:400});
      if(decision==="Down Level"&&targetSort>=currentSort)return Response.json({error:"اختر Level أقل من مستوى الطالب الحالي"},{status:400});
      const movement=decision==="Same Level"?0:Math.abs(targetSort-currentSort),signedAdjustment=decision==="Up Level"?movement:decision==="Down Level"?-movement:0,levelAdjustment=Number(studentDetails.misplacedLevelAdjustment||0)+signedAdjustment,feedbackAt=new Date().toISOString(),feedback={decision,targetLevelId:targetLevel.id,targetLevelTitle:targetLevel.title,currentLevelId:currentLevel.id,currentLevelTitle:currentLevel.title,movement,signedAdjustment,notes:supervisorNotes,supervisorId:sessionEmployee.id,supervisor:sessionEmployee.fullName,feedbackAt};
      studentDetails.misplacedLevelAdjustment=levelAdjustment;studentDetails.lastMisplacedFeedback=feedback;
      await db.batch([db.prepare("UPDATE students SET level_id=?,custom_data=? WHERE id=?").bind(targetLevel.id,JSON.stringify(studentDetails),record.studentId),db.prepare("UPDATE student_records SET status=?,notes=?,custom_data=? WHERE id=?").bind(decision,supervisorNotes,JSON.stringify({...recordDetails,feedback}),id)]);
      return Response.json({ok:true,status:decision,movement,targetLevel:targetLevel.title});
    }
    if(action==="updateRetentionStatus"){
      const studentId=Number(payload.studentId),status=String(payload.status||""),notes=String(payload.notes||"").trim(),nextFollowupDate=String(payload.nextFollowupDate||"").slice(0,10),allowed=new Set(["Not Contacted","Follow Up","Renewed","Not Interested"]);
      if(!studentId||!allowed.has(status))return Response.json({error:"حالة Retention غير صحيحة"},{status:400});
      if(status==="Follow Up"&&!/^\d{4}-\d{2}-\d{2}$/.test(nextFollowupDate))return Response.json({error:"حدد تاريخ المتابعة القادمة"},{status:400});
      const student=await db.prepare("SELECT custom_data AS customData FROM students WHERE id=?").bind(studentId).first<{customData:string}>();if(!student)return Response.json({error:"الطالب غير موجود"},{status:404});
      let details:Record<string,unknown>={};try{details=JSON.parse(student.customData||"{}")}catch{}
      const retentionWorkflow={status,notes,nextFollowupDate:status==="Follow Up"?nextFollowupDate:"",updatedById:sessionEmployee.id,updatedBy:sessionEmployee.fullName,updatedAt:new Date().toISOString()};details.retentionWorkflow=retentionWorkflow;
      await db.prepare("UPDATE students SET custom_data=? WHERE id=?").bind(JSON.stringify(details),studentId).run();return Response.json({ok:true,status});
    }
    if(action==="saveRetentionNonRenewal"){
      const studentId=Number(payload.studentId),contactType=String(payload.contactType||"").trim(),reason=String(payload.reason||"").trim(),note=String(payload.note||"").trim(),allowedContactTypes=new Set(["مكالمة","رسالة واتس اب","SMS","ميتنج في الفرع"]);
      if(!studentId||!allowedContactTypes.has(contactType)||!reason)return Response.json({error:"نوع التواصل وسبب عدم الاشتراك مطلوبان"},{status:400});
      const [student,configuredReason]=await Promise.all([db.prepare("SELECT custom_data AS customData FROM students WHERE id=?").bind(studentId).first<{customData:string}>(),db.prepare("SELECT title FROM settings_entities WHERE kind='retention_nonrenewal_reason' AND is_active=1 AND LOWER(title)=LOWER(?) LIMIT 1").bind(reason).first<{title:string}>()]);
      if(!student)return Response.json({error:"الطالب غير موجود"},{status:404});
      if(!configuredReason)return Response.json({error:"اختر سببًا مسجلًا في Admin Settings"},{status:400});
      let details:Record<string,unknown>={};try{details=JSON.parse(student.customData||"{}")}catch{}
      const previous=(details.retentionNonRenewal||{}) as Record<string,unknown>,entry={contactType,reason:configuredReason.title,note,updatedById:sessionEmployee.id,updatedBy:sessionEmployee.fullName,updatedAt:new Date().toISOString()},history=[...(Array.isArray(previous.history)?previous.history:[]),entry];
      details.retentionNonRenewal={...entry,history};
      await db.prepare("UPDATE students SET custom_data=? WHERE id=?").bind(JSON.stringify(details),studentId).run();
      return Response.json({ok:true});
    }
    if(action==="completeSupervisorReport"){
      const id=Number(payload.id),decision=String(payload.decision||""),notes=String(payload.notes||"").trim(),allowed=new Set(["Under Monitoring","Academic Warning","Support Plan","Closed"]);
      if(!id||!allowed.has(decision)||!notes)return Response.json({error:"إجراء المشرف والملاحظات مطلوبان"},{status:400});
      const record=await db.prepare("SELECT status,custom_data AS customData FROM student_records WHERE id=? AND kind='supervisor_report'").bind(id).first<{status:string;customData:string}>();
      if(!record)return Response.json({error:"تقرير الطالب غير موجود"},{status:404});
      if(record.status!=="Open")return Response.json({error:"تم تسجيل Feedback لهذا التقرير بالفعل"},{status:409});
      let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}
      const feedback={decision,notes,supervisorId:sessionEmployee.id,supervisor:sessionEmployee.fullName,feedbackAt:new Date().toISOString()};
      await db.prepare("UPDATE student_records SET status=?,notes=?,custom_data=? WHERE id=?").bind(decision,notes,JSON.stringify({...details,feedback}),id).run();
      return Response.json({ok:true,status:decision});
    }
    if(action==="recordStudentCallTask"){
      const studentId=Number(payload.studentId),taskType=String(payload.taskType||""),callStatus=String(payload.callStatus||""),result=String(payload.result||"").trim(),reason=String(payload.reason||"").trim(),notes=String(payload.notes||"").trim();
      const noAnswer=["no_answer","no answer"].includes(result.toLowerCase());if(!studentId||!["missing","remaining","visitor"].includes(taskType)||!["Pending","Follow Up","Completed"].includes(callStatus)||(!reason&&!noAnswer))return Response.json({error:"بيانات متابعة المكالمة غير مكتملة"},{status:400});
      const student=await db.prepare("SELECT id FROM students WHERE id=?").bind(studentId).first<{id:number}>();if(!student)return Response.json({error:"الطالب غير موجود"},{status:404});
      const reasonKind=taskType==="visitor"?"visitor_call_reason":"student_call_reason",configuredReason=reason?await db.prepare("SELECT id FROM settings_entities WHERE kind=? AND is_active=1 AND title=? LIMIT 1").bind(reasonKind,reason).first():{id:0};if(!configuredReason)return Response.json({error:"سبب المكالمة غير معتمد في الإعدادات"},{status:400});
      const now=new Date().toISOString(),recordDate=now,details={callTaskType:taskType,callStatus,result,reason,channel:taskType==="visitor"?["Call","WhatsApp","SMS"].includes(String(payload.channel))?String(payload.channel):"Call":"Call",visitorSequence:taskType==="visitor"?Math.max(1,Math.min(4,Number(payload.visitorSequence)||1)):undefined,createdById:sessionEmployee.id,createdBy:sessionEmployee.fullName,updatedAt:now};
      const inserted=await db.prepare("INSERT INTO student_records (student_id,kind,record_date,status,notes,custom_data) VALUES (?,'student_call_task',?,?,?,?)").bind(studentId,recordDate,callStatus,notes,JSON.stringify(details)).run();
      return Response.json({id:inserted.meta.last_row_id},{status:201});
    }
    if(action==="createStudentRecord"){
      const studentId=Number(payload.studentId),kind=String(payload.kind??"");if(!studentId||!["attendance","placement","complaint","information","payment","misplaced","oral","lesson_evaluation","supervisor_report"].includes(kind))return Response.json({error:"بيانات سجل الطالب غير مكتملة"},{status:400});
      const student=await db.prepare("SELECT s.id,s.custom_data AS customData,s.branch_id AS branchId,b.name AS branchName FROM students s LEFT JOIN branches b ON b.id=s.branch_id WHERE s.id=?").bind(studentId).first<{id:number;customData:string;branchId:number|null;branchName:string|null}>();if(!student)return Response.json({error:"الطالب غير موجود"},{status:404});
      if(kind==="payment"){
        const requested=(payload.customData&&typeof payload.customData==="object"?payload.customData:{}) as Record<string,unknown>,offerId=Number(requested.offerId),paid=Number(requested.paid),method=String(requested.method||"");
        const offer=await db.prepare("SELECT title,custom_data AS customData FROM settings_entities WHERE id=? AND kind='offer' AND is_active=1").bind(offerId).first<{title:string;customData:string}>();
        const paymentMethod=await db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE kind='payment_method' AND title=? AND is_active=1").bind(method).first<{customData:string}>();
        if(!offer||!paymentMethod)return Response.json({error:"العرض أو وسيلة الدفع غير صالحة"},{status:400});
        let offerDetails:Record<string,unknown>={},methodDetails:Record<string,unknown>={};try{offerDetails=JSON.parse(offer.customData||"{}")}catch{}try{methodDetails=JSON.parse(paymentMethod.customData||"{}")}catch{}
        const total=Number(offerDetails.amount||0),due=Math.max(0,total-paid),requiresReference=String(methodDetails.reference||"No").toLowerCase()==="yes",reference=String(requested.reference||"").trim(),installments=Array.isArray(requested.installments)?requested.installments:[];
        if(total<=0||!Number.isFinite(paid)||paid<0||paid>total)return Response.json({error:"قيمة الدفع غير صحيحة"},{status:400});
        if(requiresReference&&!reference)return Response.json({error:"رقم المرجع مطلوب لطريقة الدفع المختارة"},{status:400});
        const installmentTotal=installments.reduce((sum,item)=>{const entry=item&&typeof item==="object"?item as Record<string,unknown>:{};return sum+Number(entry.amount||0)},0),invalidInstallment=installments.some((item)=>{const entry=item&&typeof item==="object"?item as Record<string,unknown>:{};return Number(entry.amount)<=0||!String(entry.date||"").trim()});
        if(due>0&&(!installments.length||invalidInstallment||Math.abs(installmentTotal-due)>.01))return Response.json({error:"مبالغ الأقساط ومواعيدها مطلوبة، ويجب أن يساوي مجموعها المبلغ المتبقي"},{status:400});
        const recordDate=new Date().toISOString(),levels=Math.max(0,Number(offerDetails.levels||0)),status=due===0?"Paid":"Partial",preparedInstallments=installments.map((item,index)=>{const entry=item as Record<string,unknown>;return {...entry,number:index+1,status:"Pending",paidAt:null,invoice:null}});
        let paymentType=zeroLevelPaymentType(offer.title);
        if(levels>0){
          const priorRows=await db.prepare("SELECT id,record_date AS recordDate,custom_data AS customData FROM student_records WHERE student_id=? AND kind='payment' ORDER BY record_date,id").bind(studentId).all<{id:number;recordDate:string;customData:string}>(),priorLevelPayments=priorRows.results.flatMap((row:{id:number;recordDate:string;customData:string})=>{try{const item=JSON.parse(row.customData||"{}") as Record<string,unknown>;return item.isMainPayment&&!item.voided&&Number(item.levels||0)>0?[{...row,item}]:[]}catch{return []}});
          if(!priorLevelPayments.length||cairoDateKey(priorLevelPayments[0].recordDate)===cairoDateKey(recordDate))paymentType="New Comers";
          else {let studentDetails:Record<string,unknown>={};try{studentDetails=JSON.parse(student.customData||"{}")}catch{}const purchasedBefore=priorLevelPayments.reduce((sum:number,row:{item:Record<string,unknown>})=>sum+Math.max(0,Number(row.item.levels||0)-Number(row.item.refundedLevels||0)-Number(row.item.transferredLevels||0)),0),membership=await db.prepare("SELECT COUNT(*) AS count FROM group_members WHERE student_reference=? AND joined_at<=?").bind(String(studentId),recordDate).first<{count:number}>(),remainingBefore=Math.max(0,purchasedBefore-Number(membership?.count||0)-Number(studentDetails.misplacedLevelAdjustment||0));paymentType=remainingBefore<=1?"Retention":"Renewal"}
        }
        const baseData={offerId,offer:offer.title,levels,total,paid,due,paymentType,method,reference:requiresReference?reference:"",studentBranchId:student.branchId||null,studentBranch:student.branchName||"",employeeBranchId:sessionEmployee?.branchId||null,employeeBranch:sessionEmployee?.branchName||"",installments:preparedInstallments,addedById:sessionEmployee?.id||null,addedBy:sessionEmployee?.fullName||"System"};
        const result=await db.prepare("INSERT INTO student_records (student_id,kind,record_date,status,notes,custom_data) VALUES (?,'payment',?,?,?,?)").bind(studentId,recordDate,status,String(payload.notes??""),JSON.stringify(baseData)).run();
        const id=Number(result.meta.last_row_id),main=`#${40000+id}`,invoice=`#${50000+id}`;
        await db.prepare("UPDATE student_records SET custom_data=? WHERE id=?").bind(JSON.stringify({...baseData,main,invoice,isMainPayment:true}),id).run();
        return Response.json({id,main,invoice},{status:201});
      }
      const requestedData=(payload.customData&&typeof payload.customData==="object"?payload.customData:{}) as Record<string,unknown>;
      if(kind==="misplaced"){
        const groupId=Number(requestedData.groupId);
        if(!groupId)return Response.json({error:"الجروب مطلوب لتسجيل Misplaced"},{status:400});
        const attended=await db.prepare("SELECT COUNT(DISTINCT COALESCE(json_extract(custom_data,'$.sessionNumber'),substr(record_date,1,10))) AS count FROM student_records WHERE student_id=? AND kind='attendance' AND status IN ('Present','Late','Excused') AND CAST(json_extract(custom_data,'$.groupId') AS INTEGER)=?").bind(studentId,groupId).first<{count:number}>();
        if((attended?.count??0)>2)return Response.json({error:"حضر الطالب أكثر من محاضرتين، وقد تعدّى الوقت المسموح لإنشاء طلب Misplaced."},{status:409});
        const existing=await db.prepare("SELECT id,status FROM student_records WHERE student_id=? AND kind='misplaced' AND CAST(json_extract(custom_data,'$.groupId') AS INTEGER)=? ORDER BY id DESC LIMIT 1").bind(studentId,groupId).first<{id:number;status:string}>();
        if(existing)return Response.json({error:existing.status==="Open"?"الطالب في انتظار Feedback المشرف بالفعل":"تم تسجيل Misplaced لهذا الطالب في نفس الجروب من قبل، ولا يمكن تكرار العملية."},{status:409});
      }
      if(kind==="supervisor_report"){
        const groupId=Number(requestedData.groupId);if(!groupId)return Response.json({error:"الجروب مطلوب لإرسال التقرير"},{status:400});
        const pending=await db.prepare("SELECT id FROM student_records WHERE student_id=? AND kind='supervisor_report' AND status='Open' AND CAST(json_extract(custom_data,'$.groupId') AS INTEGER)=? LIMIT 1").bind(studentId,groupId).first();
        if(pending)return Response.json({error:"يوجد تقرير مفتوح لهذا الطالب في نفس الجروب وينتظر Feedback المشرف"},{status:409});
      }
      if((kind==="information"||kind==="complaint")&&requestedData.requiresEscalation){const employeeId=Number(requestedData.escalatedToEmployeeId),employee=employeeId?await db.prepare("SELECT id,full_name AS fullName FROM employees WHERE id=? AND status IN ('active','نشط')").bind(employeeId).first<{id:number;fullName:string}>():null;if(!employee)return Response.json({error:"اختر موظفًا نشطًا للتعامل مع التصعيد"},{status:400});if(sessionEmployee?.id===employee.id)return Response.json({error:"اختر موظفًا آخر غير الموظف الذي أنشأ السجل"},{status:400});requestedData.escalatedToEmployeeId=employee.id;requestedData.escalatedToEmployee=employee.fullName;requestedData.escalatedAt=new Date().toISOString()}
      const enrichedData=["complaint","information","misplaced","oral","lesson_evaluation","supervisor_report"].includes(kind)?{...requestedData,createdById:sessionEmployee?.id||null,createdBy:sessionEmployee?.fullName||"System",recordedById:sessionEmployee?.id||null,recordedBy:sessionEmployee?.fullName||"System"}:requestedData;
      const result=await db.prepare("INSERT INTO student_records (student_id,kind,record_date,status,notes,custom_data) VALUES (?,?,?,?,?,?)").bind(studentId,kind,String(payload.recordDate??new Date().toISOString()),String(payload.status??""),String(payload.notes??""),JSON.stringify(enrichedData)).run();return Response.json({id:result.meta.last_row_id},{status:201});
    }
    if(action==="updateComplaintWorkflow"){
      const id=Number(payload.id),mode=String(payload.mode||"");
      const record=await db.prepare("SELECT student_id AS studentId,record_date AS recordDate,status,notes,custom_data AS customData FROM student_records WHERE id=? AND kind='complaint'").bind(id).first<{studentId:number;recordDate:string;status:string;notes:string;customData:string}>();
      if(!record)return Response.json({error:"الشكوى غير موجودة"},{status:404});
      let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}
      const history=Array.isArray(details.history)?[...details.history] as Record<string,unknown>[]:[];
      const actorId=sessionEmployee?.id||null,actorName=sessionEmployee?.fullName||"System",now=new Date().toISOString();let nextStatus=record.status;
      if(mode==="response"){
        if(Number(details.escalatedToEmployeeId)!==actorId)return Response.json({error:"فقط الموظف المصعّد إليه الشكوى يمكنه تسجيل الرد"},{status:403});
        const response=String(payload.response||"").trim(),resolved=Boolean(payload.resolved),solutionNotes=String(payload.solutionNotes||"").trim();
        if(!response)return Response.json({error:"اكتب الرد على الشكوى"},{status:400});if(resolved&&!solutionNotes)return Response.json({error:"اكتب خطوات حل المشكلة"},{status:400});
        nextStatus=resolved?"Awaiting Confirmation":"In Progress";history.push({type:"response",at:now,byId:actorId,by:actorName,response,resolved,solutionNotes,status:nextStatus});details={...details,lastResponse:response,solutionNotes:resolved?solutionNotes:details.solutionNotes,lastRespondedAt:now,lastRespondedBy:actorName,history};
      }else if(mode==="confirm"){
        if(Number(details.createdById)&&Number(details.createdById)!==actorId)return Response.json({error:"فقط الموظف الذي فتح الشكوى يمكنه تأكيد رضا الطالب"},{status:403});
        if(record.status!=="Awaiting Confirmation")return Response.json({error:"الشكوى ليست في انتظار تأكيد الحل"},{status:400});
        const satisfied=Boolean(payload.satisfied),confirmationNotes=String(payload.confirmationNotes||"").trim();if(!confirmationNotes)return Response.json({error:"اكتب نتيجة التواصل مع الطالب"},{status:400});
        if(satisfied){nextStatus="Closed";history.push({type:"confirmation",at:now,byId:actorId,by:actorName,satisfied:true,notes:confirmationNotes,status:nextStatus});details={...details,studentSatisfied:true,closedAt:now,closedBy:actorName,history}}
        else {const employeeId=Number(payload.escalatedToEmployeeId),employee=employeeId?await db.prepare("SELECT id,full_name AS fullName FROM employees WHERE id=? AND status IN ('active','نشط')").bind(employeeId).first<{id:number;fullName:string}>():null;if(!employee)return Response.json({error:"اختر موظفًا لإعادة تصعيد الشكوى"},{status:400});nextStatus="Pending";history.push({type:"reopened",at:now,byId:actorId,by:actorName,satisfied:false,notes:confirmationNotes,toId:employee.id,to:employee.fullName,status:nextStatus});details={...details,studentSatisfied:false,escalatedToEmployeeId:employee.id,escalatedToEmployee:employee.fullName,escalatedAt:now,reopenedAt:now,history}}
      }else return Response.json({error:"إجراء الشكوى غير صالح"},{status:400});
      await db.prepare("UPDATE student_records SET status=?,custom_data=? WHERE id=?").bind(nextStatus,JSON.stringify(details),id).run();return Response.json({ok:true,status:nextStatus});
    }
    if(action==="payStudentInstallment"){
      const paymentId=Number(payload.paymentId),installmentNumber=Number(payload.installmentNumber),method=String(payload.method||""),reference=String(payload.reference||"").trim(),collectedAmount=Number(payload.amount);
      const payment=await db.prepare("SELECT student_id AS studentId,custom_data AS customData FROM student_records WHERE id=? AND kind='payment'").bind(paymentId).first<{studentId:number;customData:string}>();
      const paymentMethod=await db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE kind='payment_method' AND title=? AND is_active=1").bind(method).first<{customData:string}>();
      if(!payment||!paymentMethod)return Response.json({error:"المديونية أو وسيلة الدفع غير موجودة"},{status:404});
      let details:Record<string,unknown>={},methodDetails:Record<string,unknown>={};try{details=JSON.parse(payment.customData||"{}")}catch{}try{methodDetails=JSON.parse(paymentMethod.customData||"{}")}catch{}
      const installments=Array.isArray(details.installments)?details.installments.map((item)=>({...item as Record<string,unknown>})):[],index=installments.findIndex((item)=>Number(item.number)===installmentNumber),entry=installments[index];
      if(index<0||String(entry.status||"Pending")==="Paid")return Response.json({error:"القسط غير موجود أو تم سداده بالفعل"},{status:400});
      const requiresReference=String(methodDetails.reference||"No").toLowerCase()==="yes";if(requiresReference&&!reference)return Response.json({error:"رقم المرجع مطلوب"},{status:400});
      const outstanding=(item:Record<string,unknown>)=>Math.max(0,Number(item.remainingAmount??(Number(item.amount||0)-Number(item.paidAmount||0)))),totalDebtBefore=installments.reduce((sum,item)=>sum+outstanding(item),0),availableFromSelected=installments.slice(index).reduce((sum,item)=>sum+outstanding(item),0);
      if(!Number.isFinite(collectedAmount)||collectedAmount<=0||collectedAmount-availableFromSelected>.01)return Response.json({error:`المبلغ المحصل يجب أن يكون أكبر من صفر ولا يزيد عن ${availableFromSelected.toLocaleString()} EGP`},{status:400});
      let balance=collectedAmount;const allocations:Array<{index:number;amount:number}>=[];
      for(let itemIndex=index;itemIndex<installments.length&&balance>.001;itemIndex++){const remaining=outstanding(installments[itemIndex]);if(remaining<=.001)continue;const applied=Math.min(balance,remaining);allocations.push({index:itemIndex,amount:applied});balance=Number((balance-applied).toFixed(2));installments[itemIndex].paidAmount=Number((Number(installments[itemIndex].paidAmount||0)+applied).toFixed(2));installments[itemIndex].remainingAmount=Number((remaining-applied).toFixed(2));installments[itemIndex].status=Number(installments[itemIndex].remainingAmount)<=.01?"Paid":"Partial";}
      const paidAt=new Date().toISOString(),due=installments.reduce((sum,item)=>sum+outstanding(item),0),status=due<=.01?"Paid":"Partial";
      const transactionBase={main:details.main,offerId:details.offerId,offer:"Rest of Money",originalOffer:details.offer,paymentType:details.paymentType||"New Comers",total:totalDebtBefore,paid:collectedAmount,due,method,reference:requiresReference?reference:"",studentBranchId:details.studentBranchId||null,studentBranch:details.studentBranch||"",employeeBranchId:sessionEmployee?.branchId||null,employeeBranch:sessionEmployee?.branchName||"",installmentNumber,isDebtPayment:true,allocations:allocations.map((item)=>({installmentNumber:Number(installments[item.index].number),amount:item.amount})),addedById:sessionEmployee?.id||null,addedBy:sessionEmployee?.fullName||"System"};
      const inserted=await db.prepare("INSERT INTO student_records (student_id,kind,record_date,status,notes,custom_data) VALUES (?,'payment',?,?,?,?)").bind(payment.studentId,paidAt,"Paid",String(payload.notes||""),JSON.stringify(transactionBase)).run(),transactionId=Number(inserted.meta.last_row_id),invoice=`#${50000+transactionId}`;
      allocations.forEach((allocation)=>{const item=installments[allocation.index],collections=Array.isArray(item.collections)?item.collections:[];item.collections=[...collections,{invoice,amount:allocation.amount,paidAt,method,reference:requiresReference?reference:"",collectedBy:sessionEmployee?.fullName||"System"}];item.invoice=invoice;item.collectedBy=sessionEmployee?.fullName||"System";if(item.status==="Paid")item.paidAt=paidAt;else item.lastPaidAt=paidAt;});
      await db.batch([db.prepare("UPDATE student_records SET status=?,custom_data=? WHERE id=?").bind(status,JSON.stringify({...details,due,installments}),paymentId),db.prepare("UPDATE student_records SET custom_data=? WHERE id=?").bind(JSON.stringify({...transactionBase,invoice}),transactionId)]);
      return Response.json({id:transactionId,main:details.main,invoice},{status:201});
    }
    if(action==="resetStudentDebt"){
      const id=Number(payload.id),reason=String(payload.reason||"").trim(),record=await db.prepare("SELECT student_id AS studentId,status,custom_data AS customData FROM student_records WHERE id=? AND kind='payment'").bind(id).first<{studentId:number;status:string;customData:string}>();if(!record)return Response.json({error:"الفاتورة الرئيسية غير موجودة"},{status:404});let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}if(!details.isMainPayment||details.voided)return Response.json({error:"يمكن تصفير مديونية Main فعال فقط"},{status:400});if(!reason)return Response.json({error:"سبب تصفير المديونية مطلوب"},{status:400});if(Number(details.due||0)<=0)return Response.json({error:"لا توجد مديونية مفتوحة لتصفيرها"},{status:409});const currentReset=details.debtReset as Record<string,unknown>|undefined;if(currentReset?.active)return Response.json({error:"تم تصفير هذه المديونية بالفعل"},{status:409});const now=new Date().toISOString(),snapshot={due:Number(details.due||0),status:record.status,installments:Array.isArray(details.installments)?details.installments:[]},debtReset={id:`DR-${id}-${Date.now()}`,active:true,reason,amount:Number(details.due||0),createdAt:now,createdById:sessionEmployee.id,createdBy:sessionEmployee.fullName,snapshot},history=Array.isArray(details.debtResetHistory)?details.debtResetHistory:[];const installments=Array.isArray(details.installments)?(details.installments as Array<Record<string,unknown>>).map((item)=>({...item,remainingAmount:0,status:"Debt Reset"})):[];await db.prepare("UPDATE student_records SET status='Debt Reset',custom_data=? WHERE id=?").bind(JSON.stringify({...details,due:0,installments,debtReset,debtResetHistory:[...history,debtReset]}),id).run();return Response.json({ok:true,debtReset});
    }
    if(action==="cancelDebtReset"){
      const id=Number(payload.id),record=await db.prepare("SELECT status,custom_data AS customData FROM student_records WHERE id=? AND kind='payment'").bind(id).first<{status:string;customData:string}>();if(!record)return Response.json({error:"سجل تصفير المديونية غير موجود"},{status:404});let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}const reset=details.debtReset as Record<string,unknown>|undefined,snapshot=reset?.snapshot as Record<string,unknown>|undefined;if(!reset?.active||!snapshot)return Response.json({error:"عملية التصفير ملغاة بالفعل أو غير موجودة"},{status:409});const cancelled={...reset,active:false,cancelledAt:new Date().toISOString(),cancelledById:sessionEmployee.id,cancelledBy:sessionEmployee.fullName},history=(Array.isArray(details.debtResetHistory)?details.debtResetHistory as Array<Record<string,unknown>>:[]).map((item)=>item.id===reset.id?cancelled:item);await db.prepare("UPDATE student_records SET status=?,custom_data=? WHERE id=?").bind(String(snapshot.status||"Partial"),JSON.stringify({...details,due:Number(snapshot.due||0),installments:Array.isArray(snapshot.installments)?snapshot.installments:[],debtReset:cancelled,debtResetHistory:history}),id).run();return Response.json({ok:true});
    }
    if(action==="transferPayment"){
      const id=Number(payload.id),transferType=String(payload.transferType||""),amount=Number(payload.amount),reason=String(payload.reason||"").trim(),targetMobileInput=String(payload.targetMobile||"").trim(),targetTrackId=Number(payload.targetTrackId)||null;
      if(!["student","track"].includes(transferType))return Response.json({error:"نوع التحويل غير صحيح"},{status:400});
      if(!reason||!targetMobileInput||!Number.isFinite(amount)||amount<=0)return Response.json({error:"رقم الطالب المستلم والسبب والمبلغ المحول مطلوبون"},{status:400});
      const record=await db.prepare("SELECT sr.student_id AS studentId,s.full_name AS studentName,s.mobile,s.track_id AS trackId,t.title AS trackName,sr.custom_data AS customData FROM student_records sr JOIN students s ON s.id=sr.student_id LEFT JOIN tracks t ON t.id=s.track_id WHERE sr.id=? AND sr.kind='payment'").bind(id).first<{studentId:number;studentName:string;mobile:string;trackId:number|null;trackName:string|null;customData:string}>();if(!record)return Response.json({error:"الإيصال غير موجود"},{status:404});
      let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}if(details.voided)return Response.json({error:"لا يمكن التحويل من إيصال ملغي"},{status:409});if((Array.isArray(details.refunds)&&details.refunds.length)||details.refundLocked)return Response.json({error:"لا يمكن التحويل من إيصال تم عمل Refund له"},{status:409});
      const targetPhone=normalizePhone(targetMobileInput);if(targetPhone.length<7)return Response.json({error:"اكتب رقم موبايل صحيح للطالب المستلم"},{status:400});const allStudents=await db.prepare("SELECT id,full_name AS fullName,mobile,secondary_mobile AS secondaryMobile,track_id AS trackId FROM students").all<{id:number;fullName:string;mobile:string;secondaryMobile:string;trackId:number|null}>(),targetStudent=allStudents.results.find((student)=>normalizePhone(student.mobile)===targetPhone||Boolean(student.secondaryMobile)&&normalizePhone(student.secondaryMobile)===targetPhone);if(!targetStudent)return Response.json({error:"رقم التحويل غير مسجل لطالب على السيستم"},{status:404});if(transferType==="student"&&targetStudent.id===record.studentId)return Response.json({error:"اختر رقم طالب آخر للتحويل إليه"},{status:400});
      let targetTrack:{id:number;title:string}|null=null;if(transferType==="track"){if(!targetTrackId)return Response.json({error:"اختر الـTrack المحول إليه"},{status:400});targetTrack=await db.prepare("SELECT id,title FROM tracks WHERE id=? AND is_active=1").bind(targetTrackId).first<{id:number;title:string}>()||null;if(!targetTrack)return Response.json({error:"الـTrack المحول إليه غير موجود أو غير نشط"},{status:404});if(Number(record.trackId)===targetTrack.id&&targetStudent.id===record.studentId)return Response.json({error:"الطالب موجود بالفعل في نفس الـTrack؛ اختر Track آخر"},{status:409})}
      const main=String(details.main||"");if(!main)return Response.json({error:"رقم الـMain غير موجود على الإيصال"},{status:409});const [mainPayments,previous]=await Promise.all([db.prepare("SELECT custom_data AS customData FROM student_records WHERE student_id=? AND kind='payment' AND json_extract(custom_data,'$.main')=?").bind(record.studentId,main).all<{customData:string}>(),db.prepare("SELECT custom_data AS customData FROM student_records WHERE kind='payment_transfer' AND CAST(json_extract(custom_data,'$.sourceStudentId') AS INTEGER)=? AND json_extract(custom_data,'$.main')=? AND status<>'Cancelled'").bind(record.studentId,main).all<{customData:string}>()]),mainPaidTotal=mainPayments.results.reduce((sum,item)=>{try{const value=JSON.parse(item.customData||"{}") as Record<string,unknown>;return value.voided?sum:sum+Math.max(0,Number(value.paid||0)-Number(value.refunded||0))}catch{return sum}},0),alreadyTransferred=previous.results.reduce((sum,item)=>{try{return sum+Number((JSON.parse(item.customData||"{}") as Record<string,unknown>).amount||0)}catch{return sum}},0),available=Math.max(0,mainPaidTotal-alreadyTransferred);
      if(amount-available>.01)return Response.json({error:`المبلغ المحول لا يمكن أن يزيد عن ${available.toLocaleString()} EGP`},{status:409});
      const paymentRows=await db.prepare("SELECT id,custom_data AS customData FROM student_records WHERE student_id=? AND kind='payment'").bind(record.studentId).all<{id:number;customData:string}>(),offerRows=await db.prepare("SELECT id,custom_data AS customData FROM settings_entities WHERE kind='offer'").all<{id:number;customData:string}>(),offerLevels=new Map<number,number>();for(const offer of offerRows.results){try{offerLevels.set(offer.id,Math.max(0,Number((JSON.parse(offer.customData||"{}") as Record<string,unknown>).levels)||0))}catch{}}
      let bookedLevels=0,mainRecordId=id,mainDetails=details;for(const payment of paymentRows.results){try{const item=JSON.parse(payment.customData||"{}") as Record<string,unknown>;if(item.isMainPayment&&!item.voided){bookedLevels+=Math.max(0,(Number(item.levels??offerLevels.get(Number(item.offerId))??0)||0)-Number(item.refundedLevels||0)-Number(item.transferredLevels||0));if(!details.isMainPayment&&item.main===details.main){mainRecordId=payment.id;mainDetails=item}}}catch{}}const requiredLevels=Math.max(1,Math.ceil(amount/1000));if(requiredLevels>bookedLevels)return Response.json({error:`قيمة التحويل تحتاج ${requiredLevels} مستوى، بينما المتاح في اشتراكات الطالب ${bookedLevels} فقط`},{status:409});
      const memberRows=await db.prepare("SELECT gm.id,gm.group_id AS groupId,se.custom_data AS customData FROM group_members gm JOIN settings_entities se ON se.id=gm.group_id WHERE gm.student_reference=?").bind(String(record.studentId)).all<{id:number;groupId:number;customData:string}>(),remainingLevels=Math.max(0,bookedLevels-memberRows.results.length),groupsToRemove=Math.max(0,requiredLevels-remainingLevels),removable=memberRows.results.map((item)=>{let groupDetails:Record<string,unknown>={};try{groupDetails=JSON.parse(item.customData||"{}")}catch{}return {...item,sequence:Number(groupDetails.sequenceIndex)||0,startDate:String(groupDetails.startDate||"")}}).sort((a,b)=>b.sequence-a.sequence||b.startDate.localeCompare(a.startDate)||b.groupId-a.groupId).slice(0,groupsToRemove);if(removable.length<groupsToRemove)return Response.json({error:`التحويل يحتاج تسوية ${requiredLevels} مستوى، وتعذر إخراج عدد الجروبات المطلوب من ملف الطالب`},{status:409});
      const createdAt=new Date().toISOString(),paymentType=transferType==="student"?"Transfer to another student":"Transfer to another Track",targetTrackName=targetTrack?.title||(await db.prepare("SELECT title FROM tracks WHERE id=?").bind(targetStudent.trackId).first<{title:string}>())?.title||"",removedGroupIds=removable.map((item)=>item.groupId),transferDetails={transferType,paymentType,sourcePaymentId:id,main:details.main||"",invoice:details.invoice||"",sourceStudentId:record.studentId,sourceStudentName:record.studentName,sourceMobile:record.mobile,sourceTrackId:record.trackId,sourceTrackName:record.trackName||"",targetStudentId:targetStudent.id,targetStudentName:targetStudent.fullName,targetMobile:targetStudent.mobile,targetTrackId:targetTrack?.id||targetStudent.trackId||null,targetTrackName,amount:Number(amount.toFixed(2)),reason,levels:requiredLevels,removedGroupIds,createdById:sessionEmployee.id,createdByName:sessionEmployee.fullName,createdAt,excludedFromRevenue:true};
      const inserted=await db.prepare("INSERT INTO student_records (student_id,kind,record_date,status,notes,custom_data) VALUES (?,'payment_transfer',?,'Transferred',?,?)").bind(record.studentId,createdAt,reason,JSON.stringify(transferDetails)).run(),transferredAmount=Number((Number(details.transferredAmount||0)+amount).toFixed(2)),history=Array.isArray(details.transferHistory)?details.transferHistory:[],receiptDetails={...details,transferredAmount,transferHistory:[...history,{transferRecordId:Number(inserted.meta.last_row_id),...transferDetails}]},updatedMainDetails={...mainDetails,transferredLevels:Number(mainDetails.transferredLevels||0)+requiredLevels},statements=removable.map((item)=>db.prepare("DELETE FROM group_members WHERE id=?").bind(item.id));if(mainRecordId===id)statements.push(db.prepare("UPDATE student_records SET status='Transferred',custom_data=? WHERE id=?").bind(JSON.stringify({...receiptDetails,transferredLevels:updatedMainDetails.transferredLevels}),id));else statements.push(db.prepare("UPDATE student_records SET status='Transferred',custom_data=? WHERE id=?").bind(JSON.stringify(receiptDetails),id),db.prepare("UPDATE student_records SET custom_data=? WHERE id=?").bind(JSON.stringify(updatedMainDetails),mainRecordId));await db.batch(statements);return Response.json({id:inserted.meta.last_row_id,paymentType,mainPaidTotal,available:Number((available-amount).toFixed(2)),requiredLevels,removedGroupIds},{status:201});
    }
    if(action==="refundPayment"){
      const id=Number(payload.id),amount=Number(payload.amount),reason=String(payload.reason||"").trim(),payoutDate=String(payload.payoutDate||"");
      const record=await db.prepare("SELECT student_id AS studentId,custom_data AS customData FROM student_records WHERE id=? AND kind='payment'").bind(id).first<{studentId:number;customData:string}>();if(!record)return Response.json({error:"الإيصال غير موجود"},{status:404});
      let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}if(details.voided)return Response.json({error:"لا يمكن عمل Refund لإيصال ملغي"},{status:400});
      const refunds=Array.isArray(details.refunds)?details.refunds as Array<Record<string,unknown>>:[],refunded=refunds.reduce((sum,item)=>sum+Number(item.amount||0),0),available=Math.max(0,Number(details.paid||0)-refunded-Number(details.transferredAmount||0));
      if(refunds.length||details.refundLocked)return Response.json({error:"تم عمل Refund لهذا الإيصال بالفعل ولا يمكن تعديله أو عمل Refund آخر"},{status:409});
      if(!reason||!payoutDate||!Number.isFinite(amount)||amount<=0||amount-available>.01)return Response.json({error:`سبب الريفند وتاريخ الصرف ومبلغ لا يزيد عن ${available.toLocaleString()} EGP مطلوبة`},{status:400});
      const requiredLevels=Math.max(1,Math.ceil(amount/1000)),paymentRows=await db.prepare("SELECT id,custom_data AS customData FROM student_records WHERE student_id=? AND kind='payment'").bind(record.studentId).all<{id:number;customData:string}>(),offerRows=await db.prepare("SELECT id,custom_data AS customData FROM settings_entities WHERE kind='offer'").all<{id:number;customData:string}>(),offerLevels=new Map<number,number>();for(const offer of offerRows.results){try{offerLevels.set(offer.id,Math.max(0,Number((JSON.parse(offer.customData||"{}") as Record<string,unknown>).levels)||0))}catch{}}
      let bookedLevels=0,mainRecordId=id,mainDetails=details;for(const payment of paymentRows.results){try{const item=JSON.parse(payment.customData||"{}") as Record<string,unknown>;if(item.isMainPayment&&!item.voided){bookedLevels+=Math.max(0,(Number(item.levels??offerLevels.get(Number(item.offerId))??0)||0)-Number(item.refundedLevels||0)-Number(item.transferredLevels||0));if(!details.isMainPayment&&item.main===details.main){mainRecordId=payment.id;mainDetails=item}}}catch{}}
      if(requiredLevels>bookedLevels)return Response.json({error:`قيمة الريفند تحتاج ${requiredLevels} مستوى، بينما المتاح في اشتراكات الطالب ${bookedLevels} فقط`},{status:409});
      const memberRows=await db.prepare("SELECT gm.id,gm.group_id AS groupId,se.custom_data AS customData FROM group_members gm JOIN settings_entities se ON se.id=gm.group_id WHERE gm.student_reference=?").bind(String(record.studentId)).all<{id:number;groupId:number;customData:string}>(),remainingLevels=Math.max(0,bookedLevels-memberRows.results.length),groupsToRemove=Math.max(0,requiredLevels-remainingLevels),removable=memberRows.results.map((item)=>{let groupDetails:Record<string,unknown>={};try{groupDetails=JSON.parse(item.customData||"{}")}catch{}return {...item,sequence:Number(groupDetails.sequenceIndex)||0,startDate:String(groupDetails.startDate||"")}}).sort((a,b)=>b.sequence-a.sequence||b.startDate.localeCompare(a.startDate)||b.groupId-a.groupId).slice(0,groupsToRemove);
      if(removable.length<groupsToRemove)return Response.json({error:`يلزم توفير ${requiredLevels} مستوى Remaining قبل الريفند. تعذر إخراج العدد المطلوب من الجروبات`},{status:409});
      const removedGroupIds=removable.map((item)=>item.groupId),refund={id:1,amount,reason,payoutDate,status:"Refunded",levels:requiredLevels,removedGroupIds,createdAt:new Date().toISOString(),createdById:sessionEmployee?.id||null,createdBy:sessionEmployee?.fullName||"System"},receiptDetails={...details,refunds:[refund],refunded:Number(amount.toFixed(2)),netPaid:Number((Number(details.paid||0)-amount).toFixed(2)),refundLocked:true,refundStatus:"Refunded"},updatedMainDetails={...mainDetails,refundedLevels:Number(mainDetails.refundedLevels||0)+requiredLevels};
      const statements=removable.map((item)=>db.prepare("DELETE FROM group_members WHERE id=?").bind(item.id));if(mainRecordId===id)statements.push(db.prepare("UPDATE student_records SET status='Refunded',custom_data=? WHERE id=?").bind(JSON.stringify({...receiptDetails,refundedLevels:updatedMainDetails.refundedLevels}),id));else statements.push(db.prepare("UPDATE student_records SET status='Refunded',custom_data=? WHERE id=?").bind(JSON.stringify(receiptDetails),id),db.prepare("UPDATE student_records SET custom_data=? WHERE id=?").bind(JSON.stringify(updatedMainDetails),mainRecordId));await db.batch(statements);
      return Response.json({ok:true,refund,requiredLevels,removedGroupIds},{status:201});
    }
    if(action==="cancelRefund"){
      const id=Number(payload.id),record=await db.prepare("SELECT student_id AS studentId,status,custom_data AS customData FROM student_records WHERE id=? AND kind='payment'").bind(id).first<{studentId:number;status:string;customData:string}>();if(!record)return Response.json({error:"الإيصال غير موجود"},{status:404});let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}const refunds=Array.isArray(details.refunds)?details.refunds as Array<Record<string,unknown>>:[],refund=refunds.find((item)=>String(item.status||"Refunded")==="Refunded");if(!refund)return Response.json({error:"لا يوجد Refund فعال لإلغائه"},{status:409});const paymentRows=await db.prepare("SELECT id,custom_data AS customData,status FROM student_records WHERE student_id=? AND kind='payment'").bind(record.studentId).all<{id:number;customData:string;status:string}>();let mainRecordId=id,mainDetails=details,mainStatus=record.status;for(const payment of paymentRows.results){try{const item=JSON.parse(payment.customData||"{}") as Record<string,unknown>;if(item.isMainPayment&&item.main===details.main){mainRecordId=payment.id;mainDetails=item;mainStatus=payment.status;break}}catch{}}const cancelledRefund={...refund,status:"Cancelled",cancelledAt:new Date().toISOString(),cancelledById:sessionEmployee.id,cancelledBy:sessionEmployee.fullName},history=[...(Array.isArray(details.refundHistory)?details.refundHistory as Array<Record<string,unknown>>:[]),cancelledRefund],receiptDetails={...details,refunds:[],refundHistory:history,refunded:0,netPaid:Number(details.paid||0),refundLocked:false,refundStatus:"Cancelled"};const refundedLevels=Number(refund.levels||0),mainUpdated={...mainDetails,refundedLevels:Math.max(0,Number(mainDetails.refundedLevels||0)-refundedLevels)},groupIds=Array.isArray(refund.removedGroupIds)?refund.removedGroupIds.map(Number).filter(Boolean):[];for(const groupId of groupIds){const group=await db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE id=? AND kind='group'").bind(groupId).first<{customData:string}>();if(!group)return Response.json({error:`لا يمكن إلغاء الريفند لأن الجروب #${groupId} لم يعد موجودًا`},{status:409});let groupDetails:Record<string,unknown>={};try{groupDetails=JSON.parse(group.customData||"{}")}catch{}const [level,studyType,classroom,count]=await Promise.all([db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE id=? AND kind='level'").bind(Number(groupDetails.levelId)).first<{customData:string}>(),db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE id=? AND kind='study_type'").bind(Number(groupDetails.studyTypeId)).first<{customData:string}>(),db.prepare("SELECT capacity FROM classrooms WHERE id=? AND is_active=1").bind(Number(groupDetails.classroomId)).first<{capacity:number}>(),db.prepare("SELECT COUNT(*) AS count FROM group_members WHERE group_id=?").bind(groupId).first<{count:number}>()]);let levelDetails:Record<string,unknown>={},studyDetails:Record<string,unknown>={};try{levelDetails=JSON.parse(level?.customData||"{}")}catch{}try{studyDetails=JSON.parse(studyType?.customData||"{}")}catch{}const maximum=Math.min(Math.max(1,Number(levelDetails.maxStudents)||12),Math.max(1,Number(studyDetails.maxStudents)||12),Math.max(1,Number(classroom?.capacity)||1));if(Number(count?.count||0)>=maximum)return Response.json({error:`لا يمكن إلغاء الريفند لأن الجروب #${groupId} مكتمل (${maximum} طالب). وفر مكانًا أولًا ثم أعد المحاولة`},{status:409})}const statements=groupIds.map((groupId)=>db.prepare("INSERT OR IGNORE INTO group_members (group_id,student_reference,added_by_employee_id,added_by_name,joined_at) SELECT id,?,?,?,? FROM settings_entities WHERE id=? AND kind='group'").bind(String(record.studentId),sessionEmployee.id,sessionEmployee.fullName,new Date().toISOString(),groupId));if(mainRecordId===id){const restored={...receiptDetails,refundedLevels:Math.max(0,Number(details.refundedLevels||0)-refundedLevels)};statements.push(db.prepare("UPDATE student_records SET status=?,custom_data=? WHERE id=?").bind(Number(restored.due||0)<=.01?"Paid":"Partial",JSON.stringify(restored),id))}else{statements.push(db.prepare("UPDATE student_records SET status='Paid',custom_data=? WHERE id=?").bind(JSON.stringify(receiptDetails),id),db.prepare("UPDATE student_records SET status=?,custom_data=? WHERE id=?").bind(mainStatus==="Refunded"?(Number(mainUpdated.due||0)<=.01?"Paid":"Partial"):mainStatus,JSON.stringify(mainUpdated),mainRecordId))}await db.batch(statements);return Response.json({ok:true,restoredGroupIds:groupIds});
    }
    if(action==="updatePaymentReceipt"){
      const id=Number(payload.id),record=await db.prepare("SELECT student_id AS studentId,record_date AS recordDate,notes,custom_data AS customData FROM student_records WHERE id=? AND kind='payment'").bind(id).first<{studentId:number;recordDate:string;notes:string;customData:string}>();if(!record)return Response.json({error:"الإيصال غير موجود"},{status:404});
      let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}if((Array.isArray(details.refunds)&&details.refunds.length)||details.refundLocked)return Response.json({error:"لا يمكن تعديل إيصال تم عمل Refund له"},{status:409});const total=Number(payload.total),paid=Number(payload.paid),refunded=Number(details.refunded||0),method=String(payload.method||"").trim(),reference=String(payload.reference||"").trim(),recordDate=String(payload.recordDate||record.recordDate),offer=String(payload.offer||details.offer||"").trim(),addedById=Number(payload.addedById)||null,addedBy=addedById?(await db.prepare("SELECT full_name AS fullName FROM employees WHERE id=?").bind(addedById).first<{fullName:string}>())?.fullName||String(details.addedBy||"System"):String(details.addedBy||"System");
      if(!Number.isFinite(total)||total<0||!Number.isFinite(paid)||paid<0||paid>total||paid<refunded+Number(details.transferredAmount||0))return Response.json({error:"المبالغ غير صحيحة، والمدفوع لا يمكن أن يقل عن إجمالي الريفند والتحويلات المسجلة"},{status:400});
      const paymentMethod=await db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE kind='payment_method' AND title=? AND is_active=1").bind(method).first<{customData:string}>();if(!paymentMethod)return Response.json({error:"اختر وسيلة دفع صحيحة"},{status:400});let paymentMethodDetails:Record<string,unknown>={};try{paymentMethodDetails=JSON.parse(paymentMethod.customData||"{}")}catch{}if(String(paymentMethodDetails.reference||"No").toLowerCase()==="yes"&&!reference)return Response.json({error:"رقم المرجع مطلوب لطريقة الدفع المختارة"},{status:400});
      let due=Math.max(0,total-paid),status=due<=.01?"Paid":"Partial",installments=Array.isArray(details.installments)?details.installments.map((item)=>({...item as Record<string,unknown>})):[];
      if(details.isMainPayment&&installments.length){const collected=installments.reduce((sum,item)=>sum+Number(item.paidAmount||0),0),targetSchedule=Math.max(0,total-paid);if(targetSchedule+.01<collected)return Response.json({error:`لا يمكن تقليل المديونية عن المبلغ المحصل من الأقساط (${collected.toLocaleString()} EGP)`},{status:400});let remainingTarget=Number((targetSchedule-collected).toFixed(2)),currentRemaining=installments.reduce((sum,item)=>sum+Math.max(0,Number(item.remainingAmount??(Number(item.amount||0)-Number(item.paidAmount||0)))),0);installments=installments.map((item,index)=>{const itemPaid=Number(item.paidAmount||0),oldRemaining=Math.max(0,Number(item.remainingAmount??(Number(item.amount||0)-itemPaid))),newRemaining=index===installments.length-1?remainingTarget:currentRemaining>0?Number((remainingTarget*(oldRemaining/currentRemaining)).toFixed(2)):0;remainingTarget=Number((remainingTarget-newRemaining).toFixed(2));return {...item,amount:Number((itemPaid+newRemaining).toFixed(2)),remainingAmount:newRemaining,status:newRemaining<=.01?"Paid":itemPaid>0?"Partial":"Pending"}});due=installments.reduce((sum,item)=>sum+Number(item.remainingAmount||0),0);status=due<=.01?"Paid":"Partial"}
      if(details.isDebtPayment){const candidates=await db.prepare("SELECT id,custom_data AS customData FROM student_records WHERE student_id=? AND kind='payment'").bind(record.studentId).all<{id:number;customData:string}>();let mainRecord:{id:number;customData:string}|undefined,mainDetails:Record<string,unknown>={};for(const item of candidates.results){try{const parsed=JSON.parse(item.customData||"{}");if(parsed.isMainPayment&&parsed.main===details.main){mainRecord=item;mainDetails=parsed;break}}catch{}}if(!mainRecord)return Response.json({error:"السجل الرئيسي للمديونية غير موجود"},{status:404});installments=Array.isArray(mainDetails.installments)?mainDetails.installments.map((item)=>({...item as Record<string,unknown>})):[];const oldAllocations=Array.isArray(details.allocations)?details.allocations as Array<Record<string,unknown>>:[];oldAllocations.forEach((allocation)=>{const item=installments.find((entry)=>Number(entry.number)===Number(allocation.installmentNumber));if(!item)return;item.paidAmount=Math.max(0,Number(item.paidAmount||0)-Number(allocation.amount||0));item.remainingAmount=Math.max(0,Number(item.amount||0)-Number(item.paidAmount||0));item.collections=(Array.isArray(item.collections)?item.collections as Array<Record<string,unknown>>:[]).filter((entry)=>entry.invoice!==details.invoice)});const startIndex=Math.max(0,installments.findIndex((item)=>Number(item.number)===Number(details.installmentNumber))),available=installments.slice(startIndex).reduce((sum,item)=>sum+Number((item.remainingAmount??item.amount)||0),0);if(paid-available>.01)return Response.json({error:`المبلغ لا يمكن أن يزيد عن المديونية المتاحة (${available.toLocaleString()} EGP)`},{status:400});let balance=paid;const allocations:Array<Record<string,unknown>>=[];for(let index=startIndex;index<installments.length&&balance>.001;index++){const item=installments[index],remaining=Number((item.remainingAmount??item.amount)||0);if(remaining<=.001)continue;const applied=Math.min(balance,remaining);item.paidAmount=Number((Number(item.paidAmount||0)+applied).toFixed(2));item.remainingAmount=Number((remaining-applied).toFixed(2));item.status=Number(item.remainingAmount)<=.01?"Paid":"Partial";const collections=Array.isArray(item.collections)?item.collections:[];item.collections=[...collections,{invoice:details.invoice,amount:applied,paidAt:recordDate,method,reference,collectedBy:addedBy}];item.invoice=details.invoice;item.collectedBy=addedBy;allocations.push({installmentNumber:item.number,amount:applied});balance=Number((balance-applied).toFixed(2))}due=installments.reduce((sum,item)=>sum+Number((item.remainingAmount??item.amount)||0),0);await db.prepare("UPDATE student_records SET status=?,custom_data=? WHERE id=?").bind(due<=.01?"Paid":"Partial",JSON.stringify({...mainDetails,due,installments}),mainRecord.id).run();details.allocations=allocations;status="Paid"}
      const updated={...details,offer,total,paid,due,method,reference,addedById,addedBy,netPaid:Number((paid-refunded).toFixed(2)),...(details.isMainPayment?{installments}: {})};await db.prepare("UPDATE student_records SET record_date=?,status=?,notes=?,custom_data=? WHERE id=?").bind(recordDate,status,String(payload.notes??record.notes),JSON.stringify(updated),id).run();return Response.json({ok:true});
    }
    if(action==="voidPaymentReceipt"){
      const id=Number(payload.id),record=await db.prepare("SELECT student_id AS studentId,status,custom_data AS customData FROM student_records WHERE id=? AND kind='payment'").bind(id).first<{studentId:number;status:string;customData:string}>();if(!record)return Response.json({error:"الإيصال غير موجود"},{status:404});
      let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}if(details.voided)return Response.json({error:"الإيصال ملغي بالفعل"},{status:400});if((Array.isArray(details.refunds)&&details.refunds.length)||details.refundLocked)return Response.json({error:"لا يمكن حذف إيصال تم عمل Refund له"},{status:409});if(Number(details.transferredAmount||0)>0)return Response.json({error:"لا يمكن حذف إيصال مرتبط بتحويل مالي"},{status:409});
      if(details.isMainPayment){const related=await db.prepare("SELECT id,custom_data AS customData FROM student_records WHERE student_id=? AND kind='payment' AND id<>?").bind(record.studentId,id).all<{id:number;customData:string}>(),activeRelated=related.results.some((item)=>{try{const value=JSON.parse(item.customData||"{}");return value.main===details.main}catch{return false}});if(activeRelated)return Response.json({error:"لا يمكن حذف الإيصال الرئيسي بعد وجود تحصيلات عليه. احذف آخر إيصالات التحصيل أولًا"},{status:409});await db.prepare("DELETE FROM student_records WHERE id=?").bind(id).run();return Response.json({ok:true,deleted:true})}
      if(details.isDebtPayment){const candidates=await db.prepare("SELECT id,custom_data AS customData FROM student_records WHERE student_id=? AND kind='payment'").bind(record.studentId).all<{id:number;customData:string}>();let mainRecord:{id:number;customData:string}|undefined,mainDetails:Record<string,unknown>={};for(const item of candidates.results){try{const parsed=JSON.parse(item.customData||"{}");if(parsed.isMainPayment&&parsed.main===details.main){mainRecord=item;mainDetails=parsed;break}}catch{}}if(!mainRecord)return Response.json({error:"السجل الرئيسي للمديونية غير موجود"},{status:404});const installments=Array.isArray(mainDetails.installments)?mainDetails.installments.map((item)=>({...item as Record<string,unknown>})):[];let allocations=Array.isArray(details.allocations)?details.allocations as Array<Record<string,unknown>>:[];if(!allocations.length){const legacyInstallment=installments.find((item)=>item.invoice===details.invoice||Number(item.number)===Number(details.installmentNumber));if(legacyInstallment)allocations=[{installmentNumber:legacyInstallment.number,amount:details.paid||legacyInstallment.paidAmount||legacyInstallment.amount||0}]}allocations.forEach((allocation)=>{const installment=installments.find((item)=>Number(item.number)===Number(allocation.installmentNumber));if(!installment)return;const newPaid=Math.max(0,Number(installment.paidAmount||0)-Number(allocation.amount||0));installment.paidAmount=Number(newPaid.toFixed(2));installment.remainingAmount=Number((Number(installment.amount||0)-newPaid).toFixed(2));installment.status=newPaid<=.01?"Pending":"Partial";installment.collections=(Array.isArray(installment.collections)?installment.collections as Array<Record<string,unknown>>:[]).filter((item)=>item.invoice!==details.invoice);if(!installment.collections.length){delete installment.invoice;delete installment.collectedBy;delete installment.paidAt;delete installment.lastPaidAt}});const due=installments.reduce((sum,item)=>sum+Math.max(0,Number((item.remainingAmount??item.amount)||0)),0);await db.batch([db.prepare("UPDATE student_records SET status=?,custom_data=? WHERE id=?").bind(due<=.01?"Paid":"Partial",JSON.stringify({...mainDetails,due,installments}),mainRecord.id),db.prepare("DELETE FROM student_records WHERE id=?").bind(id)]);return Response.json({ok:true,deleted:true})}
      await db.prepare("DELETE FROM student_records WHERE id=?").bind(id).run();return Response.json({ok:true,deleted:true});
    }
    if(action==="updateStudentRecord"){const id=Number(payload.id);await db.prepare("UPDATE student_records SET record_date=?,status=?,notes=?,custom_data=? WHERE id=?").bind(String(payload.recordDate??new Date().toISOString()),String(payload.status??""),String(payload.notes??""),JSON.stringify(payload.customData??{}),id).run();return Response.json({ok:true})}
    if(action==="completePlacementTest"){
      const id=Number(payload.id),levelId=Number(payload.levelId),languageScore=Number(payload.languageScore),computerResult=Number(payload.computerResult);
      if(!id||!levelId||!Number.isFinite(languageScore)||languageScore<0||languageScore>100||!Number.isFinite(computerResult)||computerResult<0||computerResult>100)return Response.json({error:"المستوى والنتائج من 0 إلى 100 مطلوبة"},{status:400});
      const record=await db.prepare("SELECT student_id AS studentId, custom_data AS customData FROM student_records WHERE id=? AND kind='placement'").bind(id).first<{studentId:number;customData:string}>();
      const level=await db.prepare("SELECT title FROM settings_entities WHERE id=? AND kind='level' AND is_active=1").bind(levelId).first<{title:string}>();
      if(!record||!level)return Response.json({error:"طلب البليسمنت أو المستوى غير موجود"},{status:404});
      let details:Record<string,unknown>={};try{details=JSON.parse(record.customData||"{}")}catch{}
      details={...details,computerResult,languageScore,finalLevelId:levelId,finalLevelName:level.title,completedAt:new Date().toISOString()};
      await db.batch([db.prepare("UPDATE student_records SET status='Completed',notes=?,custom_data=? WHERE id=?").bind(String(payload.notes??""),JSON.stringify(details),id),db.prepare("UPDATE students SET level_id=? WHERE id=?").bind(levelId,record.studentId)]);
      return Response.json({ok:true,level:level.title});
    }
    if(action==="deleteStudentRecord"){await db.prepare("DELETE FROM student_records WHERE id=?").bind(Number(payload.id)).run();return Response.json({ok:true})}
    if (action === "createEmployee") {
      const fullName = String(payload.fullName ?? "").trim();
      const email = String(payload.email ?? "").trim().toLowerCase();
      if (!fullName || !email) return Response.json({ error: "الاسم والبريد الإلكتروني مطلوبان" }, { status: 400 });
      const requestedStatus = String(payload.status ?? "نشط");
      const departmentId=Number(payload.departmentId)||null;
      const phone = String(payload.phone ?? "").trim();
      if (!phone) return Response.json({ error: "رقم الموبايل مطلوب لأنه اسم المستخدم للدخول" }, { status: 400 });
      const duplicatePhone = await db.prepare("SELECT id FROM employees WHERE phone=?").bind(phone).first();
      if (duplicatePhone) return Response.json({ error: "رقم الموبايل مستخدم بالفعل كاسم دخول لموظف آخر" }, { status: 409 });
      const result = await db.prepare("INSERT INTO employees (hr_id, full_name, email, phone, password_hash, department_id, job_title_id, role_id, branch_id, status, custom_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind("PENDING", fullName, email, phone, await hashPassword("12345"), departmentId, Number(payload.jobTitleId) || null, Number(payload.roleId) || null, Number(payload.branchId) || null, requestedStatus, JSON.stringify(payload.customData ?? {})).run();
      const id=Number(result.meta.last_row_id); const department=departmentId?await db.prepare("SELECT name FROM departments WHERE id=?").bind(departmentId).first<{name:string}>():null;
      const prefix=(department?.name||"HR").replace(/\s+/g,"").slice(0,3).toUpperCase()||"HR"; const hrId=`${prefix}-${String(id).padStart(4,"0")}`;
      await db.prepare("UPDATE employees SET hr_id=? WHERE id=?").bind(hrId,id).run();
      return Response.json({ id,hrId }, { status: 201 });
    }

    if (action === "updateEmployee") {
      const id=Number(payload.id), fullName=String(payload.fullName??"").trim(), email=String(payload.email??"").trim().toLowerCase();
      if(!id||!fullName||!email)return Response.json({error:"الاسم والبريد الإلكتروني مطلوبان"},{status:400});
      const duplicate=await db.prepare("SELECT id FROM employees WHERE LOWER(email)=LOWER(?) AND id<>?").bind(email,id).first();
      if(duplicate)return Response.json({error:"البريد الإلكتروني مستخدم لموظف آخر"},{status:409});
      const phone=String(payload.phone??"").trim(); if(!phone)return Response.json({error:"رقم الموبايل مطلوب"},{status:400});
      const phoneDuplicate=await db.prepare("SELECT id FROM employees WHERE phone=? AND id<>?").bind(phone,id).first(); if(phoneDuplicate)return Response.json({error:"رقم الموبايل مستخدم بالفعل كاسم دخول لموظف آخر"},{status:409});
      await db.prepare("UPDATE employees SET full_name=?,email=?,phone=?,department_id=?,job_title_id=?,branch_id=?,status=?,custom_data=? WHERE id=?").bind(fullName,email,phone,Number(payload.departmentId)||null,Number(payload.jobTitleId)||null,Number(payload.branchId)||null,String(payload.status??"نشط"),JSON.stringify(payload.customData??{}),id).run();
      const currentHr=await db.prepare("SELECT hr_id AS hrId FROM employees WHERE id=?").bind(id).first<{hrId:string|null}>();
      if(!currentHr?.hrId){const departmentId=Number(payload.departmentId)||null,department=departmentId?await db.prepare("SELECT name FROM departments WHERE id=?").bind(departmentId).first<{name:string}>():null,prefix=(department?.name||"HR").replace(/\s+/g,"").slice(0,3).toUpperCase()||"HR";await db.prepare("UPDATE employees SET hr_id=? WHERE id=?").bind(`${prefix}-${String(id).padStart(4,"0")}`,id).run()}
      return Response.json({ok:true});
    }

    if (action === "resetEmployeePassword") {
      const id = Number(payload.id); const password = String(payload.password ?? "");
      if (!id || password.length < 5) return Response.json({ error: "أدخل كلمة مرور من 5 أحرف على الأقل" }, { status: 400 });
      await db.prepare("UPDATE employees SET password_hash=? WHERE id=?").bind(await hashPassword(password), id).run();
      await db.prepare("DELETE FROM employee_sessions WHERE employee_id=?").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "deactivateEmployee") {
      const id=Number(payload.id); if(!id)return Response.json({error:"الموظف غير محدد"},{status:400});
      await db.prepare("UPDATE employees SET status='موقوف' WHERE id=?").bind(id).run();
      return Response.json({ok:true});
    }

    if (action === "deleteEmployee") {
      const id=Number(payload.id);
      const usage=await db.prepare("SELECT (SELECT COUNT(*) FROM leads WHERE assigned_employee_id=?) + (SELECT COUNT(*) FROM call_records WHERE assigned_employee_id=?) + (SELECT COUNT(*) FROM followups WHERE assigned_employee_id=?) AS count").bind(id,id,id).first<{count:number}>();
      if((usage?.count??0)>0)return Response.json({error:"لا يمكن حذف موظف مرتبط بعملاء أو مكالمات أو متابعات. استخدم إيقاف الحساب بدلًا من ذلك."},{status:409});
      await db.prepare("DELETE FROM employees WHERE id=?").bind(id).run();
      return Response.json({ok:true});
    }

    if (action === "createBranch" || action === "updateBranch") {
      const name = String(payload.name ?? "").trim();
      const address = String(payload.address ?? "").trim();
      const primaryPhone = String(payload.primaryPhone ?? "").trim();
      if (!name || !address || !primaryPhone) return Response.json({ error: "اسم الفرع والعنوان ورقم الهاتف الأساسي مطلوبة" }, { status: 400 });
      const values = [name, address, normalizePhone(primaryPhone), normalizePhone(String(payload.secondaryPhone ?? "")), String(payload.email ?? "").trim().toLowerCase(), String(payload.socialUrl ?? "").trim(), String(payload.isActive ?? "نشط") === "غير نشط" ? 0 : 1, JSON.stringify(payload.customData ?? {})];
      if (action === "updateBranch") {
        await db.prepare("UPDATE branches SET name=?, address=?, primary_phone=?, secondary_phone=?, email=?, social_url=?, is_active=?, custom_data=? WHERE id=?").bind(...values, Number(payload.id)).run();
        return Response.json({ ok: true });
      }
      const result = await db.prepare("INSERT INTO branches (name, address, primary_phone, secondary_phone, email, social_url, is_active, custom_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(...values).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }

    if (action === "deleteBranch") {
      const id = Number(payload.id);
      const usage = await db.prepare("SELECT (SELECT COUNT(*) FROM employees WHERE branch_id=?) + (SELECT COUNT(*) FROM leads WHERE branch_id=?) + (SELECT COUNT(*) FROM call_records WHERE branch_id=?) + (SELECT COUNT(*) FROM classrooms WHERE branch_id=?) AS count").bind(id, id, id, id).first<{ count: number }>();
      if ((usage?.count ?? 0) > 0) return Response.json({ error: "لا يمكن حذف فرع مرتبط بموظفين أو عملاء أو مكالمات أو قاعات. يمكنك تعطيله بدلًا من ذلك." }, { status: 409 });
      await db.prepare("DELETE FROM branches WHERE id=?").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "createClassroom" || action === "updateClassroom") {
      const name = String(payload.name ?? "").trim();
      const branchId = Number(payload.branchId);
      const capacity = Number(payload.capacity);
      if (!name || !branchId || !Number.isInteger(capacity) || capacity < 1) return Response.json({ error: "اسم القاعة والفرع وسعة صحيحة مطلوبة" }, { status: 400 });
      const rawStatus = payload.isActive;
      const isActive = rawStatus === false || rawStatus === 0 || rawStatus === "0" || rawStatus === "غير نشط" || rawStatus === "inactive" ? 0 : 1;
      const customData = JSON.stringify(payload.customData ?? {});
      if (action === "updateClassroom") {
        await db.prepare("UPDATE classrooms SET name=?, branch_id=?, capacity=?, is_active=?, custom_data=? WHERE id=?").bind(name, branchId, capacity, isActive, customData, Number(payload.id)).run();
        return Response.json({ ok: true });
      }
      const result = await db.prepare("INSERT INTO classrooms (name, branch_id, capacity, is_active, custom_data) VALUES (?, ?, ?, ?, ?)").bind(name, branchId, capacity, isActive, customData).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }

    if (action === "deleteClassroom") {
      await db.prepare("DELETE FROM classrooms WHERE id=?").bind(Number(payload.id)).run();
      return Response.json({ ok: true });
    }

    if (action === "createTrack" || action === "updateTrack") {
      const title = String(payload.title ?? "").trim();
      if (!title) return Response.json({ error: "اسم الـTrack مطلوب" }, { status: 400 });
      const duplicate = await db.prepare("SELECT id FROM tracks WHERE LOWER(title)=LOWER(?) AND id<>?").bind(title, action === "updateTrack" ? Number(payload.id) : 0).first();
      if (duplicate) return Response.json({ error: "يوجد Track بنفس الاسم بالفعل" }, { status: 409 });
      const rawStatus = payload.isActive;
      const isActive = rawStatus === false || rawStatus === 0 || rawStatus === "0" || rawStatus === "غير نشط" || rawStatus === "inactive" ? 0 : 1;
      const customData = JSON.stringify(payload.customData ?? {});
      if (action === "updateTrack") {
        await db.prepare("UPDATE tracks SET title=?, is_active=?, custom_data=? WHERE id=?").bind(title, isActive, customData, Number(payload.id)).run();
        return Response.json({ ok: true });
      }
      const result = await db.prepare("INSERT INTO tracks (title, is_active, custom_data) VALUES (?, ?, ?)").bind(title, isActive, customData).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }

    if (action === "deleteTrack") {
      const id = Number(payload.id);
      const track = await db.prepare("SELECT title FROM tracks WHERE id=?").bind(id).first<{ title: string }>();
      if (!track) return Response.json({ error: "الـTrack غير موجود" }, { status: 404 });
      const usage = await db.prepare("SELECT COUNT(*) AS count FROM leads WHERE interest=?").bind(track.title).first<{ count: number }>();
      if ((usage?.count ?? 0) > 0) return Response.json({ error: "لا يمكن حذف Track مرتبط بعملاء. يمكنك تعطيله بدلًا من ذلك." }, { status: 409 });
      await db.prepare("DELETE FROM tracks WHERE id=?").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "createTimeSlot" || action === "updateTimeSlot") {
      const title = String(payload.title ?? "").trim();
      const trackId = Number(payload.trackId);
      const startTime = String(payload.startTime ?? "").trim();
      const endTime = String(payload.endTime ?? "").trim();
      const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!title || !trackId || !timePattern.test(startTime) || !timePattern.test(endTime)) return Response.json({ error: "الـTrack واسم الفترة ووقت بداية ونهاية صحيحان مطلوبون" }, { status: 400 });
      if (startTime >= endTime) return Response.json({ error: "وقت النهاية يجب أن يكون بعد وقت البداية" }, { status: 400 });
      const id = action === "updateTimeSlot" ? Number(payload.id) : 0;
      const duplicate = await db.prepare("SELECT id FROM time_slots WHERE track_id=? AND LOWER(title)=LOWER(?) AND id<>?").bind(trackId, title, id).first();
      if (duplicate) return Response.json({ error: "يوجد نظام وقت بنفس الاسم داخل هذا الـTrack" }, { status: 409 });
      const overlap = await db.prepare("SELECT id FROM time_slots WHERE id<>? AND track_id=? AND is_active=1 AND NOT (end_time<=? OR start_time>=?)").bind(id, trackId, startTime, endTime).first();
      const rawStatus = payload.isActive;
      const isActive = rawStatus === false || rawStatus === 0 || rawStatus === "0" || rawStatus === "غير نشط" || rawStatus === "inactive" ? 0 : 1;
      if (isActive && overlap) return Response.json({ error: "الفترة الزمنية تتداخل مع فترة نشطة موجودة" }, { status: 409 });
      const customData = JSON.stringify(payload.customData ?? {});
      if (action === "updateTimeSlot") {
        await db.prepare("UPDATE time_slots SET track_id=?, title=?, start_time=?, end_time=?, is_active=?, custom_data=? WHERE id=?").bind(trackId, title, startTime, endTime, isActive, customData, id).run();
        return Response.json({ ok: true });
      }
      const result = await db.prepare("INSERT INTO time_slots (track_id, title, start_time, end_time, is_active, custom_data) VALUES (?, ?, ?, ?, ?, ?)").bind(trackId, title, startTime, endTime, isActive, customData).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }

    if (action === "deleteTimeSlot") {
      await db.prepare("DELETE FROM time_slots WHERE id=?").bind(Number(payload.id)).run();
      return Response.json({ ok: true });
    }

    if(action==="assignGroupStaff") {
      const id=Number(payload.id), role=String(payload.role), employeeId=Number(payload.employeeId);
      if(!id||!["teacher","admin"].includes(role)||!employeeId) return Response.json({error:"بيانات الموظف غير مكتملة"},{status:400});
      const group=await db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE id=? AND kind='group'").bind(id).first<{customData:string}>();
      const employee=await db.prepare("SELECT e.id, COALESCE(j.name,'') AS jobTitle, COALESCE(d.name,'') AS department FROM employees e LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN departments d ON d.id=e.department_id WHERE e.id=? AND e.status IN ('active','نشط')").bind(employeeId).first<{id:number;jobTitle:string;department:string}>();
      if(!group||!employee) return Response.json({error:"الجروب أو الموظف غير موجود"},{status:404});
      const employeeScope=`${employee.jobTitle} ${employee.department}`.toLowerCase();
      if(role==="teacher"&&!/(english|german|انجليزى|انجليزي|الماني|ألماني)/i.test(employeeScope)) return Response.json({error:"اختيار المدرس متاح فقط لفريق English وGerman"},{status:400});
      if(role==="admin"&&!/(operation|operations|تشغيل|اوبريشن)/i.test(employeeScope)) return Response.json({error:"اختيار الأدمن متاح فقط لفريق Operations"},{status:400});
      const details=JSON.parse(group.customData||"{}") as Record<string,unknown>; details[`${role}Id`]=employeeId;
      await db.prepare("UPDATE settings_entities SET custom_data=? WHERE id=?").bind(JSON.stringify(details),id).run();
      if(role==="teacher"){const round=await db.prepare("SELECT title FROM settings_entities WHERE id=? AND kind='round'").bind(Number(details.roundId)).first<{title:string}>(),weekdays=scheduledWeekdays(String(details.startDate||""),round?.title||""),dayKey=weekdays.size===1&&weekdays.has(5)?"fri":weekdays.has(6)||weekdays.has(2)?"satTue":weekdays.has(0)||weekdays.has(3)?"sunWed":"monThu";await db.prepare("UPDATE settings_entities SET is_active=0 WHERE kind='office_hours' AND is_active=1 AND CAST(json_extract(custom_data,'$.teacherId') AS INTEGER)=? AND CAST(json_extract(custom_data,'$.timeSlotId') AS INTEGER)=? AND json_extract(custom_data,'$.dayKey')=?").bind(employeeId,Number(details.timeSlotId),dayKey).run()}
      return Response.json({ok:true});
    }

    if(action==="addGroupStudent") {
      const groupId=Number(payload.groupId),studentId=Number(payload.studentId);
      const group=await db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE id=? AND kind='group'").bind(groupId).first<{customData:string}>();
      const student=await db.prepare("SELECT id,level_id AS levelId FROM students WHERE id=?").bind(studentId).first<{id:number;levelId:number}>();
      if(!group||!student)return Response.json({error:"الجروب أو الطالب غير موجود"},{status:404});
      const details=JSON.parse(group.customData||"{}") as Record<string,unknown>;
      if(Number(details.levelId)!==Number(student.levelId))return Response.json({error:"لا يمكن إضافة الطالب لأن مستواه لا يطابق مستوى الجروب"},{status:409});
      const alreadyMember=await db.prepare("SELECT id FROM group_members WHERE group_id=? AND student_reference=?").bind(groupId,String(studentId)).first<{id:number}>();
      if(alreadyMember)return Response.json({error:"الطالب مسجل بالفعل في هذا الجروب"},{status:409});
      const capacityFor=async(targetGroupId:number,targetDetails:Record<string,unknown>)=>{
        const levelId=Number(targetDetails.levelId),classroomId=Number(targetDetails.classroomId),studyTypeId=Number(targetDetails.studyTypeId);
        const [level,classroom,studyType,count]=await Promise.all([
          db.prepare("SELECT title,custom_data AS customData FROM settings_entities WHERE id=? AND kind='level'").bind(levelId).first<{title:string;customData:string}>(),
          db.prepare("SELECT name,capacity FROM classrooms WHERE id=? AND is_active=1").bind(classroomId).first<{name:string;capacity:number}>(),
          db.prepare("SELECT title,custom_data AS customData FROM settings_entities WHERE id=? AND kind='study_type'").bind(studyTypeId).first<{title:string;customData:string}>(),
          db.prepare("SELECT COUNT(*) AS count FROM group_members WHERE group_id=?").bind(targetGroupId).first<{count:number}>(),
        ]);
        if(!level||!classroom||!studyType)return null;
        let levelDetails:Record<string,unknown>={},studyTypeDetails:Record<string,unknown>={};try{levelDetails=JSON.parse(level.customData||"{}")}catch{}try{studyTypeDetails=JSON.parse(studyType.customData||"{}")}catch{}
        const levelMaximum=Math.max(1,Number(levelDetails.maxStudents)||12),roomMaximum=Math.max(1,Number(classroom.capacity)||1),studyTypeMaximum=Math.max(1,Number(studyTypeDetails.maxStudents)||12),maximum=Math.min(levelMaximum,roomMaximum,studyTypeMaximum);
        return {maximum,current:Number(count?.count||0),levelMaximum,roomMaximum,studyTypeMaximum,levelName:level.title,roomName:classroom.name,studyTypeName:studyType.title};
      };
      const capacity=await capacityFor(groupId,details);
      if(!capacity)return Response.json({error:"لا يمكن التأكد من السعة: اختر Level وRoom صالحين للجروب أولًا"},{status:409});
      if(capacity.current>=capacity.maximum)return Response.json({error:`الجروب مكتمل: الحد الفعلي ${capacity.maximum} طالب (نظام ${capacity.studyTypeName}: ${capacity.studyTypeMaximum}، حد ${capacity.levelName}: ${capacity.levelMaximum}، وسعة ${capacity.roomName}: ${capacity.roomMaximum})`},{status:409});
      const paymentRows=await db.prepare("SELECT custom_data AS customData FROM student_records WHERE student_id=? AND kind='payment'").bind(studentId).all<{customData:string}>();
      const offerRows=await db.prepare("SELECT id,custom_data AS customData FROM settings_entities WHERE kind='offer'").all<{id:number;customData:string}>();
      const offerLevels=new Map<number,number>();for(const offer of offerRows.results){try{offerLevels.set(offer.id,Math.max(0,Number((JSON.parse(offer.customData||"{}") as Record<string,unknown>).levels)||0))}catch{}}
      let bookedLevels=0;for(const row of paymentRows.results){try{const payment=JSON.parse(row.customData||"{}") as Record<string,unknown>;if(payment.isMainPayment&&!payment.voided)bookedLevels+=Math.max(0,(Number(payment.levels??offerLevels.get(Number(payment.offerId))??0)||0)-Number(payment.refundedLevels||0)-Number(payment.transferredLevels||0))}catch{}}
      const membershipsBefore=await db.prepare("SELECT COUNT(*) AS count FROM group_members WHERE student_reference=?").bind(String(studentId)).first<{count:number}>();
      const usedLevels=Number(membershipsBefore?.count||0),remainingBefore=Math.max(0,bookedLevels-usedLevels);
      if(remainingBefore<=0)return Response.json({error:"لا يمكن إضافة الطالب إلى الجروب: لا توجد مستويات محجوزة أو Remaining متاح. يجب تسجيل Payment لعرض يحتوي على مستويات أولًا."},{status:409});
      const inserted=await db.prepare("INSERT OR IGNORE INTO group_members (group_id,student_reference,added_by_employee_id,added_by_name) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM group_members WHERE group_id=?)<?").bind(groupId,String(studentId),sessionEmployee.id,sessionEmployee.fullName,groupId,capacity.maximum).run();
      if(Number((inserted.meta as {changes?:number}).changes||0)===0)return Response.json({error:`تعذر إضافة الطالب لأن الجروب وصل إلى الحد الأقصى (${capacity.maximum})`},{status:409});
      const membershipCount=await db.prepare("SELECT COUNT(*) AS count FROM group_members WHERE student_reference=?").bind(String(studentId)).first<{count:number}>();
      let remainingSlots=Math.max(0,bookedLevels-Number(membershipCount?.count||0)),autoAdded=0,capacitySkipped=0;
      if(remainingSlots>0){
        const rootId=Number(details.progressionRootId)||groupId,currentSequence=Number(details.sequenceIndex)||0;
        const groupRows=await db.prepare("SELECT id,custom_data AS customData FROM settings_entities WHERE kind='group' AND is_active=1").all<{id:number;customData:string}>();
        const nextGroups=groupRows.results.map((item)=>{try{return {...item,details:JSON.parse(item.customData||"{}") as Record<string,unknown>}}catch{return {...item,details:{} as Record<string,unknown>}}}).filter((item)=>{const itemRoot=Number(item.details.progressionRootId)||item.id;return itemRoot===rootId&&Number(item.details.sequenceIndex)>currentSequence}).sort((a,b)=>Number(a.details.sequenceIndex)-Number(b.details.sequenceIndex));
        const existing=await db.prepare("SELECT group_id AS groupId FROM group_members WHERE student_reference=?").bind(String(studentId)).all<{groupId:number}>(),existingIds=new Set(existing.results.map((item)=>Number(item.groupId)));
        const targets=[] as Array<(typeof nextGroups)[number]&{maximum:number}>;
        for(const item of nextGroups){if(existingIds.has(item.id)||targets.length>=remainingSlots)continue;const targetCapacity=await capacityFor(item.id,item.details);if(targetCapacity&&targetCapacity.current<targetCapacity.maximum)targets.push({...item,maximum:targetCapacity.maximum});else capacitySkipped++}
        if(targets.length){const results=await db.batch(targets.map((item)=>db.prepare("INSERT OR IGNORE INTO group_members (group_id,student_reference,added_by_employee_id,added_by_name) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM group_members WHERE group_id=?)<?").bind(item.id,String(studentId),sessionEmployee.id,sessionEmployee.fullName,item.id,item.maximum)));autoAdded=results.reduce((sum,result)=>sum+Number((result.meta as {changes?:number}).changes||0),0);capacitySkipped+=targets.length-autoAdded}
      }
      return Response.json({ok:true,autoAdded,capacitySkipped,bookedLevels,remainingLevels:Math.max(0,bookedLevels-Number(membershipCount?.count||0)-autoAdded),message:capacitySkipped?`تمت الإضافة، وتعذر التصعيد إلى ${capacitySkipped} جروب مكتمل`:"تمت إضافة الطالب للجروب"},{status:201});
    }

    if(action==="removeGroupStudent") { await db.prepare("DELETE FROM group_members WHERE group_id=? AND student_reference=?").bind(Number(payload.groupId),String(payload.studentId)).run(); return Response.json({ok:true}); }

    if(action==="deleteEmptyGroups") {
      const batchId=Number(payload.batchId);
      if(!batchId)return Response.json({error:"اختر الباتش أولًا"},{status:400});
      const empty=await db.prepare("SELECT id FROM settings_entities WHERE kind='group' AND CAST(json_extract(custom_data,'$.batchId') AS INTEGER)=? AND NOT EXISTS (SELECT 1 FROM group_members WHERE group_members.group_id=settings_entities.id)").bind(batchId).all<{id:number}>();
      if(empty.results.length) await db.batch(empty.results.flatMap((group)=>[db.prepare("DELETE FROM group_members WHERE group_id=?").bind(group.id),db.prepare("DELETE FROM settings_entities WHERE id=?").bind(group.id)]));
      return Response.json({deleted:empty.results.length});
    }

    if(action==="updateGroupZoom") {
      const id=Number(payload.id), zoomUrl=String(payload.zoomUrl??"").trim();
      if(!id)return Response.json({error:"الجروب غير محدد"},{status:400});
      if(zoomUrl){try{const url=new URL(zoomUrl);if(!/^https?:$/.test(url.protocol))throw new Error()}catch{return Response.json({error:"أدخل رابط Zoom صحيح يبدأ بـ https://"},{status:400})}}
      const group=await db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE id=? AND kind='group'").bind(id).first<{customData:string}>();
      if(!group)return Response.json({error:"الجروب غير موجود"},{status:404});
      const details=JSON.parse(group.customData||"{}") as Record<string,unknown>; details.zoomUrl=zoomUrl;
      await db.prepare("UPDATE settings_entities SET custom_data=? WHERE id=?").bind(JSON.stringify(details),id).run();
      return Response.json({ok:true});
    }

    if(action==="importMarketingExpensesBatch"){
      const records=Array.isArray(payload.records)?payload.records as Array<Record<string,unknown>>:[];
      if(!records.length||records.length>100)return Response.json({error:"أرسل من 1 إلى 100 مصروف في كل دفعة"},{status:400});
      const importRunId=String(payload.importRunId||"").trim(),staged=Boolean(importRunId);
      if(staged&&!/^[a-zA-Z0-9_-]{8,100}$/.test(importRunId))return Response.json({error:"معرّف عملية الاستيراد غير صالح"},{status:400});
      const [branches,sources,existingRows]=await Promise.all([
        db.prepare("SELECT id FROM branches WHERE is_active=1").all<{id:number}>(),
        db.prepare("SELECT id FROM settings_entities WHERE kind='source' AND is_active=1").all<{id:number}>(),
        staged
          ?db.prepare("SELECT json_extract(custom_data,'$.importKey') AS importKey FROM settings_entities WHERE kind='marketing_expense' AND json_extract(custom_data,'$.importKey') IS NOT NULL AND (is_active=1 OR json_extract(custom_data,'$.importRunId')=?)").bind(importRunId).all<{importKey:string}>()
          :db.prepare("SELECT json_extract(custom_data,'$.importKey') AS importKey FROM settings_entities WHERE kind='marketing_expense' AND json_extract(custom_data,'$.importKey') IS NOT NULL").all<{importKey:string}>(),
      ]);
      const branchIds=new Set(branches.results.map((item)=>Number(item.id))),sourceIds=new Set(sources.results.map((item)=>Number(item.id))),existingKeys=new Set(existingRows.results.map((item)=>String(item.importKey||"")).filter(Boolean)),statements=[] as ReturnType<typeof db.prepare>[];let skipped=0;
      for(const record of records){
        const importKey=String(record.importKey||"").trim(),expenseDate=String(record.expenseDate||"").slice(0,10),branchId=Number(record.branchId),sourceId=Number(record.sourceId),amount=Number(record.amount),messages=Number(record.messages??0),impressions=Number(record.impressions??0),reach=Number(record.reach??0),campaign=String(record.campaign||"").trim();
        if(!importKey||existingKeys.has(importKey)){skipped++;continue}
        if(!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)||!branchIds.has(branchId)||!sourceIds.has(sourceId)||!Number.isFinite(amount)||amount<=0||![messages,impressions,reach].every((value)=>Number.isInteger(value)&&value>=0))return Response.json({error:`بيانات مصروف غير صحيحة: ${importKey}`},{status:400});
        const customData={expenseDate,sourceId,campaign,branchId,amount:Number(amount.toFixed(2)),messages,impressions,reach,track:String(record.track||""),platform:String(record.platform||""),originalLocation:String(record.originalLocation||""),sourceRow:Number(record.sourceRow)||null,distributionPart:String(record.distributionPart||""),importSource:String(record.importSource||"Marketing CSV"),importKey,...(staged?{importRunId}:{}),importedAt:new Date().toISOString(),createdById:sessionEmployee.id,createdBy:sessionEmployee.fullName,createdAt:new Date().toISOString()};
        statements.push(db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) VALUES ('marketing_expense',?,?,?)").bind(campaign||`Marketing · ${expenseDate}`,staged?0:1,JSON.stringify(customData)));existingKeys.add(importKey);
      }
      if(statements.length)await db.batch(statements);
      return Response.json({ok:true,created:statements.length,skipped,staged});
    }

    if(action==="discardMarketingExpensesImport"){
      const importRunId=String(payload.importRunId||"").trim();
      if(!importRunId)return Response.json({error:"معرّف عملية الاستيراد مطلوب"},{status:400});
      const result=await db.prepare("DELETE FROM settings_entities WHERE kind='marketing_expense' AND is_active=0 AND json_extract(custom_data,'$.importRunId')=?").bind(importRunId).run();
      return Response.json({ok:true,deleted:Number(result.meta.changes||0)});
    }

    if(action==="commitMarketingExpensesImport"){
      const importRunId=String(payload.importRunId||"").trim();
      if(!importRunId)return Response.json({error:"معرّف عملية الاستيراد مطلوب"},{status:400});
      const pending=await db.prepare("SELECT COUNT(*) AS count FROM settings_entities WHERE kind='marketing_expense' AND is_active=0 AND json_extract(custom_data,'$.importRunId')=?").bind(importRunId).first<{count:number}>();
      const count=Number(pending?.count||0);
      if(!count)return Response.json({error:"لا توجد بيانات جديدة للإضافة؛ كل الصفوف موجودة بالفعل"},{status:409});
      await db.prepare("UPDATE settings_entities SET is_active=1 WHERE kind='marketing_expense' AND is_active=0 AND json_extract(custom_data,'$.importRunId')=?").bind(importRunId).run();
      return Response.json({ok:true,created:count,appended:count,replaced:0});
    }

    if (action === "createSettingsEntity" || action === "updateSettingsEntity") {
      const allowedKinds=new Set(["round","study_type","level","education_batch","group","office_hours","setup_card","source","exam","segment","job","nationality","offer","payment_method","call_result","student_call_reason","visitor_call_reason","retention_nonrenewal_reason","request_inquiry_reason","complaint_reason","student_age_group","student_gender","student_referral","student_platform","student_study_reason","employee_leave_type","marketing_expense","ads_spending_target","retention_target","system_setting"]);
      const kind=String(payload.kind??"");
      if(!allowedKinds.has(kind)) return Response.json({error:"نوع الإعداد غير مدعوم"},{status:400});
      const details=(payload.customData??{}) as Record<string,unknown>;
      const id=action==="updateSettingsEntity"?Number(payload.id):0;
      if(kind==="retention_target"){
        const targetType=String(details.targetType||""),targetId=Number(details.targetId),month=String(details.month||"").slice(0,7),amount=Number(details.amount);
        if(!["branch","admin"].includes(targetType)||!targetId||!/^\d{4}-\d{2}$/.test(month)||!Number.isFinite(amount)||amount<0)return Response.json({error:"نوع التارجت والشهر والجهة والمبلغ بيانات مطلوبة"},{status:400});
        const exists=targetType==="branch"?await db.prepare("SELECT id FROM branches WHERE id=?").bind(targetId).first():await db.prepare("SELECT id FROM employees WHERE id=?").bind(targetId).first();
        if(!exists)return Response.json({error:"الفرع أو الأدمن المحدد غير موجود"},{status:404});
        details.targetType=targetType;details.targetId=targetId;details.month=month;details.amount=Number(amount.toFixed(2));
      }
      if(kind==="marketing_expense"){
        const amount=Number(details.amount),messages=Number(details.messages??0),impressions=Number(details.impressions??0),reach=Number(details.reach??0),expenseDate=String(details.expenseDate||"").slice(0,10),branchId=Number(details.branchId),sourceId=Number(details.sourceId);if(![messages,impressions,reach].every((value)=>Number.isInteger(value)&&value>=0))return Response.json({error:"Messages وImpressions وReach يجب أن تكون أرقامًا صحيحة لا تقل عن صفر"},{status:400});
        if(!Number.isFinite(amount)||amount<=0)return Response.json({error:"قيمة المصروف يجب أن تكون أكبر من صفر"},{status:400});
        if(!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)||!branchId||!sourceId)return Response.json({error:"التاريخ والفرع والمصدر بيانات مطلوبة"},{status:400});
        details.amount=Number(amount.toFixed(2));details.messages=messages;details.impressions=impressions;details.reach=reach;details.expenseDate=expenseDate;details.branchId=branchId;details.sourceId=sourceId;
        if(action==="createSettingsEntity"){details.createdById=sessionEmployee.id;details.createdBy=sessionEmployee.fullName;details.createdAt=new Date().toISOString()}
        else {const existing=await db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE id=? AND kind='marketing_expense'").bind(id).first<{customData:string}>();if(existing){try{const previous=JSON.parse(existing.customData||"{}") as Record<string,unknown>;details.createdById=previous.createdById||sessionEmployee.id;details.createdBy=previous.createdBy||sessionEmployee.fullName;details.createdAt=previous.createdAt||new Date().toISOString()}catch{}}details.updatedById=sessionEmployee.id;details.updatedBy=sessionEmployee.fullName;details.updatedAt=new Date().toISOString()}
      }
      if(kind==="ads_spending_target"){
        const month=String(details.month||payload.title||""),totalTarget=Number(details.totalTarget),allocations=Array.isArray(details.sourceAllocations)?details.sourceAllocations as Array<Record<string,unknown>>:[];
        if(!/^\d{4}-\d{2}$/.test(month)||!Number.isFinite(totalTarget)||totalTarget<=0)return Response.json({error:"اختر الشهر واكتب تارجت شهري صحيح"},{status:400});
        const totalPercentage=allocations.reduce((sum,entry)=>sum+Number(entry.percentage||0),0),invalid=allocations.find((entry)=>Number(entry.percentage||0)<0||Number(entry.percentage||0)>100||Math.abs(Number(entry.englishPercentage||0)+Number(entry.germanPercentage||0)-100)>.01);
        if(totalPercentage>100.01||invalid)return Response.json({error:"راجع نسب المصادر وتقسيم English وGerman"},{status:400});
        details.month=month;details.totalTarget=Number(totalTarget.toFixed(2));details.sourceAllocations=allocations.map((entry)=>{const percentage=Number(entry.percentage||0),englishPercentage=Number(entry.englishPercentage||0),germanPercentage=Number(entry.germanPercentage||0);return {sourceId:Number(entry.sourceId),percentage,englishPercentage,germanPercentage,amount:Number((totalTarget*percentage/100).toFixed(2))}}).filter((entry)=>entry.sourceId>0&&entry.percentage>0);
      }
      if(kind==="level"){
        const maxStudents=Number(details.maxStudents);
        if(!Number.isInteger(maxStudents)||maxStudents<1)return Response.json({error:"الحد الأقصى لطلاب الـLevel يجب أن يكون رقمًا صحيحًا أكبر من صفر"},{status:400});
        details.maxStudents=maxStudents;
      }
      if(kind==="study_type"){
        const maxStudents=Number(details.maxStudents);
        if(!Number.isInteger(maxStudents)||maxStudents<1)return Response.json({error:"الحد الأقصى لطلاب نظام الدراسة يجب أن يكون رقمًا صحيحًا أكبر من صفر"},{status:400});
        details.maxStudents=maxStudents;
      }
      if(kind==="education_batch") {
        const trackId=Number(details.trackId);
        const batchStatus=String(details.batchStatus??"");
        if(!trackId||!["Current Batch","Not Current"].includes(batchStatus)) return Response.json({error:"اختر الـTrack وحالة الدفعة"},{status:400});
        if(batchStatus==="Current Batch") {
          const current=await db.prepare("SELECT title FROM settings_entities WHERE kind='education_batch' AND id<>? AND CAST(json_extract(custom_data,'$.trackId') AS INTEGER)=? AND COALESCE(json_extract(custom_data,'$.batchStatus'),'Current Batch')='Current Batch' LIMIT 1").bind(id,trackId).first<{title:string}>();
          if(current) return Response.json({error:`يوجد بالفعل Current Batch لهذا الـTrack: ${current.title}. غيّر حالته إلى Not Current أولًا.`},{status:409});
        }
      }
      if(kind==="group") {
        const batchId=Number(details.batchId), levelId=Number(details.levelId), roundId=Number(details.roundId);
        const startDate=String(details.startDate??"").trim();
        const branchId=Number(details.branchId),studyTypeId=Number(details.studyTypeId),timeSlotId=Number(details.timeSlotId),classroomId=Number(details.classroomId);
        if(!batchId||!levelId||!roundId||!branchId||!studyTypeId||!timeSlotId||!classroomId||!startDate) return Response.json({error:"الدفعة والروند والمستوى والفرع ونظام الدراسة والموعد والروم وتاريخ بداية الجروب مطلوبة"},{status:400});
        const validateRoomAvailability=async(candidates:Array<{id?:number;details:Record<string,unknown>}>,excludedIds=new Set<number>())=>{
          const [round,slot,room,existing]=await Promise.all([
            db.prepare("SELECT title,custom_data AS customData FROM settings_entities WHERE id=? AND kind='round'").bind(roundId).first<{title:string;customData:string}>(),
            db.prepare("SELECT title,start_time AS startTime,end_time AS endTime FROM time_slots WHERE id=? AND is_active=1").bind(timeSlotId).first<{title:string;startTime:string;endTime:string}>(),
            db.prepare("SELECT id,name,branch_id AS branchId FROM classrooms WHERE id=? AND is_active=1").bind(classroomId).first<{id:number;name:string;branchId:number}>(),
            db.prepare("SELECT g.id,g.title,g.custom_data AS customData,r.title AS roundTitle,r.custom_data AS roundData,ts.start_time AS startTime,ts.end_time AS endTime FROM settings_entities g LEFT JOIN settings_entities r ON r.id=CAST(json_extract(g.custom_data,'$.roundId') AS INTEGER) LEFT JOIN time_slots ts ON ts.id=CAST(json_extract(g.custom_data,'$.timeSlotId') AS INTEGER) WHERE g.kind='group' AND g.is_active=1 AND CAST(json_extract(g.custom_data,'$.classroomId') AS INTEGER)=?").bind(classroomId).all<{id:number;title:string;customData:string;roundTitle:string|null;roundData:string|null;startTime:string|null;endTime:string|null}>(),
          ]);
          if(!round||!slot||!room)return "تعذر التحقق من الروم أو الموعد أو الروند؛ راجع إعدادات الجروب";
          if(Number(room.branchId)!==branchId)return `الروم ${room.name} لا تتبع الفرع المختار`;
          let roundData:Record<string,unknown>={};try{roundData=JSON.parse(round.customData||"{}")}catch{}
          const lectureCount=Math.max(1,Number(roundData.lectureCount)||120),candidateSchedules=candidates.map((candidate)=>({candidate,dates:new Set(scheduledSessionDates(String(candidate.details.startDate||""),round.title,lectureCount))}));
          for(const candidateSchedule of candidateSchedules){
            for(const row of existing.results){
              if(excludedIds.has(row.id)||!row.startTime||!row.endTime||!timesOverlap(slot.startTime,slot.endTime,row.startTime,row.endTime))continue;
              let existingDetails:Record<string,unknown>={},existingRoundData:Record<string,unknown>={};try{existingDetails=JSON.parse(row.customData||"{}")}catch{}try{existingRoundData=JSON.parse(row.roundData||"{}")}catch{}
              const existingDates=new Set(scheduledSessionDates(String(existingDetails.startDate||""),String(row.roundTitle||""),Math.max(1,Number(existingRoundData.lectureCount)||120))),conflictDate=[...candidateSchedule.dates].find((date)=>existingDates.has(date));
              if(conflictDate)return `الروم ${room.name} مشغولة بواسطة Group #${row.title} يوم ${conflictDate} من ${row.startTime} إلى ${row.endTime}`;
            }
          }
          for(let first=0;first<candidateSchedules.length;first++)for(let second=first+1;second<candidateSchedules.length;second++){const conflictDate=[...candidateSchedules[first].dates].find((date)=>candidateSchedules[second].dates.has(date));if(conflictDate)return `مسار التصعيد الجديد يحجز الروم ${room.name} مرتين يوم ${conflictDate} في نفس الموعد`}
          return "";
        };
        const clearMatchingOfficeHours=async(groupDetails:Record<string,unknown>)=>{const teacherId=Number(groupDetails.teacherId),groupSlotId=Number(groupDetails.timeSlotId),groupRoundId=Number(groupDetails.roundId);if(!teacherId||!groupSlotId)return;const groupRound=groupRoundId?await db.prepare("SELECT title FROM settings_entities WHERE id=? AND kind='round'").bind(groupRoundId).first<{title:string}>():null,weekdays=scheduledWeekdays(String(groupDetails.startDate||""),groupRound?.title||""),dayKey=weekdays.size===1&&weekdays.has(5)?"fri":weekdays.has(6)||weekdays.has(2)?"satTue":weekdays.has(0)||weekdays.has(3)?"sunWed":"monThu";await db.prepare("UPDATE settings_entities SET is_active=0 WHERE kind='office_hours' AND is_active=1 AND CAST(json_extract(custom_data,'$.teacherId') AS INTEGER)=? AND CAST(json_extract(custom_data,'$.timeSlotId') AS INTEGER)=? AND json_extract(custom_data,'$.dayKey')=?").bind(teacherId,groupSlotId,dayKey).run()};
        if(action==="updateSettingsEntity") { const conflict=await validateRoomAvailability([{id,details}],new Set([id]));if(conflict)return Response.json({error:conflict},{status:409});await db.prepare("UPDATE settings_entities SET custom_data=? WHERE id=? AND kind='group'").bind(JSON.stringify(details),id).run();await clearMatchingOfficeHours(details); return Response.json({ok:true}); }
        const batch=await db.prepare("SELECT id, custom_data AS customData FROM settings_entities WHERE id=? AND kind='education_batch'").bind(batchId).first<{id:number;customData:string}>();
        const level=await db.prepare("SELECT id, custom_data AS customData FROM settings_entities WHERE id=? AND kind='level'").bind(levelId).first<{id:number;customData:string}>();
        if(!batch||!level) return Response.json({error:"الدفعة أو المستوى غير موجود"},{status:404});
        const batchDetails=JSON.parse(batch.customData||"{}") as Record<string,unknown>;
        const levelDetails=JSON.parse(level.customData||"{}") as Record<string,unknown>;
        const trackId=Number(batchDetails.trackId);
        if(!trackId||Number(levelDetails.trackId)!==trackId) return Response.json({error:"المستوى يجب أن يكون تابعًا لنفس Track الخاص بالدفعة"},{status:400});
        const levels=await db.prepare("SELECT id, custom_data AS customData FROM settings_entities WHERE kind='level' AND CAST(json_extract(custom_data,'$.trackId') AS INTEGER)=? ORDER BY CAST(json_extract(custom_data,'$.sortOrder') AS INTEGER), id").bind(trackId).all<{id:number;customData:string}>();
        const batches=await db.prepare("SELECT id, custom_data AS customData FROM settings_entities WHERE kind='education_batch' AND CAST(json_extract(custom_data,'$.trackId') AS INTEGER)=? ORDER BY json_extract(custom_data,'$.startDate'), id").bind(trackId).all<{id:number;customData:string}>();
        const levelIndex=levels.results.findIndex((item)=>Number(item.id)===levelId), batchIndex=batches.results.findIndex((item)=>Number(item.id)===batchId);
        if(levelIndex<0||batchIndex<0) return Response.json({error:"تعذر تحديد ترتيب التصعيد"},{status:400});
        const steps=Math.min(levels.results.length-levelIndex,batches.results.length-batchIndex);
        const candidates=[] as Array<{details:Record<string,unknown>}>;
        for(let step=0;step<steps;step++) {
          const targetLevel=levels.results[levelIndex+step], targetBatch=batches.results[batchIndex+step];
          const targetBatchDetails=JSON.parse(targetBatch.customData||"{}") as Record<string,unknown>;
          candidates.push({details:{...details,batchId:targetBatch.id,levelId:targetLevel.id,startDate:step===0?startDate:String(targetBatchDetails.startDate??startDate),sequenceIndex:step}});
        }
        const conflict=await validateRoomAvailability(candidates);if(conflict)return Response.json({error:conflict},{status:409});
        let rootId=0,previousId=0,created=0;
        for(let step=0;step<candidates.length;step++){
          const nextDetails:Record<string,unknown>={...candidates[step].details,progressionRootId:rootId||undefined,previousGroupId:previousId||undefined};
          const inserted=await db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) VALUES ('group',?,1,?)").bind(`PENDING-${Date.now()}-${step}`,JSON.stringify(nextDetails)).run();
          const newId=Number(inserted.meta.last_row_id), groupId=String(newId);
          if(!rootId)rootId=newId; nextDetails.progressionRootId=rootId;
          await db.prepare("UPDATE settings_entities SET title=?,custom_data=? WHERE id=?").bind(groupId,JSON.stringify(nextDetails),newId).run();
          await clearMatchingOfficeHours(nextDetails);
          previousId=newId;created++;
        }
        return Response.json({id:rootId,created},{status:201});
      }
      const title=kind==="source"?normalizeSourceName(payload.title):String(payload.title??"").trim();if(!title)return Response.json({error:"اسم الإعداد مطلوب"},{status:400});const duplicate=await db.prepare("SELECT id FROM settings_entities WHERE kind=? AND LOWER(title)=LOWER(?) AND id<>?").bind(kind,title,id).first();if(duplicate)return Response.json({error:"يوجد عنصر بنفس الاسم بالفعل"},{status:409});const raw=payload.isActive;const active=raw===false||raw===0||raw==="0"||raw==="غير نشط"||raw==="inactive"?0:1;const customData=JSON.stringify(details);if(action==="updateSettingsEntity"){await db.prepare("UPDATE settings_entities SET title=?,is_active=?,custom_data=? WHERE id=? AND kind=?").bind(title,active,customData,id,kind).run();return Response.json({ok:true})}const result=await db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) VALUES (?,?,?,?)").bind(kind,title,active,customData).run();return Response.json({id:result.meta.last_row_id},{status:201});
    }
    if(action==="deleteSettingsEntity"){const id=Number(payload.id);const usage=await db.prepare("SELECT COUNT(*) AS count FROM settings_entities WHERE id<>? AND (json_extract(custom_data,'$.levelId')=? OR json_extract(custom_data,'$.studyTypeId')=? OR json_extract(custom_data,'$.batchId')=? OR json_extract(custom_data,'$.roundId')=? OR json_extract(custom_data,'$.parentId')=?)").bind(id,id,id,id,id,id).first<{count:number}>();if((usage?.count??0)>0)return Response.json({error:"لا يمكن حذف عنصر مرتبط بإعداد آخر."},{status:409});await db.prepare("DELETE FROM group_members WHERE group_id=?").bind(id).run();await db.prepare("DELETE FROM settings_entities WHERE id=?").bind(id).run();return Response.json({ok:true})}

    if (action === "createDepartment") {
      const name = String(payload.name ?? "").trim();
      if (!name) return Response.json({ error: "اسم القسم مطلوب" }, { status: 400 });
      const result = await db.prepare("INSERT INTO departments (name, color, parent_id, support_enabled) VALUES (?, ?, ?, ?)")
        .bind(name, String(payload.color ?? "#2f6b5f"), Number(payload.parentId) || null, payload.supportEnabled ? 1 : 0).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }

    if (action === "updateDepartment") {
      const id = Number(payload.id);
      const name = String(payload.name ?? "").trim();
      const parentId = Number(payload.parentId) || null;
      if (!id || !name) return Response.json({ error: "اسم القسم مطلوب" }, { status: 400 });
      if (parentId === id) return Response.json({ error: "لا يمكن أن يكون القسم الرئيسي هو القسم نفسه" }, { status: 400 });
      const duplicate = await db.prepare("SELECT id FROM departments WHERE LOWER(name)=LOWER(?) AND id<>?").bind(name, id).first();
      if (duplicate) return Response.json({ error: "يوجد قسم بنفس الاسم بالفعل" }, { status: 409 });
      await db.prepare("UPDATE departments SET name=?, color=?, parent_id=?, support_enabled=? WHERE id=?").bind(name, String(payload.color ?? "#2f6b5f"), parentId, payload.supportEnabled ? 1 : 0, id).run();
      return Response.json({ ok: true });
    }

    if (action === "createJobTitle") {
      const name = String(payload.name ?? "").trim();
      const departmentId = Number(payload.departmentId);
      if (!name || !departmentId) return Response.json({ error: "اسم الوظيفة والقسم مطلوبان" }, { status: 400 });
      const reportsToId = Number(payload.reportsToId) || null;
      if (reportsToId && !await db.prepare("SELECT id FROM job_titles WHERE id=?").bind(reportsToId).first()) return Response.json({ error: "الدور الإداري المحدد غير موجود" }, { status: 400 });
      const result = await db.prepare("INSERT INTO job_titles (name, department_id, reports_to_id) VALUES (?, ?, ?)").bind(name, departmentId, reportsToId).run();
      return Response.json({ id: result.meta.last_row_id }, { status: 201 });
    }

    if (action === "updateJobTitle") {
      const id = Number(payload.id);
      const name = String(payload.name ?? "").trim();
      const departmentId = Number(payload.departmentId);
      if (!id || !name || !departmentId) return Response.json({ error: "اسم الوظيفة والقسم مطلوبان" }, { status: 400 });
      const reportsToId = Number(payload.reportsToId) || null;
      if (reportsToId === id) return Response.json({ error: "لا يمكن أن يرفع الدور تقاريره إلى نفسه" }, { status: 400 });
      if (reportsToId && !await db.prepare("SELECT id FROM job_titles WHERE id=?").bind(reportsToId).first()) return Response.json({ error: "الدور الإداري المحدد غير موجود" }, { status: 400 });
      const duplicate = await db.prepare("SELECT id FROM job_titles WHERE department_id=? AND LOWER(name)=LOWER(?) AND id<>?").bind(departmentId, name, id).first();
      if (duplicate) return Response.json({ error: "توجد وظيفة بنفس الاسم داخل هذا القسم" }, { status: 409 });
      await db.prepare("UPDATE job_titles SET name=?, department_id=?, reports_to_id=? WHERE id=?").bind(name, departmentId, reportsToId, id).run();
      return Response.json({ ok: true });
    }

    if (action === "deleteDepartment") {
      const id = Number(payload.id);
      const usage = await db.prepare("SELECT (SELECT COUNT(*) FROM employees WHERE department_id=?) + (SELECT COUNT(*) FROM job_titles WHERE department_id=?) + (SELECT COUNT(*) FROM departments WHERE parent_id=?) AS count").bind(id, id, id).first<{ count: number }>();
      if ((usage?.count ?? 0) > 0) return Response.json({ error: "لا يمكن حذف قسم مرتبط بموظفين أو وظائف أو أقسام فرعية" }, { status: 409 });
      await db.prepare("DELETE FROM departments WHERE id=?").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "deleteJobTitle") {
      const id = Number(payload.id);
      if(!id)return Response.json({error:"الدور الوظيفي غير محدد"},{status:400});
      const role=await db.prepare("SELECT name FROM job_titles WHERE id=?").bind(id).first<{name:string}>();
      if(!role)return Response.json({error:"الدور الوظيفي غير موجود أو تم حذفه بالفعل"},{status:404});
      const employeeUsage=await db.prepare("SELECT COUNT(*) AS count FROM employees WHERE job_title_id=?").bind(id).first<{count:number}>();
      if((employeeUsage?.count??0)>0)return Response.json({error:`لا يمكن حذف ${role.name} لأن عليه ${employeeUsage?.count??0} موظف. انقل الموظفين إلى Role آخر أولًا ثم أعد الحذف.`},{status:409});
      await db.batch([
        db.prepare("UPDATE job_titles SET reports_to_id=NULL WHERE reports_to_id=?").bind(id),
        db.prepare("DELETE FROM job_title_permissions WHERE job_title_id=?").bind(id),
        db.prepare("DELETE FROM job_titles WHERE id=?").bind(id),
      ]);
      return Response.json({ ok: true });
    }

    if (action === "saveJobTitlePermissions") {
      const jobTitleId = Number(payload.jobTitleId);
      const allowedPages = new Set(["overview", "employeeProfile", "employees", "employeeSchedule", "departments", "jobs", "permissions", "leaves", "forms", "settings", "classes", "tracks", "timeSystem", "rounds", "studyTypes", "levels", "batches", "groups", "utilization", "groupUtilization", "floorSchedule", "scheduleFinal", "sources", "adminSettings", "setupCards", "exams", "oralResults", "studentsStatus", "operationsRetention", "retentionMoney", "operationsAbsenceReports", "operationsAbsenceCalls", "retentionTargets", "mtd", "marketingExpenses", "adsSpendingTargets", "leadsCallsReport", "leadsReport", "callsReport", "leads", "inboundCalls", "leadSequence", "followups", "receivedFollowups", "callCenterCalls", "studentsList", "studentMissingCalls", "studentRemainingCalls", "studentVisitorCalls", "operationCalls", "studentAttendance", "studentAttendanceSession", "studentAbsence", "studentPlacement", "studentMisplaced", "studentReported", "studentComplaints", "studentInformations", "offers", "paymentMethods", "payments", "financialReports", "debtors", "debtInstallments", "debtReset", "refunds", "studentTransfers", "trackTransfers"]);
      const allowedScopes = new Set(["own", "branch", "department", "all"]);
      const submitted = Array.isArray(payload.permissions) ? payload.permissions : [];
      if (!jobTitleId) return Response.json({ error: "اختر الوظيفة أولاً" }, { status: 400 });
      if (!await db.prepare("SELECT id FROM job_titles WHERE id=?").bind(jobTitleId).first()) return Response.json({ error: "الوظيفة المحددة غير موجودة" }, { status: 404 });
      const permissions = submitted.map((item) => {
        const row = item as Record<string, unknown>;
        const canView = !!row.canView;
        const requestedScope = String(row.dataScope ?? "all");
        return { pageKey: String(row.pageKey ?? ""), canView, canAdd: canView && !!row.canAdd, canEdit: canView && !!row.canEdit, canDelete: canView && !!row.canDelete, dataScope: allowedScopes.has(requestedScope) ? requestedScope : "all" };
      }).filter((row) => allowedPages.has(row.pageKey));
      await db.batch([
        db.prepare("DELETE FROM job_title_permissions WHERE job_title_id=?").bind(jobTitleId),
        ...permissions.map((row) => db.prepare("INSERT INTO job_title_permissions (job_title_id, page_key, can_view, can_add, can_edit, can_delete, data_scope) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(jobTitleId, row.pageKey, row.canView ? 1 : 0, row.canAdd ? 1 : 0, row.canEdit ? 1 : 0, row.canDelete ? 1 : 0, row.dataScope)),
      ]);
      return Response.json({ ok: true });
    }

    if (action === "toggleField") {
      const id = Number(payload.id);
      const visible = payload.visible ? 1 : 0;
      const required = payload.required ? 1 : 0;
      await db.prepare("UPDATE form_fields SET visible=?, required=? WHERE id=?").bind(visible, required, id).run();
      await db.prepare("UPDATE form_definitions SET version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT form_id FROM form_fields WHERE id=?)").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "addField") {
      const label = String(payload.label ?? "").trim();
      if (!label) return Response.json({ error: "اسم الحقل مطلوب" }, { status: 400 });
      const requestedForm = String(payload.formKey ?? "employee");
      const allowedForms = new Set(["employee", "branch", "classroom", "track", "time_slot", "round", "study_type", "level", "education_batch", "group", "setup_card", "exam", "lead", "call", "lead_details", "followup"]);
      if (!allowedForms.has(requestedForm)) return Response.json({ error: "النموذج المطلوب غير مدعوم" }, { status: 400 });
      const form = await db.prepare("SELECT id FROM form_definitions WHERE form_key=?").bind(requestedForm).first<{ id: number }>();
      if (!form) throw new Error("تعريف النموذج غير موجود");
      const order = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM form_fields WHERE form_id=?").bind(form.id).first<{ nextOrder: number }>();
      const fieldKey = `custom_${Date.now()}`;
      await db.prepare("INSERT INTO form_fields (form_id, field_key, label, type, placeholder, required, visible, sort_order, width) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)")
        .bind(form.id, fieldKey, label, String(payload.type ?? "text"), String(payload.placeholder ?? ""), payload.required ? 1 : 0, order?.nextOrder ?? 1, String(payload.width ?? "half")).run();
      return Response.json({ ok: true }, { status: 201 });
    }

    return Response.json({ error: "إجراء غير مدعوم" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر حفظ البيانات" }, { status: 500 });
  }
}
