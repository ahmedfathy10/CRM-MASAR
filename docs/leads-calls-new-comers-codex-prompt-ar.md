# Prompt تنفيذ صفحة Leads & Calls — New Comers Revenue

طوّر صفحة التقرير الحالية `LeadsCallsReportPage` داخل مشروع الـCRM إلى Dashboard احترافي باسم:

`Leads & Calls — New Comers Revenue`

استخدم تصميمًا متوافقًا مع هوية المشروع الحالية: خلفية فاتحة دافئة، أخضر داكن كلون رئيسي، أزرق للـLeads، وذهبي/Amber للـCalls. حافظ على الـsidebar والـlayout الموجودين، واجعل الصفحة responsive ومتوافقة مع RTL/LTR. لا تستخدم أرقامًا تجريبية؛ كل القيم يجب أن تأتي من البيانات الفعلية.

## نطاق التقرير الإلزامي

- التقرير يتعامل فقط مع عروض `New Comers`.
- `New Comers Offer Value` هو مجموع `detail.total` من إيصالات الـMain المؤهلة فقط، مرة واحدة لكل Main.
- الـMain المؤهل يجب أن يكون:
  - `kind === "payment"`
  - غير `Voided` و`detail.voided !== true`
  - `detail.isMainPayment === true`
  - عرض تعليمي فعلي (`levels >= 1` بعد خصم `refundedLevels`)
  - `paymentType` يحتوي `New Comer` بدون حساسية لحالة الأحرف.
- لو البيانات القديمة لا تحتوي `paymentType`، استخدم أول Main تعليمي للطالب كـfallback موثّق، ولا تطبّق هذا الـfallback لو يوجد `paymentType` صريح مختلف.
- لا تدخل Retention أو Renewal أو Books أو Other Payments في قيمة العرض أو الإيراد.

## احتساب المدفوع من الإيصالات الأصلية

- أنشئ مفتاح Main ثابتًا بالشكل: `studentId + ":" + (detail.main || mainRecord.id)`.
- بعد تحديد New Comers Mains، اجلب كل إيصالات `payment` الأصلية غير الملغاة التي تحمل نفس مفتاح الـMain، بما فيها دفعات التقسيط اللاحقة.
- قيمة كل إيصال:

```ts
Math.max(
  0,
  detail.netPaid !== undefined
    ? Number(detail.netPaid || 0)
    : Number(detail.paid || 0) - Number(detail.refunded || 0)
)
```

- `Original Receipts Paid` هو مجموع قيم هذه الإيصالات فقط.
- لا تستخدم `total` أو `due` كبديل للمدفوع.
- لا تجمع الـMain مرتين إذا كانت له دفعات متعددة.
- احتفظ بعدد الإيصالات، عدد الـMains، قيمة العروض، المدفوع، المتبقي، وCollection Rate.

## Attribution: تحديد أصل كل Payment

انسب كل Student/Main وجميع إيصالاته إلى أصل واحد فقط: `Lead` أو `Call` أو `Unattributed`.

رتّب المطابقة كالتالي:

1. الربط الصريح الموجود في بيانات الطالب أو العملية: `linkedLeadIds` / `linkedCallIds` / `leadId` / `callId`.
2. الربط بالطالب المسجل على الـLead أو الـCall.
3. مطابقة رقم الهاتف بعد normalization للموبايل الأساسي والثانوي.
4. اختر أقرب أصل صالح زمنيًا قبل تاريخ أول New Comers Main.
5. عند وجود Lead وCall لنفس رحلة العميل، لا تنسب الإيراد للقناتين. فضّل الربط الصريح؛ وإن لم يوجد، استخدم أقرب حدث زمني. لا تجعل Lead يسبق Call تلقائيًا إذا كان الـCall هو الأقرب.
6. إذا لم توجد مطابقة موثوقة، صنّفها `Unattributed` بدل إسقاطها من الإجمالي.

سجّل لكل Attribution:

- `originType`: Lead / Call / Unattributed
- `originId`
- `matchMethod`: Explicit Link / Student Link / Phone Match / No Match
- `confidence`: High / Medium / Low
- تاريخ الـorigin وتاريخ أول New Comers Main

يجب أن يساوي:

`Leads Paid + Calls Paid + Unattributed Paid = Original Receipts Paid`

## الفلاتر

أضف شريط فلاتر واضحًا يشمل:

- Data From / Data To: تاريخ دخول الـLead أو الـInbound Call.
- Payment From / Payment To: تاريخ الإيصال الأصلي.
- Branch
- Track
- Source
- Campaign
- Employee
- Attribution status
- زر Reset All.

