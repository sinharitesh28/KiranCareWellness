FROM node:18-bullseye

# Set the timezone to IST
ENV TZ=Asia/Kolkata
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Install Python and pip
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy server package files first for caching
COPY server/package*.json ./server/

# Install Node.js dependencies
WORKDIR /usr/src/app/server
RUN npm install

# Copy Python requirements
COPY server/python-services/requirements.txt ./python-services/

# Install Python dependencies in a virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install -r ./python-services/requirements.txt

# Return to root app dir
WORKDIR /usr/src/app

# Copy the rest of the application
COPY . .

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "server/app.js"]