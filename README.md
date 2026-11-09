# Lupriv New — evidencija radnog vremena

HR / EN rebuild of the legacy Laravel Lupriv time-tracking app.

Moderni lokalni stack: **Node.js (Express) API** + **Vue 3 (Vite)** + **MySQL 8 (Docker Compose)**.

---

## Stack

| Dio | Tehnologija |
|-----|-------------|
| API | Node.js, Express, mysql2, bcryptjs, JWT, Zod, ExcelJS |
| Frontend | Vue 3, Vite, Vue Router, Pinia, Axios |
| Baza | MySQL 8.4 (Docker), opcionalno phpMyAdmin |
| Docker app | API (Node 22) + web (nginx + Vue build) |
| Auth | JWT (Bearer), lozinke **samo bcrypt** |

---

## Arhitektura (kratko)

```
lupriv_new/
  docker-compose.yml       # mysql, api, web (prod-like)
  docker-compose.dev.yml   # +3307, +3001, phpMyAdmin
  deploy/                  # Caddy + VPS notes
  server/
    Dockerfile
    docker-entrypoint.sh  # migrate pa node
    src/
      routes/        # tanki HTTP sloj
      services/      # poslovna logika (hours, auth, calc)
      middleware/    # JWT auth, Zod validate
      utils/         # time (overnight), excelExport
      db/            # pool, migrate, seed
  client/
    Dockerfile       # Vite build → nginx
    nginx.conf       # SPA + proxy /api → api:3001
    src/
      views/         # stranice (HR UI)
      composables/   # useDownload, useFlash
      stores/        # Pinia auth
```

- **Jedan izvor istine** za zbrojeve sati: `server/src/services/hoursCalc.js`
- Overnight / noćne smjene: `end < start` (npr. 22:00–06:00) računa se preko ponoći u `utils/time.js`
- Excel: `utils/excelExport.js` (isti izračun kao UI)

---

## Preduvjeti

- Node.js 20+ (host npm); Docker slike koriste Node 22
- npm
- Docker Desktop (pokrenut daemon)

---

## Brzi start — cijeli stack u Dockeru (preporučeno)

Prod-like layout: **mysql + api + web**. MySQL i API **nisu** izloženi na host portovima; phpMyAdmin se ne pokreće. Web na **:8080** (nginx → `/api/` → api).

```bash
cd lupriv-erv
cp .env.example .env   # lokalno; na VPS-u .env.docker.example s pravim tajnama

npm run docker:up          # docker compose up --build -d --remove-orphans
# api na startu radi migrate (idempotentno); seed samo na praznoj bazi:
npm run docker:seed        # docker compose exec api npm run seed
```

| Servis | URL (prod-like) |
|--------|-----------------|
| **Web (nginx + Vue)** | http://localhost:8080 |
| **API** | samo preko http://localhost:8080/api/ (nije publishan) |
| MySQL | samo unutar Docker mreže (`mysql:3306`) |

Frontend koristi relativni `/api`; nginx u `web` kontejneru prosljeđuje na `api:3001` (isti origin, bez CORS muka).

Zaustavljanje app kontejnera (MySQL ostaje): `npm run docker:down`  
Zaustavljanje svega **bez** brisanja volumena: `docker compose stop`  
**Nikad** `docker compose down -v` ako želiš zadržati podatke.

Tajne: root `.env` (compose `${VAR}`); predložak `.env.docker.example` / `.env.example`.

### Lokalni dev portovi (MySQL 3307, API 3001, phpMyAdmin)

```bash
npm run db:up              # mysql + phpMyAdmin (docker-compose.dev.yml)
# ili cijeli stack s debug portovima:
npm run docker:up:dev
```

| Servis | URL (dev override) |
|--------|-------------------|
| MySQL (host) | `127.0.0.1:3307` |
| API (izravno) | http://localhost:3001 |
| phpMyAdmin | http://localhost:8082 |

VPS / HTTPS: vidi [`deploy/README.md`](deploy/README.md) i `deploy/Caddyfile.example`.

