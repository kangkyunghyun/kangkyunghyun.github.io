---
title: 마냑
summary: 나만의 스토리를 만들고 채팅으로 이어나가는 AI 스토리챗 서비스
period: 2026. 6. — 현재
role: 백엔드 개발
badge: AI·SW 마에스트로
logo: manyak.png
team: 3인
stack:
  [
    Kotlin,
    Spring Boot,
    Java 21,
    PostgreSQL,
    Redis,
    Flyway,
    Terraform,
    AWS,
    Sentry,
    Amplitude,
  ]
asIs:
  - 표준 4xx가 catch-all에 걸려 500으로 응답
  - 봇의 /swagger-ui 폴링마다 5xx 알림 발생
  - AI 호출 두 종류가 read timeout 15초를 공유
  - 삭제 API에 소유권 검증 없음
toBe:
  - 4xx 전용 핸들러로 상태 코드 정정, Sentry 미전송
  - 실제 서버 오류만 알림에 남음
  - storyline 30초 · compile 120초로 분리
  - 404 판정 뒤 403 적용 (리소스 존재 비노출)
links:
  - label: manyak.app
    href: https://www.manyak.app
  - label: GitHub
    href: https://github.com/KIM-N-KANG/manyak-server
order: 1
---

## 서비스

사용자가 자신만의 스토리를 만들고, 그 세계관 안에서 AI와 대화를 이어가는 서비스입니다. 만든 스토리는 공유 링크로 열어 줄 수 있습니다.

AI·SW 마에스트로 17기 과정에서 3인 팀으로 진행 중이며, 서버·웹·안드로이드·AI·인프라를 저장소로 나눠 개발하고 있습니다. 저는 **API 서버(`manyak-server`)** 를 맡고 있습니다.

## 구성

| 저장소 | 역할 | 기술 |
| --- | --- | --- |
| `manyak-server` | API 서버 | Kotlin, Spring Boot, JPA, Flyway, Spring Security |
| `manyak-web` | 웹 클라이언트 | Next.js 16 App Router, React 19, TanStack Query |
| `manyak-ai` | AI 서버 | Python |
| `manyak-android` | 안드로이드 | Kotlin |
| `manyak-terraform` | 운영 인프라 | Terraform |

## 에러 핸들링: "Sentry에는 5xx만 남는다"

알림이 울려도 아무도 안 보는 상태를 만들지 않는 것이 목표였습니다. 원칙은 하나 — **예상 가능한 4xx는 Sentry로 보내지 않는다.** 이 원칙을 세운 뒤 위반하는 경로를 두 번 찾아 고쳤습니다.

### 1. SSE 엔드포인트의 Accept 불일치가 500이 되던 문제

SSE 엔드포인트(`produces=text/event-stream`)에 `Accept: application/json`으로 요청하면 Spring이 `HttpMediaTypeNotAcceptableException`을 던집니다. 그런데 `GlobalExceptionHandler`에 전용 핸들러가 없어 catch-all로 떨어졌고, **500으로 응답되면서 Sentry에도 올라갔습니다.**

클라이언트가 헤더를 잘못 보낸 것이라 서버 잘못이 아닌데 서버 오류로 집계되고 있었습니다. 표준 4xx 세 개에 전용 핸들러를 붙였습니다.

| 예외 | 이전 | 이후 |
| --- | --- | --- |
| `HttpMediaTypeNotAcceptableException` | 500 | **406** |
| `HttpMediaTypeNotSupportedException` | 500 | **415** |
| `HttpRequestMethodNotSupportedException` | 500 | **405** |

세 핸들러 모두 Sentry 전송 함수를 타지 않습니다. 실제 SSE 요청으로 406이 나가고 Sentry에 안 남는 것까지 통합 테스트로 막았습니다.

### 2. 봇의 스캔이 5xx 노이즈를 만들던 문제

운영에서 Swagger 경로(`/swagger-ui.html`, `/v3/api-docs`)를 비활성화했더니, 그 경로가 404가 아니라 **500**을 반환했습니다. `permitAll`이라 보안 필터는 통과하는데 매핑이 없어 `NoResourceFoundException`이 catch-all로 떨어진 것입니다.

문제는 스캐너 봇이 이 경로를 계속 두드린다는 점이었습니다. **봇이 한 번 긁을 때마다 5xx 이벤트가 쌓였습니다.** `NoResourceFoundException` 핸들러를 추가해 404로 정정하고 Sentry 전송에서 뺐습니다. catch-all은 그대로 둬서 진짜 5xx만 남게 했습니다.

## AI 호출 타임아웃을 용도별로 분리

스토리 AI 클라이언트가 **storyline 생성**과 **compile** 두 호출에 read timeout 15초를 함께 쓰고 있었습니다. compile은 LLM으로 장문을 생성하는 작업이라 15초를 넘기는 경우가 있었고, 그때마다 정상 동작이 타임아웃으로 실패했습니다.

호출별로 RestClient를 나눴습니다.

| 호출 | connect | read |
| --- | --- | --- |
| storyline | 5초 | **30초** |
| compile | 5초 | **120초** |

같은 지연을 줬을 때 storyline은 실패하고 compile은 견디는 회귀 테스트를 함께 넣어, 두 타임아웃이 실제로 독립인지 검증했습니다.

## 소유권 검증에서 존재 여부를 흘리지 않기

스토리·채팅 삭제 API에 소유권 검증이 빠져 있어, 회원 소유 리소스를 타인이나 미인증 요청이 지울 수 있었습니다.

고치면서 **판정 순서**를 신경 썼습니다. 소유권을 먼저 보면 "403이 떴다 = 그 id의 리소스가 존재한다"가 새어 나갑니다. 그래서 **404(없음)를 먼저 판정하고 그다음 403**을 적용했습니다. 게스트가 만든 리소스(`user_id`가 NULL)는 익명 삭제를 허용하고, 회원 소유는 본인만 허용합니다.

## 크래시 창에서 사라지던 스토리 복구

백그라운드 생성은 스토리 저장과 완료 마킹이 서로 다른 트랜잭션입니다. 그 사이에 프로세스가 죽으면 스토리는 저장됐는데 요청 행은 `PENDING`으로 남습니다.

이 상태에서 복구 작업이 다시 돌면 이미 만들어진 세션을 만나 **409로 실패 처리**했습니다. 스토리는 DB에 있는데 사용자는 받지 못하는 상황이었습니다.

트랜잭션 구조를 바꾸는 대신, 복구 시 저장된 스토리를 원래 응답 형태로 **재구성해서 돌려주도록** 했습니다. AI 호출과 과금을 다시 타지 않고, 같은 요청을 여러 번 보내도 같은 스토리가 나옵니다.

## 그 외 구조 결정

- **스키마는 Flyway로.** `ddl-auto`에 맡기지 않아 변경 이력이 저장소에 남고 로컬·운영이 같은 순서로 재현됩니다.
- **웹은 백엔드를 직접 부르지 않습니다.** Next.js 프록시 라우트를 거쳐 백엔드 주소가 클라이언트 번들에 노출되지 않고, CORS 허용 목록도 한 곳만 관리합니다.
- **API 타입은 손으로 맞추지 않습니다.** OpenAPI 스펙에서 생성하므로 서버 응답이 바뀌면 프런트 타입 검사가 먼저 깨집니다.
- **배포 자격증명은 장기 키 대신 GitHub OIDC**로 발급합니다.
- **디바이스 식별자는 그대로 보내지 않습니다.** pepper를 섞어 해시한 뒤 Amplitude로 전송합니다.
