'use strict';

/**
 * Arabic / English interface.
 *
 * What is translated: the site itself — buttons, labels, headings, messages,
 * the admin table.
 *
 * What is never REPLACED: anything extracted from the competency PDFs — the
 * form titles, section names, competency item wording, and the M / NM / NA
 * rating codes. Those are the hospital's assessment wording and must read
 * exactly as they do on the paper form, so they are shown with dir="ltr" and
 * stay in front of the reader.
 *
 * Arabic renderings of the items live in data/competencies.ar.json and are
 * shown BESIDE that source wording as a reading aid — under the English item
 * in the exam, and never on the printed form or in a stored submission.
 * Short glosses do the same for the fixed vocabulary (I. KNOWLEDGE, M, NM).
 */

const STRINGS = {
  en: {
    'lang.name': 'English',
    'lang.switchTo': 'العربية',

    'hospital': 'Alhadithah General Hospital',
    'department': 'Nursing Service Department',
    'departmentAssessment': 'Nursing Service Department · Competency Assessment',
    'siteTitle': 'Nursing Competency Exam',
    'adminTitle': 'Competency Records — Admin',

    'nav.admin': 'Admin',
    'nav.nurseSite': 'Nurse site',
    'nav.signOut': 'Sign out',
    'nav.changePassword': 'Change password',
    'nav.leaveExam': 'Leave exam',

    // --- registration ---
    'register.heading': 'Your details',
    'register.hint': 'These appear at the top of every competency form you '
      + 'submit. Enter your job number first — if you have registered before, '
      + 'the rest fills in.',
    'field.jobNumber': 'Job Number',
    'field.name': 'Name',
    'field.jobTitle': 'Job Title',
    'field.unit': 'Unit',
    'field.contractDate': 'Contract Date',
    'field.examDate': 'Date of Exam',
    'register.submit': 'Save and choose a competency',
    'register.welcomeBack': 'Welcome back, {name}.',

    'jobTitle.staffNurse': 'Staff Nurse',
    'jobTitle.chargeNurse': 'Charge Nurse',
    'jobTitle.headNurse': 'Head Nurse',
    'jobTitle.midwife': 'Midwife',
    'jobTitle.supervisor': 'Nursing Supervisor',
    'unit.emergency': 'Emergency',
    'unit.icu': 'ICU',
    'unit.nicu': 'NICU',
    'unit.medical': 'Medical Ward',
    'unit.surgical': 'Surgical Ward',
    'unit.labour': 'Labour & Delivery',
    'unit.paediatrics': 'Paediatrics',
    'unit.theatre': 'Operating Theatre',
    'unit.outpatient': 'Outpatient',

    // --- competency picker ---
    'picker.heading': 'Choose a competency',
    'picker.search': 'Search competencies…',
    'picker.allCategories': 'All categories',
    'picker.empty': 'No competency matches that search.',
    'picker.editDetails': 'Edit my details',
    'picker.who': '{name} · Job number {jobNumber}',
    'picker.itemsSummary': '{count} items · {sections}',
    'picker.retake': 'You already submitted {title} on {date} ({result}).\n\n'
      + 'Take it again? The earlier submission is kept.',

    'category.Mandatory': 'Mandatory',
    'category.Specific': 'Specific',
    'category.General': 'General',

    // --- exam ---
    'exam.loading': 'Loading competency…',
    'exam.reviewAll': 'Review all answers',
    'exam.backToQuestions': 'Back to questions',
    'exam.previous': 'Previous',
    'exam.skip': 'Skip',
    'exam.toReview': 'Review answers',
    'exam.itemPosition': 'Item {no} of {count} in this section '
      + '· question {index} of {total}',
    'exam.progress': '{category} competency · {name} · {answered} of {total} answered',
    'exam.keyHint': 'Keys: {keys} · ←/→ to move',
    'exam.pressKey': 'press {key}',
    'exam.reviewHeading': 'Review your answers',
    'exam.reviewAllDone': 'All items answered. Check them over, then submit.',
    'exam.reviewMissing': '{count} item(s) are still unanswered — click one to go to it.',
    'exam.submit': 'Submit competency',
    'exam.submitting': 'Submitting…',
    'exam.itemsLeft': '{count} item(s) left',
    'exam.hideAid': 'Hide Arabic',
    'exam.showAid': 'Show Arabic',
    'exam.noneSelected': 'No competency selected.',
    'exam.registerFirst': 'Please register your details first.',

    'rating.M': 'Met',
    'rating.NM': 'Not Met',
    'rating.NA': 'Not Applicable',
    'rating.VT': 'Vendor Training',
    'rating.RD': 'Repeat Demonstration',
    'rating.UEC': 'Uses Equipment Competently',

    'section.KNOWLEDGE': 'Knowledge',
    'section.SKILLS': 'Skills',
    'section.ATTITUDE': 'Attitude',
    'section.EQUIPMENT': 'Equipment',

    // --- result ---
    'result.heading': 'Submitted',
    'result.line': '{title} — submitted for {name} on {date}.',
    'result.percent': '% Rating',
    'result.raw': 'Raw Score',
    'result.total': 'Total Score',
    'result.na': 'Not Applicable',
    'result.met': 'Result: Met (90% – 100%). Your evaluator will review and '
      + 'sign the form.',
    'result.notMet': 'Result: Not Met (89% and below). Remedial is required '
      + 'once; your evaluator will set the remedial date.',
    'result.another': 'Take another competency',
    'value.Met': 'Met',
    'value.Not Met': 'Not Met',
    'value.NA': 'Not Applicable',

    // --- admin ---
    'admin.signIn': 'Admin sign in',
    'admin.signInHint': 'Enter the administrator password to view submitted '
      + 'competencies.',
    'admin.password': 'Password',
    'admin.signInButton': 'Sign in',
    'admin.newPasswordPrompt': 'New admin password (at least 6 characters):',
    'admin.passwordUpdated': 'Admin password updated.',

    'admin.heading': 'Submitted competencies',
    'admin.hint': 'Filter the list, fill in the evaluator name and dates, then '
      + 'print the selected records as the hospital\'s competency forms.',
    'admin.stat.submissions': 'Submissions',
    'admin.stat.nurses': 'Nurses',
    'admin.stat.met': 'Met',
    'admin.stat.notMet': 'Not Met',
    'admin.stat.pending': 'Awaiting sign-off',

    'filter.search': 'Search',
    'filter.searchPlaceholder': 'Name, job number, unit, competency',
    'filter.competency': 'Competency',
    'filter.allCompetencies': 'All competencies',
    'filter.category': 'Category',
    'filter.all': 'All',
    'filter.result': 'Result',
    'filter.reviewState': 'Review state',
    'filter.notSignedOff': 'Not signed off',
    'filter.signedOff': 'Signed off',
    'filter.from': 'Exam date from',
    'filter.to': 'Exam date to',
    'filter.clear': 'Clear',

    'table.nurse': 'Nurse',
    'table.jobNo': 'Job No.',
    'table.unit': 'Unit',
    'table.competency': 'Competency',
    'table.category': 'Category',
    'table.score': 'Score',
    'table.percent': '%',
    'table.result': 'Result',
    'table.examDate': 'Exam Date',
    'table.evaluator': 'Evaluator',
    'table.signedOff': 'Signed off',
    'table.selectAll': 'Select all shown',
    'table.details': 'Details',
    'table.print': 'Print',
    'table.empty': 'No submissions match these filters.',
    'table.yes': 'Yes',
    'table.no': 'No',

    'admin.selected': '{count} selected',
    'admin.printSelected': 'Print selected forms',
    'admin.printAll': 'Print all shown',
    'admin.exportCsv': 'Export CSV',
    'admin.showing': 'Showing {shown} of {total} submission(s)',
    'admin.nothingToPrint': 'Nothing to print.',

    'editor.evaluatorName': "Evaluator's Name",
    'editor.evaluatorJob': "Evaluator's Job Number",
    'editor.evaluatedDate': 'Evaluated Date',
    'editor.conformedDate': 'Conformed Date (staff)',
    'editor.needsRemedial': 'Needs Remedial',
    'editor.remedialDate': 'Remedial Date',
    'editor.comments': "Evaluator's Comments / Recommendations",
    'editor.staffComments': 'Staff Nurse Comments',
    'editor.markSignedOff': 'Mark as signed off',
    'editor.save': 'Save',
    'editor.cancel': 'Cancel',
    'editor.delete': 'Delete record',
    'editor.saved': 'Evaluator details saved.',
    'editor.deleted': 'Submission deleted.',
    'editor.confirmDelete': 'Permanently delete {title} for {name}?\n\n'
      + 'This cannot be undone.',
    'editor.subtitle': '{name} · Job number {jobNumber} · {date} · {percent} {result}',
    'editor.yes': 'YES',
    'editor.no': 'NO',

    // --- print ---
    'print.button': 'Print / Save as PDF',
    'print.close': 'Close',
    'print.loading': 'Loading…',
    'print.count': '{count} competency form(s)',
    'print.none': 'No submissions selected.',
    'print.formNote': 'The printed form is reproduced exactly as the '
      + 'hospital\'s paper form.',

    // --- errors ---
    'error.storageSetup': 'This site is not finished setting up. {detail}',
    'error.unreachable': 'Cannot reach the server: {detail}',
    'err.job_number_required': 'Job number is required',
    'err.name_required': 'Name is required',
    'err.unknown_competency': 'No such competency',
    'err.not_registered': 'Register your details before submitting',
    'err.invalid_rating': 'That rating does not belong to this form',
    'err.incomplete': '{count} item(s) still unanswered',
    'err.not_signed_in': 'Not signed in',
    'err.wrong_password': 'Wrong password',
    'err.too_many_attempts': 'Too many attempts. Try again in a minute.',
    'err.not_found': 'Not found',
    'err.password_too_short': 'Password must be at least 6 characters',
    'err.password_from_env': 'The password is set by the ADMIN_PASSWORD '
      + 'environment variable. Change it there and redeploy.',
    'err.no_selection': 'No submissions selected',
    'err.not_registered_yet': 'Not registered yet',
  },

  ar: {
    'lang.name': 'العربية',
    'lang.switchTo': 'English',

    'hospital': 'مستشفى الحديثة العام',
    'department': 'قسم الخدمات التمريضية',
    'departmentAssessment': 'قسم الخدمات التمريضية · تقييم الكفاءة',
    'siteTitle': 'اختبار الكفاءة التمريضية',
    'adminTitle': 'سجلات الكفاءة — الإدارة',

    'nav.admin': 'لوحة الإدارة',
    'nav.nurseSite': 'موقع الممرضين',
    'nav.signOut': 'تسجيل الخروج',
    'nav.changePassword': 'تغيير كلمة المرور',
    'nav.leaveExam': 'مغادرة الاختبار',

    // --- registration ---
    'register.heading': 'بياناتك',
    'register.hint': 'تظهر هذه البيانات في أعلى كل نموذج كفاءة ترسله. أدخل '
      + 'رقمك الوظيفي أولًا — إذا سبق لك التسجيل فستُملأ بقية الحقول تلقائيًا.',
    'field.jobNumber': 'الرقم الوظيفي',
    'field.name': 'الاسم',
    'field.jobTitle': 'المسمى الوظيفي',
    'field.unit': 'الوحدة',
    'field.contractDate': 'تاريخ التعاقد',
    'field.examDate': 'تاريخ الاختبار',
    'register.submit': 'حفظ البيانات واختيار الكفاءة',
    'register.welcomeBack': 'مرحبًا بعودتك، {name}.',

    'jobTitle.staffNurse': 'ممرض/ة',
    'jobTitle.chargeNurse': 'ممرض/ة مسؤول/ة',
    'jobTitle.headNurse': 'رئيس/ة التمريض',
    'jobTitle.midwife': 'قابلة',
    'jobTitle.supervisor': 'مشرف/ة التمريض',
    'unit.emergency': 'الطوارئ',
    'unit.icu': 'العناية المركزة',
    'unit.nicu': 'عناية الأطفال حديثي الولادة',
    'unit.medical': 'الردهة الباطنية',
    'unit.surgical': 'الردهة الجراحية',
    'unit.labour': 'الولادة',
    'unit.paediatrics': 'الأطفال',
    'unit.theatre': 'صالة العمليات',
    'unit.outpatient': 'العيادات الخارجية',

    // --- competency picker ---
    'picker.heading': 'اختر الكفاءة',
    'picker.search': 'ابحث في الكفاءات…',
    'picker.allCategories': 'جميع الفئات',
    'picker.empty': 'لا توجد كفاءة مطابقة لهذا البحث.',
    'picker.editDetails': 'تعديل بياناتي',
    'picker.who': '{name} · الرقم الوظيفي {jobNumber}',
    'picker.itemsSummary': '{count} بندًا · {sections}',
    'picker.retake': 'سبق أن أرسلت {title} بتاريخ {date} ({result}).\n\n'
      + 'هل تريد أداءها مرة أخرى؟ سيبقى الإرسال السابق محفوظًا.',

    'category.Mandatory': 'إلزامية',
    'category.Specific': 'تخصصية',
    'category.General': 'عامة',

    // --- exam ---
    'exam.loading': 'جارٍ تحميل الكفاءة…',
    'exam.reviewAll': 'مراجعة جميع الإجابات',
    'exam.backToQuestions': 'العودة إلى الأسئلة',
    'exam.previous': 'السابق',
    'exam.skip': 'تخطٍ',
    'exam.toReview': 'مراجعة الإجابات',
    'exam.itemPosition': 'البند {no} من {count} في هذا القسم '
      + '· السؤال {index} من {total}',
    'exam.progress': 'كفاءة {category} · {name} · تمت الإجابة على {answered} من {total}',
    'exam.keyHint': 'المفاتيح: {keys} · →/← للتنقل',
    'exam.pressKey': 'اضغط {key}',
    'exam.reviewHeading': 'راجع إجاباتك',
    'exam.reviewAllDone': 'تمت الإجابة على جميع البنود. راجعها ثم أرسِلها.',
    'exam.reviewMissing': 'ما زال {count} بندًا دون إجابة — اضغط على أي بند للانتقال إليه.',
    'exam.submit': 'إرسال الكفاءة',
    'exam.submitting': 'جارٍ الإرسال…',
    'exam.itemsLeft': 'بقي {count} بندًا',
    'exam.hideAid': 'إخفاء العربية',
    'exam.showAid': 'إظهار العربية',
    'exam.noneSelected': 'لم يتم اختيار أي كفاءة.',
    'exam.registerFirst': 'يرجى تسجيل بياناتك أولًا.',

    'rating.M': 'مستوفى',
    'rating.NM': 'غير مستوفى',
    'rating.NA': 'لا ينطبق',
    'rating.VT': 'تدريب من المُورِّد',
    'rating.RD': 'إعادة العرض العملي',
    'rating.UEC': 'يستخدم الجهاز باقتدار',

    'section.KNOWLEDGE': 'المعرفة',
    'section.SKILLS': 'المهارات',
    'section.ATTITUDE': 'السلوك',
    'section.EQUIPMENT': 'الأجهزة',

    // --- result ---
    'result.heading': 'تم الإرسال',
    'result.line': '{title} — أُرسلت باسم {name} بتاريخ {date}.',
    'result.percent': 'النسبة المئوية',
    'result.raw': 'الدرجة الخام',
    'result.total': 'الدرجة الكلية',
    'result.na': 'لا ينطبق',
    'result.met': 'النتيجة: مستوفى (90% – 100%). سيقوم المُقيِّم بالمراجعة '
      + 'وتوقيع النموذج.',
    'result.notMet': 'النتيجة: غير مستوفى (89% فأقل). يلزم إجراء تقييم '
      + 'علاجي مرة واحدة، وسيحدد المُقيِّم تاريخه.',
    'result.another': 'أداء كفاءة أخرى',
    'value.Met': 'مستوفى',
    'value.Not Met': 'غير مستوفى',
    'value.NA': 'لا ينطبق',

    // --- admin ---
    'admin.signIn': 'دخول الإدارة',
    'admin.signInHint': 'أدخل كلمة مرور المسؤول لعرض الكفاءات المُرسَلة.',
    'admin.password': 'كلمة المرور',
    'admin.signInButton': 'تسجيل الدخول',
    'admin.newPasswordPrompt': 'كلمة مرور جديدة للمسؤول (6 أحرف على الأقل):',
    'admin.passwordUpdated': 'تم تحديث كلمة مرور المسؤول.',

    'admin.heading': 'الكفاءات المُرسَلة',
    'admin.hint': 'صفِّ القائمة، وأدخل اسم المُقيِّم والتواريخ، ثم اطبع السجلات '
      + 'المحددة كنماذج الكفاءة المعتمدة في المستشفى.',
    'admin.stat.submissions': 'الإرسالات',
    'admin.stat.nurses': 'الممرضون',
    'admin.stat.met': 'مستوفى',
    'admin.stat.notMet': 'غير مستوفى',
    'admin.stat.pending': 'بانتظار الاعتماد',

    'filter.search': 'بحث',
    'filter.searchPlaceholder': 'الاسم أو الرقم الوظيفي أو الوحدة أو الكفاءة',
    'filter.competency': 'الكفاءة',
    'filter.allCompetencies': 'جميع الكفاءات',
    'filter.category': 'الفئة',
    'filter.all': 'الكل',
    'filter.result': 'النتيجة',
    'filter.reviewState': 'حالة الاعتماد',
    'filter.notSignedOff': 'غير معتمد',
    'filter.signedOff': 'معتمد',
    'filter.from': 'تاريخ الاختبار من',
    'filter.to': 'تاريخ الاختبار إلى',
    'filter.clear': 'مسح',

    'table.nurse': 'الممرض/ة',
    'table.jobNo': 'الرقم الوظيفي',
    'table.unit': 'الوحدة',
    'table.competency': 'الكفاءة',
    'table.category': 'الفئة',
    'table.score': 'الدرجة',
    'table.percent': 'النسبة',
    'table.result': 'النتيجة',
    'table.examDate': 'تاريخ الاختبار',
    'table.evaluator': 'المُقيِّم',
    'table.signedOff': 'معتمد',
    'table.selectAll': 'تحديد كل المعروض',
    'table.details': 'التفاصيل',
    'table.print': 'طباعة',
    'table.empty': 'لا توجد سجلات مطابقة لهذه المرشحات.',
    'table.yes': 'نعم',
    'table.no': 'لا',

    'admin.selected': 'تم تحديد {count}',
    'admin.printSelected': 'طباعة النماذج المحددة',
    'admin.printAll': 'طباعة كل المعروض',
    'admin.exportCsv': 'تصدير CSV',
    'admin.showing': 'عرض {shown} من {total} سجل',
    'admin.nothingToPrint': 'لا يوجد ما يُطبع.',

    'editor.evaluatorName': 'اسم المُقيِّم',
    'editor.evaluatorJob': 'الرقم الوظيفي للمُقيِّم',
    'editor.evaluatedDate': 'تاريخ التقييم',
    'editor.conformedDate': 'تاريخ إقرار الموظف',
    'editor.needsRemedial': 'يحتاج تقييمًا علاجيًا',
    'editor.remedialDate': 'تاريخ التقييم العلاجي',
    'editor.comments': 'ملاحظات وتوصيات المُقيِّم',
    'editor.staffComments': 'ملاحظات الممرض/ة',
    'editor.markSignedOff': 'وضع علامة معتمد',
    'editor.save': 'حفظ',
    'editor.cancel': 'إلغاء',
    'editor.delete': 'حذف السجل',
    'editor.saved': 'تم حفظ بيانات المُقيِّم.',
    'editor.deleted': 'تم حذف السجل.',
    'editor.confirmDelete': 'هل تريد حذف {title} الخاصة بـ {name} نهائيًا؟\n\n'
      + 'لا يمكن التراجع عن هذا الإجراء.',
    'editor.subtitle': '{name} · الرقم الوظيفي {jobNumber} · {date} · {percent} {result}',
    'editor.yes': 'نعم',
    'editor.no': 'لا',

    // --- print ---
    'print.button': 'طباعة / حفظ PDF',
    'print.close': 'إغلاق',
    'print.loading': 'جارٍ التحميل…',
    'print.count': '{count} نموذج كفاءة',
    'print.none': 'لم يتم اختيار أي سجل.',
    'print.formNote': 'النموذج المطبوع مطابق تمامًا للنموذج الورقي المعتمد '
      + 'في المستشفى.',

    // --- errors ---
    'error.storageSetup': 'لم يكتمل إعداد هذا الموقع بعد. {detail}',
    'error.unreachable': 'تعذّر الوصول إلى الخادم: {detail}',
    'err.job_number_required': 'الرقم الوظيفي مطلوب',
    'err.name_required': 'الاسم مطلوب',
    'err.unknown_competency': 'لا توجد كفاءة بهذا الاسم',
    'err.not_registered': 'سجّل بياناتك قبل الإرسال',
    'err.invalid_rating': 'هذا التقدير لا ينتمي إلى هذا النموذج',
    'err.incomplete': 'ما زال {count} بندًا دون إجابة',
    'err.not_signed_in': 'لم يتم تسجيل الدخول',
    'err.wrong_password': 'كلمة المرور غير صحيحة',
    'err.too_many_attempts': 'محاولات كثيرة. حاول مرة أخرى بعد دقيقة.',
    'err.not_found': 'غير موجود',
    'err.password_too_short': 'يجب ألا تقل كلمة المرور عن 6 أحرف',
    'err.password_from_env': 'كلمة المرور محددة عبر متغير البيئة '
      + 'ADMIN_PASSWORD. غيّرها هناك ثم أعد النشر.',
    'err.no_selection': 'لم يتم اختيار أي سجل',
    'err.not_registered_yet': 'غير مسجَّل بعد',
  },
};

