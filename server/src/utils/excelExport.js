const ExcelJS = require('exceljs');
const { buildExportRows } = require('../services/hoursCalc');

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

function fillRow(row, argb) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  });
}

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  row.eachCell((cell) => {
    cell.border = THIN_BORDER;
  });
  fillRow(row, 'FFE8EEF2');
}

function applyThinBorders(sheet, fromRow, toRow, fromCol, toCol) {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = fromCol; c <= toCol; c++) {
      sheet.getCell(r, c).border = THIN_BORDER;
    }
  }
}

function shadeOvernight(row, isNight) {
  if (!isNight) return;
  fillRow(row, 'FFDCEBFF');
}

/**
 * Month "šihta lista" sheet shared by the per-user and per-branch exports.
 * They differ only in column 2 (Poslovnica vs Ime i Prezime) and the optional totals row.
 */
function buildMonthWorkbook({ sheetName, title, month, year, rows, col2, zbroj }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lupriv';
  const sheet = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 3 }] });

  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 14 };

  sheet.mergeCells('A2:J2');
  sheet.getCell('A2').value = `Podaci za: ${month}/${year}`;

  const headers = [
    'Datum', col2.header, 'Početak', 'Završetak', 'Prekid',
    'Radno vrijeme', 'Dodatno', 'Ostali podaci o Rad.vr.', 'Ukupno', 'Napomena',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);
  headerRow.height = 40;

  for (const r of rows) {
    const row = sheet.addRow([
      r.datum, r[col2.key], r.pocetak, r.zavrsetak, r.prekid,
      r.total, r.dodatno, r.odsustvo === '-' ? '' : r.odsustvo, r.ukupno, r.napomenaFlag,
    ]);
    if (r.nedjelja) fillRow(row, 'FFE1E1E1');
    shadeOvernight(row, r.isNightShift || r.overnight);
  }

  let lastRow = 3 + rows.length;
  if (zbroj) {
    const totalRow = sheet.addRow(['Ukupno', '', '', '', '', zbroj.total, zbroj.dodatno, '', zbroj.ukupno, '']);
    totalRow.font = { bold: true };
    lastRow += 1;
  }
  applyThinBorders(sheet, 3, lastRow, 1, 10);
  sheet.columns = [
    { width: 10 }, { width: col2.width }, { width: 10 }, { width: 12 }, { width: 12 },
    { width: 14 }, { width: 10 }, { width: 28 }, { width: 10 }, { width: 12 },
  ];
  return wb;
}

async function buildHoursWorkbook({ user, month, year, hours }) {
  const { rows, zbroj } = buildExportRows(hours, year, month);
  return buildMonthWorkbook({
    sheetName: 'Sati',
    title: `${user.ime} ${user.prezime}`,
    month,
    year,
    rows,
    col2: { header: 'Poslovnica', key: 'naziv_oj', width: 14 },
    zbroj,
  });
}

async function buildBranchWorkbook({ branch, month, year, hours }) {
  const { rows } = buildExportRows(hours, year, month);
  return buildMonthWorkbook({
    sheetName: 'Poslovnica',
    title: branch.naziv_oj,
    month,
    year,
    rows,
    col2: { header: 'Ime i Prezime', key: 'imePrezime', width: 20 },
  });
}

async function buildOdjaveWorkbook(reportRows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lupriv';
  const sheet = wb.addWorksheet('Automatske odjave');
  const headers = [
    'Ljekarna', 'Ime Prezime', 'Broj automatskih odjava', 'U tekućem mjesecu', 'U prošlom mjesecu',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);
  headerRow.height = 30;
  for (const r of reportRows) {
    sheet.addRow([r.ljekarna, r.imePrezime, r.brojOdjava, r.tekuciMjesec, r.prosliMjesec]);
  }
  applyThinBorders(sheet, 1, 1 + reportRows.length, 1, 5);
  sheet.columns = [{ width: 18 }, { width: 22 }, { width: 24 }, { width: 18 }, { width: 18 }];
  return wb;
}

async function sendWorkbook(res, workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
}

module.exports = {
  XLSX_TYPE,
  buildHoursWorkbook,
  buildBranchWorkbook,
  buildOdjaveWorkbook,
  sendWorkbook,
};
