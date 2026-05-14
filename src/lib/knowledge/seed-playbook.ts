/**
 * Pre-seeded Tarkie Identity Playbook v1 (Phase 20.1).
 *
 * This is a one-time seed so the Knowledge Repository has real Tarkie content
 * on first deploy, before any admin uploads a PDF. The seed inserts this as
 * the playbook document (slug: 'tarkie-playbook', category: 'playbook',
 * audience: 'all') so both ARIMA and Eliana have full product knowledge from
 * day one.
 *
 * Admin can later upload a richer / updated playbook PDF via /admin/knowledge
 * which will create v2 and archive this v1 — the seed only runs once and is
 * idempotent.
 *
 * Source: "The Tarkie Identity Playbook V1" (effective Feb 18, 2026,
 *         prepared by Rio Ilao, approved by Rio Ilao).
 */

export const TARKIE_PLAYBOOK_V1_MARKDOWN = `# The Tarkie Identity Playbook (v1)

_Effective: Feb 18, 2026 · Prepared & approved by Rio Ilao_
_© Copyright 2012-2026 MobileOptima, Inc. All rights reserved._

---

## Tarkie Overview

**Headline:** The #1 Choice for Fieldwork Automation in the Philippines

**Mission:** To transform field operations from manual paperwork to intelligent, real-time automation.

**Country:** Philippines

**Market Position:** Launched since 2014 with over 15,000 users and a 95%+ customer retention rate.

**Core Tech Identity:** A "frontline-system," mobile-first system designed for people in the field or for dispersed/remote stores or locations. Also known as FFA (Field Force Automation), SFA (Sales Force Automation), Mobile CRM, Timekeeping System, FSA (Field Service Automation).

### Notable Clients

- **Samsung Philippines** (since 2024): more than 3,000 users across the mobile experience and consumer electronics business units
- **Bounty Chicken Group** including Chooks to Go (since 2016): around 250 company employees and 1,500 merchandisers
- **Uratex** (since 2018): around 800 consignment stores
- **Megasoft** (since 2016): around 2,000 merchandisers and area coordinators
- **Nextrade** (since 2014): first ever Tarkie client, started with just 8 sales agents, now employs 150 sales coordinators and 400 merchandisers
- **Galinco, Ever Bilena, Unipak, Ferinos, BLIMS**
- **Globe** (end contract): previously 2,000 technicians and 2,000 sales agents

### Awards & Recognition

- **2020:** Mansmith Innovation Awardee for the Technology Category
- **2021:** Agora Awardee for Outstanding Achievement in Entrepreneurship (Small Enterprise)
- **2022:** Asia Marketing Excellence Awardee (international award)
- **2022:** Unionbank Pathfinders SME Awardee

### Tech Stack

- **Cloud Infrastructure:** hosted on Amazon Web Services (AWS)
- **Database:** mySQL
- **Field App:** compatible with Android only (no Huawei or iOS as of the moment)
- **Manager App:** both Android and iOS
- **Web Dashboard:** compatible with Google Chrome browser

### Competitors

- **International:** Salesforce (high-end), Beatroute (from India with office in the Philippines), Jibble, Shopl (FFA of Sepco in other countries), Connecteam
- **Local:** E Science (one of the first and has a lot of manpower agency partners), Retail Whiz (~2014), Squadzip (~2014), Lilo (new but aggressively offers low-cost timekeeping P25), Sprout (HRIS)

---

## What Does Tarkie Aim to Solve?

### Problem: "The Hidden Cost of Manual Operations"

Tarkie solves four critical bottlenecks found in traditional field management:

- **Data Delays:** Manual encoding that takes weeks to summarize.
- **Blind Spots:** Zero real-time visibility into store performance or employee location.
- **System Gaps:** Disconnects between expensive back-office ERPs and manual frontline reality.
- **Manual Inefficiency:** Field staff overwhelmed by paperwork instead of performance.

### The Solution

Tarkie is the **eyes and ears** of a company in the field. If a business has an expensive ERP or CRM but still uses paper for their field reports, Tarkie is the "bridge" that digitizes that gap, providing real-time visibility where they previously had blind spots.

Tarkie enables real-time data so companies can make real-time decisions.

### Three Core Pillars

1. **Visibility:** Know where your people are and what they are doing. Know what is going on in your stores and other remote locations. Track field activities, location, and territory coverage.
2. **Digitization:** Digitize any manual form with Tarkie's No-Code Digital Form Builder. Capture photos securely (with date, time, location stamp) in preparation for AI-powered validation.
3. **Integration:** Integrate field data collected from Tarkie with your back-office systems such as ERP, payroll system, warehouse system, CRM, HRIS to eliminate double data entry.

### Ideal Industries

- **Sales & Distribution:** Capturing orders from dealers and mapping whitespace
- **Retail & Franchise:** Sales reporting, inventory management, store audits and compliance
- **FMCG:** Trade marketing execution and on-shelf availability
- **Field Services:** Technician performance and work order management
- **Manpower Agencies:** Timesheet automation and payroll integration

---

## What Kind of "Software" Is Tarkie?

Tarkie vs. traditional systems: Tarkie performs some of their functions but serves a completely different primary goal.

### 1. Tarkie vs. ERP (Back-Office vs. Front-Office)

- **ERP Focus:** Financials, inventory in warehouses, and corporate accounting.
- **Tarkie Focus:** Activity tracking, orders from the street, and inventory in "Consignment" or "Dealers" (locations the ERP often cannot see).
- **The Nuance:** Tarkie is NOT an ERP replacement. It is an ERP **feeder**. It captures the data at the source and feeds it into the ERP to ensure the back-office records are accurate and real-time.

### 2. Tarkie vs. HRIS (Timekeeping vs. Location Integrity)

- **HRIS Focus:** Payroll, benefits, and standard office attendance.
- **Tarkie Focus:** Field-specific attendance. While an HRIS knows IF someone timed in, Tarkie knows WHERE they timed in (GPS) and IF they actually reached their assigned store.
- **The Nuance:** Tarkie specializes in Facial Recognition and Geo-fencing to prevent "Ghost Attendance" which common HRIS systems often miss in mobile settings.

### 3. Tarkie vs. CRM (Lead Tracking vs. Execution)

- **CRM Focus:** Long-term relationship management and sales pipelines (e.g., Salesforce).
- **Tarkie Focus:** Daily Execution — the "Coverage Plan" — ensuring the rep visited the 10 stores they were supposed to visit today and took the necessary photos/orders.
- **The Nuance:** Standard CRMs are often too complex for field reps. Tarkie is Mobile-First, designed to be used with one hand while standing in a busy store.

### 4. Tarkie vs. POS (Kiosk Sales vs. Desktop Retail)

- **POS Focus:** High-speed scanning and receipt printing for thousands of SKUs in a fixed store (e.g., a grocery checkout).
- **Tarkie Focus:** Reporting sales and stock levels in small kiosks, consignment shelves, or by roaming agents.
- **The Nuance:** Tarkie is a Mobile POS. It handles smaller SKU sets (ideally <200 per store given the mobile interface) and focuses on stock-taking rather than just high-speed cashiering.

### Tarkie-Fit Scenarios

| Scenario | Is it a Tarkie Fit? | Why? |
|---|---|---|
| Central Warehouse | ❌ NOT IDEAL | Use a specialized WMS (Warehouse Management System). Tarkie is for distributed or dispersed locations. |
| Mobile Technicians | ✅ IDEAL | They move around; Tarkie tracks their Job Orders and ETA. |
| Fixed Office Staff | ❌ NOT IDEAL | Standard HRIS is better for people sitting at a desk. |
| Consignment Stores | ✅ IDEAL | When your inventory is spread across 800 retail shelves you don't own. |
| Merchandisers | ✅ IDEAL | Ensuring promos are set up correctly across hundreds of supermarkets. |
| Construction Workers in 1 project site | ❌ NOT IDEAL | If they are all in 1 project site, better to install a biometrics at the site. |

---

## Tarkie Use Cases: Ideal vs Poor Fit Scenarios

### A. FMCG & Consumer Products

- ✅ **Ideal Users:** Trade marketers, merchandisers, and territory/area managers.
- ✅ **Ideal Use Cases:**
  - **Trade Marketing Execution:** Ensuring point-of-sale materials (POSM) and promos are correctly installed.
  - **On-Shelf Availability (OSA):** Tracking "Out of Stock" (OOS) items in real-time to trigger replenishment.
  - **Competitor Analysis:** Reporting on competitors' pricing or new product launches directly from the aisle.
- ❌ **NOT Ideal:** Brands selling only through third-party e-commerce platforms (Lazada/Shopee) where they have no physical presence to audit.
- **Relevant Features:** AI Photo Validation vs. Guidelines, Physical Count/OSA, Market Sensing reports, Trade Standards Checklist (Trade Check), Store-based Attendance, Digital Forms Builder.

### B. Sales & Distribution

- ✅ **Ideal Users:** Sales reps or sales agents, van salesmen, and regional/area distributors.
- ✅ **Ideal Use Cases:**
  - **PJP Compliance:** Ensuring agents visit the exact sequence of stores planned for the day.
  - **Order Capture:** Taking digital orders from dealers and syncing them to the warehouse immediately.
  - **Whitespace Mapping:** Identifying potential new accounts in a territory vs. existing ones.
- ❌ **NOT Ideal:** High-volume supermarket checkouts (Tarkie is for field orders, not acting as a high-speed cashier station).
- **Relevant Features:** Sales/Order Entry, Sales Performance vs Target, Sales Incentives, GPS Tracking (5-min intervals), Coverage Plan Compliance, Orders/Delivery Tracking to Dealers, Digital Forms Builder for custom forms.

### C. Retail & Franchise

- ✅ **Ideal Users:** Store staff, area managers, store auditors, and consignment "disers".
- ✅ **Ideal Use Cases:**
  - **Daily Sales Reports (DSR):** Reporting and consolidating daily sales from hundreds of consignment locations instantly.
  - **Inventory Count:** Visibility on inventory levels and any variances, especially in company-owned locations.
  - **Audit Checklists:** Replacing "thick binders" of paper with mobile checklists for store cleanliness, stock, and compliance.
  - **Replenishment:** Triggering stock orders when inventory hits critical levels.
- ❌ **NOT Ideal:** Single-location businesses where the owner is always present; there is no "blind spot" to solve.
- **Relevant Features:** Sales Form, Physical Count Form, Full Inventory Tracking (including deliveries and pull-outs), Sales vs. Target Dashboards, Sales Incentives, Orders from Branch to Head Office, Store-based Attendance.

### D. Field Services & Maintenance

- ✅ **Ideal Users:** Technicians, installers, and service delivery crews.
- ✅ **Ideal Use Cases:**
  - **Job Order Dispatching:** Assigning repair tasks to the nearest available tech.
  - **Proof of Fulfillment:** Capturing "Before and After" photos and customer e-signatures together with a Digital Service Report output.
  - **Customer Communication:** Sending automated SMS alerts with the technician's ETA.
- ❌ **NOT Ideal:** In-house "bench" repair shops where technicians never leave the central facility.
- **Relevant Features:** Service Module (Job Orders), Customer Satisfaction Surveys, ETA/Location tracking links, Automated Scheduling and Assignment, Route Optimization.

### E. Manpower & Staffing Agencies

- ✅ **Ideal Users:** Outsourced merchandisers, promo girls/boys, and agency supervisors.
- ✅ **Ideal Use Cases:**
  - **Verified Attendance:** Preventing "ghost employees" via facial recognition and GPS geofencing.
  - **Payroll Feed:** Automating the Daily Time Record (DTR) so agencies can bill clients accurately and faster.
  - **Deployment Tracking:** Real-time visibility into which client sites are currently manned.
- ❌ **NOT Ideal:** Agencies looking only for a back-office HRIS (payroll/tax filing) without any interest in field activity.
- **Relevant Features:** Facial Recognition, Geofence Restrictions, and Automated Attendance and Expense Reporting.

---

## Tarkie Modules and Functionalities

### 1) Attendance (Basic)

- Schedule Management
- Time-in/out with Photo and GPS
- Facial Recognition
- One Look Photo Documentation
- Overtime Filing and Approval
- Leave Filing and Approval
- Digital Daily Time Record with Photo
- Attendance Reports per Person, Team, Area, Agency (exportable in xls, csv)

### 2) Visits and Coverage Plan (Basic)

- Coverage Plan (PJP) Management
- Check-in/out per Store with Photo and GPS
- Geo-fence restriction upon check-in/out
- GPS Tracking every 5 mins from time-in until time-out
- Tracking of Compliance to Coverage Plan, including Deviations
- Master list of allowed deviation reasons
- Productivity Reports per Person, Team, Area, Agency (exportable in PDF, xls, csv)
- **Add-on:** Route Optimization
- **Add-on:** AI-enabled Clustering and Scheduling

### 3) Field Expenses (Basic)

- Set expense budget per route/coverage plan
- Declare/tag actual expenses incurred with photos, receipts
- Set Validation Rules vs budget
- Automated Expense Report per Person in PDF
- Expense Report Summary in Web Dashboard for Finance review/processing
- Custom Expense Dashboard per Team, Area, Agency
- **Add-on:** AI-enabled Receipt Scanning

### 4) Sales Entry per Store (Basic)

- Digital Sales Form in App (can be per transaction or a summary by sku/category)
- Barcode or QR Code Scanning
- Sales Performance vs Target by Store
- Summarized Sales Reports in Web Dashboard by Person, Team, Area, Agency
- **Add-on:** if more than 200 skus

### 5) Physical Count (Basic)

- Declaration of physical or actual on hand stocks in App
- On-Shelf Availability
- Reporting of products that are out of stock
- **Add-on:** if more than 200 skus

### 7) Sales Full (SME and up)

All inclusions in Basic, plus:

- Ordering in App
- Orders Tracking and Management in Dashboard
- Sales Performance vs Target by Staff
- Sales Incentive Computation

### 8) Inventory Full (SME and up)

All inclusions in Basic, plus:

- Inventory Movements Tracking (beginning less sales plus deliveries less pull-outs, etc.)
- Delivery Receiving
- Set Target Inventory per Store
- Track Critical Stocks
- Track Inventory Variances (System Inventory vs On-hand)
- Process Inventory Adjustments/Corrections

### 9) CRM (SME and up)

- Leads Management
- Funnel Management with configurable statuses
- Conversion of leads to customers
- Leads vs Customer Mapping
- Visits scheduling and history tracking
- Checklists and Photos
- Actual Leads Generated (Count and Value) vs Target by Sales Agent
- Summarized Reports in Web Dashboard by Person, Team, Area, Agency

### 10) Service (SME and up)

- Job Order Tracking and Management
- Job Order Assignment and Dispatching
- Digital Service Report
- Service Fulfillment Proofs (photos, signature)
- Customer Satisfaction Survey
- Automated SMS notifications to customers
- Optional link to view ETA and location of service/delivery crew
- Summarized Reports in Web Dashboard by Person, Team, Area, Agency
- **Add-on:** Route Optimization
- **Add-on:** AI-enabled Order Assignment and Scheduling

### 11) Assets (SME and up)

- Asset database per store/location
- Track Asset Status
- Checklists and Photos
- Summarized Reports in Web Dashboard by Person, Team, Area, Agency

### 12) Retail Execution Digital Reports (SME and up)

- Retail Status Checklist
- Promo Implementation Status
- Visual Merchandising Display Ordering
- Market Sensing
- Client can customize any digital form on top of the list above via Tarkie's Form Builder
- Client can also customize the workflow via Tarkie's Workflow Builder
- Tarkie digital forms can be answered offline in App, no need for internet
- Tarkie digital forms can be answered both in App or through the Web (sent as a link)
- **Add-on:** AI-enabled Photo Validation vs Guidelines
- **Add-on:** Custom Analytics Dashboard

---

## The Tarkie Service Model (SaaS): Value Beyond Software

Tarkie is positioned as a **Strategic Technology Partner**, moving away from the traditional "vendor-client" transaction and ready to grow and evolve with the client throughout their digital transformation journey.

### Five Pillars of Customer Success — "Let us take your headache away!"

1. **Zero Infrastructure Burden:** Clients do not need to invest in servers, hardware, or specialized IT personnel; Tarkie manages the entire technical ecosystem.
2. **Agile and Quick to Deploy:** Unlike traditional enterprise software that can take months to implement, Tarkie's cloud-native architecture allows for rapid deployment using existing mobile devices and browsers.
3. **Future-Proofing with Constant Upgrades:** Through a steady stream of upgrades, Tarkie ensures that the client's solution never becomes obsolete, constantly adding relevant features and functionalities.
4. **Managed Data Infrastructure:** All backups and data recovery processes are automated and managed by Tarkie, ensuring security without requiring user intervention.
5. **Long-Term Partnership:** Tarkie's business model is built on long-term relationships rather than upfront license profit. Since the company typically does not earn on first-year fees, its success is directly tied to the client's long-term satisfaction and retention.

### Standard Software Subscription Inclusions

- Full Software Licensing
- Continuous OS Compatibility Updates (ensuring the app works as mobile OS versions change)
- Standard Feature Upgrades
- Secure Cloud Data Storage
- Managed Server Maintenance & Automatic Backups
- Direct Technical Support
- Enterprise-Grade Security Protocols

### Credentials as a Tech Partner

- **Solid Track Record:** With over 10 years of experience, Tarkie has consistently delivered reliable automation solutions that drive success for businesses.
- **Reliable After-Sales Service:** Many clients have stayed with Tarkie for years, trusting them to support their ongoing growth.
- **Customization:** Tarkie is designed to be simple yet powerful, offering no-code to low-code customization options.

---

## Tarkie Investment

Tarkie may not always be the lowest-cost option, but it is positioned as one of the best.

### Part 1: Set-up, Implementation and Training Fees

| Service | Description | Cost |
|---|---|---|
| Setup, Project Implementation, Training | Process Mapping and Fit-Gap Analysis · Digitization Recommendation Deck · System and Workflow Configuration · Initial Master Data Setup · 1 Administrator Training (within NCR) · 1 Manager Training (within NCR) · 1 User Training (within NCR) · User Manuals · Best Practices Policy Deck · 30-day Viber Project Update · Assigned Project Manager. Excludes: Customization, Integration, Cost of Pilot, Exclusive Cloud Setup. | Starts at PXX + VAT upfront |

### Part 2: Monthly Subscription (per user per month)

| Package | Price | Inclusions |
|---|---|---|
| **BASIC** (up to 3 Basic Modules) | **P 550 + VAT** | Up to 100 customers per user · Up to 2 photos per visit · Alerts & Notifications · Optional Add-on: Route Optimization |
| **SME** (up to 6 Modules) — Popular | **P 850 + VAT** | Up to 500 customers per user · Up to 10 photos per visit · Up to 5 Digital Forms or 100 fields/questions · Facial Recognition · Alerts & Notifications · Optional Add-on: Route Optimization |
| **ENTERPRISE** (all Modules) | **P 1,500 + VAT** | Up to 5,000 customers per user · Unlimited Photos · Unlimited Digital Forms · Facial Recognition · Alerts & Notifications · Optional Add-on: Route Optimization |

**IMPORTANT:** Minimum P 10K monthly subscription, can be a combination of packages.

---

_End of Tarkie Identity Playbook v1._
`;
