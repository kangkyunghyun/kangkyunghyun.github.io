import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { excerptOf } from '../lib/content';
import { escapeXml } from '../lib/xml';

export const GET: APIRoute = async ({ site }) => {
	const origin = site ?? new URL('https://kangkyunghyun.github.io');
	const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
		(a, b) => b.data.date.getTime() - a.data.date.getTime(),
	);
	const feedUrl = new URL('/rss.xml', origin).href;
	const blogUrl = new URL('/blog/', origin).href;

	const items = posts
		.map((post) => {
			const url = new URL(`/posts/${post.id}/`, origin).href;
			const description =
				excerptOf(post.body) || `${post.data.title}에 관한 강경현의 글입니다.`;
			return `    <item>
      <title>${escapeXml(post.data.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <description>${escapeXml(description)}</description>
      <pubDate>${post.data.date.toUTCString()}</pubDate>
${post.data.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`).join('\n')}
    </item>`;
		})
		.join('\n');

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>강경현 블로그</title>
    <link>${escapeXml(blogUrl)}</link>
    <description>개발하며 겪은 문제와 그때 내린 결정을 기록합니다.</description>
    <language>ko-KR</language>
    <lastBuildDate>${posts[0]?.data.date.toUTCString() ?? new Date(0).toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

	return new Response(body, {
		headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
	});
};
