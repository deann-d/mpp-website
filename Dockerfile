# ==============================================
# Dockerfile — MPP Website + API
# Deploy ke: VPS, Railway, Render, Fly.io, GCP, AWS ECS
# ==============================================
FROM node:20-alpine

WORKDIR /app

# Tidak ada dependensi npm — salin seluruh proyek
COPY package.json ./
COPY server ./server
COPY database ./database
COPY api ./api
COPY public ./public
COPY vercel.json netlify.toml ./

# Data pendaftaran disimpan di volume agar persisten
RUN mkdir -p /app/server/data
VOLUME ["/app/server/data"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server/index.js"]
