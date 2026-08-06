# Domain Glossary

`/CONTEXT.md` is the concise canonical vocabulary for agents. This register adds Arabic language and modeling notes for product and stakeholder review.

| Term | English definition | العربية | Modeling note |
|---|---|---|---|
| Breev | Confirmed company and public product brand. | بريف — اسم الشركة والمنتج | Phase 1 uses `breev`/`@breev/*` for new technical identifiers; governing sources retain historical names. |
| Tenant | One subscribing pharmacy organization and cloud isolation/billing boundary. | المستأجر / مؤسسة الصيدلية المشتركة | Initially maps to one pharmacy location; not a branch synonym. |
| Pharmacy | The operating business using the platform. | الصيدلية | Multi-branch is future scope. |
| Main Pharmacy Computer | Windows host for local API and local PostgreSQL. | الحاسبة الرئيسية للصيدلية | Local source of truth while offline. |
| Additional POS Terminal | Paid LAN client of the main computer. | نقطة بيع إضافية | No independent authoritative DB. |
| Local API | Pharmacy-side application service owning transactions. | واجهة الخادم المحلي | Only this boundary accesses local PostgreSQL. |
| Cloud Data Location Matrix | Versioned map of each cloud database, file, backup, log, queue, support path, and subprocessor to its provider, region/country, and approved transfer boundary. | مصفوفة مواقع بيانات السحابة | A provider name alone is insufficient evidence of residency. |
| Restore Quarantine | Restored local or cloud state kept unavailable for ordinary use until Deletion Ledger, legal holds, revocations, and later security changes are replayed and verified. | عزل النسخة المستعادة | Backup completion is not proof that a safe recovery can be released. |
| Certified Hardware Profile | Exact Windows release/architecture and peripheral model, driver, firmware, and connection combination verified for Breev production support. | ملف الأجهزة المعتمدة | Devices outside the current versioned profile are best-effort, not certified. |
| Update Package | Signed, versioned application/service bundle carrying compatibility, integrity, release-channel, and migration metadata. | حزمة تحديث |
| Maintenance Window | Owner-approved period in which new work is drained and a signed update, repair, or migration may safely run. | نافذة صيانة |
| Binary Rollback | Return to a prior application/service version only when its database schema compatibility is proven; it is not a database downgrade. | تراجع ثنائي للنسخة | Never means blind reverse migration of posted data. |
| Main Unit | Largest normal packaging unit, such as a box. | الوحدة الرئيسية، مثل العلبة | Conversion ratio must be explicit. |
| Sub-unit | Secondary sell/count unit, such as a strip. | الوحدة الفرعية، مثل الشريط | Do not assume all products have one. |
| Tertiary Clinical Unit | Optional smallest clinical unit, such as a tablet. | الوحدة السريرية الثالثة، مثل الحبة | A real unit, not a reminder-days field. |
| Generated Product Name | Current English display composed from structured fields under a versioned template. | اسم المنتج الإنجليزي المُولّد | Not identity; current regeneration never changes historical snapshots. |
| Arabic Search Name | Independent Arabic name shown below English and fuzzy-searchable. | اسم البحث العربي | Never appended to the generated English display. |
| Naming Template Version | Version of ordered pharmaceutical/general naming fields. | إصدار قالب التسمية | Allows future order changes without historical rewrite. |
| Inventory Unit | Smallest precisely counted unit in the stock ledger. | وحدة قياس المخزون | Pending ADR-007 approval. |
| Batch | Product quantity sharing lot/acquisition and expiry facts. | وجبة / دفعة | Expiry belongs to batch/stock, not only product. |
| Near-Expiry Batch | Sellable batch inside the configured warning window. | دفعة قريبة الانتهاء | Warn and allocate using FEFO. |
| Quarantined Stock | Stock blocked pending investigation/final decision. | مخزون محجور | No automatic financial loss until final disposition. |
| Recalled Stock | Recalled medicine blocked immediately. | مخزون مسحوب / مسترجع من السوق | Loss equals only carrying cost not recovered from supplier. |
| Inventory Write-off | Dedicated removal of unusable stock with a separate loss expense. | شطب / إتلاف مخزون | Never implemented as a zero-price sale. |
| Carrying Cost | Ledger value under the selected valuation method at posting time. | القيمة الدفترية للمخزون | Physical batch is traced; WAC/current FIFO layer supplies cost; the posted snapshot never changes later. |
| FEFO | First-expired, first-out allocation. | الصرف من الأقرب انتهاءً أولاً | Allocation policy; distinct from valuation method. |
| WAC | Weighted-average inventory cost. | المتوسط المرجح للتكلفة | Approved pharmacy-level default; exact ledger carrying cost is determined at posting. |
| FIFO | First-in, first-out cost valuation. | الوارد أولاً يُحتسب أولاً | Optional initial pharmacy-level method after accountant review. |
| Last Purchase Cost | Most recent eligible purchase cost shown for pricing/reference. | تكلفة آخر شراء | Never the accounting valuation method. |
| IQD Money | Exact signed integer fils, with 1 IQD = 1,000 fils. | المبلغ بالدينار العراقي مخزن بدقة الفلس | Normal UI may show whole dinars; cash/document rounding is separate. |
| Cash Box | Continuous cash ledger/container without forced shifts. | صندوق نقدي مستمر | Optional reconciliation does not close it. |
| Reconciliation Snapshot | Point-in-time counted-versus-ledger comparison. | لقطة مطابقة الصندوق | Auditable, optionally scheduled. |
| Merchant Account | Pharmacy-owned account/contract with a licensed payment provider whose funds settle to the pharmacy. | حساب التاجر الخاص بالصيدلية | Breev is a technical adapter and never takes custody of customer funds. |
| Payment Attempt | One idempotent request to collect an exact amount through an external provider. | محاولة دفع إلكتروني | Has an independent status/reference; it is not an invoice or settlement proof. |
| Unknown Payment Outcome | State where timeout/interruption leaves success or failure unproven. | نتيجة دفع غير معروفة | Query/reconcile the original reference; never retry or mark paid blindly. |
| Payment Settlement | Provider-confirmed gross payment, fee, net deposit, date/reference, and discrepancy record. | تسوية الدفع الإلكتروني | Authorization/capture and bank settlement are separate facts. |
| Provider Refund | Provider-side return of money linked to, but distinct from, a pharmacy Return/Reversal. | استرداد مالي عبر مزود الدفع | Original invoice/payment remain immutable. |
| Chargeback | Provider/bank dispute reversal recorded as a new financial event. | استرجاع قسري / اعتراض على الدفع | Never implemented by deleting the sale. |
| Official Electronic Tax Invoice | Invoice recognized under an approved jurisdictional government submission regime. | فاتورة ضريبية إلكترونية رسمية | A local Breev receipt/PDF is not automatically official e-invoicing. |
| Tax Submission Snapshot | Immutable payload/authority/credential/request/response/status evidence for one posted invoice version. | لقطة إرسال الفاتورة الضريبية | Rejection and correction append states/documents; they never rewrite the posted invoice. |
| Draft Invoice | Editable transaction without final posting effects. | فاتورة مسودة | OCR creates this state only. |
| Draft Price Snapshot | Draft-line selling price, version, source, and capture time preserved against silent repricing. | لقطة سعر المسودة | Commercial quote only; stock safety and accounting cost revalidate at posting. |
| Draft Price Override | Authorized choice to keep a stale draft selling price after comparison with the current price. | تجاوز سعر المسودة | Requires named permission, reason, newest-version validation, and complete audit. |
| Posted Invoice | Preserved historical transaction. | فاتورة مرحلة / مثبتة | Cannot be hard-deleted or destructively overwritten. |
| Invoice Snapshot | Transaction-time facts copied onto invoice/lines. | لقطة بيانات الفاتورة وقت العملية | Protects history from master-data edits. |
| Amendment | Linked auditable correction to a posted transaction. | تعديل موثق | Detailed legal/numbering model remains open. |
| Reversal | Accounting-safe cancellation that creates a linked offset for a wrongly posted invoice. | إلغاء محاسبي عن طريق مستند عكسي | Original remains visible; stock, payment/debt, and journal effects are offset. |
| Return | Linked partial/full goods-return document with its own financial and stock effects. | مرتجع بيع أو شراء | Has its own number and printable slip; distinct from correcting an entry mistake. |
| Stock Movement | Authoritative inventory quantity change with reason and actor. | حركة مخزنية | Direct quantity edits are prohibited. |
| Anonymous Sale | Core sale with no Patient Profile attached because identity is not required. | بيع دون تعريف المريض | Default for ordinary sales; the transaction remains fully posted and auditable. |
| Patient Profile | Optional longitudinal identity/contact/CRM and approved health context, separate from immutable transaction snapshots. | ملف المريض الاختياري | Requires an approved purpose/basis; a posted invoice does not automatically create it. |
| Required Transaction Identity | Minimum party/debtor/dispensing identity retained with a posted record under a documented necessary basis. | هوية مطلوبة للمعاملة | Structurally separate from optional CRM and health facts. |
| Optional Profile Link | Removable association between a Patient Profile and a posted transaction. | رابط اختياري بملف المريض | May be detached/anonymized when eligible without changing posted financial/stock/accounting facts. |
| Necessary Processing Basis | Documented legal, professional, contractual, credit, or business reason that genuinely requires minimum patient data. | أساس معالجة ضروري | Do not mislabel non-optional necessary processing as consent. |
| Consent Purpose | One specific optional use of patient data or one communication category/channel. | غرض موافقة محدد | Permission for one purpose never authorizes another. |
| Consent Event | Immutable grant, denial, or withdrawal evidence for one Patient, purpose, policy version, and destination/provider context. | حدث موافقة المريض | Current consent is derived from history; events are never overwritten. |
| Verified Destination | Patient-associated phone/channel endpoint whose control was verified for the approved consent scope. | وجهة اتصال موثقة | Shared or changed numbers never inherit another patient's consent. |
| Authorized Representative | Verified guardian/proxy or other legally accepted person acting within a recorded scope for a Patient. | ممثل مخول للمريض | Age, capacity, authority, and scope require Iraqi validation. |
| Provider/Jurisdiction Gate | Current rule deciding whether a provider, geography, message category, or data-processing use is permitted beyond patient consent. | بوابة سياسة المزود والاختصاص | Consent alone cannot override provider policy, Iraqi law, or professional rules. |
| Pharmacy WhatsApp Identity | Pharmacy-owned WhatsApp Business account, verified identity, and dedicated number. | هوية واتساب الخاصة بالصيدلية | Never shared across tenants or retained by Breev as leverage; provider migration may remain subject to platform rules. |
| WhatsApp Template Version | Immutable pharmacy-approved Arabic/English message content bound to purpose, platform category, consent scope, policy version, and approval state. | إصدار قالب واتساب | A Meta-approved template can still be blocked by consent, geography, health, or Iraqi rules. |
| Messaging Usage Charge | Meta/provider delivery cost attributable to one pharmacy, recipient market, message category, and allowance/overage rule. | تكلفة استخدام الرسائل | Must be visible and itemized; no silent charge or cross-tenant cost pooling. |
| Retention Policy Version | Approved record-class rule defining its starting event, provisional/legal period, holds, and end action. | إصدار سياسة الاحتفاظ | Configurable values are not represented as Iraqi law until validated. |
| Irreversible Anonymization | Transformation after which no reasonably available retained key, map, identifier, or attribute combination can reconnect data to a Patient. | إخفاء هوية غير قابل للعكس | Distinct from pseudonymization. |
| Pseudonymization | Replacement of direct identity while a retained mapping or reasonably available linkage still permits reconnection. | استخدام هوية مستعارة قابلة للربط | Must never be labelled anonymous or deleted. |
| Legal Hold | Scoped, reviewed suspension of disposal for named records due to a documented legal, dispute, or investigation need. | أمر حفظ قانوني محدد النطاق | Has an authorizer, reason, review, and release condition. |
| Deletion Outcome | Per-record-class result of an authorized request: Deleted, Irreversibly anonymized, a named retention reason, provider pending/failed, Not found, or identity/authority rejection. | نتيجة طلب الحذف | One request may produce different outcomes for different classes. |
| Deletion Ledger | Protected minimum tombstone evidence used to prevent deleted/anonymized data or permissions from reappearing after restore/sync. | سجل الحذف الوقائي | Not a shadow copy of deleted Patient data. |
| Support Access Grant | Ticket-bound, owner-authorized, named, least-privilege, time-limited authority for Breev Support. | تفويض وصول الدعم | Disabled by default and read-only by default. |
| Break-Glass Support Access | Exceptional short-lived support elevation with stronger authorization, owner notification, detailed audit, and mandatory review. | وصول دعم طارئ | Never a standing or shared account. |
| Entitlement | Subscription-plan capability grant. | استحقاق ميزة | Must be checked separately from permissions. |
| Signed Offline Licence | Signed tenant/device/plan/feature/expiry/grace/version grant. | رخصة أوفلاين موقعة رقمياً | Editable Windows time alone is never authoritative. |
| Grace Period | Seven inclusive days after paid expiry before free-core fallback. | فترة سماح سبعة أيام شاملة | Owner/admin warnings; ordinary cashiers are not repeatedly interrupted. |
| Free Core POS | Main-computer core sales and permanent access to pharmacy-owned data after expiry. | نقطة البيع الأساسية المجانية | History, report, print, backup, export, and renewal remain available. |
| Trusted Breev Time | Last-known signed/server/monotonic time state used for rollback detection across licences, certificates, devices, and trust windows. | وقت بريف الموثوق | Restart, time-zone/clock change, or offline duration cannot extend time-bounded authority. |
| Permission | User/role authority for an action. | صلاحية المستخدم | A paid feature may still be forbidden to a user. |
| Step-Up Authorization | Immediate re-authentication by the signed-in user before a named sensitive action; it does not grant a missing permission or entitlement. | تفويض بخطوة تحقق إضافية | Revalidated at the execution boundary. |
| Dual Control | One authorized user prepares a sensitive request and a different authorized user approves it. | تحكم مزدوج | Self-approval and shared accounts are prohibited. |
| Local External Link | Permissioned read-only local association between approved pharmacy records, such as a Patient Profile and invoice. | رابط خارجي محلي | It does not export or mutate either record. |
| Outbound Integration Contract | Versioned paid contract defining an external connector's purpose, recipient, region, retention, minimum fields, consent/basis, entitlement, and security rules. | عقد تكامل صادر | Generic arbitrary-field webhooks are prohibited. |
| POS Performance Target | Measured percentile response target for a local pharmacy interaction on a certified hardware profile and realistic dataset. | هدف أداء نقطة البيع | Never achieved by skipping domain validation or atomicity. |
| Accessible Core Flow | Core pharmacy workflow operable by keyboard and assistive technology with correct Arabic/RTL and English/LTR semantics, focus, status, and readable output. | مسار أساسي ميسّر | Validated across locale and theme combinations. |
| Pairing Session | One-use, short-lived, pharmacy/main-bound authorization ceremony for admitting one proposed terminal. | جلسة إقران جهاز | LAN presence or possession of a reusable code is never device trust. |
| Paired Terminal | Named additional POS device whose locally generated public key was owner-confirmed and certified for one pharmacy. | جهاز نقطة بيع مقترن | Device trust never replaces the signed-in user's permissions. |
| Terminal Seat | Licensed capacity allocated to one paired additional terminal. | مقعد جهاز إضافي مرخص | Replacement follows explicit revoke/release/reallocate policy. |
| Device Revocation | Local-authoritative removal of a terminal identity's authority to call the Local API. | إبطال صلاحية الجهاز | Works offline and cannot be silently undone by older cloud state. |
| Installation Identity | Opaque stable identity of one initialized Main Pharmacy Computer service. | هوية تثبيت الجهاز الرئيسي | Established during pairing; never synonymous with IP address, Windows name, or discovery result. |
| Pharmacy Local CA | Pharmacy-scoped trust anchor created at secure first initialization to certify the main service and paired terminals. | سلطة شهادات الصيدلية المحلية | Repair preserves it; replacement/reinitialization creates a new one and requires re-pairing. |
| Device Certificate | Certificate binding a terminal's locally held key to its pharmacy, device identity/type, licence, and serial. | شهادة الجهاز | Valid device identity is necessary but never sufficient without user authorization. |
| One-Way Sync | Local-to-cloud replication with cloud view only. | مزامنة أحادية الاتجاه | Basic paid cloud tier. |
| Two-Way Sync | Approved cloud changes can return locally under field ownership, conflict, draft-price, permission, and audit rules. | مزامنة ثنائية الاتجاه | Reserved for a future higher tier; Basic remains one-way/view-only. |
| Local-Authoritative Record | Posted operational/financial record immutable from cloud. | سجل محلي مرجعي | Cloud can view/report/back up; correction occurs via a new local business transaction. |
| Cloud Command | Audited cloud request validated and acknowledged by local API. | أمر قادم من السحابة | Unique ID, expiry, idempotency, expected version, and explicit status. |
| Field Ownership Matrix | Versioned entity-field cloud-edit allow-list. | مصفوفة ملكية الحقول | Never infer editability from the screen or whole record. |
| Expected Record Version | Optimistic version required by a cloud command. | إصدار السجل المتوقع | Mismatch becomes Rejected/Conflict, never silent overwrite. |
| Cloud Command Status | Pending, Applied, Rejected, Conflict, Expired, or Cancelled. | حالة أمر السحابة | Applied only after local acknowledgement. |
| Sync Conflict | Expected-version mismatch preserving Base, Current Local, and Requested Cloud values until an authorized local resolution is validated. | تعارض المزامنة | Never resolved by timestamp, forced overwrite, or automatic merging of one atomic field. |
| Mergeable Field | Independent field explicitly permitted for human conflict merging by the versioned Field Ownership Matrix. | حقل قابل للدمج | Two competing values for the same atomic field are not mergeable. |
| OCR Draft | Machine-extracted purchase document requiring human review/post. | مسودة مستخرجة ضوئياً | Never posts automatically. |
| OCR Benchmark Corpus | Representative controlled Arabic, English, and mixed Iraqi supplier invoices used to qualify each provider/model version. | مجموعة اختبار الفواتير للمسح الضوئي | Includes major layouts, scans, and phone photos; production samples require authorization and minimization. |
| OCR Provenance Snapshot | Immutable link between source hash, provider/model/region, extracted locations/confidences, corrections, reviewer, cost, and final state. | لقطة مصدر ونتيجة المسح الضوئي | Later provider/model changes never rewrite prior evidence. |
| OCR Page Allowance | Tenant's explicit external-OCR entitlement counted in processed pages. | حصة صفحات المسح الضوئي | Warn at 80%, stop at 100%; no automatic overage or manual-purchase block. |
| Supplier Invoice Evidence | Encrypted local supplier document retained with a posted purchase. | مستند إثبات فاتورة المورّد | Commercial evidence under ADR-017; distinct from provider data deleted promptly/max 30 days. |
| Regulatory Medicine Source | Iraqi authority source for registration, recalls, restrictions, and regulatory sale controls. | مصدر تنظيمي عراقي للأدوية | Not a clinical interaction database; Essential Drugs List inclusion is not proof of registration or interaction safety. |
| Licensed Clinical Knowledge Source | Commercial, versioned medicine-safety content licensed for Breev's approved geography, pharmacy use, offline bundle, language, display, and audit needs. | مصدر معرفة سريرية مرخّص | No vendor is selected in Phase 0; public/research access is insufficient for production use. |
| Clinical Product Mapping | Pharmacist-reviewed versioned link from an Iraqi product to normalized active ingredients in the licensed source. | ربط المنتج المحلي بالمادة الفعالة | Uncertain or missing mapping produces Not Evaluated. |
| Deterministic Clinical Alert | Traceable advisory drug–drug, drug–allergy, or validated duplicate-therapy result. | تنبيه سريري حتمي قابل للتتبع | No diagnosis, prescribing, dosing, pregnancy, organ-adjustment, contraindication, or disease-interaction advice without separate approval. |
| Not Evaluated | Explicit result when reliable clinical evaluation cannot be completed. | لم يتم التقييم | Never display it as Safe or as absence of risk. |
| Regulatory Hard Block | Non-overridable prohibition caused by recall, expiry, quarantine, or another validated regulatory rule. | حظر تنظيمي قطعي | Distinct from an advisory pharmacist-overridable clinical alert. |
| Clinical Evaluation Snapshot | Immutable record of inputs, content/mapping/rule versions, result, displayed guidance, actor acknowledgement, and decision. | لقطة تقييم سريري ثابتة | Retained under the applicable ADR-017 policy. |
| Clinical Data Bundle | Signed, validated offline package of licensed clinical content and rules. | حزمة بيانات سريرية أوفلاين | Activated in stages with freshness state and last-known-good rollback. |
| Clinical Kill Switch | Audited safety control that disables clinical evaluation while preserving Core POS and Regulatory Hard Blocks. | مفتاح إيقاف السلامة السريرية | Used for compromised, invalid, or unsafe clinical content. |
| Pharmacy Sales Invoice | Transaction issued by the pharmacy to a patient/customer. | فاتورة بيع الصيدلية | Never confuse with subscription billing. |
| Subscription Invoice | SaaS billing document issued to the pharmacy tenant. | فاتورة اشتراك البرنامج | Cloud/commercial domain, separate numbering. |
