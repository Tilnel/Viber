# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY src/client/package*.json ./src/client/

# Install dependencies
RUN npm ci
RUN cd src/client && npm ci

# Copy source code
COPY . .

# Build client
RUN cd src/client && npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install PostgreSQL client
RUN apk add --no-cache postgresql-client git

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/shared ./src/shared

# Create data directory
RUN mkdir -p /data

EXPOSE 3000

CMD ["npm", "start"]
