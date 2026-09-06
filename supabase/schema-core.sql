-- ============================================================================
-- DogWalkr CORE — normalized schema for the lean Strava companion.
-- "Strava records the human. DogWalkr remembers the dog."
--
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)
-- AFTER the existing schema.sql (it depends on public.dogs already existing).
--
-- This file is ADDITIVE. It does not touch the legacy suite tables
-- (walks, walk_dogs, food_items, food_logs, dog_follows, walk_bones,
-- walk_comments, conditioning, holiday handover). Those stay intact on the
-- `dogwalkr-legacy` branch / `legacy-full-suite` tag and in the live DB.
--
-- Core reads and writes exactly two new tables:
--   activities      — the canonical human outing (source-agnostic, never a
--                     GPS re-record). One row per real-world walk/run.
--   dog_activities  — the normalized per-dog record. ONE ROW PER DOG PER
--                     ACTIVITY. Distance + both durations are copied in, so
--                     every dog's lifetime graph is fully independent.
--
-- Auth model: same as the rest of this app — one shared anon key, no real
-- per-user auth. RLS is enabled with permissive anon policies to stop
-- accidental breakage, NOT as a security boundary. See the strava_tokens /
-- strava_connections comments in schema.sql for the full caveat.
-- ============================================================================

create extension if not exists pgcrypto;

-- ==========================================================================
-- activities: one row per real-world human outing.
--
--   source        where it came from — 'strava' (canonical fast path),
--                 'manual' (the quiet "+ Log Walk Manually" fallback),
--                 or future importers ('apple_health', 'garmin').
--   external_id   the source system's own id (Strava activity id as text);
--                 NULL for manual entries. (source, external_id) is unique
--                 so a re-sync never double-imports.
--   distance_km   distance of the outing in kilometres.
--   elapsed_seconds  THE DOG'S TRUTH. Strava elapsed_time — wall-clock
--                 start-to-finish, including every sniff stop and auto-pause.
--                 This is the dog's real outing/enrichment time.
--   moving_seconds   THE HUMAN'S TRUTH. Strava moving_time — the number the
--                 human runner chases for a PB. Stored, never discarded.
--                 For manual entries with no split, set equal to elapsed.
--   started_at    when the outing began (Strava start_date; user-picked for
--                 manual).
--   device_id     which device's Strava connection synced this (matches
--                 strava_connections.device_id); NULL for manual.
--   assigned      false until at least one dog is attributed. The Core UI's
--                 "New from Strava — Who came along?" card shows every
--                 activity where assigned = false.
-- ==========================================================================
create table if not exists public.activities (
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
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists activities_started_at_idx on public.activities (started_at desc);
create index if not exists activities_unassigned_idx on public.activities (assigned) where assigned = false;

alter table public.activities enable row level security;

drop policy if exists "Allow anon read activities" on public.activities;
create policy "Allow anon read activities" on public.activities
  for select using (true);
drop policy if exists "Allow anon insert activities" on public.activities;
create policy "Allow anon insert activities" on public.activities
  for insert with check (true);
drop policy if exists "Allow anon update activities" on public.activities;
create policy "Allow anon update activities" on public.activities
  for update using (true) with check (true);
drop policy if exists "Allow anon delete activities" on public.activities;
create policy "Allow anon delete activities" on public.activities
  for delete using (true);

-- ==========================================================================
-- dog_activities: the NORMALIZED DOG RECORD. One row per (activity, dog).
--
-- Distance and BOTH durations are copied in from the parent activity at
-- assignment time. This is deliberate, not redundant: it makes each dog's
-- lifetime activity graph a simple `select ... where dog_id = ?` with no
-- awareness of how the walk was shared. Assigning one 5 km walk to Jess AND
-- Bonnie writes two rows — each dog independently gets 5 km, the full
-- elapsed time, and the full moving time. Splitting/halving is explicitly
-- NOT done (see Build Rule 5).
--
-- source / external_id are denormalized copies of the parent, so a dog's
-- history can be filtered by origin ("show me only manually logged walks")
-- without a join.
--
-- occurred_at mirrors activities.started_at — the real-world time of the
-- outing, which is what every per-dog chart and "this week" rollup buckets on.
--
-- Deleting an activity cascades and removes every dog's row for it.
-- Unassigning a single dog is just a delete of that one row (and, if it was
-- the last one, flipping activities.assigned back to false).
-- ==========================================================================
create table if not exists public.dog_activities (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  source text not null default 'manual',
  external_id text,
  distance_km numeric,
  elapsed_seconds integer,
  moving_seconds integer,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  unique (activity_id, dog_id)
);

create index if not exists dog_activities_dog_id_occurred_idx
  on public.dog_activities (dog_id, occurred_at desc);
create index if not exists dog_activities_activity_id_idx
  on public.dog_activities (activity_id);

alter table public.dog_activities enable row level security;

drop policy if exists "Allow anon read dog_activities" on public.dog_activities;
create policy "Allow anon read dog_activities" on public.dog_activities
  for select using (true);
drop policy if exists "Allow anon insert dog_activities" on public.dog_activities;
create policy "Allow anon insert dog_activities" on public.dog_activities
  for insert with check (true);
drop policy if exists "Allow anon update dog_activities" on public.dog_activities;
create policy "Allow anon update dog_activities" on public.dog_activities
  for update using (true) with check (true);
drop policy if exists "Allow anon delete dog_activities" on public.dog_activities;
create policy "Allow anon delete dog_activities" on public.dog_activities
  for delete using (true);

-- ==========================================================================
-- dog_activity_totals: convenience view for the hero card's lifetime and
-- year-to-date rollups. No pseudo-medical / calorie fields — only distance,
-- outing time, frequency, and consistency (Build Rule 4).
-- ==========================================================================
create or replace view public.dog_activity_totals as
select
  da.dog_id,
  count(*)                                        as outings_total,
  coalesce(sum(da.distance_km), 0)                as distance_km_total,
  coalesce(sum(da.elapsed_seconds), 0)            as elapsed_seconds_total,
  coalesce(sum(da.moving_seconds), 0)             as moving_seconds_total,
  count(*) filter (
    where da.occurred_at >= date_trunc('year', now())
  )                                               as outings_ytd,
  coalesce(sum(da.distance_km) filter (
    where da.occurred_at >= date_trunc('year', now())
  ), 0)                                           as distance_km_ytd,
  coalesce(sum(da.elapsed_seconds) filter (
    where da.occurred_at >= date_trunc('year', now())
  ), 0)                                           as elapsed_seconds_ytd,
  count(*) filter (
    where da.occurred_at >= now() - interval '7 days'
  )                                               as outings_7d,
  coalesce(sum(da.distance_km) filter (
    where da.occurred_at >= now() - interval '7 days'
  ), 0)                                           as distance_km_7d,
  coalesce(sum(da.elapsed_seconds) filter (
    where da.occurred_at >= now() - interval '7 days'
  ), 0)                                           as elapsed_seconds_7d,
  max(da.occurred_at)                             as last_outing_at
from public.dog_activities da
group by da.dog_id;

-- ==========================================================================
-- Private Alpha cohort seed (Audrey, Bonnie, Jess).
-- Safe to re-run: matches on lower(name) so it won't duplicate dogs that
-- already exist in the live roster. Adjust breeds/dobs in the Passport later.
-- ==========================================================================
insert into public.dogs (name)
select v.name
from (values ('Audrey'), ('Bonnie'), ('Jess')) as v(name)
where not exists (
  select 1 from public.dogs d where lower(d.name) = lower(v.name)
);
