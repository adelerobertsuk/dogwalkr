const STRAVA_ACCESS_TOKEN = "27466da143f9abeb7fb2fe284b664aef335f0eed";
const SUPABASE_URL = "https://rrrjojbxjektdhrkahvh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJycmpvamJ4amVrdGRocmthaHZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMTk2MzIsImV4cCI6MjA3MTY5NTYzMn0.UfP6Wk1856YQn2N7x5g4J47V_u1w7Q6B9_0j_zYwPfk";

const DOG_ID = "barney-labrador-default";
const DOG_WEIGHT = 28.5;

async function syncLatestWalk() {
  try {
    const stravaRes = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=15", {
      headers: { Authorization: `Bearer ${STRAVA_ACCESS_TOKEN}` }
    });
    const activities = await stravaRes.json();

    if (!activities || !Array.isArray(activities) || activities.length === 0) {
      console.log("⚠️ Could not fetch activities from Strava or none found.");
      return;
    }

    console.log(`\n🐾 Checking latest ${activities.length} Strava activities...`);

    for (const walk of activities) {
      const isWalkType = walk.type === "Walk" || walk.type === "Hike";
      const hasDogKeyword = /audrey|daisy|dog|pup|pack|🐾|🐶/i.test(walk.name);

      if (isWalkType || hasDogKeyword) {
        const humanDistanceKm = (walk.distance / 1000).toFixed(2);
        const multiplier = (1.3 + (40 - DOG_WEIGHT) * 0.012).toFixed(2);
        const dogDistanceKm = (humanDistanceKm * multiplier).toFixed(2);
        const movingMinutes = Math.round(walk.moving_time / 60);
        const extraKibble = Math.round((DOG_WEIGHT * 0.95 * humanDistanceKm) / 3.8);

        console.log(`✅ Synced: "${walk.name}" — Human: ${humanDistanceKm}km -> Canine: ${dogDistanceKm}km (+${extraKibble}g fuel)`);
      }
    }
  } catch (err) {
    console.error("❌ Sync error:", err);
  }
}

syncLatestWalk();