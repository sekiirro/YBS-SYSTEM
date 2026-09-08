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
- Zero Base44 runtime dependencies (`__B44_DB__`, `db.auth`, `db.entities` are completely removed).
- **Pending Supabase migrations must be applied to the remote project before the app works fully.** Migrations in `supabase/migrations/` that are not yet pushed/applied to the remote project (`sakvtstauikdrlthhlij`): `20260904000007_workspace_partnership_capacity.sql` (creates `public.partnership_types`, adds `workspaces.partnership_type_id`, capacity/RPC/triggers — until applied, the Create Workspace **Partnership Type** dropdown stays empty), `20260904000008_workout_programming_tracking.sql`, and `20260908000006_meal_replacement_requests.sql` (meal replacement request flow: table + RLS + notify trigger + `approve_meal_replacement_request`/`reject_meal_replacement_request` RPCs — until applied, the client **Replace** button/request flow and the staff **Replacement Requests** page will error), plus `20260908000007_fix_meal_replacement_insert_rls.sql` (repairs the `meal_req_insert` policy so a legitimate client request is not rejected by a workspace-id payload equality — replace the old `meal_req_insert` policy in your SQL editor even if `20260908000006` is already applied), and `20260908000008_assessment_responses_question_id_no_fk.sql` (drops the `assessment_responses.question_id` FK so client Save Progress works for forms whose snapshot question IDs were orphaned when template questions were removed/recreated — until applied, the client **Save Progress** button shows "Failed to save" on affected existing forms). Apply via `supabase db push` (or run the SQL in the Supabase SQL editor) after committing these files.
- **External team invitations (edge functions + Activate).** `generate-trainer-invite` and `generate-owner-invite` now follow the external-invite model: `invite_team_member` mints `platform_invites.token`, the functions return `/activate?token=<token>` URLs, and no Auth user is created at generation time. This depends on migration `20260907000004_team_invitation_tokens.sql` (token column, `get_team_invite` RPC, trainer-membership trigger) being applied, AND both functions being redeployed: `supabase functions deploy generate-trainer-invite` + `generate-owner-invite`. Until then the functions still run the old GoTrue `listUsers`/`generateLink` logic (which can fail with `lookup_failed`).
