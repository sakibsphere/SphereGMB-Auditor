# GBP Sphere: Complete Installation & User Guide

Welcome to **GBP Sphere (Local SEO & Profile Auditor)**, a specialized Google Chrome extension engineered for SEO professionals, agency owners, local business consultants, and researchers.

This guide provides step-by-step instructions for installation, usage workflows on Google Search and Google Maps, decoding Place CIDs, conducting in-depth profile audits, and exporting data for client presentations.

---

## 1. Quick Installation (Chrome Developer Mode)

GBP Sphere is 100% self-contained and does not require complex build steps, node servers, or external logins.

### Step-by-Step Instructions:

1. **Get the folder:**  
   Easiest: run the one-line installer from the README ("Install", option 1), which puts it in a `GBP-Sphere-Extension` folder in your Downloads folder. Or download [sphere-gmb.zip](https://github.com/sakibsphere/GBP-Sphere/releases/latest/download/sphere-gmb.zip) and unzip it anywhere, for example your Documents folder.  
   *(Make sure the folder contains `manifest.json`, `background/`, `content/`, and `popup/`)*.

2. **Open Extensions in Google Chrome:**  
   - In Google Chrome's address bar, type:  
     `chrome://extensions/` and hit Enter.  
   - Alternatively, click the Chrome menu (three dots in top right) &rarr; **Extensions** &rarr; **Manage Extensions**.

3. **Enable Developer Mode:**  
   - In the top-right corner of the Extensions page, switch the **Developer mode** toggle to **ON**.

4. **Load the Extension:**  
   - Click the **Load unpacked** button in the top-left toolbar.
   - In the folder picker dialog, select the folder that contains `manifest.json`.
   - Click **Select Folder**.

5. **Pin the Extension (Recommended):**  
   - Click the puzzle piece (Extensions) icon in Chrome’s top toolbar.
   - Find **GBP Sphere: Local SEO & Profile Auditor** and click the **Pin** icon so it appears in your browser toolbar.

---

## 2. Using GBP Sphere on Google Search (SERP)

### A. Instant In-Page Toolbar
When searching for any business (e.g., *Empire State Building*, *Peter Luger Steak House*), GBP Sphere renders directly beneath the primary rating bar:
- **Categories Line:** `Categories:` followed by `[Primary Category]` in purple/amethyst with a small bolt icon, followed by all secondary categories chips.
- **Button Row 1:**
  - `[ Export ]`: 1-click business profile CSV download.
  - `[ Post Audit ]`: Opens GBP Posts Audit modal analyzing posting cadence and SEO frequency.
  - `[ Photo Audit ]`: Opens GBP Photos Audit modal analyzing image volume and quality.
  - `[ Review Audit ]`: Scrapes Google reviews dialog with live progress toast and exports reviews to CSV.
- **Button Row 2:**
  - `[ Dashboard ]`: Opens the full 3-tab Local SEO Completeness Score & Checklist modal.
  - `[ SERP Checker ]`: searches the primary category in the business's city on Google and shows a banner with the business's local-pack position.

---

## 3. Using GBP Sphere on Google Maps

### A. Single Place Details View
1. Navigate to [Google Maps](https://www.google.com/maps).
2. Search for or click any local business to open its detail panel.
3. Right beneath the title and rating, GBP Sphere renders:
   - All category badges.
   - Direct Place CID link.
   - Action buttons.
4. Clicking any action button is protected by pointer-events isolation, meaning it will **not** accidentally zoom or pan your Google Maps screen.

### B. Sidebar Search Results
1. When searching for a broad query on Maps (e.g. *"coffee shops in Seattle"*), scroll through the left-hand listing panel.
2. Each place card displays its full category profile, allowing you to rapidly benchmark competitors side-by-side.

---

## 4. In-Page SEO Audit Dashboard

Clicking the **Audit Profile** button on any listing opens the **GBP Sphere Profile Auditor** modal overlay.

### Key Sections:
1. **Local SEO Readiness Score (0-100):**  
   A weighted composite score evaluating profile completeness, category saturation, NAP consistency, and review volume.
2. **Key Metric Cards:**
   - Customer Rating & Review Volume
   - Configured Categories Count (Primary vs. Secondary)
   - 64-bit Place CID and Knowledge Graph Machine ID (`kgmid`)
3. **Tab 1: Overview & Priority Checklist:**  
   Provides automated recommendations (e.g., secondary category saturation, canonical website connectivity, review acquisition velocity).
4. **Tab 2: Category Intelligence:**  
   Detailed table showing each category's role, local pack ranking weight, and search query expansion impact.
5. **Tab 3: NAP & Ranking Factors:**  
   Name, Address, and Phone consistency check.
6. **Action Toolbar:**
   - **Copy Report:** Formats the entire audit into clean Markdown and copies it to your clipboard for instant client messaging or email drafting.
   - **Download CSV:** Exports the profile into an RFC 4180 compliant `.csv` file.

---

## 5. Standalone Tools in the Extension Popup

Click the GBP Sphere icon in your Chrome toolbar to open the control panel:

### Tab 1: Overview
- **Audit Engine Toggle:** Easily pause or activate DOM monitoring with a single click. When paused, all injected category tags and buttons cleanly unmount from your browser.
- **Quick Test Buttons:** Quick shortcuts to test queries on Google Search and Maps.

### Tab 2: Place CID Decoder
Google often conceals the true numeric Customer ID (CID) inside long hex URLs. GBP Sphere includes a standalone decoder:
1. Copy any Google Maps URL or hex Feature ID (`0x...:0x...`).
2. Paste it into the **CID Decoder** input box in the popup.
3. Click **Decode**.
4. The tool instantly extracts:
   - **64-bit Decimal Place CID:** Permanent Google identifier.
   - **Hex Feature ID:** Machine ID.
   - **Direct CID URL:** One-click link that forces Google Maps to display that exact profile regardless of algorithmic location bias.

### Tab 3: Settings & Cache
- View how many places are currently cached in your browser.
- Click **Clear Cache** to wipe cached responses and force fresh live queries from Google Maps.

---

## 6. Exporting Profile Data (CSV Format)

When you click **Export CSV**, GBP Sphere creates a standardized spreadsheet ready for import into Microsoft Excel, Google Sheets, or your agency CRM:

| Column Header | Example Content | Purpose |
|---|---|---|
| `business name` | Austin Dental Clinic | Business branding identity |
| `business address` | 100 Main St, Austin, TX | Verified physical address |
| `primary category` | Dentist | Core ranking category |
| `additional categories` | Dental clinic; Cosmetic dentist | Secondary keyword targets |
| `website URL` | https://austindental.com | Organic landing page link |
| `maps URL` | https://www.google.com/maps?cid=... | Permanent CID link |
| `place CID` | 1958007344816880524 | 64-bit Google place ID |
| `review count` | 142 | Reputation volume |
| `star rating` | 4.9 | Customer satisfaction |
| `recent review date` | 2026-11-10 | Review recency indicator |
| `address locality` | Austin | Target city / market |
| `zip code` | 78701 | Postal area code |
| `seo audit score` | 95 | Overall completeness rating |

---

## 7. Troubleshooting & FAQ

**Q: I don't see categories appearing on Google Search.**  
A: Ensure the extension is enabled in the popup (green "Active & Monitoring" status). Note that on very new search layouts or restricted tabs (such as the photo viewer or expanded reviews modal), injection is paused to prevent interference with Google's modal. Refresh the page to trigger a fresh scan.

**Q: Can I use this for client reporting?**  
A: Yes! Use the **Download CSV** or **Copy Report** button inside the audit modal. The Markdown report is ready to paste into client emails or pitch decks.

**Q: Does GBP Sphere send my search history to any external server?**  
A: **No.** GBP Sphere is completely local and privacy-preserving. All network requests go directly between your browser and Google Maps. Zero third-party telemetry, trackers, or external databases are involved.

