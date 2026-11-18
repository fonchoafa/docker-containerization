# 2. Docker commands, step by step

Run these in PowerShell after installing Docker Desktop (see [04-run-guide.md](04-run-guide.md)). They are ordered so each step builds on the last. Try them yourself and take the screenshots listed in [../screenshots/README.md](../screenshots/README.md).

## A. Check the install

```powershell
docker version          # shows the Client AND the Server (daemon). If Server is missing, Docker Desktop is not running.
docker run hello-world  # downloads a tiny image, runs it once, prints a welcome message
```

## B. Images

```powershell
docker pull nginx:1.27-alpine   # download an image from Docker Hub (name:tag)
docker images                   # list local images (REPOSITORY, TAG, SIZE)
docker image inspect nginx:1.27-alpine   # details: layers, environment, default command
docker history nginx:1.27-alpine         # the layers and the instruction that made each
```

A **tag** (the part after `:`) picks a version. `latest` is just a default name, not a promise of "newest". Pin real versions.

## C. Containers

```powershell
docker run -d --name web -p 8081:80 nginx:1.27-alpine
```

| Part | Meaning |
| --- | --- |
| `-d` | detached: run in the background |
| `--name web` | a name you choose, instead of a random one |
| `-p 8081:80` | publish: PC port **8081** goes to container port **80** |
| `nginx:1.27-alpine` | the image to start |

Open http://localhost:8081 to see nginx's welcome page. Then:

```powershell
docker ps                 # running containers  (docker ps -a  also shows stopped ones)
docker logs web           # what the container printed (add -f to follow live)
docker exec -it web sh    # open a shell INSIDE the container; type exit to leave
docker stats --no-stream  # CPU and memory use per container
docker inspect web        # full JSON: IP address, mounts, environment
docker stop web           # graceful stop (sends SIGTERM, then SIGKILL after 10 s)
docker start web          # start the same container again
docker rm -f web          # delete it (-f also stops it if running)
```

## D. Cleaning up

```powershell
docker rmi nginx:1.27-alpine   # delete an image (no container may use it)
docker system df               # how much space images, containers and volumes use
docker image prune             # delete unused ("dangling") images
docker container prune         # delete all stopped containers
```

`docker system prune -a --volumes` deletes everything unused, **including volumes with data**. Read the prompt before typing `y`.

## E. The project's commands

```powershell
# build an image from app/Dockerfile and name it
docker build -t cloud-notes:1.0 ./app

# run it by itself (no nginx): -e sets an environment variable, -v mounts a named volume
docker run -d --name notes-solo -p 3000:3000 -e ADMIN_KEY=my-test-key -v notes-solo-data:/data cloud-notes:1.0
docker rm -f notes-solo

# the normal way: Compose starts everything described in docker-compose.yml
docker compose up -d --build   # build images if needed, create the network and volume, start the services
docker compose ps              # state of each service (look for "healthy")
docker compose logs -f app     # follow the app's logs
docker compose restart app     # restart one service
docker compose down            # stop and remove containers and the network (the volume is kept)
docker compose down -v         # ... and also delete the data volume
```

## Practice questions (answer these in your own notes)

1. What is the difference between `docker stop` and `docker rm`?
2. If you delete a container, what happens to files written inside it? What if they were written to a mounted volume?
3. Why does `docker run -p 8081:80` need two port numbers?
