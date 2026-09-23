import { Injectable } from '@nestjs/common';

export interface RenderedNotification {
  title: string;
  body: string;
  locale: string;
  fallback: boolean;
}

type LocalizedTemplate = { title: string; body: string };

const ARABIC_TEMPLATES: Record<string, LocalizedTemplate> = {
  booking_requested: {
    title: 'طلب حجز جديد',
    body: 'لديك طلب حجز جديد. افتح الحجز للاطلاع على التفاصيل.',
  },
  booking_rescheduled: {
    title: 'تم تغيير موعد الحجز',
    body: 'تم تحديث موعد الحجز. افتح الحجز للاطلاع على الموعد الجديد.',
  },
  booking_cancelled_by_customer: { title: 'ألغى العميل الحجز', body: 'ألغى العميل هذا الحجز.' },
  booking_cancelled_by_admin: {
    title: 'تم إلغاء الحجز',
    body: 'ألغى فريق Latache هذا الحجز. افتح الحجز للاطلاع على التفاصيل.',
  },
  task_cancelled_by_tasker: { title: 'ألغى المنفذ المهمة', body: 'ألغى المنفذ هذه المهمة.' },
  task_confirmed: { title: 'تم تأكيد المهمة', body: 'تم تأكيد المهمة بنجاح.' },
  tasker_en_route: { title: 'المنفذ في الطريق', body: 'المنفذ في طريقه إلى موقع المهمة.' },
  tasker_arrived: { title: 'وصل المنفذ', body: 'وصل المنفذ إلى موقع المهمة.' },
  task_started: { title: 'بدأت المهمة', body: 'بدأ العمل على المهمة.' },
  task_completed: { title: 'اكتملت المهمة', body: 'تم تسجيل المهمة كمكتملة.' },
  task_completed_by_customer: { title: 'اكتملت المهمة', body: 'أكد العميل اكتمال المهمة.' },
  task_completion_submitted: {
    title: 'يرجى مراجعة المهمة المكتملة',
    body: 'أرسل المنفذ طلب إكمال المهمة. وافق عليه أو افتح نزاعاً قبل انتهاء المهلة.',
  },
  task_completion_auto_approved: {
    title: 'تم اعتماد إكمال المهمة',
    body: 'انتهت مهلة المراجعة دون نزاع، لذلك تم اعتماد إكمال المهمة.',
  },
  task_time_extended: { title: 'تم تمديد وقت المهمة', body: 'تم تحديث مدة المهمة.' },
  duration_approval_required: {
    title: 'يلزم اعتماد المدة',
    body: 'يرجى مراجعة مدة المهمة واعتمادها.',
  },
  booking_message: { title: 'رسالة جديدة', body: 'لديك رسالة جديدة بخصوص الحجز.' },
  booking_payment_succeeded: { title: 'تم الدفع', body: 'تمت تسوية دفعة الحجز بنجاح.' },
  booking_wallet_payment_succeeded: {
    title: 'تم الدفع من المحفظة',
    body: 'تم دفع الحجز بنجاح من محفظتك.',
  },
  booking_payment_failed: {
    title: 'تعذر الدفع',
    body: 'تعذرت معالجة دفعة الحجز. راجع وسيلة الدفع وحاول مجدداً.',
  },
  wallet_topup_succeeded: { title: 'تم شحن المحفظة', body: 'تمت إضافة المبلغ إلى محفظتك بنجاح.' },
  wallet_topup_failed: { title: 'تعذر شحن المحفظة', body: 'تعذرت عملية شحن المحفظة.' },
  booking_earning_pending: {
    title: 'الأرباح قيد التسوية',
    body: 'تمت تسوية دفعة الحجز وأصبحت أرباحك قيد فترة الاستحقاق.',
  },
  booking_earning_released: {
    title: 'الأرباح متاحة',
    body: 'تم تحرير أرباح الحجز إلى رصيدك المتاح.',
  },
  booking_earning_blocked: {
    title: 'تم تعليق الأرباح',
    body: 'تم تعليق أرباح الحجز. افتح سجل الأرباح للاطلاع على السبب.',
  },
  booking_earning_reversed: {
    title: 'تم عكس الأرباح',
    body: 'تم عكس أرباح الحجز كلياً أو جزئياً.',
  },
  booking_refund_adjustment: {
    title: 'تعديل بسبب استرداد',
    body: 'تم تسجيل تعديل مالي متعلق باسترداد الحجز.',
  },
  cash_platform_payable_created: {
    title: 'تم تسجيل عمولة نقدية مستحقة',
    body: 'تم تسجيل المبلغ النقدي المحصل والعمولة المستحقة للمنصة.',
  },
  cash_platform_payable_settled: {
    title: 'تمت تسوية العمولة المستحقة',
    body: 'تمت تسوية جزء من العمولة المستحقة للمنصة من أرباحك الإلكترونية.',
  },
  withdrawal_requested: {
    title: 'تم إرسال طلب السحب',
    body: 'تم استلام طلب السحب وهو قيد المراجعة.',
  },
  withdrawal_approved: { title: 'تم اعتماد السحب', body: 'تم اعتماد طلب السحب.' },
  withdrawal_paid: { title: 'تم دفع السحب', body: 'تم تسجيل دفعة السحب كمكتملة.' },
  withdrawal_cancelled: { title: 'تم إلغاء السحب', body: 'تم إلغاء طلب السحب.' },
  review_received: { title: 'تقييم جديد', body: 'تلقيت تقييماً جديداً.' },
  booking_dispute_opened: { title: 'تم فتح نزاع', body: 'تم فتح نزاع على الحجز.' },
  booking_dispute_resolved: { title: 'تم حل النزاع', body: 'تم تسجيل قرار النزاع.' },
  dispute_evidence_requested: {
    title: 'مطلوب دليل',
    body: 'طلب فريق Latache دليلاً إضافياً للنزاع.',
  },
  dispute_evidence_received: { title: 'تم استلام الدليل', body: 'تمت إضافة دليل جديد إلى النزاع.' },
  dispute_evidence_reviewed: { title: 'تمت مراجعة الدليل', body: 'راجع فريق Latache الأدلة الحالية في النزاع.' },
  dispute_escalated: { title: 'تم تصعيد النزاع', body: 'تم تصعيد النزاع للمراجعة.' },
  dispute_refund_failed: {
    title: 'تعذر استرداد مبلغ النزاع',
    body: 'تعذرت معالجة استرداد مبلغ النزاع. يلزم تدخل فريق المالية.',
  },
  support_agent_reply: {
    title: 'رد جديد من الدعم',
    body: 'أضاف فريق الدعم رداً جديداً إلى تذكرتك.',
  },
  support_user_reply: {
    title: 'رد جديد على تذكرة الدعم',
    body: 'أضاف المستخدم رداً جديداً إلى تذكرة الدعم.',
  },
  support_ticket_assigned: { title: 'تم تعيين تذكرة دعم', body: 'تم تعيين تذكرة دعم لك.' },
  support_ticket_escalated: { title: 'تم تصعيد تذكرة الدعم', body: 'تم تصعيد تذكرة الدعم.' },
  support_ticket_resolved: { title: 'تم حل تذكرة الدعم', body: 'تم تسجيل تذكرة الدعم كمحلولة.' },
  support_queue_update: { title: 'تحديث في قائمة الدعم', body: 'تم تحديث قائمة تذاكر الدعم.' },
  elite_request_submitted: { title: 'تم إرسال طلب Elite', body: 'تم استلام طلبك في برنامج Elite.' },
  elite_tier_changed: { title: 'تم تحديث فئة Elite', body: 'تم تحديث عضويتك في برنامج Elite.' },
  elite_badge_awarded: { title: 'شارة Elite جديدة', body: 'حصلت على شارة جديدة في برنامج Elite.' },
  referral_claimed: {
    title: 'تم استخدام رمز الإحالة',
    body: 'استخدم مشارك جديد رمز إحالتك. تبقى المكافأة معلقة حتى تسوية حجز مؤهل.',
  },
  referral_qualified: {
    title: 'تأهلت الإحالة',
    body: 'تمت تسوية حجز مؤهل وبدأت فترة تصفية مكافأة الإحالة.',
  },
  referral_reward_available: {
    title: 'مكافأة الإحالة متاحة',
    body: 'تمت إضافة مكافأة الإحالة إلى محفظتك بعد انتهاء فترة التصفية.',
  },
  referral_revoked: {
    title: 'تم عكس مكافأة الإحالة',
    body: 'تم تسجيل عكس لمكافأة إحالة لم تعد مؤهلة.',
  },
  referral_expired: {
    title: 'انتهت صلاحية الإحالة',
    body: 'انتهت مهلة التأهل قبل تسوية حجز مؤهل.',
  },
  dispute_investigation_started: { title: 'بدأ التحقيق في النزاع', body: 'بدأ فريق Latache مراجعة النزاع.' },
  dispute_assignment_updated: { title: 'تم تحديث مسؤول النزاع', body: 'تم تحديث المسؤول عن مراجعة النزاع.' },
  dispute_priority_updated: { title: 'تم تحديث أولوية النزاع', body: 'تم تحديث أولوية معالجة النزاع.' },
  dispute_reopened: { title: 'أعيد فتح النزاع', body: 'أعيد فتح النزاع للمراجعة.' },
  dispute_withdrawn: { title: 'تم سحب النزاع', body: 'قام مقدم النزاع بسحبه.' },
  dispute_comment_added: { title: 'تعليق جديد على النزاع', body: 'تمت إضافة تعليق جديد إلى النزاع.' },
  dispute_settlement_proposed: { title: 'تم اقتراح تسوية', body: 'اقترح فريق Latache تسوية للنزاع.' },
  dispute_settlement_response: { title: 'تم الرد على التسوية', body: 'تم تسجيل رد أحد المشاركين على التسوية المقترحة.' },
  dispute_appealed: { title: 'تم استئناف النزاع', body: 'أعيد فتح النزاع بعد استئناف أحد المشاركين.' },
  dispute_evidence_reminder: { title: 'تذكير بموعد الدليل', body: 'اقترب موعد تقديم الدليل المطلوب.' },
  dispute_evidence_overdue: { title: 'تأخر الدليل المطلوب', body: 'انقضى موعد تقديم الدليل المطلوب.' },
  dispute_evidence_expired: { title: 'انتهت مهلة الدليل', body: 'انتهت مهلة الدليل وتم تصعيد النزاع.' },
  dispute_sla_breached: { title: 'تم تصعيد مراجعة النزاع', body: 'تجاوز النزاع مهلة المراجعة وتم تصعيده.' },
  dispute_cash_refund_pending: { title: 'استرداد نقدي يتطلب تحويلاً موثقاً', body: 'تم إنشاء التزام استرداد نقدي يدوي ولم يتم تسجيله كمدفوع بعد.' },
  dispute_cash_refund_confirmed: { title: 'تم تأكيد الاسترداد النقدي', body: 'تم تأكيد التحويل النقدي وتسجيله في سجل النزاع.' },
  stripe_chargeback_opened: { title: 'نزاع دفع من Stripe', body: 'أبلغ Stripe عن اعتراض على دفعة مرتبطة بالحجز.' },
  stripe_chargeback_updated: { title: 'تحديث اعتراض Stripe', body: 'تم تحديث حالة اعتراض Stripe المرتبط بالحجز.' },
  stripe_chargeback_closed: { title: 'أغلق اعتراض Stripe', body: 'أبلغ Stripe عن إغلاق اعتراض الدفع المرتبط بالحجز.' },
  booking_expired_no_response: {
    title: 'انتهت صلاحية طلب الحجز',
    body: 'لم يتم الرد على طلب الحجز خلال المهلة المحددة، فتم إلغاؤه تلقائياً.',
  },
  booking_reassigned: {
    title: 'تم إعادة إسناد الحجز',
    body: 'أعاد فريق Latache إسناد هذا الحجز إلى منفذ آخر.',
  },
  front_door_proof_submitted: {
    title: 'تم إرسال إثبات الوصول',
    body: 'أرفق المنفذ صورة إثبات الوصول عند الباب. يمكنك الآن إنشاء رمز البدء.',
  },
  work_start_code_ready: {
    title: 'أنشأ العميل رمز بدء العمل',
    body: 'اطلب من العميل الرمز المكون من ستة أرقام لبدء مؤقت المهمة.',
  },
  work_completion_proof_submitted: {
    title: 'تم إرسال إثبات إتمام العمل',
    body: 'أرفق المنفذ صورة إتمام العمل. توقف المؤقت القابل للفوترة؛ أنشئ رمز الإكمال بعد التحقق من العمل.',
  },
  work_completion_code_ready: {
    title: 'أنشأ العميل رمز الإكمال',
    body: 'اطلب من العميل رمز الإكمال المكون من ستة أرقام لإنهاء المهمة.',
  },
  task_completion_verified: {
    title: 'تم التحقق من الإكمال',
    body: 'تم التحقق من رمز إكمال العميل. يمكن الآن بدء معالجة الدفع النهائي.',
  },
  duration_review_approved: {
    title: 'تمت الموافقة على تمديد المدة',
    body: 'وافق العميل على الوقت الإضافي وأعيدت محاولة الدفع النهائي.',
  },
  reschedule_proposal_created: {
    title: 'اقتراح جديد لتغيير الموعد',
    body: 'اقترح المنفذ نقل هذا الحجز إلى موعد جديد. راجع الاقتراح ورد عليه.',
  },
  reschedule_proposal_accepted: {
    title: 'تم قبول اقتراح تغيير الموعد',
    body: 'وافق العميل على الموعد الذي اقترحته. يرجى تأكيد الحجز.',
  },
  reschedule_proposal_rejected: {
    title: 'تم رفض اقتراح تغيير الموعد',
    body: 'رفض العميل اقتراحك لتغيير الموعد.',
  },
  booking_reminder_24h: {
    title: 'تذكير: حجزك غداً',
    body: 'لديك حجز مجدول غداً. تحقق من التفاصيل استعداداً له.',
  },
  booking_reminder_1h: {
    title: 'تذكير: حجزك خلال ساعة',
    body: 'يبدأ حجزك المجدول خلال حوالي ساعة.',
  },
  review_request: {
    title: 'شاركنا تقييمك',
    body: 'اكتملت المهمة. خذ لحظة لتقييم تجربتك.',
  },

  custom_time_request_created: { title: 'طلب موعد خاص جديد', body: 'طلب عميل موعداً خارج أوقات توفرك. اقبل الطلب أو ارفضه قبل انتهاء المهلة.' },
  custom_time_request_accepted: { title: 'تم قبول الموعد الخاص', body: 'قبل المنفذ الموعد المطلوب. أكمل الحجز قبل انتهاء المهلة لتثبيته.' },
  custom_time_request_rejected: { title: 'تم رفض الموعد الخاص', body: 'لا يستطيع المنفذ العمل في هذا الموعد. اختر موعداً متاحاً أو أرسل طلباً جديداً.' },
  custom_time_request_expired: { title: 'انتهت صلاحية طلب الموعد الخاص', body: 'انتهت مهلة طلب الموعد الخاص. يمكنك إرسال طلب جديد.' },
  tasker_plan_purchased: { title: 'تم استلام طلب الباقة', body: 'تم استلام دفعة الباقة وهي قيد المراجعة. تبدأ المزايا بعد الموافقة.' },
  tasker_plan_activated: { title: 'تم تفعيل الباقة', body: 'باقتك مفعلة الآن مع رسوم منصة مخفضة وأولوية في الظهور ومكافأة شهرية.' },
  tasker_plan_rejected: { title: 'لم تتم الموافقة على الباقة', body: 'لم تتم الموافقة على طلب الباقة وتم استرداد المبلغ.' },
  tasker_plan_renewal_failed: { title: 'فشل تجديد الباقة', body: 'تعذر تجديد باقتك. تبقى المزايا مفعلة لفترة سماح قصيرة بينما نعيد المحاولة.' },
  tasker_plan_expired: { title: 'انتهت الباقة', body: 'انتهت باقتك لتعذر تحصيل دفعة التجديد. تطبق الآن الرسوم والترتيب العاديان.' },
};

