FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server/main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /server /server
ENTRYPOINT ["/server"]
