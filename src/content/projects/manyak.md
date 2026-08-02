---
title: 마냑
summary: 나만의 스토리를 만들고 채팅으로 이어나가는 AI 스토리챗 서비스
period: 2026. 06. — 현재
role: 백엔드 개발
badge: AI·SW 마에스트로
stack:
  [
    Kotlin,
    Spring Boot,
    Java 21,
    PostgreSQL,
    Redis,
    Flyway,
    Gradle,
    Terraform,
    AWS,
    Amplitude,
  ]
asIs: []
toBe: []
links:
  - label: manyak.app
    href: https://www.manyak.app
  - label: GitHub
    href: https://github.com/KIM-N-KANG/manyak-server
order: 1
---

## 서비스

사용자가 자신만의 스토리를 만들고, 그 세계관 안에서 AI와 대화를 이어가는 서비스입니다. 만든 스토리는 공유 링크로 다른 사람에게 열어 줄 수 있습니다.

AI·SW 마에스트로 17기 과정에서 진행 중이며, 웹·안드로이드·AI·인프라를 저장소로 나눠 개발하고 있습니다.

## 구성

| 저장소 | 역할 | 기술 |
| --- | --- | --- |
| `manyak-server` | API 서버 | Kotlin, Spring Boot, JPA, Flyway, Spring Security |
| `manyak-web` | 웹 클라이언트 | Next.js 16 App Router, React 19, TanStack Query |
| `manyak-ai` | AI 서버 | Python |
| `manyak-android` | 안드로이드 | Kotlin |
| `manyak-terraform` | 운영 인프라 | Terraform |

## 백엔드에서 한 일

### 스키마 변경을 코드로 관리

JPA의 `ddl-auto`에 스키마를 맡기지 않고 **Flyway 마이그레이션**으로 관리합니다. 운영 DB의 변경 이력이 저장소에 남고, 로컬·운영이 같은 순서로 재현됩니다.

### 웹 클라이언트가 API를 직접 호출하지 않는 구조

브라우저는 백엔드를 직접 부르지 않고 Next.js의 프록시 라우트(`/api/*`)를 거칩니다. 백엔드 주소가 클라이언트 번들에 노출되지 않고, CORS 허용 목록도 서버 하나만 관리하면 됩니다.

API 타입은 손으로 맞추지 않고 서버의 OpenAPI 스펙(`/v3/api-docs`)에서 **Orval로 생성**합니다. 서버 응답이 바뀌면 프런트 타입 검사에서 먼저 깨집니다.

### 운영 인프라를 Terraform으로 분리

ALB·RDS·ElastiCache·EC2·GitHub OIDC·Cloudflare를 Terraform 코드로 관리하고, 서버 저장소에서 별도 저장소로 분리했습니다. 배포 자격증명은 장기 키 대신 **GitHub OIDC**로 발급합니다.

### 사용자 행동 계측

Amplitude로 이벤트를 수집합니다. 디바이스 식별자는 그대로 쓰지 않고 pepper를 섞어 해시한 뒤 전송합니다.

<!--
TODO — 여기서부터는 강경현만 아는 내용이라 직접 채워야 함.

## 트러블슈팅
- 무엇이 터졌는지, 어떻게 원인을 좁혔는지, 뭘 바꿔서 해결했는지
- 예: 동시 요청에서 스토리 생성이 중복되던 문제 → Redis 분산 락
- 예: AI 서버 응답 지연이 API 타임아웃으로 번지던 문제 → 타임아웃·재시도 정책

## 결과
- 가능하면 수치로. 응답 시간, 에러율, 처리량, 사용자 수 등
-->
