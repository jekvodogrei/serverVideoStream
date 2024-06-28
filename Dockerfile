# Use an official Node.js runtime as a parent image
FROM node:20

# Set the working directory
WORKDIR /

# Install dependencies
COPY package*.json ./

RUN npm install

# Copy the rest of the application
COPY . .

# Expose the port the app runs on
EXPOSE 3001

# Run the application
CMD ["node", "server.js"]

