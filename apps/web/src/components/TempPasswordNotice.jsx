import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

export function TempPasswordNotice({ password, email }) {
  const [copied, setCopied] = useState(false);

  if (!password) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="temp-password" role="status">
      <div className="row" style={{ gap: 8 }}>
        <KeyRound size={16} aria-hidden="true" />
        <strong>Temporary password — shown once</strong>
      </div>
      <p className="small">
        Share it with {email || "the account holder"} and ask them to change it after signing in. It is not stored in
        readable form and cannot be shown again.
      </p>
      <div className="temp-password__row">
        <code className="mono">{password}</code>
        <button type="button" className="btn btn--ghost btn--sm" onClick={copy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
