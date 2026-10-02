# DevOne

> **One workspace for everything developers need.**

DevOne is a self-hosted developer workspace that combines project management, Git integrations, database tools, automatic ERD generation, API tooling, documentation, and DevOps features into one application.

The goal is not to replace GitHub, GitLab, Jira, Postman, DBeaver, or Lucid individually. DevOne connects those workflows into a single project context.

---

## Core Idea

A DevOne project can connect:

```text
Issue
  ↓
Branch
  ↓
Commits
  ↓
Pull Request / Merge Request
  ↓
Pipeline
  ↓
Deployment
```

At the same time:

```text
Database Connection
  ↓
Schema Scan
  ↓
Automatic ERD
  ↓
SQL Editor
  ↓
Schema History
  ↓
Schema Diff
```

This gives developers one place to understand the entire state of a project.

---

# Technology Stack

## Frontend

- Next.js
- React
- TypeScript
- shadcn/ui
- Tailwind CSS
- TanStack Query
- TanStack Table
- Zustand
- Zod
- React Flow for ERD / visual schema design

## Backend

- Next.js server-side APIs
- Prisma ORM for DevOne's own database
- Native database drivers for connected user databases
- GitHub API
- GitLab API
- Redis
- BullMQ or another Redis-backed job queue

## Internal Database

Use PostgreSQL for DevOne itself.

```text
Next.js
   ↓
Prisma
   ↓
PostgreSQL
```

Prisma should only manage DevOne's internal application data.

Examples:

```text
users
projects
project_members
issues
sprints
git_connections
repositories
database_connections
saved_queries
erd_layouts
schema_snapshots
webhook_events
activity_logs
```

---

# Starter Kit

DevOne can use:

```text
https://github.com/Kiranism/next-shadcn-dashboard-starter
```

as its frontend and application foundation.

The starter already provides a dashboard structure and useful frontend libraries.

## Keep

- Next.js
- React
- TypeScript
- shadcn/ui
- Tailwind CSS
- TanStack Query
- TanStack Table
- Zustand
- Zod
- Dashboard layout
- Sidebar
- Forms
- Theme support
- Docker support

## Remove

Remove features that DevOne does not need:

- Clerk
- Billing
- Demo products
- Demo pages
- Unused starter features

For the starter:

```bash
bun run cleanup clerk
```

DevOne will use its own GitHub/GitLab token authentication instead.

---

# Suggested Project Structure

```text
devone/
│
├── app/
│   ├── login/
│   ├── dashboard/
│   ├── projects/
│   ├── issues/
│   ├── database/
│   ├── erd/
│   ├── git/
│   ├── api-client/
│   ├── docs/
│   ├── devops/
│   └── settings/
│
├── components/
│
├── lib/
│   │
│   ├── db/
│   │   └── prisma.ts
│   │
│   ├── auth/
│   │
│   ├── encryption/
│   │
│   ├── git/
│   │   ├── provider.ts
│   │   ├── github.ts
│   │   └── gitlab.ts
│   │
│   ├── database/
│   │   ├── adapter.ts
│   │   ├── postgres.ts
│   │   ├── mysql.ts
│   │   └── sqlserver.ts
│   │
│   ├── erd/
│   │
│   └── queue/
│
├── prisma/
│   └── schema.prisma
│
├── worker/
│
├── Dockerfile
│
└── docker-compose.yml
```

---

# Main Navigation

```text
DevOne
│
├── Dashboard
├── Projects
├── Issues
├── Database
├── ERD
├── Git
├── API
├── Docs
├── DevOps
└── Settings
```

---

# Authentication

DevOne is self-hosted and does not need traditional username/password authentication.

Users authenticate using:

- GitHub Personal Access Token
- GitLab Personal Access Token

No DevOne password is required.

---

## Login UI

```text
              DevOne

      Self-hosted developer workspace

┌──────────────────────────────────┐
│ Provider                         │
│                                  │
│  ● GitHub                        │
│  ○ GitLab                        │
│                                  │
│ Personal Access Token            │
│ ┌──────────────────────────────┐ │
│ │ ••••••••••••••••••••••••   │ │
│ └──────────────────────────────┘ │
│                                  │
│       [ Connect & Sign In ]      │
└──────────────────────────────────┘
```

For self-hosted GitLab:

```text
Provider
GitLab

GitLab URL
https://git.company.com

Token
glpat-xxxxxxxx
```

This allows DevOne to support both:

```text
gitlab.com
```

