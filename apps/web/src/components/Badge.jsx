export function Badge({ children, tone = "neutral", icon: Icon }) {
  return (
    <span className={`badge badge--${tone}`}>
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
