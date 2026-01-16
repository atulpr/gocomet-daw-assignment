# Development/Testing Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy source code
COPY . .

# Set environment
ENV NODE_ENV=development
ENV PORT=3000

# Expose port
EXPOSE 3000

# Run migrations, seed, then start
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm start"]