and private GitLab instances.

---

# Authentication Flow

```text
GitHub/GitLab Token
        ↓
DevOne Backend
        ↓
Validate token with provider
        ↓
Retrieve provider user identity
        ↓
Find or create DevOne user
        ↓
Create local DevOne session
        ↓
Dashboard
```

The token should not directly become the browser session.

Instead:

```text
PAT
 ↓
Validate
 ↓
Create DevOne session
 ↓
Secure HttpOnly cookie
```

---

# User Table

Example:

```text
users
────────────────────────
id
provider
provider_user_id
username
name
avatar_url
role
created_at
last_login_at
```

Recommended unique identity:

```text
(provider, provider_user_id)
```

Do not depend on username as the permanent identifier because usernames can change.

---

# Token Storage

If DevOne needs continuous Git access, the token can be stored encrypted.

Example:

```text
git_connections
────────────────────────
id
user_id
provider
provider_user_id
base_url
encrypted_token
created_at
updated_at
```

Never store raw tokens in plain text.

Use an installation encryption key:

```env
DEVONE_ENCRYPTION_KEY=...
```

The encryption key must not be stored inside the database.

Never return stored access tokens to the frontend.

Frontend response:

```json
{
  "provider": "github",
  "connected": true,
  "username": "developer"
}
```

Not:

```json
{
  "token": "github_pat_xxxxx"
}
```

---

# Self-Hosted Registration

For a personal DevOne installation:

```text
Any valid GitHub/GitLab token
        ↓
Allowed
```

For company installations, DevOne should support restrictions.

Example:

```env
DEVONE_AUTH_PROVIDERS=github,gitlab
DEVONE_GITHUB_ALLOWED_ORGS=my-company
DEVONE_GITLAB_ALLOWED_GROUPS=my-company
DEVONE_ALLOW_REGISTRATION=false
```

Possible flow:

```text
Valid Git provider token?
        ↓
YES

Allowed organization/group?
        ↓
YES

Access DevOne
```

---

# Git Integration

DevOne should support:

- GitHub
- GitLab

Later:

- Bitbucket
- Azure DevOps
- Gitea
- Forgejo

---

# Git Provider Architecture

Create a normalized provider interface.

```ts
interface GitProvider {
  getRepositories(): Promise<Repository[]>

  getBranches(repositoryId: string): Promise<Branch[]>

  getCommits(repositoryId: string): Promise<Commit[]>

  getMergeRequests(repositoryId: string): Promise<MergeRequest[]>

  getFile(
    repositoryId: string,
    path: string,
    branch: string
  ): Promise<FileContent>
}
```

Implementations:

```text
GitProvider
    │
    ├── GitHubProvider
    └── GitLabProvider
```

This prevents DevOne from being tightly coupled to either provider.

---

# Normalized Git Model

GitHub calls them:

```text
Pull Requests
```

GitLab calls them:

```text
Merge Requests
```

Internally DevOne can normalize both as:

```text
MergeRequest
```

or:

```text
CodeReview
```

Other normalized models:

```text
Repository
Branch
Commit
MergeRequest
Pipeline
Deployment
Release
```

---

# Project Repository Support

One DevOne project should support multiple repositories.

Example:

```text
Project: Bantay Benta

Repositories

Frontend
bantay-benta-web

Backend
bantay-benta-api

Mobile
bantay-benta-mobile

Infrastructure
bantay-benta-infra
```

Do not force:

```text
1 Project = 1 Repository
```

---

# Git UI

```text
Bantay Benta
────────────────────────────────

Overview
Issues
Database
ERD
API
Git
Deployments
Docs
```

Inside Git:

```text
Git

Repository
[ bantay-benta-api ▼ ]

Branch
[ main ▼ ]

Latest Commit

a829f31
Fix bid validation

Developer
5 minutes ago
```

Navigation:

```text
Overview
Branches
Commits
Pull Requests
Pipelines
Releases
Files
```

---

# Repository Browser

DevOne can provide a simple source browser.

```text
bantay-benta-api

main ▼

src/
├── Controllers/
├── Services/
├── Models/
├── Data/
└── Program.cs

README.md
Dockerfile
docker-compose.yml
```

For the first version, DevOne does not need to clone every repository.

Use provider APIs to retrieve:

- repositories
- branches
- commits
- pull requests / merge requests
- file tree
- requested file contents

Repository cloning can be added later for:

- semantic code search
- static analysis
- code indexing
- advanced AI features

