---
title: "Prometheus 메트릭에서 카운터, p95, 카디널리티 읽기"
date: 2026-08-04
tags: [백엔드, 모니터링]
---

앞선 글에서는 Spring Boot에 Prometheus Registry를 추가하고 `/actuator/prometheus` 엔드포인트를 열었다. 이번 글에서는 엔드포인트가 반환한 원문을 직접 읽으며 메트릭의 구조를 이해한다.

글에서 확인한 환경은 다음과 같다.

- Java 21
- Kotlin 2.2.21
- Spring Boot 4.0.6
- Gradle 9.5.1
- Micrometer Prometheus Registry 1.16.5

## 메트릭 한 줄의 HELP, TYPE, 측정값

처음 확인한 메트릭은 다음과 같았다.

```text
# HELP application_ready_time_seconds Time taken for the application to be ready to service requests
# TYPE application_ready_time_seconds gauge
application_ready_time_seconds{main_application_class="com.knk.manyak.ManyakApplicationKt"} 4.886
```

세 줄은 하나의 메트릭을 설명한다.

### HELP와 메트릭 설명

```text
# HELP application_ready_time_seconds Time taken for the application to be ready to service requests
```

`HELP`는 메트릭이 무엇을 측정하는지 설명한다. 메트릭 이름에는 공백 대신 밑줄을 사용하고 단위를 이름 끝에 붙이는 경우가 많다.

`application_ready_time_seconds`는 애플리케이션이 요청을 받을 준비를 마칠 때까지 걸린 시간을 초 단위로 나타낸다.

### TYPE과 측정값 종류

```text
# TYPE application_ready_time_seconds gauge
```

`TYPE`은 측정값의 종류를 나타낸다. 이 메트릭의 타입은 게이지(`gauge`)다. 게이지는 온도계나 속도계처럼 현재 상태를 나타내며 값이 오르거나 내릴 수 있다.

게이지로 표현하기 적합한 값은 다음과 같다.

- 현재 CPU 사용률
- 현재 JVM 메모리 사용량
- 현재 사용 중인 데이터베이스 연결 수
- 남은 디스크 공간

### 라벨과 값

```text
application_ready_time_seconds{main_application_class="com.knk.manyak.ManyakApplicationKt"} 4.886
```

측정값 한 줄은 다음 구조로 읽을 수 있다.

```text
메트릭 이름{라벨} 값
```

- 메트릭 이름: `application_ready_time_seconds`
- 라벨: `main_application_class="com.knk.manyak.ManyakApplicationKt"`
- 값: `4.886`

애플리케이션이 요청을 받을 준비를 마치는 데 약 4.886초가 걸렸다는 뜻이다.

## 시계열을 만드는 라벨 조합

라벨은 같은 메트릭을 더 세부적으로 구분하는 이름표다. 앞선 예시에서는 다음 라벨이 애플리케이션의 메인 클래스를 나타낸다.

```text
main_application_class="com.knk.manyak.ManyakApplicationKt"
```

Prometheus는 메트릭 이름이 같더라도 라벨 조합이 다르면 별개의 시계열로 취급한다.

```text
같은 메트릭 이름 + 같은 라벨 조합 = 하나의 시계열
```

시계열은 시간에 따라 쌓이는 하나의 측정값 흐름이다. 이 규칙은 뒤에서 살펴볼 카디널리티와 직접 연결된다.

## HTTP 요청 카운터

HTTP 요청 메트릭을 확인하기 위해 서버의 health 엔드포인트를 한 번 호출했다.

```bash
curl -sS http://localhost:8080/actuator/health
```

응답은 다음과 같았다.

```json
{"groups":["liveness","readiness"],"status":"UP"}
```

이후 Prometheus 원문에서 health 요청 횟수를 찾았다.

```bash
curl -sS http://localhost:8080/actuator/prometheus \
  | grep '^http_server_requests_seconds_count.*uri="/actuator/health"'
```

결과는 다음과 같았다.

```text
http_server_requests_seconds_count{error="none",exception="none",method="GET",outcome="SUCCESS",status="200",uri="/actuator/health"} 1
```

이 측정값은 `GET /actuator/health` 요청이 오류나 예외 없이 `200` 응답으로 한 번 성공했다는 뜻이다. 각 라벨은 요청의 성격을 구분한다.

- `method="GET"`: HTTP 요청 방식
- `uri="/actuator/health"`: 요청 경로
- `status="200"`: HTTP 응답 상태
- `outcome="SUCCESS"`: 응답 결과 범주
- `error="none"`: 오류 없음
- `exception="none"`: 예외 없음

health 엔드포인트를 세 번 더 호출하자 같은 메트릭의 값이 다음과 같이 바뀌었다.

```text
http_server_requests_seconds_count{...} 4
```

값이 1에서 4로 증가했다. 카운터(`counter`)는 사건이 일어날 때마다 누적되는 값이다.

