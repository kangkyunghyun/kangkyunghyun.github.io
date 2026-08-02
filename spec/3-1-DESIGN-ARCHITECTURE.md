# 3-1. 설계: 아키텍처

디렉터리, 라우팅, 콘텐츠 스키마, 스타일 토큰을 기록한다. 코드에서 확인 가능한 사실만 적는다.

```text
§3-1-1   구성            버전과 디렉터리
§3-1-2   라우팅          URL과 생성 규칙
§3-1-3   콘텐츠 스키마    프런트매터 계약
§3-1-4   스타일 토큰      색·타이포·레이아웃 변수
§3-1-5   전역 CSS 주의    깨지기 쉬운 지점
```

## 3-1-1 구성

| 항목 | 값 |
| --- | --- |
| 프레임워크 | Astro 7.1.6 (`package.json`) |
| 출력 | `static` |
| 런타임 의존성 | 없음 |
| 빌드 의존성 | `astro` 하나 |
| Node | `>=22.12.0` |

```text
astro.config.mjs                site URL, shiki 듀얼 테마
src/content.config.ts           posts 컬렉션 정의
src/content/posts/*.md          글
src/layouts/Base.astro          공통 셸 + 전역 스타일 전부
src/components/Timeline.astro   기간-제목-설명 3열 타임라인
src/pages/index.astro           포트폴리오 (메인)
src/pages/blog.astro            글 목록
src/pages/posts/[...slug].astro 글 상세
.github/workflows/deploy.yml    Pages 배포
```

전역 스타일은 `Base.astro`의 `<style is:global>` 한 곳에만 둔다. 페이지별 스타일은 각 `.astro` 파일의 스코프 `<style>`에 둔다. CSS 파일을 따로 만들지 않는다. `MUST`

## 3-1-2 라우팅

| URL | 내용 | 파일 | 생성 |
| --- | --- | --- | --- |
| `/` | 포트폴리오 한 페이지 | `src/pages/index.astro` | 정적 |
| `/blog` | 글 목록 | `src/pages/blog.astro` | 정적 |
| `/posts/<파일명>` | 글 상세 | `src/pages/posts/[...slug].astro` | `getStaticPaths`로 글마다 생성 |

메인은 블로그가 아니라 **포트폴리오**다. 채용·협업 판단에 필요한 것이 한 페이지에 다 있어야 하고(§[2-1](2-REQUIREMENTS.md) U2), 블로그는 헤더에서 한 번 눌러 들어간다. 헤더의 `블로그`는 `/blog`와 `/posts/*` 양쪽에서 활성으로 보여야 한다.

글의 URL 슬러그는 **파일명 그대로**다. 별도 슬러그 필드가 없다. 따라서 파일명을 바꾸면 URL이 바뀌고 기존 링크가 끊긴다. 발행한 글의 파일명은 바꾸지 않는다. `MUST`

`draft: true`인 글은 목록과 상세 모두에서 제외된다. 두 곳 다 `getCollection('posts', ({ data }) => !data.draft)`로 거른다.

## 3-1-3 콘텐츠 스키마

`src/content.config.ts`에서 `glob` 로더로 `src/content/posts/**/*.md`를 읽는다.

| 필드 | 타입 | 필수 | 비고 |
| --- | --- | --- | --- |
| `title` | string | 필수 | 목록·상세·`<title>`에 쓰임 |
| `date` | date | 필수 | `z.coerce.date()`. `YYYY-MM-DD` 문자열 허용 |
| `tags` | string[] | 선택 | 기본 `[]`. 분류는 이것 하나뿐 |
| `draft` | boolean | 선택 | 기본 `false` |

스키마에 없는 필드를 프런트매터에 쓰면 빌드가 실패한다. 필드를 늘릴 때는 [README](README.md) 변경 원칙 1을 따른다.

## 3-1-4 스타일 토큰

`Base.astro`의 `:root`에 정의하며, 다크 모드는 `prefers-color-scheme: dark`에서 같은 변수를 덮어쓴다.

| 변수 | 라이트 | 다크 | 용도 |
| --- | --- | --- | --- |
| `--fg` | `#09090b` | `#fafafa` | 본문 |
| `--dim` | `#52525b` | `#a1a1aa` | 보조 텍스트, 날짜 |
| `--bg` | `#fafafa` | `#0c0c0e` | 배경 |
| `--line` | `#e4e4e7` | `#27272a` | 구분선 |
| `--measure` | `44rem` | — | 본문 폭 |
| `--pad` | `clamp(1.25rem, 5vw, 2.5rem)` | — | 좌우 여백 |

색은 무채색만 쓴다. 강조는 색이 아니라 굵기와 여백으로 만든다. 브랜드 색을 도입하려면 결정 기록을 남긴다. `SHOULD`

폰트는 시스템 스택(`Pretendard` → `system-ui` → `Apple SD Gothic Neo`)이며 웹폰트를 불러오지 않는다. 근거는 [3-2](3-2-DESIGN-DECISIONS.md) §3-2-4.

## 3-1-5 전역 CSS 주의

전역 CSS에서 `header`, `footer` 같은 **태그 셀렉터를 그대로 쓰지 않는다.** 글 상세의 `<header class="head">`까지 잡혀 제목 레이아웃이 깨진다. 실제로 한 번 발생했고 `.site-header` / `.site-footer`로 좁혀 고쳤다. `MUST`

`Base.astro`의 전역 스타일을 고친 뒤 브라우저에 반영이 안 되면 개발 서버가 이전 CSS를 물고 있는 경우다. `astro dev stop` → `.astro` 삭제 → 재시작한다.
