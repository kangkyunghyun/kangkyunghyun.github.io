# kangkyunghyun.github.io

강경현의 포트폴리오 겸 기술 블로그. 개발하며 겪은 문제와 그때 내린 결정을 기록합니다.

**<https://kangkyunghyun.github.io>**

## 구성

Astro로 빌드하는 정적 사이트입니다. **런타임 의존성이 없고, 빌드 의존성은 `astro` 하나**입니다. 외부 API를 호출하지 않으므로 남의 서비스가 바뀌어서 사이트가 죽는 일이 없습니다.

| 경로 | 내용 |
| --- | --- |
| `/` | 포트폴리오 — 프로젝트·기술 스택·활동·학력·자격·수상 |
| `/blog` | 글 목록 |
| `/posts/<파일명>` | 글 상세 |
| `/projects/<파일명>` | 프로젝트 상세 |

```text
src/content/posts/*.md       글
src/content/projects/*.md    프로젝트 (메인 카드와 상세가 같은 파일을 읽음)
src/content.config.ts        두 컬렉션의 프런트매터 스키마
src/layouts/Base.astro       공통 셸과 전역 스타일 전부
src/components/              Timeline · Icon · Toc
public/images/<슬러그>/       본문 이미지
tools/import-tistory.py      티스토리 글 이관 (표준 라이브러리만)
spec/                        제품·설계·운영 기준
```

## 실행

```bash
npm install
npm run dev      # localhost:4321
npm run build    # dist/
```

`main`에 푸시하면 GitHub Actions가 GitHub Pages로 배포합니다. 별도의 배포 절차는 없습니다.

## 글·프로젝트 추가

`src/content/` 아래에 마크다운 파일을 만들면 됩니다. 프런트매터는 `src/content.config.ts`의 스키마를 따르고, 스키마에 없는 필드를 쓰면 빌드가 실패합니다.

티스토리에서 옮길 때는 이관 스크립트를 씁니다.

```bash
python3 tools/import-tistory.py <글 URL> [슬러그]
```

자세한 절차는 [spec/4-CONTENT-OPERATIONS.md](spec/4-CONTENT-OPERATIONS.md)에 있습니다.

## 문서

이 저장소는 결정의 근거를 문서로 남깁니다. 화면이나 규칙을 고치기 전에 읽어 주세요.

| 문서 | 내용 |
| --- | --- |
| [spec/README.md](spec/README.md) | 문서 인덱스와 변경 원칙 |
| [spec/1-BACKGROUND.md](spec/1-BACKGROUND.md) | 왜 만드는가, 범위 밖 항목 |
| [spec/2-REQUIREMENTS.md](spec/2-REQUIREMENTS.md) | 독자·운영자 요구사항, 품질 기준 |
| [spec/3-1-DESIGN-ARCHITECTURE.md](spec/3-1-DESIGN-ARCHITECTURE.md) | 라우팅, 콘텐츠 스키마, 스타일 토큰 |
| [spec/3-2-DESIGN-DECISIONS.md](spec/3-2-DESIGN-DECISIONS.md) | 되돌리기 비싼 결정과 재검토 조건 |
| [spec/4-CONTENT-OPERATIONS.md](spec/4-CONTENT-OPERATIONS.md) | 글·프로젝트 작성, 티스토리 이관 |
| [spec/7-DEPLOYMENT.md](spec/7-DEPLOYMENT.md) | 배포와 릴리스 검증 |

작업 규칙(커밋 컨벤션 포함)은 [AGENTS.md](AGENTS.md)에 있습니다.

---

기존 블로그 <https://khyunx.tistory.com>(348편, 알고리즘·CS 기록)은 그대로 운영합니다.
