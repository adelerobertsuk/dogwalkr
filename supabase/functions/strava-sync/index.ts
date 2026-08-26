// strava-sync: fetches recent Strava activities for ONE DEVICE's
// connected account, filters for dog walks (by dog name or keywords
// like "dog"/"pup"/"walk" in the title/description), and imports new
// matches into the shared walks table. Skips activities already
// imported (de-duped on strava_activity_id). Which device's Strava
// token is used is determined by the device_id in the request body —
// the resulting walk data is still shared household-wide, only the
// credential is per-device.
//
// Human-to-dog translation rules:
//   1. Duration is Strava's elapsed_time (wall-clock start-to-finish),
//      NOT moving_time — humans auto-pause, dogs don't stop moving.
//   2/3. Attribution is HASHTAG-ONLY (#Audrey, #Daisy), not bare name
//      matching. A bare name is ambiguous — a dog and a human (e.g. a
//      partner) can share one — so only an explicit hashtag counts as
//      the owner tagging that specific dog. Every pack member whose
//      hashtag appears anywhere in the name or description (either
//      field, order doesn't matter) gets attributed via the walk_dogs
//      join table — "#Audrey #Daisy" counts for both. dog_id on the
//      walk row itself is set to the first match, kept only as a
//      backward-compatible convenience column for older client code.
//   4. If no pack hashtag is found, the walk is imported UNASSIGNED
//      (dog_id null, no walk_dogs rows) rather than guessed at — this
//      avoids ever crediting a human-only walk to a dog, and this
//      function has no reliable concept of "the active dog" anyway
//      (it runs server-side, independent of any one device's UI
//      state). The app doesn't yet have UI to browse/reassign
//      unassigned walks; that's a follow-up.
//
// Note: the broader "is this even worth looking at as a dog activity"
// pre-filter (isDogActivity, below) is intentionally left loose —
// generic keywords or a bare name still qualify an activity for
// import consideration. Only the ATTRIBUTION step (which specific
// dog gets credited) is hashtag-strict, since that's where a wrong
// guess actually corrupts a dog's stats.
//
// 2026-08-26 fix: Strava's list endpoint (GET /athlete/activities,
// used below to pull recent activities) returns SUMMARY activity
// objects, which omit the `description` field entirely — only the
// single-activity detail endpoint (GET /activities/{id}) includes
// it. That meant any walk hashtagged in the Strava description
// (rather than the title) was silently invisible to this function:
// isDogActivity() and extractHashtags() only ever saw the title, so
// a hashtag-only description could never match. Fixed by fetching
// the full activity detail (one extra Strava API call) for any new,
// not-yet-imported activity whose title alone doesn't already
// resolve a dog match — see fetchActivityDescription() below. Also
// added structured logging (console.log/console.error per activity)
// and a `debug` array in the response so sync results are
// verifiable without needing direct access to the Edge Function's
// server logs.
//
// Invoke from the client with:
//   supabase.functions.invoke('strava-sync', { body: { device_id } })
//
// Deploy: supabase functions deploy strava-sync
// Secrets required: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (same as strava-auth)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isDogActivity(text: string, dogNames: string[]): boolean {
  const lower = text.toLowerCase();
  const keywords = ["dog", "pup", "walk", ...dogNames.map((n) => n.trim().toLowerCase())].filter(Boolean);
  return keywords.some((k) => lower.includes(k));
}

// Extracts hashtag words (the part after #, up to the next
// non-word character) as lowercase strings, e.g. "Walk with #Audrey
// and #Daisy!" -> ["audrey", "daisy"]. \w already excludes
// whitespace and punctuation, so "#Audrey," / "#Audrey!" / trailing
// spaces all resolve to the same clean "audrey" token.
function extractHashtags(text: string): string[] {
  const matches = text.match(/#(\w+)/g) || [];
  return matches.map((h) => h.slice(1).toLowerCase());
}

// Fetches the full activity detail from Strava to recover the
// `description` field, which the summary list endpoint omits. Only
// called for activities where the title alone wasn't conclusive, to
// keep the extra API calls (Strava rate-limits per app) bounded to
// activities that actually need it.
async function fetchActivityDescription(activityId: number, accessToken: string): Promise<string> {
  try {
    const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error(`[strava-sync] Activity ${activityId}: detail fetch failed (${res.status}):`, await res.text());
      return "";
    }
    const detail = await res.json();
    return detail.description || "";
  } catch (err) {
    console.error(`[strava-sync] Activity ${activityId}: detail fetch exception:`, (err as Error).message);
    return "";
  }
}

