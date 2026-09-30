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
  task_time_extension_requested: {
    title: 'طلب وقت إضافي',
    body: 'يطلب المنفذ وقتاً إضافياً لإنهاء المهمة. وافق على الطلب أو ارفضه.',
  },
  task_time_extension_approved: { title: 'تمت الموافقة على الوقت الإضافي', body: 'وافق العميل على الوقت الإضافي المطلوب.' },
  task_time_extension_rejected: { title: 'تم رفض الوقت الإضافي', body: 'رفض العميل طلب الوقت الإضافي.' },
  duration_approval_required: {
    title: 'يلزم اعتماد المدة',
    body: 'يرجى مراجعة مدة المهمة واعتمادها.',
  },
  booking_message: { title: 'رسالة جديدة', body: 'لديك رسالة جديدة بخصوص الحجز.' },
  booking_customer_reminder: { title: 'تذكير من العميل', body: 'أرسل العميل تذكيراً بخصوص مهمة قادمة.' },
  tasker_application_approved: {
    title: 'تمت الموافقة على طلب الانضمام',
    body: 'تمت الموافقة على ملفك كمنفذ في Latache وأصبح نشطاً الآن.',
  },
  tasker_application_rejected: {
    title: 'لم تتم الموافقة على طلب الانضمام',
    body: 'لم تتم الموافقة على طلب انضمامك كمنفذ في Latache.',
  },
  account_suspended: { title: 'تم تعليق الحساب', body: 'تم تعليق حسابك في Latache.' },
  account_deactivated: { title: 'تم إلغاء تفعيل الحساب', body: 'تم إلغاء تفعيل حسابك في Latache.' },
  account_active: { title: 'تم تفعيل الحساب', body: 'أصبح حسابك في Latache نشطاً من جديد.' },
  booking_payment_required: { title: 'الدفع مطلوب', body: 'يلزم إتمام الدفع لتأكيد هذا الحجز.' },
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
  booking_earning_unblocked: {
    title: 'استؤنفت تسوية الأرباح',
    body: 'استؤنفت تسوية أرباحك المعلقة.',
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
  cash_bookings_restricted: {
    title: 'تم تقييد الحجوزات النقدية',
    body: 'بلغت العمولة النقدية المستحقة الحد المسموح به، فتم تقييد قبول حجوزات نقدية جديدة.',
  },
  cash_bookings_unrestricted: {
    title: 'استُعيدت الحجوزات النقدية',
    body: 'أصبحت العمولة المستحقة أقل من الحد المحدد، ويمكنك الآن قبول حجوزات نقدية من جديد.',
  },
  withdrawal_requested: {
    title: 'تم إرسال طلب السحب',
    body: 'تم استلام طلب السحب وهو قيد المراجعة.',
  },
  withdrawal_approved: { title: 'تم اعتماد السحب', body: 'تم اعتماد طلب السحب.' },
  withdrawal_paid: { title: 'تم دفع السحب', body: 'تم تسجيل دفعة السحب كمكتملة.' },
  withdrawal_rejected: { title: 'تم رفض السحب', body: 'تم رفض طلب السحب وأعيد المبلغ إلى رصيدك المتاح.' },
  withdrawal_failed: { title: 'تعذر السحب', body: 'تعذرت معالجة السحب وأعيد المبلغ إلى رصيدك المتاح.' },
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
  elite_auto_promoted: { title: 'تمت ترقية فئة Elite', body: 'أصبحت مؤهلاً لفئة Elite أعلى.' },
  elite_auto_demoted: {
    title: 'تم تحديث فئة Elite',
    body: 'تغيرت فئتك في برنامج Elite لأن متطلبات الفئة السابقة لم تُستوفَ خلال مهلة السماح.',
  },
  elite_retention_warning: {
    title: 'تحذير بشأن الاحتفاظ بفئة Elite',
    body: 'فئتك في برنامج Elite مهددة. استوفِ متطلبات الفئة قبل انتهاء المهلة للحفاظ عليها.',
  },
  elite_retention_recovered: {
    title: 'تم تثبيت فئة Elite',
    body: 'أصبحت تستوفي متطلبات الاحتفاظ بفئتك في برنامج Elite من جديد.',
  },
  elite_badge_awarded: { title: 'شارة Elite جديدة', body: 'حصلت على شارة جديدة في برنامج Elite.' },
  elite_badge_auto_awarded: { title: 'شارة Elite جديدة', body: 'حصلت على شارة جديدة في برنامج Elite.' },
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
  dispute_settlement_proposal_expired: { title: 'انتهت مهلة التسوية المقترحة', body: 'انتهت مهلة الرد على التسوية المقترحة دون رد.' },
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

  booking_payment_captured: { title: 'تم تأكيد الحجز', body: 'تم تحصيل الدفعة وأصبح حجزك مؤكداً.' },
  booking_payment_captured_tasker: { title: 'دفع العميل وتأكدت المهمة', body: 'أكمل العميل الدفع وأصبحت المهمة مؤكدة.' },
  booking_payment_expired: { title: 'أُلغي الحجز لعدم إتمام الدفع', body: 'تم إلغاء الحجز لأن الدفع لم يكتمل في الوقت المحدد. لم يتم خصم أي مبلغ.' },
  booking_payment_expired_tasker: { title: 'أُلغي الحجز لعدم دفع العميل', body: 'تم إلغاء الحجز لأن العميل لم يدفع في الوقت المحدد، وأصبح هذا الموعد متاحاً مجدداً.' },
  booking_payment_refunded: { title: 'تم استرداد الدفعة', body: 'تم إلغاء الحجز ويتم استرداد المبلغ المدفوع بالكامل إلى وسيلة الدفع الأصلية.' },
  booking_unused_prepayment_refunded: { title: 'تم استرداد الوقت غير المستخدم', body: 'استغرقت المهمة وقتاً أقل مما دفعته مسبقاً، وتم استرداد الفرق إلى وسيلة الدفع الأصلية.' },
  booking_cash_selected_tasker: { title: 'تأكدت المهمة - الدفع نقداً', body: 'اختار العميل الدفع نقداً. استلم المبلغ عند انتهاء المهمة.' },
  booking_cash_payment_confirmed: { title: 'تم تأكيد الدفع نقداً', body: 'أكد المنفذ استلام المبلغ نقداً مقابل مهمتك المكتملة.' },
  custom_time_request_created: { title: 'طلب موعد خاص جديد', body: 'طلب عميل موعداً خارج أوقات توفرك. اقبل الطلب أو ارفضه قبل انتهاء المهلة.' },
  custom_time_request_accepted: { title: 'تم قبول الموعد الخاص', body: 'قبل المنفذ الموعد المطلوب. أكمل الحجز قبل انتهاء المهلة لتثبيته.' },
  custom_time_request_rejected: { title: 'تم رفض الموعد الخاص', body: 'لا يستطيع المنفذ العمل في هذا الموعد. اختر موعداً متاحاً أو أرسل طلباً جديداً.' },
  custom_time_request_expired: { title: 'انتهت صلاحية طلب الموعد الخاص', body: 'انتهت مهلة طلب الموعد الخاص. يمكنك إرسال طلب جديد.' },
  custom_time_request_cancelled: { title: 'سحب العميل طلب الموعد الخاص', body: 'سحب العميل طلب الموعد الخاص، لا حاجة لأي إجراء.' },
  tasker_plan_purchased: { title: 'تم استلام طلب الباقة', body: 'تم استلام دفعة الباقة وهي قيد المراجعة. تبدأ المزايا بعد الموافقة.' },
  tasker_plan_activated: { title: 'تم تفعيل الباقة', body: 'باقتك مفعلة الآن مع رسوم منصة مخفضة وأولوية في الظهور ومكافأة شهرية.' },
  tasker_plan_rejected: { title: 'لم تتم الموافقة على الباقة', body: 'لم تتم الموافقة على طلب الباقة وتم استرداد المبلغ.' },
  tasker_plan_renewal_failed: { title: 'فشل تجديد الباقة', body: 'تعذر تجديد باقتك. تبقى المزايا مفعلة لفترة سماح قصيرة بينما نعيد المحاولة.' },
  tasker_plan_expired: { title: 'انتهت الباقة', body: 'انتهت باقتك لتعذر تحصيل دفعة التجديد. تطبق الآن الرسوم والترتيب العاديان.' },
  tasker_plan_cancelled: { title: 'تم إلغاء الباقة', body: 'تم إلغاء باقتك بناءً على طلبك، وإذا كانت لا تزال قيد المراجعة فقد تم استرداد المبلغ.' },
  tasker_plan_terminated: { title: 'تم إنهاء الباقة', body: 'أنهى فريق Latache باقتك ولن يتم تجديدها.' },
  platform_payable_settlement_completed: { title: 'تم استلام دفعتك إلى Latache', body: 'تم تطبيق دفعتك على المستحقات للمنصة. افتح المحفظة لمعرفة الرصيد المتبقي.' },
  platform_payable_settlement_rejected: { title: 'لم يتم تأكيد دفعتك إلى Latache', body: 'تعذر تأكيد التحويل المصرح به. افتح المحفظة للاطلاع على السبب.' },
  tasker_plan_revenue_share: { title: 'تمت إضافة حصة الإيرادات', body: 'تمت إضافة حصة إيرادات باقتك من هذا الحجز إلى محفظتك.' },
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
  task_time_extension_requested: {
    title: 'طلب وقت زايد',
    body: 'المهني كيطلب وقت زايد باش يكمل الخدمة. وافق على الطلب ولا رفضو.',
  },
  task_time_extension_approved: { title: 'تقبل الوقت الزايد', body: 'الزبون وافق على الوقت الزايد اللي طلبتي.' },
  task_time_extension_rejected: { title: 'ترفض الوقت الزايد', body: 'الزبون رفض طلب الوقت الزايد.' },
  duration_approval_required: {
    title: 'خاصك توافق على المدة',
    body: 'راجع مدة الخدمة ووافق عليها.',
  },
  booking_message: { title: 'ميساج جديد', body: 'عندك ميساج جديد على الحجز.' },
  booking_customer_reminder: { title: 'تذكير من الزبون', body: 'الزبون صيفط تذكير على خدمة جاية.' },
  tasker_application_approved: {
    title: 'تقبل طلب الانضمام',
    body: 'تقبل الملف ديالك كمهني ف Latache وولا نشيط دابا.',
  },
  tasker_application_rejected: {
    title: 'ما تقبلش طلب الانضمام',
    body: 'ما تقبلش طلب الانضمام ديالك كمهني ف Latache.',
  },
  account_suspended: { title: 'تعلق الحساب', body: 'تعلق الحساب ديالك ف Latache.' },
  account_deactivated: { title: 'توقف الحساب', body: 'توقف الحساب ديالك ف Latache.' },
  account_active: { title: 'تفعل الحساب', body: 'ولا الحساب ديالك ف Latache نشيط من جديد.' },
  booking_payment_required: { title: 'الخلصة مطلوبة', body: 'خاص تكمل الخلصة باش تأكد هاد الحجز.' },
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
  booking_earning_unblocked: {
    title: 'عاودات تسوية الأرباح',
    body: 'عاودات تسوية الأرباح ديالك اللي كانت متوقفة.',
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
  cash_bookings_restricted: {
    title: 'تقيدات الحجوزات ديال الكاش',
    body: 'العمولة ديال الكاش اللي خاصك تخلص وصلات للحد المسموح، فتقيد قبول حجوزات كاش جداد.',
  },
  cash_bookings_unrestricted: {
    title: 'رجعات الحجوزات ديال الكاش',
    body: 'العمولة اللي خاصك تخلص ولات قل من الحد، دابا تقدر تقبل حجوزات كاش من جديد.',
  },
  withdrawal_requested: { title: 'تصيفط طلب السحب', body: 'توصلنا بطلب السحب وراه كيتراجع.' },
  withdrawal_approved: { title: 'تقبل السحب', body: 'تقبل طلب السحب ديالك.' },
  withdrawal_paid: { title: 'تخلص السحب', body: 'تسجلات خلصة السحب باللي كملات.' },
  withdrawal_rejected: { title: 'ترفض السحب', body: 'ترفض طلب السحب ورجعو الفلوس للرصيد المتوفر ديالك.' },
  withdrawal_failed: { title: 'ماداتش السحب', body: 'مقدرناش نعالجو السحب ورجعو الفلوس للرصيد المتوفر ديالك.' },
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
  elite_auto_promoted: { title: 'تزادت فئة Elite', body: 'دابا مؤهل لفئة Elite أعلى.' },
  elite_auto_demoted: {
    title: 'تبدلات فئة Elite',
    body: 'تبدلات الفئة ديالك ف Elite حيت شروط الفئة اللي فاتت ماتكملاتش فمهلة السماح.',
  },
  elite_retention_warning: {
    title: 'تحذير على فئة Elite',
    body: 'الفئة ديالك ف Elite مهددة. خاصك تكمل شروط الفئة قبل ما تسالي المهلة باش تحتفظ بيها.',
  },
  elite_retention_recovered: {
    title: 'تثبتات فئة Elite',
    body: 'دابا كتكمل شروط الاحتفاظ بالفئة ديالك ف Elite من جديد.',
  },
  elite_badge_awarded: { title: 'شارة Elite جديدة', body: 'خديتي شارة جديدة فبرنامج Elite.' },
  elite_badge_auto_awarded: { title: 'شارة Elite جديدة', body: 'خديتي شارة جديدة فبرنامج Elite.' },
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
  dispute_settlement_proposal_expired: { title: 'سالات مهلة التسوية المقترحة', body: 'سالات مهلة الرد على التسوية المقترحة بلا رد.' },
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

  booking_payment_captured: { title: 'الحجز تأكد', body: 'الخلصة دازت والحجز ديالك تأكد.' },
  booking_payment_captured_tasker: { title: 'الزبون خلص والمهمة تأكدات', body: 'الزبون كمل الخلصة والمهمة دابا مأكدة.' },
  booking_payment_expired: { title: 'الحجز تلغى حيت الخلصة ما تكملاتش', body: 'الحجز تلغى حيت الخلصة ما تكملاتش فالوقت. ما تقطع عليك والو.' },
  booking_payment_expired_tasker: { title: 'الحجز تلغى حيت الزبون ما خلصش', body: 'الحجز تلغى حيت الزبون ما خلصش فالوقت، والوقت ولى متاح من جديد.' },
  booking_payment_refunded: { title: 'الفلوس ترجعات', body: 'الحجز تلغى والفلوس اللي خلصتي غادي ترجع ليك كاملة لنفس وسيلة الخلاص.' },
  booking_unused_prepayment_refunded: { title: 'ترجع ليك الوقت اللي ما تستعملش', body: 'المهمة خدات وقت قل من اللي خلصتي مسبقاً، والفرق رجع ليك لنفس وسيلة الخلاص.' },
  booking_cash_selected_tasker: { title: 'المهمة تأكدات - الخلاص كاش', body: 'الزبون اختار يخلص كاش. شد الفلوس ملي تسالي المهمة.' },
  booking_cash_payment_confirmed: { title: 'تأكد الخلاص كاش', body: 'المهني أكد أنه شد الفلوس كاش مقابل المهمة اللي كملات.' },
  custom_time_request_created: { title: 'طلب ديال وقت خاص جديد', body: 'زبون طلب وقت برا الأوقات ديالك. قبل ولا رفض قبل ما تسالي المهلة.' },
  custom_time_request_accepted: { title: 'تقبل الوقت الخاص', body: 'المهني قبل الوقت اللي طلبتي. كمل الحجز قبل ما تسالي المهلة باش تضمنو.' },
  custom_time_request_rejected: { title: 'ترفض الوقت الخاص', body: 'المهني ما يقدرش فهاد الوقت. ختار وقت متاح ولا صيفط طلب جديد.' },
  custom_time_request_expired: { title: 'سالات مهلة طلب الوقت الخاص', body: 'سالات المهلة ديال طلب الوقت الخاص. تقدر تصيفط طلب جديد.' },
  custom_time_request_cancelled: { title: 'الزبون سحب طلب الوقت الخاص', body: 'الزبون سحب طلب الوقت الخاص، ما خاصك دير والو.' },
  tasker_plan_purchased: { title: 'توصلنا بطلب الباقة', body: 'توصلنا بالخلصة ديال الباقة وراها فالمراجعة. المزايا كيبداو من بعد الموافقة.' },
  tasker_plan_activated: { title: 'الباقة تفعلات', body: 'الباقة ديالك خدامة دابا: عمولة قل، أولوية فالظهور، ومكافأة شهرية.' },
  tasker_plan_rejected: { title: 'الباقة ما تقبلاتش', body: 'طلب الباقة ما تقبلش وترجعو ليك الفلوس.' },
  tasker_plan_renewal_failed: { title: 'تجديد الباقة ما دازش', body: 'ما قدرناش نجددو الباقة ديالك. المزايا باقين شي أيام وحنا كنعاودو المحاولة.' },
  tasker_plan_expired: { title: 'الباقة سالات', body: 'الباقة سالات حيت خلصة التجديد ما دازتش. دابا كتطبق العمولة والترتيب العاديين.' },
  tasker_plan_cancelled: { title: 'الباقة تلغات', body: 'الباقة ديالك تلغات كيف طلبتي، وإلا كانت الخلصة ديالها باقا فالمراجعة ترجعات ليك.' },
  tasker_plan_terminated: { title: 'الباقة توقفات', body: 'فريق Latache وقف الباقة ديالك وما غاديش تتجدد.' },
  platform_payable_settlement_completed: { title: 'توصلنا بالخلصة ديالك لـ Latache', body: 'الخلصة ديالك تحسبات من المستحقات ديال المنصة. شوف المحفظة باش تعرف شحال باقي.' },
  platform_payable_settlement_rejected: { title: 'الخلصة ديالك لـ Latache ما تأكداتش', body: 'ما قدرناش نأكدو التحويل اللي صرحتي بيه. شوف المحفظة باش تعرف السبب.' },
  tasker_plan_revenue_share: { title: 'تزادت حصة المداخيل', body: 'تزادت فالمحفظة ديالك حصة المداخيل ديال الباقة من هاد الحجز.' },
};

const FRENCH_TEMPLATES: Record<string, LocalizedTemplate> = {
  booking_requested: {
    title: 'Nouvelle demande de réservation',
    body: 'Vous avez une nouvelle demande de réservation. Ouvrez la réservation pour voir les détails.',
  },
  booking_rescheduled: {
    title: 'Réservation reprogrammée',
    body: "L'horaire de la réservation a été modifié. Ouvrez la réservation pour voir le nouveau créneau.",
  },
  booking_cancelled_by_customer: { title: 'Le client a annulé la réservation', body: 'Le client a annulé cette réservation.' },
  booking_cancelled_by_admin: {
    title: 'Réservation annulée',
    body: "L'équipe Latache a annulé cette réservation. Ouvrez la réservation pour voir les détails.",
  },
  task_cancelled_by_tasker: { title: 'Le Tasker a annulé la tâche', body: 'Le Tasker a annulé cette tâche.' },
  task_confirmed: { title: 'Tâche confirmée', body: 'La tâche a été confirmée avec succès.' },
  tasker_en_route: { title: 'Le Tasker est en route', body: 'Le Tasker est en chemin vers le lieu de la tâche.' },
  tasker_arrived: { title: 'Le Tasker est arrivé', body: 'Le Tasker est arrivé sur le lieu de la tâche.' },
  task_started: { title: 'La tâche a commencé', body: 'Le travail sur la tâche a commencé.' },
  task_completed: { title: 'Tâche terminée', body: 'La tâche a été enregistrée comme terminée.' },
  task_completed_by_customer: { title: 'Tâche terminée', body: 'Le client a confirmé que la tâche est terminée.' },
  task_completion_submitted: {
    title: 'Veuillez vérifier la tâche terminée',
    body: 'Le Tasker a envoyé une demande de fin de tâche. Approuvez-la ou ouvrez un litige avant la fin du délai.',
  },
  task_completion_auto_approved: {
    title: 'Fin de tâche approuvée',
    body: "Le délai de vérification s'est écoulé sans litige, la fin de la tâche a donc été approuvée automatiquement.",
  },
  task_time_extended: { title: 'Durée de la tâche prolongée', body: 'La durée de la tâche a été mise à jour.' },
  task_time_extension_requested: {
    title: 'Demande de temps supplémentaire',
    body: 'Le Tasker demande plus de temps pour terminer la tâche. Approuvez ou refusez la demande.',
  },
  task_time_extension_approved: { title: 'Temps supplémentaire approuvé', body: 'Le client a approuvé le temps supplémentaire demandé.' },
  task_time_extension_rejected: { title: 'Temps supplémentaire refusé', body: 'Le client a refusé la demande de temps supplémentaire.' },
  duration_approval_required: {
    title: 'Approbation de la durée requise',
    body: 'Veuillez vérifier et approuver la durée de la tâche.',
  },
  booking_message: { title: 'Nouveau message', body: 'Vous avez un nouveau message concernant la réservation.' },
  booking_customer_reminder: { title: 'Rappel du client', body: 'Le client a envoyé un rappel concernant une tâche à venir.' },
  tasker_application_approved: {
    title: 'Candidature approuvée',
    body: 'Votre profil de Tasker chez Latache a été approuvé et est maintenant actif.',
  },
  tasker_application_rejected: {
    title: 'Candidature non approuvée',
    body: "Votre demande pour devenir Tasker chez Latache n'a pas été approuvée.",
  },
  account_suspended: { title: 'Compte suspendu', body: 'Votre compte Latache a été suspendu.' },
  account_deactivated: { title: 'Compte désactivé', body: 'Votre compte Latache a été désactivé.' },
  account_active: { title: 'Compte réactivé', body: 'Votre compte Latache est de nouveau actif.' },
  booking_payment_required: { title: 'Paiement requis', body: 'Le paiement doit être finalisé pour confirmer cette réservation.' },
  booking_payment_succeeded: { title: 'Paiement effectué', body: 'Le paiement de la réservation a été réglé avec succès.' },
  booking_wallet_payment_succeeded: {
    title: 'Paiement effectué depuis le portefeuille',
    body: 'La réservation a été payée avec succès depuis votre portefeuille.',
  },
  booking_payment_failed: {
    title: 'Échec du paiement',
    body: "Le paiement de la réservation n'a pas pu être traité. Vérifiez le moyen de paiement et réessayez.",
  },
  wallet_topup_succeeded: { title: 'Portefeuille rechargé', body: 'Le montant a été ajouté avec succès à votre portefeuille.' },
  wallet_topup_failed: { title: 'Échec de la recharge', body: 'La recharge du portefeuille n\'a pas pu être effectuée.' },
  booking_earning_pending: {
    title: 'Gains en cours de règlement',
    body: 'Le paiement de la réservation a été réglé et vos gains sont en période de déblocage.',
  },
  booking_earning_released: {
    title: 'Gains disponibles',
    body: 'Les gains de la réservation ont été libérés vers votre solde disponible.',
  },
  booking_earning_blocked: {
    title: 'Gains suspendus',
    body: "Les gains de la réservation ont été suspendus. Ouvrez l'historique des gains pour voir la raison.",
  },
  booking_earning_unblocked: {
    title: 'Règlement des gains repris',
    body: 'Le règlement de vos gains suspendus a repris.',
  },
  booking_earning_reversed: {
    title: 'Gains annulés',
    body: 'Les gains de la réservation ont été annulés en totalité ou en partie.',
  },
  booking_refund_adjustment: {
    title: 'Ajustement lié à un remboursement',
    body: 'Un ajustement financier lié à un remboursement de réservation a été enregistré.',
  },
  cash_platform_payable_created: {
    title: 'Commission en espèces enregistrée',
    body: 'Le montant en espèces encaissé et la commission due à la plateforme ont été enregistrés.',
  },
  cash_platform_payable_settled: {
    title: 'Commission réglée',
    body: 'Une partie de la commission due à la plateforme a été réglée à partir de vos gains électroniques.',
  },
  cash_bookings_restricted: {
    title: 'Réservations en espèces restreintes',
    body: "La commission en espèces due a atteint la limite autorisée, donc l'acceptation de nouvelles réservations en espèces est restreinte.",
  },
  cash_bookings_unrestricted: {
    title: 'Réservations en espèces rétablies',
    body: 'La commission due est passée sous la limite fixée ; vous pouvez de nouveau accepter des réservations en espèces.',
  },
  withdrawal_requested: {
    title: 'Demande de retrait envoyée',
    body: 'Votre demande de retrait a été reçue et est en cours d\'examen.',
  },
  withdrawal_approved: { title: 'Retrait approuvé', body: 'Votre demande de retrait a été approuvée.' },
  withdrawal_paid: { title: 'Retrait payé', body: 'Le paiement du retrait a été enregistré comme terminé.' },
  withdrawal_rejected: { title: 'Retrait refusé', body: 'La demande de retrait a été refusée et le montant a été remis sur votre solde disponible.' },
  withdrawal_failed: { title: 'Échec du retrait', body: "Le retrait n'a pas pu être traité et le montant a été remis sur votre solde disponible." },
  withdrawal_cancelled: { title: 'Retrait annulé', body: 'La demande de retrait a été annulée.' },
  review_received: { title: 'Nouvel avis', body: 'Vous avez reçu un nouvel avis.' },
  booking_dispute_opened: { title: 'Litige ouvert', body: 'Un litige a été ouvert concernant la réservation.' },
  booking_dispute_resolved: { title: 'Litige résolu', body: 'La décision du litige a été enregistrée.' },
  dispute_evidence_requested: {
    title: 'Preuve requise',
    body: "L'équipe Latache a demandé une preuve supplémentaire pour le litige.",
  },
  dispute_evidence_received: { title: 'Preuve reçue', body: 'Une nouvelle preuve a été ajoutée au litige.' },
  dispute_evidence_reviewed: { title: 'Preuve examinée', body: "L'équipe Latache a examiné les preuves actuelles du litige." },
  dispute_escalated: { title: 'Litige escaladé', body: 'Le litige a été escaladé pour examen.' },
  dispute_refund_failed: {
    title: 'Échec du remboursement du litige',
    body: "Le remboursement du litige n'a pas pu être traité. L'intervention de l'équipe financière est nécessaire.",
  },
  support_agent_reply: {
    title: 'Nouvelle réponse du support',
    body: "L'équipe support a ajouté une nouvelle réponse à votre ticket.",
  },
  support_user_reply: {
    title: 'Nouvelle réponse sur le ticket de support',
    body: "L'utilisateur a ajouté une nouvelle réponse au ticket de support.",
  },
  support_ticket_assigned: { title: 'Ticket de support assigné', body: 'Un ticket de support vous a été assigné.' },
  support_ticket_escalated: { title: 'Ticket de support escaladé', body: 'Le ticket de support a été escaladé.' },
  support_ticket_resolved: { title: 'Ticket de support résolu', body: 'Le ticket de support a été enregistré comme résolu.' },
  support_queue_update: { title: 'Mise à jour de la file de support', body: 'La file des tickets de support a été mise à jour.' },
  elite_request_submitted: { title: 'Demande Elite envoyée', body: 'Votre demande pour le programme Elite a été reçue.' },
  elite_tier_changed: { title: 'Niveau Elite mis à jour', body: 'Votre statut dans le programme Elite a été mis à jour.' },
  elite_auto_promoted: { title: 'Niveau Elite amélioré', body: 'Vous êtes désormais éligible à un niveau Elite supérieur.' },
  elite_auto_demoted: {
    title: 'Niveau Elite mis à jour',
    body: "Votre niveau Elite a changé car les conditions du niveau précédent n'ont pas été respectées pendant le délai de grâce.",
  },
  elite_retention_warning: {
    title: 'Avertissement de maintien du niveau Elite',
    body: 'Votre niveau Elite est menacé. Remplissez les conditions du niveau avant la fin du délai pour le conserver.',
  },
  elite_retention_recovered: {
    title: 'Niveau Elite maintenu',
    body: 'Vous remplissez de nouveau les conditions de maintien de votre niveau Elite.',
  },
  elite_badge_awarded: { title: 'Nouveau badge Elite', body: 'Vous avez obtenu un nouveau badge dans le programme Elite.' },
  elite_badge_auto_awarded: { title: 'Nouveau badge Elite', body: 'Vous avez obtenu un nouveau badge dans le programme Elite.' },
  referral_claimed: {
    title: 'Code de parrainage utilisé',
    body: 'Un nouveau participant a utilisé votre code de parrainage. La récompense reste en attente jusqu\'au règlement d\'une réservation éligible.',
  },
  referral_qualified: {
    title: 'Parrainage qualifié',
    body: 'Une réservation éligible a été réglée et la période de déblocage de la récompense de parrainage a commencé.',
  },
  referral_reward_available: {
    title: 'Récompense de parrainage disponible',
    body: 'La récompense de parrainage a été ajoutée à votre portefeuille après la fin de la période de déblocage.',
  },
  referral_revoked: {
    title: 'Récompense de parrainage annulée',
    body: "Une annulation a été enregistrée pour une récompense de parrainage qui n'est plus éligible.",
  },
  referral_expired: {
    title: 'Parrainage expiré',
    body: "Le délai de qualification a expiré avant le règlement d'une réservation éligible.",
  },
  dispute_investigation_started: { title: "Enquête sur le litige commencée", body: "L'équipe Latache a commencé à examiner le litige." },
  dispute_assignment_updated: { title: 'Responsable du litige mis à jour', body: 'Le responsable chargé d\'examiner le litige a été mis à jour.' },
  dispute_priority_updated: { title: 'Priorité du litige mise à jour', body: 'La priorité de traitement du litige a été mise à jour.' },
  dispute_reopened: { title: 'Litige rouvert', body: 'Le litige a été rouvert pour examen.' },
  dispute_withdrawn: { title: 'Litige retiré', body: "La personne à l'origine du litige l'a retiré." },
  dispute_comment_added: { title: 'Nouveau commentaire sur le litige', body: 'Un nouveau commentaire a été ajouté au litige.' },
  dispute_settlement_proposed: { title: 'Règlement proposé', body: "L'équipe Latache a proposé un règlement pour le litige." },
  dispute_settlement_response: { title: 'Réponse au règlement enregistrée', body: "La réponse d'un participant au règlement proposé a été enregistrée." },
  dispute_settlement_proposal_expired: { title: 'Délai du règlement proposé expiré', body: 'Le délai pour répondre au règlement proposé a expiré sans réponse.' },
  dispute_appealed: { title: "Litige fait l'objet d'un appel", body: "Le litige a été rouvert après l'appel d'un participant." },
  dispute_evidence_reminder: { title: 'Rappel : preuve à fournir', body: 'Le délai pour fournir la preuve demandée approche.' },
  dispute_evidence_overdue: { title: 'Preuve requise en retard', body: 'Le délai pour fournir la preuve demandée est dépassé.' },
  dispute_evidence_expired: { title: 'Délai de preuve expiré', body: 'Le délai de preuve a expiré et le litige a été escaladé.' },
  dispute_sla_breached: { title: 'Examen du litige escaladé', body: "Le litige a dépassé le délai d'examen et a été escaladé." },
  dispute_cash_refund_pending: { title: 'Remboursement en espèces nécessitant un virement confirmé', body: "Un engagement de remboursement en espèces manuel a été créé et n'a pas encore été enregistré comme payé." },
  dispute_cash_refund_confirmed: { title: 'Remboursement en espèces confirmé', body: 'Le virement en espèces a été confirmé et enregistré dans le dossier du litige.' },
  stripe_chargeback_opened: { title: 'Litige de paiement Stripe', body: 'Stripe a signalé une contestation sur un paiement lié à la réservation.' },
  stripe_chargeback_updated: { title: 'Mise à jour de la contestation Stripe', body: 'Le statut de la contestation Stripe liée à la réservation a été mis à jour.' },
  stripe_chargeback_closed: { title: 'Contestation Stripe clôturée', body: 'Stripe a signalé la clôture de la contestation de paiement liée à la réservation.' },
  booking_expired_no_response: {
    title: 'Demande de réservation expirée',
    body: "Aucune réponse n'a été donnée à la demande de réservation dans le délai imparti, elle a donc été annulée automatiquement.",
  },
  booking_reassigned: {
    title: 'Réservation réassignée',
    body: "L'équipe Latache a réassigné cette réservation à un autre Tasker.",
  },
  front_door_proof_submitted: {
    title: "Preuve d'arrivée envoyée",
    body: 'Le Tasker a joint une photo prouvant son arrivée à la porte. Vous pouvez maintenant générer le code de démarrage.',
  },
  work_start_code_ready: {
    title: 'Le client a généré le code de démarrage',
    body: 'Demandez au client le code à six chiffres pour démarrer le minuteur de la tâche.',
  },
  work_completion_proof_submitted: {
    title: 'Preuve de fin de travail envoyée',
    body: 'Le Tasker a joint une photo de fin de travail. Le minuteur facturable s\'est arrêté ; générez le code de fin après vérification du travail.',
  },
  work_completion_code_ready: {
    title: 'Le client a généré le code de fin',
    body: 'Demandez au client le code de fin à six chiffres pour terminer la tâche.',
  },
  task_completion_verified: {
    title: 'Fin de tâche vérifiée',
    body: 'Le code de fin du client a été vérifié. Le traitement du paiement final peut maintenant commencer.',
  },
  duration_review_approved: {
    title: 'Prolongation de durée approuvée',
    body: 'Le client a approuvé le temps supplémentaire et le paiement final a été retenté.',
  },
  reschedule_proposal_created: {
    title: "Nouvelle proposition de changement d'horaire",
    body: 'Le Tasker propose de déplacer cette réservation à un nouvel horaire. Examinez la proposition et répondez.',
  },
  reschedule_proposal_accepted: {
    title: "Proposition de changement d'horaire acceptée",
    body: 'Le client a accepté l\'horaire que vous avez proposé. Veuillez confirmer la réservation.',
  },
  reschedule_proposal_rejected: {
    title: "Proposition de changement d'horaire refusée",
    body: 'Le client a refusé votre proposition de changement d\'horaire.',
  },
  booking_reminder_24h: {
    title: 'Rappel : réservation demain',
    body: 'Vous avez une réservation prévue demain. Vérifiez les détails pour vous préparer.',
  },
  booking_reminder_1h: {
    title: 'Rappel : réservation dans une heure',
    body: 'Votre réservation prévue commence dans environ une heure.',
  },
  review_request: {
    title: 'Partagez votre avis',
    body: 'La tâche est terminée. Prenez un moment pour évaluer votre expérience.',
  },
  booking_payment_captured: { title: 'Réservation confirmée', body: 'Le paiement a été prélevé et votre réservation est confirmée.' },
  booking_payment_captured_tasker: { title: 'Le client a payé - tâche confirmée', body: 'Le client a terminé le paiement et la tâche est maintenant confirmée.' },
  booking_payment_expired: { title: 'Réservation annulée - paiement non terminé', body: "La réservation a été annulée car le paiement n'a pas été finalisé à temps. Aucun montant n'a été débité." },
  booking_payment_expired_tasker: { title: "Réservation annulée - le client n'a pas payé", body: "La réservation a été annulée car le client n'a pas payé à temps, et ce créneau est de nouveau disponible." },
  booking_payment_refunded: { title: 'Paiement remboursé', body: "La réservation a été annulée et le montant payé est intégralement remboursé sur le moyen de paiement d'origine." },
  booking_unused_prepayment_refunded: { title: 'Temps non utilisé remboursé', body: "La tâche a pris moins de temps que ce qui a été prépayé, la différence a été remboursée sur le moyen de paiement d'origine." },
  booking_cash_selected_tasker: { title: 'Tâche confirmée - paiement en espèces', body: 'Le client a choisi de payer en espèces. Récupérez le montant à la fin de la tâche.' },
  booking_cash_payment_confirmed: { title: 'Paiement en espèces confirmé', body: 'Le Tasker a confirmé avoir reçu le montant en espèces pour votre tâche terminée.' },
  custom_time_request_created: { title: "Nouvelle demande d'horaire personnalisé", body: 'Un client a demandé un horaire en dehors de vos disponibilités. Acceptez ou refusez avant la fin du délai.' },
  custom_time_request_accepted: { title: 'Horaire personnalisé accepté', body: 'Le Tasker a accepté l\'horaire demandé. Finalisez la réservation avant la fin du délai pour la confirmer.' },
  custom_time_request_rejected: { title: 'Horaire personnalisé refusé', body: 'Le Tasker ne peut pas travailler à cet horaire. Choisissez un autre créneau ou envoyez une nouvelle demande.' },
  custom_time_request_expired: { title: "Demande d'horaire personnalisé expirée", body: "Le délai de la demande d'horaire personnalisé a expiré. Vous pouvez envoyer une nouvelle demande." },
  custom_time_request_cancelled: { title: "Le client a retiré la demande d'horaire personnalisé", body: "Le client a retiré la demande d'horaire personnalisé, aucune action n'est nécessaire." },
  tasker_plan_purchased: { title: 'Demande de forfait reçue', body: 'Le paiement du forfait a été reçu et est en cours d\'examen. Les avantages commencent après approbation.' },
  tasker_plan_activated: { title: 'Forfait activé', body: 'Votre forfait est maintenant actif, avec des frais de plateforme réduits, une priorité de visibilité et une récompense mensuelle.' },
  tasker_plan_rejected: { title: 'Forfait non approuvé', body: 'La demande de forfait n\'a pas été approuvée et le montant a été remboursé.' },
  tasker_plan_renewal_failed: { title: 'Échec du renouvellement du forfait', body: 'Le renouvellement de votre forfait a échoué. Les avantages restent actifs pendant une courte période de grâce le temps de réessayer.' },
  tasker_plan_expired: { title: 'Forfait expiré', body: 'Votre forfait a expiré car le paiement du renouvellement n\'a pas pu être prélevé. Les frais et le classement habituels s\'appliquent désormais.' },
  tasker_plan_cancelled: { title: 'Forfait annulé', body: 'Votre forfait a été annulé à votre demande, et si le paiement était encore en cours d\'examen, il a été remboursé.' },
  tasker_plan_terminated: { title: 'Forfait résilié', body: "L'équipe Latache a résilié votre forfait et il ne sera pas renouvelé." },
  platform_payable_settlement_completed: { title: 'Votre paiement à Latache a été reçu', body: 'Votre paiement a été appliqué aux montants dus à la plateforme. Ouvrez le portefeuille pour voir le solde restant.' },
  platform_payable_settlement_rejected: { title: "Votre paiement à Latache n'a pas été confirmé", body: 'Le virement déclaré n\'a pas pu être confirmé. Ouvrez le portefeuille pour en voir la raison.' },
  tasker_plan_revenue_share: { title: 'Part de revenus ajoutée', body: 'La part de revenus de votre forfait pour cette réservation a été ajoutée à votre portefeuille.' },
};

const SPANISH_TEMPLATES: Record<string, LocalizedTemplate> = {
  booking_requested: {
    title: 'Nueva solicitud de reserva',
    body: 'Tienes una nueva solicitud de reserva. Abre la reserva para ver los detalles.',
  },
  booking_rescheduled: {
    title: 'Reserva reprogramada',
    body: 'Se actualizó el horario de la reserva. Abre la reserva para ver el nuevo horario.',
  },
  booking_cancelled_by_customer: { title: 'El cliente canceló la reserva', body: 'El cliente canceló esta reserva.' },
  booking_cancelled_by_admin: {
    title: 'Reserva cancelada',
    body: 'El equipo de Latache canceló esta reserva. Abre la reserva para ver los detalles.',
  },
  task_cancelled_by_tasker: { title: 'El Tasker canceló la tarea', body: 'El Tasker canceló esta tarea.' },
  task_confirmed: { title: 'Tarea confirmada', body: 'La tarea se confirmó correctamente.' },
  tasker_en_route: { title: 'El Tasker está en camino', body: 'El Tasker va en camino al lugar de la tarea.' },
  tasker_arrived: { title: 'El Tasker llegó', body: 'El Tasker llegó al lugar de la tarea.' },
  task_started: { title: 'La tarea comenzó', body: 'El trabajo en la tarea comenzó.' },
  task_completed: { title: 'Tarea completada', body: 'La tarea se registró como completada.' },
  task_completed_by_customer: { title: 'Tarea completada', body: 'El cliente confirmó que la tarea está completada.' },
  task_completion_submitted: {
    title: 'Revisa la tarea completada',
    body: 'El Tasker envió una solicitud de finalización. Apruébala o abre una disputa antes de que termine el plazo.',
  },
  task_completion_auto_approved: {
    title: 'Finalización de tarea aprobada',
    body: 'El plazo de revisión terminó sin disputas, así que la finalización de la tarea se aprobó automáticamente.',
  },
  task_time_extended: { title: 'Duración de la tarea extendida', body: 'Se actualizó la duración de la tarea.' },
  task_time_extension_requested: {
    title: 'Solicitud de tiempo adicional',
    body: 'El Tasker pide más tiempo para terminar la tarea. Aprueba o rechaza la solicitud.',
  },
  task_time_extension_approved: { title: 'Tiempo adicional aprobado', body: 'El cliente aprobó el tiempo adicional solicitado.' },
  task_time_extension_rejected: { title: 'Tiempo adicional rechazado', body: 'El cliente rechazó la solicitud de tiempo adicional.' },
  duration_approval_required: {
    title: 'Se requiere aprobar la duración',
    body: 'Revisa y aprueba la duración de la tarea.',
  },
  booking_message: { title: 'Nuevo mensaje', body: 'Tienes un nuevo mensaje sobre la reserva.' },
  booking_customer_reminder: { title: 'Recordatorio del cliente', body: 'El cliente envió un recordatorio sobre una tarea próxima.' },
  tasker_application_approved: {
    title: 'Solicitud aprobada',
    body: 'Tu perfil de Tasker en Latache fue aprobado y ya está activo.',
  },
  tasker_application_rejected: {
    title: 'Solicitud no aprobada',
    body: 'Tu solicitud para ser Tasker en Latache no fue aprobada.',
  },
  account_suspended: { title: 'Cuenta suspendida', body: 'Tu cuenta de Latache fue suspendida.' },
  account_deactivated: { title: 'Cuenta desactivada', body: 'Tu cuenta de Latache fue desactivada.' },
  account_active: { title: 'Cuenta activada', body: 'Tu cuenta de Latache está activa de nuevo.' },
  booking_payment_required: { title: 'Pago requerido', body: 'Debes completar el pago para confirmar esta reserva.' },
  booking_payment_succeeded: { title: 'Pago realizado', body: 'El pago de la reserva se completó correctamente.' },
  booking_wallet_payment_succeeded: {
    title: 'Pago realizado desde la billetera',
    body: 'La reserva se pagó correctamente desde tu billetera.',
  },
  booking_payment_failed: {
    title: 'Pago fallido',
    body: 'No se pudo procesar el pago de la reserva. Revisa el método de pago e inténtalo de nuevo.',
  },
  wallet_topup_succeeded: { title: 'Billetera recargada', body: 'El monto se añadió correctamente a tu billetera.' },
  wallet_topup_failed: { title: 'Recarga fallida', body: 'No se pudo completar la recarga de la billetera.' },
  booking_earning_pending: {
    title: 'Ganancias en proceso',
    body: 'El pago de la reserva se completó y tus ganancias están en periodo de liberación.',
  },
  booking_earning_released: {
    title: 'Ganancias disponibles',
    body: 'Las ganancias de la reserva se liberaron a tu saldo disponible.',
  },
  booking_earning_blocked: {
    title: 'Ganancias suspendidas',
    body: 'Las ganancias de la reserva fueron suspendidas. Abre el historial de ganancias para ver el motivo.',
  },
  booking_earning_unblocked: {
    title: 'Liberación de ganancias reanudada',
    body: 'Se reanudó la liberación de tus ganancias suspendidas.',
  },
  booking_earning_reversed: {
    title: 'Ganancias revertidas',
    body: 'Las ganancias de la reserva se revirtieron total o parcialmente.',
  },
  booking_refund_adjustment: {
    title: 'Ajuste por reembolso',
    body: 'Se registró un ajuste financiero relacionado con un reembolso de reserva.',
  },
  cash_platform_payable_created: {
    title: 'Comisión en efectivo registrada',
    body: 'Se registró el monto en efectivo cobrado y la comisión debida a la plataforma.',
  },
  cash_platform_payable_settled: {
    title: 'Comisión saldada',
    body: 'Se saldó parte de la comisión debida a la plataforma con tus ganancias electrónicas.',
  },
  cash_bookings_restricted: {
    title: 'Reservas en efectivo restringidas',
    body: 'La comisión en efectivo pendiente alcanzó el límite permitido, por lo que se restringió aceptar nuevas reservas en efectivo.',
  },
  cash_bookings_unrestricted: {
    title: 'Reservas en efectivo restablecidas',
    body: 'La comisión pendiente bajó del límite establecido; ya puedes aceptar reservas en efectivo de nuevo.',
  },
  withdrawal_requested: {
    title: 'Solicitud de retiro enviada',
    body: 'Tu solicitud de retiro fue recibida y está en revisión.',
  },
  withdrawal_approved: { title: 'Retiro aprobado', body: 'Tu solicitud de retiro fue aprobada.' },
  withdrawal_paid: { title: 'Retiro pagado', body: 'El pago del retiro se registró como completado.' },
  withdrawal_rejected: { title: 'Retiro rechazado', body: 'Se rechazó la solicitud de retiro y el monto volvió a tu saldo disponible.' },
  withdrawal_failed: { title: 'Retiro fallido', body: 'No se pudo procesar el retiro y el monto volvió a tu saldo disponible.' },
  withdrawal_cancelled: { title: 'Retiro cancelado', body: 'Se canceló la solicitud de retiro.' },
  review_received: { title: 'Nueva reseña', body: 'Recibiste una nueva reseña.' },
  booking_dispute_opened: { title: 'Disputa abierta', body: 'Se abrió una disputa sobre la reserva.' },
  booking_dispute_resolved: { title: 'Disputa resuelta', body: 'Se registró la decisión de la disputa.' },
  dispute_evidence_requested: {
    title: 'Se requiere evidencia',
    body: 'El equipo de Latache solicitó evidencia adicional para la disputa.',
  },
  dispute_evidence_received: { title: 'Evidencia recibida', body: 'Se añadió nueva evidencia a la disputa.' },
  dispute_evidence_reviewed: { title: 'Evidencia revisada', body: 'El equipo de Latache revisó la evidencia actual de la disputa.' },
  dispute_escalated: { title: 'Disputa escalada', body: 'La disputa fue escalada para revisión.' },
  dispute_refund_failed: {
    title: 'Fallo en el reembolso de la disputa',
    body: 'No se pudo procesar el reembolso de la disputa. Se requiere la intervención del equipo financiero.',
  },
  support_agent_reply: {
    title: 'Nueva respuesta de soporte',
    body: 'El equipo de soporte añadió una nueva respuesta a tu ticket.',
  },
  support_user_reply: {
    title: 'Nueva respuesta en el ticket de soporte',
    body: 'El usuario añadió una nueva respuesta al ticket de soporte.',
  },
  support_ticket_assigned: { title: 'Ticket de soporte asignado', body: 'Se te asignó un ticket de soporte.' },
  support_ticket_escalated: { title: 'Ticket de soporte escalado', body: 'Se escaló el ticket de soporte.' },
  support_ticket_resolved: { title: 'Ticket de soporte resuelto', body: 'El ticket de soporte se registró como resuelto.' },
  support_queue_update: { title: 'Actualización de la cola de soporte', body: 'Se actualizó la cola de tickets de soporte.' },
  elite_request_submitted: { title: 'Solicitud Elite enviada', body: 'Se recibió tu solicitud para el programa Elite.' },
  elite_tier_changed: { title: 'Nivel Elite actualizado', body: 'Se actualizó tu estado en el programa Elite.' },
  elite_auto_promoted: { title: 'Nivel Elite mejorado', body: 'Ahora calificas para un nivel Elite superior.' },
  elite_auto_demoted: {
    title: 'Nivel Elite actualizado',
    body: 'Tu nivel Elite cambió porque no se cumplieron los requisitos del nivel anterior durante el periodo de gracia.',
  },
  elite_retention_warning: {
    title: 'Advertencia de retención de nivel Elite',
    body: 'Tu nivel Elite está en riesgo. Cumple los requisitos del nivel antes de que termine el plazo para conservarlo.',
  },
  elite_retention_recovered: {
    title: 'Nivel Elite asegurado',
    body: 'Ahora vuelves a cumplir los requisitos de retención de tu nivel Elite.',
  },
  elite_badge_awarded: { title: 'Nueva insignia Elite', body: 'Obtuviste una nueva insignia en el programa Elite.' },
  elite_badge_auto_awarded: { title: 'Nueva insignia Elite', body: 'Obtuviste una nueva insignia en el programa Elite.' },
  referral_claimed: {
    title: 'Código de referido utilizado',
    body: 'Un nuevo participante usó tu código de referido. La recompensa queda pendiente hasta que se liquide una reserva elegible.',
  },
  referral_qualified: {
    title: 'Referido calificado',
    body: 'Se liquidó una reserva elegible y comenzó el periodo de liberación de la recompensa de referido.',
  },
  referral_reward_available: {
    title: 'Recompensa de referido disponible',
    body: 'La recompensa de referido se añadió a tu billetera tras finalizar el periodo de liberación.',
  },
  referral_revoked: {
    title: 'Recompensa de referido revocada',
    body: 'Se registró la reversión de una recompensa de referido que ya no es elegible.',
  },
  referral_expired: {
    title: 'Referido expirado',
    body: 'El plazo de calificación venció antes de liquidar una reserva elegible.',
  },
  dispute_investigation_started: { title: 'Investigación de disputa iniciada', body: 'El equipo de Latache comenzó a revisar la disputa.' },
  dispute_assignment_updated: { title: 'Responsable de la disputa actualizado', body: 'Se actualizó el responsable encargado de revisar la disputa.' },
  dispute_priority_updated: { title: 'Prioridad de la disputa actualizada', body: 'Se actualizó la prioridad de gestión de la disputa.' },
  dispute_reopened: { title: 'Disputa reabierta', body: 'La disputa fue reabierta para revisión.' },
  dispute_withdrawn: { title: 'Disputa retirada', body: 'La persona que abrió la disputa la retiró.' },
  dispute_comment_added: { title: 'Nuevo comentario en la disputa', body: 'Se añadió un nuevo comentario a la disputa.' },
  dispute_settlement_proposed: { title: 'Acuerdo propuesto', body: 'El equipo de Latache propuso un acuerdo para la disputa.' },
  dispute_settlement_response: { title: 'Respuesta al acuerdo registrada', body: 'Se registró la respuesta de un participante al acuerdo propuesto.' },
  dispute_settlement_proposal_expired: { title: 'Plazo del acuerdo propuesto vencido', body: 'El plazo para responder al acuerdo propuesto venció sin respuesta.' },
  dispute_appealed: { title: 'Disputa apelada', body: 'La disputa se reabrió después de la apelación de un participante.' },
  dispute_evidence_reminder: { title: 'Recordatorio de evidencia', body: 'Se acerca el plazo para enviar la evidencia solicitada.' },
  dispute_evidence_overdue: { title: 'Evidencia solicitada atrasada', body: 'Venció el plazo para enviar la evidencia solicitada.' },
  dispute_evidence_expired: { title: 'Plazo de evidencia vencido', body: 'El plazo de evidencia venció y la disputa fue escalada.' },
  dispute_sla_breached: { title: 'Revisión de disputa escalada', body: 'La disputa superó el plazo de revisión y fue escalada.' },
  dispute_cash_refund_pending: { title: 'Reembolso en efectivo requiere transferencia confirmada', body: 'Se creó un compromiso de reembolso en efectivo manual que aún no se ha registrado como pagado.' },
  dispute_cash_refund_confirmed: { title: 'Reembolso en efectivo confirmado', body: 'Se confirmó la transferencia en efectivo y se registró en el expediente de la disputa.' },
  stripe_chargeback_opened: { title: 'Disputa de pago de Stripe', body: 'Stripe informó una impugnación sobre un pago vinculado a la reserva.' },
  stripe_chargeback_updated: { title: 'Actualización de la disputa de Stripe', body: 'Se actualizó el estado de la disputa de Stripe vinculada a la reserva.' },
  stripe_chargeback_closed: { title: 'Disputa de Stripe cerrada', body: 'Stripe informó el cierre de la disputa de pago vinculada a la reserva.' },
  booking_expired_no_response: {
    title: 'Solicitud de reserva expirada',
    body: 'No hubo respuesta a la solicitud de reserva dentro del plazo, por lo que se canceló automáticamente.',
  },
  booking_reassigned: {
    title: 'Reserva reasignada',
    body: 'El equipo de Latache reasignó esta reserva a otro Tasker.',
  },
  front_door_proof_submitted: {
    title: 'Prueba de llegada enviada',
    body: 'El Tasker adjuntó una foto que prueba su llegada a la puerta. Ya puedes generar el código de inicio.',
  },
  work_start_code_ready: {
    title: 'El cliente generó el código de inicio',
    body: 'Pide al cliente el código de seis dígitos para iniciar el temporizador de la tarea.',
  },
  work_completion_proof_submitted: {
    title: 'Prueba de finalización enviada',
    body: 'El Tasker adjuntó una foto de la tarea terminada. El temporizador facturable se detuvo; genera el código de finalización tras verificar el trabajo.',
  },
  work_completion_code_ready: {
    title: 'El cliente generó el código de finalización',
    body: 'Pide al cliente el código de finalización de seis dígitos para terminar la tarea.',
  },
  task_completion_verified: {
    title: 'Finalización verificada',
    body: 'Se verificó el código de finalización del cliente. Ya puede comenzar el procesamiento del pago final.',
  },
  duration_review_approved: {
    title: 'Extensión de duración aprobada',
    body: 'El cliente aprobó el tiempo adicional y se reintentó el pago final.',
  },
  reschedule_proposal_created: {
    title: 'Nueva propuesta de reprogramación',
    body: 'El Tasker propone mover esta reserva a un nuevo horario. Revisa la propuesta y responde.',
  },
  reschedule_proposal_accepted: {
    title: 'Propuesta de reprogramación aceptada',
    body: 'El cliente aceptó el horario que propusiste. Confirma la reserva.',
  },
  reschedule_proposal_rejected: {
    title: 'Propuesta de reprogramación rechazada',
    body: 'El cliente rechazó tu propuesta de reprogramación.',
  },
  booking_reminder_24h: {
    title: 'Recordatorio: reserva mañana',
    body: 'Tienes una reserva programada para mañana. Revisa los detalles para prepararte.',
  },
  booking_reminder_1h: {
    title: 'Recordatorio: reserva en una hora',
    body: 'Tu reserva programada comienza en aproximadamente una hora.',
  },
  review_request: {
    title: 'Comparte tu opinión',
    body: 'La tarea terminó. Tómate un momento para calificar tu experiencia.',
  },
  booking_payment_captured: { title: 'Reserva confirmada', body: 'Se cobró el pago y tu reserva está confirmada.' },
  booking_payment_captured_tasker: { title: 'El cliente pagó - tarea confirmada', body: 'El cliente completó el pago y la tarea ya está confirmada.' },
  booking_payment_expired: { title: 'Reserva cancelada - pago no completado', body: 'La reserva se canceló porque el pago no se completó a tiempo. No se cobró ningún monto.' },
  booking_payment_expired_tasker: { title: 'Reserva cancelada - el cliente no pagó', body: 'La reserva se canceló porque el cliente no pagó a tiempo, y ese horario está disponible de nuevo.' },
  booking_payment_refunded: { title: 'Pago reembolsado', body: 'La reserva se canceló y el monto pagado se reembolsa por completo al método de pago original.' },
  booking_unused_prepayment_refunded: { title: 'Tiempo no utilizado reembolsado', body: 'La tarea tomó menos tiempo del prepagado; la diferencia se reembolsó al método de pago original.' },
  booking_cash_selected_tasker: { title: 'Tarea confirmada - pago en efectivo', body: 'El cliente eligió pagar en efectivo. Cobra el monto al terminar la tarea.' },
  booking_cash_payment_confirmed: { title: 'Pago en efectivo confirmado', body: 'El Tasker confirmó haber recibido el monto en efectivo por tu tarea terminada.' },
  custom_time_request_created: { title: 'Nueva solicitud de horario personalizado', body: 'Un cliente solicitó un horario fuera de tu disponibilidad. Acepta o rechaza antes de que termine el plazo.' },
  custom_time_request_accepted: { title: 'Horario personalizado aceptado', body: 'El Tasker aceptó el horario solicitado. Completa la reserva antes de que termine el plazo para confirmarla.' },
  custom_time_request_rejected: { title: 'Horario personalizado rechazado', body: 'El Tasker no puede trabajar en ese horario. Elige otro horario o envía una nueva solicitud.' },
  custom_time_request_expired: { title: 'Solicitud de horario personalizado expirada', body: 'El plazo de la solicitud de horario personalizado venció. Puedes enviar una nueva solicitud.' },
  custom_time_request_cancelled: { title: 'El cliente retiró la solicitud de horario personalizado', body: 'El cliente retiró la solicitud de horario personalizado, no se necesita ninguna acción.' },
  tasker_plan_purchased: { title: 'Solicitud de plan recibida', body: 'Se recibió el pago del plan y está en revisión. Los beneficios comienzan tras la aprobación.' },
  tasker_plan_activated: { title: 'Plan activado', body: 'Tu plan ya está activo, con comisión de plataforma reducida, prioridad de visibilidad y una recompensa mensual.' },
  tasker_plan_rejected: { title: 'Plan no aprobado', body: 'La solicitud de plan no fue aprobada y el monto fue reembolsado.' },
  tasker_plan_renewal_failed: { title: 'Fallo en la renovación del plan', body: 'No se pudo renovar tu plan. Los beneficios siguen activos durante un breve periodo de gracia mientras se reintenta.' },
  tasker_plan_expired: { title: 'Plan vencido', body: 'Tu plan venció porque no se pudo cobrar el pago de renovación. Ahora se aplican la comisión y el orden habituales.' },
  tasker_plan_cancelled: { title: 'Plan cancelado', body: 'Tu plan fue cancelado a tu solicitud, y si el pago aún estaba en revisión, fue reembolsado.' },
  tasker_plan_terminated: { title: 'Plan terminado', body: 'El equipo de Latache terminó tu plan y no se renovará.' },
  platform_payable_settlement_completed: { title: 'Se recibió tu pago a Latache', body: 'Tu pago se aplicó a lo adeudado a la plataforma. Abre la billetera para ver el saldo restante.' },
  platform_payable_settlement_rejected: { title: 'No se confirmó tu pago a Latache', body: 'No se pudo confirmar la transferencia declarada. Abre la billetera para ver el motivo.' },
  tasker_plan_revenue_share: { title: 'Participación de ingresos añadida', body: 'La participación de ingresos de tu plan por esta reserva se añadió a tu billetera.' },
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
    if (locale === 'fr' && templateKey && FRENCH_TEMPLATES[templateKey]) {
      return { ...FRENCH_TEMPLATES[templateKey], locale: 'fr', fallback: false };
    }
    if (locale === 'es' && templateKey && SPANISH_TEMPLATES[templateKey]) {
      return { ...SPANISH_TEMPLATES[templateKey], locale: 'es', fallback: false };
    }
    return { ...fallback, locale: 'en', fallback: locale !== 'en' };
  }
}
