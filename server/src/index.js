const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const kioskRoutes = require('./routes/kiosk');
const usersRoutes = require('./routes/users');
const branchesRoutes = require('./routes/branches');
const postsRoutes = require('./routes/posts');
const hoursRoutes = require('./routes/hours');
const logsRoutes = require('./routes/logs');
const moderatorRoutes = require('./routes/moderator');
const { router: autoLogoutRoutes, runAutoLogout } = require('./routes/autoLogout');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim());

app.use(morgan('dev'));
app.use(express.json());
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'lupriv_new', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/kiosk', kioskRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/hours', hoursRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/moderator', moderatorRoutes);
app.use('/api/auto-logout', autoLogoutRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Greška na serveru' });
});

/** Periodic wake: every 30 min; actual logout only after 23:00 once per calendar day. */
const AUTO_LOGOUT_INTERVAL_MS = 30 * 60 * 1000;

async function scheduledAutoLogoutCheck(label) {
  const result = await runAutoLogout({ force: false });
  if (result.skipped) return;
  if (result.closed || result.skippedNight) {
    console.log(
      `Auto-logout (${label}): zatvoreno ${result.closed} (dan ${result.closedDay}, noć ${result.closedNight}), ` +
        `noćne današnje preskočene ${result.skippedNight}` +
        (result.fallbackPocetak ? `, fallback pocetak_rv×${result.fallbackPocetak}` : '') +
        (result.fallbackKraj ? `, fallback kraj_rv×${result.fallbackKraj}` : '')
    );
  } else {
    console.log(`Auto-logout (${label}): nema otvorenih sesija za odjavu`);
  }
}

app.listen(PORT, async () => {
  console.log(`API listening on http://localhost:${PORT}`);
  try {
    await scheduledAutoLogoutCheck('startup');
  } catch (e) {
    console.warn('Auto-logout startup check failed:', e.message);
  }
  setInterval(() => {
    scheduledAutoLogoutCheck('interval').catch((e) => console.warn('auto-logout:', e.message));
  }, AUTO_LOGOUT_INTERVAL_MS);
});
