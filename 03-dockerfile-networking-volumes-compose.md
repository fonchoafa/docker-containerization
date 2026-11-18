# 3. Dockerfile, networking, volumes, environment variables and Compose

Flow for this project: **Source Code → Dockerfile → Image → Container → Docker Compose → Running Application**

```
 app/ (code)                 docker build                 docker compose up
 + app/Dockerfile  ---------------------->  image  ------------------------->  running app
                                       cloud-notes:1.0                          + nginx + network + volume
```

## 1. The Dockerfile, line by line ([app/Dockerfile](../app/Dockerfile))

| Instruction | What it does and why |
| --- | --- |
| `FROM node:22-alpine AS deps` | Start from an official Node.js image. **alpine** is a very small Linux, so the image stays small. `AS deps` names this build stage. |
| `WORKDIR /app` | Sets the folder for the next instructions (created if missing). |
| `COPY package.json package-lock.json ./` | Copies **only** the dependency list first, for caching (see below). |
| `RUN npm ci --omit=dev` | Installs exactly the versions in the lock file, without test/dev tools. |
| `FROM node:22-alpine AS runtime` | A **second, fresh stage**. Only what we copy into it ends up in the final image. |
| `ENV NODE_ENV=production PORT=3000 NOTES_FILE=... UPLOAD_DIR=...` | Default environment variables the app reads. `/data` is where it saves notes and uploads. |
| `COPY --from=deps ... node_modules` | Takes the finished `node_modules` from stage 1. The npm cache and build leftovers stay behind. |
| `COPY server.js lib public` | The app code, copied last because it changes most often. `--chown=node:node` gives the files to the unprivileged user. |
| `RUN mkdir -p /data && chown node:node /data` | Creates the data folder with the right owner, so a volume mounted there is writable. |
| `USER node` | Runs the app as a normal user, not root. |
| `EXPOSE 3000` | Documents the port. It does **not** publish it. |
| `HEALTHCHECK ...` | Every 15 s Docker calls `/health`. Docker shows `healthy` or `unhealthy`, and Compose can wait for it. |
| `CMD ["node", "server.js"]` | The command that starts the container. The JSON (exec) form lets Node receive stop signals directly. |

`.dockerignore` keeps `node_modules`, `.env`, tests and git files **out of the build context**. That makes builds faster and keeps secrets out of the image.

## 2. Dockerfile optimization

| Technique | Where | Benefit |
| --- | --- | --- |
| Small base image (`alpine`) | `FROM` | Smaller download and less to patch |
| Dependencies before code | `COPY package*.json` then `RUN npm ci` | Changing a code file reuses the cached `npm ci` layer |
| `npm ci --omit=dev` | `RUN` | Reproducible install, no dev tools in the image |
| Multi-stage build | two `FROM`s | Final image holds only what runs |
| `.dockerignore` | `app/.dockerignore` | Smaller context, no secrets copied |
| Non-root user | `USER node` | A bug in the app has fewer rights |
| Health check | `HEALTHCHECK` | Docker knows when the app is truly working |

### Compare it yourself

[examples/Dockerfile.naive](../examples/Dockerfile.naive) does the opposite of each row. Build both and fill in your own numbers:

```powershell
docker build -t cloud-notes:1.0 ./app
docker build -f examples/Dockerfile.naive -t cloud-notes:naive ./app
docker images cloud-notes
```

| Image | Size (your result) |
| --- | --- |
| `cloud-notes:naive` | 1.68 GB unpacked (416 MB to download) |
| `cloud-notes:1.0` | 282 MB unpacked (64.7 MB to download) |

The optimized image is about 6 times smaller (measured on my PC with `docker images`).

Then test the cache. Add a blank line to `app/public/style.css` and rebuild both: the optimized one skips `npm ci` ("CACHED" in the output), the naive one reinstalls everything.

## 3. Networking

Compose creates a private **bridge network** called `backend`. Containers on it reach each other by **service name**: nginx calls the app at `http://app:3000`, and Docker's built-in DNS turns `app` into the container's address.

