-- ============================================================
-- YBS SYSTEM: IMPORT EXERCISE LIBRARY -> "Drbahaa Coaching"
-- Migration: 20260905000008_import_drbahaa_exercise_library.sql
--
-- Imports the Drbahaa Coaching exercise dataset into the existing
-- Workspace "Drbahaa Coaching" (resolved at runtime by exact name).
--
-- SOURCE ROWS: 131   UNIQUE (name+muscle+url): 129
--
-- URL COUNTS
--   Source dataset      : google_drive=90  non_google_drive=40  missing=1  total=131
--   Deduplicated import : google_drive=88  non_google_drive=40  missing=1  total=129
-- (note: 2 source rows are exact intra-dataset duplicates (both Google Drive):
--  Preacher Curl [R2/R10], Bulgarian Split Squat [R5/R57])
--
-- GUARANTEES
--  * Idempotent — re-running inserts nothing (normalized-name check
--    scoped to Drbahaa Coaching, covering active AND archived rows).
--  * Every inserted row has workspace_id = Drbahaa Coaching. NO NULLs.
--  * Does NOT touch YBS / Kendo / other Workspaces or global rows.
--  * No URL is invented or rewritten; the one missing-URL row keeps
--    video_url NULL.
--  * The source `category` (Resistance/Mobility/Other, a training
--    modality) cannot be stored in exercises.category (CHECK enum is
--    body-part based), so it is preserved in the existing `tags`
--    column and exercises.category is derived from target_muscle.
-- ============================================================

DO $$
DECLARE
  v_ws_id        UUID;
  v_ws_name      TEXT;
  v_ws_slug      TEXT;
  v_exact_count  INTEGER;
  v_src_rows     INTEGER;
  v_existing     INTEGER;
  v_archived     INTEGER;
  v_inserted     INTEGER;
  v_google       INTEGER;
  v_youtube      INTEGER;
  v_missing      INTEGER;
