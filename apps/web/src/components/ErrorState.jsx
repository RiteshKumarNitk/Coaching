import { AlertTriangle, RotateCw } from "lucide-react";

export function ErrorState({ error, onRetry, title = "We could not load this data" }) {
  return (
    <div className="error-state" role="alert">
      <span className="error-state__icon" aria-hidden="true">
        <AlertTriangle size={20} />
      </span>
      <div className="grow">
        <p className="error-state__title">{title}</p>
        <p className="small muted">{error?.message || "Something went wrong. Please try again."}</p>
      </div>
      {onRetry ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          <RotateCw size={15} aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </div>
  );
}
