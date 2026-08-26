-- Dogwalkr: missing tables for the live Supabase project.
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Column names/casing match exactly what app.html sends via the JS client.

create extension if not exists pgcrypto;

-- ==========================================================
-- walks: written by saveWalkout(), read by fetchSupabaseWalks(),
-- deleted by deleteWalkout()
-- ==========================================================
create table if not exists public.walks (
  id uuid primary key default gen_random_uuid(),
  title text,
  "humanDistance" numeric,
  "durationMins" integer,
  "stoolScore" integer,
  notes text,
  dog_id uuid references public.dogs(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists walks_created_at_idx on public.walks (created_at desc);
create index if not exists walks_dog_id_idx on public.walks (dog_id);

alter table public.walks enable row level security;

create policy "Allow anon read walks" on public.walks
  for select using (true);
create policy "Allow anon insert walks" on public.walks
  for insert with check (true);
create policy "Allow anon delete walks" on public.walks
  for delete using (true);

-- ==========================================================
-- household_settings: single-row table (id = 1), written/read by
-- saveHouseholdNames() and fetchSupabaseHousehold()
-- ==========================================================
create table if not exists public.household_settings (
  id integer primary key,
  names text not null
);

alter table public.household_settings enable row level security;

create policy "Allow anon read household_settings" on public.household_settings
  for select using (true);
create policy "Allow anon upsert household_settings" on public.household_settings
  for insert with check (true);
create policy "Allow anon update household_settings" on public.household_settings
  for update using (true);

-- ==========================================================
-- dogs.avatar: your existing live dogs table has no avatar column
-- yet (confirmed via a live fetch — only id/name/breed/weight_kg/
-- created_at came back). Phase 2 photo upload writes here.
-- ==========================================================
alter table public.dogs add column if not exists avatar text;

-- ==========================================================
-- dog-avatars storage bucket: written by uploadDogAvatar()
-- (Phase 2 photo upload), public so avatar URLs render directly
-- ==========================================================
insert into storage.buckets (id, name, public)
values ('dog-avatars', 'dog-avatars', true)
on conflict (id) do nothing;

create policy "Public read dog-avatars" on storage.objects
  for select using (bucket_id = 'dog-avatars');
create policy "Anon upload dog-avatars" on storage.objects
  for insert with check (bucket_id = 'dog-avatars');
create policy "Anon update dog-avatars" on storage.objects
  for update using (bucket_id = 'dog-avatars');

-- ==========================================================
-- dogs.dob: also missing from your live dogs table. Without it,
-- calculateAge() always fell back to a fixed placeholder age.
-- Edit Dog now writes real birth dates here.
-- ==========================================================
alter table public.dogs add column if not exists dob date;

-- ==========================================================
-- walks.photo_url: written by saveWalkout() when a photo is
-- attached to a walk log
-- ==========================================================
alter table public.walks add column if not exists photo_url text;

-- ==========================================================
-- walk-photos storage bucket: written by uploadWalkPhoto()
-- ==========================================================
insert into storage.buckets (id, name, public)
values ('walk-photos', 'walk-photos', true)
on conflict (id) do nothing;

create policy "Public read walk-photos" on storage.objects
  for select using (bucket_id = 'walk-photos');
create policy "Anon upload walk-photos" on storage.objects
  for insert with check (bucket_id = 'walk-photos');
create policy "Anon update walk-photos" on storage.objects
  for update using (bucket_id = 'walk-photos');

-- ==========================================================
-- food_items: written by saveFoodItem(), deleted by deleteFoodItem().
-- dog_id scopes each item to one dog (state-isolation fix) — items
-- with no dog_id predate this and won't show under any dog's tab.
-- ==========================================================
create table if not exists public.food_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  portion text,
  emoji text,
  created_at timestamptz not null default now()
);
alter table public.food_items add column if not exists dog_id uuid references public.dogs(id) on delete cascade;

alter table public.food_items enable row level security;

create policy "Allow anon read food_items" on public.food_items
  for select using (true);
create policy "Allow anon insert food_items" on public.food_items
  for insert with check (true);
create policy "Allow anon delete food_items" on public.food_items
  for delete using (true);

-- ==========================================================
-- strava_tokens: server-only OAuth token storage, ONE ROW PER DEVICE
-- (device_id, a random id the client generates and keeps in
-- localStorage — see app.html's getDeviceId()). This is what makes
-- connecting on Kate's phone not clobber Adele's tokens: each device
-- gets its own row instead of sharing a single fixed row.
--
-- RLS is enabled with ZERO policies below — the anon key gets no
-- access at all, by design. Only the strava-auth / strava-sync /
-- strava-disconnect Edge Functions (service role key, bypasses RLS)
-- may read or write this table. Never add an anon policy here.
--
-- NOTE: this table was previously keyed by a fixed `id=1` (household-
-- wide). That design was wrong — it meant any second device to
-- connect would silently overwrite the first device's tokens. If you
-- already ran the old version of this file, drop and recreate:
--   drop table if exists public.strava_tokens;
-- (safe pre-launch: OAuth was never actually completed against the
-- old schema, since it required a deployed Edge Function + registered
-- Strava app + real hosting domain, none of which existed yet.)
-- ==========================================================
create table if not exists public.strava_tokens (
  device_id text primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null,
  athlete_id bigint,
  updated_at timestamptz not null default now()
);
alter table public.strava_tokens enable row level security;

-- ==========================================================
-- strava_connections: per-device connection STATUS ONLY (no secrets —
-- safe for anon read/write). This is what the client reads to decide
-- whether to show "Connected as X" or the Connect button, scoped to
-- its own device_id so one phone's status never overwrites another's.
--
-- household_settings.strava_connected / strava_athlete_name from the
-- earlier version of this file are superseded by this table and are
-- no longer written to — safe to leave as unused dead columns, or
-- drop them if you prefer:
--   alter table public.household_settings drop column if exists strava_connected;
--   alter table public.household_settings drop column if exists strava_athlete_name;
--
-- Caveat: because this app has no real per-user auth (one shared anon
-- key for everyone), RLS can't cryptographically verify a device_id
-- belongs to the browser sending it — anyone with the anon key could
-- in principle read/write any device's status row. This design stops
-- ACCIDENTAL cross-device overwrites in normal household use (the
-- actual ask here); it is not a defense against a malicious holder of
-- your anon key. True per-user isolation would need real Supabase
-- Auth (magic link / OTP), which is a bigger change than this.
-- ==========================================================
create table if not exists public.strava_connections (
  device_id text primary key,
  connected boolean not null default false,
  athlete_name text,
  updated_at timestamptz not null default now()
);
alter table public.strava_connections enable row level security;

create policy "Allow anon read strava_connections" on public.strava_connections
  for select using (true);
create policy "Allow anon upsert strava_connections" on public.strava_connections
  for insert with check (true);
create policy "Allow anon update strava_connections" on public.strava_connections
  for update using (true);

-- ==========================================================
-- walks.strava_activity_id: de-dupes activities re-synced from Strava
-- ==========================================================
alter table public.walks add column if not exists strava_activity_id bigint;
create unique index if not exists walks_strava_activity_id_idx
  on public.walks (strava_activity_id) where strava_activity_id is not null;

-- ==========================================================
-- Live-verified fixes (2026-08-26): the original walks/food_items
-- policy sets above were missing UPDATE policies, so every edit
-- (including adding a photo to an existing walkout) silently
-- affected 0 rows — no error thrown, just never persisted. Also
-- walks.photo_url and dogs.avatar were missing entirely live despite
-- being defined earlier in this file (an earlier paste of this file
-- likely errored out partway through on a duplicate-policy conflict
-- and rolled back everything after that point). Confirmed fixed via
-- direct insert/update probes against the live database.
-- ==========================================================
drop policy if exists "Allow anon update walks" on public.walks;
create policy "Allow anon update walks" on public.walks
  for update using (true) with check (true);

drop policy if exists "Allow anon update food_items" on public.food_items;
create policy "Allow anon update food_items" on public.food_items
  for update using (true) with check (true);

alter table public.walks add column if not exists photo_url text;
alter table public.dogs add column if not exists avatar text;

-- ==========================================================
-- walk_dogs: many-to-many join for multi-dog walk attribution.
-- walks.dog_id stays as the "primary" dog (used by manually-logged
-- walks and as a backward-compatible convenience column), but a walk
-- can now belong to MULTIPLE dogs via this table — e.g. a Strava
-- activity whose title mentions both "Audrey" and "Daisy" gets a
-- row here for each, so it counts toward both dogs' stats. The
-- client's getDogWalkouts() checks dog_id OR this table.
-- ==========================================================
create table if not exists public.walk_dogs (
  walk_id uuid not null references public.walks(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  primary key (walk_id, dog_id)
);
alter table public.walk_dogs enable row level security;

drop policy if exists "Allow anon read walk_dogs" on public.walk_dogs;
create policy "Allow anon read walk_dogs" on public.walk_dogs
  for select using (true);
drop policy if exists "Allow anon insert walk_dogs" on public.walk_dogs;
create policy "Allow anon insert walk_dogs" on public.walk_dogs
  for insert with check (true);
drop policy if exists "Allow anon delete walk_dogs" on public.walk_dogs;
create policy "Allow anon delete walk_dogs" on public.walk_dogs
  for delete using (true);

-- ==========================================================
-- Household Pack linking (2026-08-26): household_settings.names
-- stays as-is (the free-text roster string shown in the Pack tab
-- subtitle and the dog passport card) — it's now auto-derived from
-- household_members rather than hand-typed, but the column and its
-- consumers are untouched. household_name is new: the single
-- collective name co-owners link together under (e.g. "The
-- Roberts-Holderness Household"), edited from the new Household
-- settings view.
--
-- household_members gives each co-owner a real row (id + name)
-- instead of one opaque string, so they can be added/removed
-- individually in the UI. Note this app has no per-user auth (one
-- shared anon key for everyone — see the strava_connections comment
-- above for the full caveat) — dogs, food_items and walks are
-- ALREADY globally shared with anyone holding the anon key. So
-- "linked household members share the same dogs/food logs/walk
-- history" is true by construction; household_members is an
-- identity/roster list, not an access-control boundary.
-- ==========================================================
alter table public.household_settings add column if not exists household_name text;

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.household_members enable row level security;

drop policy if exists "Allow anon read household_members" on public.household_members;
create policy "Allow anon read household_members" on public.household_members
  for select using (true);
drop policy if exists "Allow anon insert household_members" on public.household_members;
create policy "Allow anon insert household_members" on public.household_members
  for insert with check (true);
drop policy if exists "Allow anon delete household_members" on public.household_members;
create policy "Allow anon delete household_members" on public.household_members
  for delete using (true);

-- ==========================================================
-- food_logs (2026-08-26): one row per (food_item_id, date) actual
-- feeding event, replacing the old STATE.foodLogs client-only
-- checkbox state. That state lived only in browser memory and was
-- never written to Supabase at all — it reset on every page reload
-- and, worse, never synced between Adele's and Kate's devices,
-- which defeats the entire point of a shared household feeding
-- log. fed_by records which linked household member (see
-- household_members above) logged the feed; the item's own
-- `portion` column already covers the amount, so it isn't
-- duplicated here. Checking a box off deletes its row — there is no
-- "unfed" history, only a record of feeds that actually happened.
-- ==========================================================
create table if not exists public.food_logs (
  id uuid primary key default gen_random_uuid(),
  food_item_id uuid not null references public.food_items(id) on delete cascade,
  fed_date date not null,
  fed_by text,
  created_at timestamptz not null default now(),
  unique (food_item_id, fed_date)
);
create index if not exists food_logs_fed_date_idx on public.food_logs (fed_date);

alter table public.food_logs enable row level security;

drop policy if exists "Allow anon read food_logs" on public.food_logs;
create policy "Allow anon read food_logs" on public.food_logs
  for select using (true);
drop policy if exists "Allow anon insert food_logs" on public.food_logs;
create policy "Allow anon insert food_logs" on public.food_logs
  for insert with check (true);
drop policy if exists "Allow anon delete food_logs" on public.food_logs;
create policy "Allow anon delete food_logs" on public.food_logs
  for delete using (true);
