import { Skeleton } from "./Skeleton.jsx";

export function DataTable({ columns, rows, rowKey = "id", loading, empty, onRowClick, stacked = false }) {
  const wrapClass = `table-wrap${stacked ? " table-wrap--stack" : ""}`;

  if (loading) {
    return (
      <div className={wrapClass} role="status" aria-live="polite">
        <span className="visually-hidden">Loading records</span>
        <table className="data">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, rowIndex) => (
              <tr key={`skeleton-${rowIndex}`} aria-hidden="true">
                {columns.map((column, columnIndex) => (
                  <td key={column.key}>
                    <Skeleton width={columnIndex === 0 ? "70%" : "45%"} height="0.8rem" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!rows || rows.length === 0) return empty;

  return (
    <div className={wrapClass}>
      <table className="data">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              className={onRowClick ? "is-clickable" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((column) => (
                <td key={column.key} data-label={column.header}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
