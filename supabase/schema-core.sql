-- ============================================================================
-- DogWalkr CORE — normalized schema for the lean Strava companion.
-- "Strava records the human. DogWalkr remembers the dog."
--
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)
-- AFTER the existing schema.sql (it depends on public.dogs already existing).
--
-- ─── WHY THE `core_` PREFIX ────────────────────────────────────────────────
-- This project's live database ALREADY has a table called `public.dog_activities`
-- (from an earlier build — see DOGWALKR_LAUNCH_ROADMAP.md). It is a Strava-
-- import table with a UNIQUE constraint on `strava_activity_id`, so ONE Strava
-- activity can only ever belong to ONE dog there. That directly conflicts with
-- Build Rule 5 (one activity split across multiple dogs). We must not drop,
-- rename or repurpose it (it holds real rows), so DogWalkr Core uses two
-- clearly-namespaced NEW tables instead:
--
--   core_activities      — the canonical human outing (source-agnostic, never
--                          a GPS re-record). One row per real-world walk/run.
--   core_dog_activities  — the normalized per-dog record. ONE ROW PER DOG PER
--                          ACTIVITY. Distance + both durations are copied in,
--                          so every dog's lifetime graph is fully independent.
--
-- ─── 100% NON-DESTRUCTIVE ─────────────────────────────────────────────────
-- Zero drop / truncate / delete / destructive-alter statements. Every
-- statement is `create ... if not exists`, `alter table ... add column if not
-- exists`, `enable row level security`, a guarded `create policy`, or a
-- guarded `create view`. Re-running the whole file is safe and idempotent.
-- The only pre-existing table named here is public.dogs, and only as a
-- foreign-key target (read-only). The legacy `dog_activities` table is NOT
-- touched by this file at all.
--
-- Auth model: same as the rest of this app — one shared anon key, no real
-- per-user auth. RLS is enabled with permissive anon policies to stop
-- accidental breakage, NOT as a security boundary.
-- ============================================================================

create extension if not exists pgcrypto;

-- ==========================================================================
-- core_activities: one row per real-world human outing.
--
--   source        'strava' (canonical fast path), 'manual' (the quiet
--                 "+ Log Walk" fallback), or a future importer.
--   external_id   the source system's own id (Strava activity id as text);
--                 NULL for manual. (source, external_id) is unique so a
--                 re-sync never double-imports.
--   distance_km   distance of the outing in kilometres.
--   elapsed_seconds  THE DOG'S TRUTH — Strava elapsed_time, wall-clock
--                 start-to-finish including every sniff stop / auto-pause.
--   moving_seconds   THE HUMAN'S TRUTH — Strava moving_time, the number a
--                 runner chases for a PB. Stored, never discarded. For a
--                 manual entry with no split it equals elapsed_seconds.
--   started_at    when the outing began (Strava start_date; user-picked for manual).
--   device_id     which device's Strava connection synced this; NULL for manual.
--   assigned      false until at least one dog is attributed — the Core
--                 "Who came along?" card shows every row where assigned = false.
--   notes / stool_score / photo_url
--                 optional observations from Kate's handcrafted "Record
--                 Walkout" modal (manual entries + edits). NULL for Strava
--                 imports. Not medical claims — just the fields her walk log
--                 already had, kept so the polished modal works verbatim.
-- ==========================================================================
create table if not exists public.core_activities (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual'
    check (source in ('strava', 'manual', 'apple_health', 'garmin')),
  external_id text,
  title text,
  distance_km numeric,
  elapsed_seconds integer,
  moving_seconds integer,
  started_at timestamptz,
  device_id text,
  assigned boolean not null default false,
  notes text,
  stool_score integer,
  photo_url text,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists core_activities_started_at_idx on public.core_activities (started_at desc);
create index if not exists core_activities_unassigned_idx on public.core_activities (assigned) where assigned = false;

alter table public.core_activities enable row level security;

-- ==========================================================================
-- core_dog_activities: the NORMALIZED DOG RECORD. One row per (activity, dog).
--
-- Distance and BOTH durations are copied in from the parent activity at
-- assignment time — deliberate, not redundant: it makes each dog's lifetime
-- graph a plain `select ... where dog_id = ?`. Assigning one 5 km walk to
-- Jess AND Bonnie writes two rows, each with the FULL 5 km and the full
-- elapsed/moving time. No splitting or halving (Build Rule 5).
--
-- occurred_at mirrors core_activities.started_at — the real-world outing time
-- every per-dog chart and "this week" rollup buckets on.
--
-- Deleting a core_activities row cascades and clears every dog's row for it.
-- unique (activity_id, dog_id) — a dog can't be double-added to one activity,
-- but many dogs CAN share one activity (the many-to-many the legacy
-- dog_activities table could not express).
-- ==========================================================================
create table if not exists public.core_dog_activities (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.core_activities(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  source text not null default 'manual',
  external_id text,
  title text,
  distance_km numeric,
  elapsed_seconds integer,
  moving_seconds integer,
  occurred_at timestamptz,
  notes text,
  stool_score integer,
  photo_url text,
  created_at timestamptz not null default now(),
  unique (activity_id, dog_id)
);

create index if not exists core_dog_activities_dog_id_occurred_idx
  on public.core_dog_activities (dog_id, occurred_at desc);
create index if not exists core_dog_activities_activity_id_idx
  on public.core_dog_activities (activity_id);

alter table public.core_dog_activities enable row level security;

-- ==========================================================================
-- Column top-ups — for a database that already created these tables from an
-- earlier draft of this file without every column. `add column if not exists`
-- is a no-op when the column is present and never rewrites existing data.
-- ==========================================================================
alter table public.core_activities     add column if not exists title           text;
alter table public.core_activities     add column if not exists distance_km      numeric;
alter table public.core_activities     add column if not exists elapsed_seconds  integer;
alter table public.core_activities     add column if not exists moving_seconds   integer;
alter table public.core_activities     add column if not exists started_at       timestamptz;
alter table public.core_activities     add column if not exists device_id        text;
alter table public.core_activities     add column if not exists assigned         boolean not null default false;
alter table public.core_activities     add column if not exists notes            text;
alter table public.core_activities     add column if not exists stool_score      integer;
alter table public.core_activities     add column if not exists photo_url        text;

alter table public.core_dog_activities add column if not exists source           text not null default 'manual';
alter table public.core_dog_activities add column if not exists external_id      text;
alter table public.core_dog_activities add column if not exists title            text;
alter table public.core_dog_activities add column if not exists distance_km      numeric;
alter table public.core_dog_activities add column if not exists elapsed_seconds  integer;
alter table public.core_dog_activities add column if not exists moving_seconds   integer;
alter table public.core_dog_activities add column if not exists occurred_at      timestamptz;
alter table public.core_dog_activities add column if not exists notes            text;
alter table public.core_dog_activities add column if not exists stool_score      integer;
alter table public.core_dog_activities add column if not exists photo_url        text;

-- ==========================================================================
-- RLS policies — created only if missing, never dropped. Postgres has no
-- "create policy if not exists", so this DO block checks pg_policies first.
-- Permissive anon policies, matching every other table in this project.
-- ==========================================================================
do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('core_activities',     'core anon read core_activities',      'select', 'using (true)'),
      ('core_activities',     'core anon insert core_activities',    'insert', 'with check (true)'),
      ('core_activities',     'core anon update core_activities',    'update', 'using (true) with check (true)'),
      ('core_activities',     'core anon delete core_activities',    'delete', 'using (true)'),
      ('core_dog_activities', 'core anon read core_dog_activities',   'select', 'using (true)'),
      ('core_dog_activities', 'core anon insert core_dog_activities', 'insert', 'with check (true)'),
      ('core_dog_activities', 'core anon update core_dog_activities', 'update', 'using (true) with check (true)'),
      ('core_dog_activities', 'core anon delete core_dog_activities', 'delete', 'using (true)')
    ) as t(tbl, pol, cmd, clause)
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = p.tbl and policyname = p.pol
    ) then
      execute format('create policy %I on public.%I for %s to anon %s', p.pol, p.tbl, p.cmd, p.clause);
    end if;
  end loop;
