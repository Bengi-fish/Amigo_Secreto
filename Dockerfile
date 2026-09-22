FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server ./server
COPY public ./public
USER node
ENV NODE_ENV=production
CMD ["node", "server/index.js"]
