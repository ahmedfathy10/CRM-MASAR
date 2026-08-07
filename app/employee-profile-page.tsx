"use client";
import { FormEvent, useEffect, useState } from "react";

type Task={id:number;title:string;dueDate:string;isCompleted:number};
type ProfileData=Record<string,any>;
const money=(value:number)=>`${Math.round(value||0).toLocaleString()} EGP`;

export function EmployeeProfilePage(){
  const [data,setData]=useState<ProfileData|null>(null),[error,setError]=useState("");
  async function load(){
    const response=await fetch("/api/employee-profile/",{cache:"no-store",headers:{accept:"application/json"}}),text=await response.text();let result:ProfileData={};
    try{result=text?JSON.parse(text):{}}catch{throw new Error(`تعذر تحميل بيانات البروفايل (HTTP ${response.status})`)}
    if(!response.ok)throw new Error(result.error||"تعذر تحميل البروفايل");setData(result);
  }
  useEffect(()=>{load().catch(reason=>setError(reason.message))},[]);
  if(error)return <div className="form-error">{error}</div>;
  if(!data)return <section className="panel profile-loading">جارٍ تحميل بيانات الأداء...</section>;
  const {employee,sales,operations:ops,mode}=data,schedule=data.schedule||[],adjustments=data.adjustments||[],classVisits=data.classVisits||[];
  const metrics=mode==="sales"?[
    ["Leads",sales.leads],["Calls",sales.calls],["Follow Ups",sales.followups],["مبيعات الشهر",money(sales.currentSales)],["الشهر السابق",money(sales.previousSales)],["ترتيب المبيعات",`${sales.rank} / ${sales.teamSize}`]
  ]:[
    ["الجروبات",ops.groups.length],["الطلاب",ops.totalStudents],["Retention",ops.retentionTotal],["جدد",ops.renewed],["نسبة التجديد",`${ops.renewalRate}%`],["نسبة الغياب",`${ops.absenceRate}%`],["شراء الكتب",`${ops.booksRate}%`],...(mode==="operations"?[["Retention Revenue",money(ops.retentionRevenue)],["تحقيق التارجت",`${ops.targetRate}%`],["التحصيل",`${ops.collectionRate}%`]]:[])
  ];
  return <div className="employee-profile-dashboard">
    <aside className="employee-profile-left">
      <section className="employee-identity-card">
        <div className="employee-profile-avatar">{String(employee.fullName||"?").slice(0,1)}</div>
        <h2>{employee.fullName}</h2><p>{employee.jobTitle}</p><span>{employee.department}</span>
      </section>
      <section className="panel profile-side-card"><header><h3>بيانات التواصل</h3></header><dl><div><dt>Email</dt><dd>{employee.email||"—"}</dd></div><div><dt>Phone</dt><dd>{employee.phone||"—"}</dd></div><div><dt>Branch</dt><dd>{employee.branchName||"—"}</dd></div></dl></section>
      <section className="panel profile-side-card"><header><h3>جدولي</h3><b>{data.month}</b></header><div className="compact-schedule">{schedule.length?schedule.slice(0,10).map((row:any)=><div key={row.workDate}><time>{row.workDate.slice(8)}</time><span><b>{row.dayStatus==="work"?"شغل":"إجازة"}</b><small>{row.dayStatus==="work"?`${row.shiftFrom} - ${row.shiftTo}`:row.leaveType}</small></span></div>):<p>لا يوجد جدول مسجل.</p>}</div></section>
    </aside>

    <main className="employee-profile-main">
      <section className="profile-main-tabs"><button className="active">الأداء</button><span>{data.month}</span></section>
      <section className="profile-modern-kpis">{metrics.map(([label,value]:any)=><article key={label}><div><small>{label}</small><strong>{value}</strong></div></article>)}</section>
      {mode==="sales"&&<section className="profile-activity-panel"><header><div><span>ACTIVITIES</span><h3>المتابعات القادمة</h3></div><b>{sales.upcoming.length}</b></header><div className="profile-timeline">{sales.upcoming.length?sales.upcoming.map((row:any)=><article key={row.id}><i>↗</i><div><strong>{row.leadName||`Lead #${row.leadId}`}</strong><p>{row.notes||"متابعة عميل"}</p><small>{new Date(row.scheduledAt).toLocaleString("ar-EG")} · {row.channel}</small></div></article>):<p className="profile-empty">لا توجد متابعات قادمة.</p>}</div></section>}
      {(mode==="operations"||mode==="teacher")&&<>
        <section className="profile-activity-panel"><header><div><span>GROUPS</span><h3>الجروبات الحالية</h3></div><b>{ops.groups.length}</b></header><div className="profile-groups-modern">{ops.groups.map((group:any)=><article key={group.id}><div><strong>{group.title}</strong><small>{group.days}</small></div><b>{group.students}<small> طالب</small></b></article>)}</div></section>
        <section className="profile-day-summary">{Object.entries(ops.dayCounts).map(([label,value])=><article key={label}><small>{label}</small><strong>{String(value)}</strong></article>)}</section>
      </>}
      {mode==="teacher"&&<section className="profile-activity-panel"><header><div><span>ACADEMIC</span><h3>Class Visits</h3></div><b>{classVisits.length}</b></header><div className="profile-timeline">{classVisits.length?classVisits.map((visit:any)=><article key={visit.id}><i>✓</i><div><strong>{visit.groupTitle||"زيارة صفية"}</strong><p>{visit.notes||"بدون ملاحظات"}</p><small>{visit.visitDate} · {visit.visitedByName}</small></div><b>{visit.score}%</b></article>):<p className="profile-empty">لا توجد زيارات مسجلة.</p>}</div></section>}
    </main>

    <aside className="employee-profile-right">
      <TodoList tasks={data.tasks||[]} reload={load}/>
      <section className="panel profile-side-card"><header><h3>Rewards & Deductions</h3><b>{adjustments.length}</b></header><div className="compact-adjustments">{adjustments.length?adjustments.map((row:any,index:number)=><article className={row.kind} key={`${row.recordDate}-${index}`}><span>{row.kind==="reward"?"+":"−"}</span><div><strong>{row.title}</strong><small>{row.value} · {row.recordDate}</small></div></article>):<p>لا توجد معاملات مسجلة.</p>}</div></section>
      {mode==="operations"&&<section className="panel profile-side-card profile-target-card"><header><h3>Retention Target</h3></header><strong>{money(ops.retentionRevenue)}</strong><p>من {money(ops.target)}</p><div><i style={{width:`${Math.min(100,ops.targetRate)}%`}}/></div><b>{ops.targetRate}%</b></section>}
    </aside>
  </div>
}

