import test from "node:test";
import assert from "node:assert/strict";
import { buildLeadsCallsAnalytics, buildRoasBreakdown, normalizeEgyptPhone } from "../app/leads-calls-report-analytics.ts";
import { normalizeSourceFields, normalizeSourceName } from "../lib/source-normalization.ts";
import { parseMarketingImportDate } from "../lib/marketing-expense-import.ts";

const json=(value)=>JSON.stringify(value);
const filters={dataFrom:"2026-06-01",dataTo:"2026-06-30",paymentFrom:"2026-05-01",paymentTo:"2026-07-31",branch:"",track:"",source:"",campaign:"",employee:"",attribution:""};
const input={
  branches:[{id:1,name:"Maadi"}],tracks:[{id:1,title:"English"}],employees:[{id:1,fullName:"Mona"}],settingsEntities:[],
  students:[
    {id:1,fullName:"Lead Student",mobile:"01011111111",secondaryMobile:"",trackId:1,trackName:"English",branchId:1,branchName:"Maadi",customData:json({linkedLeadIds:[1]}),createdAt:"2026-06-05"},
    {id:2,fullName:"Call Student",mobile:"0020 10 2222 2222",secondaryMobile:"",trackId:1,trackName:"English",branchId:1,branchName:"Maadi",customData:json({}),createdAt:"2026-06-10"},
    {id:3,fullName:"Unknown Student",mobile:"01033333333",secondaryMobile:"",trackId:1,trackName:"English",branchId:1,branchName:"Maadi",customData:json({}),createdAt:"2026-06-12"},
    {id:4,fullName:"Legacy Student",mobile:"01044444444",secondaryMobile:"",trackId:1,trackName:"English",branchId:1,branchName:"Maadi",customData:json({}),createdAt:"2026-06-14"},
    {id:5,fullName:"Retention Student",mobile:"01055555555",secondaryMobile:"",trackId:1,trackName:"English",branchId:1,branchName:"Maadi",customData:json({}),createdAt:"2026-06-15"},
    {id:6,fullName:"Unpaid Call Profile",mobile:"01066666666",secondaryMobile:"",trackId:1,trackName:"English",branchId:1,branchName:"Maadi",customData:json({}),createdAt:"2026-06-11"},
  ],
  leads:[
    {id:1,fullName:"Lead Student",primaryPhone:"01011111111",secondaryPhone:"",source:"Facebook",campaign:"June",interest:"English",status:"paid",finalStatus:"Paid",customData:json({}),assignedEmployeeId:1,assignedEmployee:"Mona",branchId:1,branchName:"Maadi",createdAt:"2026-06-01"},
    {id:2,fullName:"Older journey",primaryPhone:"01022222222",secondaryPhone:"",source:"Facebook",campaign:"June",interest:"English",status:"contacted",finalStatus:"Not Yet",customData:json({}),assignedEmployeeId:1,assignedEmployee:"Mona",branchId:1,branchName:"Maadi",createdAt:"2026-06-02"},
  ],
  calls:[
    {id:20,leadId:null,phone:"20 10 2222 2222",direction:"incoming",result:"Answered",assignedEmployeeId:1,assignedEmployee:"Mona",leadName:"Call Student",branchId:1,branchName:"Maadi",callAt:"2026-06-09",customData:json({registeredBefore:true,studentId:2})},
    {id:21,leadId:null,phone:"01099999999",direction:"incoming",result:"Answered",assignedEmployeeId:1,assignedEmployee:"Mona",leadName:"Old",branchId:1,branchName:"Maadi",callAt:"2026-06-09",customData:json({calledBefore:true})},
    {id:22,leadId:null,phone:"01066666666",direction:"incoming",result:"Answered",assignedEmployeeId:1,assignedEmployee:"Mona",leadName:"Unpaid Call Profile",branchId:1,branchName:"Maadi",callAt:"2026-06-10",customData:json({})},
  ],
  studentRecords:[
    {id:10,studentId:1,studentName:"Lead Student",kind:"payment",recordDate:"2026-06-05",status:"Paid",customData:json({main:"M-1",isMainPayment:true,levels:1,paymentType:"New Comer",total:1000,paid:500})},
    {id:11,studentId:1,studentName:"Lead Student",kind:"payment",recordDate:"2026-06-20",status:"Paid",customData:json({main:"M-1",isMainPayment:false,paid:200,refunded:50})},
    {id:20,studentId:2,studentName:"Call Student",kind:"payment",recordDate:"2026-06-10",status:"Paid",customData:json({main:"M-2",isMainPayment:true,levels:1,paymentType:"NEW COMERS",total:800,netPaid:400})},
    {id:30,studentId:3,studentName:"Unknown Student",kind:"payment",recordDate:"2026-06-12",status:"Paid",customData:json({main:"M-3",isMainPayment:true,levels:2,refundedLevels:1,paymentType:"New Comer",total:500,paid:350,refunded:50})},
    {id:40,studentId:4,studentName:"Legacy Student",kind:"payment",recordDate:"2026-06-14",status:"Paid",customData:json({main:"M-4",isMainPayment:true,levels:1,total:600,paid:600})},
    {id:41,studentId:4,studentName:"Legacy Student",kind:"payment",recordDate:"2026-06-18",status:"Paid",customData:json({main:"M-5",isMainPayment:true,levels:1,total:700,paid:700})},
    {id:50,studentId:5,studentName:"Retention Student",kind:"payment",recordDate:"2026-06-15",status:"Paid",customData:json({main:"M-6",isMainPayment:true,levels:1,paymentType:"Retention",total:900,paid:900})},
    {id:60,studentId:3,studentName:"Voided",kind:"payment",recordDate:"2026-06-16",status:"Voided",customData:json({main:"M-7",isMainPayment:true,levels:1,paymentType:"New Comer",total:2000,paid:2000})},
  ],
};

