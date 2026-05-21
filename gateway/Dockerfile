FROM node:20-alpine
WORKDIR /app

# Proto files must live at /app/proto so that clients.ts can resolve them:
# __dirname is /app/gateway/src → path.resolve(__dirname, "../../proto") = /app/proto
COPY proto/ ./proto/

WORKDIR /app/gateway
COPY gateway/package.json gateway/package-lock.json* ./
RUN npm install
COPY gateway/ .

EXPOSE 3000
CMD ["npx", "tsx", "src/gateway/server.ts"]
