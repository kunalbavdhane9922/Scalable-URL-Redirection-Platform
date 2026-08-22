# Product Requirements Document

## Scalable URL Redirection Platform

**Version:** 1.0  
**Type:** Backend / Distributed Systems / Full-Stack Software Engineering Project

**Tech Stack:** FastAPI, MySQL, SQLAlchemy, Redis, Docker, Nginx

---

# 1. Product Overview

The **Scalable URL Redirection Platform** is a backend-focused URL shortening service that converts long URLs into compact, unique short links and redirects users to the original destination with low latency.

The system is designed around the read-heavy nature of URL redirection. Since redirect requests can significantly outnumber URL-creation requests, the architecture prioritizes:

- Fast redirect lookup
- Redis caching
- Efficient MySQL indexing
- Stateless API instances
- Horizontal scaling through Nginx
- Rate limiting
- URL expiration
- Click analytics
- Reliable identifier generation

The project is intended to demonstrate practical backend and distributed-systems engineering rather than simply implementing CRUD endpoints.

---

# 2. Problem Statement

Long URLs are inconvenient to share and can expose unnecessary query parameters or tracking information.

The platform should provide a short, stable identifier:

```text
https://short.example/a8Kp2x
```

which redirects to:

```text
https://www.example.com/products/software-engineering-course?campaign=summer
```

The critical engineering challenge is maintaining low redirect latency while supporting high read volume and keeping the database from becoming the bottleneck.

---

# 3. Goals

The system should:

- Generate unique short URLs.
- Redirect users with minimal latency.
- Cache frequently accessed mappings in Redis.
- Persist URL mappings in MySQL.
- Use optimized indexes for lookup operations.
- Support URL expiration.
- Record redirect analytics.
- Implement abuse/rate protection.
- Remain stateless at the API layer.
- Support horizontal API scaling behind Nginx.
- Be containerized using Docker.
- Be benchmarked under realistic load.

---

# 4. Non-Goals

The first version does not need:

- User-generated custom domains
- Complex marketing attribution
- Full enterprise billing
- Multi-region deployment
- Kubernetes
- Microservices

Do not add these merely to make the architecture look impressive. They increase complexity without improving the engineering signal of this project.

---

# 5. Target Users

Primary users:

- Developers
- Students
- Small teams
- Applications requiring compact URLs

Example use cases:

```text
Share long URLs through messaging
Generate compact links for applications
Track link usage
Create temporary links
Embed short links in websites
```

---

# 6. Core User Flow

## URL Creation

```text
Client
  ↓
POST /api/v1/urls
  ↓
Validate URL
  ↓
Generate unique identifier
  ↓
Store mapping in MySQL
  ↓
Return short URL
```

Example:

```json
{
  "originalUrl": "https://example.com/very/long/url",
  "shortCode": "a8Kp2x",
  "shortUrl": "https://short.example/a8Kp2x"
}
```

---

# 7. Redirect Flow

Redirect is the most latency-sensitive operation.

```text
Browser
   ↓
GET /a8Kp2x
   ↓
Nginx
   ↓
FastAPI
   ↓
Redis lookup
   ↓
 ┌───────────────┐
 │ Cache Hit?    │
 └──────┬────────┘
      Yes│        │No
         ↓        ↓
      Original   MySQL
        URL        ↓
         ↓      Redis SET
         │        ↓
         └────────┘
              ↓
        HTTP 301/302
              ↓
      Original URL
```

The redirect path should avoid unnecessary database access on cache hits.

---

# 8. URL Creation API

### Endpoint

```text
POST /api/v1/urls
```

### Request

