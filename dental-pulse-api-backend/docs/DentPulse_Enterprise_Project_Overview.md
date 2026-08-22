# DentPulse Enterprise — Project Overview

**Document Version:** 1.0
**Date:** 3rd March 2026
**Prepared By:** Development Team

---

## 1. Executive Summary

DentPulse Enterprise is a full-stack SaaS platform built for **UK dental group operators**. It connects to dental practice management software and accounting systems, centralises data through automated sync pipelines, and delivers executive-level dashboards, financial analytics, AI-powered invoice automation, and multi-location performance insights — all in one unified platform.

The platform is currently live and deployed on **Vercel**, backed by **Supabase** (hosted PostgreSQL) for database and authentication.

---

## 2. Business Problem & Solution

### Problem
Dental group operators manage multiple practice locations, each generating data across separate systems — practice management (Dentally), accounting (Xero, Iplicit), marketing (Google Ads, GA4), and supplier invoices (email). Getting a unified view of financial health, provider performance, and operational metrics requires manual data consolidation, which is time-consuming, error-prone, and lacks real-time visibility.

### Solution
DentPulse Enterprise automates data ingestion from all these sources and presents a single pane of glass with:

- Real-time executive dashboards with KPIs and risk alerts
- Location-level and provider-level performance analytics
- AI-powered accounts payable automation (invoice OCR + approval workflows)
- Treatment profitability and NHS contract tracking
- Budget vs. actual analysis and cashflow reporting
- Multi-integration hub for Dentally, Xero, Iplicit, Google Ads, and GA4

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix) |
| Backend API | Node.js, Express 5 |
| Database | Supabase (PostgreSQL, hosted) |
| Authentication | Supabase Auth (JWT-based) |
| Serverless Functions | 35 Supabase Edge Functions (Deno runtime) |
| AI / ML | OpenAI API (invoice extraction, contextual chat) |
| State Management | TanStack React Query v5 (server state), React Context (global UI state) |
| Charts & Visualisation | Recharts |
| PDF Processing | pdfjs-dist, pdf-parse |
| Deployment | Vercel (frontend SPA + backend serverless) |
| Version Control | Git, GitHub |

---

## 4. System Architecture

```
                         +------------------+
                         |   Vercel (CDN)   |
                         +--------+---------+
                                  |
                  +---------------+---------------+
                  |                               |
          +-------v--------+            +--------v--------+
          |  React Frontend |            | Express Backend |
          |  (SPA on Vercel)|            | (Vercel Node.js)|
          +-------+--------+            +--------+--------+
                  |                               |
                  |   Supabase JS Client          |  Supabase Service Role
                  |   (Auth + DB Reads)           |  (Admin DB Operations)
                  |                               |
                  +---------------+---------------+
                                  |
                         +--------v---------+
                         |     Supabase     |
                         |  PostgreSQL DB   |
                         |  Auth Service    |
                         |  Edge Functions  |
                         |  Storage         |
                         +--------+---------+
                                  |
              +-------------------+-------------------+
              |                   |                   |
     +--------v------+  +--------v------+  +---------v-------+
     |   Dentally    |  |   Iplicit     |  |   Xero          |
     |   REST API    |  |   REST API   |  |   OAuth2 API    |
     +---------------+  +---------------+  +-----------------+

     +----------------+  +----------------+
     | Google Ads API |  | GA4 API        |
     +----------------+  +----------------+

     +----------------+
     | inbound.new    |
     | (Email Webhook)|
     +----------------+
```

---

## 5. Core Modules & Features

### 5.1 Data Sync Engine

The backbone of the platform. Two parallel, queue-based sync systems running on the backend:

| Sync System | Source | Data Synced | Method |
|---|---|---|---|
| Dentally Sync | Dentally API | Patients, Appointments, Treatments, Providers, Invoices, Payment Plans, Treatment Plans, Locations | Paginated (100/page), rate-limit-aware, monthly date chunking |
| Iplicit Sync | Iplicit API | Chart of Accounts, Balance Sheet, Profit & Loss, Account Groups | Session-auth, single API call per entity |

**Key characteristics:**
- In-memory job queues with database persistence (survives server restarts)
- Three-phase execution order (locations and categories first, then entities, then date-filtered data)
- Batch upserts (500 records per batch, 25-record fallback on conflict)
- Automatic retry (up to 3 retries per job) with exponential backoff on rate limits
- Organisation-level isolation (one active job per organisation at a time)
- Real-time job tracking with progress percentage, records processed, and error logging

