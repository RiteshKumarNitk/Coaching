import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminOpsService } from "../../services/adminOps.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { FormField } from "../../components/FormField.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Skeleton } from "../../components/Skeleton.jsx";

const FIELDS = [
  { key: "instituteName", label: "Institute name", id: "set-name", maxLength: 120 },
  { key: "institutePhone", label: "Phone", id: "set-phone", maxLength: 30 },
  { key: "instituteEmail", label: "Email", id: "set-email", maxLength: 120 },
  { key: "instituteAddress", label: "Address", id: "set-address", maxLength: 300 },
  { key: "receiptFooter", label: "Receipt footer", id: "set-footer", maxLength: 200 }
];

export function AdminSettingsPage() {
  useDocumentTitle("Settings");
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);

  const settingsQuery = useQuery({ queryKey: ["admin", "settings"], queryFn: adminOpsService.settings });

  useEffect(() => {
    if (settingsQuery.data) setForm(settingsQuery.data);
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => adminOpsService.updateSettings(form),
    onSuccess: (data) => {
      setForm(data);
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    }
  });

  if (settingsQuery.isError) {
    return <ErrorState error={settingsQuery.error} onRetry={settingsQuery.refetch} />;
  }

  return (
    <div className="page-section">
      <PageHeader
        title="Institute settings"
        description="Names and contact details used across the app and on receipts."
      />

      <SectionCard title="Details">
        {!form ? (
          <Skeleton height="9rem" />
        ) : (
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              saveMutation.mutate();
            }}
          >
            {saveMutation.isError ? (
              <div className="alert alert--error field--full" role="alert">
                {saveMutation.error.message}
              </div>
            ) : null}
            {saveMutation.isSuccess ? (
              <div className="alert alert--success field--full" role="status">
                Settings saved.
              </div>
            ) : null}

            {FIELDS.map((field) => (
              <FormField key={field.key} label={field.label} htmlFor={field.id}>
                {field.key === "receiptFooter" || field.key === "instituteAddress" ? (
                  <textarea
                    id={field.id}
                    className="input"
                    rows={field.key === "receiptFooter" ? 2 : 3}
                    maxLength={field.maxLength}
                    value={form[field.key] ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                ) : (
                  <input
                    id={field.id}
                    className="input"
                    maxLength={field.maxLength}
                    value={form[field.key] ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                )}
              </FormField>
            ))}

            <div className="field--full">
              <button type="submit" className="btn btn--primary" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : "Save settings"}
              </button>
            </div>
          </form>
        )}
      </SectionCard>
    </div>
  );
}
