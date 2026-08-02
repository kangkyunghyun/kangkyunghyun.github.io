# 7. 배포

빌드·배포 경로와 릴리스 전 검증을 정한다. 별도 테스트 스위트가 없으므로 검증 항목을 이 문서에 함께 둔다.

```text
§7-1   배포 경로     푸시에서 공개까지
§7-2   설정          Pages 구성값
§7-3   검증          내보내기 전에 확인할 것
§7-4   복구          배포가 깨졌을 때
```

## 7-1 배포 경로

`main` 브랜치에 푸시하면 `.github/workflows/deploy.yml`이 실행된다. 별도의 배포 트리거는 없다(§2-2 O2).

```text
main 푸시
  → build  : actions/checkout@v7 → withastro/action@v6 (설치·빌드·아티팩트 업로드)
  → deploy : actions/deploy-pages@v5
  → https://kangkyunghyun.github.io/
```

`workflow_dispatch`로 수동 실행도 가능하나 정상 경로가 아니다. 워크플로 자체를 고쳤을 때만 쓴다.

## 7-2 설정

| 항목 | 값 | 위치 |
| --- | --- | --- |
| 저장소 | `kangkyunghyun/kangkyunghyun.github.io` (public) | — |
| Pages 빌드 방식 | `workflow` | 저장소 Pages 설정 |
| 브랜치 | `main` 단일 | [AGENTS.md](../AGENTS.md) |
| `site` | `https://kangkyunghyun.github.io` | `astro.config.mjs` |
| 동시성 | `group: pages`, 취소 안 함 | `deploy.yml` |

Pages 빌드 방식이 `legacy`면 Jekyll로 처리돼 Astro 산출물이 무시된다. 반드시 `workflow`여야 한다. `MUST`

`astro.config.mjs`의 `site`는 canonical URL 생성에 쓰인다. 도메인을 바꾸면 이 값도 함께 바꾼다. `MUST`

## 7-3 검증

푸시 전에 다음을 확인한다.

1. `npm run build` 성공. 스키마 위반과 렌더 오류가 여기서 잡힌다. `MUST`
2. 새 글을 추가했으면 해당 상세 페이지가 생성 목록에 나오는지 확인한다. `draft: true`면 안 나오는 것이 정상이다. `MUST`
3. 레이아웃을 고쳤으면 390 / 768 / 1440px에서 가로 넘침이 0인지 확인한다(§[2-3](2-REQUIREMENTS.md)). `MUST`
4. 코드 블록이 포함된 글이면 블록 안에서만 가로 스크롤되는지 확인한다. `SHOULD`

푸시 후 워크플로 결과와 실제 URL 응답을 확인한다. 워크플로 성공과 페이지 정상은 별개다.

## 7-4 복구

| 증상 | 원인 | 조치 |
| --- | --- | --- |
| 배포는 성공인데 옛 화면 | Pages 빌드 방식이 `legacy` | `workflow`로 변경 |
| 빌드 실패, 프런트매터 오류 | 스키마에 없는 필드 | [3-1](3-1-DESIGN-ARCHITECTURE.md) §3-1-3 대조 |
| 로컬에서 CSS 반영 안 됨 | 개발 서버가 이전 CSS를 물고 있음 | `astro dev stop` → `.astro` 삭제 → 재시작 |
| 글 URL이 404 | 파일명을 바꿨음 | 파일명을 되돌린다(§[4-1-1](4-1-BLOG-OPERATIONS.md)) |

배포가 깨진 상태를 오래 두지 않는다. 직전 커밋으로 되돌리는 것이 원인 규명보다 우선이다. `SHOULD`
