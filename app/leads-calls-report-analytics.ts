import { normalizeSourceName } from "../lib/source-normalization.ts";

export type AttributionKind="Lead"|"Call"|"Unattributed";
export type MatchMethod="Explicit Link"|"Student Link"|"Phone Match"|"No Match";
export type Confidence="High"|"Medium"|"Low";

type JsonRow={customData:string};
type ReportStudent={id:number;fullName:string;mobile:string;secondaryMobile:string;trackId:number|null;trackName:string|null;branchId:number|null;branchName:string|null;customData:string;createdAt:string};
type ReportRecord={id:number;studentId:number;studentName:string;kind:string;recordDate:string;status:string;customData:string};
type ReportLead={id:number;fullName:string;primaryPhone:string;secondaryPhone:string;source:string;campaign:string;interest:string;status:string;finalStatus:string;customData:string;assignedEmployeeId:number;assignedEmployee:string;branchId:number;branchName:string;createdAt:string};
type ReportCall={id:number;leadId:number|null;phone:string;direction:string;result:string;assignedEmployeeId:number;assignedEmployee:string;leadName:string|null;branchId:number;branchName:string;callAt:string;customData:string};
type NamedEntity={id:number;title?:string;name?:string;fullName?:string;kind?:string;customData?:string};

export type LeadsCallsAnalyticsInput={
  students:ReportStudent[];
  studentRecords:ReportRecord[];
  leads:ReportLead[];
  calls:ReportCall[];
  branches:NamedEntity[];
  tracks:NamedEntity[];
  employees:NamedEntity[];
  settingsEntities:NamedEntity[];
};

export type LeadsCallsFilters={
  dataFrom:string;dataTo:string;paymentFrom:string;paymentTo:string;
  branch:string;track:string;source:string;campaign:string;employee:string;attribution:string;
};

export type AcquisitionOrigin={
  kind:"Lead"|"Call";id:number;date:string;name:string;phone:string;phones:string[];source:string;campaign:string;
  segment:string;location:string;government:string;track:string;branch:string;employee:string;studentIds:number[];
};

export type ReceiptAuditRow={
  receiptId:number;receiptNumber:string;studentId:number;student:string;mainNumber:string;offer:string;
  paymentDate:string;paid:number;originType:AttributionKind;originId:number|null;matchMethod:MatchMethod;
  confidence:Confidence;branch:string;track:string;
};

export type BreakdownRow={
  label:string;leads:number;calls:number;data:number;registered:number;conversion:number;
  offerValue:number;paid:number;collectionRate:number;paidShare:number;revenuePerData:number;
};

export type MonthlyChannelRow={
  month:string;paid:number;receipts:number;registrations:number;offerValue:number;collectionRate:number;share:number;
};

export type RoasValueRow={label:string;value:number};
export type RoasBreakdownRow={label:string;offerValue:number;adSpend:number;roas:number|null};

export function buildRoasBreakdown(offers:RoasValueRow[],expenses:RoasValueRow[]):RoasBreakdownRow[]{
  const rows=new Map<string,RoasBreakdownRow>();
  const add=(input:RoasValueRow,field:"offerValue"|"adSpend")=>{
    const label=String(input.label||"Unspecified").trim()||"Unspecified",key=label.toLocaleLowerCase();
    const row=rows.get(key)||{label,offerValue:0,adSpend:0,roas:null};
    row[field]+=Math.max(0,Number(input.value||0));rows.set(key,row);
  };
  for(const row of offers)add(row,"offerValue");
  for(const row of expenses)add(row,"adSpend");
  return Array.from(rows.values())
    .map((row)=>({...row,roas:row.adSpend>0?row.offerValue/row.adSpend:null}))
    .sort((a,b)=>b.offerValue-a.offerValue||b.adSpend-a.adSpend||a.label.localeCompare(b.label));
}

type PaymentRow={record:ReportRecord;detail:Record<string,unknown>};
type MainRow=PaymentRow&{
  key:string;offerValue:number;offer:string;branch:string;track:string;student:ReportStudent|undefined;
  origin:AcquisitionOrigin|null;originType:AttributionKind;matchMethod:MatchMethod;confidence:Confidence;
};

