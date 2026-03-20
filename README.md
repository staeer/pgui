# pgUI — Lightweight PostgreSQL Manager

~30-50MB RAM. Auto-refresh every 2 seconds.

## Features
- 📊 Table viewer with auto-refresh (2s)
- ✏️ Insert / Edit / Delete rows
- 🔍 SQL editor (Ctrl+Enter to run)
- 🏗️ Schema inspector
- 📋 Create / Drop tables
- 🔄 Toggle auto-refresh on/off

## Deploy on Coolify

### Option A — Git repo
1. Push this folder to a Git repo
2. In Coolify: New Resource → Docker Compose → paste your repo URL
3. Set Environment Variables (see below)

### Option B — Direct Docker Compose
1. In Coolify: New Resource → Docker Compose
2. Paste the docker-compose.yml content

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DB_HOST` | PostgreSQL hostname | `postgresql-database-xxx` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `postgres` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | `yourpassword` |
| `DB_SSL` | Enable SSL | `false` |

## DB_HOST in Coolify
Use the service name of your PostgreSQL container as shown in Coolify's Services list.
Example: `postgresql-database-wmsrywn2jy6ctxfjs0rbnaob`

Make sure both services are on the same network in Coolify 
(enable "Connect to Predefined Network" if needed).