const DARIJA_TEMPLATES: Record<string, LocalizedTemplate> = {
  booking_requested: {
    title: 'طلب حجز جديد',
    body: 'عندك طلب حجز جديد. حل الحجز باش تشوف التفاصيل.',
  },
  booking_rescheduled: {
    title: 'تبدّل موعد الحجز',
    body: 'تبدّل موعد الحجز. حل الحجز باش تشوف الموعد الجديد.',
  },
  booking_cancelled_by_customer: { title: 'الزبون لغى الحجز', body: 'الزبون لغى هاد الحجز.' },
  booking_cancelled_by_admin: {
    title: 'تلغى الحجز',
    body: 'فريق Latache لغى هاد الحجز. حل الحجز باش تشوف التفاصيل.',
  },
  task_cancelled_by_tasker: { title: 'المهني لغى الخدمة', body: 'المهني لغى هاد الخدمة.' },
  task_confirmed: { title: 'تأكدات الخدمة', body: 'تأكدات الخدمة بنجاح.' },
  tasker_en_route: { title: 'المهني فالطريق', body: 'المهني جاي لمكان الخدمة.' },
  tasker_arrived: { title: 'وصل المهني', body: 'وصل المهني لمكان الخدمة.' },
  task_started: { title: 'بدات الخدمة', body: 'بدا العمل على الخدمة.' },
  task_completed: { title: 'تسالات الخدمة', body: 'تسجلات الخدمة باللي سالات.' },
  task_completed_by_customer: { title: 'تسالات الخدمة', body: 'الزبون أكد باللي الخدمة سالات.' },
  task_completion_submitted: {
    title: 'راجع الخدمة اللي سالات',
    body: 'المهني صيفط طلب إكمال الخدمة. وافق عليه ولا حل نزاع قبل ما تسالي المهلة.',
  },
  task_completion_auto_approved: {
    title: 'تقبل إكمال الخدمة',
    body: 'سالات مهلة المراجعة بلا نزاع، وبهذا تقبل إكمال الخدمة.',
  },
  task_time_extended: { title: 'تزادت مدة الخدمة', body: 'تبدلات مدة الخدمة.' },
  duration_approval_required: {
    title: 'خاصك توافق على المدة',
    body: 'راجع مدة الخدمة ووافق عليها.',
  },
  booking_message: { title: 'ميساج جديد', body: 'عندك ميساج جديد على الحجز.' },
  booking_payment_succeeded: { title: 'تخلص الحجز', body: 'تسوات خلصة الحجز بنجاح.' },
  booking_wallet_payment_succeeded: {
    title: 'تخلص من المحفظة',
    body: 'تخلص الحجز بنجاح من المحفظة ديالك.',
  },
  booking_payment_failed: {
    title: 'مادازتش الخلصة',
    body: 'مقدرناش نعالجو خلصة الحجز. راجع طريقة الأداء وعاود حاول.',
  },
  wallet_topup_succeeded: { title: 'تعمرات المحفظة', body: 'تزاد المبلغ للمحفظة ديالك بنجاح.' },
  wallet_topup_failed: { title: 'ماتعمراتش المحفظة', body: 'مقدرناش نعمرو المحفظة ديالك.' },
  booking_earning_pending: {
    title: 'الربح باقي كيتصفى',
    body: 'تسوات خلصة الحجز والربح ديالك دخل لمدة التصفية.',
  },
  booking_earning_released: {
    title: 'الربح ولا متوفر',
    body: 'تحرر ربح الحجز وتزاد للرصيد المتوفر ديالك.',
  },
  booking_earning_blocked: {
    title: 'توقف الربح',
    body: 'توقف ربح الحجز. حل سجل الأرباح باش تشوف السبب.',
  },
  booking_earning_reversed: {
    title: 'ترجع الربح',
    body: 'ترجع ربح الحجز كامل ولا غير شي جزء منو.',
  },
  booking_refund_adjustment: {
    title: 'تعديل ديال الترجيع',
    body: 'تسجل تعديل مالي متعلق بترجيع خلصة الحجز.',
  },
  cash_platform_payable_created: {
    title: 'تسجلات عمولة الكاش',
    body: 'تسجل مبلغ الكاش اللي تجمع والعمولة اللي خاصها تخلص للمنصة.',
  },
  cash_platform_payable_settled: {
    title: 'تسوات العمولة',
    body: 'تسوى جزء من العمولة اللي عليك من الأرباح الإلكترونية ديالك.',
  },
  withdrawal_requested: { title: 'تصيفط طلب السحب', body: 'توصلنا بطلب السحب وراه كيتراجع.' },
  withdrawal_approved: { title: 'تقبل السحب', body: 'تقبل طلب السحب ديالك.' },
  withdrawal_paid: { title: 'تخلص السحب', body: 'تسجلات خلصة السحب باللي كملات.' },
  withdrawal_cancelled: { title: 'تلغى السحب', body: 'تلغى طلب السحب ديالك.' },
  review_received: { title: 'تقييم جديد', body: 'جاك تقييم جديد.' },
  booking_dispute_opened: { title: 'تحل نزاع', body: 'تحل نزاع على الحجز.' },
  booking_dispute_resolved: { title: 'تحل النزاع', body: 'تسجل القرار ديال النزاع.' },
  dispute_evidence_requested: {
    title: 'خاص دليل',
    body: 'فريق Latache طلب دليل زايد على النزاع.',
  },
  dispute_evidence_received: { title: 'توصلنا بالدليل', body: 'تزاد دليل جديد للنزاع.' },
  dispute_evidence_reviewed: { title: 'تراجع الدليل', body: 'فريق Latache راجع الأدلة اللي كاينة فالنزاع.' },
  dispute_escalated: { title: 'تصعد النزاع', body: 'تصعد النزاع باش يتراجع أكثر.' },
  dispute_refund_failed: {
    title: 'مادازش ترجيع فلوس النزاع',
    body: 'مقدرناش نرجعو فلوس النزاع. خاص فريق المالية يتدخل.',
  },
  support_agent_reply: {
    title: 'رد جديد من الدعم',
    body: 'فريق الدعم زاد رد جديد فالتذكرة ديالك.',
  },
  support_user_reply: {
    title: 'رد جديد على تذكرة الدعم',
    body: 'المستخدم زاد رد جديد فتذكرة الدعم.',
  },
  support_ticket_assigned: { title: 'تعينات ليك تذكرة دعم', body: 'تعينات ليك تذكرة دعم.' },
  support_ticket_escalated: { title: 'تصعدات تذكرة الدعم', body: 'تصعدات تذكرة الدعم.' },
  support_ticket_resolved: { title: 'تحلات تذكرة الدعم', body: 'تسجلات تذكرة الدعم باللي تحلات.' },
  support_queue_update: { title: 'تحديث فطابور الدعم', body: 'تحدّث طابور تذاكر الدعم.' },
  elite_request_submitted: { title: 'تصيفط طلب Elite', body: 'توصلنا بالطلب ديالك فبرنامج Elite.' },
  elite_tier_changed: { title: 'تبدلات فئة Elite', body: 'تبدلات العضوية ديالك فبرنامج Elite.' },
  elite_badge_awarded: { title: 'شارة Elite جديدة', body: 'خديتي شارة جديدة فبرنامج Elite.' },
  referral_claimed: {
    title: 'تستعمل كود الإحالة',
    body: 'مشارك جديد استعمل كود الإحالة ديالك. المكافأة كتبقى كتسنى حتى تتسوى خدمة مؤهلة.',
  },
  referral_qualified: {
    title: 'تأهلات الإحالة',
    body: 'تسوات خدمة مؤهلة وبدات مدة تصفية مكافأة الإحالة.',
  },
  referral_reward_available: {
    title: 'مكافأة الإحالة ولات متوفرة',
    body: 'تزادت مكافأة الإحالة للمحفظة ديالك من بعد ما سالات مدة التصفية.',
  },
  referral_revoked: {
    title: 'ترجعات مكافأة الإحالة',
    body: 'تسجل ترجيع مكافأة إحالة اللي ما بقاتش مؤهلة.',
  },
  referral_expired: {
    title: 'سالات صلاحية الإحالة',
    body: 'سالات مهلة التأهل قبل ما تتسوى خدمة مؤهلة.',
  },
  dispute_investigation_started: { title: 'بدا التحقيق فالنزاع', body: 'فريق Latache بدا كيراجع النزاع.' },
  dispute_assignment_updated: { title: 'تبدل المسؤول على النزاع', body: 'تبدل الأدمن اللي كيراجع النزاع.' },
  dispute_priority_updated: { title: 'تبدلات أولوية النزاع', body: 'تبدلات أولوية معالجة النزاع.' },
  dispute_reopened: { title: 'تحل النزاع من جديد', body: 'تحل النزاع من جديد باش يتراجع.' },
  dispute_withdrawn: { title: 'تسحب النزاع', body: 'صاحب النزاع سحبو.' },
  dispute_comment_added: { title: 'تعليق جديد فالنزاع', body: 'تزاد تعليق جديد فالنزاع.' },
  dispute_settlement_proposed: { title: 'تقترحات تسوية', body: 'فريق Latache اقترح تسوية للنزاع.' },
  dispute_settlement_response: { title: 'تسجل الرد على التسوية', body: 'تسجل رد واحد من المشاركين على التسوية المقترحة.' },
  dispute_appealed: { title: 'تدار استئناف للنزاع', body: 'تحل النزاع من جديد من بعد الاستئناف.' },
  dispute_evidence_reminder: { title: 'تذكير بموعد الدليل', body: 'قرب موعد الدليل اللي تطلب.' },
  dispute_evidence_overdue: { title: 'فات موعد الدليل', body: 'فات موعد تقديم الدليل المطلوب.' },
  dispute_evidence_expired: { title: 'سالات مهلة الدليل', body: 'سالات مهلة الدليل وتصعد النزاع.' },
  dispute_sla_breached: { title: 'تصعدات مراجعة النزاع', body: 'النزاع فات مهلة المراجعة وتصعد.' },
  dispute_cash_refund_pending: { title: 'ترجيع الكاش خاصو تحويل موثق', body: 'تسجل التزام ديال ترجيع كاش يدوي ومازال ماتسجلش كمدفوع.' },
  dispute_cash_refund_confirmed: { title: 'تأكد ترجيع الكاش', body: 'تأكد التحويل ديال الكاش وتزاد لسجل النزاع.' },
  stripe_chargeback_opened: { title: 'اعتراض Stripe على الخلصة', body: 'Stripe بلغ على اعتراض فخلصة مرتبطة بالحجز.' },
  stripe_chargeback_updated: { title: 'تحديث اعتراض Stripe', body: 'تبدلات حالة اعتراض Stripe المرتبط بالحجز.' },
  stripe_chargeback_closed: { title: 'تسد اعتراض Stripe', body: 'Stripe بلغ باللي تسد اعتراض الخلصة المرتبط بالحجز.' },
  booking_expired_no_response: {
    title: 'سالات صلاحية طلب الحجز',
    body: 'ماكانش رد على طلب الحجز فالمهلة المحددة، فتلغى بصفة أوتوماتيكية.',
  },
  booking_reassigned: {
    title: 'تبدل المهني ديال الحجز',
    body: 'فريق Latache عاود سند هاد الحجز لمهني آخر.',
  },
  front_door_proof_submitted: {
    title: 'تصيفط إثبات الوصول',
    body: 'المهني زاد تصويرة إثبات الوصول حدا الباب. دابا تقدر دير كود البداية.',
  },
  work_start_code_ready: {
    title: 'الزبون دار كود بداية الخدمة',
    body: 'طلب من الزبون الكود ديال الستة أرقام باش تبدا الخدمة.',
  },
  work_completion_proof_submitted: {
    title: 'تصيفط إثبات إكمال الخدمة',
    body: 'المهني زاد تصويرة إكمال الخدمة. توقف المؤقت ديال الخلصة؛ دير كود الإكمال من بعد ما تتأكد من الخدمة.',
  },
  work_completion_code_ready: {
    title: 'الزبون دار كود الإكمال',
    body: 'طلب من الزبون الكود ديال الستة أرقام باش تسالي الخدمة.',
  },
  task_completion_verified: {
    title: 'تأكد الإكمال',
    body: 'تأكد الكود ديال الزبون ديال الإكمال. دابا يقدر يبدا معالجة الخلصة النهائية.',
  },
  duration_review_approved: {
    title: 'تقبل تمديد المدة',
    body: 'الزبون وافق على الوقت الزايد وعاودات محاولة الخلصة النهائية.',
  },
  reschedule_proposal_created: {
    title: 'اقتراح جديد باش يتبدل الموعد',
    body: 'المهني اقترح ينقل هاد الحجز لموعد جديد. راجع الاقتراح ورد عليه.',
  },
  reschedule_proposal_accepted: {
    title: 'تقبل اقتراح تبديل الموعد',
    body: 'الزبون وافق على الموعد اللي اقترحتي. عافاك أكد الحجز.',
  },
  reschedule_proposal_rejected: {
    title: 'رفض الزبون اقتراح الموعد',
    body: 'الزبون رفض الاقتراح ديالك باش يتبدل الموعد.',
  },
  booking_reminder_24h: {
    title: 'تذكير: الحجز ديالك غدا',
    body: 'عندك حجز مبرمج غدا. تأكد من التفاصيل قبل الموعد.',
  },
  booking_reminder_1h: {
    title: 'تذكير: الحجز ديالك من بعد ساعة',
    body: 'الحجز المبرمج ديالك غادي يبدا من بعد شي ساعة.',
  },
  review_request: {
    title: 'عاونا بالتقييم ديالك',
    body: 'كملات المهمة. خود شي دقيقة باش تقيّم التجربة ديالك.',
  },

  custom_time_request_created: { title: 'طلب ديال وقت خاص جديد', body: 'زبون طلب وقت برا الأوقات ديالك. قبل ولا رفض قبل ما تسالي المهلة.' },
  custom_time_request_accepted: { title: 'تقبل الوقت الخاص', body: 'المهني قبل الوقت اللي طلبتي. كمل الحجز قبل ما تسالي المهلة باش تضمنو.' },
  custom_time_request_rejected: { title: 'ترفض الوقت الخاص', body: 'المهني ما يقدرش فهاد الوقت. ختار وقت متاح ولا صيفط طلب جديد.' },
  custom_time_request_expired: { title: 'سالات مهلة طلب الوقت الخاص', body: 'سالات المهلة ديال طلب الوقت الخاص. تقدر تصيفط طلب جديد.' },
  tasker_plan_purchased: { title: 'توصلنا بطلب الباقة', body: 'توصلنا بالخلصة ديال الباقة وراها فالمراجعة. المزايا كيبداو من بعد الموافقة.' },
  tasker_plan_activated: { title: 'الباقة تفعلات', body: 'الباقة ديالك خدامة دابا: عمولة قل، أولوية فالظهور، ومكافأة شهرية.' },
  tasker_plan_rejected: { title: 'الباقة ما تقبلاتش', body: 'طلب الباقة ما تقبلش وترجعو ليك الفلوس.' },
  tasker_plan_renewal_failed: { title: 'تجديد الباقة ما دازش', body: 'ما قدرناش نجددو الباقة ديالك. المزايا باقين شي أيام وحنا كنعاودو المحاولة.' },
  tasker_plan_expired: { title: 'الباقة سالات', body: 'الباقة سالات حيت خلصة التجديد ما دازتش. دابا كتطبق العمولة والترتيب العاديين.' },
};

@Injectable()
export class NotificationTemplateService {
  render(
    templateKey: string | null | undefined,
    locale: string,
    fallback: { title: string; body: string },
  ): RenderedNotification {
    if (locale === 'ar' && templateKey && ARABIC_TEMPLATES[templateKey]) {
      return { ...ARABIC_TEMPLATES[templateKey], locale: 'ar', fallback: false };
    }
    if (locale === 'ary' && templateKey && DARIJA_TEMPLATES[templateKey]) {
      return { ...DARIJA_TEMPLATES[templateKey], locale: 'ary', fallback: false };
    }
    return { ...fallback, locale: 'en', fallback: locale !== 'en' };
  }
}
