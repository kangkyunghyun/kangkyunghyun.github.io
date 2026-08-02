import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
	schema: z.object({
		title: z.string(),
		date: z.coerce.date(),
		// 카테고리는 안 씀 — 태그 하나로만 분류한다
		tags: z.array(z.string()).default([]),
		draft: z.boolean().default(false),
	}),
});

const projects = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
	schema: z.object({
		title: z.string(),
		summary: z.string(),
		period: z.string(),
		role: z.string(),
		/** 카드에 붙는 파란 배지. 한 개만 */
		badge: z.string().optional(),
		/** 지금 서비스가 살아 있으면 true. 초록 '운영 중' 배지가 붙는다 */
		live: z.boolean().default(false),
		/** public/logos/ 아래 파일명. 없으면 로고 자리를 비운다 */
		logo: z.string().optional(),
		team: z.string().optional(),
		stack: z.array(z.string()).default([]),
		/** AS-IS → TO-BE 2열 비교. 둘 다 비면 섹션이 통째로 안 나온다 */
		asIs: z.array(z.string()).default([]),
		toBe: z.array(z.string()).default([]),
		links: z
			.array(z.object({ label: z.string(), href: z.string() }))
			.default([]),
		draft: z.boolean().default(false),
	}),
});

export const collections = { posts, projects };