---

## Brzi start — host npm (fallback)

MySQL + phpMyAdmin u Dockeru, API i Vite lokalno:

```bash
npm run db:up              # samo mysql + phpmyadmin
npm install
npm run migrate --prefix server
npm run seed --prefix server
npm run dev                # API :3001 + Vite :5173
```

Odvojeno: `npm run dev:server` / `npm run dev:client`

Host `.env` koristi `DB_HOST=127.0.0.1` i `DB_PORT=3307`. U Docker API kontejneru compose postavlja `DB_HOST=mysql` i `DB_PORT=3306`.

---

## Portovi

| Servis | Docker prod-like (`docker:up`) | Docker + dev override | Host npm |
|--------|-------------------------------|------------------------|----------|
| Frontend | http://localhost:8080 | isto | http://localhost:5173 |
| API | preko `/api/` na :8080 | http://localhost:3001 | http://localhost:3001 |
| MySQL (host) | (nije publishan) | `127.0.0.1:3307` | isto (uz `db:up`) |
| phpMyAdmin | (off) | http://localhost:8082 | isto |

---

## Zadane prijave (seed)

| Uloga | Username | Lozinka |
|-------|----------|---------|
| Admin | `admin` | `admin123` |
| Voditelj | `voditelj` | `voditelj123` |
| Zaposlenik | `ana` / `ivan` / `petra` | `lozinka123` |

---

## Excel izvoz (.xlsx)

| Endpoint | Opis | Primjer datoteke |
|----------|------|------------------|
| `GET /api/hours/export/:userId?month=&year=` | Sati zaposlenika | `sati_ana_9_2026.xlsx` |
| `GET /api/hours/export-branch/:branchId?month=&year=` | Cijela poslovnica | `poslovnica_1_9_2026.xlsx` |
| `GET /api/logs/auto-logout/export` | Automatske odjave (agregat) | `automatske_odjave.xlsx` |

CSV: dodaj `?format=csv`. Preuzimanje u UI-ju ide preko `Authorization: Bearer` (ne token u queryju).

**UI:**
- Pregled sati → **Izvoz Excel**
- Voditelj → Excel po zaposleniku + **Izvoz Excel (poslovnica)**
- Admin → Automatske odjave → **Izvoz Excel**

---

## Noćni rad / smjena

- Voditelj/admin upisuje **Noćni rad / smjena** na pregledu sati (ne preko početne stranice).
- Intervali s `kraj < početak` (npr. 22:00–06:00) računaju se kao overnight (+24h).
- Opcija „Bez sati — 08:00“ = stari flat noćni rad (`odsustvo = Noćni rad`).
- U tablici i Excelu noćne smjene su označene (plava pozadina / oznaka).
- **Noćna smjena na početnoj stranici** (temp preko ponoći): namjerno odgođeno — dokumentirano; prioritet je upis voditelja + točni zbrojevi.

---

## Glavne funkcionalnosti

- Prijava/odjava na početnoj stranici, JWT login, admin CRUD, voditelj sati/odsustva, auto-odjava (jednom dnevno nakon 23:00; dnevne kraj = kraj_rv poslovnice; noćne ≥ 20:00 se odgađaju do sljedeće večeri, kraj = pocetak_rv)

---

## Baza

- DB `lupriv_new`, user `lupriv` / `lupriv_pass`, root `rootpass`
- Konfig: `.env` / `.env.example` (host npm); Docker: compose `environment` + `.env.docker.example`
- JWT_SECRET obavezno promijeniti izvan dema

---

## Lint

```bash
npm run lint --prefix server
npm run lint --prefix client
```

ESLint + Prettier konfigurirani; TypeScript nije forsirani migracijom (JS + JSDoc/slojevi).

---

## Uloge (role_id)

| id | Naziv | Napomena |
|----|-------|----------|
| 1 | Zaposlenik | |
| 2 | Voditelj OJ | |
| 3 | Administrator | |
| 4 | SarajevoAdmin | U produkcijskom dumpu; `role_id >= 3` tretira se kao admin (namjerno, da 2 korisnika zadrže pristup). Ne mijenjati bez dogovora. |

