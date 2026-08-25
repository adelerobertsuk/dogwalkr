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
  const keywords = ["dog", "pup", "walk", ...dogNames.map((n) => n.toLowerCase())].filter(Boolean);
  return keywords.some((k) => lower.includes(k));
}

// Extracts hashtag words (the part after #, up to the next
// non-word character) as lowercase strings, e.g. "Walk with #Audrey
// and #Daisy!" -> ["audrey", "daisy"].
function extractHashtags(text: string): string[] {
  const matches = text.match(/#(\w+)/g) || [];
  return matches.map((h) => h.slice(1).toLowerCase());
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

    const activitiesRes = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=30", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!activitiesRes.ok) {
      return new Response(
        JSON.stringify({ error: "Strava activities fetch failed", detail: await activitiesRes.text() }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    const activities = await activitiesRes.json();

    let imported = 0;
    let skipped = 0;
    const importedTitles: string[] = [];

    for (const activity of activities) {
      const text = `${activity.name || ""} ${activity.description || ""}`;
      if (!isDogActivity(text, dogNames)) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from("walks")
        .select("id")
        .eq("strava_activity_id", activity.id)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }

      const hashtags = extractHashtags(text);
      const matchedDogs = dogList.filter((d) => d.name && hashtags.includes(d.name.toLowerCase()));

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
        console.error("Walk insert failed:", insertError?.message);
        skipped++;
        continue;
      }

      if (matchedDogs.length > 0) {
        const { error: linkError } = await supabase
          .from("walk_dogs")
          .insert(matchedDogs.map((d) => ({ walk_id: inserted.id, dog_id: d.id })));
        if (linkError) console.error("walk_dogs insert failed:", linkError.message);
      }

      imported++;
      importedTitles.push(activity.name);
    }

    return new Response(JSON.stringify({ imported, skipped, importedTitles }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
