# Build Vue/Vite static assets
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html ./
COPY public ./public
COPY src ./src
COPY vite.config.js ./
# Relative /api — nginx will proxy; no VITE_API_URL needed
RUN npm run build

# Serve with nginx + reverse-proxy /api → api:3001
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