---

## Produkcijska baza

Lokalni dump: `databases/lupriv_plus_backup_23_09_26.sql` (izvor: `plus_ljekarne`).

### Import (lokalno ili na novom serveru)

1. Pokreni MySQL (`npm run db:up` ili Docker stack).
2. Kreiraj praznu bazu (npr. `lupriv_new`) i daj prava app useru (`lupriv`).
3. Import **bez** `CREATE DATABASE` u dumpu — ciljana baza se bira na CLI:

```bash
docker compose exec -T mysql mysql -uroot -prootpass lupriv_new < databases/lupriv_plus_backup_23_09_26.sql
```

4. U `.env` / `server/.env` postavi `DB_NAME` na tu bazu (trenutno: `lupriv_new`).
5. **Ponovno pokreni migraciju** (dump vraća stare FK-ove i nema novih stupaca): `npm run migrate` ili `docker compose exec api npm run migrate`.
6. **Obavezno** hashaj plaintext lozinke (produkcija ih ima u plainu; API prihvaća samo bcrypt `$2…`):

```bash
npm run hash-passwords
# ili: npm run hash-passwords --prefix server
```

Skripta je idempotentna: već bcrypt retke preskače; ispisuje samo brojače (nikad lozinke ni usernames). Sigurno je pokrenuti ponovno. Svaki tako hashirani korisnik dobiva `must_change_password=1` i mora postaviti novu lozinku pri prvoj prijavi u panel (stranica **Lozinka**). Kiosk prijava/odjava radi i prije promjene.

7. Demo seed baza (ako je sačuvana) može ostati kao `lupriv_new_archive` — ne briši je ako ti treba.

### Odsustva (UI)

U pregledu sati dostupna su i produkcijska: **Odsustvo na zahtjev radnika**, **Službeni put**.  
Plaćena odsustva u izračunu (`hoursCalc.js`) ostaju usklađena s legacy listom (ta dva nisu u `PAID_ABSENCES` osim ako ima `odsustvo_time`).

### Auto-odjava

- **Raspored:** jednom dnevno nakon **23:00** (lokalno vrijeme servera / Europe/Sarajevo). Interni timer u API procesu budi se ~svakih 30 min, ali **izvršava odjavu samo** ako je ≥ 23:00 i još nije odradio taj kalendarski dan.
- **Dnevne smjene** (otvoreni `temp` s početkom **&lt; 20:00**): zatvara se s krajem = **`kraj_rv` poslovnice** (+ `AUTO_LOGOUT_EXTRA_MINUTES`, zadano 0; stari app je imao 60, najviše 23:59) (`hours.branch_id` — ista grana u kojoj je radnik radio tu sesiju; u `radni_sati` isti kalendarski dan, npr. `09:00 16:00`). Napomena `Automatska odjava!`. Ako grana nema valjani `kraj_rv` → fallback **23:00** (broji se u odgovoru `fallbackKraj`).
- **Noćne smjene (start ≥ 20:00), danas:** na runu istog kalendarskog dana **preskaču se** (ostaju otvorene do jutra).
- **Noćne smjene jučer (ili starije):** ako su i dalje otvorene na večernjem runu (≥ 23:00), automatski se zatvaraju s krajem = **`pocetak_rv` poslovnice** (jutro nakon datuma prijave; u `radni_sati` overnight par npr. `22:00 08:00`). Napomena `Automatska odjava (noćna smjena)!`. Ako grana nema valjani `pocetak_rv` → fallback **08:00** (broji se u odgovoru `fallbackPocetak`).
- **Prijava nakon `kraj_rv`** (npr. početak 15:10, `kraj_rv` 14:00): sesija se zatvara s nula sati (`15:10 15:10`) i napomenom `Automatska odjava (prijava nakon kraja RV, provjeriti)!` umjesto ~23 h prekovremenog. Voditelj/admin upisuje stvarno vrijeme.
- Ne koristi se `nocni_rad` flag — samo sat početka (`temp`) + `hours.datum`. Nema splitanja ni automatske prijave sljedeći dan.
- **Zadnji run date** drži se u memoriji procesa. Restart API-ja nakon 23:00 može ponovno odraditi jedan prolaz istog dana — prihvatljivo; po želji kasnije file/DB.
- Kraj dnevne smjene je **`kraj_rv`** (ne `kraj_rv+1h`), osim ako je postavljen `AUTO_LOGOUT_EXTRA_MINUTES`. Nema više 15-min zatvaranja.
- Vanjski cron / ručno: `POST /api/auto-logout/run` (iste A/B/C klasifikacije; dnevni kraj = `kraj_rv`). Zahtijeva `AUTO_LOGOUT_SECRET` (header `X-Auto-Logout-Secret` ili JSON tijelo `{"secret": …}`; query `?secret=` se više ne prihvaća jer završava u logovima). Bez ispravne tajne → 401; ako env nije postavljen → 503.

