export function StatCard({ icon: Icon, label, value, hint, tone = "brand" }) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <div className="stat-card__top">
        <span className="stat-card__icon" aria-hidden="true">
          {Icon ? <Icon size={18} strokeWidth={2} /> : null}
        </span>
        <span className="stat-card__label">{label}</span>
      </div>
      <p className="stat-card__value">{value}</p>
      {hint ? <p className="stat-card__hint">{hint}</p> : null}
    </div>
  );
}
