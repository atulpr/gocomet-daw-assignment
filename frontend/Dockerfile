# Development/Testing Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm install

# Copy source code
COPY . .

# Set environment
ENV NODE_ENV=development
ENV PORT=3001

# Expose port
EXPOSE 3001

# Start dev server
CMD ["npm", "run", "dev"]