function TodoList({tasks,reload}:{tasks:Task[];reload:()=>Promise<void>}){
  const [title,setTitle]=useState(""),[dueDate,setDueDate]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function mutate(payload:Record<string,unknown>){setBusy(true);setError("");try{const response=await fetch("/api/employee-profile/",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}),result=await response.json();if(!response.ok)throw new Error(result.error||"تعذر حفظ المهمة");await reload()}catch(reason){setError(reason instanceof Error?reason.message:"تعذر حفظ المهمة")}finally{setBusy(false)}}
  async function submit(event:FormEvent){event.preventDefault();if(!title.trim())return;await mutate({action:"create",title,dueDate});setTitle("");setDueDate("")}
  return <section className="panel profile-side-card profile-todo"><header><h3>To Do List</h3><b>{tasks.filter(task=>!task.isCompleted).length}</b></header><form onSubmit={submit}><input value={title} onChange={event=>setTitle(event.target.value)} placeholder="مهمة جديدة"/><input type="date" value={dueDate} onChange={event=>setDueDate(event.target.value)}/><button className="primary" disabled={busy||!title.trim()}>＋</button></form>{error&&<small className="form-error">{error}</small>}<div className="todo-items">{tasks.length?tasks.map(task=><article className={task.isCompleted?"done":""} key={task.id}><button disabled={busy} onClick={()=>mutate({action:"toggle",id:task.id})}>{task.isCompleted?"✓":""}</button><span><strong>{task.title}</strong><small>{task.dueDate||"بدون تاريخ"}</small></span><button className="remove" disabled={busy} onClick={()=>mutate({action:"delete",id:task.id})}>×</button></article>):<p>لا توجد مهام حاليًا.</p>}</div></section>
}