export type LeadsCallsAnalytics={
  origins:AcquisitionOrigin[];
  filteredOrigins:AcquisitionOrigin[];
  mains:MainRow[];
  receipts:ReceiptAuditRow[];
  breakdowns:Record<"month"|"location"|"source"|"campaign"|"track"|"branch"|"employee",BreakdownRow[]>;
  leadMonths:MonthlyChannelRow[];callMonths:MonthlyChannelRow[];
  options:Record<"branch"|"track"|"source"|"campaign"|"employee",string[]>;
  metrics:{
    totalLeads:number;inboundCalls:number;registrations:number;mains:number;offerValue:number;paid:number;
    outstanding:number;collectionRate:number;attributionCoverage:number;unattributedPaid:number;
    leadRegistered:number;callRegistered:number;leadPaid:number;callPaid:number;leadReceipts:number;callReceipts:number;
    leadConversion:number;callConversion:number;leadShare:number;callShare:number;leadRevenuePerData:number;callRevenuePerData:number;
    reconciliationDifference:number;
  };
};

const parse=(row:JsonRow|undefined)=>{try{return JSON.parse(row?.customData||"{}") as Record<string,unknown>}catch{return {}}};
const value=(input:unknown,fallback="Unspecified")=>String(input??"").trim()||fallback;
const dateKey=(input:unknown)=>String(input||"").match(/^\d{4}-\d{2}-\d{2}/)?.[0]||"";
const truthy=(input:unknown)=>input===true||input===1||String(input).toLowerCase()==="true";
const unique=(values:unknown[])=>Array.from(new Set(values.map(Number).filter(Boolean)));
const linkedIds=(detail:Record<string,unknown>,singular:"leadId"|"callId",plural:"linkedLeadIds"|"linkedCallIds")=>unique([detail[singular],...(Array.isArray(detail[plural])?detail[plural]:[])]);
const inRange=(date:string,from:string,to:string)=>Boolean(date)&&(!from||date>=from)&&(!to||date<=to);
const timestamp=(input:unknown)=>{const text=String(input||"").trim(),normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)?`${text.replace(" ","T")}Z`:text,time=new Date(normalized).getTime();return Number.isFinite(time)?time:Number.NaN};
const listMonths=(from:string,to:string)=>{
  if(!/^\d{4}-\d{2}/.test(from)||!/^\d{4}-\d{2}/.test(to))return [];
  const result:string[]=[];let [year,month]=from.slice(0,7).split("-").map(Number),guard=0;
  const end=to.slice(0,7);
  while(guard++<240){const key=`${year}-${String(month).padStart(2,"0")}`;result.push(key);if(key===end)break;month++;if(month>12){month=1;year++}}
  return result;
};

export function normalizeEgyptPhone(input:unknown){
  let digits=String(input||"").replace(/\D/g,"");
  if(digits.startsWith("0020"))digits=digits.slice(4);
  else if(digits.startsWith("20")&&/^201[0125]/.test(digits))digits=digits.slice(2);
  if(/^1[0125]\d{8}$/.test(digits))digits=`0${digits}`;
  return digits.length>=10?digits.slice(-10):digits;
}

function activeLevels(detail:Record<string,unknown>,settings:NamedEntity[]){
  const configured=settings.find((item)=>item.kind==="offer"&&item.id===Number(detail.offerId));
  const configuredDetail=parse(configured as JsonRow|undefined),raw=detail.levels??configuredDetail.levels??0;
  const levels=Array.isArray(raw)?raw.length:Number(raw||0),refunded=Array.isArray(detail.refundedLevels)?detail.refundedLevels.length:Number(detail.refundedLevels||0);
  return Math.max(0,levels-refunded);
}

function isVoided(row:PaymentRow){
  return truthy(row.detail.voided)||String(row.record.status||"").toLowerCase()==="voided";
}

function receiptPaid(detail:Record<string,unknown>){
  return Math.max(0,detail.netPaid!==undefined?Number(detail.netPaid||0):Number(detail.paid||0)-Number(detail.refunded||0));
}

function mainKey(record:ReportRecord,detail:Record<string,unknown>){
  return `${record.studentId}:${String(detail.main||record.id)}`;
}

