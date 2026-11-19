import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle2, KeyRound, Mail, Phone, ShieldCheck, UserRound } from "lucide-react";
import { changePasswordSchema, ROLE_LABELS } from "@coaching/shared";
import { authService } from "../services/auth.service.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDocumentTitle } from "../hooks/useDocumentTitle.js";
import { PageHeader } from "../components/PageHeader.jsx";
import { SectionCard } from "../components/SectionCard.jsx";
import { Skeleton } from "../components/Skeleton.jsx";
import { ErrorState } from "../components/ErrorState.jsx";
import { Badge } from "../components/Badge.jsx";
import { StudentAppCard } from "../components/StudentAppCard.jsx";
import { formatDate, initials } from "../utils/format.js";

export function ProfilePage() {
  useDocumentTitle("My profile");
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isStudent = user?.roles?.includes("student");
  const [notice, setNotice] = useState(null);

  const profileQuery = useQuery({
    queryKey: ["profile", "me"],
    queryFn: authService.profile
  });

  const passwordForm = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" }
  });

  const changePassword = useMutation({
    mutationFn: authService.changePassword,
    onSuccess: () => {
      setNotice({ type: "success", message: "Password updated. Other devices have been signed out." });
      passwordForm.reset();
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error) => {
      setNotice({ type: "error", message: error.message });
    }
  });

  const profile = profileQuery.data?.profile;
  const studentProfile = profile?.studentProfile;
  const teacherProfile = profile?.teacherProfile;

  return (
    <div className="page-section">
      <PageHeader title="My profile" description="Your account details and security settings." />

      <div className="profile-grid">
        <div className="stack" style={{ gap: 18 }}>
          <SectionCard title="Account" subtitle="Managed by the institute office">
            {profileQuery.isPending ? (
              <div className="stack" aria-hidden="true">
                <Skeleton width="55%" height="1.2rem" />
                <Skeleton width="70%" height="0.9rem" />
                <Skeleton width="45%" height="0.9rem" />
              </div>
            ) : profileQuery.isError ? (
              <ErrorState error={profileQuery.error} onRetry={profileQuery.refetch} />
            ) : (
              <div className="stack" style={{ gap: 16 }}>
                <div className="row" style={{ gap: 14 }}>
                  <span className="avatar avatar--brand avatar--lg" aria-hidden="true">
                    {initials(profile.fullName)}
                  </span>
                  <div>
                    <h3>{profile.fullName}</h3>
                    <div className="row row--wrap" style={{ marginTop: 6 }}>
                      {profile.roles.map((role) => (
                        <Badge key={role} tone="brand" icon={ShieldCheck}>
                          {ROLE_LABELS[role] ?? role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <dl className="detail-list">
                  <div className="detail-row">
                    <dt>
                      <Mail size={13} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                      Email
                    </dt>
                    <dd>{profile.email}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>
                      <Phone size={13} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                      Phone
                    </dt>
                    <dd>{profile.phone || "Not recorded"}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>Account status</dt>
                    <dd style={{ textTransform: "capitalize" }}>{profile.status}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>Last sign-in</dt>
                    <dd>{profile.lastLoginAt ? formatDate(profile.lastLoginAt) : "—"}</dd>
                  </div>
                </dl>
              </div>
            )}
          </SectionCard>

          {isStudent ? <StudentAppCard /> : null}

          {studentProfile ? (
            <SectionCard title="Enrolment" subtitle="Student record">
              <dl className="detail-list">
                <div className="detail-row">
                  <dt>Enrolment number</dt>
                  <dd className="mono">{studentProfile.enrollment_no}</dd>
                </div>
                <div className="detail-row">
                  <dt>Admission date</dt>
                  <dd>{formatDate(studentProfile.admission_date)}</dd>
                </div>
                <div className="detail-row">
                  <dt>Course</dt>
                  <dd>{studentProfile.enrollment?.name ?? "Not assigned"}</dd>
                </div>
                <div className="detail-row">
                  <dt>Batch</dt>
                  <dd>{studentProfile.enrollment?.batch ?? "Not assigned"}</dd>
                </div>
                <div className="detail-row">
                  <dt>Guardians</dt>
                  <dd>
                    {studentProfile.guardians?.length
                      ? studentProfile.guardians
                          .map((guardian) => `${guardian.name}${guardian.phone ? ` · ${guardian.phone}` : ""}`)
                          .join(", ")
                      : "Not recorded"}
                  </dd>
                </div>
              </dl>
            </SectionCard>
          ) : null}

          {teacherProfile ? (
            <SectionCard title="Teaching profile" subtitle="Staff record">
              <dl className="detail-list">
                <div className="detail-row">
                  <dt>Employee code</dt>
                  <dd className="mono">{teacherProfile.employee_code}</dd>
                </div>
                <div className="detail-row">
                  <dt>Qualification</dt>
                  <dd>{teacherProfile.qualification || "Not recorded"}</dd>
                </div>
                <div className="detail-row">
                  <dt>Specialisation</dt>
                  <dd>{teacherProfile.specialization || "Not recorded"}</dd>
                </div>
                <div className="detail-row">
                  <dt>Assigned batches</dt>
                  <dd>{teacherProfile.batch_count}</dd>
                </div>
              </dl>
            </SectionCard>
          ) : null}
        </div>

        <SectionCard title="Change password" subtitle="Choose a strong password you do not use elsewhere">
          <form
            className="stack"
            style={{ gap: 14 }}
            onSubmit={passwordForm.handleSubmit((values) => changePassword.mutate(values))}
            noValidate
          >
            {notice ? (
              <div className={`alert alert--${notice.type}`} role="status">
                {notice.type === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
                <span>{notice.message}</span>
              </div>
            ) : null}

            <div className="field">
              <label className="label" htmlFor="currentPassword">
                Current password
              </label>
              <input
                id="currentPassword"
                className="input"
                type="password"
                autoComplete="current-password"
                aria-invalid={passwordForm.formState.errors.currentPassword ? "true" : "false"}
                {...passwordForm.register("currentPassword")}
              />
              {passwordForm.formState.errors.currentPassword ? (
                <p className="field-error">{passwordForm.formState.errors.currentPassword.message}</p>
              ) : null}
            </div>

            <div className="field">
              <label className="label" htmlFor="newPassword">
                New password
              </label>
              <input
                id="newPassword"
                className="input"
                type="password"
                autoComplete="new-password"
                aria-invalid={passwordForm.formState.errors.newPassword ? "true" : "false"}
                {...passwordForm.register("newPassword")}
              />
              {passwordForm.formState.errors.newPassword ? (
                <p className="field-error">{passwordForm.formState.errors.newPassword.message}</p>
              ) : (
                <p className="help">At least 8 characters with one letter and one number.</p>
              )}
            </div>

            <button type="submit" className="btn btn--primary" disabled={changePassword.isPending}>
              {changePassword.isPending ? (
                <>
                  <span className="btn__spinner" aria-hidden="true" />
                  Updating…
                </>
              ) : (
                <>
                  <KeyRound size={16} aria-hidden="true" />
                  Update password
                </>
              )}
            </button>

            <p className="help">
              Signing out of other devices protects your account if someone else knows your old password.
            </p>
          </form>

          <hr className="divider" style={{ margin: "18px 0" }} />

          <div className="row" style={{ gap: 10 }}>
            <span className="empty__icon" style={{ width: 36, height: 36, borderRadius: 11 }} aria-hidden="true">
              <UserRound size={16} />
            </span>
            <p className="small muted">
              Need to change your name, phone or batch? Contact the institute office — those fields are managed by staff.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
