export function Skeleton({ width = "100%", height = "1rem", radius = "6px", className = "" }) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="card card--pad stack" aria-hidden="true">
      <Skeleton width="42%" height="0.8rem" />
      <Skeleton width="64%" height="1.7rem" />
      <Skeleton width="52%" height="0.75rem" />
    </div>
  );
}

export function DashboardSkeleton({ cards = 4, panels = 2 }) {
  return (
    <div className="stack" style={{ gap: "var(--space-5)" }} role="status" aria-live="polite">
      <span className="visually-hidden">Loading dashboard</span>
      <div className="stat-grid">
        {Array.from({ length: cards }).map((_, index) => (
          <CardSkeleton key={`stat-${index}`} />
        ))}
      </div>
      <div className="grid-2">
        {Array.from({ length: panels }).map((_, index) => (
          <div className="card card--pad stack" key={`panel-${index}`} aria-hidden="true">
            <Skeleton width="35%" height="0.85rem" />
            <Skeleton width="100%" height="8rem" radius="12px" />
            <Skeleton width="70%" height="0.75rem" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FullPageLoader({ label = "Loading" }) {
  return (
    <div className="full-loader" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="muted small">{label}…</span>
    </div>
  );
}
