const pool = require('./pool');

async function addIndexIfMissing(conn, table, name, columns) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name]
  );
  if (Number(rows[0].n) === 0) {
    await conn.query(`ALTER TABLE ${table} ADD INDEX ${name} (${columns})`);
  }
}

async function addColumnIfMissing(conn, table, column, definition) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (Number(rows[0].n) === 0) {
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Recreate a foreign key when its ON DELETE rule differs from `deleteRule`
 * (e.g. turn CASCADE into RESTRICT so deleting a user/branch can't wipe hours).
 */
async function ensureForeignKeyRule(conn, { table, name, column, refTable, deleteRule }) {
  const [rows] = await conn.query(
    `SELECT DELETE_RULE AS rule FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, name]
  );
  if (rows[0] && rows[0].rule === deleteRule) return;
  if (rows[0]) await conn.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${name}`);
  await conn.query(
    `ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${column}) REFERENCES ${refTable}(id) ON DELETE ${deleteRule}`
  );
}

async function migrate() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        naziv VARCHAR(15) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        sifra VARCHAR(191) NOT NULL UNIQUE,
        naziv_oj VARCHAR(25) NOT NULL,
        adresa VARCHAR(50) NULL,
        grad VARCHAR(30) NOT NULL,
        zupanija VARCHAR(50) NOT NULL,
        pocetak_rv VARCHAR(5) NOT NULL,
        kraj_rv VARCHAR(5) NOT NULL,
        rad_nedjeljom TINYINT(1) NOT NULL DEFAULT 0,
        voditelj_oj INT UNSIGNED NULL,
        ip VARCHAR(30) NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        sifra VARCHAR(20) NOT NULL UNIQUE,
        username VARCHAR(20) NOT NULL UNIQUE,
        password VARCHAR(191) NOT NULL,
        ime VARCHAR(30) NOT NULL,
        prezime VARCHAR(30) NOT NULL,
        branch_id INT UNSIGNED NULL,
        datum_rodjenja DATE NULL,
        datum_zaposlenja DATE NULL,
        datum_odlaska DATE NULL,
        role_id INT UNSIGNED NOT NULL DEFAULT 1,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT users_branch_id_foreign FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
        CONSTRAINT users_role_id_foreign FOREIGN KEY (role_id) REFERENCES roles(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // circular FK: branches.voditelj_oj -> users
    await conn.query(`
      SET @exist := (
        SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = 'branches'
          AND CONSTRAINT_NAME = 'branches_voditelj_oj_foreign'
      );
    `);
    await conn.query(`
      SET @sql := IF(@exist = 0,
        'ALTER TABLE branches ADD CONSTRAINT branches_voditelj_oj_foreign FOREIGN KEY (voditelj_oj) REFERENCES users(id) ON DELETE SET NULL',
        'SELECT 1');
    `);
    await conn.query(`PREPARE stmt FROM @sql`);
    await conn.query(`EXECUTE stmt`);
    await conn.query(`DEALLOCATE PREPARE stmt`);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS hours (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        datum DATE NOT NULL,
        radni_sati VARCHAR(100) NULL,
        user_id INT UNSIGNED NOT NULL,
        branch_id INT UNSIGNED NULL,
        odsustvo VARCHAR(50) NULL,
        odsustvo_time VARCHAR(5) NULL,
        napomena TEXT NULL,
        temp VARCHAR(10) NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT hours_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT hours_branch_id_foreign FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        naslov VARCHAR(100) NOT NULL,
        sadrzaj TEXT NOT NULL,
        user_id INT UNSIGNED NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT posts_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        datum DATETIME NOT NULL,
        user_id INT NOT NULL,
        branch_id INT NOT NULL,
        hour_id INT NULL,
        content TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Prod dump has UNIQUE(voditelj_oj). Add only if no duplicates and index missing.
    await conn.query(`
      SET @dup := (
        SELECT COUNT(*) FROM (
          SELECT voditelj_oj FROM branches
          WHERE voditelj_oj IS NOT NULL
          GROUP BY voditelj_oj HAVING COUNT(*) > 1
        ) d
      );
    `);
    await conn.query(`
      SET @idx := (
        SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'branches'
          AND INDEX_NAME = 'branches_voditelj_oj_unique'
      );
    `);
    await conn.query(`
      SET @sql := IF(@dup = 0 AND @idx = 0,
        'ALTER TABLE branches ADD UNIQUE KEY branches_voditelj_oj_unique (voditelj_oj)',
        'SELECT 1');
    `);
    await conn.query(`PREPARE stmt FROM @sql`);
    await conn.query(`EXECUTE stmt`);
    await conn.query(`DEALLOCATE PREPARE stmt`);

    // Month views filter hours by (user_id | branch_id) + datum range.
    await addIndexIfMissing(conn, 'hours', 'hours_user_datum_idx', 'user_id, datum');
    await addIndexIfMissing(conn, 'hours', 'hours_branch_datum_idx', 'branch_id, datum');

    // Attendance history must never disappear with a user or branch delete.
    await ensureForeignKeyRule(conn, {
      table: 'hours', name: 'hours_user_id_foreign', column: 'user_id', refTable: 'users', deleteRule: 'RESTRICT',
    });
    await ensureForeignKeyRule(conn, {
      table: 'hours', name: 'hours_branch_id_foreign', column: 'branch_id', refTable: 'branches', deleteRule: 'RESTRICT',
    });

    // Room for more check-in/out pairs per day (VARCHAR(100) held ~8 pairs).
    await conn.query('ALTER TABLE hours MODIFY radni_sati VARCHAR(255) NULL');

    // Migrated/admin-set passwords must be changed by the employee.
    await addColumnIfMissing(conn, 'users', 'must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0');

    await addIndexIfMissing(conn, 'logs', 'logs_datum_idx', 'datum');
    await addIndexIfMissing(conn, 'hours', 'hours_open_idx', 'user_id, temp');

    console.log('Migracija uspješna / Migration OK');

  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
