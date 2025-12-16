FROM node:20-alpine

WORKDIR /app

# Önce package dosyaları
COPY package*.json ./

# Prod deps kur (pg dahil)
RUN npm ci --omit=dev || npm install --omit=dev

# Sonra kod
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