Primjer:

```bash
curl -X POST -H "X-Auto-Logout-Secret: $AUTO_LOGOUT_SECRET" http://localhost:3001/api/auto-logout/run
```

### Prava i kiosk

- **Voditelj** vidi i uređuje samo zaposlenike poslovnice koju vodi (ili kojoj pripada), ne može mijenjati vlastite sate, a prošli mjesec može mijenjati samo do `HOURS_EDIT_LOCK_DAY`. dana u mjesecu (zadano 5, kao stari app). Admin nema ograničenja.
- Svako dodavanje, uređivanje, brisanje i zaustavljanje sati od strane voditelja/admina zapisuje se u **Logovi** (tko, kome, datum, prije → poslije).
- Korisnik ili poslovnica sa satima ne mogu se obrisati (sati se čuvaju): korisniku se postavlja datum odlaska. Odlazak i promjena uloge vrijede odmah, i za već prijavljene.
- **Kiosk** (`KIOSK_ALLOW_BRANCH_QUERY=0`, produkcija): odabrana poslovnica prihvaća se samo ako je IP uređaja registriran IP te poslovnice. IP se registrira prijavom na stranici **Prijava** s odabranom poslovnicom i „Započni radno vrijeme” (kao u starom appu). S `=1` (dev) vjeruje se odabiru na uređaju.
- Prijava i kiosk: 10 neuspjelih pokušaja po korisniku/IP-u u 15 min → privremena blokada; poruka ne otkriva postoji li korisničko ime.
- `TRUST_PROXY_HOPS`: 1 kad je ispred API-ja samo web nginx, 2 kad je ispred još Caddy (VPS). Pogrešna vrijednost znači krivi IP poslovnice.

### Testovi

```bash
npm test --prefix server   # jedinični testovi (izračun sati, auto-odjava, prava, konfiguracija)
npm run lint
```

### Produkcijski checklist

- [ ] `JWT_SECRET` dug i nasumičan (API se u produkciji ne pokreće sa zadanim tajnama)
- [ ] `AUTO_LOGOUT_SECRET` postavljen
- [ ] `TRUST_PROXY_HOPS=2` iza Caddyja
- [ ] `CORS_ORIGIN=https://your.domain` (VPS)
- [ ] `KIOSK_ALLOW_BRANCH_QUERY=0` (stvarna IP politika početne stranice)
- [ ] Nakon importa dumpa: `npm run hash-passwords` (ili `docker compose exec api npm run hash-passwords`)
- [ ] MySQL/API nisu javno publishani; phpMyAdmin off na VPS-u
- [ ] HTTPS (Caddy) — vidi `deploy/`
- [ ] Ne commitati `.env` / tajne / dump s osobnim podacima u javni repo

Detaljnije: [`deploy/README.md`](deploy/README.md).

---

## Namjerno odgođeno

- Pixel-perfect Blade UI
- Noćna smjena na početnoj stranici preko ponoći (ulog noćnih smjena je na voditelju)

Stari projekt `../lupriv` **nije diran**.