```
 Your PC                       Docker network "backend"
 localhost:8080 ---> [ web: nginx :80 ] ---> [ app: Node :3000 ] ---> volume notes-data (/data)
                       published to PC         NOT published
```

Only nginx has `ports: "8080:80"`. The app uses `expose: 3000`, which is visible to other containers only. So the app cannot be reached from your PC at `localhost:3000`, just as port 3000 was blocked in Module 3.

Prove it:

```powershell
docker network ls
docker network inspect docker-containerization_backend   # Compose names it <folder>_backend, check "docker network ls"
docker exec cloud-notes-web wget -qO- http://app:3000/health   # works: container to container, by name
curl.exe http://localhost:3000/health                          # fails: not published
curl.exe http://localhost:8080/health                          # works: through nginx
```

`TRUST_PROXY=uniquelocal` tells the app to believe the client IP that nginx forwards (`X-Forwarded-For`) because nginx has a private Docker network address.

## 4. Volumes and persistent data

A container's own filesystem is **deleted with the container**. Anything that must survive goes in a **volume**.

| Type | Example | Use |
| --- | --- | --- |
| Named volume | `notes-data:/data` | Data managed by Docker (this project) |
| Bind mount | `./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro` | A file or folder from your PC, here the nginx config as read-only |

The app writes `notes.json` and `uploads/` to `/data`, which is the `notes-data` volume. Prove persistence:

```powershell
# 1. add a note in the browser, then:
docker compose down        # removes the containers and network, KEEPS the volume
docker compose up -d       # new containers, same volume
# 2. refresh the page: the note is still there
docker volume ls
docker compose down -v     # the -v flag deletes the volume; now the data is gone
```

## 5. Environment variables and secrets

| Where | Example | Notes |
| --- | --- | --- |
| Dockerfile `ENV` | `PORT=3000` | Defaults baked into the image. Never put secrets here, because anyone with the image can read them. |
| Compose `environment:` | `TRUST_PROXY: uniquelocal` | Settings for one deployment |
| `.env` file | `ADMIN_KEY=...` | Compose reads it for `${ADMIN_KEY}`. Git-ignored, so it never leaves your PC. |
| `docker run -e` | `-e ADMIN_KEY=test` | One-off values |

Compose refuses to start if `ADMIN_KEY` is missing (`${ADMIN_KEY:?...}`), so you cannot run with an empty key by mistake.

An environment variable is visible with `docker inspect` to anyone who can use Docker on that machine. That is fine for a local demo. For real production secrets use a secrets manager, like the SSM Parameter Store the app uses in Module 3 (the app still supports `SECRET_PARAM_NAME` for that).

## 6. Docker Compose ([docker-compose.yml](../docker-compose.yml))

Compose describes a multi-container app in one file, so one command starts it all.

| Setting | Why |
| --- | --- |
| `build: ./app` | Build the image from `app/Dockerfile` |
| `init: true` | A tiny init process that forwards stop signals and reaps child processes |
| `restart: unless-stopped` | Restart after a crash or a reboot of Docker |
| `depends_on ... service_healthy` | Start nginx only after the app's health check passes |
| `read_only: true` + `tmpfs: /tmp` | The app cannot change its own files; only `/data` and memory-backed `/tmp` are writable |
| `cap_drop: ALL`, `no-new-privileges` | Remove Linux privileges the app does not need |
| `mem_limit: 256m`, `cpus: 0.5` | Resource limits, the Docker version of Module 3's systemd limits |
| `networks: backend` | The private network described above |

## Design choice: notes in a file, not DynamoDB

In Module 3 the notes lived in DynamoDB and uploads in S3. A container on your PC has no AWS credentials, so for this module the app keeps notes in a JSON file (`NOTES_FILE`) and uploads on disk, both inside the volume. The same image can still use AWS: set `TABLE_NAME`, `BUCKET_NAME` and credentials, and the app switches stores. Four new automated tests cover the file store.
