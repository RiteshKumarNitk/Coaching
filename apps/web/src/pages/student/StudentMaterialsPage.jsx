import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { Skeleton } from "../../components/Skeleton.jsx";
import { formatDate } from "../../utils/format.js";

export function StudentMaterialsPage() {
  useDocumentTitle("Study material");
  const [page, setPage] = useState(1);
  const materialsQuery = useQuery({
    queryKey: ["student", "materials", page],
    queryFn: () => studentService.materials({ page, pageSize: 20 })
  });

  return (
    <>
      <PageHeader title="Study material" description="Notes and reference links shared by your teachers." />

      {materialsQuery.isError ? <ErrorState error={materialsQuery.error} onRetry={materialsQuery.refetch} /> : null}

      {materialsQuery.isPending ? (
        <div className="stack" style={{ gap: 10 }}>
          {[0, 1].map((key) => (
            <div className="card" key={key}>
              <div className="card__body">
                <Skeleton height="1rem" width="60%" />
                <Skeleton height="0.8rem" width="35%" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {materialsQuery.data && materialsQuery.data.items.length === 0 ? (
        <SectionCard>
          <EmptyState icon={FileText} title="Nothing shared yet" description="Material your teachers publish appears here." />
        </SectionCard>
      ) : null}

      {materialsQuery.data?.items.map((material) => (
        <article className="card" key={material.id}>
          <div className="card__body stack" style={{ gap: 8 }}>
            <div className="row row--between">
              <Badge tone="brand">{material.subjectName}</Badge>
              <Badge tone="neutral">{material.kind}</Badge>
            </div>
            <p className="cell-primary">{material.title}</p>
            {material.description ? <p className="small muted">{material.description}</p> : null}
            <div className="row row--between small muted">
              <span>
                {material.chapter ? `${material.chapter} · ` : ""}
                {formatDate(material.createdAt)}
              </span>
              <a className="btn btn--ghost btn--sm" href={material.driveUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={13} /> Open in Drive
              </a>
            </div>
          </div>
        </article>
      ))}

      {materialsQuery.data ? (
        <Pagination page={page} pageSize={20} total={materialsQuery.data.total} onChange={setPage} />
      ) : null}
    </>
  );
}
