# Produkcija / VPS

Croatian ops notes for deploying **lupriv_new** with Docker Compose + optional Caddy HTTPS.

## Lokalno (prod-like)

```bash
cd /path/to/lupriv_new
# Ensure `.env` has strong JWT_SECRET / AUTO_LOGOUT_SECRET (see `.env.docker.example`)
npm run docker:up          # mysql + api + web (no phpMyAdmin, MySQL not on host ports)
# first time / empty DB only:
npm run docker:seed
```

- Web: http://localhost:8080  
- API only via nginx `/api/` (not published on host)  
- Stop app containers: `npm run docker:down` (MySQL stays up)  
- Stop all (keep volume): `docker compose stop`  
- **Never** `docker compose down -v` if you need the data

### Host npm + Docker MySQL (dev)

```bash
npm run db:up              # mysql:3307 + phpMyAdmin:8082 (docker-compose.dev.yml)
npm run dev
```

Full stack with debug ports (API :3001, MySQL :3307, PMA :8082):

```bash
npm run docker:up:dev
```

## VPS (kratki postupak)

1. **Kopiraj projekt** (`rsync` / `git clone` / scp). Ne commitaj `.env` ni dumpe s PII.
2. **`.env`** — kopiraj iz `.env.docker.example`, postavi jake tajne, `CORS_ORIGIN=https://tvoja.domena`, `KIOSK_ALLOW_BRANCH_QUERY=0`.
3. **Pokreni stack:**
   ```bash
   docker compose up --build -d
   ```
4. **Import produkcijskog dumpa** (ako treba), zatim hash lozinki:
   ```bash
   docker compose exec -T mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" lupriv_new < databases/your_dump.sql
   docker compose exec api npm run hash-passwords
   ```
5. **DNS** A/AAAA → VPS IP.
6. **HTTPS** — host Caddy (preporučeno) s `deploy/Caddyfile.example` (`reverse_proxy localhost:8080`), ili `deploy/docker-compose.caddy.yml` uz Caddyfile koji proxyja na `web:80`.
7. **Firewall** — otvori 80/443; ne izlaži 3306/3001 javno.

## Backup

```bash
docker compose exec -T mysql mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines lupriv_new \
  > backup_lupriv_$(date +%F).sql
```

## Checklist

- [ ] `JWT_SECRET` / `AUTO_LOGOUT_SECRET` jaki i jedinstveni
- [ ] `CORS_ORIGIN=https://your.domain`
- [ ] `KIOSK_ALLOW_BRANCH_QUERY=0`
- [ ] MySQL nije publishan na 0.0.0.0 (default compose)
- [ ] phpMyAdmin nije pokrenut na VPS-u
- [ ] Nakon dump importa: `hash-passwords`
- [ ] Caddy/Let's Encrypt radi; HTTP→HTTPS
- [ ] Periodični `mysqldump` + offsite kopija
