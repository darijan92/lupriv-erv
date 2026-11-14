/**
 * One CSV field for a semicolon-separated file: quoted when needed, and text that a
 * spreadsheet would run as a formula (=, +, -, @ at the start) is prefixed with '.
 */
function csvField(value) {
  if (typeof value === 'number') return String(value);
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Send a semicolon CSV download with UTF-8 BOM (Excel-friendly). `rows` are arrays of values. */
function sendCsv(res, filename, header, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const lines = rows.map((r) => (Array.isArray(r) ? r.map(csvField).join(';') : r));
  return res.send('﻿' + header + lines.join('\n'));
}

module.exports = { sendCsv, csvField };
