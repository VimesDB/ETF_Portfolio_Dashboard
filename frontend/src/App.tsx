import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";
import { HistoryTab } from "./HistoryTab";
import {
  hasHistoryPointForToday,
  loadHistoryStore,
  recordHistoryPoint,
  removeHistoryForPortfolio,
  saveHistoryStore,
  type PortfolioHistoryStore,
} from "./portfolioHistory";

type Holding = {
  symbol: string;
  group: string;
  brokerUnits: Record<string, number>;
};

type Position = {
  symbol: string;
  units: number;
  name: string;
  price: number;
  currency: string;
  fxRateToPln: number;
  valuePln: number;
};

type GroupedRow = {
  name: string;
  valuePln: number;
  targetPercent: number;
  currentPercent: number;
  diffPercent: number;
  symbols: string[];
};

const defaultHoldings: Holding[] = [
  { symbol: "VHVE.L", group: "MSCI WORLD", brokerUnits: { "Broker 1": 12 } },
  { symbol: "AVGS.L", group: "GLOBAL AGGREGATE BONDS", brokerUnits: { "Broker 1": 18 } },
  { symbol: "EUNL.DE", group: "MSCI WORLD", brokerUnits: { "Broker 1": 6 } },
];

const defaultGroupTargets: Record<string, number> = {
  "MSCI WORLD": 70,
  "GLOBAL AGGREGATE BONDS": 30,
};

const STORAGE_V2 = "portfolio-store-v2";

type PortfolioSlot = {
  id: string;
  name: string;
  holdings: Holding[];
  groupTargets: Record<string, number>;
  brokers: string[];
};

type PortfolioStore = {
  version: 2;
  activeId: string;
  portfolios: PortfolioSlot[];
};

function newPortfolioId(): string {
  return crypto.randomUUID();
}

function normalizeHolding(item: Partial<Holding>, fallbackBroker: string): Holding {
  const rawBrokerUnits =
    item.brokerUnits && typeof item.brokerUnits === "object"
      ? (item.brokerUnits as Record<string, number>)
      : undefined;
  const normalizedBrokerUnits: Record<string, number> = {};
  if (rawBrokerUnits) {
    for (const [broker, units] of Object.entries(rawBrokerUnits)) {
      const key = String(broker).trim() || fallbackBroker;
      normalizedBrokerUnits[key] = Number(units ?? 0);
    }
  } else {
    const legacyUnits = Number((item as Partial<{ units: number }>).units ?? 0);
    normalizedBrokerUnits[fallbackBroker] = Number.isFinite(legacyUnits) ? legacyUnits : 0;
  }

  return {
    symbol: String(item.symbol ?? "").toUpperCase(),
    group: String(item.group ?? item.symbol ?? "").toUpperCase(),
    brokerUnits: normalizedBrokerUnits,
  };
}

function getHoldingUnits(holding: Holding): number {
  return Object.values(holding.brokerUnits).reduce((sum, value) => sum + Number(value || 0), 0);
}

function getValidHoldings(source: Holding[]): Holding[] {
  return source.filter(
    (holding) => holding.symbol.trim().length > 0 && getHoldingUnits(holding) > 0,
  );
}

function normalizeGroupTargets(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[String(key).toUpperCase()] = Number(value);
  }
  return out;
}

function loadPortfolioStore(): PortfolioStore {
  const v2 = localStorage.getItem(STORAGE_V2);
  if (v2) {
    try {
      const parsed = JSON.parse(v2) as Partial<PortfolioStore>;
      if (parsed?.version === 2 && Array.isArray(parsed.portfolios) && parsed.portfolios.length > 0) {
        const portfolios: PortfolioSlot[] = parsed.portfolios.map((p) => ({
          // Fallback broker lets us migrate older holdings with single `units`.
          // If the portfolio already has broker list, keep first one.
          ...(() => {
            const firstFallbackBroker =
              Array.isArray((p as Partial<PortfolioSlot>).brokers) &&
              (p as Partial<PortfolioSlot>).brokers!.length > 0
                ? String((p as Partial<PortfolioSlot>).brokers![0])
                : "Broker 1";
            const brokersSet = new Set<string>();
            const normalizedHoldings = Array.isArray(p.holdings)
              ? p.holdings.map((h) => normalizeHolding(h as Partial<Holding>, firstFallbackBroker))
              : [...defaultHoldings];
            for (const holding of normalizedHoldings) {
              for (const broker of Object.keys(holding.brokerUnits)) {
                brokersSet.add(broker);
              }
            }
            if (brokersSet.size === 0) brokersSet.add(firstFallbackBroker);
            return {
              id: String(p.id ?? newPortfolioId()),
              name: String(p.name ?? "Portfolio").trim() || "Portfolio",
              holdings: normalizedHoldings,
              groupTargets: normalizeGroupTargets(
                (p.groupTargets ?? defaultGroupTargets) as Record<string, number>,
              ),
              brokers: [...brokersSet],
            } satisfies PortfolioSlot;
          })(),
        }));
        let activeId = String(parsed.activeId ?? portfolios[0].id);
        if (!portfolios.some((p) => p.id === activeId)) activeId = portfolios[0].id;
        return { version: 2, activeId, portfolios };
      }
    } catch {
      /* migrate */
    }
  }

  let holdings = [...defaultHoldings];
  let groupTargets = { ...defaultGroupTargets };
  let brokers = ["Broker 1"];
  const legacyH = localStorage.getItem("portfolio-holdings-v1");
  const legacyG = localStorage.getItem("portfolio-group-targets-v1");
  if (legacyH) {
    try {
      const parsed = JSON.parse(legacyH) as Array<Partial<Holding>>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        holdings = parsed.map((item) => normalizeHolding(item, "Broker 1"));
      }
    } catch {
      /* keep default */
    }
  }
  if (legacyG) {
    try {
      const parsed = JSON.parse(legacyG) as Record<string, number>;
      groupTargets = normalizeGroupTargets(parsed);
    } catch {
      /* keep */
    }
  }

  const id = newPortfolioId();
  const brokersSet = new Set<string>();
  for (const holding of holdings) {
    for (const broker of Object.keys(holding.brokerUnits)) {
      brokersSet.add(broker);
    }
  }
  if (brokersSet.size > 0) brokers = [...brokersSet];

  return {
    version: 2,
    activeId: id,
    portfolios: [{ id, name: "Domyślne", holdings, groupTargets, brokers }],
  };
}

