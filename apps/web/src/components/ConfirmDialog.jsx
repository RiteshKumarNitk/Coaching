import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal.jsx";

/**
 * In-app replacement for window.confirm(). Keeps focus handling, Escape and
 * backdrop dismissal consistent with the rest of the admin dialogs.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  error,
  onConfirm,
  onClose,
  icon: Icon = AlertTriangle
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? undefined : onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "btn btn--danger" : "btn btn--primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm">
        <span className={`confirm__icon confirm__icon--${tone}`} aria-hidden="true">
          <Icon size={18} />
        </span>
        <p>{description}</p>
      </div>
      {error ? (
        <div className="alert alert--error" role="alert" style={{ marginTop: 14 }}>
          {error}
        </div>
      ) : null}
    </Modal>
  );
}
