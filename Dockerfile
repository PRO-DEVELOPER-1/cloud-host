# Use official Node.js 18 image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy rest of the project files
COPY . .

# Expose the app port (update if not 3000)
EXPOSE 3000

# Load environment variables from .env if needed
# (optional: you can manage this at runtime in most platforms)

# Run the app
CMD ["npm", "start"]
