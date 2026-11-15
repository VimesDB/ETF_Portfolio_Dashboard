export const HISTORY_STORAGE = "portfolio-history-v1";

export type HistoryPoint = {
  date: string;
  portfolioId: string;
  totalValuePln: number;
  recordedAt: string;
};

export type PortfolioHistoryStore = {
  version: 1;
  points: HistoryPoint[];
};

const SUM_KEY = "__sum__";

export function loadHistoryStore(): PortfolioHistoryStore {
  const raw = localStorage.getItem(HISTORY_STORAGE);
  if (!raw) return { version: 1, points: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<PortfolioHistoryStore>;
    if (parsed?.version === 1 && Array.isArray(parsed.points)) {
      return {
        version: 1,
        points: parsed.points
          .filter(
            (p) =>
              typeof p?.date === "string" &&
              typeof p?.portfolioId === "string" &&
              Number.isFinite(Number(p?.totalValuePln)),
          )
          .map((p) => ({
            date: String(p.date).slice(0, 10),
            portfolioId: String(p.portfolioId),
            totalValuePln: Number(p.totalValuePln),
            recordedAt: String(p.recordedAt ?? p.date),
          })),
      };
    }
  } catch {
    /* ignore */
  }
  return { version: 1, points: [] };
}

export function saveHistoryStore(store: PortfolioHistoryStore): void {
  localStorage.setItem(HISTORY_STORAGE, JSON.stringify(store));
}

export function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function hasHistoryPointForToday(
  store: PortfolioHistoryStore,
  portfolioId: string,
  date: string = getTodayIsoDate(),
): boolean {
  return store.points.some((p) => p.portfolioId === portfolioId && p.date === date);
}

export function recordHistoryPoint(
  store: PortfolioHistoryStore,
  portfolioId: string,
  totalValuePln: number,
): PortfolioHistoryStore {
  if (!Number.isFinite(totalValuePln) || totalValuePln <= 0) return store;
  const date = new Date().toISOString().slice(0, 10);
  const withoutSameDay = store.points.filter(
    (p) => !(p.portfolioId === portfolioId && p.date === date),
  );
  return {
    version: 1,
    points: [
      ...withoutSameDay,
      {
        date,
        portfolioId,
        totalValuePln,
        recordedAt: new Date().toISOString(),
      },
    ],
  };
}

export function removeHistoryForPortfolio(
  store: PortfolioHistoryStore,
  portfolioId: string,
): PortfolioHistoryStore {
  return {
    version: 1,
    points: store.points.filter((p) => p.portfolioId !== portfolioId),
  };
}

export type HistoryChartRow = {
  date: string;
  dateLabel: string;
  [key: string]: string | number;
};

export function buildHistoryChartData(
  history: PortfolioHistoryStore,
  portfolios: Array<{ id: string; name: string }>,
  visibleIds: Set<string>,
  showSum: boolean,
): HistoryChartRow[] {
  const dates = new Set<string>();
  for (const point of history.points) {
    if (visibleIds.has(point.portfolioId)) dates.add(point.date);
  }

  const sortedDates = [...dates].sort();
  const valueByDateAndId = new Map<string, number>();
  for (const point of history.points) {
    valueByDateAndId.set(`${point.date}|${point.portfolioId}`, point.totalValuePln);
  }

  return sortedDates.map((date) => {
    const row: HistoryChartRow = {
      date,
      dateLabel: new Date(`${date}T12:00:00`).toLocaleDateString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
    };

    for (const portfolio of portfolios) {
      if (!visibleIds.has(portfolio.id)) continue;
      const value = valueByDateAndId.get(`${date}|${portfolio.id}`);
      if (value !== undefined) row[portfolio.id] = Number(value.toFixed(2));
    }

    if (showSum) {
      let sum = 0;
      let hasAny = false;
      for (const portfolio of portfolios) {
        if (!visibleIds.has(portfolio.id)) continue;
        const value = valueByDateAndId.get(`${date}|${portfolio.id}`);
        if (value !== undefined) {
          sum += value;
          hasAny = true;
        }
      }
      if (hasAny) row[SUM_KEY] = Number(sum.toFixed(2));
    }

    return row;
  });
}

export function historySumKey(): string {
  return SUM_KEY;
}

export function countHistoryPoints(
  history: PortfolioHistoryStore,
  portfolioId: string,
): number {
  return history.points.filter((p) => p.portfolioId === portfolioId).length;
}

export type HistoryBackupPayload = {
  version: 1;
  type: "portfolio-history";
  exportedAt: string;
  portfolioNames: Record<string, string>;
  points: HistoryPoint[];
};

