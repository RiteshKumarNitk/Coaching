import { useQuery } from "@tanstack/react-query";
import { Receipt, Wallet } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format.js";

const statusTone = (status) =>
  status === "paid" ? "success" : status === "partial" ? "warning" : status === "waived" ? "neutral" : "danger";

export function StudentFeesPage() {
  useDocumentTitle("Fees");
  const feesQuery = useQuery({ queryKey: ["student", "fees"], queryFn: studentService.fees });

  if (feesQuery.isPending) return <DashboardSkeleton cards={3} panels={2} />;
  if (feesQuery.isError) return <ErrorState error={feesQuery.error} onRetry={feesQuery.refetch} />;

  const { summary, invoices, payments } = feesQuery.data;
  const paidPercent = summary.billed > 0 ? Math.round((summary.paid / summary.billed) * 100) : 0;

  return (
    <>
      <PageHeader title="Fees" description="Invoices, receipts and what is still pending." />

      <SectionCard title="Summary" subtitle={`${summary.openInvoices} open invoice(s)`}>
        <div className="metric-block">
          <div className="stat-line">
            <span className="muted small">Paid</span>
            <strong>{formatCurrency(summary.paid)}</strong>
          </div>
          <div className="progress" aria-hidden="true">
            <div className="progress__bar progress__bar--accent" style={{ width: `${paidPercent}%` }} />
          </div>
          <div className="metric-block__row">
            <span>Total billed</span>
            <strong>{formatCurrency(summary.billed)}</strong>
          </div>
          <div className="metric-block__row">
            <span>Pending</span>
            <strong>{formatCurrency(summary.pending)}</strong>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Payments are collected at the office. Ask for a receipt if one is missing.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Invoices" subtitle={`${invoices.length} invoice(s)`}>
        {invoices.length === 0 ? (
          <EmptyState icon={Wallet} title="No invoices" description="Your fee invoices will appear here." />
        ) : (
          <ul className="list">
            {invoices.map((invoice) => (
              <li className="list__item" key={invoice.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div className="row row--between">
                  <p className="list__title">{invoice.structureName}</p>
                  <Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge>
                </div>
                <p className="list__meta">
                  {invoice.courseName} · {invoice.academicYear}
                  {invoice.dueDate ? ` · due ${formatDate(invoice.dueDate)}` : ""}
                </p>
                <div className="row row--between small">
                  <span>
                    {formatCurrency(invoice.paidAmount)} paid of {formatCurrency(invoice.netAmount)}
                  </span>
                  <strong>{formatCurrency(invoice.pendingAmount)} pending</strong>
                </div>
                {invoice.installments?.length > 1 ? (
                  <div>
                    <p className="small muted">Instalment plan</p>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                      {invoice.installments.map((installment) => (
                        <li
                          key={installment.seq}
                          className="small"
                          style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
                        >
                          <span>
                            #{installment.seq} · {installment.dueDate ? formatDate(installment.dueDate) : "no due date"}
                          </span>
                          <span>
                            {formatCurrency(installment.amount)}{" "}
                            <Badge
                              tone={
                                installment.status === "paid"
                                  ? "success"
                                  : installment.status === "overdue"
                                    ? "danger"
                                    : installment.status === "partial"
                                      ? "warning"
                                      : "neutral"
                              }
                            >
                              {installment.status}
                            </Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {invoice.discountAmount ? (
                  <p className="small muted">Discount applied: {formatCurrency(invoice.discountAmount)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Receipts" subtitle={`${payments.length} payment(s)`}>
        {payments.length === 0 ? (
          <EmptyState icon={Receipt} title="No receipts yet" description="Receipts for office payments appear here." />
        ) : (
          <ul className="list">
            {payments.map((payment) => (
              <li className="list__item" key={payment.id}>
                <div className="list__main">
                  <p className="list__title">{payment.receiptNo}</p>
                  <p className="list__meta">
                    {formatDateTime(payment.paidAt)} · {payment.method.replaceAll("_", " ")}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                  </p>
                </div>
                <span className="list__side">{formatCurrency(payment.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
