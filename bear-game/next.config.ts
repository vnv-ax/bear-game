import type { NextConfig } from 'next';

/**
 * Конфигурация Next.js.
 *
 * Локальная разработка:      npm run dev
 * Статический экспорт:       PAGES_EXPORT=1 next build  ->  папка out/
 * Для GitHub Pages (репозиторий vnv-ax/bear-game):
 *                            NEXT_PUBLIC_BASE_PATH=/bear-game PAGES_EXPORT=1 next build
 *                            (см. также .github/workflows/deploy-pages.yml)
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const isExport = process.env.PAGES_EXPORT === '1';

const nextConfig: NextConfig = {
  // статический экспорт для GitHub Pages
  ...(isExport ? { output: 'export' as const } : {}),
  // базовый путь, если игра размещается в подкаталоге (например /bear-game)
  ...(basePath
    ? { basePath, assetPrefix: basePath }
    : {}),
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
