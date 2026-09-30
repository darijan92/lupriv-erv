FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init tzdata

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
ENV TZ=Europe/Sarajevo
EXPOSE 3001

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
