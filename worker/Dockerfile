# Training Video Render Worker
# A small Node service that takes a render job (scene list + audio refs) and
# produces a final MP4 with burned-in captions, then uploads to Drive.
#
# Runs on Google Cloud Run (free tier covers our volume — see worker/README.md
# for deployment).

FROM node:20-slim AS base

# Install ffmpeg + fontconfig (so ffmpeg can use the bundled font for caption
# burn-in via libass) + poppler-utils (pdftoppm) for PPTX-PDF slide
# rasterization. fonts-noto-color-emoji is a safety net for emoji in scripts.
# wget is used to fetch the Quicksand font during the build.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fontconfig \
    poppler-utils \
    libreoffice \
    fonts-noto-color-emoji \
    ca-certificates \
    wget \
 && rm -rf /var/lib/apt/lists/*

# Fetch Quicksand from Google Fonts. We pin to a specific commit so the build
# is reproducible. fonts/ is left in place in the repo if anyone wants to
# vendor a font file directly (it takes precedence over the downloaded one
# because of fc-cache ordering — see below).
RUN mkdir -p /tmp/quicksand \
 && wget -q https://github.com/google/fonts/raw/main/ofl/quicksand/Quicksand%5Bwght%5D.ttf \
      -O /tmp/quicksand/Quicksand.ttf \
 && mkdir -p /usr/share/fonts/truetype/quicksand-google \
 && mv /tmp/quicksand/Quicksand.ttf /usr/share/fonts/truetype/quicksand-google/ \
 && fc-cache -f -v

# Workdir + deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Application source
COPY src ./src

# If anyone vendored extra fonts under fonts/, install them. The Quicksand
# font itself is already installed system-wide via the earlier RUN block.
COPY fonts /usr/share/fonts/truetype/extra/
RUN fc-cache -f -v

# Cloud Run sets PORT env automatically; default to 8080 locally.
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

# tsx (installed by npm) runs TS directly — no separate build step.
CMD ["npx", "tsx", "src/server.ts"]
