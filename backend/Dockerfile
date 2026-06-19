FROM node:18-alpine

# Install curl for health checks
RUN apk add --no-cache curl

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install all dependencies (including devDependencies for ts-node)
RUN npm install

# Copy the rest of the application source code
COPY . .

# Ensure start.sh has execute permissions
RUN chmod +x start.sh

# Expose the default Hugging Face Spaces port (7860)
EXPOSE 7860

# Run both the gateway and the worker via our supervisor script
CMD ["./start.sh"]
