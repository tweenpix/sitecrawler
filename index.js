// Обновленный скрипт прогрева композитного кэша Bitrix с Batch-механизмом без загрузки сторонних JS
const puppeteer = require('puppeteer');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const axios = require('axios');
const crypto = require('crypto');

const LOCK_FILE = '/tmp/bitrix_cache_warmer.lock';
const LOG_DIR = path.join(process.env.HOME || '.', 'logs', 'bitrix_cache_warmer');
const BATCH_SIZE = 50;

class BitrixCacheWarmer {
    constructor(sites, options = {}) {
        this.sites = sites;
        this.parser = new xml2js.Parser();
        this.maxConcurrency = options.maxConcurrency || 3;
        this.maxUrlsPerSite = options.maxUrlsPerSite || 0;
        this.userAgent = options.userAgent || 'Mozilla/5.0 (compatible; BitrixCacheWarmer/1.0; +https://example.com)';
        this.logger = this.createLogger();
        this.timeoutPerPage = options.timeoutPerPage || 60000;
        this.requestTimeout = options.requestTimeout || 20000;
        this.priorityPatterns = options.priorityPatterns || [];
        this.delay = options.delay || { min: 500, max: 2000 };

        this.bitrixSpecificConfig = {
            cookies: [
                { name: 'BITRIX_SM_GUEST_ID', value: this.generateRandomId(10) },
                { name: 'BITRIX_SM_LAST_VISIT', value: new Date().toISOString() }
            ],
            queryParams: [
                { name: 'clear_cache', value: 'Y' }
            ],
            successMarkers: [
                'window.BX',
                'BX.setCacheFlag',
                'BX.CompositeCache',
                'bxcompset'
            ],
            excludePatterns: [
                '/bitrix/',
                '/admin/',
                '/auth/',
                '/?login=',
                '/?logout=',
                '/ajax/',
                '.php'
            ]
        };
    }

    generateRandomId(length) {
        return crypto.randomBytes(length).toString('hex');
    }

    createLogger() {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const logFile = path.join(LOG_DIR, `cache_warming_${new Date().toISOString().split('T')[0]}.log`);
        return {
            log: msg => {
                const timestamp = new Date().toISOString();
                const line = `[${timestamp}] ${msg}\n`;
                console.log(line.trim());
                fs.appendFileSync(logFile, line);
            },
            error: (msg, err) => {
                const timestamp = new Date().toISOString();
                const detail = err?.stack || err?.message || err;
                const line = `[${timestamp}] ERROR: ${msg} - ${detail}\n`;
                console.error(line.trim());
                fs.appendFileSync(logFile, line);
            },
            stats: stats => {
                const timestamp = new Date().toISOString();
                const line = `[${timestamp}] STATS: ${JSON.stringify(stats)}\n`;
                console.log(line.trim());
                fs.appendFileSync(logFile, line);
            }
        };
    }

