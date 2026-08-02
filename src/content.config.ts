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
		/** 목록 정렬용. 작을수록 위 */
		order: z.number().default(99),
		draft: z.boolean().default(false),
	}),
});

export const collections = { posts, projects };
