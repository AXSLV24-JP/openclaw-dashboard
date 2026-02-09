FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY server.js index.html ./
COPY config.example.json ./config.json

EXPOSE 5190

CMD ["node", "server.js"]
