# Screenshot checklist

Save each screenshot here with these names. Do not show the contents of `.env` or your admin key.

| File | What to capture |
| --- | --- |
| `01-docker-version.png` | `docker version` and the `docker run hello-world` message |
| `02-image-comparison.png` | `docker images cloud-notes` showing the `naive` and `1.0` images |
| `03-compose-up.png` | `docker compose up -d --build` finished, then `docker compose ps` showing `healthy` |
| `04-app-in-browser.png` | http://localhost:8080 with a note and an attachment |
| `05-networking.png` | `docker exec cloud-notes-web wget -qO- http://app:3000/health` works, `curl.exe http://localhost:3000/health` fails |
| `06-volume-persistence.png` | A note before `docker compose down`, then still there after `up -d` (two shots are fine) |
| `07-logs.png` | `docker compose logs app` with JSON request lines |
| `08-security.png` | `docker exec cloud-notes-app id` (uid=1000 node) and the failed `touch` |
| `09-stats.png` | `docker stats --no-stream` showing the 256 MiB limit |
| `10-smoke-test.png` | The smoke test result, all `[PASS]` |
