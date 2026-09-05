-- ============================================================
-- YBS SYSTEM: MASTER CLIENT INTAKE & COACHING ASSESSMENT TEMPLATE
-- Migration: 20260906000001_seed_master_intake_template.sql
-- Idempotent seed migration for the Master Intake Template
-- ============================================================

DO $$
DECLARE
  v_template_id UUID := '00000000-0000-0000-0000-000000000101'::uuid;
  v_count INTEGER;
BEGIN
  -- 1. Insert or update the Master Intake Template (Global: workspace_id IS NULL)
  IF EXISTS (SELECT 1 FROM public.assessment_templates WHERE id = v_template_id OR name = 'استمارة التقييم الأولي وبناء الخطة') THEN
    SELECT id INTO v_template_id FROM public.assessment_templates WHERE id = v_template_id OR name = 'استمارة التقييم الأولي وبناء الخطة' LIMIT 1;
    
    UPDATE public.assessment_templates
    SET
      name = 'استمارة التقييم الأولي وبناء الخطة',
      description = 'الاستمارة دي بتساعد المدرب يفهم حالتك، هدفك، نمط حياتك، خبرتك في التدريب، تفضيلاتك الغذائية، والقيود الموجودة عندك علشان يقدر يبني لك خطة تدريب وتغذية مناسبة.',
      status = 'published',
      is_active = true,
      is_archived = false,
      updated_at = now()
    WHERE id = v_template_id;

    -- Clear existing questions for clean idempotent recreation
    DELETE FROM public.assessment_questions WHERE template_id = v_template_id;
  ELSE
    INSERT INTO public.assessment_templates (
      id,
      workspace_id,
      name,
      description,
      status,
      is_active,
      is_archived,
      created_at,
      updated_at
    ) VALUES (
      v_template_id,
      NULL,
      'استمارة التقييم الأولي وبناء الخطة',
      'الاستمارة دي بتساعد المدرب يفهم حالتك، هدفك، نمط حياتك، خبرتك في التدريب، تفضيلاتك الغذائية، والقيود الموجودة عندك علشان يقدر يبني لك خطة تدريب وتغذية مناسبة.',
      'published',
      true,
      false,
      now(),
      now()
    );
  END IF;

  -- 2. Insert the Master Intake Questions
  -- Section 1: البيانات الأساسية
  INSERT INTO public.assessment_questions (template_id, sort_order, question_type, label, description, required, options, conditional_rules)
  VALUES
  (v_template_id, 0, 'short_answer', 'الاسم الكامل', 'Full Name', true, '{}', '{"section": "البيانات الأساسية"}'::jsonb),
  (v_template_id, 1, 'short_answer', 'البريد الإلكتروني', 'Email', true, '{}', '{"section": "البيانات الأساسية"}'::jsonb),
  (v_template_id, 2, 'short_answer', 'رقم الهاتف / WhatsApp', 'Phone / WhatsApp', true, '{}', '{"section": "البيانات الأساسية"}'::jsonb),
  (v_template_id, 3, 'number', 'العمر', 'العمر بالسنوات', true, '{}', '{"section": "البيانات الأساسية"}'::jsonb),
  (v_template_id, 4, 'short_answer', 'البلد / المحافظة', NULL, true, '{}', '{"section": "البيانات الأساسية"}'::jsonb),

  -- Section 2: بيانات الجسم الحالية
  (v_template_id, 5, 'number', 'وزنك الحالي (كجم)', NULL, true, '{}', '{"section": "بيانات الجسم الحالية"}'::jsonb),
  (v_template_id, 6, 'number', 'الطول (سم)', NULL, true, '{}', '{"section": "بيانات الجسم الحالية"}'::jsonb),
  (v_template_id, 7, 'single_choice', 'هل لديك تقرير InBody حديث؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "بيانات الجسم الحالية"}'::jsonb),
  (v_template_id, 8, 'file_upload', 'برجاء إرفاق أحدث تقرير InBody', 'PDF / JPG / PNG / ملفات الصور الشائعة (في حال اختيار نعم)', false, '{}', '{"section": "بيانات الجسم الحالية"}'::jsonb),
  (v_template_id, 9, 'single_choice', 'هل لديك قياسات جسم حالية؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "بيانات الجسم الحالية"}'::jsonb),
  (v_template_id, 10, 'long_answer', 'القياسات المتاحة لديك', 'اكتب القياسات المتاحة لديك، مثل: محيط الخصر، الصدر، الذراع، الفخذ، إلخ. (في حال اختيار نعم)', false, '{}', '{"section": "بيانات الجسم الحالية"}'::jsonb),
  (v_template_id, 11, 'single_choice', 'هل تستطيع إرسال صور Progress Photos؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "بيانات الجسم الحالية"}'::jsonb),
  (v_template_id, 12, 'image_upload', 'رفع صور البداية (Progress Photos)', 'أمامي، جانبي، خلفي — ويفضل صور Relaxed وصور Flexed بإضاءة واضحة (في حال اختيار نعم)', false, '{}', '{"section": "بيانات الجسم الحالية"}'::jsonb),

  -- Section 3: هدفك من المتابعة
  (v_template_id, 13, 'multiple_choice', 'ما هدفك الأساسي من التمرين والمتابعة؟', NULL, true, ARRAY[
    'البناء العضلي وزيادة الكتلة العضلية',
    'خسارة الدهون',
    'خسارة الدهون مع الحفاظ أو زيادة الكتلة العضلية',
    'زيادة القوة',
    'تحسين شكل الجسم / Body Recomposition',
    'تحسين اللياقة والصحة العامة',
    'تحسين الأداء والقدرة على ممارسة الأنشطة اليومية',
    'تحسين المرونة والثبات والحركة',
    'زيادة الوزن',
    'هدف آخر'
  ], '{"section": "هدفك من المتابعة"}'::jsonb),
  (v_template_id, 14, 'long_answer', 'اذكر هدفك بالتفصيل (في حال اختيار هدف آخر)', NULL, false, '{}', '{"section": "هدفك من المتابعة"}'::jsonb),
  (v_template_id, 15, 'long_answer', 'ما هدفك على المدى القريب؟', 'إيه أهم حاجة حابب تحققها خلال الفترة الجاية؟', true, '{}', '{"section": "هدفك من المتابعة"}'::jsonb),
  (v_template_id, 16, 'long_answer', 'ما هدفك على المدى البعيد؟', 'إيه الشكل أو المستوى اللي نفسك توصله على المدى البعيد؟', true, '{}', '{"section": "هدفك من المتابعة"}'::jsonb),
  (v_template_id, 17, 'long_answer', 'هل عندك نقاط ضعف معينة حابب نركز عليها؟', 'هل شايف إن عندك نقاط ضعف عضلية أو شكلية معينة حابب نركز عليها؟', false, '{}', '{"section": "هدفك من المتابعة"}'::jsonb),

  -- Section 4: الصحة والإصابات
  (v_template_id, 18, 'single_choice', 'هل لديك أي أمراض مزمنة أو حالات صحية يجب أن نعرفها؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 19, 'long_answer', 'تفاصيل الحالة الصحية المزمنة', 'اذكر الحالة الصحية بالتفصيل، وأي تعليمات أو قيود وضعها الطبيب بخصوص التمرين (في حال اختيار نعم).', false, '{}', '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 20, 'single_choice', 'هل تتناول أي أدوية حاليًا؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 21, 'long_answer', 'تفاصيل الأدوية الحالية', 'اذكر اسم الدواء، الجرعة، وسبب استخدامه (في حال اختيار نعم).', false, '{}', '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 22, 'single_choice', 'هل لديك إصابة حالية أو إصابة سابقة مهمة؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 23, 'long_answer', 'تفاصيل الإصابة', 'اذكر الإصابة، مكانها، متى حدثت، وهل ما زالت تسبب ألمًا أو تحد من الحركة/التمرين؟ (في حال اختيار نعم).', false, '{}', '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 24, 'long_answer', 'هل يوجد تمرين أو حركة معينة تسبب لك ألمًا؟', 'هل يوجد تمرين أو حركة معينة تسبب لك ألمًا أو تكون غير مريحة حتى مع أداء التمرين بتكنيك صحيح؟', true, '{}', '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 25, 'single_choice', 'هل لديك أي حساسية غذائية أو عدم تحمل لطعام معين؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 26, 'long_answer', 'تفاصيل الحساسية الغذائية', 'اذكر الأطعمة والحساسية/المشكلة التي تحدث لك (في حال اختيار نعم).', false, '{}', '{"section": "الصحة والإصابات"}'::jsonb),
  -- PAR-Q Questions
  (v_template_id, 27, 'single_choice', 'هل أخبرك طبيب من قبل أن لديك مشكلة بالقلب وأنك يجب أن تمارس النشاط البدني فقط وفق توصيته؟', 'PAR-Q', true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 28, 'single_choice', 'هل تشعر بألم في الصدر أثناء النشاط البدني؟', 'PAR-Q', true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 29, 'single_choice', 'هل شعرت خلال الفترة الأخيرة بألم في الصدر أثناء النشاط البدني؟', 'PAR-Q', true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 30, 'single_choice', 'هل تفقد توازنك بسبب الدوخة أو سبق أن فقدت الوعي؟', 'PAR-Q', true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 31, 'single_choice', 'هل لديك مشكلة في العظام أو المفاصل قد تزداد مع زيادة النشاط البدني؟', 'PAR-Q', true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 32, 'single_choice', 'هل يوجد سبب صحي آخر قد يمنعك أو يحد من قدرتك على ممارسة النشاط البدني؟', 'PAR-Q', true, ARRAY['نعم', 'لا'], '{"section": "الصحة والإصابات"}'::jsonb),
  (v_template_id, 33, 'long_answer', 'اشرح السبب الصحي بالتفصيل (في حال اختيار نعم)', NULL, false, '{}', '{"section": "الصحة والإصابات"}'::jsonb),

  -- Section 5: خبرتك في التدريب
  (v_template_id, 34, 'single_choice', 'بقالك قد إيه بتتمرن؟', NULL, true, ARRAY['أول مرة', 'أقل من 6 شهور', '6 شهور إلى سنة', 'أكثر من سنة', 'أكثر من سنتين', 'فترات متقطعة'], '{"section": "خبرتك في التدريب"}'::jsonb),
  (v_template_id, 35, 'single_choice', 'خلال الفترة اللي تمرنت فيها، كنت منتظم قد إيه؟', NULL, true, ARRAY['منتظم جدًا', 'منتظم إلى حد كبير', 'فترات منتظمة وفترات انقطاع', 'غير منتظم'], '{"section": "خبرتك في التدريب"}'::jsonb),
  (v_template_id, 36, 'single_choice', 'هل تتمرن حاليًا؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "خبرتك في التدريب"}'::jsonb),
  (v_template_id, 37, 'short_answer', 'لو بتتمرن حاليًا، إيه الـ Split / النظام اللي ماشي عليه؟', NULL, false, '{}', '{"section": "خبرتك في التدريب"}'::jsonb),
  (v_template_id, 38, 'file_upload', 'لو عندك برنامج تمرين حالي، ارفعه أو شاركه', 'PDF / صورة / مستند', false, '{}', '{"section": "خبرتك في التدريب"}'::jsonb),
  (v_template_id, 39, 'single_choice', 'في المتوسط، كنت بتلعب كام Set لكل Muscle Group في الأسبوع؟', NULL, false, ARRAY['2–4', '4–6', '6–8', '8–12', '12–15', '15–20', 'أكثر من 20', 'لا أعرف'], '{"section": "خبرتك في التدريب"}'::jsonb),
  (v_template_id, 40, 'single_choice', 'تقييمك لمستواك الحالي؟', NULL, true, ARRAY['مبتدئ', 'متوسط', 'فوق المتوسط', 'متقدم', 'مش متأكد'], '{"section": "خبرتك في التدريب"}'::jsonb),
  (v_template_id, 41, 'single_choice', 'هل تعرف مفهوم RIR / Reps In Reserve؟', NULL, true, ARRAY['لا أعرفه', 'أعرفه لكن مش واثق في تقديره', 'أقدر أقدّر RIR بشكل جيد', 'غالبًا أتمرن قريب جدًا من الفشل', 'غالبًا أصل للفشل العضلي'], '{"section": "خبرتك في التدريب"}'::jsonb),

  -- Section 6: وقتك وجدول التمرين
  (v_template_id, 42, 'single_choice', 'أقل عدد أيام تقدر تلتزم فيه بالتمرين أسبوعيًا بشكل واقعي؟', 'المطلوب هو الحد الأدنى الواقعي وليس المثالي', true, ARRAY['يومين', '3 أيام', '4 أيام', '5 أيام', '6 أيام', 'أكثر من ذلك'], '{"section": "وقتك وجدول التمرين"}'::jsonb),
  (v_template_id, 43, 'multiple_choice', 'هل لديك أيام معينة فقط تستطيع التدريب فيها؟', NULL, true, ARRAY['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'لا يوجد أيام محددة'], '{"section": "وقتك وجدول التمرين"}'::jsonb),
  (v_template_id, 44, 'single_choice', 'في الغالب تقدر تتمرن في أي وقت؟', NULL, true, ARRAY['صباحًا', 'ظهرًا', 'عصرًا', 'مساءً', 'الوقت يختلف'], '{"section": "وقتك وجدول التمرين"}'::jsonb),
  (v_template_id, 45, 'single_choice', 'أقصى وقت تقدر تقضيه في الحصة التدريبية؟', NULL, true, ARRAY['أقل من 30 دقيقة', '30–45 دقيقة', '45–60 دقيقة', '60–90 دقيقة', 'أكثر من 90 دقيقة'], '{"section": "وقتك وجدول التمرين"}'::jsonb),

  -- Section 7: الجيم والمعدات
  (v_template_id, 46, 'single_choice', 'هتتمرن فين؟', NULL, true, ARRAY['Gym', 'Home', 'الاثنين'], '{"section": "الجيم والمعدات"}'::jsonb),
  (v_template_id, 47, 'single_choice', 'هل تستطيع إرسال صور واضحة لمعدات الجيم المتاحة؟', NULL, true, ARRAY['نعم', 'لا', 'هبعتها لاحقًا'], '{"section": "الجيم والمعدات"}'::jsonb),
  (v_template_id, 48, 'file_upload', 'صور الأجهزة والمعدات المتاحة في الجيم', 'ارفع صور واضحة للأجهزة والمعدات المتاحة في الجيم (في حال اختيار نعم)', false, '{}', '{"section": "الجيم والمعدات"}'::jsonb),
  (v_template_id, 49, 'long_answer', 'هل يوجد أي قيود في الجيم يجب أن نعرفها؟', 'أمثلة: عدم إمكانية تحريك Bench، نقص أجهزة معينة، ازدحام في أوقات معينة، معدات غير متاحة دائمًا.', false, '{}', '{"section": "الجيم والمعدات"}'::jsonb),
  (v_template_id, 50, 'long_answer', 'هل يوجد تمرين معين تحبه جدًا وتريد وجوده في البرنامج؟', NULL, false, '{}', '{"section": "الجيم والمعدات"}'::jsonb),
  (v_template_id, 51, 'long_answer', 'هل يوجد تمرين معين تكرهه أو لا تريد وجوده في البرنامج؟', NULL, false, '{}', '{"section": "الجيم والمعدات"}'::jsonb),
  (v_template_id, 52, 'long_answer', 'هل لديك Split معينة أو أسلوب تدريب معين تحب تجربته؟', 'ملاحظة: هذا تفضيل شخصي يسترشد به المدرب وليس ضمانًا لاعتماده بالكامل.', false, '{}', '{"section": "الجيم والمعدات"}'::jsonb),

  -- Section 8: نمط حياتك
  (v_template_id, 53, 'long_answer', 'ما طبيعة عملك أو دراستك؟', NULL, true, '{}', '{"section": "نمط حياتك"}'::jsonb),
  (v_template_id, 54, 'number', 'متوسط خطواتك اليومية تقريبًا؟', 'لو مش متأكد اكتب 0 أو القيمة التقريبية', true, '{}', '{"section": "نمط حياتك"}'::jsonb),
  (v_template_id, 55, 'long_answer', 'هل تمارس أي نشاط أو رياضة أخرى غير الجيم؟', 'أمثلة: المشي، السباحة، كرة القدم، الجري، ركوب الدراجة، إلخ.', true, '{}', '{"section": "نمط حياتك"}'::jsonb),
  (v_template_id, 56, 'long_answer', 'احكي لنا يومك الطبيعي من وقت ما تصحى لحد ما تنام', 'احكي بشكل مختصر عن يومك الطبيعي: الشغل/الدراسة، الحركة، التمرين، الوجبات، وأي نشاط مهم.', true, '{}', '{"section": "نمط حياتك"}'::jsonb),
  (v_template_id, 57, 'number', 'متوسط عدد ساعات نومك؟', NULL, true, '{}', '{"section": "نمط حياتك"}'::jsonb),
  (v_template_id, 58, 'short_answer', 'مواعيد نومك واستيقاظك غالبًا؟', NULL, true, '{}', '{"section": "نمط حياتك"}'::jsonb),
  (v_template_id, 59, 'single_choice', 'قيّم مستوى الضغط والإجهاد في حياتك حاليًا من 1 إلى 10', NULL, true, ARRAY['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], '{"section": "نمط حياتك"}'::jsonb),

  -- Section 9: عاداتك الغذائية
  (v_template_id, 60, 'single_choice', 'هل جربت تعمل Diet قبل كده؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 61, 'long_answer', 'إيه أكتر سبب خلاك ما تكملش أو توقف النظام السابق؟', 'في حال اختيار نعم لسؤال الدايت السابق', false, '{}', '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 62, 'long_answer', 'احكي لنا بشكل تقريبي بتاكل إيه في يوم عادي', 'من أول ما تصحى لحد ما تنام، اذكر الوجبات والمشروبات والكميات التقريبية لو تقدر.', true, '{}', '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 63, 'long_answer', 'إيه الأكلات اللي بتحبها جدًا وعايز تدخلها في النظام؟', NULL, true, '{}', '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 64, 'long_answer', 'إيه الأكلات اللي مش بتحبها أو مستحيل تاكلها؟', NULL, true, '{}', '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 65, 'single_choice', 'تفضل كام وجبة في اليوم؟', NULL, true, ARRAY['2', '3', '4', '5', 'لا يفرق معي'], '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 66, 'single_choice', 'هل عندك أطعمة معينة تسبب لك مشاكل هضمية؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 67, 'long_answer', 'اذكر الأطعمة والمشكلة الهضمية التي تحدث', 'في حال اختيار نعم', false, '{}', '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 68, 'single_choice', 'هل بتاكل من بره البيت بشكل متكرر؟', NULL, true, ARRAY['نادرًا', '1–2 مرة أسبوعيًا', '3–4 مرات أسبوعيًا', 'شبه يومي'], '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 69, 'long_answer', 'إيه نوع الأكل اللي غالبًا بتطلبه؟', 'في حال تناول الطعام بالخارج بانتظام', false, '{}', '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 70, 'single_choice', 'هل بتحضر أكلك بنفسك؟', NULL, true, ARRAY['نعم', 'أحيانًا', 'لا'], '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 71, 'single_choice', 'ما مدى قدرتك على الالتزام بتحضير ووزن الطعام؟', NULL, true, ARRAY['أقدر أوزن كل حاجة', 'أقدر أوزن أغلب الأكل', 'أقدر ألتزم بشكل تقريبي', 'صعب عليّ وزن الأكل'], '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 72, 'single_choice', 'هل تفضل وزن الطعام قبل الطبخ أم بعده؟', NULL, true, ARRAY['قبل الطبخ', 'بعد الطبخ', 'لا أعرف / المدرب يحدد'], '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 73, 'single_choice', 'هل لديك ميزانية محددة تقريبًا للأكل؟', NULL, false, ARRAY['محدودة', 'متوسطة', 'مريحة', 'مفتوحة', 'أفضل عدم تحديدها'], '{"section": "عاداتك الغذائية"}'::jsonb),
  (v_template_id, 74, 'short_answer', 'لو حابب، اذكر ميزانية تقريبية للأكل شهريًا', NULL, false, '{}', '{"section": "عاداتك الغذائية"}'::jsonb),

  -- Section 10: تفضيلات الأكل
  (v_template_id, 75, 'multiple_choice', 'مصادر البروتين المفضلة لديك؟', NULL, true, ARRAY['دجاج', 'لحوم حمراء', 'أسماك', 'تونة', 'بيض', 'جبنة قريش / منتجات ألبان', 'Whey Protein', 'لحوم أعضاء مثل الكبد', 'مصادر نباتية', 'أخرى'], '{"section": "تفضيلات الأكل"}'::jsonb),
  (v_template_id, 76, 'multiple_choice', 'مصادر الكربوهيدرات المفضلة لديك؟', NULL, true, ARRAY['أرز', 'بطاطس', 'بطاطا', 'مكرونة', 'شوفان', 'عيش / خبز', 'توست', 'كورن فليكس', 'بليلة', 'Cream of Rice', 'أخرى'], '{"section": "تفضيلات الأكل"}'::jsonb),
  (v_template_id, 77, 'long_answer', 'هل يوجد Snack معين تحس إنك محتاجه خلال اليوم؟', NULL, false, '{}', '{"section": "تفضيلات الأكل"}'::jsonb),
  (v_template_id, 78, 'long_answer', 'هل عندك وجبات معينة تحب تكون موجودة بشكل متكرر في النظام؟', NULL, false, '{}', '{"section": "تفضيلات الأكل"}'::jsonb),

  -- Section 11: المياه والمكملات
  (v_template_id, 79, 'short_answer', 'متوسط استهلاكك للمياه يوميًا؟', 'باللتر أو الأكواب أو لا أعرف', true, '{}', '{"section": "المياه والمكملات"}'::jsonb),
  (v_template_id, 80, 'single_choice', 'هل تستخدم حاليًا أي Supplements أو Vitamins؟', NULL, true, ARRAY['نعم', 'لا'], '{"section": "المياه والمكملات"}'::jsonb),
  (v_template_id, 81, 'long_answer', 'تفاصيل المكملات والفيتامينات الحالية', 'اكتب اسم كل مكمل/فيتامين تستخدمه حاليًا، ولو تعرف الجرعة اكتبها (في حال اختيار نعم).', false, '{}', '{"section": "المياه والمكملات"}'::jsonb),
  (v_template_id, 82, 'single_choice', 'هل لديك أي مانع من استخدام Supplements إذا احتجناها؟', NULL, true, ARRAY['لا يوجد مانع', 'أفضل عدم استخدامها', 'أحتاج معرفة السبب والفائدة أولًا', 'الميزانية قد تكون عائقًا'], '{"section": "المياه والمكملات"}'::jsonb),

  -- Section 12: توقعاتك من المتابعة
  (v_template_id, 83, 'long_answer', 'إيه أكتر حاجة محتاج مساعدة فيها ومش قادر تعملها لوحدك؟', NULL, true, '{}', '{"section": "توقعاتك من المتابعة"}'::jsonb),
  (v_template_id, 84, 'long_answer', 'هل يوجد أي شيء آخر مهم عنك أو عن ظروفك لازم المدرب يعرفه قبل بناء الخطة؟', NULL, false, '{}', '{"section": "توقعاتك من المتابعة"}'::jsonb),

  -- Form Completion / Consent
  (v_template_id, 85, 'multiple_choice', 'مراجعة البيانات والإقرار', 'راجع إجاباتك قبل الإرسال. البيانات دي هتستخدم لمساعدة المدرب في بناء خطة التدريب والتغذية المناسبة لك.', true, ARRAY['أؤكد أن المعلومات التي قدمتها صحيحة قدر الإمكان، وأنني سأبلغ المدرب عن أي حالة صحية أو إصابة أو قيود مهمة تؤثر على قدرتي على ممارسة النشاط البدني.'], '{"section": "مراجعة البيانات"}'::jsonb);

  -- 3. Assign this Master Template to all active workspaces so trainers immediately have access
  INSERT INTO public.form_template_workspace_assignment (template_id, workspace_id)
  SELECT v_template_id, w.id
  FROM public.workspaces w
  WHERE w.status = 'active'
  ON CONFLICT (template_id, workspace_id) DO NOTHING;

END $$;
