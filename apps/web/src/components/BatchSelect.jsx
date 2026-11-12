import { FormField } from "./FormField.jsx";

/** Dropdown of the teacher's batches, used by the workspace pages. */
export function BatchSelect({ batches, value, onChange, id = "batch-select", label = "Batch" }) {
  return (
    <FormField label={label} htmlFor={id}>
      <select id={id} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select a batch…</option>
        {(batches ?? []).map((batch) => (
          <option key={batch.id} value={batch.id}>
            {batch.name} ({batch.code})
          </option>
        ))}
      </select>
    </FormField>
  );
}
