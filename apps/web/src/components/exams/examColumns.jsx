import { Badge } from "../Badge.jsx";
import { formatDateTime } from "../../utils/format.js";

const statusTone = (status) =>
  status === "published" ? "success" : status === "scheduled" ? "info" : status === "closed" ? "neutral" : "warning";

/** Table columns shared by the admin and teacher exam lists. */
export function examColumns() {
  return [
    {
      key: "title",
      header: "Exam",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.title}</p>
          <p className="cell-sub">
            {row.batchName}
            {row.subjectName ? ` · ${row.subjectName}` : ""}
          </p>
        </div>
      )
    },
    { key: "startsAt", header: "Starts", render: (row) => formatDateTime(row.startsAt) },
    { key: "duration", header: "Duration", render: (row) => `${row.durationMinutes} min` },
    { key: "marks", header: "Marks", render: (row) => `${row.totalMarks} (pass ${row.passMarks})` },
    { key: "questions", header: "Questions", render: (row) => row.questionCount },
    { key: "attempts", header: "Attempts", render: (row) => row.attemptCount },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Badge tone={statusTone(row.status)}>{row.status}</Badge>
          {row.resultsPublished ? <Badge tone="success">Results out</Badge> : null}
        </div>
      )
    }
  ];
}