    async sleep(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    async extractSitemapUrls(sitemapUrl) {
        try {
            this.logger.log(`Извлечение URLs из sitemap: ${sitemapUrl}`);
            const response = await axios.get(sitemapUrl, {
                timeout: this.requestTimeout,
                headers: { 'User-Agent': this.userAgent }
            });
            const result = await this.parser.parseStringPromise(response.data);
            let urls = [];

            if (result.urlset?.url) {
                urls = result.urlset.url.map(u => ({
                    url: u.loc[0],
                    lastmod: u.lastmod?.[0] || '',
                    priority: parseFloat(u.priority?.[0] || '0.5')
                })).filter(u => u.url.startsWith('http')).filter(u => !this.isExcluded(u.url));
            }

            if (result.sitemapindex?.sitemap) {
                for (const nested of result.sitemapindex.sitemap) {
                    const nestedUrls = await this.extractSitemapUrls(nested.loc[0]);
                    urls = urls.concat(nestedUrls);
                }
            }

            this.logger.log(`Извлечено ${urls.length} URLs из ${sitemapUrl}`);
            return urls;
        } catch (error) {
            this.logger.error(`Ошибка при извлечении sitemap ${sitemapUrl}`, error);
            return [];
        }
    }

    isExcluded(url) {
        return this.bitrixSpecificConfig.excludePatterns.some(p => url.includes(p));
    }

    prioritizeUrls(urls) {
        urls.sort((a, b) => {
            for (const pattern of this.priorityPatterns) {
                const aMatch = a.url.includes(pattern);
                const bMatch = b.url.includes(pattern);
                if (aMatch && !bMatch) return -1;
                if (!aMatch && bMatch) return 1;
            }
            return b.priority - a.priority;
        });
        return this.maxUrlsPerSite > 0 ? urls.slice(0, this.maxUrlsPerSite) : urls;
    }

    addCacheParams(url) {
        const u = new URL(url);
        for (const param of this.bitrixSpecificConfig.queryParams) {
            u.searchParams.set(param.name, param.value);
        }
        return u.toString();
    }

    async warmCache(urls) {
        const startTime = Date.now();
        const stats = { total: urls.length, success: 0, cacheGenerated: 0, failed: 0 };

        for (let i = 0; i < urls.length; i += BATCH_SIZE) {
            const batch = urls.slice(i, i + BATCH_SIZE);
            this.logger.log(`Обработка батча ${i / BATCH_SIZE + 1} (${batch.length} URL)`);
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            for (const urlObj of batch) {
                const url = this.addCacheParams(urlObj.url);
                const originalUrl = urlObj.url;
                let page = null;
                try {
                    page = await browser.newPage();
                    await page.setUserAgent(this.userAgent);
                    const domain = new URL(url).hostname;
                    for (const cookie of this.bitrixSpecificConfig.cookies) {
                        await page.setCookie({ ...cookie, domain, path: '/' });
                    }
                    await page.setRequestInterception(true);
                    page.on('request', req => {
                        const type = req.resourceType();
                        const reqUrl = req.url();
                        if (['image', 'media', 'font'].includes(type) || reqUrl.includes('yandex') || reqUrl.includes('google') || reqUrl.includes('vk.com') || reqUrl.includes('facebook') || reqUrl.includes('gstat') || reqUrl.includes('ya.') || reqUrl.includes('tag')) {
                            req.abort();
                        } else {
                            req.continue();
                        }
                    });
                    await page.setDefaultNavigationTimeout(this.timeoutPerPage);
                    let response;
                    try {
                        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutPerPage });
                    } catch (err) {
                        this.logger.log(`Повторная попытка: ${url}`);
                        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutPerPage });
                    }
                    const status = response.status();
                    if (status >= 200 && status < 400) {
                        stats.success++;
                        const hasComposite = await page.evaluate(() => {
                            try {
                                return typeof window.BX !== 'undefined' && typeof BX.getCacheFlag === 'function' && BX.getCacheFlag() === true;
                            } catch { return false; }
                        });
                        if (hasComposite) {
                            stats.cacheGenerated++;
                            this.logger.log(`✓ КЭШ СОЗДАН: ${originalUrl}`);
                        } else {
                            this.logger.log(`✓ OK (без композита): ${originalUrl}`);
                        }
                    } else {
                        this.logger.error(`Статус ${status}: ${originalUrl}`);
                        stats.failed++;
                    }
                } catch (err) {
                    this.logger.error(`Ошибка: ${originalUrl}`, err);
                    stats.failed++;
                } finally {
                    if (page) await page.close();
                    await this.sleep(Math.floor(Math.random() * (this.delay.max - this.delay.min) + this.delay.min));
                }
            }

            await browser.close();
            this.logger.log('Chromium закрыт после батча');
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        stats.executionTime = `${totalTime}s`;
        this.logger.stats(stats);
    }

    async warm() {
        if (fs.existsSync(LOCK_FILE)) {
            const lockTime = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
            const hoursPassed = (Date.now() - lockTime) / (1000 * 60 * 60);
            if (hoursPassed < 3) {
                this.logger.log(`Lock-файл существует (${hoursPassed.toFixed(2)} ч). Прерывание.`);
                return;
            } else {
                this.logger.log(`Удаление устаревшего lock-файла (${hoursPassed.toFixed(2)} ч).`);
                fs.unlinkSync(LOCK_FILE);
            }
        }

        fs.writeFileSync(LOCK_FILE, `${Date.now()}`);
        this.logger.log('Создан lock-файл');

        try {
            for (const site of this.sites) {
                const sitemapUrl = `${site}/sitemap.xml`;
                this.logger.log(`Парсинг сайта: ${site}`);
                const urls = await this.extractSitemapUrls(sitemapUrl);
                if (urls.length > 0) {
                    const prioritized = this.prioritizeUrls(urls);
                    this.logger.log(`Выбрано URL: ${prioritized.length}`);
                    await this.warmCache(prioritized);
                } else {
                    this.logger.log(`Нет URL для подогрева: ${site}`);
                }
            }
        } catch (err) {
            this.logger.error('Ошибка во время подогрева', err);
        } finally {
            fs.unlinkSync(LOCK_FILE);
            this.logger.log('Удален lock-файл. Завершено.');
        }
    }
}

const sites = [
    'https://generator-energy.ru',
    'https://generator-energy.kz'
];

const options = {
    maxConcurrency: 2,
    maxUrlsPerSite: 0,
    userAgent: 'Mozilla/5.0 (compatible; BitrixCacheWarmer/1.0)',
    timeoutPerPage: 60000,
    delay: { min: 1000, max: 3000 },
    priorityPatterns: ['/generatory/']
};

const warmer = new BitrixCacheWarmer(sites, options);
warmer.warm().catch(err => {
    console.error('Фатальная ошибка:', err);
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
});