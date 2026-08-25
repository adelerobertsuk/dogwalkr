const STRAVA_ACCESS_TOKEN = "27466da143f9abeb7fb2fe284b664aef335f0eed";
const SUPABASE_URL = "https://rrrjojbxjektdhrkahvh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJycmpvamJ4amVrdGRocmthaHZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3NzgzOTQsImV4cCI6MjEwMjM1NDM5NH0.sjqbYyIA7NLQ7hQYp3HJQesLVbCr8X6PA94nV6BLqHA";

const DOG_ID = "db891c87-b0e9-4753-bab8-cae5c14d8172"; // Audrey
const DOG_WEIGHT = 5.5;


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

    console.log(`\n🔍 Checking latest ${activities.length} Strava activities...`);

    for (const walk of activities) {
      const isWalkType = walk.type === "Walk" || walk.type === "Hike";
      const hasDogKeyword = /audrey|daisy|dog|pup|pack|🐕|🐶|🐾/i.test(walk.name);
      const isPetTagged = walk.tags && walk.tags.includes("pet");

      if (!isWalkType && !hasDogKeyword && !isPetTagged) {
        continue;
      }

      const humanKm = parseFloat((walk.distance / 1000).toFixed(2));
      const movingMin = Math.round(walk.moving_time / 60);
      const totalMin = Math.round(walk.elapsed_time / 60);

      // Canine Biomechanical Formula
      const canineKm = parseFloat((humanKm * (1.3 + (40 - DOG_WEIGHT) * 0.012)).toFixed(2));
      const caloriesBurned = walk.kilojoules ? Math.round(walk.kilojoules * 0.239) : Math.round(humanKm * 65);
      const kibbleAdjustmentGrams = Math.round(caloriesBurned / 3.8);

      const payload = {
        dog_id: DOG_ID,
        strava_activity_id: String(walk.id),
        activity_title: walk.name,
        human_distance_km: humanKm,
        canine_distance_km: canineKm,
        moving_minutes: movingMin,
        total_minutes: totalMin,
        kibble_grams: kibbleAdjustmentGrams,
        created_at: walk.start_date_local || walk.start_date
      };

      const activityRes = await fetch(`${SUPABASE_URL}/rest/v1/dog_activities`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(payload)
      });

      if (activityRes.ok) {
        console.log(`🚀 Imported: "${walk.name}" (${humanKm} km -> ${canineKm} canine km)`);
      } else {
        const errData = await activityRes.json();
        if (errData.code === '23505') {
          // Already in database, quietly continue
        } else {
          console.error(`Database error for "${walk.name}":`, errData);
        }
      }
    }
    console.log("✨ All caught up! No new walks to add.");
  } catch (err) {
    console.error("Sync error:", err);
  }
}

// Initial batch sync on launch
syncLatestWalk();

// Check Strava every 60 seconds
const SYNC_INTERVAL_MS = 60 * 1000;
console.log("⏱️ Auto-sync active: Watching for new Strava walks every 60s...");

setInterval(() => {
  syncLatestWalk();
}, SYNC_INTERVAL_MS);
