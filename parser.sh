#!/bin/bash

# === Настройки ===
SCRIPT_DIR="/root/websites/parser"
NODE_SCRIPT="$SCRIPT_DIR/index.js"
LOG_FILE="/var/log/puppeteer-bot.log"
EMAIL_TO="info@apexweb.ru"
SUBJECT_SUCCESS="✅ Прогрев кеша завершён"
SUBJECT_ERROR="❌ Ошибка при прогреве кеша"
LOCK_FILE="/tmp/sitemap_parser.lock"

# # === Завершение старых Chromium-процессов ===
# echo "[$(date)] Завершение процессов Chromium..." >> "$LOG_FILE"
# pkill -f '(chrome|chromium|puppeteer)' 2>/dev/null

# sleep 5

# === Проверка lock-файла ===
if [ -f "$LOCK_FILE" ]; then
    echo "[$(date)] Обнаружен lock-файл. Предыдущий запуск не завершён." >> "$LOG_FILE"
    echo "Предыдущий запуск не завершён. Lock-файл: $LOCK_FILE" | mail -s "$SUBJECT_ERROR" "$EMAIL_TO"
    exit 1
fi

# === Запуск скрипта ===
echo "[$(date)] Запуск Puppeteer парсера..." >> "$LOG_FILE"
/root/.nvm/versions/node/v22.14.0/bin/node "$NODE_SCRIPT" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

# === Проверка результата ===
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date)] Завершено успешно." >> "$LOG_FILE"
    echo "Парсинг sitemap и прогрев кеша выполнены успешно." | mail -s "$SUBJECT_SUCCESS" "$EMAIL_TO"
else
    echo "[$(date)] Завершено с ошибкой (код $EXIT_CODE)." >> "$LOG_FILE"
    echo "Произошла ошибка при запуске парсера Bitrix. Код ошибки: $EXIT_CODE" | mail -s "$SUBJECT_ERROR" "$EMAIL_TO"
fi