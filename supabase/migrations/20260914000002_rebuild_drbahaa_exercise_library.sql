-- Rebuild the Drbahaa Coaching exercise library from the authoring workbook
-- (EXERCISES LIBRARY Drbahaa.coaching).
--
-- Strategy (idempotent, history-safe, no hard deletes):
--   * source rows matching an existing Drbahaa exercise by normalized name are
--     updated (name/muscle/category/equipment) and reactivated -> IDs preserved,
--     workout_exercises / workout_set_logs references remain valid
--   * source rows with no existing match are inserted
--   * any remaining ACTIVE Drbahaa exercise absent from the source is soft-archived
--   * archived rows are never deleted -> historical references survive
-- Runs as migration owner (RLS bypassed); scoped strictly to the workspace
-- resolved by exact name 'Drbahaa Coaching'. No other workspace is touched.

DO $drb$
DECLARE
  v_ws_id     UUID;
  v_expected  INTEGER;
  v_rec       RECORD;
  v_existing  UUID;
  v_inserted  UUID;
  v_final     INTEGER;
BEGIN
  SELECT id INTO v_ws_id FROM public.workspaces WHERE name = 'Drbahaa Coaching';
  IF v_ws_id IS NULL THEN
    RAISE EXCEPTION 'Drbahaa Coaching workspace not found';
  END IF;
  IF (SELECT count(*) FROM public.workspaces WHERE name = 'Drbahaa Coaching') <> 1 THEN
    RAISE EXCEPTION 'Multiple workspaces named Drbahaa Coaching';
  END IF;

  CREATE TEMP TABLE _drb_src (sort_id INTEGER PRIMARY KEY, name TEXT NOT NULL, muscle_group TEXT, category TEXT, equipment TEXT) ON COMMIT DROP;
  CREATE TEMP TABLE _drb_keep (id UUID PRIMARY KEY) ON COMMIT DROP;

  INSERT INTO _drb_src (sort_id, name, muscle_group, category, equipment) VALUES
