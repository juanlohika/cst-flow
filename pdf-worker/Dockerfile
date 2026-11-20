# PDF Compress Worker (CST OS > AI Tools > PDF Compressor)
# Compresses scanned PDFs with Ghostscript. No AI. See pdf-worker/README.md.
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ghostscript ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "src/server.ts"]