test("normalizes Egyptian phone formats",()=>{
  assert.equal(normalizeEgyptPhone("0020 10 1234 5678"),normalizeEgyptPhone("01012345678"));
  assert.equal(normalizeEgyptPhone("20 10 1234 5678"),normalizeEgyptPhone("01012345678"));
});

test("unifies Whats and WhatsApp across source fields",()=>{
  assert.equal(normalizeSourceName(" Whats "),"WhatsApp");
  assert.equal(normalizeSourceName("whatsapp"),"WhatsApp");
  assert.deepEqual(normalizeSourceFields({source:"Whats",callSource:"WHATS APP",campaign:"July"}),{source:"WhatsApp",callSource:"WhatsApp",campaign:"July"});
});

test("accepts TikTok DD-MMM-YY marketing dates",()=>{
  assert.equal(parseMarketingImportDate("27-Jul-26"),"2026-07-27");
  assert.equal(parseMarketingImportDate("28-Jul-2026"),"2026-07-28");
  assert.equal(parseMarketingImportDate("31-Feb-26"),"");
});

test("calculates ROAS by dimension from New Comers offers and ad spend",()=>{
  const rows=buildRoasBreakdown(
    [{label:"Facebook",value:120000},{label:"facebook",value:30000},{label:"Referral",value:10000}],
    [{label:"Facebook",value:50000},{label:"Google",value:20000}],
  );
  assert.deepEqual(rows.find((row)=>row.label==="Facebook"),{label:"Facebook",offerValue:150000,adSpend:50000,roas:3});
  assert.equal(rows.find((row)=>row.label==="Referral")?.roas,null);
  assert.equal(rows.find((row)=>row.label==="Google")?.roas,0);
});

test("reconciles New Comers originals without duplicating mains",()=>{
  const report=buildLeadsCallsAnalytics(input,filters);
  assert.equal(report.metrics.mains,4);
  assert.equal(report.metrics.registrations,3);
  assert.equal(report.metrics.offerValue,2900);
  assert.equal(report.metrics.paid,1950);
  assert.equal(report.metrics.leadPaid,650);
  assert.equal(report.metrics.callPaid,400);
  assert.equal(report.metrics.unattributedPaid,900);
  assert.equal(report.metrics.reconciliationDifference,0);
  assert.equal(report.receipts.length,5);
});

