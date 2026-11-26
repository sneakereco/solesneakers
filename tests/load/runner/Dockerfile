FROM node:24.14.1-bookworm-slim AS node
FROM mcr.microsoft.com/playwright:v1.56.1-noble@sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tests/load ./tests/load
ENV K6_NO_USAGE_REPORT=true
ENTRYPOINT ["node", "tests/load/operator/cli.mjs"]
CMD ["--dry-run", "--profile", "acceptance"]