---

# Git Webhooks

Webhooks should update DevOne automatically.

```text
Developer pushes code
        ↓
GitHub / GitLab
        ↓
Webhook
        ↓
DevOne
        ↓
Update Git data
```

Endpoints:

```text
POST /api/webhooks/github
POST /api/webhooks/gitlab
```

---

# Webhook Processing

Do not perform heavy processing directly in the webhook HTTP request.

Use:

```text
GitHub/GitLab
      ↓
Webhook Endpoint
      ↓
Verify Signature
      ↓
Store Event
      ↓
Queue Job
      ↓
Worker
```

Worker jobs can:

```text
Update commits
Update branches
Update PR/MR
Update issue links
Update pipeline status
Update deployment status
Send notifications
```

Webhook handlers must be idempotent because providers can resend events.

---

# Issues / Jira-like Project Management

DevOne should contain its own lightweight issue tracker.

Features:

- Projects
- Issues
- Bugs
- Tasks
- Epics
- Backlog
- Kanban board
- Sprints
- Releases
- Labels
- Priority
- Assignees
- Comments
- Activity

Example:

```text
BACKLOG

DEV-101  Add product bidding       High
DEV-102  Fix login token refresh   Critical
DEV-103  Add seller profile        Medium
```

Board:

```text
TODO            IN PROGRESS        REVIEW          DONE

DEV-101         DEV-108            DEV-093         DEV-088
DEV-102         DEV-110            DEV-095         DEV-091
DEV-103
```

---

# Git + Issues

Issue keys should automatically connect Git work.

Example issue:

```text
DEV-142
```

Branch:

```bash
git checkout -b feature/DEV-142-add-bidding
```

Commit:

```bash
git commit -m "DEV-142 Add bidding validation"
```

Pull request:

```text
DEV-142 Add bidding validation
```

DevOne detects the issue key and links everything automatically.

Result:

```text
Issue DEV-142
     │
     ├── Branch
     │   feature/DEV-142-add-bidding
     │
     ├── 7 commits
     │
     ├── PR #42
     │
     ├── CI ✓
     │
     └── Deployed → staging
```

---

# Automatic Issue Workflow

Optional project automation:

```text
Branch Created
      ↓
TODO → IN PROGRESS
```

```text
PR Created
      ↓
IN PROGRESS → CODE REVIEW
```

```text
PR Merged
      ↓
CODE REVIEW → READY FOR QA
```

```text
Deployment Successful
      ↓
READY FOR QA → DONE
```

This should be configurable per project.

---

# Database Connections

DevOne should connect to external databases.

Initial support:

- PostgreSQL
- MySQL
- MariaDB
- SQL Server
- SQLite

Later:

- MongoDB
- Redis

---

# Important Prisma Rule

Prisma should manage:

```text
DevOne's own PostgreSQL database
```

Prisma should not be the main connection engine for arbitrary user databases.

Why?

DevOne does not know user schemas ahead of time.

Different users can connect:

```text
User A
PostgreSQL
500 tables

User B
MySQL
30 tables

User C
SQL Server
100 tables
```

Use native database drivers through an adapter layer instead.

---

# Database Adapter Architecture

```ts
interface DatabaseAdapter {
  connect(): Promise<void>

  testConnection(): Promise<boolean>

  getSchemas(): Promise<DatabaseSchema[]>

  getTables(): Promise<Table[]>

  getColumns(table: string): Promise<Column[]>

  getForeignKeys(): Promise<ForeignKey[]>

  getIndexes(): Promise<Index[]>

  execute(query: string): Promise<QueryResult>

  disconnect(): Promise<void>
}
```

Implementations:

```text
DatabaseAdapter
      │
      ├── PostgresAdapter
      ├── MySQLAdapter
      └── SQLServerAdapter
```

Possible Node drivers:

```text
PostgreSQL → pg
MySQL / MariaDB → mysql2
SQL Server → mssql
```

---

# Database UI

```text
Database
└── Production PostgreSQL
    ├── Overview
    ├── Tables
    ├── SQL Editor
    ├── ERD
    ├── Queries
    └── Schema History
```

Connection example:

```text
Project: Bantay Benta

Databases

Production
PostgreSQL
● Connected

Staging
PostgreSQL
● Connected

Local
PostgreSQL
● Connected
```

---

# SQL Editor

DevOne should include a database SQL editor.

Example:

```sql
SELECT *
FROM products
WHERE active = true;
```

Features:

