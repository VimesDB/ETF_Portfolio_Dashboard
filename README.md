# ETF Portfolio Dashboard

Prosta aplikacja webowa pokazująca:
- wykres kołowy aktualnego udziału ETF-ow w portfelu,
- wykres słupkowy: aktualny udzial vs docelowy udzial,
- wycene pozycji dynamicznie na podstawie notowan, z przeliczeniem do PLN.

## Struktura

- `frontend` - React + Vite + Recharts
- `backend` - Express + Yahoo Finance + Frankfurter FX API

## Uruchomienie

1. Backend:
   - `cd backend`
   - `npm run dev`
2. Frontend (w drugim terminalu):
   - `cd frontend`
   - `npm run dev`
3. Otworz `http://localhost:5173`

## Konfiguracja ETF-ow

W pliku `frontend/src/App.tsx` zmien tablice `holdings`:

- `symbol` - ticker ETF (np. `VWCE.DE`)
- `units` - liczba jednostek
- `targetPercent` - docelowy udzial procentowy w portfelu

Przyklad:

```ts
const holdings = [
  { symbol: "VWCE.DE", units: 12, targetPercent: 70 },
  { symbol: "AGGH.DE", units: 18, targetPercent: 20 },
  { symbol: "EUNL.DE", units: 6, targetPercent: 10 },
];
```

## API backendu

- `GET /api/health`
- `GET /api/portfolio?holdings=VWCE.DE:12,AGGH.DE:18,EUNL.DE:6`

Backend pobiera:
- ceny ETF z Yahoo Finance,
- kursy walut do PLN z Frankfurter.