طبّق الفلاتر بصورة متسقة على الـKPIs والتشارتات والجداول، ووضّح الفرق بين Data Period وPayment Period.

## محتوى الصفحة

### 1. Header

- العنوان.
- ملاحظة واضحة: `New Comers offers only`.
- وصف صغير: قيمة العرض من الـMain فقط، والمدفوع من الإيصالات الأصلية المرتبطة به.

### 2. KPIs

- Total Leads
- Inbound Calls
- Registrations
- New Comers Mains
- New Comers Offer Value
- Original Receipts Paid
- Outstanding = Offer Value - Paid، بحد أدنى صفر
- Collection Rate = Paid / Offer Value
- Attribution Coverage = (Lead Paid + Call Paid) / Original Receipts Paid
- Unattributed Paid

### 3. Channel cards

كارت أزرق للـLeads وكارت Amber للـCalls. كل كارت يعرض:

- Data Count
- Registered Students
- Conversion %
- Paid Amount
- Share of Attributed Paid %
- Revenue per Data
- عدد الإيصالات

### 4. Monthly bar charts

أنشئ تشارتين منفصلين، وليس تشارتًا واحدًا:

- `Leads Paid by Month`
- `Calls Paid by Month`

المحور الأفقي: الشهور مرتبة تصاعديًا.

المحور الرأسي: المبلغ المدفوع EGP من الإيصالات الأصلية.

فوق كل عمود اعرض:

- المبلغ.
- نسبة القناة من إجمالي المدفوع المنسوب في نفس الشهر.

Tooltip كل شهر يعرض: Paid Amount، Receipts Count، Registrations، Offer Value، Collection Rate، Channel Share. يجب أن تبدأ الأعمدة من صفر، وتتعامل مع الشهور الفارغة بدون كسر الرسم.

### 5. Breakdown tables

اعرض جداول قابلة للترتيب حسب:

- Month
- Location
- Source
- Campaign
- Track
- Branch
- Employee

الأعمدة:

`Leads | Calls | Total Data | Registered | Conversion % | Offer Value | Paid | Collection Rate | Paid Share | Revenue/Data`

### 6. Original Receipts Attribution Audit

جدول تفصيلي قابل للبحث والتصدير CSV يحتوي:

`Receipt # | Student | Main # | New Comers Offer | Payment Date | Paid Amount | Origin | Origin ID | Match Method | Confidence | Branch | Track`

أضف فلترًا سريعًا للإيصالات `Unattributed` وصفوف تحذير للحالات منخفضة الثقة.

## قواعد الدقة

- استخدم unique students في Registration، وليس عدد الإيصالات.
- Conversion للـLead = الطلاب المنسوبون للـLead ÷ عدد الـLeads في Data Period.
- Conversion للـCall = الطلاب المنسوبون للـCall ÷ عدد الـInbound Calls الصالحة في Data Period.
- استبعد المكالمات `registeredBefore` و`oldLead` و`calledBefore`.
- طبّق phone normalization المصرية الحالية، مع دعم `0020` و`20` وصفر البداية.
- لا تسقط Unattributed من إجمالي المدفوع أو من reconciliation.
- اعرض Empty State وLoading State ورسالة خطأ مفهومة.
- أصلح أي نص عربي ظاهر بترميز mojibake داخل الصفحة.

## متطلبات التنفيذ والتحقق

- أعد استخدام الأنواع والمساعدات الموجودة في `app/crm-shell.tsx`، وافصل منطق التحليل إلى pure helper functions قابلة للاختبار إذا كبر الكود.
- أضف CSS بأسماء معزولة تحت `.leads-calls-report-page` داخل `app/globals.css`.
- لا تضف مكتبة Charts جديدة إذا أمكن تنفيذ الرسم الحالي بـCSS/SVG بسيط؛ وإن كانت مكتبة موجودة بالفعل فأعد استخدامها.
- حافظ على صلاحية صفحة `leadsCallsReport` الحالية وتحميل بيانات payments/leads/calls/students من API.
- اختبر reconciliation، وعدم تكرار الـMain، وفلترة New Comers، والإيصالات المتعددة، والريفند، وحالة Unattributed، والشهور بلا بيانات.
- شغّل lint/tests/build المتاحة وأصلح الأخطاء الناتجة عن التغيير فقط.

استخدم الموكاب المرفق كمرجع بصري، لكن التزم بمنطق البيانات أعلاه حتى لو اختلفت أرقام الموكاب.