```text
첫 번째 요청 → 1
두 번째 요청 → 2
세 번째 요청 → 3
네 번째 요청 → 4
```

HTTP 요청 수, 오류 수, 타임아웃 수, 처리한 작업 수처럼 누적 횟수를 기록할 때 카운터를 사용한다. 카운터는 일반적으로 감소하지 않지만 애플리케이션을 재시작하면 메모리에 있던 값이 초기화돼 0부터 다시 시작할 수 있다.

## rate와 카운터 증가 속도

누적 요청 수만으로는 현재 서버가 얼마나 바쁜지 판단하기 어렵다. 한 달 동안 천천히 쌓인 100만 건과 한 시간 만에 몰린 100만 건은 서버에 주는 부하가 다르다.

Prometheus에서는 `rate()`로 일정 시간 동안 카운터가 증가한 속도를 계산한다.

```text
rate(http_server_requests_seconds_count[5m])
```

이 쿼리는 최근 5분 동안 HTTP 요청 카운터가 초당 얼마나 증가했는지 계산한다. 예를 들어 60초 동안 누적값이 100에서 160으로 증가했다면 초당 요청 수는 다음과 같다.

```text
60건 증가 ÷ 60초 = 초당 1건
```

이 값이 초당 요청 수(Requests Per Second, RPS)의 기초가 된다.

## count, sum, max와 응답 시간

HTTP 요청 시간은 다음 세 값으로 노출됐다.

```text
http_server_requests_seconds_count ... 4
http_server_requests_seconds_sum ... 0.041819416
http_server_requests_seconds_max ... 0.0
```

- `_count`: 요청 횟수
- `_sum`: 모든 요청 처리 시간의 합
- `_max`: 최근 측정 구간의 최댓값

평균 응답 시간은 `_sum`을 `_count`로 나눠 계산할 수 있다.

```text
0.041819416초 ÷ 4건
= 0.010454854초
= 약 10.45ms
```

요청을 하나 더 보낸 뒤 값은 다음과 같이 바뀌었다.

```text
_count = 5
_sum   = 0.049854916
_max   = 0.0080355
```

새 요청에 걸린 시간은 두 `_sum` 값의 차이로 구할 수 있다.

```text
0.049854916 - 0.041819416
= 0.0080355초
= 약 8.04ms
```

계산한 값은 당시 `_max`와 정확히 일치했다. 다만 `_max`는 애플리케이션이 시작된 뒤 영원히 유지되는 최댓값이 아니다. 최근 측정 구간에 새 값이 없으면 0으로 초기화될 수 있다.

## 평균과 최댓값 대신 p95가 필요한 이유

평균은 일부 느린 요청을 숨길 수 있다. 요청 100건의 처리 시간이 다음과 같다고 가정해 보자.

- 94건은 50ms
- 6건은 10초

대부분의 요청은 빠르지만 6명의 사용자는 10초를 기다렸다. 평균만 보면 느린 사용자의 경험이 전체 값에 섞인다. 최댓값도 단 한 건의 특이한 요청 때문에 크게 튈 수 있다.

운영 환경에서는 이런 한계를 보완하기 위해 백분위수를 자주 사용한다. p95는 요청 시간을 짧은 순서대로 정렬했을 때 95번째 백분위에 해당하는 값이다.

> 전체 요청의 약 95%가 이 시간 안에 끝났고 나머지 약 5%는 이보다 느렸다.

p95가 800ms라면 요청 100건 중 약 95건은 800ms 이내에 처리됐고 약 5건은 그보다 오래 걸렸다고 해석할 수 있다.

## p95 계산을 위한 히스토그램 버킷

처음에는 다음 메트릭이 존재하지 않았다.

```text
http_server_requests_seconds_bucket
```

p95를 계산하려면 응답 시간을 여러 구간으로 나눠 기록해야 한다. 각 구간을 히스토그램 버킷이라고 한다. 로컬 설정인 `application-local.yml`에 다음 값을 추가했다.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  metrics:
    distribution:
      percentiles-histogram:
        http.server.requests: true
