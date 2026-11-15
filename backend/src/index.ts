import cors from "cors";
import express from "express";
import YahooFinance from "yahoo-finance2";
import { z } from "zod";

type CurrencyRates = Record<string, number>;

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const yahooFinance = new YahooFinance();

app.use(cors());

const quoteQuerySchema = z.object({
  holdings: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          const [symbol, unitsRaw] = item.split(":");
          return {
            symbol: symbol?.trim().toUpperCase(),
            units: Number(unitsRaw),
          };
        }),
    ),
});

async function getRatesToPln(currencies: string[]): Promise<CurrencyRates> {
  const unique = [...new Set(currencies.map((c) => c.toUpperCase()))];
  const rates: CurrencyRates = { PLN: 1 };

  for (const currency of unique) {
    if (currency === "PLN") {
      rates[currency] = 1;
      continue;
    }

    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${currency}&to=PLN`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch FX for ${currency}`);
    }
    const data = (await response.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.PLN;
    if (!rate) {
      throw new Error(`Missing PLN FX rate for ${currency}`);
    }
    rates[currency] = rate;
  }

  return rates;
}

app.get("/api/portfolio", async (req, res) => {
  try {
    const parsed = quoteQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error:
          "Invalid query. Use holdings=SYMBOL:UNITS,SYMBOL:UNITS (e.g. VWCE.DE:10,AGGH.DE:7)",
      });
    }

    const holdings = parsed.data.holdings;
    if (!holdings.length) {
      return res.status(400).json({
        error: "No holdings provided",
      });
    }

    const symbols = holdings.map((h) => h.symbol);
    const quotes = await yahooFinance.quote(symbols);
    const quoteArray = Array.isArray(quotes) ? quotes : [quotes];

    const symbolToQuote = new Map(
      quoteArray.map((quote) => [quote.symbol?.toUpperCase(), quote]),
    );
    const currencies = quoteArray
      .map((q) => q.currency?.toUpperCase())
      .filter((c): c is string => Boolean(c));

    const fxRates = await getRatesToPln(currencies);

    const warnings: string[] = [];

    const result = holdings.map((item) => {
      const quote = symbolToQuote.get(item.symbol);
      const price = quote?.regularMarketPrice ?? quote?.previousClose ?? 0;
      const currency = quote?.currency?.toUpperCase() ?? "PLN";
      const fxRateToPln = fxRates[currency] ?? 1;
      const valuePln = price * item.units * fxRateToPln;

      if (!quote) {
        warnings.push(`Brak danych rynkowych dla symbolu ${item.symbol}`);
      } else if (price <= 0) {
        warnings.push(
          `Nie znaleziono aktualnej ceny dla ${item.symbol}. Sprawdz ticker/gielde.`,
        );
      }

      return {
        symbol: item.symbol,
        units: item.units,
        name: quote?.shortName ?? quote?.longName ?? item.symbol,
        price,
        currency,
        fxRateToPln,
        valuePln,
      };
    });

    return res.json({
      updatedAt: new Date().toISOString(),
      positions: result,
      warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Portfolio API listening on http://localhost:${PORT}`);
});
