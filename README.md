# LIAN — AI-Powered Personal Skin Companion

> Your skin, understood over time.

LIAN is a mobile + web app that builds a continuously evolving understanding of your skin. It combines AI skin analysis (YouCam API), an LLM reasoning layer (Groq), and a persistent personal skin profile to help you understand what's happening with your skin and what to do next.

**Built for the YouCam API Skin AI & eCommerce VTO Hackathon.**

---

## What LIAN Does

- **Skin Scan** — Take a selfie and get an AI-interpreted skin analysis powered by YouCam
- **Ask LIAN** — Conversational AI that answers questions using your full personal skin history
- **Product Library** — Scan any product, extract ingredients with AI/OCR, get a personalised verdict
- **Routine Builder** — AI generates the minimum-effective routine using your existing products first
- **Skin Timeline** — Track concern trends across scans and see if your routine is working
- **Skin Detective** — Structured investigation when something starts irritating your skin

---

## Tech Stack

| Layer | Tool |
|---|---|
| App (mobile + web) | Expo SDK 57 + Expo Router |
| Auth + Database | Supabase |
| AI (text/chat) | Groq — Llama 3.3 70B (free tier) |
| AI (vision/image) | Gemini 2.5 Flash (free tier) |
| Skin Analysis | YouCam / Perfect Corp API |
| OCR fallback | OCR.space (free tier) |
| Web hosting | Vercel |

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd LIAN
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project
2. In the SQL editor, run the entire contents of `supabase/migrations/001_initial_schema.sql`
3. Copy your **Project URL** and **anon/public key** from Settings → API

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Deploy Supabase Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref your-project-ref

# Set secrets (never commit these)
supabase secrets set GROQ_API_KEY=your-groq-key
supabase secrets set GEMINI_API_KEY=your-gemini-key
supabase secrets set YOUCAM_API_KEY=your-youcam-key
supabase secrets set YOUCAM_API_SECRET=your-youcam-secret
supabase secrets set OCRSPACE_API_KEY=your-ocrspace-key

# Deploy all functions
supabase functions deploy groq-chat
supabase functions deploy gemini-vision
supabase functions deploy youcam-scan
supabase functions deploy extract-ingredients
```

### 5. Get your API keys

| Service | Where to get it | Free tier |
|---|---|---|
| [Groq](https://console.groq.com) | console.groq.com | No credit card, 1000 req/day on Llama 70B |
| [Gemini](https://aistudio.google.com) | Google AI Studio | 250 req/day free |
| [YouCam](https://yce.perfectcorp.com/ai-api) | Perfect Corp developer portal | 1000 free units (hackathon) |
| [OCR.space](https://ocr.space/OCRAPI) | ocr.space/OCRAPI | 25,000 req/month free |

### 6. Run locally

```bash
# Mobile (requires Expo Go app)
npx expo start

# Web only
npx expo start --web
```

### 7. Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Add environment variables in Vercel dashboard:
# EXPO_PUBLIC_SUPABASE_URL
# EXPO_PUBLIC_SUPABASE_ANON_KEY

vercel --prod
```

---

## Architecture

```
User → Expo App (mobile/web)
         ↓
    Supabase Edge Functions (API proxy — keys never on client)
         ↓              ↓              ↓              ↓
    YouCam API    Gemini Vision    Groq Llama    OCR.space
    (skin scan)   (image OCR)     (reasoning)   (text OCR)
         ↓
    Supabase DB (skin profiles, scans, products, routines, conversations)
```

The key architectural principle: **YouCam provides the visual intelligence (objective skin measurements), Groq/Gemini provides the interpretation and reasoning layer.** All API secrets live in Supabase Edge Functions — nothing sensitive touches the client.

---

## YouCam API Integration

LIAN uses the YouCam Skin Analysis API to:
- Analyse 15+ skin concerns from a facial photo
- Get quantitative scores (0–100) for each concern
- Detect skin type

These raw scores are then interpreted by Gemini into plain-language findings, and stored to build a longitudinal model of the user's skin.

---

## Disclaimer

LIAN is not a medical device. All outputs are for personal reference only and do not constitute medical, dermatological, or professional advice. For medical concerns, consult a qualified healthcare professional.
