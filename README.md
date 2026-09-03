# YBS Coaching OS

Multi-tenant coaching operating system powered by **Supabase**.

## Architecture & Tech Stack

- **Authentication**: Supabase Auth (Phone-first resolution + secure email/password).
- **Database**: Supabase PostgreSQL with strict Row Level Security (RLS).
- **Storage**: Supabase Storage with signed URLs for private client progress photos.
- **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons.

## Local Setup

1. Clone repository and install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env.local`:
   ```env
   VITE_SUPABASE_URL=https://<your-project>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
3. Run local development server:
   ```bash
   npm run dev
   ```
4. Build for production:
   ```bash
   npm run build
   ```

## Roles & Access Control

1. **Platform Owner**: Super-admin with full platform visibility, customer workspace provisioning, and client application approvals.
2. **Workspace Owner**: Brand owner operating an isolated coaching workspace.
3. **YBS Trainers**: Internal coaches with access strictly scoped to assigned clients.
4. **Clients**: Self-registered clients with isolated access to their individual portal (workouts, nutrition, metrics, forms).
