FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY source/package.json source/package-lock.json* ./
RUN npm install --omit=dev

# Copy the rest of the application.
COPY source/ ./

# Default port for the dashboard. Railway will inject its own PORT at runtime.
EXPOSE 1500

ENV NODE_ENV=production

CMD ["node", "index.js"]
