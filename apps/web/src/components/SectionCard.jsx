export function SectionCard({ title, subtitle, action, children, className = "", as: Tag = "section" }) {
  return (
    <Tag className={`card ${className}`.trim()}>
      <header className="card__head">
        <div>
          <h2 className="card__title">{title}</h2>
          {subtitle ? <p className="card__subtitle small muted">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className="card__body">{children}</div>
    </Tag>
  );
}
