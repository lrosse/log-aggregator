FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY apps/generator/package.json ./apps/generator/package.json
RUN npm ci

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY apps/frontend ./apps/frontend
RUN npm run build --workspace=apps/frontend

FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
