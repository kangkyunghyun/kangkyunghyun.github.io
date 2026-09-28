// 포트폴리오(/)가 읽는 이력 정본. 여기 한 곳만 고친다.
import { getCollection } from 'astro:content';

export const name = '강경현';
export const role = 'Backend Engineer';
export const lead = '아이디어를 실제 서비스로 구현하고 사용자에게 전달하는 과정을 즐깁니다.';

// 프로젝트는 src/content/projects/*.md 가 원본이다.
// 정렬은 period 앞머리(`YYYY. M.`)를 읽어 최신순으로 한다 —
// 수동 순번을 두면 프로젝트가 늘 때마다 손으로 맞춰야 하고 반드시 어긋난다.
const startedAt = (period: string) => {
	const m = period.match(/(\d{4})\.\s*(\d{1,2})\./);
	return m ? Number(m[1]) * 12 + Number(m[2]) : 0;
};
export const getProjects = async () =>
	(await getCollection('projects', ({ data }) => !data.draft)).sort(
		(a, b) =>
			startedAt(b.data.period) - startedAt(a.data.period) ||
			a.data.title.localeCompare(b.data.title),
	);

// 출처: github.com/kangkyunghyun 프로필 README
export const education = [
	{
		period: '2022. 3. ~ 현재',
		title: '경희대학교',
		aside: '컴퓨터공학과',
		desc: 'GPA 4.09 / 4.5',
	},
];

type Entry = {
	period: string;
	title: string;
	aside?: string;
	desc?: string;
	href?: string;
};

// title 은 조직·활동명, aside 는 그 안에서의 역할(없으면 비운다),
// desc 는 그 조직이 무엇인지. 세 칸의 성격을 섞지 않는다.
export const activity: Entry[] = [
	{
		period: '2026. 4. ~ 현재',
		title: 'AI·SW 마에스트로',
		aside: '17기 연수생',
		desc: '과학기술정보통신부 SW 인재양성 사업',
		href: 'https://swmaestro.ai/',
	},
	{
		period: '2026. 3. ~ 현재',
		title: '알고리즘 멘토',
		aside: '강의 자료 제작, 과제 채점',
		desc: '경희대학교 SW중심대학사업단 KHU-SW멘토',
	},
	{
		period: '2025. 9. ~ 현재',
		title: 'HacKHU',
		aside: '기술 파트 운영진',
		desc: '경희대학교 해킹 동아리',
	},
	{
		period: '2025. 9. ~ 2026. 6.',
		title: 'KHUA',
		desc: '경희대학교 알고리즘 동아리',
	},
	{
		period: '2025. 9. ~ 2026. 2.',
		title: 'GDG on Campus KHU',
		aside: '백엔드 멤버',
		desc: '경희대학교 구글 개발자 커뮤니티',
		href: 'https://github.com/GDG-on-Campus-KHU',
	},
	{
		period: '2022. 3. ~ 현재',
		title: 'Hacker',
		desc: '경희대학교 소프트웨어융합대학 학술동아리',
	},
];

export const awards = [
	{
		period: '2026. 8.',
		title: '제12회 SCPC',
		aside: '본선 진출',
	},
	{
		period: '2026. 5.',
		title: '2026 경희대학교 봄 프로그래밍 경시대회',
		aside: '우수상 (3등)',
	},
	{
		period: '2026. 5.',
		title: '2026 SCSC computer programming contest Div.3',
		aside: 'Furiosa Prize (4등)',
	},
	{
		period: '2025. 10.',
		title: '2025 경희대학교 가을 프로그래밍 경시대회',
		aside: '장려상 (4등)',
	},
	{
		period: '2022. 9.',
		title: '2022 경희대학교 동아리 단합 공모전',
		aside: '장려상 (3등) · KHUromise',
		href: 'https://github.com/kangkyunghyun/khuromise',
	},
];

export const certs = [
	{ period: '2026. 5.', title: 'TOPCIT', aside: '수준 4 (672점)' },
	{ period: '2026. 3.', title: 'SQLD' },
	{ period: '2023. 4.', title: '정보처리기능사' },
];

// 출처: 노션 개인 소개 페이지 ▶ Tech Stacks
export const stacks = [
	['Backend', ['Kotlin', 'Java', 'Spring Boot']],
	['Database', ['PostgreSQL', 'MySQL', 'Redis']],
	['DevOps', ['AWS', 'Docker', 'Terraform', 'GitHub Actions', 'GCP']],
	['Observability', ['OpenTelemetry', 'Prometheus', 'Grafana', 'OpenSearch', 'Sentry']],
	['Problem Solving', ['C++']],
	['Analytics', ['Amplitude']],
	['Tools', ['Git/GitHub', 'Jira', 'Swagger']],
];

// handle 은 실제 주소를 그대로 보여준다. 클릭하지 않아도 읽히게.
// external: 새 탭으로 연다. mailto 는 새 탭을 열면 빈 탭이 남아 제외한다.
export const links = [
	{
		icon: 'github',
		label: 'GitHub',
		handle: '@kangkyunghyun',
		href: 'https://github.com/kangkyunghyun',
		external: true,
	},
	{
		icon: 'linkedin',
		label: 'LinkedIn',
		handle: 'in/kangkyunghyun',
		href: 'https://www.linkedin.com/in/kangkyunghyun/',
		external: true,
	},
	{
		icon: 'at',
		label: 'Threads',
		handle: '@khyun_x',
		href: 'https://www.threads.com/@khyun_x',
		external: true,
	},
	{
		icon: 'mail',
		label: 'Email',
		handle: 'kyunghyun.dev@gmail.com',
		href: 'mailto:kyunghyun.dev@gmail.com',
	},
];