test("separates call registrations, paid profiles, and New Comers total offers",()=>{
  const report=buildLeadsCallsAnalytics(input,{...filters,attribution:"Call"});
  const callOrigins=report.filteredOrigins.filter((origin)=>origin.kind==="Call");
  const registered=new Set(callOrigins.flatMap((origin)=>origin.studentIds));
  const callMains=report.mains.filter((main)=>main.originType==="Call");
  const paid=new Set(callMains.map((main)=>main.record.studentId));
  assert.equal(callOrigins.length,2);
  assert.equal(registered.size,2);
  assert.equal(paid.size,1);
  assert.equal(callMains.reduce((sum,main)=>sum+main.offerValue,0),800);
  assert.equal(report.metrics.callRegistered,2);
});

test("attributes a profile to only the latest acquisition channel before registration",()=>{
  const mixed=structuredClone(input);
  mixed.students.push({id:7,fullName:"Mixed Journey",mobile:"01077777777",secondaryMobile:"",trackId:1,trackName:"English",branchId:1,branchName:"Maadi",customData:json({}),createdAt:"2026-06-12T12:00:00Z"});
  mixed.leads.push({id:3,fullName:"Mixed Journey",primaryPhone:"01077777777",secondaryPhone:"",source:"Facebook",campaign:"June",interest:"English",status:"contacted",finalStatus:"Not Yet",customData:json({}),assignedEmployeeId:1,assignedEmployee:"Mona",branchId:1,branchName:"Maadi",createdAt:"2026-06-10T10:00:00Z"});
  mixed.calls.push({id:23,leadId:null,phone:"01077777777",direction:"incoming",result:"Answered",assignedEmployeeId:1,assignedEmployee:"Mona",leadName:"Mixed Journey",branchId:1,branchName:"Maadi",callAt:"2026-06-11T10:00:00Z",customData:json({})});
  mixed.studentRecords.push({id:70,studentId:7,studentName:"Mixed Journey",kind:"payment",recordDate:"2026-06-12",status:"Paid",customData:json({main:"M-7",isMainPayment:true,levels:1,paymentType:"New Comer",total:900,paid:400})});
  const report=buildLeadsCallsAnalytics(mixed,{...filters,attribution:""});
  const leadProfileIds=new Set(report.filteredOrigins.filter((origin)=>origin.kind==="Lead").flatMap((origin)=>origin.studentIds));
  const callProfileIds=new Set(report.filteredOrigins.filter((origin)=>origin.kind==="Call").flatMap((origin)=>origin.studentIds));
  const main=report.mains.find((item)=>item.record.studentId===7);
  assert.equal(leadProfileIds.has(7),false);
  assert.equal(callProfileIds.has(7),true);
  assert.equal(main?.originType,"Call");
  assert.equal(main?.offerValue,900);
});

test("uses the closest valid call before profile creation when no explicit link exists",()=>{
  const report=buildLeadsCallsAnalytics(input,filters);
  const callReceipt=report.receipts.find((row)=>row.studentId===2);
  assert.equal(callReceipt?.originType,"Call");
  assert.equal(callReceipt?.matchMethod,"Student Link");
  assert.equal(callReceipt?.confidence,"High");
});

test("keeps empty months in both monthly charts and uses same-month channel share",()=>{
  const report=buildLeadsCallsAnalytics(input,filters);
  assert.deepEqual(report.leadMonths.map((row)=>row.month),["2026-05","2026-06","2026-07"]);
  assert.equal(report.leadMonths[0].paid,0);
  assert.equal(report.callMonths[2].receipts,0);
  assert.equal(report.leadMonths[1].share,650*100/1050);
  assert.equal(report.callMonths[1].share,400*100/1050);
});

