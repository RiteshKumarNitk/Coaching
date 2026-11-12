export function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="empty">
      {Icon ? (
        <span className="empty__icon" aria-hidden="true">
          <Icon size={20} />
        </span>
      ) : null}
      <p className="empty__title">{title}</p>
      {description ? <p className="empty__desc small">{description}</p> : null}
    </div>
  );
}
