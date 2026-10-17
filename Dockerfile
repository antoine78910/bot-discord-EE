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

# Launch both bots by default (content bot + main chatbot)
# Set BOT_ENTRY=contentBot.js or BOT_ENTRY=index.js to run only one
CMD ["sh", "-c", "if [ -n \"$BOT_ENTRY\" ]; then exec node $BOT_ENTRY; else exec node start-both.js; fi"]
