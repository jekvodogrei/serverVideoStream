# Вкажіть базовий образ
FROM node:14

# Встановіть робочу директорію всередині контейнера
WORKDIR /app

# Скопіюйте package.json і package-lock.json (якщо є)
COPY package*.json ./

# Встановіть залежності
RUN npm install

# Скопіюйте решту коду програми
COPY . .

# Відкрийте порт
EXPOSE 3001

# Вкажіть команду для запуску додатка
CMD ["node", "server.js"]