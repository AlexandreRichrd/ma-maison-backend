FROM node:24-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:24-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:24-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npx prisma generate
RUN npm run build

FROM node:24-alpine
COPY ./package.json package-lock.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
# The production install above doesn't run `prisma generate` — overlay the
# generated client from the build stage.
COPY --from=build-env /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build-env /app/node_modules/@prisma/client /app/node_modules/@prisma/client
COPY --from=build-env /app/dist /app/dist
# schema/migrations aren't needed at runtime (the generated client is
# self-contained) — kept only for `prisma migrate status`-style diagnostics
# from a shell in the running container.
COPY ./prisma /app/prisma
COPY ./prisma.config.ts /app/prisma.config.ts
WORKDIR /app
# No `prisma migrate deploy` here: this API shares its database with
# my-home's Drizzle-managed schema during the incremental migration (see
# .env.example) and has no Prisma migration history for it — running
# migrate against it fails loudly (P3005, "schema is not empty") by
# design. Re-add a migrate step once Prisma owns the schema outright.
CMD ["node", "dist/main"]
