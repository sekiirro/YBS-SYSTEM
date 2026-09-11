# AGENTS.md

## Project Context

This is the YBS Coaching OS repository migrated to **Supabase**.
Treat it as user-owned application code, keep changes focused on the user's request, and preserve existing project conventions.

## Architecture

- **Database & Auth**: Supabase PostgreSQL with Row Level Security (RLS) and Supabase Auth.
- **Frontend**: React + Vite using Tailwind CSS and Radix UI primitives.
- **Service Layer**: Centralized Supabase data-access services in `src/services/` (workspaces, clients, subscriptions, packages, assessments, metrics, nutrition, workouts, foods, exercises, team, notifications, audit, storage).
- **Authentication & Roles**: Strictly driven by trusted Supabase `profiles` and `workspace_memberships` rows through `AuthContext.jsx` and `ybs-auth.js`.
- **File Storage**: Private Supabase Storage bucket for client progress photos with time-limited signed URLs (`src/services/storage.js`).

## Key Files

- `src/`: frontend application source.
- `src/utils/supabase.ts`: Supabase client initialization.
- `src/services/`: Supabase data-access and storage services.
- `src/lib/AuthContext.jsx`: canonical auth session provider.
- `vite.config.js`: standard Vite React configuration.
- `.env.local`: local environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).

## Working Notes

- Use `npm run dev` for local development.
- Build verification: `npm run build`.
- **Phase 4 Form Automation is APPLIED to the remote project.** Migration `20260910000004_form_automation_rules.sql` creates `public.form_assignment_rules` + `public.form_assignment_instances`, the SECURITY DEFINER RPCs (`create_form_assignment_rule`, `update_form_assignment_rule`, `set_form_assignment_rule_enabled`, `delete_form_assignment_rule`, `renew_subscription`), replaces the hardcoded master-intake block inside `public.on_client_application_approved()` with `evaluate_form_rules_for_approval`, seeds the default **Your First Step** rule, adds the nutrition/workout combined trigger + `workout_plans` insert/update trigger, and schedules the pg_cron weekly/biweekly sweeper. The migration was applied manually and repaired into the migration history; full remote verification (round 2) passed. Note: `renew_subscription` is the new Trigger-5 event path — renewal form rules fire only through this RPC.
- Zero Base44 runtime dependencies (`__B44_DB__`, `db.auth`, `db.entities` are completely removed).
- **Pending Supabase migrations must be applied to the remote project before the app works fully.** Migrations in `supabase/migrations/` that are not yet pushed/applied to the remote project (`sakvtstauikdrlthhlij`): `20260904000007_workspace_partnership_capacity.sql` (creates `public.partnership_types`, adds `workspaces.partnership_type_id`, capacity/RPC/triggers — until applied, the Create Workspace **Partnership Type** dropdown stays empty), `20260904000008_workout_programming_tracking.sql`, and `20260908000006_meal_replacement_requests.sql` (meal replacement request flow: table + RLS + notify trigger + `approve_meal_replacement_request`/`reject_meal_replacement_request` RPCs — until applied, the client **Replace** button/request flow and the staff **Replacement Requests** page will error), plus `20260908000007_fix_meal_replacement_insert_rls.sql` (repairs the `meal_req_insert` policy so a legitimate client request is not rejected by a workspace-id payload equality — replace the old `meal_req_insert` policy in your SQL editor even if `20260908000006` is already applied), and `20260908000008_assessment_responses_question_id_no_fk.sql` (drops the `assessment_responses.question_id` FK so client Save Progress works for forms whose snapshot question IDs were orphaned when template questions were removed/recreated — until applied, the client **Save Progress** button shows "Failed to save" on affected existing forms). Apply via `supabase db push` (or run the SQL in the Supabase SQL editor) after committing these files.
- **External team invitations (edge functions + Activate).** `generate-trainer-invite` and `generate-owner-invite` now follow the external-invite model: `invite_team_member` mints `platform_invites.token`, the functions return `/activate?token=<token>` URLs, and no Auth user is created at generation time. This depends on migration `20260907000004_team_invitation_tokens.sql` (token column, `get_team_invite` RPC, trainer-membership trigger) being applied, AND both functions being redeployed: `supabase functions deploy generate-trainer-invite` + `generate-owner-invite`. Until then the functions still run the old GoTrue `listUsers`/`generateLink` logic (which can fail with `lookup_failed`).
- **Phase 5 Structured Package Features.** Migration `20260910000005_package_features.sql` adds `public.package_features` (id/package_id/title/sort_order/is_active; RLS SELECT-only mirroring `packages_select`, no write policies), backfills rows from the legacy `packages.features` TEXT[] projection, adds `subscriptions.features` snapshot column + INSERT-only `snapshot_subscription_features` trigger + historical backfill, adds the SECURITY DEFINER `sync_package_features(p_package_id, p_items jsonb)` RPC as the ONLY features write path (owner-scope check, upsert/soft-delete reconcile, rebuilds `packages.features` + `packages.updated_at`, one aggregated `package_features_updated` audit row per real diff), and redefines `clone_default_packages_for_workspace` to clone feature rows into workspace packages. `packages.features` remains a read-only projection; the editor (`src/pages/Packages.jsx` FeaturesEditor) persists rename/add/delete/reorder through `PackagesService.listFeatures`/`saveFeatures` (RPC), while scalar edits keep using `PackagesService.update`. Historical subscription snapshots are immutable — editing a package never rewrites past `subscriptions.features`. Apply via `supabase db push` (or run the SQL in the Supabase SQL editor) before testing the Features editor; until applied, editing features on the Packages page shows "Failed to save" and new subscriptions get no snapshot.
- **Phase 6 Exercise Planner Enhancements (Session Ordering, Duplicate, Rest Day Items).** Migration `20260911000001_workout_session_ordering_and_rest_days.sql` adds `day_type TEXT NOT NULL DEFAULT 'session' CHECK (day_type IN ('session', 'rest_day'))` to `public.workout_days`, backfills existing rest day rows, establishes bi-directional sync trigger `trg_sync_workout_day_type` between `day_type` and `rest_day` boolean for full backward compatibility, and adds composite index `idx_workout_days_plan_sort` on `(workout_plan_id, sort_order ASC)`. In the application layer, `WorkoutsService` supports resilient insert fallback, session drag & drop reordering (`@hello-pangea/dnd`), deep-copy duplication with deterministic naming ("Upper 1" -> "Upper 2"), and first-class Rest Day items with dedicated instructions modal and recovery view. Apply via `supabase db push` or SQL editor.