### 5.2 Executive Dashboard

The landing page for decision-makers:

- **5 KPI Cards:** Net Production, EBITDA Margin, Collections Rate, AR Days (with aging breakdown), Claims Health
- **What Changed This Week:** Tabular summary of key metric changes
- **Locations Requiring Attention:** Flagged locations with below-target performance
- **Top Risks:** Colour-coded risk cards (danger / warning severity)
- **AI Summary:** Auto-generated narrative summary of current business state
- **Iplicit Financial Section:** Live accounting data from connected Iplicit instance

### 5.3 Accounts Payable (AI-Powered)

End-to-end invoice processing with AI automation:

| Step | Description |
|---|---|
| **Intake** | Upload PDF/image manually or receive via inbound email (auto-parsed) |
| **AI Extraction** | OpenAI extracts vendor name, invoice number, date, amounts, and line items from the document |
| **Review** | User reviews and corrects extracted data in a structured form |
| **Approval Workflow** | Route invoices for approval; external approvers can approve/reject via a public link (no login required) |
| **Status Tracking** | `pending_review` → `pending_approval` → `approved` → `paid` |

**Additional features:**
- Custom folder system for invoice organisation
- Tagging and categorisation
- Chart of accounts mapping for each line item
- Export to CSV / Excel
- Inbound email integration via inbound.new (supplier emails auto-create invoice records)
- Processing efficiency and supplier breakdown charts

### 5.4 Financial Analytics

| Module | Description |
|---|---|
| **Profitability** | P&L analysis, EBITDA bridge chart, industry benchmarks |
| **Cash & AR** | Accounts receivable aging analysis, cash flow analytics |
| **Cashflow Statements** | Interactive cashflow statement builder with archival |
| **Budget** | Budget vs. actual comparison, associate profit planning |
| **Tax** | Corporation tax computation per entity and at group level |
| **Cost Impact** | Consolidated view of staff costs, lab fees, operating leases |
| **Reports** | Exportable financial reports (P&L, cashflow, balance sheet) |

### 5.5 Provider Management

- Filtered views by provider type: Dentist, Therapist, Hygienist, Other
- Individual provider deep-dive page with:
  - Production metrics and revenue contribution
  - Working hours and utilisation
  - Associate performance analysis
  - Sliding scale configurations

### 5.6 Treatment Analytics

- Master treatment list with category management
- **NHS Contract Performance:** UDA/UOA tracking against NHS targets
- **Private Treatment Revenue:** Revenue analysis for private treatments
- **Membership Plans:** Subscription plan performance and per-plan detail
- **Profitability:** Per-treatment profitability analysis with goal tracking
- **Specialty Pipelines:** Implant and Invisalign pipeline tracking

### 5.7 Marketing Dashboard

- **Google Analytics 4 Integration:** Website traffic, conversions, session data (OAuth)
- **Google Ads Integration:** Campaign performance, cost-per-click, ROI by location (OAuth)
- Overview, channel breakdown, and campaign-level views

### 5.8 Location & Organisation Management

- Multi-location support with region grouping
- Per-location financial detail pages
- Location-level inbound email configuration
- Region/location CRUD with drag-and-drop organisation

### 5.9 AI Chat Assistant

- Floating chat widget available on every page
- Context-aware — understands which page the user is viewing
- Streams responses via Server-Sent Events (SSE) from a Supabase Edge Function
- Powered by OpenAI with dental business context

### 5.10 Team Management

- Invite team members via email (magic link)
- Role-based access: `Owner`, `Admin`, `Member`
- Role-gated UI elements (e.g., only owners see team management)

---

## 6. Integrations

| Integration | Type | Purpose | Auth Method |
|---|---|---|---|
| **Dentally** | Practice Management | Patient, appointment, treatment, provider, invoice data | API Key (Bearer token) |
| **Iplicit** | Accounting | Chart of accounts, balance sheet, P&L | Session token (API key + domain) |
| **Xero** | Accounting | Chart of accounts, invoices, operating leases | OAuth 2.0 |
| **QuickBooks** | Accounting | Planned integration (placeholder) | OAuth 2.0 |
| **Google Analytics 4** | Marketing | Website analytics | OAuth 2.0 |
| **Google Ads** | Marketing | Ad campaign data | OAuth 2.0 |
| **inbound.new** | Email | Inbound supplier invoice emails | Webhook + API Key |
| **OpenAI** | AI | Invoice OCR extraction, chat assistant | API Key |

