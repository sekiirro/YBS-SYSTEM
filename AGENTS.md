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
