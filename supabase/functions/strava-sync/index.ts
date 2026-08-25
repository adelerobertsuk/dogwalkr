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
//   2/3. Every dog whose name appears in the activity's name or
//      description gets attributed via the walk_dogs join table (a
//      walk mentioning "Audrey and Daisy" counts for both). dog_id on
//      the walk row itself is set to the first match, kept only as a
//      backward-compatible convenience column for older client code.
//   4. If no dog name matches, the walk is imported UNASSIGNED
//      (dog_id null, no walk_dogs rows) rather than guessed at — this
//      function has no reliable concept of "the active dog" (it runs
//      server-side, independent of any one device's UI state), so
//      guessing would misattribute data. The app doesn't yet have UI
//      to browse/reassign unassigned walks; that's a follow-up.
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

      const lowerText = text.toLowerCase();
      const matchedDogs = dogList.filter((d) => d.name && lowerText.includes(d.name.toLowerCase()));

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