- Execute SQL
- Query results
- Query history
- Saved queries
- Search
- Export results
- Read-only mode
- Connection selector
- Database selector
- Schema selector

Production connections should support optional read-only protection.

---

# Automatic ERD

The ERD should be automatically generated when a database connection is created.

Users should not have to manually press "Create ERD".

Flow:

```text
Add Database
     ↓
Test Connection
     ↓
Connected ✓
     ↓
Read Database Metadata
     ↓
Detect Tables
     ↓
Detect Columns
     ↓
Detect Primary Keys
     ↓
Detect Foreign Keys
     ↓
Detect Indexes
     ↓
Generate ERD
     ↓
Auto Layout
```

Relationships should come from actual foreign-key metadata.

Do not guess relationships only from column names such as:

```text
user_id
product_id
order_id
```

---

# Normalized Database Schema

Convert all supported databases into one internal structure.

Example:

```ts
interface DatabaseSchema {
  tables: Table[]
}

interface Table {
  name: string
  schema: string
  columns: Column[]
  primaryKeys: string[]
  foreignKeys: ForeignKey[]
  indexes: Index[]
}
```

Then:

```text
PostgreSQL
MySQL
SQL Server
     ↓
Database Adapters
     ↓
DevOne DatabaseSchema
     ↓
ERD Renderer
```

The ERD frontend does not need to know which database engine produced the schema.

---

# ERD / Schema Designer

Use React Flow or a similar graph library.

Features:

- Drag-and-drop canvas
- Move tables
- Zoom
- Pan
- Mini-map
- Auto layout
- Snap to grid
- Table grouping
- Notes
- Relationship connectors
- Crow's foot notation

---

# ERD Table Node

Example:

```text
┌─────────────────────┐
│ users               │
├─────────────────────┤
│ 🔑 id               │
│    name             │
│    email            │
│    created_at       │
└──────────┬──────────┘
           │ 1
           │
           │ *
┌──────────▼──────────┐
│ orders              │
├─────────────────────┤
│ 🔑 id               │
│ 🔗 user_id          │
│    total            │
│    status           │
└─────────────────────┘
```

---

# ERD Features

## Table Builder

Each table can contain:

- Table name
- Column name
- Data type
- Nullable
- Primary key
- Foreign key
- Unique
- Default value
- Index

## Relationships

Support:

- One-to-One
- One-to-Many
- Many-to-Many

## Crow's Foot Notation

Show database cardinality visually.

## Export

Support:

- PNG
- SVG
- PDF
- SQL
- JSON
- DBML

---

# Live ERD vs Design ERD

DevOne should eventually support two ERD modes.

## Live ERD

Represents the actual connected database.

```text
Connected DB
     ↓
Schema Scan
     ↓
Live ERD
```

## Design ERD

Allows developers to design future schema changes without modifying the database.

```text
Live ERD
   ↓
Clone to Design
   ↓
Modify visually
   ↓
Generate Migration
   ↓
Review SQL
   ↓
Apply later
```

---

# Schema Refresh

Example:

```text
Production Database

Schema last scanned:
Sep 18, 2026 10:42 AM

[ Refresh Schema ]
```

When the schema changes:

```sql
ALTER TABLE orders
ADD COLUMN shipping_address_id BIGINT;
```

DevOne rescans and updates the ERD.

---

# Schema History

Store schema snapshots.

Example:

```text
Schema History

v15   Sep 18, 2026
v14   Sep 17, 2026
v13   Sep 15, 2026
```

This enables comparisons between versions.

---

# Schema Diff

Example:

```text
Schema Changes

+ orders.shipping_address_id
+ shipping_addresses table
+ FK orders.shipping_address_id → shipping_addresses.id

- users.old_address
```

Actions:

```text
[ View in ERD ]
[ Generate Migration ]
[ Ignore ]
```

---

# Git + ERD

Eventually DevOne can detect database migrations inside pull requests.

Example:

```text
PR #52
Add ordering system

Files Changed       14
Database Changes     3
API Changes          4

Schema
+ orders
+ order_items
+ FK order_items.order_id

[ View ERD Diff ]
```

Flow:

```text
Current Database ERD
        ↓
Migration Changes
        ↓
Proposed ERD
        ↓
Schema Diff
```

This can become one of DevOne's strongest features.

---

# API Client

DevOne can include a lightweight Postman/Bruno-style API client.

Support:

