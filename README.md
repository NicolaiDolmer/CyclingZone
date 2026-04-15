# 🚴 Cycling Zone Manager — Setup Guide

## Oversigt

Browser-baseret multiplayer cykelmanager-spil.
Bygget med: React + Vite (frontend), Node.js + Express (backend), Supabase (database + auth).

---

## Trin 1 — Supabase Projekt

1. Gå til [supabase.com](https://supabase.com) og opret et **gratis projekt**
2. Gå til **SQL Editor** og kør hele filen: `database/schema.sql`
3. Gem disse værdier fra **Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role secret` key → `SUPABASE_SERVICE_KEY`

---

## Trin 2 — Opret Admin-bruger

1. Gå til **Authentication → Users** i Supabase
2. Klik "Add user" og opret din admin-email
3. Kør denne SQL for at give admin-rolle:

```sql
-- Indsæt efter bruger er oprettet i auth.users
INSERT INTO public.users (id, email, username, role)
VALUES (
  'DIN-USER-UUID-HER',  -- Kopiér fra Authentication → Users
  'din@email.dk',
  'Admin',
  'admin'
);
```

---

## Trin 3 — Backend Opsætning

```bash
cd backend
npm install

# Opret .env fil
cp .env.example .env
```

Udfyld `backend/.env`:
```
SUPABASE_URL=https://XXXXX.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...service_role_key
FRONTEND_URL=http://localhost:5173
PORT=3001

# Google Sheets CSV URL (se nedenfor)
GOOGLE_SHEETS_CSV_URL=https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv
```

**Google Sheets CSV URL:**
1. Åbn dit Google Sheet med UCI points
2. Fil → Del og eksportér → Publicer til web
3. Vælg: Regneark → CSV → Publicer
4. Kopiér URL'en til `GOOGLE_SHEETS_CSV_URL`

```bash
npm run dev   # Start backend på port 3001
```

---

## Trin 4 — Frontend Opsætning

```bash
cd frontend
npm install

# Opret .env fil
```

Opret `frontend/.env`:
```
VITE_SUPABASE_URL=https://XXXXX.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...anon_key
VITE_API_URL=http://localhost:3001
```

```bash
npm run dev   # Start frontend på port 5173
```

---

## Trin 5 — Importer Ryttere

```bash
cd scripts

# Installer Python dependencies
pip install pandas openpyxl requests

# Eksportér Google Sheets til CSV (download manuelt eller brug URL)
# Kør import
python import_riders.py \
  --worlddb /sti/til/WORLD_DB_2026_Dyn_Cyclist.xlsx \
  --sheets-csv /sti/til/uci_top1000.csv \
  --supabase-url https://XXXXX.supabase.co \
  --supabase-key DIN_SERVICE_ROLE_KEY

# Dry run (ingen skrivning til DB):
python import_riders.py \
  --worlddb WORLD_DB.xlsx \
  --sheets-csv uci.csv \
  --dry-run
```

---

## Trin 6 — Opret første sæson (Admin Panel)

1. Log ind med admin-kontoen på `http://localhost:5173`
2. Gå til **Admin** i menuen
3. Opret sæson nummer 1
4. Tilføj løb til kalenderen
5. Klik "Start sæson" for at udbetale sponsorpenge og åbne spillet

---

## Trin 7 — Importer Løbsresultater

1. Kør løbet i PCM
2. Eksportér resultater som Excel (.xlsx) fra PCM
3. Gå til **Admin → Importer løbsresultater**
4. Upload filen og angiv race_id
5. Systemet fordeler automatisk præmiepenge

---

## Deployment (gratis)

### Frontend → Vercel
```bash
cd frontend
npm run build
# Push til GitHub → connect repo på vercel.com
# Sæt env vars i Vercel dashboard
```

### Backend → Railway
1. Gå til [railway.app](https://railway.app)
2. "New Project" → "Deploy from GitHub"
3. Sæt environment variables
4. Railway giver automatisk en URL

### Opdatér frontend URL
```
VITE_API_URL=https://din-backend.railway.app
```

---

## Filstruktur

```
cycling-manager/
├── database/
│   └── schema.sql              ← Kør i Supabase SQL Editor
├── scripts/
│   ├── import_riders.py        ← Engangsimport af ryttere
│   └── import_race_results.py  ← CLI-alternativ til admin upload
├── backend/
│   ├── server.js               ← Startpunkt
│   ├── cron.js                 ← Auktionsfinalisering (kører automatisk)
│   ├── package.json
│   └── lib/
│       ├── auctionEngine.js    ← Tidslogik for auktioner
│       ├── economyEngine.js    ← Løn, renter, sæsonøkonomi
│       └── sheetsSync.js       ← Google Sheets UCI sync
│   └── routes/
│       └── api.js              ← Alle API endpoints
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── lib/
│       │   ├── supabase.js
│       │   └── boardUtils.js
│       ├── components/
│       │   └── Layout.jsx
│       └── pages/
│           ├── LoginPage.jsx
│           ├── DashboardPage.jsx
│           ├── RidersPage.jsx
│           ├── AuctionsPage.jsx
│           ├── TransfersPage.jsx
│           ├── TeamPage.jsx
│           ├── StandingsPage.jsx
│           ├── BoardPage.jsx
│           └── AdminPage.jsx
└── README.md
```

---

## Tilbageværende punkter (Fase 3+)

- [ ] Landekode mapping (afventer din fil)
- [ ] Team ID mapping fra PCM (afventer din fil)
- [ ] Rider statistik-side (historik per rytter)
- [ ] Sæson 3-sæsoners glidende gennemsnit for rangliste
- [ ] Transfervindue UI (godkendelse ved sæsonskifte)
- [ ] Division min-rider krav ved oprykningskontrol

---

## Nyttige Supabase Queries

```sql
-- Se alle holds balance
SELECT name, balance, division FROM teams WHERE is_ai = false ORDER BY balance DESC;

-- Se aktive auktioner
SELECT r.firstname, r.lastname, a.current_price, a.calculated_end
FROM auctions a JOIN riders r ON r.id = a.rider_id
WHERE a.status IN ('active','extended') ORDER BY a.calculated_end;

-- Opdatér en bruger til admin
UPDATE public.users SET role = 'admin' WHERE email = 'din@email.dk';
```
