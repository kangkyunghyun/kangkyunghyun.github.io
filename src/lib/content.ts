import type { CollectionEntry } from 'astro:content';

/** 글 목록과 상세 이동 링크에서 같은 순서를 사용한다. */
export const sortPosts = (posts: CollectionEntry<'posts'>[]) =>
	[...posts].sort(
		(a, b) =>
			b.data.date.getTime() - a.data.date.getTime() ||
			a.id.localeCompare(b.id),
	);

/** 마크다운 본문에서 목록과 메타 태그에 쓸 첫 문단을 뽑는다. */
export const excerptOf = (body = '', maxLength = 160) => {
	const clean = (line: string) =>
		line
			.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/[*_`]/g, '')
			.trim();

	const text = body
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/```[\s\S]*?```/g, '')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !/^([#>|\-*]|!\[|\[!|---|https?:\/\/)/.test(line))
		.map(clean)
		.find(
			(line) =>
				// 짧은 이미지 캡션 대신 설명으로 쓸 만한 본문을 고른다.
				line.length >= 40 &&
				!/^https?:\/\//.test(line) &&
				!/^(시작|종료|기간|일시|장소)\s*[::]/.test(line) &&
				!/^[(（].*[)）]$/.test(line),
		);

	if (!text) return '';
	return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
};

/** 마크다운 본문 첫 이미지를 소셜 공유 대표 이미지로 쓴다. */
export const imageOf = (body = '') =>
	body.match(/!\[[^\]]*\]\((\/images\/[^)\s]+)\)/)?.[1] ?? null;
