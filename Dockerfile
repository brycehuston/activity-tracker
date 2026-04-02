# Backend Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies including Chromium for whatsapp-web.js
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install --ignore-scripts

# Copy source code
COPY src ./src

# Expose port
ARG PORT=3001
ENV PORT=${PORT}
EXPOSE ${PORT}

# Create directories for WhatsApp auth state
RUN mkdir -p /app/.wwebjs_cache /app/auth_info_baileys

CMD ["node", "src/server.js"]
