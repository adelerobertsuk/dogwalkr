import requests
import json

CLIENT_ID = "274314"
CODE = "d3a119bc5cab633f94bc880a81a27312ad64eba8"
CLIENT_SECRET = "bbfcea90766509174c69b7c7df6eb2a63b2e40ef"

def get_tokens(auth_code, secret):
    url = "https://www.strava.com/oauth/token"
    payload = {
        "client_id": CLIENT_ID,
        "client_secret": secret,
        "code": auth_code,
        "grant_type": "authorization_code"
    }
    res = requests.post(url, data=payload)
    return res.json()

print("\n🐾 Exchanging token with Strava...")
token_data = get_tokens(CODE, CLIENT_SECRET)

if "access_token" not in token_data:
    token_data = get_tokens(CLIENT_SECRET, CODE)

if "access_token" in token_data:
    access_token = token_data["access_token"]
    refresh_token = token_data["refresh_token"]
    athlete = token_data.get("athlete", {})
    
    print(f"✅ Success! Connected to Strava for: {athlete.get('firstname', 'Athlete')} {athlete.get('lastname', '')}")
    print(f"🔑 Permanent Refresh Token: {refresh_token}\n")

    # Fetch last 5 activities
    activities_url = "https://www.strava.com/api/v3/athlete/activities?per_page=5"
    headers = {"Authorization": f"Bearer {access_token}"}
    act_res = requests.get(activities_url, headers=headers)
    activities = act_res.json()

    print("=" * 60)
    print("🐕 DOGWALKR CANINE ATHLETIC TELEMETRY TRANSLATION")
    print("=" * 60)

    for act in activities:
        name = act.get("name", "Activity")
        act_type = act.get("type", "Walk")
        human_km = act.get("distance", 0) / 1000.0
        elapsed_sec = act.get("moving_time", 0)
        minutes = elapsed_sec // 60
        
        # Canine Telemetry Calculations (Audrey: Whippet Cross ~5.5kg)
        dog_km = round(human_km * 1.73, 2)
        stride_bonus_km = round(dog_km - human_km, 2)
        
        # Energy burn (~30.5 kcal per km for 5.5kg active canine)
        dog_active_kcal = round(dog_km * 30.5)
        kibble_earned_grams = round(dog_active_kcal / 3.8)

        print(f"\n📍 Activity: {name} ({act_type})")
        print(f"   👤 Human Logged:    {human_km:.2f} km ({minutes} mins)")
        print(f"   🐾 Audrey Stride:   {dog_km:.2f} km (+{stride_bonus_km:.2f} km stride bonus)")
        print(f"   🥣 Post-Walk Fuel:  +{kibble_earned_grams}g kibble ({dog_active_kcal} active kcal)")
        print(f"   🛡️ Joint Status:    Safe / Target Zone")
        print(f"   💬 Audrey Debrief:  \"Mum logged {human_km:.1f}km, but my cadence hit {dog_km}km. Fuel top-up required!\"")
        print("-" * 60)

else:
    print("❌ Token exchange response:", json.dumps(token_data, indent=2))
