# 4. Run guide (Windows)

## Before you start

1. **Install Docker Desktop**: https://www.docker.com/products/docker-desktop/ . Accept the default **WSL 2** option, restart if asked.
2. Open **Docker Desktop** and wait until it says **Engine running** (bottom-left, green).
3. Check in PowerShell:
   ```powershell
   docker version
   docker compose version
   ```
   Both must print a Client and a Server version.

If Docker Desktop refuses to start, virtualization may be off in your BIOS (look for "Intel VT-x" or "SVM Mode"), or WSL needs updating: `wsl --update`.

## Step 1: test the code without Docker (optional)

```powershell
cd app
npm install
npm test            # 11 tests should pass
cd ..
```

## Step 2: add the admin key

```powershell
copy .env.example .env
code .env            # set ADMIN_KEY to your own long random value
```

## Step 3: build and run

```powershell
docker compose up -d --build
docker compose ps
```

The first build downloads the Node and nginx images and takes a few minutes. Expect two services, `cloud-notes-app` (State `running`, Status `healthy`) and `cloud-notes-web` (`running`, port `8080->80`).

Open **http://localhost:8080**, add a note and attach a small image.

## Step 4: verify every part

```powershell
.\scripts\smoke-test.ps1                                   # automated checks
.\scripts\smoke-test.ps1 -AdminKey (Get-Content .env | Select-String ADMIN_KEY).Line.Split('=')[1]   # also tests the protected delete
docker compose logs app                                    # JSON log lines
docker exec cloud-notes-app id                             # uid=1000(node): not root
docker exec cloud-notes-app sh -c "touch /app/x"           # fails: read-only file system
docker stats --no-stream                                   # MEM LIMIT 256MiB for the app
```

Then do the networking and volume experiments in [03](03-dockerfile-networking-volumes-compose.md) (sections 3 and 4), and the naive-versus-optimized image comparison (section 2).

## Step 5: evidence

Save screenshots into `screenshots/` using the names in [../screenshots/README.md](../screenshots/README.md). Never show the contents of `.env`.

## Step 6: push to GitHub and submit

```powershell
git init
git add .
git status           # make sure .env and node_modules are NOT listed
git commit -m "Module 4: Dockerized Cloud Notes with Compose"
git branch -M main
git remote add origin https://github.com/fonchoafa/docker-containerization.git
git push -u origin main
```

Create the empty **public** repository `docker-containerization` on GitHub first. On the portal, submit the repo link and your LinkedIn post link.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `error during connect` / `cannot find the file specified` | Docker Desktop is not running | Start Docker Desktop, wait for "Engine running" |
| `required variable ADMIN_KEY is missing` | No `.env` file | `copy .env.example .env` and set the value |
| `port is already allocated` on 8080 | Something else uses 8080 | Change `"8080:80"` to `"8090:80"` in the compose file |
| App shows `unhealthy` | The app crashed at start | `docker compose logs app` |
| `502 Bad Gateway` | App not ready or stopped | `docker compose ps`, then `docker compose logs app` |
| Build cannot download images or packages | Network, VPN or proxy problem | Retry; check your connection and Docker Desktop proxy settings |
| Changes to code not showing | Old image in use | `docker compose up -d --build` |
| `permission denied` writing to `/data` | Volume created by an older image | `docker compose down -v`, then `up` again (this deletes the data) |

## Clean up

```powershell
docker compose down -v      # remove containers, network AND the data volume
docker image prune -a       # remove unused images (frees disk space)
```