BEGIN
  -- ================================================================
  -- 1. RESOLVE the "Drbahaa Coaching" workspace (exact name).
  --    Aborts on zero or multiple matches — no guessing, no partial
  --    import (the whole script rolls back on this exception).
  -- ================================================================
  SELECT count(*) INTO v_exact_count
  FROM public.workspaces WHERE name = 'Drbahaa Coaching';

  IF v_exact_count = 0 THEN
    RAISE EXCEPTION 'Import ABORTED: Workspace "Drbahaa Coaching" not found. No rows inserted.';
  ELSIF v_exact_count > 1 THEN
    RAISE EXCEPTION 'Import ABORTED: more than one Workspace named "Drbahaa Coaching". Resolve manually.';
  END IF;

  SELECT id, name, slug INTO v_ws_id, v_ws_name, v_ws_slug
  FROM public.workspaces WHERE name = 'Drbahaa Coaching';

  RAISE NOTICE 'Target workspace resolved: name=%, id=%, slug=%', v_ws_name, v_ws_id, v_ws_slug;

  -- ================================================================
  -- 2. LOAD SOURCE ROWS (temporary, session-scoped)
  -- ================================================================
  CREATE TEMP TABLE _drb_src (
    src_ord    INTEGER PRIMARY KEY,
    norm_name  TEXT NOT NULL,
    ex_name    TEXT NOT NULL,
    ex_muscle  TEXT NOT NULL,
    norm_muscle TEXT NOT NULL,
    norm_url   TEXT NOT NULL DEFAULT '',
    src_cat    TEXT NOT NULL,
    ex_url     TEXT NOT NULL DEFAULT '',
    url_status TEXT NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _drb_src (src_ord, norm_name, ex_name, ex_muscle, norm_muscle, norm_url, src_cat, ex_url, url_status)
  VALUES
  (1, 'preacher curl', 'Preacher Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (2, 'leg extension', 'Leg Extension', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1-5l8d3xmhhx2j2t8vk6xw4b9z3q5_7yp/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1-5L8d3XmHhX2J2T8vK6xW4b9Z3Q5_7yP/view?usp=drive_link', 'google_drive'),
  (3, 'machine biceps curl', 'Machine Biceps Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (4, 'db lunges', 'Db Lunges', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (5, 'cable biceps curl', 'Cable Biceps Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (6, 'smith machine squat', 'Smith Machine Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (7, 'incline db curl', 'Incline Db Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (8, 'bulgarian split squat', 'Bulgarian Split Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1xnquy3-ra_rbofq7jcm_u6h9mokrq_w7/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1xnQuy3-Ra_RboFq7JcM_U6h9mOKrQ_W7/view?usp=drive_link', 'google_drive'),
  (9, 'hammer curl', 'Hammer Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (10, 'goblet squat', 'Goblet Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (11, 'concentration curl', 'Concentration Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (12, 'leg press', 'Leg Press', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1-5l8d3xmhhx2j2t8vk6xw4b9z3q5_7yp/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1-5L8d3XmHhX2J2T8vK6xW4b9Z3Q5_7yP/view?usp=drive_link', 'google_drive'),
  (13, 'cable hammer curl', 'Cable Hammer Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (14, 'hack squat', 'Hack Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (15, 'ez bar curl', 'Ez Bar Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (16, 'step up', 'Step Up', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (17, 'preacher curl', 'Preacher Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (18, 'front squat', 'Front Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (19, 'preacher curl machine', 'Preacher Curl Machine', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (20, 'sisy squat', 'Sisy Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1-5l8d3xmhhx2j2t8vk6xw4b9z3q5_7yp/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1-5L8d3XmHhX2J2T8vK6xW4b9Z3Q5_7yP/view?usp=drive_link', 'google_drive'),
  (21, 'cable concentration curl', 'Cable Concentration Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (22, 'wall squat', 'Wall Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1-5l8d3xmhhx2j2t8vk6xw4b9z3q5_7yp/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1-5L8d3XmHhX2J2T8vK6xW4b9Z3Q5_7yP/view?usp=drive_link', 'google_drive'),
  (23, 'spider curl', 'Spider Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (24, 'pistol squat', 'Pistol Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (25, 'drag curl', 'Drag Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (26, 'bodyweight squat', 'Bodyweight Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (27, 'zottman curl', 'Zottman Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (28, 'jump squat', 'Jump Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1-5l8d3xmhhx2j2t8vk6xw4b9z3q5_7yp/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1-5L8d3XmHhX2J2T8vK6xW4b9Z3Q5_7yP/view?usp=drive_link', 'google_drive'),
  (29, 'cable biceps curl high', 'Cable Biceps Curl High', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (30, 'sumo squat', 'Sumo Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (31, 'reverse curl', 'Reverse Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (32, 'overhead squat', 'Overhead Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (33, 'standing db curl', 'Standing Db Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (34, 'split squat', 'Split Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (35, 'seated db curl', 'Seated Db Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (36, 'pendulum squat', 'Pendulum Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1-5l8d3xmhhx2j2t8vk6xw4b9z3q5_7yp/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1-5L8d3XmHhX2J2T8vK6xW4b9Z3Q5_7yP/view?usp=drive_link', 'google_drive'),
  (37, 'lying cable curl', 'Lying Cable Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (38, 'belt squat', 'Belt Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1-5l8d3xmhhx2j2t8vk6xw4b9z3q5_7yp/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1-5L8d3XmHhX2J2T8vK6xW4b9Z3Q5_7yP/view?usp=drive_link', 'google_drive'),
  (39, 'alternating db curl', 'Alternating Db Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (40, 'zercher squat', 'Zercher Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (41, 'band biceps curl', 'Band Biceps Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (42, 'hack squat machine', 'Hack Squat Machine', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1-5l8d3xmhhx2j2t8vk6xw4b9z3q5_7yp/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1-5L8d3XmHhX2J2T8vK6xW4b9Z3Q5_7yP/view?usp=drive_link', 'google_drive'),
  (43, 'machine preacher curl', 'Machine Preacher Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (44, 'bulgarian split squat smith', 'Bulgarian Split Squat Smith', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1xnquy3-ra_rbofq7jcm_u6h9mokrq_w7/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1xnQuy3-Ra_RboFq7JcM_U6h9mOKrQ_W7/view?usp=drive_link', 'google_drive'),
  (45, 'single arm cable curl', 'Single Arm Cable Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (46, 'reverse lunge', 'Reverse Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (47, 'alternating hammer curl', 'Alternating Hammer Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (48, 'forward lunge', 'Forward Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (49, 'iso lateral biceps curl', 'Iso Lateral Biceps Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (50, 'side lunge', 'Side Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (51, 'barbell curl', 'Barbell Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (52, 'curtsy lunge', 'Curtsy Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (53, 'chin up', 'Chin Up', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (54, 'jump lunge', 'Jump Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (55, 'close grip chin up', 'Close Grip Chin Up', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (56, 'deficit reverse lunge', 'Deficit Reverse Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (57, 'neutral grip chin up', 'Neutral Grip Chin Up', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (58, 'smith machine lunge', 'Smith Machine Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (59, 'weighted chin up', 'Weighted Chin Up', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (60, 'stationary lunge', 'Stationary Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (61, 'assisted chin up', 'Assisted Chin Up', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (62, 'db split squat', 'Db Split Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (63, 'bodyweight curl', 'Bodyweight Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (64, 'barbell lunge', 'Barbell Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (65, 'trtr curl', 'Trtr Curl', 'Biceps', 'biceps', 'https://drive.google.com/file/d/10dr7wxulhypd8ncwa1zmwpcs3layxam-/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/10Dr7wxULHYpD8ncwa1ZMWPCS3lAyXAm-/view?usp=drive_link', 'google_drive'),
  (66, 'overhead lunge', 'Overhead Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (67, 'tricep pushdown', 'Tricep Pushdown', 'Triceps', 'triceps', 'https://drive.google.com/file/d/1itwfmkv0mvwzl-svoqe8xjv9zinbouue/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1ITwfmkV0mVWZl-sVOqE8xJV9ZiNbouUE/view?usp=drive_link', 'google_drive'),
  (68, 'lateral lunge', 'Lateral Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (69, 'skull crusher', 'Skull Crusher', 'Triceps', 'triceps', 'https://drive.google.com/file/d/1itwfmkv0mvwzl-svoqe8xjv9zinbouue/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1ITwfmkV0mVWZl-sVOqE8xJV9ZiNbouUE/view?usp=drive_link', 'google_drive'),
  (70, 'step back lunge', 'Step Back Lunge', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (71, 'overhead tricep extension', 'Overhead Tricep Extension', 'Triceps', 'triceps', 'https://drive.google.com/file/d/1itwfmkv0mvwzl-svoqe8xjv9zinbouue/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1ITwfmkV0mVWZl-sVOqE8xJV9ZiNbouUE/view?usp=drive_link', 'google_drive'),
  (72, 'step up to balance', 'Step Up To Balance', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (73, 'close grip bench press', 'Close Grip Bench Press', 'Triceps', 'triceps', 'https://drive.google.com/file/d/1itwfmkv0mvwzl-svoqe8xjv9zinbouue/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1ITwfmkV0mVWZl-sVOqE8xJV9ZiNbouUE/view?usp=drive_link', 'google_drive'),
  (74, 'weighted step up', 'Weighted Step Up', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (75, 'khairy pushdown', 'Khairy Pushdown', 'Triceps', 'triceps', 'https://drive.google.com/file/d/1itwfmkv0mvwzl-svoqe8xjv9zinbouue/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1ITwfmkV0mVWZl-sVOqE8xJV9ZiNbouUE/view?usp=drive_link', 'google_drive'),
  (76, 'plate neck extension "small range"', 'Plate Neck Extension "Small Range"', 'Neck', 'neck', 'https://youtu.be/-wr3fczzq2e?si=xuvchuunqsygwthi', 'Resistance', 'https://youtu.be/-WR3FczzQ2E?si=xUvChuUNqsYGwthi', 'non_google_drive'),
  (77, 'ankle eversion', 'Ankle Eversion', 'Other', 'other', 'https://youtu.be/xfrncpp5onq?si=thn_l2m3cbfohqoz', 'Resistance', 'https://youtu.be/xfrncpP5ONQ?si=tHn_L2m3CBFoHQoZ', 'non_google_drive'),
  (78, 'sa y-raises', 'Sa Y-Raises', 'Shoulders', 'shoulders', 'https://drive.google.com/file/d/1f7th6tlhti0swztkfyzpxua6mo7xfu97/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1f7tH6TlhtI0sWzTKFyzpXUA6mO7xfu97/view?usp=drive_link', 'google_drive'),
  (79, 'ankle inversion', 'Ankle Inversion', 'Other', 'other', 'https://youtu.be/v_zjz5movuy?si=440vfa5uttdh4uwa', 'Resistance', 'https://youtu.be/v_zjz5mOvuY?si=440vfa5uTTDh4uwA', 'non_google_drive'),
  (80, 'plate neck extension high range', 'Plate Neck Extension High Range', 'Neck', 'neck', 'https://youtu.be/yrx7bgvx-ze?si=pkysskzihx4lgsee', 'Resistance', 'https://youtu.be/yRX7bGVx-ZE?si=pkysskzihx4lGsee', 'non_google_drive'),
  (81, 'db y-raises', 'Db Y-Raises', 'Shoulders', 'shoulders', 'https://drive.google.com/file/d/1mj3zqcf1nhhdud5eesuanhjvkrenx2fv/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1mj3ZqcF1NHHduD5eesUanhJvKRENX2fV/view?usp=drive_link', 'google_drive'),
  (82, 'jefferson curls', 'Jefferson Curls', 'Other', 'other', 'https://youtu.be/ygladtskqau?si=sfy7bnsopmx8dhbi', 'Mobility', 'https://youtu.be/YGlAdtSKQaU?si=SfY7BNsOpmX8DHBi', 'non_google_drive'),
  (83, 'sa db lateral raises', 'Sa Db Lateral Raises', 'Shoulders', 'shoulders', 'https://drive.google.com/file/d/1jz2apyrzshdkmaoli8dowjokg25ifg5c/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1JZ2APYrZShdKmAOli8dowjoKG25ifg5c/view?usp=drive_link', 'google_drive'),
  (84, 'kneeling push-up', 'Kneeling Push-Up', 'Chest', 'chest', 'https://youtu.be/jwxvty2kros?si=4b7vyt40qjkl6jla', 'Resistance', 'https://youtu.be/jWxvty2KROs?si=4B7VyT40qjkl6jLA', 'non_google_drive'),
  (85, 'bicep curls', 'Bicep Curls', 'Biceps', 'biceps', 'https://youtu.be/pxs-fspwpk8?si=nh78agzcitm5fccx', 'Resistance', 'https://youtu.be/pXS-fSPWpk8?si=Nh78AgZcITm5FCcX', 'non_google_drive'),
  (86, 'dual cable lateral raises', 'Dual Cable Lateral Raises', 'Shoulders', 'shoulders', 'https://drive.google.com/file/d/1jby8xye-c63xabkwqyjqksqquhe5duym/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1JBY8XYe-C63xABkwQYjQkSQqUhe5DuYm/view?usp=drive_link', 'google_drive'),
  (87, 'tibialis anterior standing', 'Tibialis Anterior Standing', 'Other', 'other', 'https://youtu.be/opeuhclstuq?si=ydhl0jqfbfyht1qp', 'Resistance', 'https://youtu.be/OPEuhclsTUQ?si=YdhL0JqFBfyHT1Qp', 'non_google_drive'),
  (88, 'push-ups', 'Push-Ups', 'Chest', 'chest', 'https://drive.google.com/file/d/1df5l3yy0ag7ek0hqopolf9w7wjwmndoc/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1DF5l3yY0aG7EK0HqOpOlf9W7wjwMndOC/view?usp=drive_link', 'google_drive'),
  (89, 'triceps extensions', 'Triceps Extensions', 'Triceps', 'triceps', 'https://youtu.be/a5rudcettse?si=y7zxivdgtzgnyfja', 'Resistance', 'https://youtu.be/a5rUdCeTtSE?si=Y7ZxivdgTZGNYFja', 'non_google_drive'),
  (90, 'db rear delt row', 'Db Rear Delt Row', 'Shoulders', 'shoulders', 'https://drive.google.com/file/d/1rfcs5qaeljwn-wkqcrtdpyvomuzqyhbd/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1RFCS5QaELjwn-wKqcrTdpyVOmUZQYHBd/view?usp=drive_link', 'google_drive'),
  (91, 'dead hanging', 'Dead Hanging', 'Latissimus Dorsi', 'latissimus dorsi', 'https://youtube.com/shorts/xpct3capkyk?si=74swza7q7v9dnqfj', 'Resistance', 'https://youtube.com/shorts/XPcT3capkyk?si=74SWzA7Q7v9dnqFj', 'non_google_drive'),
  (92, 'push up plus', 'Push Up Plus', 'Chest', 'chest', 'https://drive.google.com/file/d/1zdoewxtzis89cfkwnnlw0zj4lzysralv/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1zdOeWxTZIs89CfKWnNLw0ZJ4LZYsrALv/view?usp=drive_link', 'google_drive'),
  (93, 'chest press', 'Chest Press', 'Chest', 'chest', 'https://youtu.be/9ngo4lzd65o?si=jvbbfcr6hpsjwh_8', 'Resistance', 'https://youtu.be/9NGo4lZd65o?si=jvbbFcR6HPSJWH_8', 'non_google_drive'),
  (94, 'y-raises', 'Y-Raises', 'Shoulders', 'shoulders', 'https://drive.google.com/file/d/1iahg0mz0q0dzglbbyvxrjy1qjuncbtx2/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1IaHG0MZ0Q0DzGlBByvXrjY1qjuncBtX2/view?usp=drive_link', 'google_drive'),
  (95, 'db rear delt hyperextension', 'Db Rear Delt Hyperextension', 'Shoulders', 'shoulders', 'https://drive.google.com/file/d/1nxqdfdumrfy_mrwfffqfuapqeyiu5gk_/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1nxqDFdUmRfY_MrWFFFqFUaPQEYIu5Gk_/view?usp=drive_link', 'google_drive'),
  (96, 'single leg stance', 'Single Leg Stance', 'Other', 'other', 'https://youtu.be/wb68ze1oh5c?si=uk7k3j4mabqpgfp0', 'Other', 'https://youtu.be/Wb68ze1oH5c?si=uk7k3J4MaBqPGfP0', 'non_google_drive'),
  (97, 'bent over row', 'Bent Over Row', 'Upper Back', 'upper back', 'https://youtu.be/ebvoodmhdxo?si=hoafmov8s2wvrujl', 'Resistance', 'https://youtu.be/ebVOodMhdxo?si=hoAFmOv8S2wvRuJL', 'non_google_drive'),
  (98, 'cable lateral raises shortened', 'Cable Lateral Raises Shortened', 'Shoulders', 'shoulders', '', 'Resistance', '', 'missing'),
  (99, 'single leg bridging', 'Single Leg Bridging', 'Glutes', 'glutes', 'https://youtu.be/9bl48sv62u4?si=f9qppvzfn6zwsco4', 'Resistance', 'https://youtu.be/9bl48SV62u4?si=f9QppVZfN6zwsCO4', 'non_google_drive'),
  (100, 'banded single sldl', 'Banded Single Sldl', 'Hamstrings & Glutes', 'hamstrings & glutes', 'https://youtu.be/ft7ymamwvsy?si=su1vqz1gts2i1dba', 'Resistance', 'https://youtu.be/FT7yMAMWVsY?si=su1VQz1gTS2i1dBa', 'non_google_drive'),
  (101, 'bird dog', 'Bird Dog', 'Core', 'core', 'https://www.youtube.com/watch?time_continue=20&v=x0fpqejea40&embeds_referring_euri=https%3a%2f%2fwww.rehabhero.ca%2f&source_ve_path=mjm4nte', 'Resistance', 'https://www.youtube.com/watch?time_continue=20&v=X0FpQEjEA40&embeds_referring_euri=https%3A%2F%2Fwww.rehabhero.ca%2F&source_ve_path=MjM4NTE', 'non_google_drive'),
  (102, 'bridging', 'Bridging', 'Glutes', 'glutes', 'https://drive.google.com/file/d/15t8c43r5szfa7xmquxjwiwjk6sper96b/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/15t8C43r5Szfa7XmqUxjWIwjk6SPeR96b/view?usp=drive_link', 'google_drive'),
  (103, 'banded sldl', 'Banded Sldl', 'Hamstrings & Glutes', 'hamstrings & glutes', 'https://youtube.com/shorts/jx3kpxsvsea?si=bsuyxvyvt8_halm8', 'Resistance', 'https://youtube.com/shorts/Jx3KPXSVsEA?si=BsUYXVYVT8_haLM8', 'non_google_drive'),
  (104, 'superman', 'Superman', 'Core', 'core', 'https://www.youtube.com/watch?time_continue=11&v=2_0u1dnuyb8&embeds_referring_euri=https%3a%2f%2fwww.rehabhero.ca%2f&source_ve_path=mjm4nte', 'Resistance', 'https://www.youtube.com/watch?time_continue=11&v=2_0u1dnUyB8&embeds_referring_euri=https%3A%2F%2Fwww.rehabhero.ca%2F&source_ve_path=MjM4NTE', 'non_google_drive'),
  (105, 'barbell squats', 'Barbell Squats', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1tksglz_cf2ezbohrqdkchkfbenag5kdv/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1tkSGLz_cF2eZBoHRQDkCHkFBeNAg5KDv/view?usp=sharing', 'google_drive'),
  (106, 'side lying windmill', 'Side Lying Windmill', 'Other', 'other', 'https://youtu.be/4regvud-7iu?si=otsxhywcutxgl2ei', 'Mobility', 'https://youtu.be/4ReGvUD-7iU?si=OtSxHyWcUtxgl2EI', 'non_google_drive'),
  (107, 'walking lunges', 'Walking Lunges', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1uihhzmwd6jt7fgeo5aoriaklolxeg5bb/view?usp=sharing', 'Resistance', 'https://drive.google.com/file/d/1UihhzMWD6JT7Fgeo5AOriakLOLXEg5bb/view?usp=sharing', 'google_drive'),
  (108, 'banded kick back', 'Banded Kick Back', 'Glutes', 'glutes', 'https://youtube.com/shorts/pahxjayd1y4?si=ih1zaltxr1kjyqwj', 'Resistance', 'https://youtube.com/shorts/paHXJAyd1Y4?si=iH1zALTxr1KJYQWJ', 'non_google_drive'),
  (109, 'banded hip adduction', 'Banded Hip Adduction', 'Other', 'other', 'https://youtu.be/1mrxrnzvz6a?si=ueam3ctwc16zqigc', 'Resistance', 'https://youtu.be/1MrxRNzvZ6A?si=UEam3CTWc16ZqIgc', 'non_google_drive'),
  (110, 'kneeling banded shoulder press', 'Kneeling Banded Shoulder Press', 'Shoulders', 'shoulders', 'https://youtube.com/shorts/zohkt5hvpq0?si=calooahfhjpavmwi', 'Resistance', 'https://youtube.com/shorts/ZOHkT5hVpq0?si=CaLOoAHfHjpaVmWi', 'non_google_drive'),
  (111, 'side lying thoracic rotation', 'Side Lying Thoracic Rotation', 'Other', 'other', 'https://youtube.com/shorts/cncdlzymbxg?si=ltxdxw6unagfgviy', 'Mobility', 'https://youtube.com/shorts/cncdlzYmbxg?si=lTXdxW6uNAGfGvIY', 'non_google_drive'),
  (112, 'banded crunches', 'Banded Crunches', 'Core', 'core', 'https://youtube.com/shorts/iv4kcxyrt6s?si=ae1g3po80eocggte', 'Resistance', 'https://youtube.com/shorts/Iv4kcxYrT6s?si=aE1g3pO80eOcGGTE', 'non_google_drive'),
  (113, 'shoulder external rotation', 'Shoulder External Rotation', 'Shoulders', 'shoulders', 'https://youtube.com/shorts/meuts1w5mci?si=mn5einqtyp64npn2', 'Resistance', 'https://youtube.com/shorts/meUts1w5mcI?si=mn5eINqtYp64NPn2', 'non_google_drive'),
  (114, 'banded shoulder abduction', 'Banded Shoulder Abduction', 'Shoulders', 'shoulders', 'https://www.youtube.com/watch?v=6ou9baoxowq', 'Resistance', 'https://www.youtube.com/watch?v=6OU9BAoXoWQ', 'non_google_drive'),
  (115, 'isometric wrist flexion', 'Isometric Wrist Flexion', 'Other', 'other', 'https://youtu.be/wj0510quzmk?si=vvouz7d2p2t2odhz', 'Resistance', 'https://youtu.be/WJ0510QUzmk?si=vVOuz7d2p2T2OdhZ', 'non_google_drive'),
  (116, 'banded shoulder adduction', 'Banded Shoulder Adduction', 'Other', 'other', 'https://youtu.be/9xa87ja2wtu?si=0zpqvi9q5racui5y', 'Resistance', 'https://youtu.be/9XA87Ja2wTU?si=0ZPQVI9q5rAcUI5Y', 'non_google_drive'),
  (117, 'front lever', 'Front Lever', 'Latissimus Dorsi', 'latissimus dorsi', 'https://youtu.be/jbdaj1nwi-k?si=mw4fytwpy-pycmhz', 'Resistance', 'https://youtu.be/JbDaJ1Nwi-k?si=MW4FYTWPy-PycmHZ', 'non_google_drive'),
  (118, 'banded shoulder extension', 'Banded Shoulder Extension', 'Shoulders', 'shoulders', 'https://youtu.be/ryjch-wlwzi?si=hdnczm9ojrnw6itd', 'Resistance', 'https://youtu.be/RyjcH-wlWzI?si=hDnCZM9OjRnW6iTD', 'non_google_drive'),
  (119, 'handstand', 'Handstand', 'Shoulders', 'shoulders', 'https://youtu.be/-1ghieoo-wg?si=z0de4hc6ygbye3x8', 'Resistance', 'https://youtu.be/-1GhiEoO-Wg?si=Z0dE4HC6yGbye3x8', 'non_google_drive'),
  (120, 'smithmachine rdls', 'Smithmachine Rdls', 'Hamstrings & Glutes', 'hamstrings & glutes', 'https://drive.google.com/file/d/18rgaj8lmnuvjktdant_ycwrh_wvze4-6/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/18rGAj8lMNUvjkTdaNT_YcWrH_wvZe4-6/view?usp=drive_link', 'google_drive'),
  (121, 'banded calf raises', 'Banded Calf Raises', 'Calves', 'calves', 'https://youtu.be/t9okmhc3l30?si=kb9uyjld4noc1wur', 'Resistance', 'https://youtu.be/t9oKMhC3L30?si=kb9UyJLD4nOC1Wur', 'non_google_drive'),
  (122, 'pallof press', 'Pallof Press', 'Core', 'core', 'https://youtu.be/-0n2xti69t8?si=e1iietwtnnln3wfb', 'Resistance', 'https://youtu.be/-0N2xTi69t8?si=E1IieTWTnNLn3WFB', 'non_google_drive'),
  (123, 'bulgarian split squat', 'Bulgarian Split Squat', 'Quadriceps', 'quadriceps', 'https://drive.google.com/file/d/1xnquy3-ra_rbofq7jcm_u6h9mokrq_w7/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1xnQuy3-Ra_RboFq7JcM_U6h9mOKrQ_W7/view?usp=drive_link', 'google_drive'),
  (124, 'banded tibialis ant.', 'Banded Tibialis Ant.', 'Other', 'other', 'https://youtu.be/9mijwdcjy0a?si=deht9mggs8ebvjpc', 'Resistance', 'https://youtu.be/9MiJwDCjY0A?si=deHT9MgGs8EbVJPC', 'non_google_drive'),
  (125, 'farmer''s walk', 'Farmer''s Walk', 'Full Body', 'full body', 'https://www.youtube.com/shorts/ozp9ni_w4xo', 'Resistance', 'https://www.youtube.com/shorts/Ozp9nI_w4xo', 'non_google_drive'),
  (126, 'crunches', 'Crunches', 'Core', 'core', 'https://drive.google.com/file/d/1sodmgrrzdfk5wffni1vyrdxn7fofn_l7/view?usp=drive_link', 'Resistance', 'https://drive.google.com/file/d/1SODMgRrZdfK5wFfNi1VyRDxN7foFn_l7/view?usp=drive_link', 'google_drive'),
  (127, 'resistance band shrug', 'Resistance Band Shrug', 'Upper Back', 'upper back', 'https://youtube.com/shorts/ojhqkdwgxlw?si=lgnxdmzofplsqlza', 'Resistance', 'https://youtube.com/shorts/OjHqkDWGXlw?si=lgNxDmZOfpLSQlza', 'non_google_drive'),
  (128, 'diaphragmatic breathing', 'Diaphragmatic Breathing', 'General', 'general', 'https://youtu.be/q1me3bmx5dc?si=xjnjdb9oso5gjgto', 'Other', 'https://youtu.be/Q1Me3bMx5Dc?si=XjnjdB9oSO5GjgTO', 'non_google_drive'),
  (129, 'calf raises bw', 'Calf Raises Bw', 'Calves', 'calves', 'https://youtu.be/c5kv6-fntj8?si=p9wrnlhqidvt7e7g', 'Resistance', 'https://youtu.be/c5Kv6-fnTj8?si=P9wRNLhqIDVT7E7g', 'non_google_drive'),
  (130, 'overhead with resistance bands', 'Overhead with Resistance Bands', 'Shoulders', 'shoulders', 'https://youtu.be/ewqe_z1hkno?si=lrntaaqxbetqseej', 'Resistance', 'https://youtu.be/Ewqe_z1HKno?si=lRnTaAqXBetqSeeJ', 'non_google_drive'),
  (131, 'banded leg curl', 'Banded Leg Curl', 'Hamstrings', 'hamstrings', 'https://youtu.be/szqs9ol6qvu?si=dpdbjsxyosypumvo', 'Resistance', 'https://youtu.be/Szqs9oL6QVU?si=DPDBjSXyoSyPuMVo', 'non_google_drive');

  SELECT count(*) INTO v_src_rows FROM _drb_src;

  -- ================================================================
  -- 3. DETECT EXISTING MATCHES inside Drbahaa Coaching (active OR
  --    archived, by normalized name). No reactivation convention
  --    exists in the app, so archived matches are left untouched and
  --    reported, never duplicated.
  -- ================================================================
  SELECT count(DISTINCT s.norm_name) INTO v_existing
  FROM _drb_src s
  JOIN public.exercises e
    ON e.workspace_id = v_ws_id
   AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = s.norm_name;

  SELECT count(DISTINCT s.norm_name) INTO v_archived
  FROM _drb_src s
  JOIN public.exercises e
    ON e.workspace_id = v_ws_id
   AND e.is_archived = true
   AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = s.norm_name;

  -- ================================================================
  -- 4. INSERT ONLY MISSING EXERCISES (workspace-scoped, idempotent)
  --    DISTINCT ON collapses the 2 exact intra-dataset duplicates;
  --    NOT EXISTS skips anything already present in Drbahaa Coaching.
  -- ================================================================
  WITH dedup AS (
    SELECT DISTINCT ON (norm_name, norm_muscle, norm_url)
           src_ord, ex_name, ex_muscle, src_cat, ex_url, url_status, norm_name
    FROM _drb_src
    ORDER BY norm_name, norm_muscle, norm_url, src_ord
  )
  INSERT INTO public.exercises (workspace_id, name, muscle_group, category, video_url, tags)
  SELECT
    v_ws_id,
    dedup.ex_name,
    dedup.ex_muscle,
    CASE dedup.ex_muscle
      WHEN 'Biceps' THEN 'arms'
      WHEN 'Triceps' THEN 'arms'
      WHEN 'Quadriceps' THEN 'legs'
      WHEN 'Hamstrings' THEN 'legs'
      WHEN 'Hamstrings & Glutes' THEN 'legs'
      WHEN 'Glutes' THEN 'legs'
      WHEN 'Calves' THEN 'legs'
      WHEN 'Shoulders' THEN 'shoulders'
      WHEN 'Neck' THEN 'other'
      WHEN 'Chest' THEN 'chest'
      WHEN 'Upper Back' THEN 'back'
      WHEN 'Latissimus Dorsi' THEN 'back'
      WHEN 'Core' THEN 'core'
      WHEN 'Full Body' THEN 'full_body'
      WHEN 'General' THEN 'other'
      ELSE 'other'
    END,
    NULLIF(dedup.ex_url, ''),
    ARRAY[lower(trim(dedup.src_cat))]
  FROM dedup
  WHERE NOT EXISTS (
    SELECT 1 FROM public.exercises e
    WHERE e.workspace_id = v_ws_id
      AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = dedup.norm_name
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- ================================================================
  -- 5. DEDUPLICATED SOURCE URL COUNTS — computed over the DISTINCT ON
  --    set (NOT the raw source totals). The 2 duplicate source rows
  --    are both Google Drive, so they collapse: 90 -> 88.
  -- ================================================================
  WITH dedup AS (
    SELECT DISTINCT ON (norm_name, norm_muscle, norm_url)
           url_status
    FROM _drb_src
    ORDER BY norm_name, norm_muscle, norm_url, src_ord
  )
  SELECT
    count(*) FILTER (WHERE url_status = 'google_drive'),
    count(*) FILTER (WHERE url_status = 'non_google_drive'),
    count(*) FILTER (WHERE url_status = 'missing')
  INTO v_google, v_youtube, v_missing
  FROM dedup;

  RAISE NOTICE 'IMPORT RESULT: source_rows=%, unique=%, existing_matches=%, archived_matches=%, inserted=%',
    v_src_rows, v_src_rows - 2, v_existing, v_archived, v_inserted;
  RAISE NOTICE 'DEDUPLICATED SOURCE URL COUNTS: google_drive=%, non_google_drive(youtube)=%, missing=%', v_google, v_youtube, v_missing;

  IF v_inserted <> (129 - v_existing) THEN
    RAISE WARNING 'Unexpected inserted count (%): expected % - existing(%)', v_inserted, 129, v_existing;
  END IF;
END $$;

-- ============================================================
-- POST-IMPORT VERIFICATION (run these in the SQL editor)
-- ============================================================

-- 1. Target workspace (report the resolved id/slug here)
SELECT id AS workspace_id, name, slug
FROM public.workspaces
WHERE name = 'Drbahaa Coaching';

-- 2. Drbahaa Coaching library (google = drive.google.com URLs,
--    youtube = youtube.com / youtu.be URLs, missing = NULL/empty)
SELECT
  count(*)                                                                          AS drbahaa_exercises,
  count(*) FILTER (WHERE video_url LIKE 'https://drive.google.com%')                AS google_drive_urls,
  count(*) FILTER (WHERE video_url LIKE 'https://www.youtube%' OR video_url LIKE 'https://youtu.be%' OR video_url LIKE 'https://youtube.com%') AS youtube_urls,
  count(*) FILTER (WHERE video_url IS NULL OR video_url = '')                       AS missing_urls
FROM public.exercises
WHERE workspace_id = (SELECT id FROM public.workspaces WHERE name = 'Drbahaa Coaching');

-- 3. Active NULL-workspace exercises MUST be 0
SELECT count(*) AS active_null_workspace_exercises
FROM public.exercises
WHERE is_archived = false AND workspace_id IS NULL;

-- 4. Per-workspace distribution (only Drbahaa Coaching changed)
SELECT
  COALESCE(w.name, '(global)') AS workspace_name,
  count(e.id)                   AS exercise_count
FROM public.workspaces w
LEFT JOIN public.exercises e ON e.workspace_id = w.id
GROUP BY w.id, w.name
ORDER BY w.created_at ASC;

-- 5. Duplicate-name check WITHIN Drbahaa Coaching (MUST be 0 active pairs)
SELECT count(*) AS duplicate_named_active_exercises
FROM (
  SELECT lower(trim(regexp_replace(name, '\s+', ' ', 'g'))) AS n
  FROM public.exercises
  WHERE workspace_id = (SELECT id FROM public.workspaces WHERE name = 'Drbahaa Coaching')
    AND is_archived = false
  GROUP BY lower(trim(regexp_replace(name, '\s+', ' ', 'g')))
  HAVING count(*) > 1
) d;
