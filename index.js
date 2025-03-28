const puppeteer = require('puppeteer');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const axios = require('axios');

const LOCK_FILE = '/tmp/sitemap_parser.lock';

class SitemapParser {
    constructor(sites, maxConcurrency = 3) {
        this.sites = sites;
        this.parser = new xml2js.Parser();
        this.maxConcurrency = maxConcurrency;
        this.logger = this.createLogger();
    }

    createLogger() {
        const logFile = path.join(process.env.HOME, 'websites', 'sitemap_parser', 'debug.log');
        fs.mkdirSync(path.dirname(logFile), { recursive: true });

        return {
            log: (message) => {
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] ${message}\n`;
                console.log(logMessage.trim());
                fs.appendFileSync(logFile, logMessage);
            },
            error: (message, error) => {
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] ERROR: ${message} - ${error?.message || error}\n`;
                console.error(logMessage.trim());
                fs.appendFileSync(logFile, logMessage);
            }
        };
    }

    async extractSitemapUrls(sitemapUrl) {
        try {
            this.logger.log(`Извлечение URLs из sitemap: ${sitemapUrl}`);
            const response = await axios.get(sitemapUrl, { timeout: 15000 });
            const result = await this.parser.parseStringPromise(response.data);
            let urls = [];

            if (result.urlset?.url) {
                urls = result.urlset.url.map(u => u.loc[0]).filter(u => u.startsWith('http'));
            }

            if (result.sitemapindex?.sitemap) {
                for (const nested of result.sitemapindex.sitemap) {
                    const nestedUrls = await this.extractSitemapUrls(nested.loc[0]);
                    urls = urls.concat(nestedUrls);
                }
            }

            this.logger.log(`Извлечено ${urls.length} URLs`);
            return urls;
        } catch (error) {
            this.logger.error(`Ошибка при извлечении sitemap ${sitemapUrl}`, error);
            return [];
        }
    }

    async crawlUrls(urls) {
        this.logger.log(`Запуск Chromium. URLs для обхода: ${urls.length}`);

        const browser = await puppeteer.launch({
            timeout: 60000,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-application-cache',
                '--disk-cache-size=0',
                '--disable-cache',
                '--disable-gpu'
            ]
        });

        try {
            const queue = [...urls];
            const workers = [];

            for (let i = 0; i < this.maxConcurrency; i++) {
                workers.push((async () => {
                    while (queue.length > 0) {
                        const url = queue.shift();
                        this.logger.log(`Обработка: ${url}`);
                        let page = null;

                        try {
                            page = await browser.newPage();
                            await page.setCacheEnabled(false);

                            // Блокируем "тяжелые" ресурсы
                            await page.setRequestInterception(true);
                            page.on('request', req => {
                                const skip = ['image', 'stylesheet', 'font', 'media'];
                                if (skip.includes(req.resourceType())) {
                                    req.abort();
                                } else {
                                    req.continue();
                                }
                            });

                            await page.goto(url, {
                                waitUntil: 'load',
                                timeout: 60000
                            });

                            this.logger.log(`OK: ${url}`);
                        } catch (err) {
                            this.logger.error(`Ошибка: ${url}`, err);
                        } finally {
                            if (page) await page.close();
                        }
                    }
                })());
            }

            await Promise.all(workers);
        } catch (err) {
            this.logger.error('Ошибка во время обхода', err);
        } finally {
            this.logger.log('Закрытие Chromium');
            await browser.close();
        }
    }

    async parse() {
        if (fs.existsSync(LOCK_FILE)) {
            this.logger.log('Найден lock-файл, предыдущий процесс не завершен. Прерывание.');
            return;
        }

        fs.writeFileSync(LOCK_FILE, `${Date.now()}`);
        this.logger.log('Создан lock-файл');

        try {
            for (const site of this.sites) {
                const sitemapUrl = `${site}/sitemap.xml`;
                this.logger.log(`Парсинг сайта: ${site}`);

                const urls = await this.extractSitemapUrls(sitemapUrl);
                if (urls.length > 0) {
                    await this.crawlUrls(urls);
                } else {
                    this.logger.log(`Нет URLs для обхода: ${site}`);
                }
            }
        } catch (err) {
            this.logger.error('Ошибка во время парсинга сайтов', err);
        } finally {
            fs.unlinkSync(LOCK_FILE);
            this.logger.log('Удален lock-файл. Завершено.');
        }
    }
}

// === Запуск ===
const sites = [
    'https://generator-energy.ru',
    'https://generator-energy.kz'
];

const parser = new SitemapParser(sites, 2);
parser.parse().catch(err => {
    console.error('Фатальная ошибка:', err);
});