function normalizeHistoryPoint(raw: Partial<HistoryPoint>): HistoryPoint | null {
  if (
    typeof raw?.date !== "string" ||
    typeof raw?.portfolioId !== "string" ||
    !Number.isFinite(Number(raw?.totalValuePln))
  ) {
    return null;
  }
  const date = String(raw.date).slice(0, 10);
  const totalValuePln = Number(raw.totalValuePln);
  if (totalValuePln <= 0) return null;
  return {
    date,
    portfolioId: String(raw.portfolioId),
    totalValuePln,
    recordedAt: String(raw.recordedAt ?? `${date}T12:00:00.000Z`),
  };
}

export function createHistoryBackup(
  history: PortfolioHistoryStore,
  portfolios: Array<{ id: string; name: string }>,
): HistoryBackupPayload {
  const portfolioNames: Record<string, string> = {};
  for (const portfolio of portfolios) {
    portfolioNames[portfolio.id] = portfolio.name;
  }
  for (const point of history.points) {
    if (!portfolioNames[point.portfolioId]) {
      portfolioNames[point.portfolioId] = point.portfolioId;
    }
  }
  return {
    version: 1,
    type: "portfolio-history",
    exportedAt: new Date().toISOString(),
    portfolioNames,
    points: [...history.points].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function parseHistoryBackup(text: string): HistoryBackupPayload {
  const parsed = JSON.parse(text) as Partial<HistoryBackupPayload>;
  if (parsed?.type !== "portfolio-history" || parsed?.version !== 1) {
    throw new Error("Nieobsługiwany format backupu historii.");
  }
  if (!Array.isArray(parsed.points)) {
    throw new Error("Backup historii nie zawiera listy `points`.");
  }
  const points = parsed.points
    .map((p) => normalizeHistoryPoint(p as Partial<HistoryPoint>))
    .filter((p): p is HistoryPoint => p !== null);
  if (points.length === 0) {
    throw new Error("Backup historii nie zawiera poprawnych punktów.");
  }
  const portfolioNames =
    parsed.portfolioNames && typeof parsed.portfolioNames === "object"
      ? Object.fromEntries(
          Object.entries(parsed.portfolioNames).map(([id, name]) => [
            String(id),
            String(name).trim() || String(id),
          ]),
        )
      : {};
  return {
    version: 1,
    type: "portfolio-history",
    exportedAt: String(parsed.exportedAt ?? new Date().toISOString()),
    portfolioNames,
    points,
  };
}

function normalizePortfolioName(name: string): string {
  return name.trim().toLocaleLowerCase("pl-PL");
}

export function buildPortfolioIdRemap(
  backupNames: Record<string, string>,
  currentPortfolios: Array<{ id: string; name: string }>,
): Map<string, string> {
  const nameToCurrentId = new Map<string, string>();
  for (const portfolio of currentPortfolios) {
    const key = normalizePortfolioName(portfolio.name);
    if (!nameToCurrentId.has(key)) nameToCurrentId.set(key, portfolio.id);
  }

  const remap = new Map<string, string>();
  for (const [oldId, rawName] of Object.entries(backupNames)) {
    const currentId = nameToCurrentId.get(normalizePortfolioName(rawName));
    if (currentId) remap.set(oldId, currentId);
  }
  for (const portfolio of currentPortfolios) {
    remap.set(portfolio.id, portfolio.id);
  }
  return remap;
}

export function remapHistoryPoints(
  points: HistoryPoint[],
  idRemap: Map<string, string>,
): HistoryPoint[] {
  return points
    .map((point) => {
      const newId = idRemap.get(point.portfolioId) ?? point.portfolioId;
      return { ...point, portfolioId: newId };
    })
    .filter((point) => point.portfolioId.length > 0);
}

function historyPointKey(point: HistoryPoint): string {
  return `${point.portfolioId}|${point.date}`;
}

export function mergeHistoryStores(
  base: PortfolioHistoryStore,
  incoming: HistoryPoint[],
): PortfolioHistoryStore {
  const merged = new Map<string, HistoryPoint>();
  for (const point of base.points) {
    merged.set(historyPointKey(point), point);
  }
  for (const point of incoming) {
    const key = historyPointKey(point);
    const existing = merged.get(key);
    if (!existing || point.recordedAt >= existing.recordedAt) {
      merged.set(key, point);
    }
  }
  return {
    version: 1,
    points: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function replaceHistoryStore(points: HistoryPoint[]): PortfolioHistoryStore {
  const unique = new Map<string, HistoryPoint>();
  for (const point of points) {
    const key = historyPointKey(point);
    const existing = unique.get(key);
    if (!existing || point.recordedAt >= existing.recordedAt) {
      unique.set(key, point);
    }
  }
  return {
    version: 1,
    points: [...unique.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
