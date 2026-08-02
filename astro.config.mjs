// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// 배포처 정해지면 여기만 바꾸면 됨 (canonical·RSS가 이 값을 씀)
	site: 'https://kangkyunghyun.github.io',
	markdown: {
		// 코드 블록도 OS 라이트/다크를 따라가게 두 테마를 같이 넣는다.
		// defaultColor: false 로 두면 색이 --shiki-light / --shiki-dark
		// 변수로만 나오고, 실제 적용은 Base.astro 의 CSS가 한다
		shikiConfig: {
			themes: { light: 'github-light', dark: 'github-dark-dimmed' },
			defaultColor: false,
		},
	},
});
