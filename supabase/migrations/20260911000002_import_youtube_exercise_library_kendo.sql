-- ============================================================
-- YBS SYSTEM: IMPORT EXERCISE LIBRARY -> "KENDO ONLINE COACHING"
-- Migration: 20260911000002_import_youtube_exercise_library_kendo.sql
--
-- Imports the YouTube exercise library (30 rows) from playlist
-- PLX-AmyFnWDvc into the existing Workspace "KENDO ONLINE COACHING"
-- (resolved at runtime by exact name).
--
-- SOURCE ROWS: 30   (all rows carry a YouTube video URL)
--
-- GUARANTEES
--  * Target ONLY the Workspace whose name is exactly 'KENDO ONLINE COACHING'.
--      - The target is resolved AT RUNTIME by exact name match on
--        public.workspaces. It is never the logged-in workspace, the
--        first workspace returned, or any hardcoded assumption.
--      - If zero or more than one Workspace named "KENDO ONLINE COACHING"
--        exists, the whole script ABORTS with an exception and inserts
--        NOTHING.
--      - The resolved workspace_id is stored once and reused for
--        every dedupe check, backfill and insert.
--  * Idempotent — re-running inserts nothing and re-updates nothing.
--  * Duplicate protection — each row is matched against the existing
--    KENDO library by normalized name (active OR archived rows).
--      - No match               -> INSERT (name, video_url, category,
--                                  muscle_group).
--      - Match + missing URL    -> UPDATE video_url ONLY (backfill).
--      - Match + URL present    -> LEFT UNTOUCHED (never overwrites an
--                                  existing video with a new one).
--  * Every inserted row has workspace_id = the resolved KENDO workspace id.
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
  -- 1. RESOLVE the "KENDO ONLINE COACHING" workspace (exact name).
  --    Aborts on zero or multiple matches — no guessing, no partial
  --    import (the whole script rolls back on this exception).
  -- ================================================================
  SELECT count(*) INTO v_exact_count
  FROM public.workspaces WHERE name = 'KENDO ONLINE COACHING';

  IF v_exact_count = 0 THEN
    RAISE EXCEPTION 'Import ABORTED: Workspace "KENDO ONLINE COACHING" not found. No rows inserted.';
  ELSIF v_exact_count > 1 THEN
    RAISE EXCEPTION 'Import ABORTED: more than one Workspace named "KENDO ONLINE COACHING". Resolve manually.';
  END IF;

  SELECT id, name, slug INTO v_ws_id, v_ws_name, v_ws_slug
  FROM public.workspaces WHERE name = 'KENDO ONLINE COACHING';

  RAISE NOTICE 'Target workspace resolved: name=%, id=%, slug=%', v_ws_name, v_ws_id, v_ws_slug;

  -- ================================================================
  -- 2. LOAD SOURCE ROWS (temporary, session-scoped)
  --    Columns: norm_name (index key), ex_name (cleaned title),
  --    muscle_group, category (CHECK-enum), ex_url.
  -- ================================================================
  CREATE TEMP TABLE _yt_src (
    src_ord      INTEGER PRIMARY KEY,
    norm_name    TEXT NOT NULL,
    ex_name      TEXT NOT NULL,
    ex_muscle    TEXT NOT NULL,
    ex_category  TEXT NOT NULL,
    ex_url       TEXT NOT NULL DEFAULT ''
  ) ON COMMIT DROP;

  INSERT INTO _yt_src (src_ord, norm_name, ex_name, ex_muscle, ex_category, ex_url)
  VALUES
  -- BACK
  (1,  't-bar row',                          'T-Bar Row',                                'Upper Back',       'back',      'https://www.youtube.com/shorts/PP9GreVLiZQ'),
  -- SPECIAL OVERRIDE (YouTube title "10 September 2026" -> corrected name)
  (2,  'wide-grip seated row',               'Wide-Grip Seated Row',                     'Back',             'back',      'https://www.youtube.com/shorts/SbSh7so5zYM'),
  -- LEGS
  (3,  'leg press machine',                  'Leg Press Machine',                        'Quadriceps',       'legs',      'https://www.youtube.com/shorts/PJ1EHoMdias'),
  (4,  'leg extension machine',              'Leg Extension Machine',                    'Quadriceps',       'legs',      'https://www.youtube.com/shorts/oBIkyXhMYNE'),
  (5,  'lying leg curl',                     'Lying Leg Curl',                           'Hamstrings',       'legs',      'https://www.youtube.com/shorts/oEiFITXhh1w'),
  -- BICEPS
  (6,  'no cheat curl',                      'No Cheat Curl',                            'Biceps',           'arms',      'https://www.youtube.com/shorts/WksYNbPTqBs'),
  -- SHOULDERS
  (7,  'cable lateral raise',                'Cable Lateral Raise',                      'Lateral Deltoids', 'shoulders', 'https://www.youtube.com/shorts/-J1rGFR-NyM'),
  (8,  'dumbbell lateral raise',             'Dumbbell Lateral Raise',                   'Lateral Deltoids', 'shoulders', 'https://www.youtube.com/shorts/rXsuoLUi29Q'),
  -- BICEPS
  (9,  'dumbbell preacher curl',             'Dumbbell Preacher Curl',                   'Biceps',           'arms',      'https://www.youtube.com/shorts/KwnHJV4wj2Q'),
  -- TRICEPS
  (10, 'cable overhead triceps extension',   'Cable Overhead Triceps Extension',          'Triceps',          'arms',      'https://www.youtube.com/shorts/LpYPJx1Obgk'),
  (11, 'single-arm triceps pushdown',        'Single-Arm Triceps Pushdown',              'Triceps',          'arms',      'https://www.youtube.com/shorts/t7xgOcDMZD0'),
  -- CHEST
  (12, 'incline chest press machine',        'Incline Chest Press Machine',              'Upper Chest',      'chest',     'https://www.youtube.com/shorts/PbjLvZKZM2A'),
  -- BACK
  (13, 'lat pulldown',                       'Lat Pulldown',                             'Latissimus Dorsi', 'back',      'https://www.youtube.com/shorts/VlHEJcyEvk4'),
  -- CHEST
  (14, 'machine chest fly',                  'Machine Chest Fly',                        'Chest',            'chest',     'https://www.youtube.com/shorts/MKF6CjC8On0'),
  -- BACK
  (15, 'close-grip seated row',              'Close-Grip Seated Row',                    'Back',             'back',      'https://www.youtube.com/shorts/yce69YJ4gHs'),
  -- SHOULDERS
  (16, 'kelso shrug',                        'Kelso Shrug',                              'Traps',            'shoulders', 'https://www.youtube.com/shorts/2y-V6J8Bn7s'),
  -- BACK
  (17, 'cable lat pullover',                 'Cable Lat Pullover',                       'Latissimus Dorsi', 'back',      'https://www.youtube.com/shorts/N7AuyVg_tZo'),
  -- CHEST
  (18, 'dumbbell incline chest press',       'Dumbbell Incline Chest Press',             'Upper Chest',      'chest',     'https://www.youtube.com/shorts/YZOM17Ejxm8'),
  (19, 'dumbbell flat chest press',          'Dumbbell Flat Chest Press',                'Mid Chest',        'chest',     'https://www.youtube.com/shorts/RQT7eDv1caM'),
  (20, 'flat machine chest press',           'Flat Machine Chest Press',                 'Mid Chest',        'chest',     'https://www.youtube.com/shorts/YioUZKLvrg4'),
  -- SHOULDERS
  (21, 'shoulder press machine',             'Shoulder Press Machine',                   'Deltoids',         'shoulders', 'https://www.youtube.com/shorts/5-wcde3ualQ'),
  (22, 'cable y raise',                      'Cable Y Raise',                            'Shoulders',        'shoulders', 'https://www.youtube.com/shorts/KjEKLRRlg9M'),
  -- LEGS
  (23, 'smith machine squat',                'Smith Machine Squat',                      'Quadriceps',       'legs',      'https://www.youtube.com/shorts/RNHfV9UHXDQ'),
  -- SHOULDERS
  (24, 'cable rear delt fly',                'Cable Rear Delt Fly',                      'Rear Deltoids',    'shoulders', 'https://www.youtube.com/shorts/2FprS8iQe4k'),
  -- TRICEPS
  (25, 'cable ez pushdown',                  'Cable EZ Pushdown',                        'Triceps',          'arms',      'https://www.youtube.com/shorts/S3RXGUm7yCU'),
  -- BACK
  (26, 'close-grip lat pulldown',            'Close-Grip Lat Pulldown',                  'Latissimus Dorsi', 'back',      'https://www.youtube.com/shorts/AAQwQILFEN0'),
  -- BICEPS
  (27, 'cable reverse grip curl',            'Cable Reverse Grip Curl',                  'Biceps',           'arms',      'https://www.youtube.com/shorts/CETlwaoBkxg'),
  -- LEGS
  (28, 'hip adduction machine',              'Hip Adduction Machine',                    'Adductors',        'legs',      'https://www.youtube.com/shorts/sbcrm4j-HKI'),
  (29, 'hip abduction machine',              'Hip Abduction Machine',                    'Abductors',        'legs',      'https://www.youtube.com/shorts/cRlZ7yDlOyw'),
  (30, 'smith machine calf press',           'Smith Machine Calf Press',                 'Calves',           'legs',      'https://www.youtube.com/shorts/-Ag9eX9RzrY');

  SELECT count(*) INTO v_src_rows FROM _yt_src;

  -- ================================================================
  -- 3. DETECT EXISTING MATCHES inside KENDO ONLINE COACHING (active OR
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
  --    workspace_id, name, video_url, category, muscle_group.
  --    No equipment/instructions/tags are invented (NULL / defaults).
  -- ================================================================
  INSERT INTO public.exercises (workspace_id, name, video_url, category, muscle_group)
  SELECT
    v_ws_id,
    s.ex_name,
    NULLIF(s.ex_url, ''),
    s.ex_category,
    s.ex_muscle
  FROM _yt_src s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.exercises e
    WHERE e.workspace_id = v_ws_id
      AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = s.norm_name
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE 'IMPORT RESULT: source_rows=%, inserted=%, already_existing=%, url_backfilled=%, left_untouched=%',
    v_src_rows, v_inserted, v_existing, v_backfilled, v_existing - v_backfilled;

  IF v_inserted <> (30 - v_existing) THEN
    RAISE WARNING 'Unexpected inserted count (%): expected % - existing(%)', v_inserted, 30, v_existing;
  END IF;
END $$;

-- ============================================================
-- POST-IMPORT VERIFICATION (run these in the SQL editor)
-- ============================================================

-- 1. Target workspace (report the resolved id/slug here)
SELECT id AS workspace_id, name, slug
FROM public.workspaces
WHERE name = 'KENDO ONLINE COACHING';

-- 2. Imported-supplement coverage in KENDO ONLINE COACHING:
--    30 names supplied, video_url populated for all inserted rows.
SELECT
  count(*) AS matching_names,
  count(*) FILTER (WHERE e.video_url IS NULL OR e.video_url = '') AS missing_video_url
FROM (VALUES
  ('T-Bar Row'), ('Wide-Grip Seated Row'), ('Leg Press Machine'),
  ('Leg Extension Machine'), ('Lying Leg Curl'), ('No Cheat Curl'),
  ('Cable Lateral Raise'), ('Dumbbell Lateral Raise'), ('Dumbbell Preacher Curl'),
  ('Cable Overhead Triceps Extension'), ('Single-Arm Triceps Pushdown'),
  ('Incline Chest Press Machine'), ('Lat Pulldown'), ('Machine Chest Fly'),
  ('Close-Grip Seated Row'), ('Kelso Shrug'), ('Cable Lat Pullover'),
  ('Dumbbell Incline Chest Press'), ('Dumbbell Flat Chest Press'),
  ('Flat Machine Chest Press'), ('Shoulder Press Machine'), ('Cable Y Raise'),
  ('Smith Machine Squat'), ('Cable Rear Delt Fly'), ('Cable EZ Pushdown'),
  ('Close-Grip Lat Pulldown'), ('Cable Reverse Grip Curl'),
  ('Hip Adduction Machine'), ('Hip Abduction Machine'), ('Smith Machine Calf Press')
) AS src(name)
LEFT JOIN public.exercises e
  ON e.workspace_id = (SELECT id FROM public.workspaces WHERE name = 'KENDO ONLINE COACHING')
 AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = lower(trim(regexp_replace(src.name, '\s+', ' ', 'g')));

-- 3. Duplicate-name check WITHIN KENDO ONLINE COACHING (MUST be 0 active pairs)
SELECT count(*) AS duplicate_named_active_exercises
FROM (
  SELECT lower(trim(regexp_replace(name, '\s+', ' ', 'g'))) AS n
  FROM public.exercises
  WHERE workspace_id = (SELECT id FROM public.workspaces WHERE name = 'KENDO ONLINE COACHING')
    AND is_archived = false
  GROUP BY lower(trim(regexp_replace(name, '\s+', ' ', 'g')))
  HAVING count(*) > 1
) d;

-- 4. Active NULL-workspace exercises MUST stay 0
SELECT count(*) AS active_null_workspace_exercises
FROM public.exercises
WHERE is_archived = false AND workspace_id IS NULL;

-- 5. Per-workspace distribution (only KENDO ONLINE COACHING changed)
SELECT
  COALESCE(w.name, '(global)') AS workspace_name,
  count(e.id)                   AS exercise_count
FROM public.workspaces w
LEFT JOIN public.exercises e ON e.workspace_id = w.id
GROUP BY w.id, w.name
ORDER BY w.created_at ASC;

-- 6. Verify "10 September 2026" does NOT appear as an exercise name
SELECT id, name, video_url
FROM public.exercises
WHERE workspace_id = (SELECT id FROM public.workspaces WHERE name = 'KENDO ONLINE COACHING')
  AND name = '10 September 2026';
-- Expected: 0 rows

-- 7. Verify Wide-Grip Seated Row has the correct video
SELECT id, name, video_url
FROM public.exercises
WHERE workspace_id = (SELECT id FROM public.workspaces WHERE name = 'KENDO ONLINE COACHING')
  AND name = 'Wide-Grip Seated Row';
-- Expected: video_url = 'https://www.youtube.com/shorts/SbSh7so5zYM'
