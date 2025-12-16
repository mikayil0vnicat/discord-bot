FROM node:20-alpine

WORKDIR /app

COPY package.json ./

# package-lock yok → npm install kullan
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
