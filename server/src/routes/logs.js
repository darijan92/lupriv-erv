const express = require('express');
const pool = require('../db/pool');
const { authRequired, requireAdmin } = require('../middleware/auth');
const { buildOdjaveWorkbook, sendWorkbook } = require('../utils/excelExport');
const { nullsLastOrder } = require('../utils/sqlSort');
const { sendCsv } = require('../utils/csv');

const router = express.Router();

const AUTO_LOGOUT_WHERE = `napomena LIKE '%Automatska odjava%'`;

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 25));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

router.get('/', authRequired, requireAdmin, async (req, res) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query);

    const [[[{ total }]], [rows]] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM logs'),
      pool.query(
        `SELECT l.*, u.ime, u.prezime, b.naziv_oj
         FROM logs l
         LEFT JOIN users u ON u.id=l.user_id
         LEFT JOIN branches b ON b.id=l.branch_id
         ORDER BY ${nullsLastOrder('l.datum', 'l.datum', 'DESC')}
         LIMIT ? OFFSET ?`,
        [pageSize, offset]
      ),
    ]);
    res.json({ logs: rows, total: Number(total), page, pageSize });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

router.get('/auto-logout', authRequired, requireAdmin, async (req, res) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query);
    const where = `h.${AUTO_LOGOUT_WHERE}`;

    const [[[{ total }]], [hours]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM hours h WHERE ${where}`),
      pool.query(
        `SELECT h.*, u.ime, u.prezime, u.username, b.naziv_oj
         FROM hours h
         JOIN users u ON u.id=h.user_id
         LEFT JOIN branches b ON b.id=h.branch_id
         WHERE ${where}
         ORDER BY ${nullsLastOrder('h.datum', 'h.datum', 'DESC')}
         LIMIT ? OFFSET ?`,
        [pageSize, offset]
      ),
    ]);
    res.json({ hours, total: Number(total), page, pageSize });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

async function buildOdjaveReport() {
  const [[users], [hours]] = await Promise.all([
    pool.query(
      `SELECT u.id, u.ime, u.prezime, u.username, u.branch_id, b.naziv_oj
       FROM users u
       LEFT JOIN branches b ON b.id=u.branch_id
       WHERE u.branch_id IS NOT NULL
       ORDER BY ${nullsLastOrder('b.naziv_oj')}, ${nullsLastOrder('u.prezime')}, ${nullsLastOrder('u.ime')}`
    ),
    pool.query(`SELECT user_id, datum FROM hours WHERE ${AUTO_LOGOUT_WHERE}`),
  ]);

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prev.getMonth() + 1;
  const prevYear = prev.getFullYear();

  const report = users.map((u) => ({
    user_id: u.id,
    ljekarna: u.naziv_oj || '-',
    imePrezime: `${u.ime} ${u.prezime}`,
    brojOdjava: 0,
    tekuciMjesec: 0,
    prosliMjesec: 0,
  }));
  const byId = new Map(report.map((r) => [r.user_id, r]));

  for (const h of hours) {
    const row = byId.get(h.user_id);
    if (!row) continue;
    row.brojOdjava += 1;
    const d = new Date(String(h.datum).slice(0, 10));
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    if (m === curMonth && y === curYear) row.tekuciMjesec += 1;
    if (m === prevMonth && y === prevYear) row.prosliMjesec += 1;
  }

  return report;
}

router.get('/auto-logout/report', authRequired, requireAdmin, async (_req, res) => {
  try {
    const report = await buildOdjaveReport();
    res.json({ report });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

router.get('/auto-logout/export', authRequired, requireAdmin, async (req, res) => {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const report = await buildOdjaveReport();

    if (format === 'csv') {
      const header = 'Ljekarna;Ime Prezime;Broj automatskih odjava;U tekućem mjesecu;U prošlom mjesecu\n';
      const lines = report.map((r) => [r.ljekarna, r.imePrezime, r.brojOdjava, r.tekuciMjesec, r.prosliMjesec]);
      return sendCsv(res, 'automatske_odjave.csv', header, lines);
    }

    const wb = await buildOdjaveWorkbook(report);
    return sendWorkbook(res, wb, 'automatske_odjave.xlsx');
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Greška' });
  }
});

module.exports = router;
