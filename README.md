# Scalable URL Redirection Platform (Distributed Shortener)

[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688.svg?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Redis](https://img.shields.io/badge/Redis-7.0+-DC382D.svg?logo=redis)](https://redis.io/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0+-4479A1.svg?logo=mysql)](https://www.mysql.com/)
[![Nginx](https://img.shields.io/badge/Nginx-1.25+-009639.svg?logo=nginx)](https://nginx.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker)](https://www.docker.com/)

A high-performance, distributed backend URL shortening system engineered specifically for read-heavy redirection traffic workloads. The platform converts long URLs into compact Base62 identifiers and serves redirects at ultra-low latency using Redis caching, Nginx load balancing, and horizontally scalable FastAPI instances.

---

## 🏗️ System Architecture

The service isolates redirect read paths from administrative write paths, ensuring that database load remains bounded even under extreme traffic spikes.

![Scalable URL Redirection System Architecture](./scalable_url_redirection_system_architecture.svg)

---

## 🚀 Key Engineering & Architecture Highlights

### 1. Base62 Identifier Generation
- Converts monotonic numeric database primary keys directly into compact `[0-9a-zA-Z]` strings.
- Guarantees deterministic, collision-free short code creation without expensive database collision check loops.

### 2. Multi-Layer Caching Strategy (Cache-Aside Pattern)
- **Hot Key Acceleration**: Frequently accessed short codes (`url:{shortCode}`) are cached in Redis with a configurable TTL (e.g., 1 hour), bypassing MySQL entirely.
- **Negative Caching**: Non-existent code lookups (`missing:{shortCode}`) are cached for 30–60 seconds to protect MySQL from malicious or repeating 404 scanning attacks.
- **Cache Fallback Engine**: If Redis encounters an outage, requests fall back seamlessly to MySQL without breaking redirect operations.

### 3. High Availability & Horizontal Scaling
- **Stateless API Layer**: FastAPI instances hold zero local session state.
- **Nginx Reverse Proxy**: Performs round-robin load balancing and upstream health monitoring across scaled API containers.
- **Dynamic Container Scaling**: Easily scale up instances using Docker Compose:
  ```powershell
  docker compose up -d --scale api=3
  ```

### 4. Non-Blocking Asynchronous Analytics
- Redirect responses (`HTTP 302 Found`) return immediately to the client without waiting for database writes.
- Analytics events (click count, referrer, timestamp, user-agent) are pushed to background queues for batch insertion into MySQL.

---

## 📂 Repository Layout

```text
distributed-url-shortener/
├── app/
│   ├── api/                # FastAPI router endpoints & dependency injectors
│   ├── core/               # Configuration, security, & Base62 encoders
│   ├── db/                 # MySQL database sessions, models, & alembic migrations
│   ├── services/           # Cache-aside url_service, redirect_service, analytics_service
│   └── main.py             # FastAPI application entrypoint
├── docker/
│   ├── Dockerfile          # Multi-stage production Python container image
│   └── docker-compose.yml  # Nginx, FastAPI cluster, Redis, & MySQL orchestration
├── nginx/
│   └── nginx.conf          # Load balancer & upstream proxy configuration
├── PRD — Scalable URL Redirection Platform.md  # Complete Product Requirements Document
├── scalable_url_redirection_system_architecture.svg # Architectural Diagram
├── requirements.txt
└── README.md
```

---

## 📊 Database Schema & Indexing

The primary `urls` MySQL table enforces absolute uniqueness through primary/unique keys:

```sql
CREATE TABLE urls (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    short_code VARCHAR(16) NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE INDEX idx_short_code (short_code),
    INDEX idx_expires_at (expires_at)
);
```

---

## 📡 API Reference

### 1. Create Short URL
```http
POST /api/v1/urls
Content-Type: application/json

{
  "url": "https://example.com/long/path/software-engineering",
  "expiresAt": "2027-12-31T23:59:59Z"
}
```

**Response (HTTP 201 Created)**:
```json
{
  "shortCode": "d3K",
  "shortUrl": "http://localhost/d3K",
  "originalUrl": "https://example.com/long/path/software-engineering",
  "expiresAt": "2027-12-31T23:59:59Z"
}
```

### 2. Redirect to Original Destination
```http
GET /{shortCode}
```
**Response**: `HTTP 302 Found` with `Location` header set to original target URL.

### 3. Deactivate Short URL
```http
DELETE /api/v1/urls/{shortCode}
```
**Response**: `HTTP 200 OK` (Soft deactivates record in MySQL and immediately invalidates Redis cache key).

---

## 🛠️ Local Development & Deployment

### Quick Start with Docker Compose

1. **Clone & Navigate**:
   ```powershell
   git clone https://github.com/kunalbavdhane9922/Scalable-URL-Redirection-Platform.git
   cd Scalable-URL-Redirection-Platform
   ```

2. **Launch Container Services**:
   ```powershell
   docker compose up -d
   ```

3. **Verify API & Health Checks**:
   - Nginx Proxy: `http://localhost:80`
   - Interactive API Documentation (Swagger): `http://localhost:80/docs`
   - Health Endpoint: `http://localhost:80/health`

4. **Scale API Nodes**:
   ```powershell
   docker compose up -d --scale api=3
   ```

---

## 📈 Performance & Load Testing

The platform has been benchmarked using **k6** and **Locust**:
- **Redirect Cache Hit Latency**: `< 3ms` (p95)
- **Throughput**: `> 10,000 requests/sec` across 3 scaled API instances with Redis caching.

---

## 📄 License & Attribution

Architected & built by [Kunal Bavdhane](https://github.com/kunalbavdhane9922) as part of Distributed Backend Systems Engineering.
