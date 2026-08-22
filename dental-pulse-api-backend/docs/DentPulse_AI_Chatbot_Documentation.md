# DentPulse Enterprise — AI Chatbot & AI Features Documentation

**Document Version:** 1.0
**Date:** 3rd March 2026
**Prepared By:** Development Team

---

## 1. Executive Summary

The DentPulse platform integrates three distinct AI-powered features that assist dental group operators with real-time insights, contextual assistance, and automated invoice processing. All AI functionality runs through **Supabase Edge Functions** (Deno runtime) or directly from the browser — the Express backend contains zero AI code.

---

## 2. AI Features Overview

The platform has **3 independent AI systems**, each using different models and gateways:

| Feature | Purpose | Model | Gateway | Runtime |
|---|---|---|---|---|
| **AI Chat Widget** | Floating conversational assistant | `google/gemini-2.5-flash` | Lovable AI Gateway | Supabase Edge Function (Deno) |
| **AI Summary Card** | Per-page automated insights | `google/gemini-3-flash-preview` | Lovable AI Gateway | Supabase Edge Function (Deno) |
| **Invoice OCR Extraction** | PDF/image invoice data extraction | `gpt-4o` + `gpt-4o-mini` | OpenAI API (direct) | Client-side (browser) |

---

## 3. System Architecture

```
+--------------------------------------------------+
|                  React Frontend                   |
|                                                   |
|  +----------------+     +---------------------+  |
|  | AIChatWidget   |     | AISummaryCard       |  |
|  | (floating btn) |     | (top of pages)      |  |
|  +-------+--------+     +---------+-----------+  |
|          |                        |               |
|  +-------v--------+     +--------v-----------+   |
|  | useAIChat hook  |     | useAISummary hook  |   |
|  | (SSE streaming) |     | (request/response) |   |
|  +-------+---------+     +--------+-----------+   |
|          |                        |               |
|          | raw fetch()            | supabase      |
|          | + Bearer token         | .functions    |
|          |                        | .invoke()     |
+----------+------------------------+---------------+
           |                        |
    +------v-------+       +--------v--------+
    | Supabase     |       | Supabase        |
    | Edge Function|       | Edge Function   |
    | ai-chat      |       | ai-summary      |
    +------+-------+       +--------+--------+
           |                        |
           | LOVABLE_API_KEY        | LOVABLE_API_KEY
           |                        |
    +------v------------------------v--------+
    |       Lovable AI Gateway               |
    |  ai.gateway.lovable.dev/v1/chat/       |
    |           completions                  |
    +------+-----------------------+---------+
           |                       |
    +------v--------+    +--------v---------+
    | Gemini 2.5    |    | Gemini 3 Flash   |
    | Flash         |    | Preview          |
    | (streaming)   |    | (non-streaming)  |
    +---------------+    +------------------+


    +--------------------------------------------------+
    |            Invoice OCR (Separate Flow)            |
    |                                                   |
    |  PDF/Image Upload                                 |
    |       |                                           |
    |       v                                           |
    |  openAIService.ts (client-side)                   |
    |       |                                           |
    |       +---> gpt-4o (Vision) ---> Raw Text         |
    |       |                                           |
    |       +---> gpt-4o-mini -------> Structured JSON  |
    |                                                   |
    +--------------------------------------------------+
```

---

## 4. AI Chat Widget — Detailed Documentation

### 4.1 Files Involved

| File | Location | Role |
|---|---|---|
| `AIChatWidget.tsx` | `src/components/ai/` | UI component (floating chat panel) |
| `useAIChat.ts` | `src/hooks/` | SSE streaming logic & state management |
| `ai-chat/index.ts` | `supabase/functions/` | Supabase Edge Function (server-side) |
| `MainLayout.tsx` | `src/components/layout/` | Integrates the widget into every page |

### 4.2 User Interface

