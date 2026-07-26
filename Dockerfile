# Build Smash OS ISO inside Linux (no Windows path).
# Usage:
#   docker build -t smashos-builder .
#   docker run --rm -v "%cd%/dist:/src/dist" smashos-builder
FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    live-build debootstrap squashfs-tools xorriso isolinux syslinux-common \
    rsync git ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . /src

RUN chmod +x build/build-iso.sh build/install-overlay.sh build/hooks/01-smashos.chroot \
    tools/pipeline/smash tools/hub/smash-hub || true

CMD ["./build/build-iso.sh"]
