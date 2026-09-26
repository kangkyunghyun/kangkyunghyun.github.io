// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mermaid from 'astro-mermaid';

const postsDirectory = new URL('./src/content/posts/', import.meta.url);
const postDates = new Map(
	readdirSync(postsDirectory, { recursive: true })
		.filter((file) => file.endsWith('.md'))
		.map((file) => {
			const source = readFileSync(new URL(file, postsDirectory), 'utf8');
			const date = source.match(/^date:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
			return [`/posts/${file.replace(/\.md$/, '')}/`, date];
		}),
);

// https://astro.build/config
export default defineConfig({
	// 배포처 정해지면 여기만 바꾸면 됨 (canonical·RSS가 이 값을 씀)
	site: 'https://kangkyunghyun.github.io',
	integrations: [
		mermaid({
			theme: 'default',
			autoTheme: true,
			enableLog: false,
		}),
		sitemap({
			filter(page) {
				const path = new URL(page).pathname;
				return (
					path === '/' ||
					path === '/blog/' ||
					path.startsWith('/posts/') ||
					path.startsWith('/projects/')
				);
			},
			serialize(item) {
				const path = new URL(item.url).pathname;
				if (path === '/') return { ...item, changefreq: 'monthly', priority: 1 };
				if (path === '/blog/') return { ...item, changefreq: 'weekly', priority: 0.9 };
				if (path.startsWith('/posts/')) {
					return {
						...item,
						lastmod: postDates.get(path),
						changefreq: 'monthly',
						priority: 0.8,
					};
				}
				return { ...item, changefreq: 'monthly', priority: 0.7 };
			},
		}),
	],
	markdown: {
		// 코드 블록도 OS 라이트/다크를 따라가게 두 테마를 같이 넣는다.
		// 라이트는 high-contrast 판을 쓴다. 기본 github-light 는 일부 토큰이
		// 카드 면 위에서 4.5:1 에 못 미친다.
		// defaultColor: false 로 두면 색이 --shiki-light / --shiki-dark
		// 변수로만 나오고, 실제 적용은 Base.astro 의 CSS가 한다
		shikiConfig: {
			themes: { light: 'github-light-high-contrast', dark: 'github-dark-dimmed' },
			defaultColor: false,
		},
	},
});
