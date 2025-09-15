#!/bin/bash
set -e
DATE=$(date +%Y%m%d-%H%M%S)
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" > "backup_$DATE.sql"
