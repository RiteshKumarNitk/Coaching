export function FormField({ label, htmlFor, error, hint, children, required, full = false }) {
  return (
    <div className={full ? "field field--full" : "field"}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="help">{hint}</p>
      ) : null}
    </div>
  );
}
