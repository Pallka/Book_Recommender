FROM node:20-alpine
# Production image for server.js (see docker-compose app service).
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