- **Trigger:** Fixed floating button (bottom-right corner, `z-50`, 56x56px rounded circle)
- **Panel:** 384px wide (`w-96`), max height `calc(100vh - 140px)`, slide-up animation
- **Header:** Displays "DentPulse AI" with role label (e.g. "admin Assistant"), sparkle icon, and clear conversation button (trash icon, visible only when messages exist)
- **Message Area:** 320px height (`h-80`) scrollable region with auto-scroll to latest message
- **User Messages:** Right-aligned, primary brand colour background
- **Assistant Messages:** Left-aligned, muted background
- **Loading State:** Animated three-dot ellipsis while streaming
- **Error State:** Red destructive banner below messages
- **Input:** Text input with send button, disabled during loading
- **Auto-focus:** Input field receives focus when panel opens

### 4.3 Empty State — Suggested Questions

When no messages exist, the widget displays 4 clickable suggested questions:

1. "What's our current financial health?"
2. "Which locations need attention?"
3. "How are our AR days trending?"
4. "What are the top risks this week?"

Clicking any suggestion sends it as the first message.

### 4.4 Streaming Flow (Step by Step)

```
1. User types message and hits Send
       |
2. Message immediately appended to local state (user bubble appears)
       |
3. fetch() POST to: ${SUPABASE_URL}/functions/v1/ai-chat
   Headers:
     - Content-Type: application/json
     - Authorization: Bearer ${SUPABASE_ANON_KEY}
   Body:
     - messages: [...conversationHistory, newUserMessage]
     - role: userRole (e.g. "admin")
     - context: { ...pageData, currentPage: "/cash-ar" }
       |
4. Edge Function receives request
       |
5. Edge Function builds system prompt (role-based + context injection)
       |
6. Edge Function calls Lovable AI Gateway (Gemini 2.5 Flash, stream: true)
       |
7. Gemini SSE stream is proxied directly back to the browser
   Response headers: Content-Type: text/event-stream
       |
8. Frontend reads stream with resp.body.getReader() + TextDecoder
       |
9. SSE lines parsed:
   - Skip blank lines and comment lines (starting with ":")
   - Process lines starting with "data: "
   - Parse JSON, extract choices[0].delta.content
   - Append each token to the assistant message in real-time
       |
10. Stream ends on "[DONE]" sentinel
       |
11. Loading state set to false, full message displayed
```

### 4.5 Page Context Awareness

The chatbot knows which page the user is on through **two mechanisms working together**:

| Layer | Source | What It Provides | Always Present? |
|---|---|---|---|
| **URL Path** | `useLocation().pathname` | Current route (e.g. `/cash-ar`, `/treatments`) | Yes — always sent as `currentPage` |
| **Page Data** | `aiContext` prop from each page → `MainLayout` → `AIChatWidget` | Page-specific metrics and KPIs | Only if the page passes data |

Both are merged into a single `context` object and appended to the system prompt as:

```
Current context:
{
  "currentPage": "/cash-ar",
  "collections": 94.2,
  "arDays": 28,
  "overdueAccountsCount": 12,
  ...
}
```

### 4.6 Role-Based System Prompts

The Edge Function selects a different system prompt based on the user's role:

| Role | Target User | Prompt Focus |
|---|---|---|
| `admin` | Dental group executives | Enterprise financial intelligence for 40+ practices; Net Production, EBITDA, Collections, AR Days, cross-location benchmarks, risk identification, budget/forecasting |
| `regional_manager` | Regional managers | Regional aggregate performance, location rankings, action priorities, scheduling, cash flow/AR |
| `practice_manager` | Practice managers | Daily production/collection trends, provider performance, chair utilisation, treatment acceptance, local budget adherence |
| `default` | General users | Generic dental practice assistant with practical financial insights |

### 4.7 Error Handling

| Scenario | Response |
|---|---|
| HTTP 429 (Rate Limit) | "Rate limit exceeded. Please try again in a moment." |
| HTTP 402 (Payment Required) | "AI usage limit reached. Please add credits to continue." |
| Other API errors | "AI service temporarily unavailable" |
| Stream abort (user cancels) | Silently returns, no error shown |
| Network failure | Error banner displayed below messages |

### 4.8 Limitations

