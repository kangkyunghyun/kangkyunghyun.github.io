import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
	const origin = site ?? new URL('https://kangkyunghyun.github.io');
	const body = [
		'User-agent: *',
		'Allow: /',
		'',
		`Sitemap: ${new URL('/sitemap.xml', origin).href}`,
		'',
	].join('\n');

	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
