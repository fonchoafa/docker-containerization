# 1. Containers vs virtual machines, and how Docker is built

## The problem containers solve

"It works on my machine" usually means the app depends on things that only exist on that machine: the Node.js version, system libraries, environment settings. A **container** packs the app together with everything it needs, so it runs the same on your laptop, a teammate's PC and an AWS server.

## Containers vs virtual machines

```
 Virtual machines                         Containers
 +-----+ +-----+ +-----+                  +-----+ +-----+ +-----+
 | App | | App | | App |                  | App | | App | | App |
 | Libs| | Libs| | Libs|                  | Libs| | Libs| | Libs|
 | Guest OS (full)  x3 |                  +-----+-+-----+-+-----+
 +---------------------+                  |   Docker Engine     |
 |     Hypervisor      |                  +---------------------+
 +---------------------+                  |     Host OS kernel  |
 |   Host OS / hardware|                  +---------------------+
 +---------------------+                  |       Hardware      |
                                          +---------------------+
```

| | Virtual machine | Container |
| --- | --- | --- |
| What it virtualizes | A whole computer, including its own OS kernel | Only the app's view of the OS (processes, files, network) |
| Start time | Tens of seconds to minutes | Usually under a second or two |
| Size | Gigabytes | Tens to hundreds of megabytes |
| Isolation | Strong (separate kernel) | Good, but containers **share the host kernel** |
| Good for | Running different operating systems, strong isolation | Packaging and running apps, many small services |

Module 3 used a VM (an EC2 instance). Module 4 runs the same app in a container, and a container can run *on* a VM like that EC2 server.

> On Windows, Docker Desktop runs a small Linux virtual machine (using WSL 2) and your Linux containers run inside it, because containers need a Linux kernel.

## Docker architecture

```
 You type:  docker run ...
      |
      v
 +-------------+   REST API   +----------------------+        +------------------+
 | Docker CLI  | -----------> | Docker daemon        | -----> | Registry         |
 | (docker)    |              | (dockerd)            | pull   | (Docker Hub)     |
 +-------------+              |  manages:            | push   | node, nginx, ... |
                              |  images, containers, | <----- +------------------+
                              |  networks, volumes   |
                              +----------+-----------+
                                         | uses containerd + runc
                                         v
                                  running containers
```

| Piece | What it is |
| --- | --- |
| **Docker CLI** | The `docker` command you type. It only sends requests. |
| **Docker daemon** | The background service (`dockerd`) that builds images and runs containers. |
| **Registry** | A server that stores images. Docker Hub is the default public one. |
| **Image** | A read-only template: the app, its dependencies and its start command. |
| **Container** | A running (or stopped) instance of an image, with a thin writable layer on top. |
| **Volume** | Storage managed by Docker that outlives any single container. |
| **Network** | A virtual network that lets containers talk to each other. |

Image versus container is like **a class versus an object**, or a recipe versus a meal. One image can start many containers.

## Layers and caching

An image is a stack of read-only **layers**, one per Dockerfile instruction. Docker caches each layer. If an instruction and everything above it are unchanged, Docker reuses the cached layer instead of running it again. That is why instruction order matters (see [03](03-dockerfile-networking-volumes-compose.md)).

```
 Container  (writable layer, deleted with the container)
 -------------------------------------------------------
 COPY app code        <- changes often
 RUN npm ci           <- changes when dependencies change
 COPY package*.json
 base image node:22-alpine   <- shared by many images, stored once
```
