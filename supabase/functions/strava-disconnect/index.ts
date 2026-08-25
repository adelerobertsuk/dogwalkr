// strava-disconnect: fully disconnects ONE DEVICE's Strava link.
// Best-effort revokes the token with Strava itself (so it can't be
// used even if somehow leaked), then deletes the device's row from
// strava_tokens and flips strava_connections back to disconnected.
// Only this device's connection is affected — other devices/phones
// connected under their own device_id are untouched.
//
// Invoke from the client with:
//   supabase.functions.invoke('strava-disconnect', { body: { device_id } })
//
// Deploy: supabase functions deploy strava-disconnect
// No Strava secrets needed beyond what strava-auth already set.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { data: tokenRow } = await supabase
      .from("strava_tokens")
      .select("access_token")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (tokenRow?.access_token) {
      try {
        await fetch(`https://www.strava.com/oauth/deauthorize?access_token=${tokenRow.access_token}`, {
          method: "POST",
        });
      } catch (revokeErr) {
        // Best-effort — still proceed to clear locally even if Strava's
        // revoke endpoint is unreachable.
        console.warn("Strava token revoke call failed:", revokeErr);
      }
    }

    await supabase.from("strava_tokens").delete().eq("device_id", deviceId);
    await supabase.from("strava_connections").upsert({
      device_id: deviceId,
      connected: false,
      athlete_name: null,
      updated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
