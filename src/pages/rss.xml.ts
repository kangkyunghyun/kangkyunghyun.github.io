import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { excerptOf } from '../lib/content';

export const GET: APIRoute = async ({ site }) => {
	const origin = site ?? new URL('https://kangkyunghyun.github.io');
	const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
		(a, b) => b.data.date.getTime() - a.data.date.getTime(),
	);

	return rss({
		title: '강경현 블로그',
		description: '개발하며 겪은 문제와 그때 내린 결정을 기록합니다.',
		site: origin,
		xmlns: { atom: 'http://www.w3.org/2005/Atom' },
		customData: `<link>${new URL('/blog/', origin).href}</link><language>ko-KR</language><lastBuildDate>${posts[0]?.data.date.toUTCString() ?? new Date(0).toUTCString()}</lastBuildDate><atom:link href="${new URL('/rss.xml', origin).href}" rel="self" type="application/rss+xml" />`,
		items: posts.map((post) => ({
			title: post.data.title,
			link: `/posts/${post.id}/`,
			description:
				excerptOf(post.body) || `${post.data.title}에 관한 강경현의 글입니다.`,
			pubDate: post.data.date,
			categories: post.data.tags,
		})),
	});
};
