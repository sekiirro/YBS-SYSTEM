-- ============================================================
-- YBS SYSTEM: IMPORT EXERCISE LIBRARY -> "YBS Default Workspace"
-- Migration: 20260910000002_import_youtube_exercise_library_ybs.sql
--
-- Imports the supplemental YouTube exercise collection (56 rows:
-- Chest / Back / Traps & Shoulders / Biceps / Triceps / Core /
-- Forearms / Rotator Cuff / Legs / Smith-Chest) into the existing
-- Workspace "YBS Default Workspace" (resolved at runtime by exact name).
--
-- SOURCE ROWS: 56   (all rows carry a YouTube video URL)
--
-- GUARANTEES
--  * Target ONLY the Workspace whose name is exactly 'YBS Default Workspace'.
--      - The target is resolved AT RUNTIME by exact name match on
--        public.workspaces. It is never the logged-in workspace, the
--        first workspace returned, or any hardcoded assumption.
--      - If zero or more than one Workspace named "YBS Default Workspace"
--        exists, the whole script ABORTS with an exception and inserts
--        NOTHING.
--      - The resolved workspace_id is stored once and reused for
--        every dedupe check, backfill and insert.
--  * Idempotent — re-running inserts nothing and re-updates nothing.
--  * Duplicate protection — each row is matched against the existing
--    YBS Default Workspace library by normalized name (active OR
--    archived rows).
--      - No match               -> INSERT (name, video_url, category,
--                                  muscle_group, equipment).
--      - Match + missing URL    -> UPDATE video_url ONLY (backfill).
--      - Match + URL present    -> LEFT UNTOUCHED (never overwrites an
--                                  existing video with a new one).
--  * Every inserted row has workspace_id = the resolved YBS workspace id.
--    NO NULLs, NO other workspaces touched.
--  * No URL is invented or rewritten; each supplied YouTube URL is
--    stored verbatim.
--  * No exercise record is deleted; existing rows are only touched
--    when they are missing a video_url (backfill only).
-- ============================================================

DO $$
DECLARE
  v_ws_id        UUID;
  v_ws_name      TEXT;
  v_ws_slug      TEXT;
  v_exact_count  INTEGER;
  v_src_rows     INTEGER;
  v_existing     INTEGER;   -- source rows already present (by name)
  v_missing_url  INTEGER;   -- existing matches lacking a video_url
  v_backfilled   INTEGER;   -- existing matches whose URL was backfilled
  v_inserted     INTEGER;