end $$;

-- ==========================================================================
-- core_dog_activity_totals: convenience view for the hero card's lifetime /
-- year-to-date rollups. Distance, outing time, frequency, consistency only —
-- no calorie / pseudo-medical fields (Build Rule 4). Created only if absent
-- (no destructive "create or replace"); drop it by hand to redefine.
-- ==========================================================================
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'core_dog_activity_totals'
  ) then
    execute $view$
      create view public.core_dog_activity_totals as
      select
        da.dog_id,
        count(*)                                        as outings_total,
        coalesce(sum(da.distance_km), 0)                as distance_km_total,
        coalesce(sum(da.elapsed_seconds), 0)            as elapsed_seconds_total,
        coalesce(sum(da.moving_seconds), 0)             as moving_seconds_total,
        count(*) filter (where da.occurred_at >= date_trunc('year', now()))
                                                        as outings_ytd,
        coalesce(sum(da.distance_km) filter (where da.occurred_at >= date_trunc('year', now())), 0)
                                                        as distance_km_ytd,
        coalesce(sum(da.elapsed_seconds) filter (where da.occurred_at >= date_trunc('year', now())), 0)
                                                        as elapsed_seconds_ytd,
        count(*) filter (where da.occurred_at >= now() - interval '7 days')
                                                        as outings_7d,
        coalesce(sum(da.distance_km) filter (where da.occurred_at >= now() - interval '7 days'), 0)
                                                        as distance_km_7d,
        coalesce(sum(da.elapsed_seconds) filter (where da.occurred_at >= now() - interval '7 days'), 0)
                                                        as elapsed_seconds_7d,
        max(da.occurred_at)                             as last_outing_at
      from public.core_dog_activities da
      group by da.dog_id;
    $view$;
  end if;
end $$;

-- ==========================================================================
-- Refresh the PostgREST schema cache so the REST / JS client sees the new
-- tables immediately (a freshly created table otherwise 404s as "Could not
-- find the table 'public.core_activities' in the schema cache" for a minute
-- or two). Harmless to run any time.
-- ==========================================================================
notify pgrst, 'reload schema';

-- ==========================================================================
-- Alpha cohort dog seed (Audrey, Bonnie, Jess) is a plain INSERT into the
-- existing public.dogs table, kept in its own optional file so this one
-- stays purely structural:  supabase/seed-core-dogs.sql
-- ==========================================================================
