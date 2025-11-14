-- Enable PostGIS and pgcrypto extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Log extensions
SELECT 'PostGIS version: ' || PostGIS_Version();