const COLORS = ["#3b82f6", "#14b8a6", "#a855f7", "#f97316", "#eab308"];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 2,
  }).format(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

type AppView = "portfolio" | "history";

type PortfolioApiResponse = {
  updatedAt: string;
  positions: Position[];
  warnings?: string[];
};

async function fetchPortfolioValuation(holdings: Holding[]): Promise<PortfolioApiResponse> {
  const validHoldings = getValidHoldings(holdings);
  if (validHoldings.length === 0) {
    throw new Error("Brak pozycji do wyceny");
  }
  const holdingsQuery = validHoldings
    .map((holding) => `${holding.symbol}:${getHoldingUnits(holding)}`)
    .join(",");
  const response = await fetch(`/api/portfolio?holdings=${encodeURIComponent(holdingsQuery)}`);
  if (!response.ok) throw new Error(`Błąd API: ${response.status}`);
  return (await response.json()) as PortfolioApiResponse;
}

function App() {
  const [store, setStore] = useState<PortfolioStore>(loadPortfolioStore);
  const [history, setHistory] = useState<PortfolioHistoryStore>(loadHistoryStore);
  const [appView, setAppView] = useState<AppView>("portfolio");

  const activePortfolio = useMemo(
    () => store.portfolios.find((p) => p.id === store.activeId) ?? store.portfolios[0],
    [store],
  );

  const holdings = activePortfolio.holdings;
  const groupTargets = activePortfolio.groupTargets;
  const brokers = activePortfolio.brokers;

  const setHoldings = (
    updater: Holding[] | ((prev: Holding[]) => Holding[]),
  ) => {
    setStore((s) => {
      const p = s.portfolios.find((x) => x.id === s.activeId);
      if (!p) return s;
      const nextHoldings = typeof updater === "function" ? updater(p.holdings) : updater;
      return {
        ...s,
        portfolios: s.portfolios.map((x) =>
          x.id === s.activeId ? { ...x, holdings: nextHoldings } : x,
        ),
      };
    });
  };

  const setGroupTargets = (
    updater:
      | Record<string, number>
      | ((prev: Record<string, number>) => Record<string, number>),
  ) => {
    setStore((s) => {
      const p = s.portfolios.find((x) => x.id === s.activeId);
      if (!p) return s;
      const next =
        typeof updater === "function" ? updater(p.groupTargets) : updater;
      return {
        ...s,
        portfolios: s.portfolios.map((x) =>
          x.id === s.activeId ? { ...x, groupTargets: next } : x,
        ),
      };
    });
  };

  const setBrokers = (
    updater: string[] | ((prev: string[]) => string[]),
  ) => {
    setStore((s) => {
      const p = s.portfolios.find((x) => x.id === s.activeId);
      if (!p) return s;
      const next = typeof updater === "function" ? updater(p.brokers) : updater;
      return {
        ...s,
        portfolios: s.portfolios.map((x) =>
          x.id === s.activeId ? { ...x, brokers: next } : x,
        ),
      };
    });
  };

  const [positions, setPositions] = useState<Position[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [portfolioNotice, setPortfolioNotice] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [budgetInput, setBudgetInput] = useState<string>("1000");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [backupStatus, setBackupStatus] = useState<string>("");
  const [autoSnapshotStatus, setAutoSnapshotStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadRequestId = useRef(0);
  const autoSnapshotStarted = useRef(false);

  const loadPortfolio = async (holdingsOverride?: Holding[], portfolioIdOverride?: string) => {
    const source = holdingsOverride ?? holdings;
    const targetPortfolioId = portfolioIdOverride ?? store.activeId;
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError("");
    setPortfolioNotice("");
    try {
      const validHoldings = getValidHoldings(source);
      if (validHoldings.length === 0) {
        if (requestId !== loadRequestId.current) return;
        setPositions([]);
        setUpdatedAt("");
        setWarnings([]);
        setPortfolioNotice(
          "To konto nie ma jeszcze zapisanych pozycji. Użyj „Import z JSON” (osobny plik na każde konto) lub uzupełnij tabelę ETF poniżej.",
        );
        return;
      }

      const data = await fetchPortfolioValuation(source);
      if (requestId !== loadRequestId.current) return;
      setUpdatedAt(data.updatedAt);
      setPositions(data.positions);
      setWarnings(data.warnings ?? []);
      const snapshotTotal = data.positions.reduce((sum, p) => sum + p.valuePln, 0);
      setHistory((prev) => recordHistoryPoint(prev, targetPortfolioId, snapshotTotal));
    } catch (err) {
      if (requestId !== loadRequestId.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    const portfolio = store.portfolios.find((p) => p.id === store.activeId);
    if (!portfolio) return;
    void loadPortfolio(portfolio.holdings, portfolio.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.activeId]);

  useEffect(() => {
    if (autoSnapshotStarted.current) return;
    autoSnapshotStarted.current = true;

    void (async () => {
      const initialStore = loadPortfolioStore();
      const initialHistory = loadHistoryStore();
      const pending = initialStore.portfolios.filter((portfolio) => {
        if (portfolio.id === initialStore.activeId) return false;
        if (getValidHoldings(portfolio.holdings).length === 0) return false;
        return !hasHistoryPointForToday(initialHistory, portfolio.id);
      });
      if (pending.length === 0) return;

      const updatedNames: string[] = [];
      for (const portfolio of pending) {
        try {
          const data = await fetchPortfolioValuation(portfolio.holdings);
          const snapshotTotal = data.positions.reduce((sum, p) => sum + p.valuePln, 0);
          setHistory((prev) => recordHistoryPoint(prev, portfolio.id, snapshotTotal));
          updatedNames.push(portfolio.name);
        } catch {
          /* pomijamy konto przy błędzie API */
        }
      }

      if (updatedNames.length > 0) {
        const label =
          updatedNames.length <= 3
            ? updatedNames.join(", ")
            : `${updatedNames.length} kont`;
        setAutoSnapshotStatus(`Automatyczny snapshot historii: ${label}.`);
      }
    })();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_V2, JSON.stringify(store));
  }, [store]);

  useEffect(() => {
    saveHistoryStore(history);
  }, [history]);

  const holdingMetaBySymbol = useMemo(() => {
    const map = new Map<string, { group: string }>();
    for (const holding of holdings) {
      map.set(holding.symbol, {
        group: holding.group.trim() || holding.symbol,
      });
    }
    return map;
  }, [holdings]);

  const groupedRows = useMemo(() => {
    const map = new Map<string, { valuePln: number; targetPercent: number; symbols: Set<string> }>();
    for (const position of positions) {
      const meta = holdingMetaBySymbol.get(position.symbol);
      const groupName = (meta?.group || position.symbol).toUpperCase();
      const existing = map.get(groupName) ?? {
        valuePln: 0,
        targetPercent: 0,
        symbols: new Set<string>(),
      };
      existing.valuePln += position.valuePln;
      existing.symbols.add(position.symbol);
      map.set(groupName, existing);
    }

    for (const holding of holdings) {
      const groupName = (holding.group.trim() || holding.symbol).toUpperCase();
      const existing = map.get(groupName) ?? { valuePln: 0, targetPercent: 0, symbols: new Set<string>() };
      existing.targetPercent = Number(groupTargets[groupName] ?? 0);
      existing.symbols.add(holding.symbol);
      map.set(groupName, existing);
    }

    const totalValue = [...map.values()].reduce((sum, row) => sum + row.valuePln, 0);
    return [...map.entries()].map(([name, row]) => {
      const currentPercent = totalValue > 0 ? (row.valuePln / totalValue) * 100 : 0;
      return {
        name,
        valuePln: row.valuePln,
        targetPercent: row.targetPercent,
        currentPercent,
        diffPercent: currentPercent - row.targetPercent,
        symbols: [...row.symbols],
      } as GroupedRow;
    });
  }, [groupTargets, holdings, holdingMetaBySymbol, positions]);

  const positionsByGroup = useMemo(() => {
    const grouped: Record<string, Position[]> = {};
    for (const position of positions) {
      const meta = holdingMetaBySymbol.get(position.symbol);
      const groupName = (meta?.group || position.symbol).toUpperCase();
      if (!grouped[groupName]) grouped[groupName] = [];
      grouped[groupName].push(position);
    }
    return grouped;
  }, [holdingMetaBySymbol, positions]);

  const totalValue = useMemo(
    () => groupedRows.reduce((sum, row) => sum + row.valuePln, 0),
    [groupedRows],
  );

  const pieData = useMemo(
    () =>
      groupedRows.map((row) => ({
        name: row.name,
        value: Number(row.valuePln.toFixed(2)),
      })),
    [groupedRows],
  );

  const allocationData = useMemo(
    () =>
      groupedRows.map((row) => ({
        name: row.name,
        aktualnie: Number(row.currentPercent.toFixed(2)),
        cel: Number(row.targetPercent.toFixed(2)),
      })),
    [groupedRows],
  );

  const diffPlnByGroup = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of groupedRows) {
      const targetValuePln = (row.targetPercent / 100) * totalValue;
      out[row.name] = row.valuePln - targetValuePln;
    }
    return out;
  }, [groupedRows, totalValue]);

  const extremeDiffs = useMemo(() => {
    let maxPositiveName: string | null = null;
    let maxPositiveValue = 0;
    let minNegativeName: string | null = null;
    let minNegativeValue = 0;

    for (const [name, diff] of Object.entries(diffPlnByGroup)) {
      if (diff > maxPositiveValue) {
        maxPositiveValue = diff;
        maxPositiveName = name;
      }
      if (diff < minNegativeValue) {
        minNegativeValue = diff;
        minNegativeName = name;
      }
    }

    return { maxPositiveName, minNegativeName };
  }, [diffPlnByGroup]);

  const interactiveRebalance = useMemo(() => {
    const parsedBudget = Number(budgetInput.replace(",", "."));
    const budget = Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : 0;
    if (!groupedRows.length || totalValue <= 0 || budget <= 0) {
      return { budget, items: [] as Array<{ symbol: string; amountPln: number }> };
    }

    const itemsBySymbol = new Map<string, number>();
    let remainingBudget = budget;

    const deficitItems = groupedRows
      .map((item) => {
        const targetValue = (item.targetPercent / 100) * totalValue;
        const deficit = Math.max(0, targetValue - item.valuePln);
        return { symbol: item.name, deficit };
      })
      .filter((item) => item.deficit > 0)
      .sort((a, b) => b.deficit - a.deficit);

    for (const item of deficitItems) {
      if (remainingBudget <= 0) break;
      const amountPln = Math.min(item.deficit, remainingBudget);
      if (amountPln > 0.01) {
        itemsBySymbol.set(item.symbol, amountPln);
      }
      remainingBudget -= amountPln;
    }

    if (remainingBudget > 0) {
      const totalTargetWeight = groupedRows.reduce((sum, item) => sum + item.targetPercent, 0);
      if (totalTargetWeight > 0) {
        const fallbackItems = groupedRows
          .map((item) => ({
            symbol: item.name,
            amountPln: (item.targetPercent / totalTargetWeight) * remainingBudget,
          }))
          .filter((item) => item.amountPln > 0.01)
          .sort((a, b) => b.amountPln - a.amountPln);

        for (const item of fallbackItems) {
          const previous = itemsBySymbol.get(item.symbol) ?? 0;
          itemsBySymbol.set(item.symbol, previous + item.amountPln);
        }
      }
    }

    const items = [...itemsBySymbol.entries()]
      .map(([symbol, amountPln]) => ({ symbol, amountPln }))
      .sort((a, b) => b.amountPln - a.amountPln);

    return { budget, items };
  }, [budgetInput, groupedRows, totalValue]);

  const fullRebalance = useMemo(() => {
    if (!groupedRows.length || totalValue <= 0) {
      return {
        buys: [] as Array<{ symbol: string; amountPln: number }>,
        sells: [] as Array<{ symbol: string; amountPln: number }>,
      };
    }

    const buys = groupedRows
      .map((item) => {
        const targetValue = (item.targetPercent / 100) * totalValue;
        const gap = Math.max(0, targetValue - item.valuePln);
        return gap > 0 ? { symbol: item.name, amountPln: gap } : null;
      })
      .filter((item): item is { symbol: string; amountPln: number } => item !== null)
      .sort((a, b) => b.amountPln - a.amountPln);

    const sells = groupedRows
      .map((item) => {
        const targetValue = (item.targetPercent / 100) * totalValue;
        const gap = Math.max(0, item.valuePln - targetValue);
        return gap > 0 ? { symbol: item.name, amountPln: gap } : null;
      })
      .filter((item): item is { symbol: string; amountPln: number } => item !== null)
      .sort((a, b) => b.amountPln - a.amountPln);

    return { buys, sells };
  }, [groupedRows, totalValue]);

  const totalTarget = useMemo(
    () =>
      Object.values(groupTargets).reduce(
        (sum, value) => sum + (Number.isFinite(value) ? value : 0),
        0,
      ),
    [groupTargets],
  );

  const updateHoldingMeta = (
    index: number,
    field: "symbol" | "group",
    rawValue: string,
  ) => {
    setHoldings((prev) =>
      prev.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return { ...item, [field]: rawValue.toUpperCase() };
      }),
    );
  };

  const updateHoldingBrokerUnits = (
    index: number,
    broker: string,
    rawValue: string,
  ) => {
    const numeric = Number(rawValue);
    setHoldings((prev) =>
      prev.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return {
          ...item,
          brokerUnits: {
            ...item.brokerUnits,
            [broker]: Number.isFinite(numeric) ? numeric : 0,
          },
        };
      }),
    );
  };

  const addBroker = () => {
    const existingSet = new Set(brokers);
    let idx = 1;
    let name = `Broker ${idx}`;
    while (existingSet.has(name)) {
      idx += 1;
      name = `Broker ${idx}`;
    }
    setBrokers((prev) => [...prev, name]);
    setHoldings((prev) =>
      prev.map((holding) => ({
        ...holding,
        brokerUnits: { ...holding.brokerUnits, [name]: 0 },
      })),
    );
  };

  const renameBrokerAtIndex = (brokerIndex: number, rawValue: string) => {
    const oldName = brokers[brokerIndex];
    if (!oldName) return;
    const newName = rawValue.trim() || oldName;
    if (newName === oldName) return;
    setBrokers((prev) =>
      prev.map((broker, index) => (index === brokerIndex ? newName : broker)),
    );
    setHoldings((prev) =>
      prev.map((holding) => {
        const current = holding.brokerUnits[oldName] ?? 0;
        const nextUnits = { ...holding.brokerUnits };
        delete nextUnits[oldName];
        nextUnits[newName] = (nextUnits[newName] ?? 0) + current;
        return {
          ...holding,
          brokerUnits: nextUnits,
        };
      }),
    );
  };

  const removeBrokerAtIndex = (brokerIndex: number) => {
    const brokerName = brokers[brokerIndex];
    if (!brokerName) return;
    if (brokers.length <= 1) return;
    setBrokers((prev) => prev.filter((_, index) => index !== brokerIndex));
    setHoldings((prev) =>
      prev.map((holding) => {
        const nextUnits = { ...holding.brokerUnits };
        delete nextUnits[brokerName];
        return {
          ...holding,
          brokerUnits: nextUnits,
        };
      }),
    );
  };

  const addHolding = () => {
    const emptyBrokerUnits: Record<string, number> = {};
    for (const broker of brokers) emptyBrokerUnits[broker] = 0;
    setHoldings((prev) => [...prev, { symbol: "", group: "", brokerUnits: emptyBrokerUnits }]);
  };
  const removeHolding = (index: number) => {
    setHoldings((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const moveHolding = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    setHoldings((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const uniqueGroups = useMemo(
    () =>
      [...new Set(holdings.map((item) => (item.group.trim() || item.symbol).toUpperCase()))].filter(
        (group) => group.length > 0,
      ),
    [holdings],
  );

  useEffect(() => {
    setGroupTargets((prev) => {
      const next: Record<string, number> = {};
      for (const group of uniqueGroups) {
        next[group] = Number.isFinite(prev[group]) ? prev[group] : 0;
      }
      return next;
    });
  }, [uniqueGroups]);

  const updateGroupTarget = (group: string, rawValue: string) => {
    const numeric = Number(rawValue);
    setGroupTargets((prev) => ({
      ...prev,
      [group]: Number.isFinite(numeric) ? numeric : 0,
    }));
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const switchPortfolio = (id: string) => {
    if (id === store.activeId) return;
    loadRequestId.current += 1;
    setPositions([]);
    setUpdatedAt("");
    setWarnings([]);
    setError("");
    setPortfolioNotice("");
    setLoading(true);
    setStore((s) => ({ ...s, activeId: id }));
    setExpandedGroups({});
    setBudgetInput("1000");
  };

  const addPortfolio = () => {
    const id = newPortfolioId();
    setStore((s) => ({
      ...s,
      activeId: id,
      portfolios: [
        ...s.portfolios,
        {
          id,
          name: `Portfolio ${s.portfolios.length + 1}`,
          holdings: [{ symbol: "", group: "", brokerUnits: { "Broker 1": 0 } }],
          groupTargets: {},
          brokers: ["Broker 1"],
        },
      ],
    }));
    setExpandedGroups({});
    setBudgetInput("1000");
  };

  const removeActivePortfolio = () => {
    const removedId = store.activeId;
    setStore((s) => {
      if (s.portfolios.length <= 1) return s;
      const idx = s.portfolios.findIndex((p) => p.id === s.activeId);
      const next = s.portfolios.filter((p) => p.id !== s.activeId);
      const newActive = next[Math.max(0, idx - 1)]?.id ?? next[0].id;
      return { ...s, activeId: newActive, portfolios: next };
    });
    setHistory((prev) => removeHistoryForPortfolio(prev, removedId));
    setExpandedGroups({});
    setBudgetInput("1000");
  };

  const renameActivePortfolio = (name: string) => {
    setStore((s) => ({
      ...s,
      portfolios: s.portfolios.map((p) =>
        p.id === s.activeId ? { ...p, name: name.trim() || p.name } : p,
      ),
    }));
  };

  type BackupPayload = {
    version: 1 | 2;
    portfolioName?: string;
    exportedAt: string;
    brokers?: string[];
    holdings: Array<{
      symbol: string;
      group: string;
      units?: number;
      brokerUnits?: Record<string, number>;
    }>;
    groupTargets: Record<string, number>;
  };

  const exportBackup = () => {
    setBackupStatus("");
    try {
      const payload: BackupPayload = {
        version: 2,
        portfolioName: activePortfolio.name,
        exportedAt: new Date().toISOString(),
        brokers,
        holdings: holdings.map((h) => ({
          symbol: h.symbol.toUpperCase(),
          group: h.group.toUpperCase(),
          brokerUnits: h.brokerUnits,
        })),
        groupTargets,
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const date = new Date().toISOString().slice(0, 10);
      const slug =
        activePortfolio.name.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) ||
        "portfolio";
      const a = document.createElement("a");
      a.href = url;
      a.download = `portfolio-${slug}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
      setBackupStatus("Backup wyeksportowany do pliku JSON.");
    } catch (err) {
      setBackupStatus(
        err instanceof Error ? `Błąd eksportu: ${err.message}` : "Błąd eksportu",
      );
    }
  };

  const importBackup = async (file: File) => {
    setBackupStatus("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<BackupPayload>;

      if (parsed?.version !== 1 && parsed?.version !== 2) {
        throw new Error("Nieobsługiwany format backupu.");
      }
      if (!Array.isArray(parsed.holdings) || parsed.holdings.length === 0) {
        throw new Error("Backup nie zawiera poprawnej listy `holdings`.");
      }
      if (!parsed.groupTargets || typeof parsed.groupTargets !== "object") {
        throw new Error("Backup nie zawiera poprawnej mapy `groupTargets`.");
      }

      const importedBrokers =
        Array.isArray(parsed.brokers) && parsed.brokers.length > 0
          ? parsed.brokers.map((broker) => String(broker).trim()).filter(Boolean)
          : ["Broker 1"];
      const fallbackBroker = importedBrokers[0] ?? "Broker 1";

      const nextHoldings: Holding[] = parsed.holdings.map((item) =>
        normalizeHolding(item as Partial<Holding>, fallbackBroker),
      );

      const mergedBrokerSet = new Set(importedBrokers);
      for (const holding of nextHoldings) {
        for (const broker of Object.keys(holding.brokerUnits)) {
          mergedBrokerSet.add(broker);
        }
      }
      const nextBrokers = [...mergedBrokerSet];

      const nextGroupTargets: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed.groupTargets)) {
        nextGroupTargets[String(key).toUpperCase()] = Number(value);
      }

      const valid = getValidHoldings(nextHoldings);
      if (valid.length === 0) {
        throw new Error("Backup zawiera puste/niepoprawne pozycje (units>0).");
      }

      const importedName =
        typeof parsed.portfolioName === "string" && parsed.portfolioName.trim().length > 0
          ? parsed.portfolioName.trim()
          : undefined;

      setStore((s) => ({
        ...s,
        portfolios: s.portfolios.map((p) =>
          p.id === s.activeId
            ? {
                ...p,
                holdings: nextHoldings,
                groupTargets: nextGroupTargets,
                brokers: nextBrokers,
                ...(importedName ? { name: importedName } : {}),
              }
            : p,
        ),
      }));
      setExpandedGroups({});
      setBudgetInput("1000");
      await loadPortfolio(nextHoldings, store.activeId);
      setBackupStatus("Backup zaimportowany.");
    } catch (err) {
      setBackupStatus(
        err instanceof Error ? `Błąd importu: ${err.message}` : "Błąd importu",
      );
    }
  };

  return (
    <main className="container">
      <header className="header">
        <h1>Portfolio ETF</h1>
        <p>
          {appView === "portfolio" ? (
            <>
              <strong>{activePortfolio.name}</strong> — aktualna wycena i podział portfela w PLN
            </>
          ) : (
            <>Historia wartości wszystkich kont (PLN)</>
          )}
        </p>
        <nav className="app-tabs" aria-label="Widoki aplikacji">
          <button
            type="button"
            className={appView === "portfolio" ? "app-tab active" : "app-tab"}
            onClick={() => setAppView("portfolio")}
          >
            Portfel
          </button>
          <button
            type="button"
            className={appView === "history" ? "app-tab active" : "app-tab"}
            onClick={() => setAppView("history")}
          >
            Historia
          </button>
        </nav>
        {autoSnapshotStatus && (
          <p className="status info auto-snapshot-status">{autoSnapshotStatus}</p>
        )}
      </header>

      {appView === "history" && (
        <HistoryTab
          portfolios={store.portfolios.map((p) => ({ id: p.id, name: p.name }))}
          history={history}
          formatCurrency={formatCurrency}
          onHistoryChange={setHistory}
        />
      )}

      {appView === "portfolio" && (
      <>
      <section className="card">
        <h2>Konfiguracja ETF</h2>
        <div className="portfolio-bar">
          <label htmlFor="portfolio-select">Aktywne konto</label>
          <select
            id="portfolio-select"
            value={store.activeId}
            onChange={(event) => switchPortfolio(event.target.value)}
          >
            {store.portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="portfolio-name-label">Nazwa</span>
          <input
            type="text"
            className="portfolio-name-input"
            value={activePortfolio.name}
            onChange={(event) => renameActivePortfolio(event.target.value)}
            placeholder="np. IKE, konto opodatkowane"
            aria-label="Nazwa aktywnego portfolio"
          />
          <button type="button" onClick={addPortfolio}>
            + Nowe portfolio
          </button>
          <button
            type="button"
            onClick={removeActivePortfolio}
            disabled={store.portfolios.length <= 1}
          >
            Usuń to portfolio
          </button>
        </div>
        <p className="muted portfolio-hint">
          Możesz mieć kilka niezależnych zestawów (np. opodatkowane vs emerytalne). Każde konto ma
          własny zapis w przeglądarce — po utworzeniu nowego konta zaimportuj dla niego osobny plik
          JSON.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>ETF (ticker)</th>
                <th>Pozycja agregowana</th>
                {brokers.map((broker, brokerIndex) => (
                  <th key={brokerIndex}>
                    <div className="broker-header">
                      <input
                        type="text"
                        value={broker}
                        onChange={(event) =>
                          renameBrokerAtIndex(brokerIndex, event.target.value)
                        }
                        aria-label={`Nazwa brokera ${broker}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeBrokerAtIndex(brokerIndex)}
                        disabled={brokers.length <= 1}
                        className="broker-remove"
                      >
                        x
                      </button>
                    </div>
                  </th>
                ))}
                <th>Suma jednostek</th>
                <th>Akcja</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding, index) => (
                <tr
                  key={index}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = Number(event.dataTransfer.getData("text/plain"));
                    if (Number.isFinite(from)) moveHolding(from, index);
                  }}
                >
                  <td
                    className="drag-handle"
                    draggable
                    title="Przeciągnij, aby zmienić kolejność"
                    aria-label="Przeciągnij wiersz"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(index));
                    }}
                  >
                    ≡
                  </td>
                  <td>
                    <input
                      type="text"
                      value={holding.symbol}
                      onChange={(event) =>
                        updateHoldingMeta(index, "symbol", event.target.value)
                      }
                      placeholder="np. VWCE.DE"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={holding.group}
                      onChange={(event) =>
                        updateHoldingMeta(index, "group", event.target.value)
                      }
                      placeholder="np. MSCI WORLD"
                    />
                  </td>
                  {brokers.map((broker) => (
                    <td key={`${index}-${broker}`}>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={holding.brokerUnits[broker] ?? 0}
                        onChange={(event) =>
                          updateHoldingBrokerUnits(index, broker, event.target.value)
                        }
                      />
                    </td>
                  ))}
                  <td>{getHoldingUnits(holding).toFixed(2)}</td>
                  <td>
                    <button type="button" onClick={() => removeHolding(index)}>
                      Usuń
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Wagi grup (ustalane raz na grupę)</h3>
        <div className="table-wrap">
          <table className="group-weights-table">
            <thead>
              <tr>
                <th>Grupa</th>
                <th>Waga docelowa (%)</th>
              </tr>
            </thead>
            <tbody>
              {uniqueGroups.map((group) => (
                <tr key={group}>
                  <td>{group}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={groupTargets[group] ?? 0}
                      onChange={(event) => updateGroupTarget(group, event.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="config-actions">
          <button type="button" onClick={addHolding}>+ Dodaj ETF</button>
          <button type="button" onClick={addBroker}>+ Dodaj brokera</button>
          <button type="button" className="primary-button" onClick={() => void loadPortfolio()}>
            Przelicz portfolio
          </button>
          <span className={Math.abs(totalTarget - 100) < 0.01 ? "ok" : "warn"}>
            Suma wag docelowych: {totalTarget.toFixed(2)}%
          </span>
        </div>

        <div className="backup-actions">
          <button type="button" onClick={exportBackup}>Eksport do JSON</button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Import z JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void importBackup(file);
              event.target.value = "";
            }}
          />
          {backupStatus && <span className="backup-status">{backupStatus}</span>}
        </div>
      </section>

      {loading && <p className="status">Ładowanie danych...</p>}
      {portfolioNotice && <p className="status info">{portfolioNotice}</p>}
      {error && <p className="status error">Nie udało się pobrać danych: {error}</p>}
      {!error &&
        !portfolioNotice &&
        warnings.map((warning) => (
          <p className="status warning" key={warning}>
            Uwaga: {warning}
          </p>
        ))}

      {!loading && !error && !portfolioNotice && (
        <>
          <section className="cards">
            <article className="card">
              <h2>Wartość portfela</h2>
              <p className="value">{formatCurrency(totalValue)}</p>
              <p className="muted">
                Ostatnia aktualizacja: {new Date(updatedAt).toLocaleString("pl-PL", { hour12: false })}
              </p>
            </article>
          </section>

          <section className="chart-grid">
            <article className="card chart-card">
              <h2>Podział portfela (pozycje agregowane)</h2>
              <ResponsiveContainer width="100%" height={360}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={125}
                    label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(1)}%`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`pie-${entry.name}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(asNumber(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </article>

            <article className="card chart-card">
              <h2>Aktualny udział vs docelowy udział</h2>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={allocationData}>
                  <XAxis dataKey="name" />
                  <YAxis unit="%" />
                  <Tooltip formatter={(value) => `${asNumber(value).toFixed(2)}%`} />
                  <Legend />
                  <Bar dataKey="aktualnie" fill="#3b82f6" />
                  <Bar dataKey="cel" fill="#14b8a6" />
                </BarChart>
              </ResponsiveContainer>
            </article>
          </section>

          <section className="card">
            <h2>Szczegóły pozycji (agregowane)</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>POZYCJA</th>
                    <th>ETF-y w grupie</th>
                    <th>Wartość PLN</th>
                    <th>AKTUALNE</th>
                    <th>CEL</th>
                    <th>RÓŻNICA %</th>
                    <th>RÓŻNICA PLN</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.map((row) => (
                    <Fragment key={row.name}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="toggle-btn"
                            onClick={() => toggleGroup(row.name)}
                            aria-label={`Rozwiń grupę ${row.name}`}
                          >
                            {expandedGroups[row.name] ? "▾" : "▸"}
                          </button>
                        </td>
                        <td>{row.name}</td>
                        <td>{row.symbols.join(", ")}</td>
                        <td>{formatCurrency(row.valuePln)}</td>
                        <td>{row.currentPercent.toFixed(2)}%</td>
                        <td>{row.targetPercent.toFixed(2)}%</td>
                        <td>{row.diffPercent >= 0 ? "+" : ""}{row.diffPercent.toFixed(2)}%</td>
                        <td
                          className={
                            row.name === extremeDiffs.maxPositiveName
                              ? "diff-pln positive"
                              : row.name === extremeDiffs.minNegativeName
                                ? "diff-pln negative"
                                : "diff-pln"
                          }
                        >
                          {`${(diffPlnByGroup[row.name] ?? 0) >= 0 ? "+" : ""}${formatCurrency(
                            diffPlnByGroup[row.name] ?? 0,
                          )}`}
                        </td>
                      </tr>
                      {expandedGroups[row.name] &&
                        (positionsByGroup[row.name] ?? []).map((position) => (
                          <tr key={`${row.name}-${position.symbol}`} className="sub-row">
                            <td></td>
                            <td>{position.symbol}</td>
                            <td>{position.name}</td>
                            <td>{formatCurrency(position.valuePln)}</td>
                            <td>
                              {totalValue > 0
                                ? `${((position.valuePln / totalValue) * 100).toFixed(2)}%`
                                : "0.00%"}
                            </td>
                            <td>-</td>
                            <td>
                              Cena: {position.price.toFixed(2)} {position.currency}, FX:{" "}
                              {position.fxRateToPln.toFixed(4)}
                            </td>
                            <td>-</td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Rebalancing zakupami</h2>
            <div className="rebalance-input-row">
              <label htmlFor="budget-input">Kwota do zainwestowania (PLN)</label>
              <input
                id="budget-input"
                type="number"
                min="0"
                step="100"
                value={budgetInput}
                onChange={(event) => setBudgetInput(event.target.value)}
              />
            </div>
            {interactiveRebalance.items.length === 0 ? (
              <p className="muted">Brak zakupów do wykonania dla obecnych danych.</p>
            ) : (
              <>
                <p>
                  Dla budżetu <strong>{formatCurrency(interactiveRebalance.budget)}</strong> kup:
                </p>
                <ul>
                  {interactiveRebalance.items.map((item) => (
                    <li key={item.symbol}>
                      {item.symbol}: <strong>{formatCurrency(item.amountPln)}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card">
            <h2>Pełny rebalancing (bez dopłat)</h2>
            {fullRebalance.buys.length === 0 && fullRebalance.sells.length === 0 ? (
              <p className="muted">Portfel jest już na docelowych wagach.</p>
            ) : (
              <>
                {fullRebalance.sells.length > 0 && (
                  <>
                    <p>Sprzedaj:</p>
                    <ul>
                      {fullRebalance.sells.map((item) => (
                        <li key={`sell-${item.symbol}`}>
                          {item.symbol}: <strong>{formatCurrency(item.amountPln)}</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {fullRebalance.buys.length > 0 && (
                  <>
                    <p>Kup:</p>
                    <ul>
                      {fullRebalance.buys.map((item) => (
                        <li key={`buy-${item.symbol}`}>
                          {item.symbol}: <strong>{formatCurrency(item.amountPln)}</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}
      </>
      )}
    </main>
  );
}

export default App;
