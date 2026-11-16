import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { changePasswordSchema, homeRouteForRoles } from "@coaching/shared";
import { authService } from "../services/auth.service.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDocumentTitle } from "../hooks/useDocumentTitle.js";
import { FormField } from "../components/FormField.jsx";

export function ChangePasswordPage() {
  useDocumentTitle("Set a new password");
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const form = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" }
  });

  const mutation = useMutation({
    mutationFn: authService.changePassword,
    onSuccess: async () => {
      await refresh();
      navigate(homeRouteForRoles(user?.roles ?? []), { replace: true });
    }
  });

  return (
    <div className="auth-shell">
      <div className="auth-card card">
        <div className="card__body">
          <p className="brand__name">Coaching Institute</p>
          <h1 className="auth-title">Set a new password</h1>
          <p className="muted small">
            You signed in with a temporary password. Choose your own password to continue — it must be at least 8
            characters.
          </p>

          {mutation.isError ? (
            <div className="alert alert--error" role="alert">
              {mutation.error.message}
            </div>
          ) : null}

          <form
            className="form-grid"
            noValidate
            onSubmit={form.handleSubmit((values) =>
              mutation.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword })
            )}
          >
            <FormField
              label="Temporary password"
              htmlFor="current-password"
              required
              error={form.formState.errors.currentPassword?.message}
            >
              <input
                id="current-password"
                className="input"
                type="password"
                autoComplete="current-password"
                {...form.register("currentPassword")}
              />
            </FormField>
            <FormField
              label="New password"
              htmlFor="new-password"
              required
              error={form.formState.errors.newPassword?.message}
            >
              <input
                id="new-password"
                className="input"
                type="password"
                autoComplete="new-password"
                {...form.register("newPassword")}
              />
            </FormField>
            <div className="field--full">
              <button type="submit" className="btn btn--primary" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving…" : "Save password and continue"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