---

## 7. User Roles & Access Control

| Role | Scope | Access |
|---|---|---|
| **Superadmin** | Platform-wide | View all organisations, manage users, trigger/stop syncs, configure global settings, deep-delete organisations |
| **Owner** | Organisation | Full access to all features, team management, integration setup, onboarding |
| **Admin** | Organisation | Most features, settings access |
| **Member** | Organisation | Dashboard and analytics access, limited settings |
| **External Approver** | Invoice-specific | Approve/reject invoices via public link (no account required) |

---

## 8. Authentication & Security

- **Authentication:** Supabase Auth with email/password sign-in, magic links for invitations
- **Token Management:** JWT stored in localStorage, auto-refreshed by Supabase client
- **API Security:** All backend routes require valid JWT; superadmin routes additionally verify against the `superadmins` table
- **Rate Limiting:** Login endpoint limited to 30 requests per 15 minutes per IP
- **CORS:** Whitelisted origins (production domain, localhost, LAN ranges)
- **Security Headers:** Helmet middleware on all responses
- **Row Level Security (RLS):** Supabase RLS policies on database tables
- **Organisation Isolation:** All data scoped by `organisation_id` — no cross-org data access
- **Service Role Separation:** Anon key used for auth validation only; service role key used for admin data operations (bypasses RLS)

---

## 9. Database Schema Overview

The Supabase PostgreSQL database contains approximately 40+ tables, grouped as follows:

| Group | Key Tables | Purpose |
|---|---|---|
| **Auth & Users** | `profiles`, `user_roles`, `organizations`, `superadmins` | User accounts, roles, org membership |
| **Integrations** | `integrations`, `platform_integrations`, `integration_sync_entities` | Connection configs for Dentally, Iplicit, Xero |
| **Dentally Data** | `patients`, `appointments`, `treatments`, `providers`, `treatment_plans`, `treatment_plan_items`, `payment_plans`, `practice_locations`, `treatment_categories` | Synced dental practice data |
| **Iplicit Data** | `iplicit_chart_of_accounts`, `iplicit_balance_sheet`, `iplicit_profit_loss`, `iplicit_bank_transactions`, `iplicit_gl_entries` | Synced accounting data |
| **Invoices** | `platform_integration_invoices`, `platform_integration_invoice_line_items` | Synced invoice data from Dentally/Xero |
| **Accounts Payable** | `accounts_payable_invoice`, `accounts_payable_invoice_line_item`, `accounts_payable_invoice_rules_mapping` | AP invoice processing |
| **Email** | `inbound_emails`, `inbound_email_attachments`, `inbound_email_logs`, `location_inbound_emails` | Inbound email pipeline |
| **Notifications** | `general_notification` | In-app notifications |
| **Sync Jobs** | `sync_jobs` | Job tracking with progress, retries, errors |

---

## 10. Deployment & Infrastructure

| Component | Platform | Details |
|---|---|---|
| Frontend | Vercel | SPA with client-side routing; rewrites all paths to `index.html` |
| Backend API | Vercel | Serverless Node.js function via `@vercel/node` |
| Database | Supabase | Managed PostgreSQL (cloud-hosted) |
| Edge Functions | Supabase | 35 Deno-based serverless functions for OAuth, AI, reports |
| PDF Storage | Server Filesystem | AP invoice PDFs stored locally in `backend/AP-Invoices/` |
| DNS / CDN | Vercel | Automatic SSL, edge caching |

**Environments:**
- **Production:** `https://dental-pulse-dev-tzw1.vercel.app` (frontend), `https://dent-enterprise-api.dentpulse.com` (backend API)
- **Development:** `http://localhost:8080` (frontend with Vite dev server), `http://localhost:4000` (backend)

---

## 11. Frontend Application Pages

The frontend contains **55+ pages** organised into the following sections:

