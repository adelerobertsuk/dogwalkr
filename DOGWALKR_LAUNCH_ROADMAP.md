# DogWalkr Launch, Architecture & Growth Roadmap

**Project**: DogWalkr 3-Pillar Ecosystem (`dogwalkr.co.uk`)  
**Deployment**: Vercel (`main` branch auto-deploy)  
**Database**: Supabase (`beta_signups`, `dogs`, `dog_activities`, `food_logs`)  
**Created**: August 28, 2026  

---

## 1. Ecosystem Architecture & URL Map

DogWalkr is structured as a unified 3-pillar canine lifestyle and health platform:

| Pillar | File | Public Route | Purpose & Core Capabilities |
| :--- | :--- | :--- | :--- |
| **Flagship Hub** | `index.html` | `/` or `/index.html` | Dark glass hero, 3-pillar breakdown, interactive Supabase beta signup modal. |
| **Activity Tracker** | `app.html` | `/app` or `/app.html` | Strava auto-sync, canine calorie/effort calculations, Daily Dog Coach, Food Bowl. |
| **Alimenta Fuel** | `fuel.html` | `/fuel` or `/fuel.html` | NRC/FEDIAF raw/fresh meal calculator, 80/10/10 BARF ratios, 7-day butcher pantry list. |
| **Conditioning Lab** | `condition.html` | `/condition` or `/condition.html` | 4-week fitness ramp (+10% safe volume rule), joint check audit, PDF schedule export. |

---

## 2. Navigation & Design System

- **Unified Navigation Bar**: Powered by `suite-nav.js` and `suite-nav.css`.
  - Injected across all pages with active route highlighting and slide-over Help / FAQ drawer.
  - **Canvas Palette**: Warm Ivory / Alabaster (`#FBFBFA`) on tool views, crisp obsidian glass (`rgba(10,10,10,0.85)`) on landing hero.
  - **Typography**: Plus Jakarta Sans / Apple system font, crisp hairline borders (`#E8E8E4`).

---

## 3. Database Schema (`Supabase`)

### `public.beta_signups`
```sql
create table if not exists public.beta_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  dog_name text,
  source text default 'landing_page',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.beta_signups enable row level security;

create policy "Allow anonymous signups"
  on public.beta_signups
  for insert to anon
  with check (true);
```

---

## 4. Beta Access Strategy: The VIP Wave Model

To maximize perceived value, exclusivity, and quality control:

1. **On Landing Page Submission**:
   - Modal displays the curated wave message:
     > *"You’re on the list! 🐾 We’re rolling out beta access in waves to keep things running smoothly. Can't wait to meet you and your pup — we’ll email you your custom invite link the moment your spot opens up."*
2. **Automated Welcome Email (Kit / Loops / Resend)**:
   - **Sender**: `DogWalkr <hello@dogwalkr.co.uk>`
   - **Subject**: `🐾 Welcome to DogWalkr early beta access`
   - **Confirmation Action**: `[Confirm Beta Access 🐾]` button redirects to `https://www.dogwalkr.co.uk/app.html`.

---

## 5. Monetisation Strategy (Freemium -> Pro)

1. **Free Tier**: Basic walk tracking, single-day meal calculation, general coach tips.
2. **DogWalkr Pro (£4.99/mo or £39/yr via Stripe)**:
   - Pack Mode (multi-dog tracking).
   - 7-Day multi-protein butcher schedules & allergen filtering.
   - 4-Week PDF conditioning exports & post-walk joint recovery check logs.
   - Multi-device household food bowl sync.

---

## 6. Next Immediate Tasks

- [ ] Add dedicated FAQ section to `index.html` (Privacy, GPS safety, raw feeding principles).
- [ ] Connect Kit / Resend webhook for automated confirmation email dispatch.
- [ ] Next App Sprint: **Ronni Wallet** (Hooking up Leaflet/Mapbox Radar Key Scout map & Equality Act flashcard).
