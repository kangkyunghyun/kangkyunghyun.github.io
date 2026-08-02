import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { escapeXml } from '../lib/xml';

export const GET: APIRoute = async ({ site }) => {
	const origin = site ?? new URL('https://kangkyunghyun.github.io');
	const posts = await getCollection('posts', ({ data }) => !data.draft);
	const projects = await getCollection('projects', ({ data }) => !data.draft);

	const urls = [
		{ path: '/', priority: '1.0', changefreq: 'monthly' },
		{ path: '/blog/', priority: '0.9', changefreq: 'weekly' },
		...posts.map((post) => ({
			path: `/posts/${post.id}/`,
			priority: '0.8',
			changefreq: 'monthly',
			lastmod: post.data.date.toISOString().slice(0, 10),
		})),
		...projects.map((project) => ({
			path: `/projects/${project.id}/`,
			priority: '0.7',
			changefreq: 'monthly',
		})),
	];

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
	.map(
		(url) => `  <url>
    <loc>${escapeXml(new URL(url.path, origin).href)}</loc>${
			'lastmod' in url ? `\n    <lastmod>${url.lastmod}</lastmod>` : ''
		}
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`,
	)
	.join('\n')}
</urlset>
`;

	return new Response(body, {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' },
	});
};
