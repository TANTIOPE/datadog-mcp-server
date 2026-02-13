# Build stage
FROM node:24-slim@sha256:a81a03dd965b4052269a57fac857004022b522a4bf06e7a739e25e18bce45af2 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev), ignore scripts since src not copied yet
RUN npm ci --ignore-scripts

# Copy source files
COPY tsconfig.json tsup.config.ts ./
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM node:24-slim@sha256:a81a03dd965b4052269a57fac857004022b522a4bf06e7a739e25e18bce45af2 AS production

WORKDIR /app

# Add non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nodejs

# Copy package files
COPY package*.json ./

# Install production dependencies only (ignore scripts to skip prepare/build)
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Environment variables (set at runtime)
ENV NODE_ENV=production
ENV MCP_TRANSPORT=stdio
ENV MCP_PORT=3000
ENV MCP_HOST=0.0.0.0

# Expose port for HTTP transport
EXPOSE 3000

# Health check for HTTP mode (uses Node.js http module - no external dependencies)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD if [ "$MCP_TRANSPORT" = "http" ]; then node -e "require('http').get('http://localhost:${MCP_PORT}/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"; else exit 0; fi

# Default to stdio mode
CMD ["node", "dist/index.js"]