function originMatchesFilters(origin:AcquisitionOrigin,filters:LeadsCallsFilters){
  return inRange(origin.date,filters.dataFrom,filters.dataTo)
    &&(!filters.branch||origin.branch===filters.branch)&&(!filters.track||origin.track===filters.track)
    &&(!filters.source||normalizeSourceName(origin.source)===normalizeSourceName(filters.source))&&(!filters.campaign||origin.campaign===filters.campaign)
    &&(!filters.employee||origin.employee===filters.employee);
}

type PreparedLeadsCallsAnalytics={
  origins:AcquisitionOrigin[];
  payments:PaymentRow[];
  allMains:MainRow[];
};

const preparedAnalyticsCache=new WeakMap<LeadsCallsAnalyticsInput,PreparedLeadsCallsAnalytics>();

function prepareLeadsCallsAnalytics(data:LeadsCallsAnalyticsInput):PreparedLeadsCallsAnalytics{
  const cached=preparedAnalyticsCache.get(data);
  if(cached)return cached;
  const branchById=new Map(data.branches.map((item)=>[item.id,value(item.name)])),trackById=new Map(data.tracks.map((item)=>[item.id,value(item.title)])),employeeById=new Map(data.employees.map((item)=>[item.id,value(item.fullName)]));
  const payments:PaymentRow[]=data.studentRecords.filter((record)=>record.kind==="payment").map((record)=>({record,detail:parse(record)})).filter((row)=>!isVoided(row));
  const studentsById=new Map(data.students.map((item)=>[item.id,item])),studentLeadLinks=new Map<number,number[]>(),studentCallLinks=new Map<number,number[]>(),studentPhones=new Map<number,string[]>();
  for(const student of data.students){
    const detail=parse(student),leadIds=unique(Array.isArray(detail.linkedLeadIds)?detail.linkedLeadIds:[]),callIds=unique(Array.isArray(detail.linkedCallIds)?detail.linkedCallIds:[]);
    for(const id of leadIds)studentLeadLinks.set(id,[...(studentLeadLinks.get(id)||[]),student.id]);
    for(const id of callIds)studentCallLinks.set(id,[...(studentCallLinks.get(id)||[]),student.id]);
    studentPhones.set(student.id,[student.mobile,student.secondaryMobile,detail.fbMobile].map(normalizeEgyptPhone).filter(Boolean));
  }
  const originStudentIds=(detail:Record<string,unknown>,linked:number[]|undefined)=>unique([detail.studentId,detail.existingStudentId,detail.registeredStudentId,...(linked||[])]);
  type OriginDraft=AcquisitionOrigin&{eventTime:number;detail:Record<string,unknown>;explicitStudentIds:number[];storedRegisteredBefore:boolean};
  const leadDrafts:OriginDraft[]=data.leads
    .filter((lead)=>String(lead.status||"").toLowerCase()!=="old_call"&&lead.finalStatus!=="Old Call")
    .map((lead)=>{const detail=parse(lead),explicitStudentIds=originStudentIds(detail,studentLeadLinks.get(lead.id));return {kind:"Lead",id:lead.id,date:dateKey(lead.createdAt),eventTime:timestamp(lead.createdAt),detail,explicitStudentIds,storedRegisteredBefore:String(lead.status||"").toLowerCase()==="registered_before"||["Registered Before","Old Student"].includes(lead.finalStatus)||truthy(detail.registeredBefore),name:value(lead.fullName,"Unnamed Lead"),phone:lead.primaryPhone,phones:[lead.primaryPhone,lead.secondaryPhone],source:normalizeSourceName(lead.source||detail.source,"Unspecified"),campaign:value(lead.campaign||detail.campaign),segment:value(detail.segment),location:value(detail.area||detail.governorate||detail.country||lead.branchName),government:value(detail.governorate||detail.government||detail.area||detail.country),track:value(lead.interest||detail.track||trackById.get(Number(detail.trackId))),branch:value(lead.branchName||detail.branch||detail.originalBranch||branchById.get(lead.branchId)),employee:value(lead.assignedEmployee||detail.originalAgent||employeeById.get(lead.assignedEmployeeId)),studentIds:[]}});
  const callDrafts:OriginDraft[]=data.calls.filter((call)=>{const detail=parse(call);return call.direction==="incoming"&&!truthy(detail.oldLead)&&!truthy(detail.calledBefore)}).map((call)=>{const detail=parse(call),explicitStudentIds=originStudentIds(detail,studentCallLinks.get(call.id));return {kind:"Call",id:call.id,date:dateKey(call.callAt),eventTime:timestamp(call.callAt),detail,explicitStudentIds,storedRegisteredBefore:truthy(detail.registeredBefore),name:value(call.leadName||detail.fullName,"Inbound Caller"),phone:call.phone,phones:[call.phone,detail.secondaryPhone,detail.secondaryMobile],source:normalizeSourceName(detail.source||detail.callSource,"Inbound Call"),campaign:value(detail.campaign),segment:value(detail.segment),location:value(detail.area||detail.governorate||detail.country||call.branchName),government:value(detail.governorate||detail.government||detail.area||detail.country),track:value(detail.track||detail.legacyCourse||trackById.get(Number(detail.trackId))),branch:value(call.branchName||detail.originalBranch||branchById.get(call.branchId)),employee:value(call.assignedEmployee||detail.originalAgent||employeeById.get(call.assignedEmployeeId)),studentIds:[]}});
  const originDrafts=[...leadDrafts,...callDrafts],originsByPhoneDraft=new Map<string,OriginDraft[]>(),explicitOriginsByStudent=new Map<number,OriginDraft[]>();
  for(const origin of originDrafts){for(const phone of origin.phones.map(normalizeEgyptPhone).filter(Boolean))originsByPhoneDraft.set(phone,[...(originsByPhoneDraft.get(phone)||[]),origin]);for(const studentId of origin.explicitStudentIds)explicitOriginsByStudent.set(studentId,[...(explicitOriginsByStudent.get(studentId)||[]),origin])}
  const originDraftByKey=new Map(originDrafts.map((origin)=>[`${origin.kind}:${origin.id}`,origin]));
  for(const row of payments){
    for(const id of linkedIds(row.detail,"leadId","linkedLeadIds")){const origin=originDraftByKey.get(`Lead:${id}`);if(origin)explicitOriginsByStudent.set(row.record.studentId,[...(explicitOriginsByStudent.get(row.record.studentId)||[]),origin])}
    for(const id of linkedIds(row.detail,"callId","linkedCallIds")){const origin=originDraftByKey.get(`Call:${id}`);if(origin)explicitOriginsByStudent.set(row.record.studentId,[...(explicitOriginsByStudent.get(row.record.studentId)||[]),origin])}
  }
  const beforeProfile=(origin:OriginDraft,student:ReportStudent)=>{const profileTime=timestamp(student.createdAt);return Number.isFinite(origin.eventTime)&&Number.isFinite(profileTime)?origin.eventTime<=profileTime:origin.date<=dateKey(student.createdAt)};
  for(const student of data.students){const explicit=(explicitOriginsByStudent.get(student.id)||[]).filter((origin)=>beforeProfile(origin,student)),phoneMatches=new Map<string,OriginDraft>();for(const phone of studentPhones.get(student.id)||[])for(const origin of originsByPhoneDraft.get(phone)||[])if(beforeProfile(origin,student))phoneMatches.set(`${origin.kind}:${origin.id}`,origin);const candidates=explicit.length?explicit:Array.from(phoneMatches.values()),chosen=[...candidates].sort((a,b)=>(b.eventTime||0)-(a.eventTime||0)||b.id-a.id)[0];if(chosen)chosen.studentIds=unique([...chosen.studentIds,student.id])}
  const toOrigin=({eventTime:_,detail:__,explicitStudentIds:___,storedRegisteredBefore:____,...origin}:OriginDraft):AcquisitionOrigin=>origin;
  const leads:AcquisitionOrigin[]=leadDrafts.filter((lead)=>!lead.storedRegisteredBefore||lead.studentIds.length>0).map(toOrigin);
  const calls:AcquisitionOrigin[]=callDrafts.filter((call)=>!call.storedRegisteredBefore||call.studentIds.length>0).map(toOrigin);
  const origins=[...leads,...calls],originByKey=new Map(origins.map((origin)=>[`${origin.kind}:${origin.id}`,origin]));
  const originsByStudent=new Map<number,AcquisitionOrigin[]>(),originsByPhone=new Map<string,AcquisitionOrigin[]>();
  for(const origin of origins){
    for(const studentId of origin.studentIds)originsByStudent.set(studentId,[...(originsByStudent.get(studentId)||[]),origin]);
    for(const phone of origin.phones.map(normalizeEgyptPhone).filter(Boolean))originsByPhone.set(phone,[...(originsByPhone.get(phone)||[]),origin]);
  }
  const educationalMains=payments.filter((row)=>truthy(row.detail.isMainPayment)&&activeLevels(row.detail,data.settingsEntities)>=1).sort((a,b)=>dateKey(a.record.recordDate).localeCompare(dateKey(b.record.recordDate))||a.record.id-b.record.id);
  const firstEducationalMain=new Map<number,PaymentRow>();for(const row of educationalMains)if(!firstEducationalMain.has(row.record.studentId))firstEducationalMain.set(row.record.studentId,row);
  const eligible=educationalMains.filter((row)=>{const explicit=String(row.detail.paymentType||"").trim();if(explicit)return /new\s*comer/i.test(explicit);return firstEducationalMain.get(row.record.studentId)?.record.id===row.record.id});
  const dedupedMains=new Map<string,PaymentRow>();for(const row of eligible){const key=mainKey(row.record,row.detail),saved=dedupedMains.get(key);if(!saved||row.record.id<saved.record.id)dedupedMains.set(key,row)}
  const findAttribution=(row:PaymentRow)=>{
    const student=studentsById.get(row.record.studentId),studentDetail=parse(student),mainDate=dateKey(row.record.recordDate),candidates:Array<{origin:AcquisitionOrigin;method:MatchMethod;confidence:Confidence;priority:number}>=[];
    const add=(origin:AcquisitionOrigin|undefined,method:MatchMethod,confidence:Confidence,priority:number)=>{if(origin&&origin.date&&origin.date<=mainDate)candidates.push({origin,method,confidence,priority})};
    for(const id of unique([...linkedIds(row.detail,"leadId","linkedLeadIds"),...(Array.isArray(studentDetail.linkedLeadIds)?studentDetail.linkedLeadIds:[])]))add(originByKey.get(`Lead:${id}`),"Explicit Link","High",3);
    for(const id of unique([...linkedIds(row.detail,"callId","linkedCallIds"),...(Array.isArray(studentDetail.linkedCallIds)?studentDetail.linkedCallIds:[])]))add(originByKey.get(`Call:${id}`),"Explicit Link","High",3);
    for(const origin of originsByStudent.get(row.record.studentId)||[])add(origin,"Student Link","High",2);
    for(const phone of studentPhones.get(row.record.studentId)||[])for(const origin of originsByPhone.get(phone)||[])add(origin,"Phone Match","Medium",1);
    candidates.sort((a,b)=>b.priority-a.priority||b.origin.date.localeCompare(a.origin.date)||b.origin.id-a.origin.id);
    return candidates[0]||{origin:null,method:"No Match" as MatchMethod,confidence:"Low" as Confidence,priority:0};
  };
  const allMains:MainRow[]=Array.from(dedupedMains,([key,row])=>{const student=studentsById.get(row.record.studentId),attribution=findAttribution(row),offer=value(row.detail.originalOffer||row.detail.offer||row.detail.offerName,"New Comers Offer"),branch=value(row.detail.branch||row.detail.branchName||student?.branchName||branchById.get(Number(row.detail.branchId||student?.branchId))),track=value(row.detail.track||row.detail.trackName||student?.trackName||trackById.get(Number(row.detail.trackId||student?.trackId)));return {...row,key,student,offer,offerValue:Math.max(0,Number(row.detail.total||0)),branch,track,origin:attribution.origin,originType:attribution.origin?.kind||"Unattributed",matchMethod:attribution.method,confidence:attribution.confidence}});
  const prepared={origins,payments,allMains};
  preparedAnalyticsCache.set(data,prepared);
  return prepared;
}