BEGIN
  -- ================================================================
  -- 1. RESOLVE the "YBS Default Workspace" workspace (exact name).
  --    Aborts on zero or multiple matches — no guessing, no partial
  --    import (the whole script rolls back on this exception).
  -- ================================================================
  SELECT count(*) INTO v_exact_count
  FROM public.workspaces WHERE name = 'YBS Default Workspace';

  IF v_exact_count = 0 THEN
    RAISE EXCEPTION 'Import ABORTED: Workspace "YBS Default Workspace" not found. No rows inserted.';
  ELSIF v_exact_count > 1 THEN
    RAISE EXCEPTION 'Import ABORTED: more than one Workspace named "YBS Default Workspace". Resolve manually.';
  END IF;

  SELECT id, name, slug INTO v_ws_id, v_ws_name, v_ws_slug
  FROM public.workspaces WHERE name = 'YBS Default Workspace';

  RAISE NOTICE 'Target workspace resolved: name=%, id=%, slug=%', v_ws_name, v_ws_id, v_ws_slug;

  -- ================================================================
  -- 2. LOAD SOURCE ROWS (temporary, session-scoped)
  --    Columns: norm_name (index key), ex_name (as supplied),
  --    muscle_group, category (CHECK-enum), equipment, ex_url.
  -- ================================================================
  CREATE TEMP TABLE _yt_src (
    src_ord      INTEGER PRIMARY KEY,
    norm_name    TEXT NOT NULL,
    ex_name      TEXT NOT NULL,
    ex_muscle    TEXT NOT NULL,
    ex_category  TEXT NOT NULL,
    ex_equipment TEXT,
    ex_url       TEXT NOT NULL DEFAULT ''
  ) ON COMMIT DROP;

  INSERT INTO _yt_src (src_ord, norm_name, ex_name, ex_muscle, ex_category, ex_equipment, ex_url)
  VALUES
  -- CHEST
  (1,  'incline db chest press 30–45', 'Incline DB Chest Press 30–45',             'Upper Chest',   'chest',     'Dumbbells, Incline Bench', 'https://youtube.com/shorts/ou6s32mJgjU?si=iaDo3EC8UhNVVEZC'),
  (2,  'db flat chest press',          'DB Flat Chest Press',                      'Mid Chest',     'chest',     'Dumbbells, Bench',         'https://youtube.com/shorts/z6A4W5Dib28?si=8_diRUEegWaLJJXf'),
  (3,  'flat chest press machine',     'Flat Chest Press Machine',                 'Mid Chest',     'chest',     'Machine',                  'https://youtube.com/shorts/2awX3rTGa1k?si=cay7LAvFElyMUZtn'),
  (4,  'incline machine chest press',  'Incline Machine Chest Press',              'Upper Chest',   'chest',     'Machine',                  'https://youtube.com/shorts/2jwqJh21H0Y?si=GGboTeOwktGcF83G'),
  (5,  'chest fly machine',            'Chest Fly Machine',                        'Chest',         'chest',     'Machine',                  'https://youtube.com/shorts/g3T7LsEeDWQ?si=1QfyTUz3ONd92Y5p'),
  (6,  'incline cable press',          'Incline Cable Press',                      'Upper Chest',   'chest',     'Cable Machine',            'https://youtube.com/shorts/NcF_JFHEry0?si=CCSGbnltSxSSbI5F'),
  (7,  'incline cuffed cable fly',     'Incline Cuffed Cable Fly',                 'Chest',         'chest',     'Cable Machine',            'https://youtube.com/shorts/7cvbpliok9w?si=QWHwhTDAg3ZIZqrY'),
  (8,  'high to low fly',              'High to Low Fly',                          'Chest',         'chest',     'Cable Machine',            'https://youtube.com/shorts/y4RJDSOBEl8?si=zbA2dWzx21h9qPev'),
  -- BACK
  (9,  't-bar row',                    'T-Bar Row',                                'Upper Back',    'back',      'T-Bar Machine',            'https://youtube.com/shorts/Nm3M-4fmprk?si=CGk1uRbzfYChvAQK'),
  (10, 'lat pulldown wide grip',       'Lat Pulldown Wide Grip',                   'Latissimus Dorsi', 'back',   'Cable Machine',            'https://youtube.com/shorts/z-lxcsIN4T4?si=uQXZjeARe5NYudsT'),
  (11, 'cg lat pulldown',              'CG Lat Pulldown',                          'Latissimus Dorsi', 'back',   'Cable Machine',            'https://youtube.com/shorts/K2fvbRmi1xI?si=6b2GYjflTORpRcJ6'),
  (12, 'sa lat pulldown machine',      'SA Lat Pulldown Machine',                  'Latissimus Dorsi', 'back',   'Machine',                  'https://youtu.be/M9xUoJYtXtc?si=dIqF7rZUuJ2yJwEB'),
  (13, 'sa lat pulldown cable stack',  'SA Lat Pulldown Cable Stack',              'Latissimus Dorsi', 'back',   'Cable Machine',            'https://youtube.com/shorts/aXPW00-F5eo?si=sda7raBJJNol1ifO'),
  (14, 'sa cuffed pullover',           'SA Cuffed Pullover',                       'Latissimus Dorsi', 'back',   'Cable Machine',            'https://youtube.com/shorts/y9I8Ohgmf84?si=djyMMnk4Me53-4hv'),
  (15, 'hammer strength plate loaded row', 'Hammer Strength Plate Loaded Row',     'Upper Back',    'back',     'Machine',                  'https://youtube.com/shorts/FVyVvApcyZY?si=585Gc9IuhDLEO8PH'),
  (16, 'back extension',               'Back Extension',                           'Lower Back',    'back',     'Back Extension Bench',     'https://youtu.be/ph3pddpKzzw?si=85a5ZHYW0AlfBr4O'),
  -- TRAPS / SHOULDERS
  (17, 'smith shrugs',                 'Smith Shrugs',                             'Upper Traps',   'shoulders', 'Smith Machine',            'https://youtu.be/cT5_GyOXIgE?si=CZmy256FDVzjaFg2'),
  (18, 'db lateral raises',            'DB Lateral Raises',                        'Lateral Deltoids', 'shoulders', 'Dumbbells',              'https://youtube.com/shorts/JIhbYYA1Q90?si=6x-NychvpEZcC3MN'),
  (19, 'cable lateral raises',         'Cable Lateral Raises',                     'Lateral Deltoids', 'shoulders', 'Cable Machine',          'https://youtube.com/shorts/yHNBM_BTp_s?si=mO2iR9X8BeVjZ_Uv'),
  (20, 'cable y raises',               'Cable Y Raises',                           'Shoulders',     'shoulders', 'Cable Machine',            'https://youtube.com/shorts/Zy0M8JMLnD0?si=oSHgWkY8J71y9BB5'),
  (21, 'db shoulder press',            'DB Shoulder Press',                        'Deltoids',      'shoulders', 'Dumbbells',                'https://youtube.com/shorts/OLePvpxQEGk?si=OGQ-llU1xymI5SJ5'),
  (22, 'machine shoulder press',       'Machine Shoulder Press',                   'Deltoids',      'shoulders', 'Machine',                  'https://youtu.be/WvLMauqrnK8?si=RbkuRVeVUg06ArMF'),
  (23, 'reverse fly machine',          'Reverse Fly Machine',                      'Rear Deltoids', 'shoulders', 'Machine',                  'https://youtube.com/shorts/O2J8Qs7Wl3U?si=pdiqhlJnTXW6MDrL'),
  (24, 'sa cable reverse fly',         'SA Cable Reverse Fly',                     'Rear Deltoids', 'shoulders', 'Cable Machine',            'https://youtube.com/shorts/FeERX9UwspY?si=QhI1RAevrf9JsDwy'),
  -- BICEPS
  (25, 'no cheat curl',                'No Cheat Curl',                            'Biceps',        'arms',      NULL,                       'https://youtube.com/shorts/vF74wQW1Loo?si=9v0j_A6ocZpk1C4P'),
  (26, 'db preacher curl',             'DB Preacher Curl',                         'Biceps',        'arms',      'Dumbbells',                'https://youtube.com/shorts/oHHNXMLvs1c?si=hhBnbBAAUxIjDGzS'),
  (27, 'recline curl',                 'Recline Curl',                             'Biceps',        'arms',      NULL,                       'https://youtube.com/shorts/nuwQj1S2zK4?si=1FRTE0BL_w4uTaX8'),
  (28, 'face away curl',               'Face Away Curl',                           'Biceps',        'arms',      NULL,                       'https://youtube.com/shorts/ayaK3qYn9ZQ?si=0asXOgl0PIaeONl6'),
  -- TRICEPS
  (29, 'zigzag triceps pushdown',      'Zigzag Triceps Pushdown',                  'Triceps',       'arms',      'Cable Machine',            'https://youtube.com/shorts/sTxOvWIBZKY?si=kbDcA1PFWKIlNpEH'),
  (30, 'double rope triceps pushdown', 'Double Rope Triceps Pushdown',             'Triceps',       'arms',      'Cable Machine',            'https://youtu.be/j6gbWmBEMCQ?si=MoWbIZBM8FEjvYOF'),
  (31, 'cable sa triceps pushdown',    'Cable SA Triceps Pushdown',                'Triceps',       'arms',      'Cable Machine',            'https://youtu.be/Cp_bShvMY4c?si=2jRGA5H3aeLDx2OW'),
  (32, 'cable sa overhead triceps extension', 'Cable SA Overhead Triceps Extension', 'Triceps',     'arms',      'Cable Machine',            'https://youtube.com/shorts/JR-E-CVdTvY?si=i4S2JFucjaY0OAA-'),
  -- CORE
  (33, 'cable crunches',               'Cable Crunches',                           'Core',          'core',      'Cable Machine',            'https://youtube.com/shorts/CDO29I7PCoc?si=Aj7Wd361ybE0DtJS'),
  (34, 'machine crunches',             'Machine Crunches',                         'Core',          'core',      'Machine',                  'https://youtube.com/shorts/b6ONE9Rfgl8?si=SCstJegJDayaf5TK'),
  (35, 'ql extension',                 'QL Extension',                             'Quadratus Lumborum', 'core', NULL,                          'https://youtube.com/shorts/p150QgIyP5w?si=DeDARvLfmSmXQ2jo'),
  (36, 'pallof press',                 'Pallof Press',                             'Core',          'core',      'Cable Machine',            'https://youtu.be/tvzoG7Ua05Y?si=Kb-otGAq9Lhh-bl2'),
  (37, 'dead bug',                     'Dead Bug',                                 'Core',          'core',      NULL,                       'https://youtube.com/shorts/DqLL45uk2Tk?si=Zh0MXVH9MPk9uPub'),
  -- FOREARMS
  (38, 'reverse cable curl',           'Reverse Cable Curl',                       'Forearms',      'arms',      'Cable Machine',            'https://youtu.be/BW6JwixlJYs?si=MncSfwkk8L9FFQI1'),
  (39, 'cable wrist curl',             'Cable Wrist Curl',                         'Forearms',      'arms',      'Cable Machine',            'https://youtu.be/WVAaKJvToe0?si=QT5JJZT_b4pEdIPo'),
  -- ROTATOR CUFF / SHOULDER HEALTH
  (40, 'external rotation',            'External Rotation',                        'Rotator Cuff',  'shoulders', NULL,                       'https://youtu.be/ybNV36DoRfY?si=FeBtBp8Mk4FNgztQ'),
  (41, 'external rotation 90/90',      'External Rotation 90/90',                  'Rotator Cuff',  'shoulders', NULL,                       'https://youtube.com/shorts/PTi9pfttH64?si=Qasq-cRWZXT9eUN4'),
  -- LEGS
  (42, 'leg extension',                'Leg Extension',                            'Quadriceps',    'legs',      'Machine',                  'https://youtube.com/shorts/uM86QE59Tgc?si=YdI1F6483abjs_fA'),
  (43, 'seated leg curl',              'Seated Leg Curl',                          'Hamstrings',    'legs',      'Machine',                  'https://youtube.com/shorts/aakNLjjm4Qo?si=A8d863ToE47ISxxN'),
  (44, 'lying leg curl',               'Lying Leg Curl',                           'Hamstrings',    'legs',      'Machine',                  'https://youtube.com/shorts/lGNeJsdqJwg?si=eLVFiV3QKwktfsMZ'),
  (45, 'calf raises',                  'Calf Raises',                              'Calves',        'legs',      NULL,                       'https://youtube.com/shorts/1cvpm--Y-4I?si=cmAvC0SARUKYHwKk'),
  (46, 'adductors',                    'Adductors',                                'Adductors',     'legs',      'Machine',                  'https://youtu.be/BmMmt-c9aNM?si=DOgo19iiOp9X4AJ9'),
  (47, 'leg press',                    'Leg Press',                                'Quadriceps',    'legs',      'Machine',                  'https://youtube.com/shorts/nDh_BlnLCGc?si=7u_8AL6fb7nMAs8n'),
  (48, 'hack squat',                   'Hack Squat',                               'Quadriceps',    'legs',      'Machine',                  'https://youtu.be/rYgNArpwE7E?si=zdFmzRaf9_JdLjGF'),
  (49, 'single leg glute bridge',      'Single Leg Glute Bridge',                  'Glutes',        'legs',      NULL,                       'https://youtu.be/vdmlNaXSjd4?si=PautgvpozMecSdDw'),
  (50, 'glute med kickback supported', 'Glute Med Kickback Supported',             'Glutes',        'legs',      NULL,                       'https://www.youtube.com/shorts/5MzVmCMIvBY'),
  (51, 'glute kickback supported',     'Glute Kickback Supported',                 'Glutes',        'legs',      NULL,                       'https://www.youtube.com/watch?v=nt-PY7VaI_c&pp=ygUYZ2x1dGUga2lja2JhY2sgc3VwcG9ydGVk'),
  (52, 'glute kickback',               'Glute Kickback',                           'Glutes',        'legs',      NULL,                       'https://www.youtube.com/watch?v=qJxwJ1e1HxI&pp=ygUYZ2x1dGUga2lja2JhY2sgc3VwcG9ydGVk'),
  (53, 'sldl / rdl',                   'SLDL / RDL',                               'Hamstrings & Glutes', 'legs', NULL,                        'https://www.youtube.com/shorts/Wou9zVQrAfs'),
  -- SMITH / CHEST
  (54, 'incline smith chest press',    'Incline Smith Chest Press',                'Upper Chest',   'chest',     'Smith Machine',            'https://youtu.be/n6RYEdjvvXI?si=M0fKownH294tqpyu'),
  (55, 'smith flat press',             'Smith Flat Press',                         'Mid Chest',     'chest',     'Smith Machine',            'https://youtube.com/shorts/V6y1OjsXcrI?si=dFrUtivnC3BYSoHm'),
  (56, 'hip thrust',                   'Hip Thrust',                               'Glutes',        'legs',      NULL,                       'https://youtube.com/shorts/e9Eqgb4q6Gs?si=lPVUQns90-8CqWQa');

  SELECT count(*) INTO v_src_rows FROM _yt_src;

  -- ================================================================
  -- 3. DETECT EXISTING MATCHES inside YBS Default Workspace (active OR
  --    archived, by normalized name) and count how many of those matches
  --    are missing a video_url (candidates for backfill).
  -- ================================================================
  SELECT count(DISTINCT s.norm_name) INTO v_existing
  FROM _yt_src s
  JOIN public.exercises e
    ON e.workspace_id = v_ws_id
   AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = s.norm_name;

  SELECT count(DISTINCT s.norm_name) INTO v_missing_url
  FROM _yt_src s
  JOIN public.exercises e
    ON e.workspace_id = v_ws_id
   AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = s.norm_name
   AND (e.video_url IS NULL OR e.video_url = '');

  RAISE NOTICE 'PRE-CHECK: source_rows=%, already_existing=%, existing_with_missing_url=%',
    v_src_rows, v_existing, v_missing_url;

  -- ================================================================
  -- 4. BACKFILL video_url ONLY for existing matches missing one
  --    (never overwrite an existing video URL).
  -- ================================================================
  UPDATE public.exercises e
  SET video_url = s.ex_url,
      updated_at = now()
  FROM _yt_src s
  WHERE e.workspace_id = v_ws_id
    AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = s.norm_name
    AND (e.video_url IS NULL OR e.video_url = '');
  GET DIAGNOSTICS v_backfilled = ROW_COUNT;

  -- ================================================================
  -- 5. INSERT ONLY MISSING EXERCISES (workspace-scoped, idempotent)
  --    Fields follow the app's create/existing-library conventions:
  --    workspace_id, name, video_url, category, muscle_group,
  --    equipment. No tags/instructions are invented (NULL / defaults).
  -- ================================================================
  INSERT INTO public.exercises (workspace_id, name, video_url, category, muscle_group, equipment)
  SELECT
    v_ws_id,
    s.ex_name,
    NULLIF(s.ex_url, ''),
    s.ex_category,
    s.ex_muscle,
    s.ex_equipment
  FROM _yt_src s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.exercises e
    WHERE e.workspace_id = v_ws_id
      AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = s.norm_name
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE 'IMPORT RESULT: source_rows=%, inserted=%, already_existing=%, url_backfilled=%, left_untouched=%',
    v_src_rows, v_inserted, v_existing, v_backfilled, v_existing - v_backfilled;

  IF v_inserted <> (56 - v_existing) THEN
    RAISE WARNING 'Unexpected inserted count (%): expected % - existing(%)', v_inserted, 56, v_existing;
  END IF;
