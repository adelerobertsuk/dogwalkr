// strava-sync-core: the DogWalkr CORE sync. Pulls recent Strava activities
// for ONE DEVICE's connected account and imports outdoor outings into the
// normalized `core_activities` table as UNASSIGNED rows. It does NOT attribute
// dogs — that is the one job of the "Who came along?" card in core.html
// (Build Rule 1: the magic loop is Strava arrives -> tap dog(s) -> done).
//
// Differences from the legacy strava-sync (which writes to `walks`):
//   * Target table is `core_activities`, not `walks`.
//   * BOTH elapsed_time AND moving_time are stored (Build Rule 3):
//       elapsed_seconds = activity.elapsed_time  (the dog's true outing)
//       moving_seconds  = activity.moving_time   (the human's PB number)
//   * No hashtag attribution, no walk_dogs writes. Everything lands
//     assigned = false and waits for one tap in the UI.
//   * Never records GPS — Strava is canonical (Build Rule 2).
//
// Import filter: Strava sport types that are plausibly "an outing a dog
// could come on" (Walk, Run, Hike, TrailRun), OR any activity whose title
// mentions a dog / a known pack name / a #hashtag. Everything else
// (weights, ride, swim, yoga...) is skipped.
//
// De-dupe: (source='strava', external_id=activity.id) is unique in the
// table, so a re-sync of the same activity is a no-op.
//
// Invoke from the client with:
//   db.functions.invoke('strava-sync-core', { body: { device_id } })
//
// Deploy: supabase functions deploy strava-sync-core
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

const OUTING_TYPES = new Set(["Walk", "Run", "Hike", "TrailRun"]);
const DOG_KEYWORDS = ["dog", "pup", "walk", "woof", "🐾", "🐕", "🐶"];

function looksLikeOuting(activity: Record<string, unknown>, dogNames: string[]): boolean {
  const type = String(activity.sport_type || activity.type || "");
  if (OUTING_TYPES.has(type)) return true;
  const text = `${activity.name || ""}`.toLowerCase();
  const needles = [...DOG_KEYWORDS, ...dogNames.map((n) => n.trim().toLowerCase())].filter(Boolean);
  return needles.some((k) => text.includes(k)) || /#\w+/.test(text);
}

async function getValidAccessToken(deviceId: string): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from("strava_tokens").select("*").eq("device_id", deviceId).maybeSingle();
  if (!tokenRow) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenRow.expires_at > nowSec + 60) return tokenRow.access_token;

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
    console.error("[strava-sync-core] token refresh failed:", await refreshRes.text());
    return null;
  }
  const refreshed = await refreshRes.json();
  await supabase.from("strava_tokens").update({
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: refreshed.expires_at,
    updated_at: new Date().toISOString(),
  }).eq("device_id", deviceId);
  return refreshed.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json().catch(() => ({}));
    const deviceId = body.device_id;
    if (!deviceId) {
      return new Response(JSON.stringify({ error: "Missing device_id" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getValidAccessToken(deviceId);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Strava not connected on this device" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { data: dogs } = await supabase.from("dogs").select("name");
    const dogNames = (dogs || []).map((d) => d.name).filter(Boolean);

    const activitiesRes = await fetch(
      "https://www.strava.com/api/v3/athlete/activities?per_page=30",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!activitiesRes.ok) {
      const detail = await activitiesRes.text();
      console.error("[strava-sync-core] activities fetch failed:", activitiesRes.status, detail);
      return new Response(JSON.stringify({ error: "Strava activities fetch failed", detail }), {
        status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const activities = await activitiesRes.json();

    let imported = 0, skipped = 0;
    const debug: Record<string, unknown>[] = [];

    for (const activity of activities) {
      const idStr = String(activity.id);

      const { data: existing } = await supabase
        .from("core_activities").select("id")
        .eq("source", "strava").eq("external_id", idStr).maybeSingle();
      if (existing) {
        skipped++;
        debug.push({ id: idStr, name: activity.name, result: "skipped", reason: "already_imported" });
        continue;
      }

      if (!looksLikeOuting(activity, dogNames)) {
        skipped++;
        debug.push({ id: idStr, name: activity.name, result: "skipped", reason: "not_an_outing" });
        continue;
      }

      const { error: insertError } = await supabase.from("core_activities").insert({
        source: "strava",
        external_id: idStr,
        title: activity.name,
        distance_km: Math.round((activity.distance / 1000) * 100) / 100,
        elapsed_seconds: activity.elapsed_time ?? null,
        moving_seconds: activity.moving_time ?? null,
        started_at: activity.start_date,
        device_id: deviceId,
        assigned: false,
      });

      if (insertError) {
        skipped++;
        debug.push({ id: idStr, name: activity.name, result: "skipped", reason: "insert_failed", error: insertError.message });
        continue;
      }
      imported++;
      debug.push({ id: idStr, name: activity.name, result: "imported" });
    }

    console.log(`[strava-sync-core] device=${deviceId} imported=${imported} skipped=${skipped}`);
    return new Response(JSON.stringify({ imported, skipped, debug }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[strava-sync-core] unhandled:", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
