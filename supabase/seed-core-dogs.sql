-- ============================================================================
-- DogWalkr CORE — Private Alpha cohort dog seed (Audrey, Bonnie, Jess).
-- OPTIONAL. Run once, after schema-core.sql, only if these dogs aren't
-- already in your roster.
--
-- NON-DESTRUCTIVE: this is a plain INSERT guarded by NOT EXISTS. It never
-- updates or deletes an existing dog row, and matches case-insensitively on
-- name so it won't create a duplicate "Audrey" if one already exists. Skip
-- this file entirely if you'd rather add the alpha dogs from the app's
-- Settings sheet.
-- ============================================================================

insert into public.dogs (name)
select v.name
from (values ('Audrey'), ('Bonnie'), ('Jess')) as v(name)
where not exists (
  select 1 from public.dogs d where lower(d.name) = lower(v.name)
);