- REST
- GraphQL
- WebSocket
- Environments
- Collections
- Headers
- Authentication
- Request body
- Response viewer
- History
- Saved requests

Example:

```text
POST /api/products

Environment
[ Development ▼ ]

Authorization
Bearer Token

Body

{
  "name": "Custom Shirt",
  "price": 500
}

[ SEND ]

200 OK
184 ms
```

---

# Environment Management

Projects should support:

```text
Local
Development
Staging
Production
```

Variables:

```text
DATABASE_URL
API_URL
REDIS_HOST
AWS_REGION
```

Secrets must be encrypted and never exposed directly through browser storage.

---

# Documentation

DevOne can include:

- Wiki
- Markdown documentation
- Architecture docs
- ADRs
- API documentation
- Database documentation
- ERD documentation

Example:

```text
Docs
├── Architecture
├── Database
├── API
├── Deployment
└── ADR
```

---

# DevOps

Later DevOne can include:

- Deployments
- CI/CD status
- Containers
- Services
- Logs
- Environment status
- Health checks

Example:

```text
Services

API       ● Online
Worker    ● Online
Redis     ● Online
Database  ● Online
```

---

# Logs

Features:

- Live tail
- Search
- Filter by service
- Filter by log level
- Filter by date
- Error highlighting

Example:

```text
[INFO] User 342 logged in
[INFO] Order #8432 created
[WARN] Redis connection retry
[ERROR] Payment request failed
```

---

# Dashboard

Example:

```text
DevOne
─────────────────────────────────

Bantay Benta

Issues
12 Open
4 In Progress

Pull Requests
3 Waiting for Review

Deployments
Production    Healthy
Staging       Healthy

Database
PostgreSQL    Connected
Redis         Connected

Services
API           ● Online
Worker        ● Online
Redis         ● Online

Recent Activity
Developer pushed 3 commits
DEV-105 moved → Review
Production deployed v1.4.2
```

---

# Background Jobs

DevOne will eventually need asynchronous workers for:

- GitHub webhook processing
- GitLab webhook processing
- Repository synchronization
- Database schema scans
- ERD generation
- Schema diffing
- Git commit indexing
- Pipeline synchronization
- Notifications

Recommended:

```text
Redis
+
BullMQ
```

Architecture:

```text
HTTP Request
     ↓
Queue Job
     ↓
Return

Worker
     ↓
Process Job
```

---

# Docker

DevOne should be easy to self-host.

Target user experience:

```bash
git clone https://github.com/your-org/devone.git

cd devone

docker compose up -d
```

Then:

```text
http://localhost:3000
```

---

# Docker Architecture

Initial setup:

```text
Browser
   ↓
DevOne Web
   ↓
┌──────────────┬──────────────┐
│              │              │
PostgreSQL    Redis         External APIs
                              │
                        GitHub / GitLab
```

Recommended production setup:

```text
Browser
   ↓
Next.js Web
   │
   ├── PostgreSQL
   ├── Redis
   └── Worker
          │
          ├── GitHub
          ├── GitLab
          └── Connected Databases
```

Docker Compose services:

```yaml
services:
  web:
    # Next.js

  worker:
    # background jobs

  postgres:
    # DevOne internal database

  redis:
    # cache + queues
```

---

# Security Requirements

DevOne may have access to:

- Source code
- Git provider tokens
- Production databases
- SQL execution
- API credentials
- Deployment information

Security is therefore a core requirement.

## Requirements

- Encrypt Git tokens at rest
- Encrypt database passwords at rest
- Use least-privilege Git scopes
- Use secure HttpOnly session cookies
- Never expose raw secrets to frontend JavaScript
- Verify GitHub webhook signatures
- Verify GitLab webhook tokens/signatures
- Add audit logs
- Add role-based access control
- Support read-only database connections
- Add query execution restrictions for production
- Rate-limit authentication attempts
- Do not store encryption keys in PostgreSQL

---

# Git Permissions

Start with read-only permissions.

Recommended V1 capabilities:

```text
Repositories       Read
Branches           Read
Commits            Read
Pull Requests      Read
Merge Requests     Read
Pipelines          Read
Actions            Read
Deployments        Read
Repository Files   Read
```

Do not initially request:

```text
Delete Repository
Admin Repository
Push Code
Modify Repository Settings
```

Later optional permissions can support:

- Create branch
- Create PR/MR
- Comment on PR/MR
- Create releases
- Trigger pipelines

---

# Database Schema Ideas

## users

