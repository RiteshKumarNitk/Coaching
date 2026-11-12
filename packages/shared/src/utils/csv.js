/** RFC-4180-ish CSV helpers shared by the API, CLI scripts and the browser. */

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => String(value).trim() !== ""));
}

/** Serialise rows (arrays) with a header line, escaping quotes/commas/newlines. */
export function toCsv(headers, rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n");
}

/** Normalise CSV/JSON object keys: trim, lowercase, spaces -> underscores. */
export function normaliseKeys(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      String(key).trim().toLowerCase().replace(/\s+/g, "_"),
      typeof value === "string" ? value.trim() : value
    ])
  );
}