```

서버를 재시작한 뒤 health 요청의 버킷을 확인했다.

```text
http_server_requests_seconds_bucket{...,le="0.006990506"} 0
http_server_requests_seconds_bucket{...,le="0.008388607"} 1
http_server_requests_seconds_bucket{...,le="0.009786708"} 1
```

`le`는 less than or equal, 즉 버킷의 상한 이하라는 뜻이다. 단위는 초다. `0.008388607`초는 약 8.39ms다.

결과는 다음과 같이 읽을 수 있다.

- 6.99ms 이하로 끝난 요청: 0건
- 8.39ms 이하로 끝난 요청: 1건

따라서 측정한 요청은 6.99ms보다 오래 걸렸고 8.39ms 이내에 끝났다고 추정할 수 있다.

### 히스토그램 버킷의 누적

8.39ms 이하인 요청은 9.79ms 이하인 요청에도 포함된다. 그래서 다음 두 버킷의 값이 모두 1이다.

```text
le="0.008388607" 1
le="0.009786708" 1
```

히스토그램 버킷은 각 구간에 속한 요청만 따로 세지 않고 상한 이하의 요청을 누적한다.

```text
1ms 이하: 0건
5ms 이하: 0건
8.39ms 이하: 1건
10ms 이하: 1건
100ms 이하: 1건
1초 이하: 1건
```

마지막에는 모든 요청을 포함하는 `+Inf` 버킷이 있다.

```text
le="+Inf" 2
```

`+Inf`는 양의 무한대를 뜻한다. 예를 들어 전체 요청 세 건 중 한 건이 30초를 넘겼다면 다음과 같이 차이가 날 수 있다.

```text
le="30.0" 2
le="+Inf" 3
```

Prometheus의 `histogram_quantile()` 함수는 이런 누적 버킷으로 p95를 추정한다.

```text
histogram_quantile(
  0.95,
  sum by (le) (
    rate(http_server_requests_seconds_bucket[5m])
  )
)
```

아직 Prometheus나 Grafana Cloud에 데이터를 저장하지 않았기 때문에 이 PromQL을 직접 실행하지는 않았다. 현재는 p95 계산에 필요한 버킷을 만드는 단계다.

## 히스토그램의 시계열 수

히스토그램은 응답 시간 분포를 보여주는 대신 많은 시계열을 만든다. health 요청의 버킷 수를 다음 명령어로 확인했다.

```bash
curl -sS http://localhost:8080/actuator/prometheus \
  | grep '^http_server_requests_seconds_bucket.*uri="/actuator/health"' \
  | wc -l
```

결과는 69개였다.

```text
69
```

health 요청의 라벨 조합 하나에 버킷 시계열만 69개가 생긴 셈이다. 여기에 `_count`, `_sum`, `_max`를 더하면 약 72개가 된다.

```text
버킷: 69개
_count: 1개
_sum: 1개
_max: 1개
합계: 약 72개
```

성공 응답과 서버 오류 응답은 라벨 조합이 다르므로 각각 별도의 시계열을 만든다.

```text
status="200", outcome="SUCCESS"
status="500", outcome="SERVER_ERROR"
```

## 카디널리티와 시계열 수

현재 메트릭 원문에서 실제 측정값 줄 수를 세었다.

```bash
curl -sS http://localhost:8080/actuator/prometheus \
  | grep -v '^#' \
  | grep -v '^$' \
  | wc -l
```

결과는 377개였다.

```text
377
```

고유한 메트릭 이름은 148개였다.

```text
메트릭 이름: 148종
실제 시계열: 377개
```

148가지 측정값이 라벨 조합과 히스토그램 버킷에 따라 377개의 시계열로 펼쳐진 것이다.

카디널리티는 라벨 조합이 얼마나 다양해질 수 있는지를 나타낸다. 메트릭 이름이 같아도 라벨값이 다르면 별개의 시계열이 된다.

```text
user_id="user-1"
user_id="user-2"
user_id="user-3"
```

사용자 3,625명의 ID를 HTTP 히스토그램 라벨에 넣고 사용자마다 69개 버킷이 만들어진다고 가정하면 버킷 시계열만 다음 규모가 된다.

```text
3,625 × 69 = 250,125개
```

URI, 상태 코드, HTTP 방식 등의 조합까지 더해지면 시계열 수는 훨씬 커진다. 따라서 메트릭 라벨에는 값의 종류가 제한적인 항목을 사용해야 한다.

비교적 안전한 라벨은 다음과 같다.

- HTTP 요청 방식
- HTTP 응답 상태
- 템플릿화된 URI
- `success`, `timeout`, `error`처럼 정해진 결과 종류

반대로 다음 값은 요청이나 사용자마다 달라질 수 있어 카디널리티를 크게 높인다.

- `user_id`
- `story_id`
- 요청마다 달라지는 실제 URL
- 오류 메시지 원문
- 사용자 입력
- LLM 프롬프트 원문

사용자와 스토리 단위 분석은 데이터베이스, Amplitude, Langfuse가 담당한다. Prometheus는 서버 전체의 요청 속도, 오류율, 자원 상태를 관측하도록 역할을 나누는 편이 적절하다.

## 외부 저장소로의 메트릭 전송

현재 `/actuator/prometheus`는 애플리케이션이 가진 메트릭의 현재 스냅숏만 보여준다.

- 서버를 재시작하면 누적값이 초기화된다.
- 과거 값을 조회할 수 없다.
- 시간에 따른 그래프가 없다.
- PromQL을 실행할 수 없다.
- 장애 알림을 보낼 수 없다.

다음 단계에서는 Grafana Cloud 계정을 만들고 Spring Boot가 OTLP 방식으로 메트릭을 전송하도록 연결한다. 메트릭이 외부 저장소에 쌓이면 실제 p95, HTTP 오류율, 데이터베이스 커넥션 풀을 대시보드로 확인하고 알림도 설정할 수 있다.
