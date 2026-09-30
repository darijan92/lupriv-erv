/** Send a semicolon CSV download with UTF-8 BOM (Excel-friendly). */
function sendCsv(res, filename, header, lines) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send('﻿' + header + lines.join('\n'));
}

module.exports = { sendCsv };