test("infers receipt months when the offer period is open ended",()=>{
  const openEndedInput=structuredClone(input);
  openEndedInput.studentRecords.push({id:12,studentId:1,studentName:"Lead Student",kind:"payment",recordDate:"2026-07-10",status:"Paid",customData:json({main:"M-1",isMainPayment:false,paid:300})});
  const report=buildLeadsCallsAnalytics(openEndedInput,{...filters,paymentFrom:"",paymentTo:"",attribution:"Lead"});
  assert.deepEqual(report.leadMonths.map((row)=>row.month),["2026-06","2026-07"]);
  assert.equal(report.leadMonths[0].paid,650);
  assert.equal(report.leadMonths[1].paid,300);
  assert.equal(report.leadMonths[0].share,100);
  assert.equal(report.leadMonths[1].share,100);
});


test("honors payment-level explicit links for New Comers attribution",()=>{
  const explicitInput=structuredClone(input);
  explicitInput.students.push({id:8,fullName:"Payment Linked",mobile:"01088888888",secondaryMobile:"",trackId:1,trackName:"English",branchId:1,branchName:"Maadi",customData:json({}),createdAt:"2026-06-07"});
  explicitInput.leads.push({id:8,fullName:"Payment Linked Lead",primaryPhone:"01000000008",secondaryPhone:"",source:"Referral",campaign:"June",interest:"English",status:"contacted",finalStatus:"Not Yet",customData:json({}),assignedEmployeeId:1,assignedEmployee:"Mona",branchId:1,branchName:"Maadi",createdAt:"2026-06-01"});
  explicitInput.studentRecords.push({id:80,studentId:8,studentName:"Payment Linked",kind:"payment",recordDate:"2026-06-08",status:"Paid",customData:json({main:"M-8",isMainPayment:true,levels:1,paymentType:"New Comer",total:1200,paid:600,leadId:8})});
  explicitInput.studentRecords.push({id:81,studentId:8,studentName:"Payment Linked",kind:"payment",recordDate:"2026-06-20",status:"Paid",customData:json({main:"M-8",isMainPayment:false,paid:250,refunded:50,leadId:8})});
  const report=buildLeadsCallsAnalytics(explicitInput,filters);
  const rows=report.receipts.filter((row)=>row.studentId===8);
  assert.equal(rows.length,2);
  assert.equal(rows.reduce((sum,row)=>sum+row.paid,0),800);
  assert.equal(rows.every((row)=>row.originType==="Lead"),true);
  assert.equal(rows.every((row)=>row.matchMethod==="Explicit Link"),true);
  assert.equal(report.mains.filter((main)=>main.record.studentId===8).length,1);
});


test("matches student mobile against lead secondary phone",()=>{
  const secondaryInput=structuredClone(input);
  secondaryInput.students.push({id:9,fullName:"Secondary Phone",mobile:"01099990000",secondaryMobile:"",trackId:1,trackName:"English",branchId:1,branchName:"Maadi",customData:json({}),createdAt:"2026-06-09"});
  secondaryInput.leads.push({id:9,fullName:"Secondary Phone Lead",primaryPhone:"01000000009",secondaryPhone:"0020 10 9999 0000",source:"Google",campaign:"June",interest:"English",status:"contacted",finalStatus:"Not Yet",customData:json({}),assignedEmployeeId:1,assignedEmployee:"Mona",branchId:1,branchName:"Maadi",createdAt:"2026-06-04"});
  secondaryInput.studentRecords.push({id:90,studentId:9,studentName:"Secondary Phone",kind:"payment",recordDate:"2026-06-09",status:"Paid",customData:json({main:"M-9",isMainPayment:true,levels:1,paymentType:"New Comer",total:700,paid:300})});
  const report=buildLeadsCallsAnalytics(secondaryInput,filters);
  const row=report.receipts.find((receipt)=>receipt.studentId===9);
  assert.equal(row?.originType,"Lead");
  assert.equal(row?.matchMethod,"Student Link");
});