export function buildLeadsCallsAnalytics(data:LeadsCallsAnalyticsInput,filters:LeadsCallsFilters):LeadsCallsAnalytics{
  const {origins,payments,allMains}=prepareLeadsCallsAnalytics(data);
  const attributionAllowed=(main:MainRow)=>{
    if(filters.attribution&&main.originType!==filters.attribution)return false;
    if(filters.branch&&main.branch!==filters.branch)return false;if(filters.track&&main.track!==filters.track)return false;
    if(main.origin)return originMatchesFilters(main.origin,{...filters,branch:"",track:""});
    return !filters.source&&!filters.campaign&&!filters.employee;
  };
  const mains=allMains.filter((main)=>inRange(dateKey(main.record.recordDate),filters.paymentFrom,filters.paymentTo)&&attributionAllowed(main));
  const selectedMainByKey=new Map(mains.map((main)=>[main.key,main])),filteredOrigins=origins.filter((origin)=>originMatchesFilters(origin,filters)&&(!filters.attribution||filters.attribution==="Unattributed"||origin.kind===filters.attribution));
  const receiptRows=payments.filter((row)=>selectedMainByKey.has(mainKey(row.record,row.detail))&&inRange(dateKey(row.record.recordDate),filters.paymentFrom,filters.paymentTo));
  const receipts:ReceiptAuditRow[]=receiptRows.map((row)=>{const main=selectedMainByKey.get(mainKey(row.record,row.detail))!;return {receiptId:row.record.id,receiptNumber:value(row.detail.invoice||row.detail.invoiceId||row.detail.receiptNumber,String(row.record.id)),studentId:row.record.studentId,student:row.record.studentName||main.student?.fullName||"—",mainNumber:main.key.split(":").slice(1).join(":"),offer:main.offer,paymentDate:dateKey(row.record.recordDate),paid:receiptPaid(row.detail),originType:main.originType,originId:main.origin?.id||null,matchMethod:main.matchMethod,confidence:main.confidence,branch:main.branch,track:main.track}});
  const paid=receipts.reduce((sum,row)=>sum+row.paid,0),leadPaid=receipts.filter((row)=>row.originType==="Lead").reduce((sum,row)=>sum+row.paid,0),callPaid=receipts.filter((row)=>row.originType==="Call").reduce((sum,row)=>sum+row.paid,0),unattributedPaid=receipts.filter((row)=>row.originType==="Unattributed").reduce((sum,row)=>sum+row.paid,0),offerValue=mains.reduce((sum,row)=>sum+row.offerValue,0),registeredIds=new Set(filteredOrigins.flatMap((origin)=>origin.studentIds)),leadRegisteredIds=new Set(filteredOrigins.filter((origin)=>origin.kind==="Lead").flatMap((origin)=>origin.studentIds)),callRegisteredIds=new Set(filteredOrigins.filter((origin)=>origin.kind==="Call").flatMap((origin)=>origin.studentIds)),attributedPaid=leadPaid+callPaid;
  const metrics={totalLeads:filteredOrigins.filter((row)=>row.kind==="Lead").length,inboundCalls:filteredOrigins.filter((row)=>row.kind==="Call").length,registrations:registeredIds.size,mains:mains.length,offerValue,paid,outstanding:Math.max(0,offerValue-paid),collectionRate:offerValue?paid*100/offerValue:0,attributionCoverage:paid?attributedPaid*100/paid:0,unattributedPaid,leadRegistered:leadRegisteredIds.size,callRegistered:callRegisteredIds.size,leadPaid,callPaid,leadReceipts:receipts.filter((row)=>row.originType==="Lead").length,callReceipts:receipts.filter((row)=>row.originType==="Call").length,leadConversion:filteredOrigins.filter((row)=>row.kind==="Lead").length?leadRegisteredIds.size*100/filteredOrigins.filter((row)=>row.kind==="Lead").length:0,callConversion:filteredOrigins.filter((row)=>row.kind==="Call").length?callRegisteredIds.size*100/filteredOrigins.filter((row)=>row.kind==="Call").length:0,leadShare:attributedPaid?leadPaid*100/attributedPaid:0,callShare:attributedPaid?callPaid*100/attributedPaid:0,leadRevenuePerData:filteredOrigins.filter((row)=>row.kind==="Lead").length?leadPaid/filteredOrigins.filter((row)=>row.kind==="Lead").length:0,callRevenuePerData:filteredOrigins.filter((row)=>row.kind==="Call").length?callPaid/filteredOrigins.filter((row)=>row.kind==="Call").length:0,reconciliationDifference:paid-leadPaid-callPaid-unattributedPaid};
  const configuredMonths=listMonths(filters.paymentFrom,filters.paymentTo),observedReceiptMonths=Array.from(new Set(receipts.map((row)=>row.paymentDate.slice(0,7)).filter(Boolean))).sort(),months=configuredMonths.length?configuredMonths:observedReceiptMonths.length?listMonths(observedReceiptMonths[0],observedReceiptMonths[observedReceiptMonths.length-1]):[];
  const attributedPaidByMonth=new Map<string,number>();
  for(const row of receipts)if(row.originType==="Lead"||row.originType==="Call"){const month=row.paymentDate.slice(0,7);attributedPaidByMonth.set(month,(attributedPaidByMonth.get(month)||0)+row.paid)}
  const monthly=(kind:"Lead"|"Call"):MonthlyChannelRow[]=>months.map((month)=>{const channelReceipts=receipts.filter((row)=>row.originType===kind&&row.paymentDate.slice(0,7)===month),channelMains=mains.filter((main)=>main.originType===kind&&dateKey(main.record.recordDate).slice(0,7)===month),channelPaid=channelReceipts.reduce((sum,row)=>sum+row.paid,0),channelOffer=channelMains.reduce((sum,row)=>sum+row.offerValue,0),monthAttributedPaid=attributedPaidByMonth.get(month)||0;return {month,paid:channelPaid,receipts:channelReceipts.length,registrations:new Set(channelMains.map((main)=>main.record.studentId)).size,offerValue:channelOffer,collectionRate:channelOffer?channelPaid*100/channelOffer:0,share:monthAttributedPaid?channelPaid*100/monthAttributedPaid:0}});
  const labelFor=(type:keyof LeadsCallsAnalytics["breakdowns"],origin:AcquisitionOrigin|null,main?:MainRow)=>type==="month"?(origin?.date.slice(0,7)||dateKey(main?.record.recordDate).slice(0,7)||"Unspecified"):type==="track"?(main?.track||origin?.track||"Unspecified"):type==="branch"?(main?.branch||origin?.branch||"Unspecified"):value(origin?.[type as "location"|"source"|"campaign"|"employee"]);
  const breakdown=(type:keyof LeadsCallsAnalytics["breakdowns"])=>{
    const map=new Map<string,{label:string;leads:number;calls:number;registered:Set<number>;offerValue:number;paid:number}>();
    const rowFor=(label:string)=>{const saved=map.get(label);if(saved)return saved;const created={label,leads:0,calls:0,registered:new Set<number>(),offerValue:0,paid:0};map.set(label,created);return created};
    for(const origin of filteredOrigins){const row=rowFor(labelFor(type,origin));if(origin.kind==="Lead")row.leads++;else row.calls++}
    for(const main of mains){const row=rowFor(labelFor(type,main.origin,main));row.registered.add(main.record.studentId);row.offerValue+=main.offerValue}
    for(const receipt of receipts){const main=selectedMainByKey.get(`${receipt.studentId}:${receipt.mainNumber}`);rowFor(labelFor(type,main?.origin||null,main)).paid+=receipt.paid}
    return Array.from(map.values()).map((row):BreakdownRow=>{const count=row.leads+row.calls;return {label:row.label,leads:row.leads,calls:row.calls,data:count,registered:row.registered.size,conversion:count?row.registered.size*100/count:0,offerValue:row.offerValue,paid:row.paid,collectionRate:row.offerValue?row.paid*100/row.offerValue:0,paidShare:paid?row.paid*100/paid:0,revenuePerData:count?row.paid/count:0}}).sort((a,b)=>b.paid-a.paid||b.data-a.data||a.label.localeCompare(b.label));
  };
  const option=(field:"branch"|"track"|"source"|"campaign"|"employee")=>Array.from(new Set(origins.map((origin)=>origin[field]).filter((item)=>item&&item!=="Unspecified"))).sort((a,b)=>a.localeCompare(b));
  return {origins,filteredOrigins,mains,receipts,leadMonths:monthly("Lead"),callMonths:monthly("Call"),breakdowns:{month:breakdown("month"),location:breakdown("location"),source:breakdown("source"),campaign:breakdown("campaign"),track:breakdown("track"),branch:breakdown("branch"),employee:breakdown("employee")},options:{branch:Array.from(new Set([...option("branch"),...allMains.map((main)=>main.branch)])).filter((item)=>item!=="Unspecified").sort(),track:Array.from(new Set([...option("track"),...allMains.map((main)=>main.track)])).filter((item)=>item!=="Unspecified").sort(),source:option("source"),campaign:option("campaign"),employee:option("employee")},metrics};
}