```text
id
provider
provider_user_id
username
name
avatar_url
role
created_at
updated_at
last_login_at
```

## projects

```text
id
name
slug
description
created_by
created_at
updated_at
```

## project_members

```text
id
project_id
user_id
role
created_at
```

## git_connections

```text
id
user_id
provider
provider_user_id
base_url
encrypted_token
created_at
updated_at
```

## repositories

```text
id
git_connection_id
provider_repository_id
name
full_name
default_branch
clone_url
visibility
created_at
updated_at
```

## project_repositories

```text
project_id
repository_id
```

## git_commits

```text
id
repository_id
sha
message
author_name
author_email
branch
committed_at
```

## git_merge_requests

```text
id
repository_id
provider_number
title
description
source_branch
target_branch
status
author
merged_at
created_at
updated_at
```

## database_connections

```text
id
project_id
name
provider
host
port
database_name
username
encrypted_password
ssl_enabled
environment
created_at
updated_at
```

## schema_snapshots

```text
id
database_connection_id
schema_json
created_at
```

## issues

```text
id
project_id
issue_key
title
description
type
status
priority
assignee_id
created_by
created_at
updated_at
```

## issue_git_links

```text
id
issue_id
repository_id
commit_id
merge_request_id
link_type
created_at
```

---

# MVP

Do not build every feature immediately.

## Phase 1

Build the foundation:

1. Next.js starter setup
2. Remove Clerk
3. PostgreSQL
4. Prisma
5. Docker Compose
6. GitHub token login
7. GitLab token login
8. DevOne sessions
9. Projects
10. Basic dashboard

## Phase 2

Git integration:

1. Repository listing
2. Repository linking to projects
3. Branches
4. Commits
5. Pull Requests
6. Merge Requests
7. File browser
8. Webhooks

## Phase 3

Database tools:

1. Database connections
2. PostgreSQL adapter
3. MySQL adapter
4. SQL editor
5. Table browser
6. Schema introspection
7. Automatic ERD

## Phase 4

Project management:

1. Issues
2. Kanban board
3. Backlog
4. Sprint support
5. Issue keys
6. Git auto-linking

## Phase 5

Advanced schema tools:

1. Schema history
2. Schema diff
3. Live ERD
4. Design ERD
5. Migration generation
6. Git migration detection
7. ERD diff inside pull requests

## Phase 6

Developer platform:

1. API client
2. Docs
3. Logs
4. CI/CD integration
5. Deployments
6. Notifications
7. Advanced developer tools

---

# Initial Installation

Clone starter:

```bash
git clone https://github.com/Kiranism/next-shadcn-dashboard-starter.git devone

cd devone

bun install
```

Remove Clerk:

```bash
bun run cleanup clerk
```

Install Prisma and PostgreSQL dependencies:

```bash
bun add prisma @prisma/client pg
bunx prisma init
```

Potential additional dependencies:

```bash
bun add @xyflow/react
bun add ioredis bullmq
bun add mysql2
bun add mssql
```

---

# Product Positioning

DevOne should not be marketed as:

```text
Another Jira
Another DBeaver
Another Postman
Another Lucid
Another GitHub
```

Instead:

> **DevOne connects your development workflow into one self-hosted workspace.**

The core relationship is:

```text
Project
│
├── Issues
│    └── Git Activity
│
├── Repositories
│    ├── Branches
│    ├── Commits
│    ├── PR/MR
│    └── Pipelines
│
├── Databases
│    ├── SQL
│    ├── Tables
│    ├── Automatic ERD
│    ├── Schema History
│    └── Schema Diff
│
├── API
│
├── Docs
│
└── Deployments
```

---

# Tagline Ideas

Primary:

> **DevOne — One workspace for everything developers need.**

Alternative:

> **DevOne — Your development workspace, connected.**

Alternative:

> **DevOne — One place for your entire development stack.**

---

# Long-Term Vision

The strongest DevOne experience would be:

```text
DEV-142
Fix bidding validation
       │
       ├── Git Branch
       │
       ├── 7 Commits
       │
       ├── Pull Request
       │
       ├── CI Passed
       │
       ├── DB Migration Detected
       │       ↓
       │   ERD Diff
       │
       ├── API Changes
       │
       └── Deployed to Staging
```

A developer can open one DevOne project and understand:

- What is being worked on
- Which code changed
- Who changed it
- What database structure changed
- What APIs changed
- Whether CI passed
- Where the feature is deployed
- What documentation belongs to it

That is the main value of DevOne.
