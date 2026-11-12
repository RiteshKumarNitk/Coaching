import { EmptyState } from "./EmptyState.jsx";
import { BarChart3 } from "lucide-react";

/**
 * Lightweight CSS bar chart (no chart library). Each bar is labelled for
 * screen readers through the column title and an accompanying data list.
 */
export function BarChart({ data, valueKey = "count", labelKey = "label", formatValue, height = 150, emptyLabel = "No data yet" }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <EmptyState icon={BarChart3} title={emptyLabel} description="Data appears here as records are added." />;
  }

  const values = data.map((item) => Number(item[valueKey] ?? 0));
  const max = Math.max(...values, 1);

  return (
    <div className="bar-chart" style={{ "--chart-height": `${height}px` }} role="group">
      <ul className="bar-chart__cols">
        {data.map((item, index) => {
          const value = Number(item[valueKey] ?? 0);
          const pct = Math.max(value === 0 ? 2 : Math.round((value / max) * 100), 3);
          return (
            <li className="bar-chart__col" key={`${item[labelKey]}-${index}`}>
              <span className="bar-chart__value small">{formatValue ? formatValue(value) : value}</span>
              <span className="bar-chart__track" aria-hidden="true">
                <span className="bar-chart__bar" style={{ height: `${pct}%` }} />
              </span>
              <span className="bar-chart__label">{item[labelKey]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
