# kangkyunghyun.github.io

강경현의 기술 블로그 겸 포트폴리오. 개발·기술 회고 위주. Astro + GitHub Pages.

제품·설계·운영 기준은 [spec/](spec/README.md)에 있다. 결정의 근거가 필요하면 [spec/3-2-DESIGN-DECISIONS.md](spec/3-2-DESIGN-DECISIONS.md)를 먼저 본다.

## 이 블로그의 규칙

- **페이지 종류는 넷** — 포트폴리오(`/`) / 글 목록(`/blog`) / 글 상세(`/posts/<파일명>`) / 프로젝트 상세(`/projects/<파일명>`). 더 늘리지 않는다. 메인은 블로그가 아니라 포트폴리오이며, 이력은 한 페이지에서 끝나야 한다.
- **의존성은 `astro` 하나.** 댓글이 필요해지면 giscus 스크립트 한 줄, 검색은 글이 30편 넘기 전엔 안 만든다. 어드민·CMS는 만들지 않는다 — 마크다운 파일이 CMS다.
- **분류는 `tags` 하나로만.** 카테고리는 쓰지 않는다. 둘 다 있으면 둘 다 관리 안 된다.
- 글은 `src/content/posts/*.md`, 프로젝트는 `src/content/projects/*.md`. 스키마는 `src/content.config.ts`. 프로젝트는 메인 카드와 상세 페이지가 같은 파일 하나를 읽으므로 카드용 데이터를 따로 만들지 않는다.
- 사용자는 에디터를 열지 않는다. 글 요청이 오면 마크다운 작성부터 커밋·push까지 이쪽에서 한다.

기존 블로그 <https://khyunx.tistory.com>(348편, 알고리즘·PS 위주)는 그대로 살아 있다. 옛 글을 옮길 때 티스토리 원문을 지우지 말고 본문만 이전 안내 링크로 갈아끼운다.

## Git 컨벤션

`main` 단일 브랜치로만 작업한다. 브랜치를 새로 만들지 않으므로 신경 쓸 것은 커밋 메시지뿐이다.

```text
{태그}: {제목}

- {내용}
- {내용}
```

- 제목과 본문은 한국어로 쓴다.
- 제목과 본문 사이에 빈 줄 하나. 본문 bullet 사이에는 빈 줄을 넣지 않는다.
- 제목만으로 충분하면 본문은 생략한다.
- 제목은 "무엇을 했다"가 바로 보이게 짧게. 끝에 마침표를 붙이지 않는다.
- 파일명 나열보다 변경 의도를 쓴다.
- 본문은 제목만으로 부족할 때만 1~3개 bullet.

| 태그 | 기준 |
|---|---|
| `Feat` | 새로운 기능 추가 |
| `Fix` | 버그 수정 |
| `Post` | 글 추가·수정 |
| `Docs` | 문서 수정 |
| `Design` | UI, 스타일, 디자인 수정 |
| `CICD` | 배포, CI/CD 설정 수정 |
| `Refactor` | 기능 변화 없는 코드 구조 개선 |
| `Chore` | 설정, 의존성, 기타 유지보수 |

`Init`은 저장소 초기 설정 커밋에만 쓴다.

### 커밋 절차

1. 커밋 전에 변경사항을 반드시 읽는다 — `git diff --stat`, `git diff --name-status`. 새 파일은 내용을 직접 확인한다.
2. 코드 변경이면 `npm run build`를 먼저 돌린다. 못 돌렸으면 이유를 보고에 남긴다.
3. 검토한 파일만 stage한다. `git add -- path/to/file ...` 형태로 명시한다.
4. 본문이 있는 커밋은 메시지 파일을 만들어 `git commit --file <파일>`로 커밋한다.
5. `git log -1 --oneline`과 `git status --short`로 결과를 확인한다.

### 금지

- **커밋 메시지에 `Co-Authored-By` 트레일러를 넣지 않는다.** 어떤 경우에도.
- 변경사항을 읽기 전에 `git add .` 또는 `git commit -am`을 실행하지 않는다.
- 본문 bullet을 `-m` 옵션 여러 개로 나눠 전달하지 않는다. Git이 각각을 별도 문단으로 처리해 빈 줄이 끼어든다.
- `git reset`, `git checkout --`, `git clean`, `git stash`, `rm`으로 사용자 변경사항을 정리하지 않는다.
- 관련 없는 변경사항을 한 커밋에 묶지 않는다.
- 빌드 실패나 남은 unstaged 변경사항을 숨기지 않는다.

## 개발

```bash
astro dev --background   # astro dev stop | status | logs
npm run build
```

`src/layouts/Base.astro`의 전역 스타일을 고친 뒤 브라우저에 반영이 안 되면 dev 서버가 예전 CSS를 물고 있는 것이다. `astro dev stop` 후 `.astro`를 지우고 재시작한다.

전역 CSS에서 `header` / `footer` 같은 태그 셀렉터를 그냥 쓰지 않는다. 글 본문 안의 `<header>`까지 잡아 제목 레이아웃이 깨진다. `.site-header` / `.site-footer`로 좁힌다.

## 문서

전체 문서: https://docs.astro.build

- [페이지·동적 라우트·미들웨어](https://docs.astro.build/en/guides/routing/)
- [Astro 컴포넌트](https://docs.astro.build/en/basics/astro-components/)
- [콘텐츠 컬렉션](https://docs.astro.build/en/guides/content-collections/)
- [스타일링](https://docs.astro.build/en/guides/styling/)
