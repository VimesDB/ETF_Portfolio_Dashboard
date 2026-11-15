import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildHistoryChartData,
  buildPortfolioIdRemap,
  countHistoryPoints,
  createHistoryBackup,
  historySumKey,
  mergeHistoryStores,
  parseHistoryBackup,
  remapHistoryPoints,
  replaceHistoryStore,
  type PortfolioHistoryStore,
} from "./portfolioHistory";

const COLORS = ["#3b82f6", "#14b8a6", "#a855f7", "#f97316", "#eab308", "#ef4444"];

type PortfolioInfo = { id: string; name: string };

type HistoryTabProps = {
  portfolios: PortfolioInfo[];
  history: PortfolioHistoryStore;
  formatCurrency: (value: number) => string;
  onHistoryChange: (history: PortfolioHistoryStore) => void;
};

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function HistoryTab({
  portfolios,
  history,
  formatCurrency,
  onHistoryChange,
}: HistoryTabProps) {
  const [visibleIds, setVisibleIds] = useState<Set<string>>(
    () => new Set(portfolios.map((p) => p.id)),
  );
  const [showSum, setShowSum] = useState(true);
  const [historyBackupStatus, setHistoryBackupStatus] = useState("");
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const historyFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const portfolio of portfolios) {
        if (!next.has(portfolio.id)) {
          next.add(portfolio.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [portfolios]);

  const effectiveVisible = useMemo(() => {
    const next = new Set(visibleIds);
    for (const id of [...next]) {
      if (!portfolios.some((p) => p.id === id)) next.delete(id);
    }
    for (const p of portfolios) {
      if (next.size === 0) next.add(p.id);
    }
    return next;
  }, [visibleIds, portfolios]);

  const chartData = useMemo(
    () => buildHistoryChartData(history, portfolios, effectiveVisible, showSum),
    [history, portfolios, effectiveVisible, showSum],
  );

  const sumKey = historySumKey();
  const totalPoints = history.points.length;
  const hasChartData = chartData.length > 0;

  const exportHistoryBackup = () => {
    setHistoryBackupStatus("");
    try {
      if (history.points.length === 0) {
        throw new Error("Brak punktów historii do eksportu.");
      }
      const payload = createHistoryBackup(history, portfolios);
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url;
      a.download = `portfolio-historia-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setHistoryBackupStatus(`Wyeksportowano ${payload.points.length} punktów historii.`);
    } catch (err) {
      setHistoryBackupStatus(
        err instanceof Error ? `Błąd eksportu: ${err.message}` : "Błąd eksportu",
      );
    }
  };

  const importHistoryBackup = async (file: File) => {
    setHistoryBackupStatus("");
    try {
      const text = await file.text();
      const backup = parseHistoryBackup(text);
      const idRemap = buildPortfolioIdRemap(backup.portfolioNames, portfolios);
      const remapped = remapHistoryPoints(backup.points, idRemap);
      const matchedNames = [...idRemap.entries()].filter(
        ([oldId, newId]) => oldId !== newId && backup.portfolioNames[oldId],
      ).length;

      const next = replaceOnImport
        ? replaceHistoryStore(remapped)
        : mergeHistoryStores(history, remapped);

      onHistoryChange(next);
      const mode = replaceOnImport ? "zastąpiono" : "połączono";
      setHistoryBackupStatus(
        `Import OK: ${mode} ${remapped.length} pkt.` +
          (matchedNames > 0
            ? ` (${matchedNames} kont dopasowanych po nazwie).`
            : " (ID kont bez zmian)."),
      );
    } catch (err) {
      setHistoryBackupStatus(
        err instanceof Error ? `Błąd importu: ${err.message}` : "Błąd importu",
      );
    }
  };

  const togglePortfolio = (id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1 && !showSum) return next;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section className="card history-section">
      <h2>Historia wartości portfela</h2>
      <p className="muted history-intro">
        Wykres buduje się przy przeliczeniu portfela (maks. jeden punkt na dzień na konto). Przy
        starcie aplikacji brakujące dzienne snapshoty dla pozostałych kont zapisują się automatycznie
        (aktywne konto — przy ładowaniu widoku). Okresowo eksportuj historię do JSON.
      </p>

      <div className="history-controls">
        <fieldset className="history-fieldset">
          <legend>Konta na wykresie</legend>
          <div className="history-checkboxes">
            {portfolios.map((portfolio, index) => {
              const points = countHistoryPoints(history, portfolio.id);
              return (
                <label key={portfolio.id} className="history-check">
                  <input
                    type="checkbox"
                    checked={effectiveVisible.has(portfolio.id)}
                    onChange={() => togglePortfolio(portfolio.id)}
                  />
                  <span
                    className="history-swatch"
                    style={{ background: COLORS[index % COLORS.length] }}
                  />
                  <span>
                    {portfolio.name}
                    <span className="muted history-point-count"> ({points} pkt.)</span>
                  </span>
                </label>
              );
            })}
            <label className="history-check history-check-sum">
              <input
                type="checkbox"
                checked={showSum}
                onChange={(event) => setShowSum(event.target.checked)}
              />
              <span className="history-swatch history-swatch-sum" />
              <span>Suma zaznaczonych kont</span>
            </label>
          </div>
        </fieldset>
      </div>

      <div className="backup-actions history-backup-actions">
        <button
          type="button"
          onClick={exportHistoryBackup}
          disabled={history.points.length === 0}
        >
          Eksport historii do JSON
        </button>
        <button type="button" onClick={() => historyFileInputRef.current?.click()}>
          Import historii z JSON
        </button>
        <label className="history-replace-check">
          <input
            type="checkbox"
            checked={replaceOnImport}
            onChange={(event) => setReplaceOnImport(event.target.checked)}
          />
          Zastąp całą historię przy imporcie
        </label>
        <input
          ref={historyFileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void importHistoryBackup(file);
            event.target.value = "";
          }}
        />
        {historyBackupStatus && (
          <span className="backup-status">{historyBackupStatus}</span>
        )}
      </div>

      {totalPoints === 0 ? (
        <p className="status info history-empty">
          Brak zapisanej historii. Przelicz portfel na zakładce „Portfel” — pierwszy punkt pojawi się
          po udanym pobraniu cen.
        </p>
      ) : !hasChartData ? (
        <p className="status info history-empty">
          Wybrane konta nie mają jeszcze wspólnych punktów na osi czasu. Zaznacz inne konto lub
          przelicz je na zakładce Portfel.
        </p>
      ) : (
        <div className="history-chart-wrap">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                minTickGap={28}
                tick={{ fontSize: 12 }}
                tickFormatter={(value) =>
                  new Date(asNumber(value)).toLocaleDateString("pl-PL", {
                    day: "2-digit",
                    month: "2-digit",
                  })
                }
              />
              <YAxis
                tickFormatter={(value) =>
                  new Intl.NumberFormat("pl-PL", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(asNumber(value))
                }
              />
              <Tooltip
                formatter={(value, name) => {
                  const label =
                    name === sumKey
                      ? "Suma"
                      : (portfolios.find((p) => p.id === name)?.name ?? String(name));
                  return [formatCurrency(asNumber(value)), label];
                }}
                labelFormatter={(label) => {
                  const timestamp = asNumber(label);
                  const formatted = Number.isFinite(timestamp)
                    ? new Date(timestamp).toLocaleDateString("pl-PL", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })
                    : String(label);
                  return `Data: ${formatted}`;
                }}
              />
              <Legend
                formatter={(value) =>
                  value === sumKey
                    ? "Suma zaznaczonych kont"
                    : (portfolios.find((p) => p.id === value)?.name ?? value)
                }
              />
              {portfolios.map((portfolio, index) =>
                effectiveVisible.has(portfolio.id) ? (
                  <Line
                    key={portfolio.id}
                    type="monotone"
                    dataKey={portfolio.id}
                    name={portfolio.id}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                ) : null,
              )}
              {showSum && (
                <Line
                  type="monotone"
                  dataKey={sumKey}
                  name={sumKey}
                  stroke="#0f172a"
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
          <p className="muted history-footnote">
            Oś czasu jest kalendarzowa: odstęp między punktami odpowiada rzeczywistym dniom, a nie
            liczbie pomiarów. Suma dla danego dnia = suma wartości kont, które mają punkt w tym dniu.
          </p>
        </div>
      )}
    </section>
  );
}
