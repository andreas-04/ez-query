FROM node:20-alpine
WORKDIR /app
COPY gateway/package.json gateway/package-lock.json* ./
RUN npm install
COPY gateway/ .
CMD ["npx", "tsx", "src/tui.ts"]