const STORAGE_KEY = 'competency.lang';
const DEFAULT_LANG = 'ar';

let current = DEFAULT_LANG;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && STRINGS[saved]) current = saved;
} catch { /* storage blocked — fall back to the default */ }

function lang() {
  return current;
}

function isRtl() {
  return current === 'ar';
}

/** Translate a key, filling {placeholders} from vars. */
function t(key, vars) {
  let text = STRINGS[current][key];
  if (text === undefined) text = STRINGS.en[key];
  if (text === undefined) return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    (name in vars ? String(vars[name]) : whole));
}

/** An API error carries a code; fall back to the server's English message. */
function translateError(error) {
  const code = error?.code;
  if (code && STRINGS[current][`err.${code}`]) {
    return t(`err.${code}`, error.details || {});
  }
  return error?.message || t('err.not_found');
}

/**
 * Competency wording comes from the PDFs and is always English, so it needs
 * an explicit direction to render correctly inside an Arabic page.
 */
function sourceText(node) {
  if (node && isRtl()) {
    node.setAttribute('dir', 'ltr');
    node.classList.add('source-text');
  }
  return node;
}

/** A short Arabic reading aid for fixed form vocabulary; never a replacement. */
function gloss(key) {
  if (!isRtl()) return '';
  const value = STRINGS.ar[key];
  return value && value !== STRINGS.en[key] ? value : '';
}

function applyTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of root.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
  }
  for (const node of root.querySelectorAll('[data-i18n-html]')) {
    node.innerHTML = t(node.dataset.i18nHtml);
  }
}

function applyDirection() {
  const html = document.documentElement;
  html.lang = current;
  html.dir = isRtl() ? 'rtl' : 'ltr';
}

function setLang(next) {
  if (!STRINGS[next]) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  location.reload();
}

/** Adds the language toggle to a top bar. */
function mountLanguageToggle(container) {
  if (!container) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lang-toggle';
  button.textContent = t('lang.switchTo');
  button.setAttribute('lang', isRtl() ? 'en' : 'ar');
  button.addEventListener('click', () => setLang(isRtl() ? 'en' : 'ar'));
  container.append(button);
}

applyDirection();
document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
  applyDirection();
});
