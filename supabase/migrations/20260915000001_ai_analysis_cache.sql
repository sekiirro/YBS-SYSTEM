-- 20260915000001_ai_analysis_cache.sql
--
-- AI analysis cache for the Client-Centric Nutrition + Training workspace.
--
-- The summarize-nutrition / summarize-training edge functions read a client's
-- submitted onboarding assessment (through the CALLER's RLS-scoped session),
-- ask Gemini to produce a nutrition / training summary with grounded
-- citations, and persist the result here keyed by (assessment_id,
-- analysis_type). A request whose input fingerprint matches the stored
-- fingerprint returns the cached result instead of re-running Gemini, so
-- regenerating an unchanged submission does not burn quota.
--
-- RLS mirrors the assessments 4-gate (platform owner / workspace owner /
-- assigned YBS coach / client self) via a join on assessments, so a caller
-- can only read or write cache rows for an assessment they can already see.
-- Everything here is written through the caller's session — there is no
-- privileged service role in the edge functions.

create table if not exists public.ai_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  analysis_type text not null check (analysis_type in ('nutrition', 'training')),
  input_fingerprint text not null,
  model text not null,
  result jsonb,
  sources jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_analysis_cache_unique_assessment_type unique (assessment_id, analysis_type)
);

create index if not exists idx_ai_analysis_cache_client_updated
  on public.ai_analysis_cache (client_id, updated_at desc);

alter table public.ai_analysis_cache enable row level security;

create policy "ai_analysis_cache_select" on public.ai_analysis_cache
for select to authenticated
using (
  public.is_platform_owner()
  or exists (
    select 1 from public.assessments a
    where a.id = ai_analysis_cache.assessment_id
      and (
        public.is_workspace_owner(a.workspace_id)
        or a.assigned_ybs_coach_id = (select auth.uid())
        or public.is_client_self(a.client_id)
      )
  )
);

create policy "ai_analysis_cache_insert" on public.ai_analysis_cache
for insert to authenticated
with check (
  public.is_platform_owner()
  or exists (
    select 1 from public.assessments a
    where a.id = ai_analysis_cache.assessment_id
      and (
        public.is_workspace_owner(a.workspace_id)
        or a.assigned_ybs_coach_id = (select auth.uid())
        or public.is_client_self(a.client_id)
      )
  )
);

create policy "ai_analysis_cache_update" on public.ai_analysis_cache
for update to authenticated
using (
  public.is_platform_owner()
  or exists (
    select 1 from public.assessments a
    where a.id = ai_analysis_cache.assessment_id
      and (
        public.is_workspace_owner(a.workspace_id)
        or a.assigned_ybs_coach_id = (select auth.uid())
        or public.is_client_self(a.client_id)
      )
  )
)
with check (
  public.is_platform_owner()
  or exists (
    select 1 from public.assessments a
    where a.id = ai_analysis_cache.assessment_id
      and (
        public.is_workspace_owner(a.workspace_id)
        or a.assigned_ybs_coach_id = (select auth.uid())
        or public.is_client_self(a.client_id)
      )
  )
);

create policy "ai_analysis_cache_delete" on public.ai_analysis_cache
for delete to authenticated
using (
  public.is_platform_owner()
  or exists (
    select 1 from public.assessments a
    where a.id = ai_analysis_cache.assessment_id
      and (
        public.is_workspace_owner(a.workspace_id)
        or a.assigned_ybs_coach_id = (select auth.uid())
        or public.is_client_self(a.client_id)
      )
  )
);