async function getValidAccessToken(deviceId: string): Promise<string | null> {
  const { data: tokenRow } = await supabase.from("strava_tokens").select("*").eq("device_id", deviceId).maybeSingle();
  if (!tokenRow) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenRow.expires_at > nowSec + 60) {
    return tokenRow.access_token;
  }

  const refreshRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
    }),
  });
  if (!refreshRes.ok) {
    console.error("Strava token refresh failed:", await refreshRes.text());
    return null;
  }
  const refreshed = await refreshRes.json();
  await supabase
    .from("strava_tokens")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: refreshed.expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq("device_id", deviceId);
  return refreshed.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const deviceId = body.device_id;
    if (!deviceId) {
      return new Response(JSON.stringify({ error: "Missing device_id" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getValidAccessToken(deviceId);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Strava not connected on this device" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { data: dogs } = await supabase.from("dogs").select("id, name");
    const dogList = dogs || [];
    const dogNames = dogList.map((d) => d.name).filter(Boolean);
    console.log(`[strava-sync] device=${deviceId} known dogs:`, dogNames);

    const activitiesRes = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=30", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!activitiesRes.ok) {
      const detail = await activitiesRes.text();
      console.error("[strava-sync] Strava activities fetch failed:", activitiesRes.status, detail);
      return new Response(
        JSON.stringify({ error: "Strava activities fetch failed", detail }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    const activities = await activitiesRes.json();
    console.log(`[strava-sync] Fetched ${activities.length} recent activities from Strava.`);

    let imported = 0;
    let skipped = 0;
    const importedTitles: string[] = [];
    const debug: Record<string, unknown>[] = [];

    for (const activity of activities) {
      const logPrefix = `[strava-sync] Activity ${activity.id} "${activity.name}"`;

      // De-dupe FIRST, before spending an extra Strava API call on
      // fetching description detail for an activity we'd skip anyway.
      const { data: existing } = await supabase
        .from("walks")
        .select("id")
        .eq("strava_activity_id", activity.id)
        .maybeSingle();
      if (existing) {
        console.log(`${logPrefix}: already imported (walk id ${existing.id}) — skipping.`);
        skipped++;
        debug.push({ id: activity.id, name: activity.name, result: "skipped", reason: "already_imported" });
        continue;
      }

      // The Strava list endpoint omits `description` on summary
      // activities. If the title alone doesn't already resolve a dog
      // hashtag or a generic keyword, fetch the full activity detail
      // so a description-only hashtag isn't missed.
      let description = activity.description || "";
      const titleOnlyText = activity.name || "";
      const titleHashtags = extractHashtags(titleOnlyText);
      const titleHasDogMatch = dogList.some((d) => d.name && titleHashtags.includes(d.name.trim().toLowerCase()));
      if (!description && !titleHasDogMatch) {
        console.log(`${logPrefix}: title alone inconclusive, fetching full activity detail for description...`);
        description = await fetchActivityDescription(activity.id, accessToken);
      }

      const text = `${activity.name || ""} ${description}`;
      console.log(`${logPrefix}: combined text for matching = "${text}"`);

      if (!isDogActivity(text, dogNames)) {
        console.log(`${logPrefix}: no dog keyword/name/hashtag found — skipping import.`);
        skipped++;
        debug.push({ id: activity.id, name: activity.name, result: "skipped", reason: "not_a_dog_activity" });
        continue;
      }

      const hashtags = extractHashtags(text);
      const matchedDogs = dogList.filter((d) => d.name && hashtags.includes(d.name.trim().toLowerCase()));
      console.log(`${logPrefix}: hashtags found = [${hashtags.join(", ")}], matched dogs = [${matchedDogs.map((d) => d.name).join(", ") || "none — will import unassigned"}]`);

      const { data: inserted, error: insertError } = await supabase
        .from("walks")
        .insert({
          title: activity.name,
          humanDistance: Math.round((activity.distance / 1000) * 100) / 100,
          durationMins: Math.round(activity.elapsed_time / 60),
          stoolScore: null,
          notes: `Imported from Strava (${activity.type})`,
          dog_id: matchedDogs[0] ? matchedDogs[0].id : null,
          strava_activity_id: activity.id,
          created_at: activity.start_date,
        })
        .select()
        .single();

      if (insertError || !inserted) {
        console.error(`${logPrefix}: walk insert failed:`, insertError?.message);
        skipped++;
        debug.push({ id: activity.id, name: activity.name, result: "skipped", reason: "insert_failed", error: insertError?.message });
        continue;
      }

      if (matchedDogs.length > 0) {
        const { error: linkError } = await supabase
          .from("walk_dogs")
          .insert(matchedDogs.map((d) => ({ walk_id: inserted.id, dog_id: d.id })));
        if (linkError) console.error(`${logPrefix}: walk_dogs insert failed:`, linkError.message);
      }

      console.log(`${logPrefix}: imported as walk id ${inserted.id}, attributed to [${matchedDogs.map((d) => d.name).join(", ") || "unassigned"}].`);
      imported++;
      importedTitles.push(activity.name);
      debug.push({ id: activity.id, name: activity.name, result: "imported", matchedDogs: matchedDogs.map((d) => d.name) });
    }

    console.log(`[strava-sync] Done: imported=${imported} skipped=${skipped}`);
    return new Response(JSON.stringify({ imported, skipped, importedTitles, debug }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[strava-sync] Unhandled exception:", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
