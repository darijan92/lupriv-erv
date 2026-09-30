const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config(); // also server/.env

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'lupriv',
  password: process.env.DB_PASSWORD || 'lupriv_pass',
  database: process.env.DB_NAME || 'lupriv_new',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  dateStrings: true,
});

module.exports = pool;
