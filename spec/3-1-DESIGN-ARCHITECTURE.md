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
astro.config.mjs                   site URL, shiki 듀얼 테마
src/content.config.ts              posts / projects 컬렉션 정의
src/content/posts/*.md             글
src/content/projects/*.md          프로젝트
src/layouts/Base.astro             공통 셸 + 전역 스타일 전부
src/components/Timeline.astro      기간-제목-설명 타임라인
src/components/Icon.astro          lucide 아이콘 path 모음
src/pages/index.astro              포트폴리오 (메인)
src/pages/blog.astro               글 목록
src/pages/posts/[...slug].astro    글 상세
src/pages/projects/[...slug].astro 프로젝트 상세
.github/workflows/deploy.yml       Pages 배포
```

전역 스타일은 `Base.astro`의 `<style is:global>` 한 곳에만 둔다. 페이지별 스타일은 각 `.astro` 파일의 스코프 `<style>`에 둔다. CSS 파일을 따로 만들지 않는다. `MUST`

## 3-1-2 라우팅

| URL | 내용 | 파일 | 생성 |
| --- | --- | --- | --- |
| `/` | 포트폴리오 한 페이지 | `src/pages/index.astro` | 정적 |
| `/blog` | 글 목록 | `src/pages/blog.astro` | 정적 |
| `/posts/<파일명>` | 글 상세 | `src/pages/posts/[...slug].astro` | `getStaticPaths`로 글마다 생성 |
| `/projects/<파일명>` | 프로젝트 상세 | `src/pages/projects/[...slug].astro` | `getStaticPaths`로 프로젝트마다 생성 |

메인의 섹션 순서는 Projects → Tech Stacks → Activity → Education → Certifications → Awards다. 프로젝트가 가장 강한 근거라 맨 위에 둔다. 항목 표기는 **GitHub 프로필 README를 따르고**(Tech Stacks만 노션 출처), 날짜는 국립국어원 표기를 따라 `YYYY. M.` 형식으로 쓴다 — 월에 0을 채우지 않는다. 0을 채우는 것은 ISO 8601(`YYYY-MM`)의 규칙이며 점 표기와 섞지 않는다. 섹션명 `Activity`는 나중에 경력이 생겼을 때 `Work Experience`와 구분하려고 유지한다. 각 섹션은 푸터 Quick Links가 가리키는 앵커 `id`를 갖는다. 외부 링크는 별도 섹션이 아니라 히어로 바로 아래 버튼 줄에 둔다 — 연락 수단은 페이지 끝까지 내려가야 보이면 안 된다. 이력 데이터의 출처는 GitHub 프로필 README와 노션 개인 소개 페이지 두 곳이고, 값이 어긋나면 최신 쪽을 쓰되 [3-2](3-2-DESIGN-DECISIONS.md) §3-2-6에 기록한다.

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

### projects 컬렉션

`src/content/projects/**/*.md`. 프로젝트 하나가 마크다운 파일 하나이며, 메인의 Projects 카드와 상세 페이지가 **같은 파일 하나**를 읽는다. 카드용 데이터를 따로 두지 않는다.

| 필드 | 타입 | 필수 | 비고 |
| --- | --- | --- | --- |
| `title` | string | 필수 | 상세 페이지 상단 대형 워드마크 |
| `summary` | string | 필수 | 카드 설명이자 상세 페이지 부제 |
| `period` | string | 필수 | 표시용 문자열. 날짜 타입이 아니다 |
| `role` | string | 필수 | 맡은 역할 |
| `badge` | string | 선택 | 카드의 파란 배지. 한 개만 |
| `logo` | string | 선택 | `public/logos/` 아래 파일명 |
| `team` | string | 선택 | 팀 구성 |
| `stack` | string[] | 선택 | 상세 페이지 하단 칩 |
| `asIs` / `toBe` | string[] | 선택 | 2열 비교. 둘 다 비면 섹션이 통째로 빠진다 |
| `links` | {label, href}[] | 선택 | 상단 외부 링크 |
| `order` | number | 선택 | 목록 정렬. 작을수록 위. 기본 99 |
| `draft` | boolean | 선택 | 기본 `false` |

AS-IS → TO-BE만 본문이 아니라 프런트매터에 있다. 2열 비교를 마크다운으로 쓰면 표가 되어 모바일에서 깨지기 때문이다.

## 3-1-4 스타일 토큰

`Base.astro`의 `:root`에 정의하며, 다크 모드는 `prefers-color-scheme: dark`에서 같은 변수를 덮어쓴다.

| 변수 | 라이트 | 다크 | 용도 |
| --- | --- | --- | --- |
| `--fg` | `#191f28` | `#f9fafb` | 본문 |
| `--fg2` | `#4e5968` | `#b0b8c1` | 보조 텍스트 |
| `--fg3` | `#8b95a1` | `#6b7684` | 날짜, 라벨 |
| `--bg` | `#ffffff` | `#17171c` | 배경 |
| `--surface` | `#f9fafb` | `#202127` | 카드·칩 면 |
| `--line` | `#f2f4f6` | `#2b2d36` | 구분선 |
| `--blue` | `#3182f6` | `#4593fc` | 포인트 (링크, 배지, 포커스) |
| `--r` | `18px` | — | 카드 모서리 |
| `--measure` | `54rem` | — | 셸 폭 (헤더·메인·푸터 공통) |
| `--pad` | `clamp(1rem, 4vw, 1.5rem)` | — | 좌우 여백 |

**글 본문은 `--measure`를 따르지 않는다.** 포트폴리오와 목록은 넓은 셸을 쓰지만, 글 상세의 `article`은 `42rem`으로 따로 좁힌다. 한 줄이 길어지면 읽기 속도가 떨어지기 때문이며, 셸 폭을 넓힐 때 본문까지 같이 넓히지 않는다. `MUST`

면과 면은 선이 아니라 **배경색 차이**로 나눈다. 카드에 테두리를 두르지 않는다. 색은 그레이 스케일에 파랑 하나뿐이며, 두 번째 강조색을 도입하려면 결정 기록을 남긴다. `SHOULD`

시각 언어의 출처는 `~/.claude/skills/toss-tech-design`에 함께 든 스크린샷 2장이다. 해당 스킬 본문은 설계 운영 방법론이라 색·타이포 스펙을 담고 있지 않다.

폰트는 시스템 스택(`Pretendard` → `system-ui` → `Apple SD Gothic Neo`)이며 웹폰트를 불러오지 않는다. 근거는 [3-2](3-2-DESIGN-DECISIONS.md) §3-2-4.

## 3-1-5 전역 CSS 주의

전역 CSS에서 `header`, `footer` 같은 **태그 셀렉터를 그대로 쓰지 않는다.** 글 상세의 `<header class="head">`까지 잡혀 제목 레이아웃이 깨진다. 실제로 한 번 발생했고 `.site-header` / `.site-footer`로 좁혀 고쳤다. `MUST`

`Base.astro`의 전역 스타일을 고친 뒤 브라우저에 반영이 안 되면 개발 서버가 이전 CSS를 물고 있는 경우다. `astro dev stop` → `.astro` 삭제 → 재시작한다.
