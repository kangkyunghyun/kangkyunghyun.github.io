---
title: "Spring Boot Actuator에서 Prometheus 메트릭 엔드포인트 열기"
date: 2026-08-03
tags: [백엔드, 모니터링]
---

서버 모니터링을 공부하기 전까지는 “서버가 정상적으로 실행되고 있다”와 “서버가 건강하다”를 거의 같은 의미로 생각했다. API가 응답하고 오류 알림이 오지 않으면 큰 문제가 없다고 여겼다.

하지만 서비스 트래픽이 하루 만에 크게 증가하면서 생각이 바뀌었다. 사용자가 갑자기 늘어난 날, 서버가 실제로 얼마나 바빴는지 알 수 없었다.

- API 응답이 평소보다 느려지지는 않았는가?
- HTTP 오류 비율이 증가하지는 않았는가?
- 데이터베이스 연결이 부족하지는 않았는가?
- JVM 메모리는 안정적이었는가?
- CPU 사용률은 괜찮았는가?

서버는 동작했지만 내부 상태를 확인할 계기판이 없었다. 비어 있던 서버 런타임 관측 영역을 채우기 위해 Prometheus와 Grafana를 공부하기 시작했다.

이 글에서는 Spring Boot 애플리케이션에 Prometheus Registry를 추가하고, 로컬 환경에서 `/actuator/prometheus`를 열어 메트릭 원문을 확인하는 과정까지 다룬다. 아직 Prometheus 서버나 Grafana를 설치하지는 않는다.

## 확인한 환경

이 글의 명령어와 설정은 다음 환경에서 확인했다.

- Java 21
- Kotlin 2.2.21
- Spring Boot 4.0.6
- Micrometer Prometheus Registry 1.16.5
- Gradle Kotlin DSL

## 기존 도구의 한계

프로젝트에는 이미 여러 관측 도구가 있었다.

- Amplitude: 사용자가 어떤 행동을 했는지 분석
- Langfuse: LLM 호출과 프롬프트 추적
- Sentry: 애플리케이션 예외 확인
- 데이터베이스: 사용자, 스토리, 크레딧 등 비즈니스 상태 확인

각 도구가 답하는 질문은 서버 메트릭이 답하는 질문과 다르다. “스토리를 생성한 사용자가 몇 명인가?”는 Amplitude나 데이터베이스에서 확인할 수 있다. 반면 “스토리 생성 API의 p95 응답 시간이 얼마인가?” 또는 “현재 데이터베이스 커넥션 풀이 부족한가?”는 서버 런타임에 관한 질문이다.

Prometheus로 확인하려던 서버 메트릭은 아래와 같았다.

- HTTP 요청량
- HTTP 응답 시간
- HTTP 오류율
- JVM 메모리와 가비지 컬렉션(GC)
- 데이터베이스 커넥션 풀
- CPU와 디스크 상태

기존 도구로 볼 수 없었던 서버 런타임 상태를 관측하는 것이 목표였다.

## Prometheus와 Grafana의 역할

서버를 자동차에 비유하면 메트릭을 이해하기 쉽다. 자동차의 계기판은 속도, 엔진 온도, 연료량을 보여준다. 서버에도 현재 상태를 보여주는 계기판이 필요하다.

서버 상태를 나타내는 수치를 **메트릭(metric)**이라고 한다. 아래 값이 메트릭에 해당한다.

```text
지금까지 받은 요청: 12,450건
현재 사용 중인 DB 연결: 7개
현재 JVM 메모리 사용량: 430MB
HTTP 요청 처리 시간 합계: 625초
```

Prometheus는 메트릭을 수집하고 시간에 따라 저장하는 시스템이다. Grafana는 저장된 메트릭을 그래프와 대시보드로 보여주며, 조건에 따라 알림을 보낼 수 있다.

두 도구와 Spring Boot의 관계를 단순화하면 아래 흐름이 된다.

```text
Spring Boot 서버
    ↓ 상태를 수치로 측정
Prometheus 형식의 메트릭
    ↓ 수집하고 저장
Prometheus
    ↓ 조회
Grafana
    ↓
그래프와 알림
```

이번 단계에서는 Prometheus 서버를 설치하지 않았다. 먼저 Spring Boot가 측정하는 메트릭을 Prometheus 형식으로 꺼내 보는 것부터 시작했다.

## Actuator와 Micrometer의 역할

Spring Boot Actuator는 애플리케이션 내부 상태를 외부에 보여주는 관리 기능을 제공한다. 프로젝트에는 이미 다음 의존성이 있었다.

```kotlin
implementation("org.springframework.boot:spring-boot-starter-actuator")
```

Actuator로 노출할 수 있는 관리 엔드포인트는 이렇다.

```text
/actuator/health
/actuator/info
/actuator/prometheus
```

기존 공통 설정인 `application.yml`은 `health`와 `info`만 노출하고 있었다.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info
```

Micrometer는 Spring Boot 내부의 측정값을 여러 모니터링 시스템에 연결하는 계층이다. Prometheus Registry를 추가하면 Micrometer가 측정값을 Prometheus 형식으로 제공한다.

```text
Spring Boot 내부 측정값
    ↓
Actuator와 Micrometer
    ↓
