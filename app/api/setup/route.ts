import { env } from "cloudflare:workers";
import { ensurePhaseTwo } from "@/db/phase-two";

export const dynamic = "force-dynamic";

async function hashPassword(password: string) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function GET() {
  try {
    await ensurePhaseTwo();
    const db = env.DB;
    const [departments, jobTitles, roles, jobTitlePermissions, employees, branches, classrooms, tracks, timeSlots, settingsEntities, forms, students, groupMembers] = await Promise.all([
      db.prepare("SELECT d.id, d.name, d.color, d.parent_id AS parentId, d.support_enabled AS supportEnabled, d.is_active AS isActive, p.name AS parentName, (SELECT COUNT(*) FROM job_titles j WHERE j.department_id=d.id) AS jobCount FROM departments d LEFT JOIN departments p ON p.id=d.parent_id ORDER BY d.id").all(),
      db.prepare("SELECT j.id, j.name, j.department_id AS departmentId, j.reports_to_id AS reportsToId, d.name AS department, manager.name AS reportsToName FROM job_titles j LEFT JOIN departments d ON d.id=j.department_id LEFT JOIN job_titles manager ON manager.id=j.reports_to_id ORDER BY d.name, j.name").all(),
      db.prepare("SELECT id, name, description FROM roles ORDER BY id").all(),
      db.prepare("SELECT job_title_id AS jobTitleId, page_key AS pageKey, can_view AS canView, can_add AS canAdd, can_edit AS canEdit, can_delete AS canDelete FROM job_title_permissions ORDER BY job_title_id, page_key").all(),
      db.prepare(`SELECT e.id, e.hr_id AS hrId, e.full_name AS fullName, e.email, e.phone, e.status, e.custom_data AS customData, e.department_id AS departmentId, e.job_title_id AS jobTitleId, e.role_id AS roleId, e.branch_id AS branchId, d.name AS department, j.name AS jobTitle, r.name AS role, b.name AS branchName FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN roles r ON r.id=e.role_id LEFT JOIN branches b ON b.id=e.branch_id ORDER BY e.id DESC`).all(),
      db.prepare(`SELECT b.id, b.name, b.address, b.primary_phone AS primaryPhone, b.secondary_phone AS secondaryPhone, b.email, b.social_url AS socialUrl, b.is_active AS isActive, b.custom_data AS customData, (SELECT COUNT(*) FROM employees e WHERE e.branch_id=b.id) AS employeeCount, (SELECT COUNT(*) FROM leads l WHERE l.branch_id=b.id) AS leadCount, (SELECT COUNT(*) FROM call_records c WHERE c.branch_id=b.id) AS callCount FROM branches b ORDER BY b.id`).all(),
      db.prepare(`SELECT c.id, c.branch_id AS branchId, b.name AS branchName, c.name, c.capacity, c.is_active AS isActive, c.custom_data AS customData FROM classrooms c JOIN branches b ON b.id=c.branch_id ORDER BY b.name, c.name`).all(),
      db.prepare(`SELECT id, title, is_active AS isActive, custom_data AS customData FROM tracks ORDER BY title`).all(),
      db.prepare(`SELECT ts.id, ts.track_id AS trackId, t.title AS trackName, ts.title, ts.start_time AS startTime, ts.end_time AS endTime, ts.is_active AS isActive, ts.custom_data AS customData FROM time_slots ts LEFT JOIN tracks t ON t.id=ts.track_id ORDER BY t.title, ts.start_time`).all(),
      db.prepare(`SELECT se.id, se.kind, se.title, se.is_active AS isActive, se.custom_data AS customData, CASE WHEN se.kind='group' THEN (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=se.id) ELSE 0 END AS studentCount FROM settings_entities se ORDER BY se.kind, se.title`).all(),
      db.prepare(`SELECT f.id AS formId, f.form_key AS formKey, f.name AS formName, f.version, ff.id, ff.field_key AS fieldKey, ff.label, ff.type, ff.placeholder, ff.required, ff.visible, ff.sort_order AS sortOrder, ff.options_json AS optionsJson, ff.width FROM form_definitions f JOIN form_fields ff ON ff.form_id=f.id ORDER BY f.form_key, ff.sort_order`).all(),
      db.prepare(`SELECT s.id, s.full_name AS fullName, s.mobile, s.level_id AS levelId, l.title AS levelName FROM students s LEFT JOIN settings_entities l ON l.id=s.level_id ORDER BY s.full_name`).all(),
      db.prepare(`SELECT gm.id, gm.group_id AS groupId, CAST(gm.student_reference AS INTEGER) AS studentId, gm.joined_at AS joinedAt, s.full_name AS fullName, s.mobile, s.level_id AS levelId FROM group_members gm JOIN students s ON s.id=CAST(gm.student_reference AS INTEGER) ORDER BY gm.joined_at DESC`).all(),
    ]);
    return Response.json({ departments: departments.results, jobTitles: jobTitles.results, roles: roles.results, jobTitlePermissions: jobTitlePermissions.results, employees: employees.results, branches: branches.results, classrooms: classrooms.results, tracks: tracks.results, timeSlots: timeSlots.results, settingsEntities: settingsEntities.results, students:students.results, groupMembers:groupMembers.results, fields: forms.results.filter((field) => field.formKey === "employee"), branchFields: forms.results.filter((field) => field.formKey === "branch"), classroomFields: forms.results.filter((field) => field.formKey === "classroom"), trackFields: forms.results.filter((field) => field.formKey === "track"), timeSlotFields: forms.results.filter((field) => field.formKey === "time_slot"), catalogFields: Object.fromEntries(["round","study_type","level","education_batch","group","setup_card","exam"].map((key)=>[key,forms.results.filter((field)=>field.formKey===key)])) });
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
      const values = [name, address, primaryPhone, String(payload.secondaryPhone ?? "").trim(), String(payload.email ?? "").trim().toLowerCase(), String(payload.socialUrl ?? "").trim(), String(payload.isActive ?? "نشط") === "غير نشط" ? 0 : 1, JSON.stringify(payload.customData ?? {})];
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
      return Response.json({ok:true});
    }

    if(action==="addGroupStudent") {
      const groupId=Number(payload.groupId),studentId=Number(payload.studentId);
      const group=await db.prepare("SELECT custom_data AS customData FROM settings_entities WHERE id=? AND kind='group'").bind(groupId).first<{customData:string}>();
      const student=await db.prepare("SELECT id,level_id AS levelId FROM students WHERE id=?").bind(studentId).first<{id:number;levelId:number}>();
      if(!group||!student)return Response.json({error:"الجروب أو الطالب غير موجود"},{status:404});
      const details=JSON.parse(group.customData||"{}") as Record<string,unknown>;
      if(Number(details.levelId)!==Number(student.levelId))return Response.json({error:"لا يمكن إضافة الطالب لأن مستواه لا يطابق مستوى الجروب"},{status:409});
      await db.prepare("INSERT OR IGNORE INTO group_members (group_id,student_reference) VALUES (?,?)").bind(groupId,String(studentId)).run();
      return Response.json({ok:true},{status:201});
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

    if (action === "createSettingsEntity" || action === "updateSettingsEntity") {
      const allowedKinds=new Set(["round","study_type","level","education_batch","group","setup_card","source","exam","segment","job","nationality","offer","payment_method"]);
      const kind=String(payload.kind??"");
      if(!allowedKinds.has(kind)) return Response.json({error:"نوع الإعداد غير مدعوم"},{status:400});
      const details=(payload.customData??{}) as Record<string,unknown>;
      const id=action==="updateSettingsEntity"?Number(payload.id):0;
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
        if(!batchId||!levelId||!roundId||!startDate) return Response.json({error:"الدفعة والروند والمستوى وتاريخ بداية الجروب مطلوبة"},{status:400});
        if(action==="updateSettingsEntity") { await db.prepare("UPDATE settings_entities SET custom_data=? WHERE id=? AND kind='group'").bind(JSON.stringify(details),id).run(); return Response.json({ok:true}); }
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
        let rootId=0, previousId=0, created=0;
        const steps=Math.min(levels.results.length-levelIndex,batches.results.length-batchIndex);
        for(let step=0;step<steps;step++) {
          const targetLevel=levels.results[levelIndex+step], targetBatch=batches.results[batchIndex+step];
          const exists=await db.prepare("SELECT id FROM settings_entities WHERE kind='group' AND json_extract(custom_data,'$.batchId')=? AND json_extract(custom_data,'$.levelId')=?").bind(targetBatch.id,targetLevel.id).first<{id:number}>();
          if(exists){previousId=exists.id;if(!rootId)rootId=exists.id;continue;}
          const targetBatchDetails=JSON.parse(targetBatch.customData||"{}") as Record<string,unknown>;
          const nextDetails:Record<string,unknown>={...details,batchId:targetBatch.id,levelId:targetLevel.id,startDate:step===0?startDate:String(targetBatchDetails.startDate??startDate),progressionRootId:rootId||undefined,previousGroupId:previousId||undefined,sequenceIndex:step};
          const inserted=await db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) VALUES ('group',?,1,?)").bind(`PENDING-${Date.now()}-${step}`,JSON.stringify(nextDetails)).run();
          const newId=Number(inserted.meta.last_row_id), groupId=String(newId);
          if(!rootId)rootId=newId; nextDetails.progressionRootId=rootId;
          await db.prepare("UPDATE settings_entities SET title=?,custom_data=? WHERE id=?").bind(groupId,JSON.stringify(nextDetails),newId).run();
          previousId=newId;created++;
        }
        return Response.json({id:rootId,created},{status:201});
      }
      const title=String(payload.title??"").trim();if(!title)return Response.json({error:"اسم الإعداد مطلوب"},{status:400});const duplicate=await db.prepare("SELECT id FROM settings_entities WHERE kind=? AND LOWER(title)=LOWER(?) AND id<>?").bind(kind,title,id).first();if(duplicate)return Response.json({error:"يوجد عنصر بنفس الاسم بالفعل"},{status:409});const raw=payload.isActive;const active=raw===false||raw===0||raw==="0"||raw==="غير نشط"||raw==="inactive"?0:1;const customData=JSON.stringify(details);if(action==="updateSettingsEntity"){await db.prepare("UPDATE settings_entities SET title=?,is_active=?,custom_data=? WHERE id=? AND kind=?").bind(title,active,customData,id,kind).run();return Response.json({ok:true})}const result=await db.prepare("INSERT INTO settings_entities (kind,title,is_active,custom_data) VALUES (?,?,?,?)").bind(kind,title,active,customData).run();return Response.json({id:result.meta.last_row_id},{status:201});
    }
    if(action==="deleteSettingsEntity"){const id=Number(payload.id);const usage=await db.prepare("SELECT COUNT(*) AS count FROM settings_entities WHERE id<>? AND (json_extract(custom_data,'$.levelId')=? OR json_extract(custom_data,'$.studyTypeId')=? OR json_extract(custom_data,'$.batchId')=? OR json_extract(custom_data,'$.roundId')=?)").bind(id,id,id,id,id).first<{count:number}>();if((usage?.count??0)>0)return Response.json({error:"لا يمكن حذف عنصر مرتبط بإعداد آخر."},{status:409});await db.prepare("DELETE FROM group_members WHERE group_id=?").bind(id).run();await db.prepare("DELETE FROM settings_entities WHERE id=?").bind(id).run();return Response.json({ok:true})}

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
      const usage = await db.prepare("SELECT (SELECT COUNT(*) FROM employees WHERE job_title_id=?) + (SELECT COUNT(*) FROM job_titles WHERE reports_to_id=?) AS count").bind(id, id).first<{ count: number }>();
      if ((usage?.count ?? 0) > 0) return Response.json({ error: "لا يمكن حذف وظيفة مرتبطة بموظفين" }, { status: 409 });
      await db.prepare("DELETE FROM job_title_permissions WHERE job_title_id=?").bind(id).run();
      await db.prepare("DELETE FROM job_titles WHERE id=?").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "saveJobTitlePermissions") {
      const jobTitleId = Number(payload.jobTitleId);
      const allowedPages = new Set(["overview", "employees", "departments", "jobs", "permissions", "settings", "classes", "tracks", "timeSystem", "rounds", "studyTypes", "levels", "batches", "groups", "leads", "inboundCalls", "followups", "receivedFollowups", "callCenterCalls"]);
      const submitted = Array.isArray(payload.permissions) ? payload.permissions : [];
      if (!jobTitleId) return Response.json({ error: "اختر الوظيفة أولاً" }, { status: 400 });
      if (!await db.prepare("SELECT id FROM job_titles WHERE id=?").bind(jobTitleId).first()) return Response.json({ error: "الوظيفة المحددة غير موجودة" }, { status: 404 });
      const permissions = submitted.map((item) => {
        const row = item as Record<string, unknown>;
        const canView = !!row.canView;
        return { pageKey: String(row.pageKey ?? ""), canView, canAdd: canView && !!row.canAdd, canEdit: canView && !!row.canEdit, canDelete: canView && !!row.canDelete };
      }).filter((row) => allowedPages.has(row.pageKey));
      await db.batch([
        db.prepare("DELETE FROM job_title_permissions WHERE job_title_id=?").bind(jobTitleId),
        ...permissions.map((row) => db.prepare("INSERT INTO job_title_permissions (job_title_id, page_key, can_view, can_add, can_edit, can_delete) VALUES (?, ?, ?, ?, ?, ?)").bind(jobTitleId, row.pageKey, row.canView ? 1 : 0, row.canAdd ? 1 : 0, row.canEdit ? 1 : 0, row.canDelete ? 1 : 0)),
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
