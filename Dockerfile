FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY requirements.txt ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