```json
{
  "url": "https://example.com/some/long/path",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

### Response

```json
{
  "shortCode": "a8Kp2x",
  "shortUrl": "https://short.example/a8Kp2x",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

---

# 9. URL Validation

The API must validate:

- URL syntax
- Supported protocols
- Maximum URL length
- Malformed input

Initially support:

```text
http://
https://
```

Reject malformed URLs before writing to the database.

---

# 10. Short-Code Generation

The system uses a numeric identifier encoded using **Base62**.

Character set:

```text
0-9
a-z
A-Z
```

Example:

```text
Database ID: 12582
        ↓
Base62 encoding
        ↓
Short code: d3K
```

This provides compact identifiers using only URL-safe characters.

---

# 11. Uniqueness Requirement

Short codes must be unique.

The database should enforce uniqueness through a primary/unique constraint rather than relying exclusively on application logic.

Example:

```text
id                BIGINT PRIMARY KEY
short_code        VARCHAR(16) UNIQUE
original_url      TEXT
created_at        DATETIME
expires_at        DATETIME NULL
```

This creates a final correctness boundary against duplicate codes.

---

# 12. Identifier Generation Strategy

The service should generate identifiers using a monotonic numeric ID and encode that value using Base62.

Example:

```text
ID
 ↓
Base62 Encoder
 ↓
Short Code
```

Advantages:

- Deterministic
- Compact
- Fast
- No collision search loop
- Easy to implement

However, raw sequential IDs can expose creation volume.

For this project, that trade-off should be documented rather than pretending Base62 itself provides randomness.

---

# 13. Database Design

Primary table:

```text
urls
```

Schema:

```text
id
short_code
original_url
created_at
expires_at
is_active
```

Optional analytics fields should not be placed directly into the hot URL table when they would create unnecessary write contention.

---

# 14. Database Indexing

Redirect requests primarily search by short code.

Therefore:

```text
UNIQUE INDEX(short_code)
```

must exist.

Additional indexes:

```text
INDEX(created_at)
INDEX(expires_at)
```

should only be retained if actual queries require them.

The project should document the query pattern behind every important index.

---

# 15. Redirect Service

### Endpoint

```text
GET /{shortCode}
```

Lookup sequence:

```text
shortCode
    ↓
Redis
    ↓
Cache Hit
    ↓
Return redirect

Cache Miss
    ↓
MySQL
    ↓
Check active / expiration
    ↓
Populate Redis
    ↓
Return redirect
```

---

# 16. Redirect Status Code

Use:

```text
302 Found
```

for the default implementation.

This avoids permanently caching the redirect in clients and makes URL lifecycle changes easier to support.

A configurable `301` mode can be considered later.

---

# 17. Redis Cache

Redis should store:

```text
shortcode → original URL
```

Example:

```text
url:a8Kp2x
      ↓
https://example.com/...
```

Possible value:

```json
{
  "url": "https://example.com/product/123",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

---

# 18. Cache Strategy

Use **cache-aside**.

### Read

```text
Request
  ↓
Redis GET
  ↓
Hit → Return
  ↓
Miss
  ↓
MySQL
  ↓
Redis SET
  ↓
Return
```

### Write

```text
Create URL
  ↓
MySQL INSERT
  ↓
No cache required initially
```

### Delete / Disable

```text
Disable URL
  ↓
MySQL UPDATE
  ↓
Redis DEL
```

Explicit invalidation is required to avoid serving disabled links.

---

# 19. Cache TTL

Redis entries should have a TTL.

Example:

```text
TTL = 1 hour
```

The exact value should be benchmarked against:

- Memory usage
- Hit rate
- Database load
- URL access distribution

Do not choose a TTL simply because "one hour sounds scalable."

---

# 20. Hot URL Protection

A small number of URLs may receive disproportionately high traffic.

For popular links:

```text
Millions of redirects
        ↓
Redis
        ↓
MySQL largely bypassed
```

This protects MySQL from becoming the bottleneck for hot keys.

---

# 21. Cache Failure Behavior

Redis is an optimization, not the source of truth.

If Redis becomes unavailable:

```text
Redis failure
    ↓
Fallback to MySQL
    ↓
Serve redirect
```

The API should not fail completely merely because the cache is unavailable.

This is an important reliability characteristic.

---

# 22. Negative Caching

Repeated requests for nonexistent short codes can also overload the database.

Example:

```text
GET /doesNotExist
```

The system can temporarily cache negative lookups:

```text
missing:a8Kp2x → NOT_FOUND
TTL = 30–60 seconds
```

This prevents repeated invalid requests from continuously reaching MySQL.

---

# 23. URL Expiration

Users can specify an optional expiration date.

Example:

```text
expiresAt = 2026-12-31
```

Redirect logic:

```text
Lookup URL
   ↓
Expired?
  ↙     ↘
Yes      No
 ↓        ↓
404      Redirect
```

Expired URLs should not be returned as valid redirects.

---

# 24. URL Deactivation

An application or authenticated owner may disable a URL.

Example:

```text
DELETE /api/v1/urls/{shortCode}
```

Instead of necessarily deleting the record physically:

```text
is_active = false
```

can preserve historical information.

Redis must be invalidated immediately.

---

# 25. Analytics

Track redirect activity separately from the primary URL record.

Possible analytics data:

```text
shortCode
timestamp
status
referrer
userAgent
IP-derived metadata
```

Do not make the redirect request wait on expensive analytics writes.

---

# 26. Asynchronous Analytics

The redirect path should remain lightweight.

Instead of:

```text
Redirect request
    ↓
Write analytics to MySQL
    ↓
Redirect
```

prefer:

```text
Redirect request
    ↓
Return redirect
    ↓
Background analytics processing
```

For the initial implementation, analytics can be recorded asynchronously through a lightweight background mechanism.

The architecture should leave room for introducing a dedicated queue later without redesigning the redirect API.

---

# 27. Rate Limiting

Protect API endpoints from abuse.

Suggested initial limits:

```text
URL creation:
20 requests/minute/IP

Redirect requests:
High threshold / configurable

Delete operations:
10 requests/minute/user
```

Redis can be used to maintain rate-limit counters.

Example:

```text
rate:{ip}:{minute}
```

The exact limits should be tuned after load testing.

---

# 28. API Statelessness

FastAPI application instances must not maintain user/session state locally.

```text
              Nginx
            /   |   \
           /    |    \
       API-1  API-2  API-3
          \      |     /
           \     |    /
             Redis
               |
             MySQL
```

Any instance should be able to handle any request.

This enables horizontal scaling.

---

# 29. Nginx Reverse Proxy

Nginx sits in front of FastAPI instances.

Responsibilities:

- Request routing
- Load balancing
- Connection handling
- Basic protection
- Health-aware upstream configuration

Example:

```text
Client
  ↓
Nginx
 ├── FastAPI-1
 ├── FastAPI-2
 └── FastAPI-3
```

The load-balancing strategy can initially use round-robin.

---

# 30. Docker Architecture

Docker Compose should run:

```text
docker-compose
│
├── nginx
│
├── api-1
│
├── api-2
│
├── mysql
│
└── redis
```

The API container should remain stateless.

Scaling example:

```text
docker compose up --scale api=3
```

This demonstrates horizontal scaling without modifying application code.

---

# 31. Backend Architecture

Recommended structure:

```text
backend/
│
├── app/
│   ├── api/
│   │   ├── routes/
│   │   └── dependencies/
│   │
│   ├── services/
│   │   ├── url_service.py
│   │   ├── redirect_service.py
│   │   ├── analytics_service.py
│   │   └── rate_limit_service.py
│   │
│   ├── repositories/
│   │   └── url_repository.py
│   │
│   ├── models/
│   ├── schemas/
│   ├── cache/
│   ├── core/
│   └── main.py
│
├── tests/
├── Dockerfile
└── requirements.txt
```

Business logic should not be implemented directly in FastAPI route handlers.

Target dependency flow:

```text
Route
  ↓
Service
  ↓
Repository
  ↓
MySQL
```

with Redis accessed through a dedicated cache abstraction.

---

# 32. API Endpoints

## Create URL

```text
POST /api/v1/urls
```

## Get URL Metadata

```text
GET /api/v1/urls/{shortCode}
```

## Delete / Disable URL

```text
DELETE /api/v1/urls/{shortCode}
```

## Redirect

```text
GET /{shortCode}
```

## Health Check

```text
GET /health
```

## Metrics

```text
GET /metrics
```

---

# 33. Error Handling

Use a consistent response format.

Example:

```json
{
  "error": {
    "code": "URL_NOT_FOUND",
    "message": "The requested short URL does not exist",
    "requestId": "req_71ac21"
  }
}
```

Common errors:

```text
INVALID_URL
URL_NOT_FOUND
URL_EXPIRED
URL_DISABLED
RATE_LIMITED
INTERNAL_ERROR
```

Internal stack traces must never be returned to clients in production.

---

# 34. Observability

Track:

```text
Request count
Redirect latency
Create latency
Redis hit rate
Redis failures
MySQL query latency
HTTP error rate
Rate-limit violations
Active API instances
```

Important metrics:

```text
redirect_p50
redirect_p95
redirect_p99

redis_hit_rate

mysql_query_latency

requests_per_second

error_rate
```

Every request should carry a request ID for debugging.

---

# 35. Reliability Requirements

The platform should remain operational when non-critical dependencies fail.

### Redis Failure

```text
Redis unavailable
        ↓
MySQL fallback
        ↓
Redirect still works
```

### MySQL Failure

For uncached URLs:

```text
Redis miss
   ↓
MySQL unavailable
   ↓
Return controlled 503
```

Do not return incorrect redirects.

---

# 36. Concurrency and Race Conditions

URL creation must handle concurrent requests safely.

Example:

```text
Request A → generate ID
Request B → generate ID
```

Both must receive unique short codes.

The database uniqueness constraint is the final correctness guarantee.

Creation logic must avoid assuming that checking for uniqueness before insertion is sufficient.

---

# 37. Testing Strategy

## Unit Tests

Test:

- Base62 encoding
- Base62 decoding
- URL validation
- Expiration logic
- Cache key generation
- Rate-limit calculations

## Integration Tests

Test:

- MySQL persistence
- Redis cache behavior
- Cache miss/hit
- Cache invalidation
- Expiration
- Deactivation

## API Tests

Test complete flows:

```text
Create URL
   ↓
Retrieve short URL
   ↓
Redirect
   ↓
Cache hit
   ↓
Disable
   ↓
Redirect rejected
```

---

# 38. Load Testing

The system should be benchmarked rather than making theoretical scalability claims.

Use **k6** or a similar tool.

Test:

```text
100 concurrent users
250 concurrent users
500 concurrent users
1000 concurrent users
```

Important scenarios:

### Redirect-Heavy Test

```text
95% GET redirects
5% URL creation
```

This resembles a realistic read-heavy workload.

Measure:

```text
Requests/sec
p50 latency
p95 latency
p99 latency
Error rate
Redis hit rate
MySQL CPU/load
```

---

# 39. Benchmark Comparison

Run tests with:

### Without Redis

```text
Client
 ↓
Nginx
 ↓
FastAPI
 ↓
MySQL
```

Then:

### With Redis

```text
Client
 ↓
Nginx
 ↓
FastAPI
 ↓
Redis
 ↓
MySQL only on cache miss
```

Report the measured improvement.

A strong project report could state:

> Redis reduced median redirect latency from X ms to Y ms while reducing database query volume by Z%.

Only use actual measured values.

---

# 40. Horizontal Scaling Experiment

Benchmark:

```text
1 API instance
2 API instances
3 API instances
```

Compare throughput and latency.

Example result format:

```text
Instances   Throughput     P95
1           X req/s        Y ms
2           X req/s        Y ms
3           X req/s        Y ms
```

This validates whether Nginx-based horizontal scaling actually improves throughput.

---

# 41. Security

Implement:

- Input validation
- Rate limiting
- Secure HTTP headers
- CORS configuration
- Environment-based secrets
- SQLAlchemy parameterized queries
- Maximum URL length
- Abuse protection

Avoid logging sensitive URL data unnecessarily.

---

# 42. System Architecture

Target architecture:

```text
                         ┌───────────────┐
                         │    Client     │
                         └───────┬───────┘
                                 │
                                HTTP
                                 │
                         ┌───────▼───────┐
                         │    Nginx      │
                         │ Reverse Proxy │
                         └───┬─────┬─────┘
                             │     │
                 ┌───────────┘     └───────────┐
                 ▼                             ▼
          ┌────────────┐                ┌────────────┐
          │ FastAPI #1 │                │ FastAPI #2 │
          └─────┬──────┘                └──────┬─────┘
                │                              │
                └──────────────┬───────────────┘
                               │
                     ┌─────────▼─────────┐
                     │       Redis       │
                     │ Cache + RateLimit │
                     └─────────┬─────────┘
                               │
                         Cache Miss
                               │
                     ┌─────────▼─────────┐
                     │      MySQL        │
                     │ Persistent Store  │
                     └───────────────────┘

                        Background
                       Analytics Path
                              │
                              ▼
                     Analytics Processor
                              │
                              ▼
                            MySQL
```

---

# 43. Key Engineering Decisions

The project should document why each component exists.

| Component | Responsibility |
|---|---|
| FastAPI | Stateless API and redirect service |
| Nginx | Reverse proxy and load balancing |
| Redis | Hot URL cache and rate limiting |
| MySQL | Persistent source of truth |
| SQLAlchemy | Database abstraction |
| Docker | Reproducible environment and service isolation |

---

# 44. Performance Targets

Initial engineering targets:

```text
Redirect p95:
< 100 ms

Cached redirect:
significantly faster than uncached lookup

Error rate:
< 1% under expected load

Cache hit rate:
> 90% for hot-link benchmark

Database:
No full-table scans on redirect path
```

These are engineering targets, not claims. Final resume numbers must come from actual tests.

---

# 45. Resume-Ready Success Criteria

The project is ready for the resume when you can demonstrate:

- Base62-based unique short-code generation
- MySQL persistence with optimized indexing
- Redis cache-aside architecture
- Cache invalidation
- Negative caching
- URL expiration/deactivation
- Rate limiting
- Stateless FastAPI instances
- Nginx load balancing
- Dockerized deployment
- Failure fallback from Redis to MySQL
- Structured logging/metrics
- Automated tests
- Actual load-testing results
- Horizontal scaling measurements

---

# 46. Final Resume Positioning

The existing resume bullets are directionally good, but they currently overstate the architecture slightly.

A stronger final version, after implementation and benchmarking, would be:

**Scalable URL Redirection Platform**  
*FastAPI, MySQL, Redis, Docker, Nginx, SQLAlchemy*

- Engineered a high-throughput URL shortening service using **Base62-encoded identifiers**, MySQL persistence, and indexed short-code lookups for low-latency redirection.
- Implemented **Redis cache-aside caching, TTL-based expiration, and negative caching** to accelerate hot-link redirects and reduce database read load.
- Containerized stateless FastAPI instances with **Docker and Nginx load balancing**, then benchmarked redirect-heavy workloads with **k6** to measure throughput, p95 latency, cache hit rate, and horizontal scaling.

The final bullet should include actual benchmark numbers once measured.

---

# 47. Definition of Done

The project is considered complete only when:

```text
[✓] URL creation works
[✓] Base62 identifier generation works
[✓] MySQL persistence works
[✓] Redirect path works
[✓] Redis cache works
[✓] Cache invalidation works
[✓] Expiration works
[✓] Rate limiting works
[✓] Nginx routes requests
[✓] Multiple API replicas work
[✓] Docker Compose starts the system
[✓] Redis failure fallback works
[✓] Automated tests pass
[✓] Load tests completed
[✓] Performance metrics documented
[✓] Architecture matches implementation
```

The most important rule for the resume is simple: **the architecture diagram, implementation, and benchmark numbers must agree.** Don't claim “scalable” because Nginx and Docker are present. Prove what scales, under what workload, and where the bottleneck moves.