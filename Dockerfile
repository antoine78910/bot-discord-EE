FROM node:20-alpine

WORKDIR /app

# Python + Pillow + FFmpeg for the /ee-content engine (source/content_engine).
RUN apk add --no-cache python3 py3-pillow ffmpeg

# Install deps first for better layer caching.
COPY source/package.json source/package-lock.json* ./
RUN npm install --omit=dev

# Copy the rest of the application.
COPY source/ ./

# Default port for the dashboard. Railway will inject its own PORT at runtime.
EXPOSE 1500

ENV NODE_ENV=production
ENV PYTHON_BIN=python3

# BOT_ENTRY=contentBot.js runs the dedicated content bot (separate Railway service).
CMD ["sh", "-c", "exec node ${BOT_ENTRY:-index.js}"]
