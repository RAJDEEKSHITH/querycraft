# PostgreSQL 17 + pgvector, with the AdventureWorks sample data prepared at build time.
# Data source: Microsoft's AdventureWorks OLTP CSVs, converted with lorint/AdventureWorks-for-Postgres.
# lorint files are pinned to commit b474991f0df1c4bf55ca4735eb0254ca0709eed2 (master HEAD on 2026-06-29).
# The data is loaded on the first container start by init/02-load-adventureworks.sh.
FROM pgvector/pgvector:pg17

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ruby ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /adventureworks

RUN curl -fsSL -o aw.zip https://github.com/Microsoft/sql-server-samples/releases/download/adventureworks/AdventureWorks-oltp-install-script.zip \
 && unzip -q aw.zip \
 && rm aw.zip \
 && curl -fsSL -o install.sql https://raw.githubusercontent.com/lorint/AdventureWorks-for-Postgres/b474991f0df1c4bf55ca4735eb0254ca0709eed2/install.sql \
 && curl -fsSL -o update_csvs.rb https://raw.githubusercontent.com/lorint/AdventureWorks-for-Postgres/b474991f0df1c4bf55ca4735eb0254ca0709eed2/update_csvs.rb \
 && ruby update_csvs.rb \
 && chown -R postgres:postgres /adventureworks

WORKDIR /
