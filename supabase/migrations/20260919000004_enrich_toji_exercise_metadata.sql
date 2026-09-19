-- ============================================================
-- YBS SYSTEM: ENRICH TOJI EXERCISE METADATA
-- Migration: 20260919000004_enrich_toji_exercise_metadata.sql
--
-- Populates category / muscle_group / equipment for the 23 TOJI
-- exercise-library rows imported from TOJI-exercise-library.csv.
--
-- SCOPE
--  * Target ONLY the TOJI workspace (id af321df9-b3e4-4929-
--    ac04-15ae9af151ef) AND ONLY the 23 rows identified by their
--    exact imported video URLs / derived YouTube video IDs.
--  * name and video_url are NEVER touched.
--  * Existing non-empty metadata is NEVER overwritten (COALESCE ''
--    guard) — each field is only filled when currently empty.
--
-- VALUE CONVENTIONS (mirror the existing YBS/global exercise library)
--  * Equipment follows name keywords: Cable -> 'Cable Machine',
--    DB -> 'Dumbbells', Machine -> 'Machine'; empty when the name
--    carries no reliable equipment cue (left NULL, never guessed).
--  * category uses the exercises.category CHECK enum.
--  * muscle_group follows the Title Case values already in use
--    (Triceps, Biceps, Forearms, Latissimus Dorsi, Quadriceps,
--    Abductors, Upper Chest, Mid Chest, Hamstrings & Glutes, ...).
--
-- NO schema change: only UPDATE on existing columns.
-- Idempotent: re-running is a no-op on rows whose metadata is
-- already set.
-- ============================================================

WITH mapping(vid, category, muscle_group, equipment) AS (
  VALUES
    ('000EqpcObek','arms',      'Forearms',        'Cable Machine'),
    ('gAl8x8-q9HA','core',      'Core',            'Dumbbells'),
    ('Zhr_EiPHYNQ','legs',      'Abductors',       'Cable Machine'),
    ('aBXhTXx_Ksc','chest',     'Serratus Anterior', NULL),                    -- equipment not reliably determinable
    ('mVsmTW7EctM','back',      'Lower Back',      'Back Extension Bench'),
    ('kd33PozB6oY','shoulders', 'Lateral Deltoids','Cable Machine'),
    ('cf748sd3gNU','legs',      'Abductors',       'Cable Machine'),
    ('oMVuIfz3kz8','legs',      'Hamstrings & Glutes', NULL),                  -- equipment not reliably determinable
    ('6yihKeYjQW4','back',      'Latissimus Dorsi', NULL),                     -- equipment not reliably determinable
    ('_bgfZ6-gOHk','legs',      'Quadriceps',      'Machine'),
    ('VsO1LJkWUKw','arms',      'Biceps',          'Dumbbells'),
    ('ZdKUJe4d5L0','shoulders', 'Deltoids',        'Machine'),
    ('-PrrnNamu6g','back',      'Upper Back',      NULL),                      -- equipment not reliably determinable
    ('laa4DYWujiE','chest',     'Upper Chest',     'Cable Machine'),
    ('9EyCXSwbLIc','chest',     'Upper Chest',     'Dumbbells'),
    ('SztP--CqQ38','arms',      'Triceps',         'Cable Machine'),
    ('uRcn-R3i0hQ','arms',      'Triceps',         'Cable Machine'),
    ('6oIXV9lxhBg','chest',     'Mid Chest',       'Dumbbells'),
    ('RQ_APXeY4j0','shoulders', 'Lateral Deltoids','Dumbbells'),
    ('R2x26tMPj68','back',      'Latissimus Dorsi','Cable Machine'),
    ('bo0Ic2_eO_0','legs',      'Quadriceps',      NULL),                      -- equipment not reliably determinable
    ('Hx-z4SXm3LY','legs',      'Glutes',          'Machine'),
    ('baDoDZ1D5is','arms',      'Biceps',          'Cable Machine')
),
ex AS (
  SELECT e.id, m.vid, m.category, m.muscle_group, m.equipment
  FROM public.exercises e
  JOIN mapping m
    ON e.workspace_id = 'af321df9-b3e4-4929-ac04-15ae9af151ef'
   AND (e.video_url = 'https://www.youtube.com/watch?v=' || m.vid
        OR substring(e.video_url from '(?:youtu\.be/|youtube\.com/(?:embed/|v/|watch\?v=|watch\?.+&v=))([[:alnum:]_-]{11})') = m.vid)
)
UPDATE public.exercises e
SET category     = COALESCE(NULLIF(ex.category,''),     e.category),
    muscle_group = COALESCE(NULLIF(ex.muscle_group,''), e.muscle_group),
    equipment    = COALESCE(NULLIF(ex.equipment,''),    e.equipment),
    updated_at   = now()
FROM ex
WHERE e.id = ex.id
  AND (COALESCE(NULLIF(ex.category,''),'') <> COALESCE(e.category,'')
    OR COALESCE(NULLIF(ex.muscle_group,''),'') <> COALESCE(e.muscle_group,'')
    OR COALESCE(NULLIF(ex.equipment,''),'') <> COALESCE(e.equipment,''));

-- ============================================================
-- VERIFICATION (run in the SQL editor; last SELECT shows the
-- final state of the 23-rows batch)
-- ============================================================
WITH target(vid) AS (
  VALUES
    ('000EqpcObek'),('gAl8x8-q9HA'),('Zhr_EiPHYNQ'),('aBXhTXx_Ksc'),
    ('mVsmTW7EctM'),('kd33PozB6oY'),('cf748sd3gNU'),('oMVuIfz3kz8'),
    ('6yihKeYjQW4'),('_bgfZ6-gOHk'),('VsO1LJkWUKw'),('ZdKUJe4d5L0'),
    ('-PrrnNamu6g'),('laa4DYWujiE'),('9EyCXSwbLIc'),('SztP--CqQ38'),
    ('uRcn-R3i0hQ'),('6oIXV9lxhBg'),('RQ_APXeY4j0'),('R2x26tMPj68'),
    ('bo0Ic2_eO_0'),('Hx-z4SXm3LY'),('baDoDZ1D5is')
)
SELECT
  count(*)                                                                 AS batch_rows,
  count(*) FILTER (WHERE COALESCE(e.category,'') <> '')                     AS with_category,
  count(*) FILTER (WHERE COALESCE(e.muscle_group,'') <> '')                 AS with_muscle_group,
  count(*) FILTER (WHERE COALESCE(e.equipment,'') <> '')                    AS with_equipment,
  count(*) FILTER (WHERE COALESCE(e.category,'') = '' OR COALESCE(e.muscle_group,'') = '' OR COALESCE(e.equipment,'') = '') AS rows_with_null_metadata
FROM public.exercises e
JOIN target t
  ON e.workspace_id = 'af321df9-b3e4-4929-ac04-15ae9af151ef'
 AND (e.video_url = 'https://www.youtube.com/watch?v=' || t.vid
      OR substring(e.video_url from '(?:youtu\.be/|youtube\.com/(?:embed/|v/|watch\?v=|watch\?.+&v=))([[:alnum:]_-]{11})') = t.vid);