(1, 'Costal Cable Press', 'Mid Chest', 'chest', 'Cable'),
(2, 'Dumbbell Row', 'Latissimus Dorsi', 'back', 'Dumbbell'),
(3, 'SA Lat Machine Row', 'Latissimus Dorsi', 'back', 'Machine'),
(4, 'Cable Preacher Curl', 'Biceps', 'arms', 'Cable'),
(5, 'SL Extensions', 'Quadriceps', 'legs', 'Machine'),
(6, 'Seated Leg Curls', 'Hamstrings', 'legs', 'Machine'),
(7, 'Decline Machine Press', 'Lower Chest', 'chest', 'Machine'),
(8, 'Wide Seated Row', 'Latissimus Dorsi', 'back', 'Machine'),
(9, 'Illiac Lat Pulldown', 'Latissimus Dorsi', 'back', 'Machine'),
(10, 'Incline Machine Bicep Curl', 'Biceps', 'arms', 'Machine'),
(11, 'Leg Extensions', 'Quadriceps', 'legs', 'Machine'),
(12, 'Prone Leg Curls', 'Hamstrings', 'legs', 'Machine'),
(13, 'Flat Machine Press Plate Loaded', 'Mid Chest', 'chest', 'Machine'),
(14, 'Upperback Pulldown', 'Upper Back', 'back', 'Machine'),
(15, 'Lat Dumbbell Row', 'Latissimus Dorsi', 'back', 'Dumbbell'),
(16, 'Face Away Curls', 'Biceps', 'arms', 'Machine'),
(17, 'Smith Machine Squat', 'Quadriceps', 'legs', 'Smith Machine'),
(18, 'Smith Machine SLDLs', 'Hamstrings & Glutes', 'legs', 'Smith Machine'),
(19, 'Flat Machine Press Pin Loaded', 'Mid Chest', 'chest', 'Machine'),
(20, 'Wide Row Machine Plate Loaded', 'Latissimus Dorsi', 'back', 'Machine'),
(21, 'Neutral Grip Lat Pulldown', 'Latissimus Dorsi', 'back', 'Machine'),
(22, 'Face In Curls', 'Biceps', 'arms', 'Machine'),
(23, 'Bulgarian Split Squat', 'Quadriceps', 'legs', 'Bodyweight'),
(24, 'Rope Pullthrough', 'Glutes', 'legs', 'Cable'),
(25, 'Cable Fly', 'Mid Chest', 'chest', 'Cable'),
(26, 'Life Fitness Machine Row', 'Latissimus Dorsi', 'back', 'Machine'),
(27, 'Wide Grip Lat Pulldown Pin Loaded', 'Latissimus Dorsi', 'back', 'Machine'),
(28, 'No Cheat Hammer Curls', 'Biceps', 'arms', 'Dumbbell'),
(29, 'Sissy Squat', 'Quadriceps', 'legs', 'Bodyweight'),
(30, 'Hip Extension', 'Glutes', 'legs', 'Machine'),
(31, 'Flat Dumbbell Press', 'Mid Chest', 'chest', 'Dumbbell'),
(32, 'Cable Y-Raises', 'Upper Back', 'back', 'Cable'),
(33, 'Neutral Grip Row', 'Latissimus Dorsi', 'back', 'Machine'),
(34, 'Dumbbell Hammer Preacher Curls', 'Biceps', 'arms', 'Dumbbell'),
(35, 'Leg Press', 'Quadriceps', 'legs', 'Machine'),
(36, 'Hip Thrust', 'Glutes', 'legs', 'Barbell'),
(37, 'Cable Press', 'Mid Chest', 'chest', 'Cable'),
(38, 'Dumbbell Shrugs', 'Upper Traps', 'back', 'Dumbbell'),
(39, 'Wide Grip Lat Pulldown Plate Loaded', 'Latissimus Dorsi', 'back', 'Machine'),
(40, 'Dumbbell Preacher Curl', 'Biceps', 'arms', 'Dumbbell'),
(41, 'Walking Lunges', 'Quadriceps', 'legs', 'Bodyweight'),
(42, 'DB RDLs', 'Hamstrings & Glutes', 'legs', 'Dumbbell'),
(43, 'Butterfly', 'Mid Chest', 'chest', 'Machine'),
(44, 'Smith Machine Row', 'Latissimus Dorsi', 'back', 'Smith Machine'),
(45, 'SA Cable Lat Row', 'Latissimus Dorsi', 'back', 'Cable'),
(46, 'Preacher Curl Machine', 'Biceps', 'arms', 'Machine'),
(47, 'Barbell Squats', 'Quadriceps', 'legs', 'Barbell'),
(48, 'Hip Thrust Machine', 'Glutes', 'legs', 'Machine'),
(49, 'Hoist Flat Machine Press', 'Mid Chest', 'chest', 'Machine'),
(50, 'T-Bar Row', 'Latissimus Dorsi', 'back', 'Barbell'),
(51, 'SA Pullover', 'Latissimus Dorsi', 'back', 'Cable'),
(52, 'Zigzag Biceps Curls', 'Biceps', 'arms', 'Cable'),
(53, 'Hack Squat', 'Quadriceps', 'legs', 'Machine'),
(54, 'Standing Cable Hamstring Curl', 'Hamstrings', 'legs', 'Cable'),
(55, 'Lying Flat Machine Press', 'Mid Chest', 'chest', 'Machine'),
(56, 'Back Extensions', 'Lower Back', 'back', 'Bodyweight'),
(57, 'SA Pulldown', 'Latissimus Dorsi', 'back', 'Cable'),
(58, 'Preacher Curl Machine', 'Biceps', 'arms', 'Machine'),
(59, 'Pendulum Squat', 'Quadriceps', 'legs', 'Machine'),
(60, 'SLDL', 'Hamstrings & Glutes', 'legs', 'Barbell'),
(61, 'Flat Smith Press', 'Mid Chest', 'chest', 'Smith Machine'),
(62, 'Low Row', 'Upper Back', 'back', 'Cable'),
(63, 'SA Lat Row', 'Latissimus Dorsi', 'back', 'Machine'),
(64, 'SA Preacher Curl Machine', 'Biceps', 'arms', 'Machine'),
(65, 'Dumbbell Leg Extensions', 'Quadriceps', 'legs', 'Dumbbell'),
(66, 'Smith-Machine Squat Gluteus Focused', 'Glutes', 'legs', 'Smith Machine'),
(67, 'Cybex Machine Chest Press', 'Mid Chest', 'chest', 'Machine'),
(68, 'Cable Shrugs', 'Upper Traps', 'back', 'Cable'),
(69, 'Wide Grip Lat Pulldown Machine', 'Latissimus Dorsi', 'back', 'Machine'),
(70, 'No Cheat Curls', 'Biceps', 'arms', 'Machine'),
(71, 'Technogym Pec Deck', 'Mid Chest', 'chest', 'Machine'),
(72, 'Low Row Upperback Biased', 'Upper Back', 'back', 'Machine'),
(73, 'Cable Shoulder Adduction', 'Latissimus Dorsi', 'back', 'Cable'),
(74, 'Pin Loaded Leg Press', 'Quadriceps', 'legs', 'Machine'),
(75, 'Life Fitness Pectoral Fly', 'Mid Chest', 'chest', 'Machine'),
(76, 'Machine Shrugs', 'Upper Traps', 'back', 'Machine'),
(77, 'Low Row Lat Biased', 'Latissimus Dorsi', 'back', 'Machine'),
(78, 'Reverse Nordic Curl', 'Quadriceps', 'legs', 'Bodyweight'),
(79, 'Cable Kickback', 'Glutes', 'legs', 'Cable'),
(80, 'Clavicular', 'Upper Chest', 'chest', 'Machine'),
(81, 'Bent Over Barbell Row', 'Latissimus Dorsi', 'back', 'Barbell'),
(82, 'Close Grip Seated Lat Row', 'Latissimus Dorsi', 'back', 'Machine'),
(83, 'Cable Wrist Curls', 'Forearms', 'arms', 'Cable'),
(84, 'Clavicular Cable Fly', 'Upper Chest', 'chest', 'Cable'),
(85, 'Smith Machine Shrugs', 'Upper Traps', 'back', 'Smith Machine'),
(86, 'Pullover Machine', 'Latissimus Dorsi', 'back', 'Machine'),
(87, 'Lengthened Wrist Curls', 'Forearms', 'arms', 'Dumbbell'),
(88, 'Clavicular Cable Press', 'Upper Chest', 'chest', 'Cable'),
(89, 'Kelso Shrugs', 'Upper Traps', 'back', 'Dumbbell'),
(90, 'Pullups', 'Latissimus Dorsi', 'back', 'Bodyweight'),
(91, 'Wrist Curls', 'Forearms', 'arms', 'Barbell'),
(92, 'SA Clavicular Fly', 'Upper Chest', 'chest', 'Cable'),
(93, 'Overhead Shrugs On Smith', 'Upper Traps', 'back', 'Smith Machine'),
(94, 'Clavicular Press Machine', 'Upper Chest', 'chest', 'Machine'),
(95, 'Overhead Abduction', 'Upper Back', 'back', 'Machine'),
(96, 'SA Cable Reverse Curls', 'Forearms', 'arms', 'Cable'),
(97, 'Incline Smith Machine Press', 'Upper Chest', 'chest', 'Smith Machine'),
(98, 'Cable Reverse Curls', 'Forearms', 'arms', 'Cable'),
(99, 'Incline Dumbbell Press', 'Upper Chest', 'chest', 'Dumbbell'),
(100, 'Lower Traps', 'Upper Back', 'back', 'Machine'),
(101, 'Wrist Extensions', 'Forearms', 'arms', 'Barbell'),
(102, 'Incline Cable Press', 'Upper Chest', 'chest', 'Cable'),
(103, 'Straight Arm Dips', 'Latissimus Dorsi', 'back', 'Bodyweight'),
(104, 'DB Wrist Curls', 'Forearms', 'arms', 'Dumbbell'),
(105, 'Incline Machine Press Pin Loaded', 'Upper Chest', 'chest', 'Machine'),
(106, 'Seated Straight Arm Dips', 'Latissimus Dorsi', 'back', 'Machine'),
(107, 'Farmers Walk', 'Forearms', 'arms', 'Barbell'),
(108, 'Incline Machine Press Plate Loaded', 'Upper Chest', 'chest', 'Machine'),
(109, 'Serratus Ant.', 'Serratus Anterior', 'chest', 'Bodyweight'),
(110, 'Dumbbell Pronation - Supination', 'Forearms', 'arms', 'Dumbbell'),
(111, 'Matrix Incline Machine Press', 'Upper Chest', 'chest', 'Machine'),
(112, 'SA Scapular Protraction', 'Serratus Anterior', 'chest', 'Bodyweight'),
(113, 'Machine Shoulder Press', 'Shoulders', 'shoulders', 'Machine'),
(114, 'Side Step Ups', 'Glutes', 'legs', 'Bodyweight'),
(115, 'Leg Press SL Calf Raises', 'Calves', 'legs', 'Machine'),
(116, 'SA Overhead Extension High To Low', 'Triceps', 'arms', 'Cable'),
(117, 'Hip Adduction Machine', 'Adductors', 'legs', 'Machine'),
(118, 'Rope Crunches', 'Core', 'core', 'Cable'),
(119, 'Seated Dumbbell Press', 'Shoulders', 'shoulders', 'Dumbbell'),
(120, 'Push Up Plus', 'Serratus Anterior', 'chest', 'Bodyweight'),
(121, 'Single Standing Calf Raises', 'Calves', 'legs', 'Bodyweight'),
(122, 'SA Triceps Pushdown', 'Triceps', 'arms', 'Cable'),
(123, 'Hip Abduction Machine', 'Abductors', 'legs', 'Machine'),
(124, 'Plank', 'Core', 'core', 'Bodyweight'),
(125, 'Dumbbell Lateral Raises', 'Lateral Deltoids', 'shoulders', 'Dumbbell'),
(126, 'Sit-Ups', 'Core', 'core', 'Bodyweight'),
(127, 'Standing Calf Raises', 'Calves', 'legs', 'Bodyweight'),
(128, 'SA Triceps Overhead Extension', 'Triceps', 'arms', 'Cable'),
(129, 'Cable Hip Abduction', 'Abductors', 'legs', 'Cable'),
(130, 'Crunches', 'Core', 'core', 'Bodyweight'),
(131, 'Cable Lateral Raises', 'Lateral Deltoids', 'shoulders', 'Cable'),
(132, 'QL Extensions', 'Quadratus Lumborum', 'core', 'Bodyweight'),
(133, 'Dumbbell Skull Crusher', 'Triceps', 'arms', 'Dumbbell'),
(134, 'Cable Hip Adduction', 'Adductors', 'legs', 'Cable'),
(135, 'Lengthened Cable Crunches', 'Core', 'core', 'Cable'),
(136, 'Cable Rear Delt Fly', 'Rear Deltoids', 'shoulders', 'Cable'),
(137, 'Pallof Rotation', 'Core', 'core', 'Cable'),
(138, 'Overcoming Isometrics', 'Calves', 'legs', 'Bodyweight'),
(139, 'Panatta French Press Machine', 'Triceps', 'arms', 'Machine'),
(140, 'TVA Rotation', 'Core', 'core', 'Bodyweight'),
(141, 'DB Front Raises', 'Deltoids', 'shoulders', 'Dumbbell'),
(142, 'External Rotation', 'Rotator Cuff', 'shoulders', 'Cable'),
(143, 'Vacuum', 'Core', 'core', 'Bodyweight'),
(144, 'Reverse Pec Dec', 'Rear Deltoids', 'shoulders', 'Machine'),
(145, 'Cable QL Extensions', 'Quadratus Lumborum', 'core', 'Cable'),
(146, 'Overcoming Isometric Tricep Pushdown', 'Triceps', 'arms', 'Other'),
(147, 'Machine Crunch', 'Core', 'core', 'Machine'),
(148, 'Seated Machine Lateral Raises', 'Lateral Deltoids', 'shoulders', 'Machine'),
(149, 'Single Leg Raises', 'Core', 'core', 'Bodyweight'),
(150, 'Overcoming Isometric Overhead Press', 'Shoulders', 'shoulders', 'Other'),
(151, 'JM Press', 'Triceps', 'arms', 'Barbell'),
(152, 'Shoulder Press Machine PL', 'Shoulders', 'shoulders', 'Machine'),
(153, 'Bridging', 'Glutes', 'legs', 'Bodyweight'),
(154, 'Zigzag Pushdown', 'Triceps', 'arms', 'Cable'),
(155, 'Neck Flexion Plate', 'Neck', 'other', 'Plate'),
(156, 'Cable Hyperextension', 'Rear Deltoids', 'shoulders', 'Cable'),
(157, 'Ankle Eversion', 'Calves', 'legs', 'Bodyweight'),
(158, 'Khairy Pushdown', 'Triceps', 'arms', 'Cable'),
(159, 'Plate Neck Extension "Small Range"', 'Neck', 'other', 'Plate'),
(160, 'SA Y-Raises', 'Rear Deltoids', 'shoulders', 'Cable'),
(161, 'Ankle Inversion', 'Calves', 'legs', 'Bodyweight'),
(162, 'Plate Neck Extension High Range', 'Neck', 'other', 'Plate'),
(163, 'DB Y-Raises', 'Rear Deltoids', 'shoulders', 'Dumbbell'),
(164, 'Jefferson Curls', 'Hamstrings', 'legs', 'Barbell'),
(165, 'Neck Lateral Flexion', 'Neck', 'other', 'Bodyweight'),
(166, 'SA DB Lateral Raises', 'Lateral Deltoids', 'shoulders', 'Dumbbell'),
(167, 'Copenhagen Plank', 'Adductors', 'legs', 'Bodyweight'),
(168, 'Kneeling Push-Up', 'Chest', 'chest', 'Bodyweight'),
(169, 'Bicep Curls', 'Biceps', 'arms', 'Resistance Band'),
(170, 'Dual Cable Lateral Raises', 'Lateral Deltoids', 'shoulders', 'Cable'),
(171, 'Tibialis Anterior Standing', 'Calves', 'legs', 'Bodyweight'),
(172, 'Push-Ups', 'Chest', 'chest', 'Bodyweight'),
(173, 'Triceps Extensions', 'Triceps', 'arms', 'Resistance Band'),
(174, 'DB Rear Delt Row', 'Rear Deltoids', 'shoulders', 'Dumbbell'),
(175, 'Dead Hanging', 'Latissimus Dorsi', 'back', 'Bodyweight'),
(176, 'Push Up Plus', 'Serratus Anterior', 'chest', 'Bodyweight'),
(177, 'Chest Press', 'Chest', 'chest', 'Resistance Band'),
(178, 'Y-Raises', 'Upper Back', 'back', 'Bodyweight'),
(179, 'DB Rear Delt Hyperextension', 'Rear Deltoids', 'shoulders', 'Dumbbell'),
(180, 'Single Leg Stance', 'Core', 'core', 'Bodyweight'),
(181, 'Sit-Ups', 'Core', 'core', 'Bodyweight'),
(182, 'Bent Over Row', 'Latissimus Dorsi', 'back', 'Resistance Band'),
(183, 'Cable Lateral Raises Shortened', 'Lateral Deltoids', 'shoulders', 'Cable'),
(184, 'Single Leg Bridging', 'Glutes', 'legs', 'Bodyweight'),
(185, 'Single Leg Raises', 'Core', 'core', 'Bodyweight'),
(186, 'Banded Single SLDL', 'Hamstrings & Glutes', 'legs', 'Resistance Band'),
(187, 'Bird Dog', 'Core', 'core', 'Bodyweight'),
(188, 'Bridging', 'Glutes', 'legs', 'Bodyweight'),
(189, 'Banded SLDL', 'Hamstrings & Glutes', 'legs', 'Resistance Band'),
(190, 'Superman', 'Lower Back', 'back', 'Bodyweight'),
(191, 'Barbell Squats', 'Quadriceps', 'legs', 'Barbell'),
(192, 'Banded Leg Extensions', 'Quadriceps', 'legs', 'Resistance Band'),
(193, 'Side Lying Windmill', 'Core', 'core', 'Bodyweight'),
(194, 'Walking Lunges', 'Quadriceps', 'legs', 'Bodyweight'),
(195, 'Banded Kick Back', 'Glutes', 'legs', 'Resistance Band'),
(196, 'External Rotation', 'Rotator Cuff', 'shoulders', 'Bodyweight'),
(197, 'Cable Leg Raises', 'Core', 'core', 'Cable'),
(198, 'Banded Hip Adduction', 'Adductors', 'legs', 'Resistance Band'),
(199, 'Internal Rotation', 'Rotator Cuff', 'shoulders', 'Resistance Band'),
(200, 'Airplane "Hip Internal Rotation"', 'Glutes', 'legs', 'Bodyweight'),
(201, 'Kneeling Banded Shoulder Press', 'Shoulders', 'shoulders', 'Resistance Band'),
(202, 'Side Lying Thoracic Rotation', 'Core', 'core', 'Bodyweight'),
(203, 'Banded Crunches', 'Core', 'core', 'Resistance Band'),
(204, 'Shoulder External Rotation', 'Rotator Cuff', 'shoulders', 'Bodyweight'),
(205, 'Banded Shoulder Abduction', 'Lateral Deltoids', 'shoulders', 'Resistance Band'),
(206, 'Isometric Wrist Flexion', 'Forearms', 'arms', 'Other'),
(207, 'Banded Shoulder Adduction', 'Latissimus Dorsi', 'back', 'Resistance Band'),
(208, 'Front Lever', 'Core', 'core', 'Bodyweight'),
(209, 'Plank', 'Core', 'core', 'Bodyweight'),
(210, 'Banded Shoulder Extension', 'Latissimus Dorsi', 'back', 'Resistance Band'),
(211, 'Hand Stand', 'Shoulders', 'shoulders', 'Bodyweight'),
(212, 'Smith Machine RDLs', 'Hamstrings & Glutes', 'legs', 'Smith Machine'),
(213, 'Banded Calf Raises', 'Calves', 'legs', 'Resistance Band'),
(214, 'Pallof Press', 'Core', 'core', 'Cable'),
(215, 'Bulgarian Split Squat', 'Quadriceps', 'legs', 'Bodyweight'),
(216, 'Banded Tibialis Ant.', 'Calves', 'legs', 'Resistance Band'),
(217, 'Farmer''s Walk', 'Forearms', 'arms', 'Barbell'),
(218, 'Crunches', 'Core', 'core', 'Bodyweight'),
(219, 'Resistance Band Shrug', 'Upper Traps', 'back', 'Resistance Band'),
(220, 'Diaphragmatic Breathing', 'Core', 'core', 'Bodyweight'),
(221, 'Calf Raises BW', 'Calves', 'legs', 'Bodyweight'),
(222, 'OVH With Resistance Bands', 'Shoulders', 'shoulders', 'Resistance Band'),
(223, 'Prone T Y Raises', 'Upper Back', 'back', 'Bodyweight'),
(224, 'Banded Leg Curl', 'Hamstrings', 'legs', 'Resistance Band');

  v_expected := (SELECT count(*) FROM _drb_src);

  FOR v_rec IN SELECT * FROM _drb_src ORDER BY sort_id LOOP
    SELECT e.id INTO v_existing
      FROM public.exercises e
     WHERE e.workspace_id = v_ws_id
       AND NOT EXISTS (SELECT 1 FROM _drb_keep k WHERE k.id = e.id)
       AND lower(trim(regexp_replace(e.name, '\s+', ' ', 'g'))) = lower(trim(regexp_replace(v_rec.name, '\s+', ' ', 'g')))
     ORDER BY e.is_archived ASC, e.created_at ASC
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      INSERT INTO _drb_keep (id) VALUES (v_existing);
      UPDATE public.exercises
         SET name = v_rec.name,
             muscle_group = v_rec.muscle_group,
             category = v_rec.category,
             equipment = v_rec.equipment,
             is_archived = false,
             updated_at = now()
       WHERE id = v_existing;
    ELSE
      INSERT INTO public.exercises (workspace_id, name, muscle_group, category, equipment)
      VALUES (v_ws_id, v_rec.name, v_rec.muscle_group, v_rec.category, v_rec.equipment)
      RETURNING id INTO v_inserted;
      INSERT INTO _drb_keep (id) VALUES (v_inserted);
    END IF;
  END LOOP;

  UPDATE public.exercises
     SET is_archived = true,
         updated_at = now()
   WHERE workspace_id = v_ws_id
     AND NOT is_archived
     AND NOT EXISTS (SELECT 1 FROM _drb_keep k WHERE k.id = public.exercises.id);

  v_final := (SELECT count(*) FROM public.exercises WHERE workspace_id = v_ws_id AND NOT is_archived);
  IF v_final <> v_expected THEN
    RAISE EXCEPTION 'Drbahaa library count mismatch: expected %, got %', v_expected, v_final;
  END IF;

  RAISE NOTICE 'Drbahaa exercise library rebuilt: % active rows', v_final;
END;
$drb$;
