FROM node:20-alpine

# Run as non-root
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js dashboard.js index.html ./
COPY config.example.json ./config.json

RUN chown -R app:app /app
USER app

EXPOSE 5190

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:5190/health || exit 1

CMD ["node", "server.js"]