Prometheus 형식의 메트릭
```

## Prometheus Registry

`build.gradle.kts`의 `dependencies` 블록에 Prometheus Registry를 추가했다.

```kotlin
implementation("io.micrometer:micrometer-registry-prometheus")
```

의존성 버전은 직접 지정하지 않았다. Spring Boot의 의존성 관리가 호환되는 버전을 선택하기 때문이다. Gradle이 실제로 선택한 버전은 다음 명령어로 확인했다.

```bash
./gradlew dependencyInsight \
  --dependency micrometer-registry-prometheus \
  --configuration runtimeClasspath
```

실행 결과 Micrometer Prometheus Registry 1.16.5가 선택됐고 빌드도 성공했다.

```text
io.micrometer:micrometer-registry-prometheus:1.16.5
BUILD SUCCESSFUL
```

이제 애플리케이션 내부의 측정값을 Prometheus 형식으로 변환할 수 있다.

## 로컬 전용 Prometheus 엔드포인트

운영 환경에 곧바로 `/actuator/prometheus`를 공개하지 않고, 먼저 로컬 환경에서 내용을 확인하기로 했다. 공통 설정인 `application.yml`은 그대로 두고 `application-local.yml`에만 다음 설정을 추가했다.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
```

Spring Boot는 `local` 프로필로 실행할 때 공통 설정과 로컬 설정을 함께 읽는다.

```text
application.yml
        +
application-local.yml
        ↓
로컬 실행 설정
```

`application-local.yml`의 `include` 값이 공통 설정을 덮어쓰므로 로컬에서는 `health`, `info`, `prometheus`를 노출한다. 운영 환경은 공통 설정의 `health`, `info`만 사용하므로 영향을 받지 않는다.

## Spring Security의 무인증 허용

Actuator가 엔드포인트를 노출해도 Spring Security가 요청을 차단할 수 있다. 이 프로젝트는 일부 공개 경로를 먼저 허용하고 나머지 요청에는 인증을 요구한다.

`SecurityConfig.kt`의 공개 경로에 `/actuator/prometheus`를 추가했다.

```kotlin
.requestMatchers(
    "/actuator/health",
    "/actuator/health/**",
    "/actuator/prometheus",
    // ...
).permitAll()
```

`permitAll()`로 지정한 경로는 JWT나 로그인 정보 없이 요청할 수 있다. Actuator 노출 설정과 Spring Security 허용 설정은 역할이 다르다.

- Actuator 노출 설정: 엔드포인트를 생성할지 결정한다.
- Spring Security 설정: 생성된 엔드포인트에 누가 접근할지 결정한다.

운영 설정에는 `prometheus`가 노출 목록에 없다. 따라서 Spring Security가 경로를 허용하더라도 운영 환경에는 접근할 엔드포인트가 생성되지 않는다.

## IntelliJ 의존성 반영 문제

Gradle 컴파일은 성공했지만 IntelliJ에서 처음 실행했을 때는 다음 로그가 나왔다.

```text
Exposing 2 endpoints beneath base path '/actuator'
```

예상한 엔드포인트는 `health`, `info`, `prometheus` 세 개였지만 두 개만 노출됐다. 실행 클래스패스를 확인하니 새로 추가한 `micrometer-registry-prometheus`가 없었다.

터미널에서 실행한 Gradle은 변경된 의존성을 알고 있었지만 IntelliJ는 변경된 `build.gradle.kts`를 아직 다시 불러오지 않은 상태였다. IntelliJ의 Gradle 도구 창에서 `Reload All Gradle Projects`를 실행한 뒤 서버를 다시 시작했다.

이번에는 클래스패스에 다음 라이브러리가 포함됐다.

```text
micrometer-registry-prometheus-1.16.5.jar
```

실행 로그도 세 개의 엔드포인트를 노출한다고 바뀌었다.

```text
Exposing 3 endpoints beneath base path '/actuator'
Started ManyakApplicationKt
```

`build.gradle.kts`에 의존성을 추가한 뒤에는 Gradle 빌드뿐 아니라 IDE의 Gradle 동기화 상태도 확인해야 한다.

## Prometheus 메트릭 원문

서버를 실행한 상태에서 다음 요청을 보냈다.

```bash
curl -sS -i http://localhost:8080/actuator/prometheus \
  | sed -n '1,25p'
```

응답 상태는 `200 OK`였다.

```http
HTTP/1.1 200
Content-Type: text/plain;version=0.0.4;charset=utf-8
Content-Length: 31433
```

응답 본문에는 이런 메트릭이 들어 있었다.

```text
# HELP application_ready_time_seconds Time taken for the application to be ready to service requests
# TYPE application_ready_time_seconds gauge
application_ready_time_seconds{main_application_class="com.knk.manyak.ManyakApplicationKt"} 4.886
```

직접 메트릭 코드를 작성하지 않았지만 Spring Boot는 이미 여러 정보를 측정하고 있었다.

- 애플리케이션 시작 시간
- JVM 메모리
- CPU
- 디스크
- HTTP 요청
- 데이터베이스 커넥션 풀

여기서 확인한 `/actuator/prometheus`는 Prometheus 서버가 아니다. 현재 애플리케이션이 가진 메트릭을 Prometheus 형식으로 보여주는 출구다.

```text
Spring Boot
    ↓
/actuator/prometheus
    ↓
현재 메트릭 원문
```

아직 과거 값을 저장하거나 그래프로 볼 수 없으며 PromQL도 실행할 수 없다. 다만 서버가 어떤 수치를 측정하고 있는지 처음으로 직접 확인했다.

다음 글에서는 이 원문을 한 줄씩 읽어보며 카운터, 게이지, 시계열, 라벨, 히스토그램, p95가 무엇인지 알아본다.