- **No conversation persistence** — chat history is stored in React state only; cleared on page refresh or trash button click
- **No database storage** — messages are not saved to any table
- **Single session** — each page load starts a fresh conversation
- **No multi-turn memory** — the full message history is sent with each request (context window limited by Gemini's token limit)

---

## 5. AI Summary Card — Detailed Documentation

### 5.1 Files Involved

| File | Location | Role |
|---|---|---|
| `AISummaryCard.tsx` | `src/components/ai/` | UI component (gradient card at top of pages) |
| `useAISummary.ts` | `src/hooks/` | Non-streaming fetch logic |
| `ai-summary/index.ts` | `supabase/functions/` | Supabase Edge Function (server-side) |

### 5.2 Component Props

```typescript
interface AISummaryCardProps {
  page: string;              // Page identifier (e.g. "dashboard", "cash-ar")
  role?: string;             // User role (default: "admin")
  data: Record<string, any>; // Page-specific data object
  className?: string;        // Optional CSS class
  autoGenerate?: boolean;    // Auto-generate on mount (default: true)
}
```

### 5.3 User Interface

- **Card Style:** Gradient border (`bg-gradient-to-br from-primary/5 via-background to-primary/5`)
- **Header:** "AI Insights" label with sparkle icon and refresh button (RefreshCw icon)
- **Loading State:** Three skeleton bars of decreasing width
- **Error State:** AlertCircle icon with error message
- **Summary Display:** Full text with "Read More / Read Less" toggle when content exceeds 150 characters
- **Empty State:** Italic placeholder — "Click refresh to generate AI insights"

### 5.4 Generation Flow

```
1. Page mounts with AISummaryCard component
       |
2. useEffect triggers if autoGenerate=true AND data is non-empty
       |
3. supabase.functions.invoke('ai-summary', {
     body: { page, role, data }
   })
       |
4. Edge Function receives request
       |
5. Edge Function selects page-specific system prompt
       |
6. Sends NON-STREAMING request to Gemini 3 Flash Preview
   User prompt: "Here is the current data for the {page} page:
                  {JSON data}
                  Please provide a concise summary (2-3 paragraphs)
                  with actionable insights."
       |
7. Full response returned as { summary: string }
       |
8. Summary displayed in the card with expand/collapse toggle
```

### 5.5 Page-Specific System Prompts (12 Defined)

| Page Slug | AI Focus Area |
|---|---|
| `dashboard` | Executive KPI summary — revenue, collections, patient metrics, trends |
| `cash-ar` | AR aging, cash flow health, collection efficiency, concerning trends |
| `cashflow` | Cash received vs paid, closing balance trend, top cash generators, free cash flow, liquidity health |
| `profitability` | Margin performance, cost efficiency, revenue optimisation |
| `providers` | Provider productivity, revenue contribution, improvement areas |
| `staff-costs` | Labour efficiency, cost trends, optimisation opportunities |
| `lab-fees` | Lab cost management, vendor performance, cost optimisation |
| `treatments` | Service mix, revenue per treatment, growth opportunities |
| `marketing` | Campaign performance, patient acquisition cost, ROI analysis |
| `cost-impact` | Potential savings, risk areas, strategic recommendations |
| `budget` | Variance analysis, spending trends, budget optimisation |
| `reports` | Comprehensive financial health summary and key takeaways |

**Role overlay applied on top of page prompt:**

| Role | Tone |
|---|---|
| `owner` | Strategic insights and high-level summaries |
| `admin` | Operational insights and actionable recommendations |
| Other | Clear, practical information |

### 5.6 Re-generation Behaviour

- **Auto-generates** on mount when `autoGenerate=true` and data is non-empty
- **Re-triggers** when the `page` prop changes
- **Does NOT re-trigger** when `data` changes on the same page
- **Manual refresh** available via the refresh button (always re-generates)

---

## 6. Pages Using AI Features

### 6.1 AIChatWidget Coverage

**Available on ALL protected pages** — rendered globally via `MainLayout.tsx`:

```tsx
<AIChatWidget userRole={userRole} context={aiContext} />
```

Every page wrapped in `MainLayout` has access to the floating chat assistant.

### 6.2 AISummaryCard Coverage (17 Pages)

| Page | File | Slug Passed | Data Passed to AI |
|---|---|---|---|
| Dashboard | `Dashboard.tsx` | `"dashboard"` | netProduction, ebitda, collections, arDays, claims, weeklyChanges, topRisks, attentionLocationsCount |
| Cash & AR | `CashAR.tsx` | `"cash-ar"` | collections, arDays, regionalAR, overdueAccountsCount, highestARDays |
| Cashflow | `Cashflow.tsx` | `"cashflow"` | totalIncome, totalPayment, closingBalance, freeCashFlow, topCategories |
| Profitability | `Profitability.tsx` | `"profitability"` | P&L data (profitabilityData) |
| Providers | `Providers.tsx` | `"providers"` | providersData |
| Staff Costs | `StaffCosts.tsx` | `"staff-costs"` | GL-based cost metrics (aiContextData) |
| Lab Fees | `LabFees.tsx` | `"lab-fees"` | GL-based lab fee metrics (aiContextData) |
| Operating Leases | `OperatingLeases.tsx` | `"operating-leases"` | Lease cost metrics (aiContextData) |
| Treatments | `Treatments.tsx` | `"treatments"` | treatmentsData |
| Marketing | `Marketing.tsx` | `"marketing"` | GA4 + Google Ads data (aiContextData) |
| Budget | `Budget.tsx` | `"budget"` | budgetData |
| Reports | `Reports.tsx` | `"reports"` | P&L + balance sheet + cashflow summaries (reportsData) |
| Tax | `Tax.tsx` | `"tax"` | taxData |
| Performance | `Performance.tsx` | `"performance"` | performanceData |
| Locations | `Locations.tsx` | `"performance"` | performanceData *(reuses "performance" slug)* |
| Chairs | `Chairs.tsx` | `"chairs"` | chairsData *(no custom prompt — falls back to default)* |
| Accounts Payable | `AccountsPayable.tsx` | `"accounts-payable"` | apData *(no custom prompt — falls back to default)* |

### 6.3 Pages Without Custom AI Summary Prompts

The following pages pass a slug to `AISummaryCard` that does **not** have a matching entry in the Edge Function's `pagePrompts` map. They fall back to a **generic default prompt**:

| Page | Slug | Status |
|---|---|---|
| Chairs | `"chairs"` | Falls back to default prompt |
| Accounts Payable | `"accounts-payable"` | Falls back to default prompt |

### 6.4 Shared Slug

`Locations.tsx` and `Performance.tsx` both use the slug `"performance"` — they share the **same AI system prompt** and generate similar summaries.

---

## 7. Invoice OCR Extraction — Detailed Documentation

### 7.1 Files Involved

| File | Location | Role |
|---|---|---|
| `openAIService.ts` | `src/services/` | Client-side OpenAI integration for PDF/image processing |

### 7.2 Purpose

Completely **separate from the chatbot**. This service handles automated extraction of structured invoice data from uploaded PDF and image files in the Accounts Payable module.

### 7.3 Extraction Flow

```
1. User uploads PDF or image in Accounts Payable module
       |
2. If PDF:
   - pdfjs-dist renders each page to HTML canvas at 2x scale
   - Canvas converted to base64 PNG
   - Up to 5 pages processed
       |
3. Step 1 — Vision Extraction:
   - POST to https://api.openai.com/v1/chat/completions
   - Model: gpt-4o (Vision)
   - All page images sent as image_url content blocks
   - Prompt: Extract all visible text from the invoice
   - Returns: Raw extracted text
       |
4. Step 2 — Structured Parsing:
   - POST to https://api.openai.com/v1/chat/completions
   - Model: gpt-4o-mini
   - Response format: { type: 'json_object' }
   - Prompt: Parse raw text into structured invoice JSON
   - Returns: Structured JSON with 30+ fields
       |
5. Output includes:
   - Vendor name, address, contact details
   - Customer name, address
   - Invoice number, date, due date
   - Subtotal, tax amount, total amount
   - Currency, payment terms
   - Line items (description, quantity, unit price, amount)
   - Confidence scores (0-100) per field
```

### 7.4 Extracted Fields (30+)

| Category | Fields |
|---|---|
| **Vendor** | Name, address, phone, email, VAT number, bank details |
| **Customer** | Name, address |
| **Invoice** | Number, date, due date, PO number |
| **Amounts** | Subtotal, tax amount, total amount, currency |
| **Terms** | Payment terms, notes |
| **Line Items** | Description, quantity, unit price, amount, tax rate (per line) |
| **Metadata** | Confidence scores per field (0-100) |

### 7.5 Authentication

- Uses `VITE_OPENAI_API_KEY` directly from the frontend `.env` file
- API key is **exposed in the browser** (client-side)

---

## 8. Authentication & Security

### 8.1 API Key Management

| Key | Storage | Used By | Exposure |
|---|---|---|---|
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend `.env` | `useAIChat` — Bearer token for Edge Function calls | Client-side (by design — anon key) |
| `LOVABLE_API_KEY` | Supabase project secrets | `ai-chat` and `ai-summary` Edge Functions — calls Lovable AI Gateway | Server-side only (secure) |
| `VITE_OPENAI_API_KEY` | Frontend `.env` | `openAIService.ts` — invoice OCR extraction | Client-side (exposed in browser) |
| `VITE_OPENAI_ASSISTANT_ID` | Frontend `.env` | Referenced but not actively used (legacy) | Client-side |

### 8.2 Security Considerations

| Item | Status | Risk Level |
|---|---|---|
| Lovable API Key (Gemini access) | Server-side in Supabase secrets | Low — properly secured |
| Supabase Anon Key | Client-side (intended design) | Low — RLS policies protect data |
| OpenAI API Key | Client-side in browser | **High** — exposed to anyone inspecting network requests |
| Chat message storage | Not persisted | Low — no data leakage risk |
| Context data sent to AI | Page metrics included in prompts | Medium — financial data sent to third-party AI |

---

## 9. Edge Function Details

### 9.1 ai-chat Edge Function

**Path:** `supabase/functions/ai-chat/index.ts`

| Property | Value |
|---|---|
| Runtime | Deno (Supabase Edge Functions) |
| Endpoint | `${SUPABASE_URL}/functions/v1/ai-chat` |
| Method | POST |
| Auth | Bearer token (Supabase anon key) |
| AI Model | `google/gemini-2.5-flash` |
| AI Gateway | `https://ai.gateway.lovable.dev/v1/chat/completions` |
| Streaming | Yes (`stream: true`) — SSE response proxied directly to client |
| Server Secret | `LOVABLE_API_KEY` |

**Request Body:**
```json
{
  "messages": [
    { "role": "user", "content": "What's our financial health?" },
    { "role": "assistant", "content": "Based on your data..." },
    { "role": "user", "content": "Tell me more about AR days" }
  ],
  "role": "admin",
  "context": {
    "currentPage": "/cash-ar",
    "arDays": 28,
    "collections": 94.2
  }
}
```

**System prompt structure:**
```
[Role-specific base prompt]

Current context:
{
  "currentPage": "/cash-ar",
  "arDays": 28,
  "collections": 94.2,
  ...
}
```

### 9.2 ai-summary Edge Function

**Path:** `supabase/functions/ai-summary/index.ts`

| Property | Value |
|---|---|
| Runtime | Deno (Supabase Edge Functions) |
| Endpoint | Invoked via `supabase.functions.invoke('ai-summary')` |
| Method | POST |
| Auth | Supabase SDK (automatic anon key) |
| AI Model | `google/gemini-3-flash-preview` |
| AI Gateway | `https://ai.gateway.lovable.dev/v1/chat/completions` |
| Streaming | No — waits for full response |
| Server Secret | `LOVABLE_API_KEY` |

**Request Body:**
```json
{
  "page": "dashboard",
  "role": "admin",
  "data": {
    "netProduction": 245000,
    "ebitda": 42.5,
    "collections": 94.2,
    "arDays": 28
  }
}
```

**Response:**
```json
{
  "summary": "Your dental group is showing strong performance this period..."
}
```

---

## 10. Module Coverage Matrix

Summary of which modules/pages have AI feature support:

| Module / Page | Chat Widget | AI Summary Card | Custom AI Prompt | Invoice OCR |
|---|---|---|---|---|
| Dashboard | Yes | Yes | Yes | — |
| Cash & AR | Yes | Yes | Yes | — |
| Cashflow | Yes | Yes | Yes | — |
| Profitability | Yes | Yes | Yes | — |
| Providers | Yes | Yes | Yes | — |
| Staff Costs | Yes | Yes | Yes | — |
| Lab Fees | Yes | Yes | Yes | — |
| Operating Leases | Yes | Yes | — | — |
| Treatments | Yes | Yes | Yes | — |
| Marketing | Yes | Yes | Yes | — |
| Budget | Yes | Yes | Yes | — |
| Reports | Yes | Yes | Yes | — |
| Tax | Yes | Yes | — | — |
| Performance | Yes | Yes | — | — |
| Locations | Yes | Yes | — *(reuses "performance")* | — |
| Chairs | Yes | Yes | — *(default fallback)* | — |
| Accounts Payable | Yes | Yes | — *(default fallback)* | Yes |
| Provider Detail | Yes | — | — | — |
| Treatment Detail | Yes | — | — | — |
| Settings | Yes | — | — | — |
| Organisation | Yes | — | — | — |
| Profile | Yes | — | — | — |
| Onboarding | Yes | — | — | — |
| Sync Summary | Yes | — | — | — |
| Notifications | Yes | — | — | — |
| Team Management | Yes | — | — | — |
| Auth (Login) | — | — | — | — |
| Public Approval | — | — | — | — |

**Totals:**
- **Chat Widget:** Available on all protected pages (~25+ pages)
- **AI Summary Card:** Active on 17 pages
- **Custom AI Prompts:** 12 page-specific prompts defined
- **Invoice OCR:** 1 page (Accounts Payable)

---

## 11. Data Flow Summary

```
+------------------+     +-------------------+     +------------------+
|                  |     |                   |     |                  |
|   Supabase DB    +---->+  React Frontend   +---->+  AI Edge         |
|   (source data)  |     |  (prepares        |     |  Functions       |
|                  |     |   aiContext)       |     |  (ai-chat,       |
+------------------+     +-------------------+     |   ai-summary)    |
                                                   +--------+---------+
                                                            |
                                                   +--------v---------+
                                                   |  Lovable AI      |
                                                   |  Gateway         |
                                                   |  (Gemini models) |
                                                   +------------------+
```

1. **Data originates** from Supabase PostgreSQL (synced from Dentally, Iplicit, Xero)
2. **Frontend pages** query data via React Query hooks and prepare `aiContext` objects
3. **AI context** is passed to Edge Functions along with conversation history (chat) or page identifier (summary)
4. **Edge Functions** build role-specific and page-specific system prompts, inject context data, and call Gemini models
5. **Responses** are streamed back (chat) or returned in full (summary) to the frontend

---

## 12. Known Limitations & Gaps

| Item | Description | Impact |
|---|---|---|
| No chat persistence | Conversations are lost on page refresh | Users cannot review past AI interactions |
| No conversation storage | Messages are not saved to any database table | No audit trail of AI conversations |
| Client-side OpenAI key | `VITE_OPENAI_API_KEY` exposed in browser | Security risk — key can be extracted and misused |
| Missing custom prompts | `chairs` and `accounts-payable` pages lack page-specific AI prompts | Generic summaries generated instead of domain-specific insights |
| Shared slug | `Locations` and `Performance` pages share the `"performance"` slug | Identical AI summaries generated for different page contexts |
| No data-change re-trigger | AI summary does not re-generate when page data updates | Users must manually refresh to get updated insights |
| No token limit handling | Full conversation history sent each time | Long conversations may exceed Gemini's context window |
| No rate limiting (frontend) | No client-side throttle on AI requests | Users can spam the chat/refresh button |

---

*This document provides a comprehensive overview of the AI chatbot and AI features in the DentPulse Enterprise platform. For implementation changes or enhancements, refer to the specific files listed in each section.*
