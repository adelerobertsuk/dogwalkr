# DogWalkr: Project Master Blueprint & Roadmap

## 1. Project Overview & Core Philosophy
* **Product Name:** DogWalkr (Smart Canine Companion to Strava)
* **Core Principle:** The dog is always **#1**. The app leverages Strava for tracking while keeping the focus entirely on canine wellbeing, multi-dog split attribution, simplified nutrition, and social connection.
* **Tech Stack:** Progressive Web App (PWA) using HTML5, Tailwind CSS, Supabase (Database, Auth & Social Relations), Supabase Edge Functions, Kit (Beta Tester CRM), and HTML5 Canvas for story card generation.

---

## 2. What We Have Built & Shipped (As of August 28, 2026)
* **Smart Strava Sync Engine:**
  * Uses Strava's `elapsed_time` (Absolute Dog Truth) so dogs get full credit for outdoor enrichment and sniff time.
  * Multi-dog hashtag filtering (`#Audrey`, `#Daisy`, `#Joe`) with automatic split attribution.
* **9:16 Social Share & Story Export Engine:**
  * HTML5 Canvas 1080×1920 story card generator (Transparent Sticker & Photo Overlay modes).
  * Dog-first metrics: name, calibrated distance, elapsed time, and paws taken.
  * Integrated with iOS Web Share Sheet (`navigator.share`) and full-size photo lightbox.
* **Simplified Nutrition & Fuel Engine (Kate's Refinement):**
  * Practical everyday foundations: Dry Kibble / Biscuits, Wet / Tinned Food, Mixed, and Raw / Fresh.
  * Manual quick-log mode (grams, ml supplements).
  * Common allergy filters: Gluten/Grain, Chicken, Beef, Dairy, Egg, Soy.
* **Canine Safety & Puppy Walking Rules:**
  * Calibrated 5-minute rule ($\text{Age in months} \times 5\text{ mins}$, max twice daily).
  * Direct educational partner links (The Kennel Club, Purina).
* **Social Graph Database Layer (Supabase Live):**
  * `public.dog_follows`: Multi-dog follower relationships.
  * `public.walk_bones`: Strava Kudos equivalent ("Give a Bone 🦴" with single-bone constraints).
  * `public.walk_comments`: Activity chat and cheering.
* **Kit (ConvertKit) Beta Engine:**
  * Landing page connected to automated welcome/confirmation sequence.
  * Private pioneer broadcast draft primed with direct onboarding instructions.

---

## 3. Team & Pack
* **Creators:** Adele Roberts & Kate (AKA Studio).
* **Pack:** Audrey, Joe (Italian Greyhound), and Charlie (Puppy).

---

## 4. Roadmap & Next Sprints

### Sprint 2: The Social Pack Feed (Immediate Next Step)
* [ ] Wire the frontend Community/Pack Feed to display walks from followed dogs.
* [ ] Implement the interactive "Give a Bone 🦴" micro-interaction with live optimistic counters.
* [ ] Update the Food navigation tab with the custom kibble bowl SVG glyph.

### Sprint 3: Live Strava Beta & Community Rollout
* [ ] Await Strava expanded developer limit approval.
* [ ] Fire the drafted Kit broadcast to the `DogWalkr Pioneer Beta` list.
* [ ] Add on-site FAQ accordion answering common sync and hashtag attribution questions.

### Sprint 4: Monetization & Expansion
* [ ] **DogWalkr Plus / Pack Pro:** Multi-dog households, Sitter QR Passports, and automated Kibble calculations based on live Strava mileage.
* [ ] **Capacitor Packaging:** Native iOS App Store build.