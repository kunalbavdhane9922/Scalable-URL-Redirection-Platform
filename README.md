# Scalable URL Redirection Platform (Distributed URL Shortener)

[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688.svg?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Redis](https://img.shields.io/badge/Redis-7.0+-DC382D.svg?logo=redis)](https://redis.io/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0+-4479A1.svg?logo=mysql)](https://www.mysql.com/)
[![Nginx](https://img.shields.io/badge/Nginx-1.25+-009639.svg?logo=nginx)](https://nginx.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker)](https://www.docker.com/)

A high-performance, distributed backend URL shortening system engineered specifically for read-heavy redirection traffic workloads. The platform converts long URLs into compact Base62 identifiers and serves redirects at ultra-low latency using Redis caching, Nginx load balancing, and horizontally scalable FastAPI instances.

---

## 🏗️ System Architecture

![Scalable URL Redirection System Architecture](./distributed-url-shortener/scalable_url_redirection_system_architecture.svg)

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
- **Dynamic Container Scaling**:
  ```powershell
  docker compose up -d --scale api=3
  ```

---

## 📂 Subdirectories & Workspace Modules

- **[`distributed-url-shortener/`](./distributed-url-shortener)**: Main full-stack FastAPI + Redis + MySQL + Nginx microservice workspace containing source code, Docker configs, and detailed documentation.
  - [Read complete system documentation & deployment guide](./distributed-url-shortener/README.md)
  - [View Product Requirements Document (PRD)](./distributed-url-shortener/PRD%20—%20Scalable%20URL%20Redirection%20Platform.md)

---

## 🛠️ Quick Launch

```powershell
cd distributed-url-shortener
docker compose up -d --scale api=3
```

Visit `http://localhost/docs` to test endpoints via Swagger UI.

---

## 📄 License & Attribution

Architected & built by [Kunal Bavdhane](https://github.com/kunalbavdhane9922) as part of Distributed Backend Systems Engineering.
