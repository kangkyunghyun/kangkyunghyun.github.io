# kangkyunghyun.github.io 스펙

강경현의 포트폴리오 겸 기술 블로그. 메인이 포트폴리오이고 블로그는 헤더에서 들어간다.

## 문서 상태

| 항목 | 값 |
| --- | --- |
| 상태 | Baseline v2 |
| 기준일 | 2026-08-02 |
| 제품명 | kangkyunghyun.github.io |
| 저장소 | <https://github.com/kangkyunghyun/kangkyunghyun.github.io> |

## 키워드

- `MUST` — 반드시 지킨다. 어기면 결함이다.
- `SHOULD` — 권장한다. 어길 때는 이유를 남긴다.
- `MAY` — 선택이다.

## 읽는 순서

```text
1      BACKGROUND            무엇을 왜 만드는가, 범위와 용어
2      REQUIREMENTS          독자와 운영자가 각각 무엇을 얻는가
3-1    DESIGN-ARCHITECTURE   디렉터리·라우팅·콘텐츠 스키마
3-2    DESIGN-DECISIONS      되돌리기 비싼 결정과 그 근거
4-1    BLOG-OPERATIONS       글을 쓰고 옮기는 절차
4-2    PORTFOLIO-OPERATIONS  이력·프로젝트에 무엇을 싣는가
7      DEPLOYMENT            빌드·배포·검증
```

## 책임 표

| 문서 | 책임 |
| --- | --- |
| [1-BACKGROUND](1-BACKGROUND.md) | 제품 정의, 목표, 범위 밖 항목, 용어 |
| [2-REQUIREMENTS](2-REQUIREMENTS.md) | 독자 사용 사례, 운영자 요구사항 |
| [3-1-DESIGN-ARCHITECTURE](3-1-DESIGN-ARCHITECTURE.md) | 디렉터리 구조, 라우팅, 콘텐츠 스키마, 스타일 토큰 |
| [3-2-DESIGN-DECISIONS](3-2-DESIGN-DECISIONS.md) | 주요 결정과 근거, 재검토 조건, 시각 언어의 출처, 미결 |
| [4-1-BLOG-OPERATIONS](4-1-BLOG-OPERATIONS.md) | 글 작성 절차, 태그 정책, 티스토리 이관 |
| [4-2-PORTFOLIO-OPERATIONS](4-2-PORTFOLIO-OPERATIONS.md) | 이력 정본, 싣고 빼는 판단, 프로젝트 선정과 문서 작성 |
| [7-DEPLOYMENT](7-DEPLOYMENT.md) | GitHub Pages 배포, 릴리스 검증 |

## 변경 원칙

1. 콘텐츠 스키마(`src/content.config.ts`)를 바꾸면 같은 커밋에서 [3-1](3-1-DESIGN-ARCHITECTURE.md)을 갱신한다. `MUST`
2. 페이지 종류나 의존성을 추가하면 [3-2](3-2-DESIGN-DECISIONS.md) §3-2-5에 결정 기록을 남긴다. 이 둘은 명시적으로 제약을 건 항목이다. `MUST`
3. 참고한 사이트나 도구에서 디자인을 가져오면 [3-2](3-2-DESIGN-DECISIONS.md) §3-2-6에 **가져온 것과 버린 것**을 함께 적는다. 나중에 화면을 고칠 때 원래 무엇을 노렸는지가 근거가 된다. `SHOULD`
4. 이력·연락처 항목을 넣거나 빼면, 프로젝트를 넣거나 빼면 [4-2](4-2-PORTFOLIO-OPERATIONS.md)에 판단과 근거를 남긴다. **뺀 것도 남긴다** — 같은 논의를 반년 뒤에 다시 하지 않기 위해서다. `MUST`
5. 배포 워크플로(`.github/workflows/deploy.yml`)를 바꾸면 [7](7-DEPLOYMENT.md)을 갱신한다. `MUST`
6. 결정을 뒤집을 때는 기존 항목을 지우지 말고 "재검토 결과"로 덧붙인다. 왜 뒤집었는지가 결정 자체보다 오래 쓸모 있다. `SHOULD`
7. 아직 안 정한 것을 정한 것처럼 쓰지 않는다. 미확정은 [3-2](3-2-DESIGN-DECISIONS.md) §3-2-8 미결에 남긴다. `MUST`
