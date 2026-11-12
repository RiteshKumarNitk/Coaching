import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, BookOpen, Eye, EyeOff, GraduationCap, ShieldCheck, Users } from "lucide-react";
import { homeRouteForRoles, loginSchema } from "@coaching/shared";
import { useAuth } from "../../hooks/useAuth.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";

const features = [
  { icon: BookOpen, text: "Recorded lectures and chapter-wise notes in one place." },
  { icon: GraduationCap, text: "Online tests with timers, results and performance history." },
  { icon: Users, text: "Attendance, fee status and announcements for every batch." },
  { icon: ShieldCheck, text: "Role-based access for students, teachers and the office." }
];

export function LoginPage() {
  useDocumentTitle("Sign in");
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });

  async function onSubmit(values) {
    setServerError(null);
    try {
      const user = await login(values);
      const requested = location.state?.from;
      const target =
        typeof requested === "string" && requested.startsWith("/") ? requested : homeRouteForRoles(user.roles);
      navigate(target, { replace: true });
    } catch (error) {
      setServerError(error.message || "Sign-in failed. Please try again.");
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-brand" aria-label="About this portal">
        <div className="auth-brand__content">
          <span className="row" style={{ gap: 10 }}>
            <span className="brand__mark" aria-hidden="true">
              CI
            </span>
            <span>
              <span className="brand__name" style={{ display: "block" }}>
                Coaching Institute
              </span>
              <span className="brand__sub">Learning portal</span>
            </span>
          </span>
          <h1>Everything your batch needs, in one place.</h1>
          <p>
            Sign in to see today&apos;s classes, lectures, tests and fee status. Teachers and the office use the
            same secure portal with their own workspace.
          </p>
        </div>

        <div className="auth-features">
          {features.map((feature) => (
            <div className="auth-feature" key={feature.text}>
              <feature.icon size={16} aria-hidden="true" />
              <span>{feature.text}</span>
            </div>
          ))}
        </div>

        <p className="auth-brand__footer">
          Accounts are created by the institute office. Contact the front desk if you cannot sign in.
        </p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="brand brand--ink">
              <span className="brand__mark" aria-hidden="true">
                CI
              </span>
              <span>
                <span className="brand__name">Coaching Institute</span>
                <span className="brand__sub">Learning portal</span>
              </span>
            </span>
          </div>

          <header className="auth-card__head">
            <span className="eyebrow">Welcome back</span>
            <h2>Sign in to your account</h2>
            <p className="muted small">Use the email address registered with the institute.</p>
          </header>

          {serverError ? (
            <div className="alert alert--error" role="alert" style={{ marginBottom: 16 }}>
              <AlertCircle size={16} aria-hidden="true" />
              <span>{serverError}</span>
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="field">
              <label className="label" htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                inputMode="email"
                placeholder="you@example.com"
                aria-invalid={errors.email ? "true" : "false"}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email")}
              />
              {errors.email ? (
                <p className="field-error" id="email-error">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label className="label" htmlFor="password">
                Password
              </label>
              <div className="input-wrap">
                <input
                  id="password"
                  className="input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  aria-invalid={errors.password ? "true" : "false"}
                  aria-describedby={errors.password ? "password-error" : undefined}
                  {...register("password")}
                />
                <button
                  type="button"
                  className="input-affix"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {errors.password ? (
                <p className="field-error" id="password-error">
                  {errors.password.message}
                </p>
              ) : null}
            </div>

            <button type="submit" className="btn btn--primary btn--block" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <span className="btn__spinner" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>

            <p className="help" style={{ textAlign: "center" }}>
              Forgot your password? Ask the office to reset it for you.
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
