// strava-auth: OAuth redirect target for Strava's authorization flow.
// Strava sends the browser here with ?code=...&state=<json> after the
// user approves access. `state` carries { returnUrl, deviceId } — set
// by app.html's connectStrava() — so tokens get stored under the
// connecting device, not a shared row. This exchanges the code for
// tokens server-side (client_secret never touches the browser) and
// redirects back to the app.
//
// Deploy: supabase functions deploy strava-auth
// Secrets required (supabase secrets set ...):
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseState(raw: string | null): { returnUrl: string; deviceId: string | null } {
  if (!raw) return { returnUrl: "/", deviceId: null };
  try {
    const parsed = JSON.parse(raw);
    return { returnUrl: parsed.returnUrl || "/", deviceId: parsed.deviceId || null };
  } catch {
    // Fallback for any old-format state (a bare URL string)
    return { returnUrl: raw, deviceId: null };
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const { returnUrl, deviceId } = parseState(url.searchParams.get("state"));
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return Response.redirect(`${returnUrl}?strava=denied`, 302);
  }
  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }
  if (!deviceId) {
    return new Response("Missing device id in state — reconnect from the app so state carries it.", { status: 400 });
  }

  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    console.error("Strava token exchange failed:", await tokenRes.text());
    return Response.redirect(`${returnUrl}?strava=error`, 302);
  }

  const tokenData = await tokenRes.json();
  const { access_token, refresh_token, expires_at, athlete } = tokenData;

  await supabase.from("strava_tokens").upsert({
    device_id: deviceId,
    access_token,
    refresh_token,
    expires_at,
    athlete_id: athlete?.id ?? null,
    updated_at: new Date().toISOString(),
  });

  const athleteName = athlete
    ? `${athlete.firstname ?? ""} ${athlete.lastname ?? ""}`.trim() || null
    : null;

  await supabase.from("strava_connections").upsert({
    device_id: deviceId,
    connected: true,
    athlete_name: athleteName,
    updated_at: new Date().toISOString(),
  });

  return Response.redirect(`${returnUrl}?strava=connected`, 302);
});