| Section | Pages | Description |
|---|---|---|
| **Dashboard** | 1 | Executive KPI dashboard with AI summary |
| **Financial** | 7 | Profitability, Cash & AR, Cashflow, Budget, Tax, Cost Impact, Reports |
| **Providers** | 5 | Provider list (by type) + individual provider detail |
| **Treatments** | 9 | Treatment list, insights, private, membership, NHS, profitability, goals, setup, edit |
| **Accounts Payable** | 2 | Invoice management + approvals |
| **Costs** | 3 | Staff costs, lab fees, operating leases |
| **Marketing** | 1 | GA4 + Google Ads analytics |
| **Locations** | 2 | Location list + location detail |
| **Admin** | 6 | Settings, organisation, team, profile, sync summary, notifications |
| **Onboarding** | 1 | Multi-step wizard (Dentally or manual flow) |
| **Public** | 4 | Login, OAuth callbacks, public invoice approval, approver dashboard |

---

## 12. Key Architectural Decisions

| Decision | Rationale |
|---|---|
| **No ORM** | Direct Supabase JS client for all DB operations — reduces abstraction overhead, leverages Supabase's typed client |
| **In-memory queues + DB persistence** | Fast processing without external queue infrastructure (Redis, RabbitMQ); DB backup ensures recovery on restart |
| **Organisation-scoped data** | Every table includes `organization_id` — ensures strict data isolation between dental groups |
| **Supabase Edge Functions for OAuth** | Keeps OAuth secrets server-side while leveraging Supabase's managed infrastructure |
| **OpenAI for invoice extraction** | Eliminates manual data entry; handles varied invoice formats without template-based OCR |
| **shadcn/ui component system** | Copy-paste component library built on Radix — fully customisable, accessible, no runtime dependency lock-in |
| **TanStack React Query** | Eliminates manual loading/error state management; built-in caching reduces redundant API calls |
| **Monorepo workspace** | Frontend and backend in a single npm workspace — shared dependencies, unified build process |

---

## 13. Supabase Edge Functions (35 Functions)

| Category | Functions | Purpose |
|---|---|---|
| **AI** | `ai-chat`, `ai-summary` | Streaming chat assistant, page-level summaries |
| **Xero** | `xero-auth`, `xero-callback`, `xero-data`, `xero-refresh-token`, `xero-create-invoice`, `xero-initial-sync` | Full Xero OAuth + data sync |
| **Iplicit** | `iplicit-auth`, `iplicit-sync`, `iplicit-sync-v2`, `iplicit-scheduled-sync` | Iplicit auth + sync |
| **Google** | `ga4-auth`, `ga4-callback`, `ga4-properties`, `google-ads-auth`, `google-ads-callback`, `google-ads-data` | GA4 + Google Ads OAuth |
| **Dentally** | `dentally-sync` | Dentally sync trigger |
| **Email** | `inbound-email-webhook` | Email ingestion |
| **Invoicing** | `send-approver-notification`, `update-approval-status`, `get-invoice-for-approval` | AP approval workflow |
| **Reports** | `cashflow-report`, `cashflow-statement-report`, `cashflow-archive-report` | Financial report generation |
| **Settings** | `save-organization-settings` | Org config persistence |

---

## 14. API Endpoints Summary (Backend)

The Express backend exposes the following route groups:

| Route Group | Endpoints | Auth | Purpose |
|---|---|---|---|
| `/api/auth` | 3 | Rate-limited / Superadmin | Login, logout, current user |
| `/api/dashboard` | 1 | Superadmin | Dashboard stats (counts) |
| `/api/users` | 2 | Superadmin | List users, deep-delete user |
| `/api/organizations` | 3 | Superadmin | List/view orgs, update integration |
| `/api/sync` | 11 | Mixed (syncAuth / Superadmin / Service Key) | Dentally sync: trigger, resume, status, cancel |
| `/api/iplicit-sync` | 10 | Mixed | Iplicit sync: trigger, resume, status, cancel |
| `/api/settings` | 4 | Superadmin | Global sync date range config |
| `/api/onboard` | 2 | syncAuth | Dentally and Iplicit onboarding |
| `/api/inbound-email-webhook` | 3 | Public | Email webhook, PDF upload, PDF viewing |
| `/api/health` | 1 | Public | Health check |

**Total: ~40 endpoints**

---

## 15. Current Status

- Platform is **live and deployed** on Vercel
- Dentally and Iplicit sync pipelines are **operational**
- Xero, GA4, and Google Ads integrations are **functional** via OAuth
- AI invoice extraction and chat assistant are **active**
- Inbound email pipeline for AP invoices is **configured and receiving emails**

---

*This document provides a high-level overview of the DentPulse Enterprise platform. For technical implementation details, API specifications, or database schema documentation, please refer to the codebase directly.*
