---
title: LinKHU
summary: 경희대학교 웹서비스 117개를 클릭 한 번으로 여는 브라우저 확장
period: 2026. 02. — 현재
role: 1인 개발 및 운영
badge: DAU 100+
stack: [JavaScript, Chrome Extension, GitHub Actions]
asIs: []
toBe: []
links:
  - label: 홈페이지
    href: https://kangkyunghyun.github.io/LinKHU/
  - label: Chrome Web Store
    href: https://chromewebstore.google.com/detail/ihidkmjkpfphgljieecfcikljaopcldp
  - label: GitHub
    href: https://github.com/kangkyunghyun/LinKHU
order: 3
---

## 서비스

경희대 학생이 자주 쓰는 교내 웹서비스를 팝업 하나에서 바로 여는 브라우저 확장입니다. 교내 공통 서비스부터 단과대·학과 서비스까지 **117개**를 지원하고, 설정에서 자기가 쓰는 것만 골라 담을 수 있습니다.

**Chrome 웹스토어 · 네이버 웨일 스토어 · Firefox 애드온** 세 곳에 배포돼 있습니다.

## 만들면서 정한 것

### 서비스 목록을 코드가 아니라 데이터로

117개를 화면 코드에 박지 않고 데이터로 분리했습니다. 학교가 URL을 바꾸거나 서비스가 늘어도 데이터만 고치면 되고, 화면 로직은 건드리지 않습니다.

### 링크가 죽었는지 CI가 검사한다

교내 서비스는 학교 사정으로 주소가 조용히 바뀝니다. 사용자가 먼저 발견하면 이미 늦기 때문에, GitHub Actions에 검증 워크플로를 두고 **데이터가 규칙을 지키는지 push마다 확인**합니다.

### 키보드로 끝나게

팝업에서 `/` 키로 검색창에 바로 가고, 이름·ID·카테고리로 찾은 뒤 `Enter`로 첫 결과를 엽니다. 마우스로 목록을 훑는 것보다 빠릅니다.

### 스토어 세 곳을 한 소스로

Chrome·Whale·Firefox는 확장 매니페스트 요구사항이 다릅니다. 소스를 하나로 두고 빌드에서 갈라 세 스토어 심사를 통과시켰습니다.

<!--
TODO — 직접 채울 부분

## 트러블슈팅
- 스토어 심사 반려 경험, Manifest V3 전환, 브라우저별 API 차이 등

## 결과
- DAU 100+ 외에 누적 설치 수, 스토어 평점, 리뷰 반응 등
-->
