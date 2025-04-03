# Bitrix Cache Warmer

🧊 Умный скрипт для прогрева композитного кэша сайтов на 1С-Битрикс с помощью Puppeteer.

## 🚀 Возможности

- 🔍 Автоматический парсинг sitemap.xml
- 🎯 Приоритезация URL по шаблонам (`/catalog/`, `/services/`, и др.)
- 🔐 Исключение системных и административных URL
- 🚫 Блокировка загрузки сторонних JS-ресурсов (Google, Yandex, VK, Facebook и др.)
- 🧠 Проверка композитного кэша через `BX.getCacheFlag()`
- 🗂 Прогрев выполняется батчами по 50 страниц (перезапуск Chromium после каждого батча)
- 📊 Подробное логирование в файл с датой запуска
- 💥 Повторная попытка при таймаутах загрузки страницы

## 🛠 Установка

```bash
git clone https://github.com/yourname/bitrix-cache-warmer.git
cd bitrix-cache-warmer
npm install
```

## 📦 Зависимости

- Node.js >= 16
- puppeteer
- axios
- xml2js

Установка вручную:

```bash
npm install puppeteer axios xml2js
```

## ⚙️ Настройка

Внизу `index.js` находятся настройки:

```js
const sites = [
  'https://example.ru',
  'https://example.kz'
];

const options = {
  maxConcurrency: 2,
  maxUrlsPerSite: 500,
  timeoutPerPage: 60000,
  delay: { min: 1000, max: 3000 },
  priorityPatterns: ['/catalog/', '/products/']
};
```

Также можно указать `userAgent`, изменить размер батча, лог-папку и т.д.

## 📄 Логи

Все логи пишутся в:

```
~/logs/bitrix_cache_warmer/cache_warming_YYYY-MM-DD.log
```

## 🧪 Запуск

```bash
node index.js
```

### 💡 Рекомендации

- Не запускайте более 3-5 потоков одновременно — Puppeteer потребляет память.
- Можно настроить крон-задание на ночной прогрев кэша.
- Не требуется авторизация или административные права.

---

**Поддержка Bitrix Composite Cache без лишней нагрузки и с проверкой результата!**