END $$;

-- ============================================================
-- POST-IMPORT VERIFICATION (run these in the SQL editor)
-- ============================================================

-- 1. Target workspace (report the resolved id/slug here)
SELECT id AS workspace_id, name, slug
FROM public.workspaces
WHERE name = 'YBS Default Workspace';

-- 2. Imported-supplement coverage in YBS Default Workspace:
--    56 names supplied, video_url populated for all inserted rows.
SELECT
  count(*) AS matching_names,
  count(*) FILTER (WHERE e.video_url IS NULL OR e.video_url = '') AS missing_video_url
FROM (VALUES
  ('Incline DB Chest Press 30–45'), ('DB Flat Chest Press'), ('Flat Chest Press Machine'),
  ('Incline Machine Chest Press'), ('Chest Fly Machine'), ('Incline Cable Press'),
  ('Incline Cuffed Cable Fly'), ('High to Low Fly'), ('T-Bar Row'), ('Lat Pulldown Wide Grip'),
  ('CG Lat Pulldown'), ('SA Lat Pulldown Machine'), ('SA Lat Pulldown Cable Stack'),
  ('SA Cuffed Pullover'), ('Hammer Strength Plate Loaded Row'), ('Back Extension'),
  ('Smith Shrugs'), ('DB Lateral Raises'), ('Cable Lateral Raises'), ('Cable Y Raises'),
  ('DB Shoulder Press'), ('Machine Shoulder Press'), ('Reverse Fly Machine'),
  ('SA Cable Reverse Fly'), ('No Cheat Curl'), ('DB Preacher Curl'), ('Recline Curl'),
  ('Face Away Curl'), ('Zigzag Triceps Pushdown'), ('Double Rope Triceps Pushdown'),
  ('Cable SA Triceps Pushdown'), ('Cable SA Overhead Triceps Extension'), ('Cable Crunches'),
  ('Machine Crunches'), ('QL Extension'), ('Pallof Press'), ('Dead Bug'), ('Reverse Cable Curl'),
  ('Cable Wrist Curl'), ('External Rotation'), ('External Rotation 90/90'), ('Leg Extension'),
  ('Seated Leg Curl'), ('Lying Leg Curl'), ('Calf Raises'), ('Adductors'), ('Leg Press'),
  ('Hack Squat'), ('Single Leg Glute Bridge'), ('Glute Med Kickback Supported'),
  ('Glute Kickback Supported'), ('Glute Kickback'), ('SLDL / RDL'),
  ('Incline Smith Chest Press'), ('Smith Flat Press'), ('Hip Thrust')
) AS src(name)
LEFT JOIN public.exercises e
  ON e.workspace_id = (SELECT id FROM public.workspaces WHERE name = 'YBS Default Workspace')
 AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = lower(trim(regexp_replace(src.name, '\s+', ' ', 'g')));

-- 3. Duplicate-name check WITHIN YBS Default Workspace (MUST be 0 active pairs)
SELECT count(*) AS duplicate_named_active_exercises
FROM (
  SELECT lower(trim(regexp_replace(name, '\s+', ' ', 'g'))) AS n
  FROM public.exercises
  WHERE workspace_id = (SELECT id FROM public.workspaces WHERE name = 'YBS Default Workspace')
    AND is_archived = false
  GROUP BY lower(trim(regexp_replace(name, '\s+', ' ', 'g')))
  HAVING count(*) > 1
) d;

-- 4. Active NULL-workspace exercises MUST stay 0
SELECT count(*) AS active_null_workspace_exercises
FROM public.exercises
WHERE is_archived = false AND workspace_id IS NULL;

-- 5. Per-workspace distribution (only YBS Default Workspace changed)
SELECT
  COALESCE(w.name, '(global)') AS workspace_name,
  count(e.id)                   AS exercise_count
FROM public.workspaces w
LEFT JOIN public.exercises e ON e.workspace_id = w.id
GROUP BY w.id, w.name
ORDER BY w.created_at ASC;