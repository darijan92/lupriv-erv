const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seed() {
  const conn = await pool.getConnection();
  try {
    const [roles] = await conn.query('SELECT COUNT(*) AS c FROM roles');
    if (roles[0].c === 0) {
      await conn.query(
        `INSERT INTO roles (id, naziv) VALUES (1,'korisnik'),(2,'voditelj'),(3,'admin')`
      );
    }

    const [branchesCount] = await conn.query('SELECT COUNT(*) AS c FROM branches');
    if (branchesCount[0].c === 0) {
      await conn.query(
        `INSERT INTO branches (sifra, naziv_oj, adresa, grad, zupanija, pocetak_rv, kraj_rv, rad_nedjeljom)
         VALUES
         ('001','OJ Zagreb 1','Ilica 1','Zagreb','Grad Zagreb','07:00','20:00',0),
         ('002','OJ Split 1','Marmontova 5','Split','Splitsko-dalmatinska','07:00','20:00',1)`
      );
    }

    const [usersCount] = await conn.query('SELECT COUNT(*) AS c FROM users');
    if (usersCount[0].c === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      const empHash = await bcrypt.hash('lozinka123', 10);
      const modHash = await bcrypt.hash('voditelj123', 10);

      await conn.query(
        `INSERT INTO users (sifra, username, password, ime, prezime, branch_id, datum_rodjenja, datum_zaposlenja, role_id)
         VALUES
         ('A001','admin',:hash,'Admin','Lupriv',NULL,'1980-01-01','2015-01-01',3),
         ('V001','voditelj',:modHash,'Marko','Voditelj',1,'1985-05-05','2018-03-01',2),
         ('U001','ana',:empHash,'Ana','Anić',1,'1990-02-02','2020-01-15',1),
         ('U002','ivan',:empHash,'Ivan','Ivić',1,'1992-08-08','2021-06-01',1),
         ('U003','petra',:empHash,'Petra','Perić',2,'1995-11-11','2022-02-01',1)`,
        { hash, modHash, empHash }
      );

      const [vod] = await conn.query(`SELECT id FROM users WHERE username='voditelj'`);
      if (vod[0]) {
        await conn.query(`UPDATE branches SET voditelj_oj=? WHERE sifra='001'`, [vod[0].id]);
      }
    }

    const [postsCount] = await conn.query('SELECT COUNT(*) AS c FROM posts');
    if (postsCount[0].c === 0) {
      const [admin] = await conn.query(`SELECT id FROM users WHERE username='admin'`);
      const uid = admin[0]?.id || null;
      await conn.query(
        `INSERT INTO posts (naslov, sadrzaj, user_id) VALUES
         ('Dobrodošli u Lupriv sati','Novi sustav evidencije radnog vremena. Prijava i odjava na početnoj stranici poslovnice.', :uid),
         ('Podsjetnik','Molimo prijave i odjave radnog vremena na vrijeme.', :uid)`,
        { uid }
      );
    }

    console.log('Seed OK');
    console.log('Admin: admin / admin123');
    console.log('Voditelj: voditelj / voditelj123');
    console.log('Zaposlenici: ana|ivan|petra / lozinka123');
  } finally {
    conn.release();
    await pool.end();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
