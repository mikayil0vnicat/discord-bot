FROM node:20-alpine

# Çalışma klasörü
WORKDIR /app

# Paketleri kopyala ve kur
COPY package*.json ./
RUN npm install

# Kalan dosyaları kopyala
COPY . .

# Botu başlat
CMD ["node", "index.js"]
