---
title: "Spring Boot 메트릭을 Grafana Cloud로 보내고 RED 대시보드 만들기"
date: 2026-08-05
tags: [백엔드, 모니터링]
---

앞선 두 글에서는 Spring Boot Actuator가 제공하는 `/actuator/prometheus`를 열고 카운터와 히스토그램 버킷을 직접 읽었다. 이번에는 메트릭을 Grafana Cloud에 저장하고 PromQL로 조회한 뒤, 요청량, 응답시간, 오류율을 한 화면에서 보는 RED 대시보드와 알림 규칙까지 만든다.

이 글에서 사용한 환경은 Java 21, Kotlin 2.2.21, Spring Boot 4.0.6, Micrometer 1.16.5다. 애플리케이션은 IntelliJ에서 실행했고 PostgreSQL과 Redis는 Docker Compose로 띄웠다.

## Prometheus 서버 없는 구성

`/actuator/prometheus`가 열렸다고 해서 Prometheus 서버가 설치된 것은 아니다. 이 주소는 애플리케이션이 현재 가지고 있는 메트릭을 Prometheus 텍스트 형식으로 보여주는 출구다. 서버를 재시작하면 누적값이 초기화되고 이 엔드포인트만으로는 과거 값을 조회하거나 그래프를 만들 수 없다.

보통 Prometheus는 이 주소를 일정 주기로 읽는 pull 방식을 사용한다. 이번 실습에서는 로컬 컴퓨터를 외부에 공개하지 않기 위해 Spring Boot가 OTLP로 Grafana Cloud에 메트릭을 밀어 넣는 push 방식을 선택했다.

```text
Spring Boot
  ├─ /actuator/prometheus → 로컬에서 원문 확인
  └─ Micrometer OTLP Registry
          ↓ 10초마다 push
     Grafana Cloud의 메트릭 저장소
          ↓ PromQL
     Explore / Dashboard / Alert
```

따라서 Prometheus 형식과 PromQL은 그대로 사용하지만 로컬에 독립적인 Prometheus 프로세스는 실행하지 않는다. Grafana Cloud 안의 Prometheus 호환 저장소가 장기 보관과 조회를 담당한다.

## OTLP Registry와 Spring Boot OpenTelemetry 모듈

`build.gradle.kts`의 `dependencies` 블록에는 앞서 추가한 Prometheus Registry와 함께 OTLP Registry를 추가했다.

```kotlin
implementation("io.micrometer:micrometer-registry-prometheus")
implementation("io.micrometer:micrometer-registry-otlp")
implementation("org.springframework.boot:spring-boot-opentelemetry")
```

Prometheus Registry는 `/actuator/prometheus`에서 원문을 확인하는 역할을 한다. OTLP Registry는 같은 Micrometer 측정값을 OTLP 형식으로 변환해 Grafana Cloud로 전송한다. Spring Boot 4.0.6 환경에서는 OTLP 자동 설정에 필요한 OpenTelemetry 속성을 제공하기 위해 `spring-boot-opentelemetry`도 함께 추가했다.

실제 선택된 버전은 Gradle로 확인했다.

```bash
./gradlew dependencyInsight \
  --dependency micrometer-registry-otlp \
  --configuration runtimeClasspath

./gradlew dependencyInsight \
  --dependency spring-boot-opentelemetry \
  --configuration runtimeClasspath
```

Spring Boot의 의존성 관리가 각각 Micrometer OTLP Registry 1.16.5와 Spring Boot OpenTelemetry 4.0.6을 선택했다. 버전을 직접 적지 않으면 현재 Spring Boot 버전과 맞는 조합을 사용할 수 있다.

## 전송 주기와 히스토그램 설정

로컬 프로필 설정인 `src/main/resources/application-local.yml`에는 다음 내용을 두었다.

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
  otlp:
    metrics:
      export:
        step: 10s
```

`percentiles-histogram`은 HTTP 응답시간을 여러 버킷으로 나눠 기록한다. 이 버킷이 있어야 Grafana에서 p95를 계산할 수 있다. `step: 10s`는 Micrometer가 10초마다 측정값을 묶어서 전송한다는 뜻이다.

실무에서는 전송 주기를 무조건 짧게 잡지 않는다. 주기가 짧으면 변화가 빠르게 보이지만 네트워크 요청과 저장할 표본이 늘어난다. 이번에는 로컬 실습에서 그래프가 움직이는 모습을 빠르게 확인하려고 10초를 사용했다.

## 환경변수로 주입한 인증 정보

Grafana Cloud의 OpenTelemetry 설정 화면에서 OTLP 엔드포인트와 API 토큰을 발급했다. 값은 코드나 YAML에 적지 않고 IntelliJ 실행 설정의 환경변수에 저장했다.

```text
OTEL_EXPORTER_OTLP_ENDPOINT=https://<Grafana Cloud OTLP 주소>/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<인증값>
OTEL_SERVICE_NAME=manyak-server-local
```

`OTEL_EXPORTER_OTLP_ENDPOINT`는 전송 목적지이고 `OTEL_EXPORTER_OTLP_HEADERS`는 Grafana Cloud가 요청자를 확인할 때 사용하는 인증 정보다. `OTEL_SERVICE_NAME`은 여러 애플리케이션의 메트릭을 구분하는 서비스 이름이며 이후 모든 PromQL 필터에 사용한다.

API 토큰은 비밀번호와 같다. 저장소, 블로그 본문, 스크린샷에 포함하면 안 된다. IntelliJ 실행 설정도 프로젝트 파일로 공유하지 않고 사용자 로컬 설정으로만 보관했다. 실습용으로 넓은 권한의 토큰을 만들었다면 이후 `metrics:write`처럼 필요한 범위만 가진 토큰으로 교체하는 편이 안전하다.

## 메트릭 전송 로그

Gradle 프로젝트를 다시 불러오고 애플리케이션을 재시작하자 다음 로그가 나타났다.

```text
Publishing metrics for OtlpMeterRegistry every 10s
to https://.../otlp/v1/metrics
with resource attributes {service.name=manyak-server-local}
```

이 로그는 세 가지를 알려준다. `OtlpMeterRegistry`가 생성됐고, 전송 주기는 10초이며, `service.name`이 `manyak-server-local`로 붙었다. 반대로 이 로그가 없다면 의존성 동기화, OTLP 설정, 환경변수 이름부터 확인해야 한다.

Grafana의 범용 OpenTelemetry 연결 마법사에서는 “traces를 찾지 못했다”는 메시지가 나왔다. 이번 구성은 메트릭 Registry만 연결했으므로 정상적인 결과다. 메트릭, 로그, 트레이스는 모두 관측 데이터지만 서로 다른 종류이며 하나를 보냈다고 나머지도 자동 전송되지는 않는다.

![메트릭만 연결한 상태에서 트레이스를 찾지 못했다는 OpenTelemetry 연결 검사 화면](/images/grafana-cloud-red-dashboard/08-traces-not-found.png)

## Grafana Explore의 JVM 메트릭

전송을 시작한 뒤 Grafana Explore의 메트릭 선택창에서 `jvm`을 검색하자 `jvm_memory_used_bytes`, `jvm_classes_loaded` 같은 메트릭이 나타났다.

![Grafana Explore에서 확인한 JVM 메트릭 목록](/images/grafana-cloud-red-dashboard/01-jvm-metrics.png)

다음 쿼리로 현재 JVM 메모리 사용량을 조회했다.

```text
jvm_memory_used_bytes{service_name="manyak-server-local"}
```

![heap과 nonheap 영역별 JVM 메모리 사용량 그래프](/images/grafana-cloud-red-dashboard/02-jvm-memory.png)

그래프가 여러 선으로 나뉘는 이유는 `area`와 `id` 라벨이 다르기 때문이다. 같은 `jvm_memory_used_bytes`라도 Eden Space, Old Gen, Metaspace는 서로 다른 시계열로 저장된다.

## OTLP의 HTTP 시간 단위

로컬 `/actuator/prometheus`에서는 HTTP 메트릭 이름이 `http_server_requests_seconds_*`였다. Grafana Cloud로 OTLP 전송한 뒤에는 다음 이름으로 조회됐다.

```text
http_server_requests_milliseconds_count
http_server_requests_milliseconds_sum
http_server_requests_milliseconds_bucket
```

데이터가 사라진 것이 아니라 내보내는 형식에 따라 기본 단위가 달라진 것이다. 메트릭 탐색기에서 실제 이름을 확인하지 않고 로컬에서 보던 `seconds` 이름을 그대로 입력하면 `No data`가 나온다.

![seconds 단위의 메트릭 이름으로 조회해 No data가 나온 화면](/images/grafana-cloud-red-dashboard/09-seconds-no-data.png)

누적 요청 수는 아래 쿼리로 확인했다.

```text
http_server_requests_milliseconds_count{
  service_name="manyak-server-local",
  uri="/actuator/health"
}
```

![health 요청 누적 카운터](/images/grafana-cloud-red-dashboard/03-request-counter.png)

카운터는 애플리케이션 시작 후 요청이 몇 번 발생했는지를 나타낸다. 운영 대시보드에서는 누적값보다 최근에 얼마나 빠르게 증가하는지가 더 유용하다.

## rate와 increase의 차이

`rate()`는 지정한 구간에서 카운터가 초당 얼마나 증가했는지 계산한다.

```text
rate(
  http_server_requests_milliseconds_count{
    service_name="manyak-server-local",
    uri="/actuator/health"
  }[1m]
)
```

![최근 1분의 health 요청 초당 증가율](/images/grafana-cloud-red-dashboard/04-request-rate.png)

그래프의 `0.3`은 요청이 총 0.3번 발생했다는 뜻이 아니라 최근 1분의 증가 속도가 초당 약 0.3건이라는 뜻이다. 1분 동안의 요청 건수를 보고 싶다면 같은 카운터에 `increase()`를 사용한다.

```text
increase(
  http_server_requests_milliseconds_count{
    service_name="manyak-server-local",
    uri="/actuator/health"
  }[1m]
)
```

예를 들어 `rate()`의 최고점이 약 `0.74 req/s`이고 같은 구간의 `increase()`가 약 44라면 두 값은 모순되지 않는다. `0.74 × 60초`가 약 44건이기 때문이다.

## 평균 응답시간과 p95

평균 응답시간은 처리 시간의 증가량을 요청 수 증가량으로 나눈 값이다.

```text
rate(
  http_server_requests_milliseconds_sum{
    service_name="manyak-server-local",
    uri="/actuator/health"
  }[1m]
)
/
rate(
  http_server_requests_milliseconds_count{
    service_name="manyak-server-local",
    uri="/actuator/health"
  }[1m]
)
```

![sum을 count로 나눈 평균 HTTP 응답시간](/images/grafana-cloud-red-dashboard/05-average-latency.png)

실습 당시 평균은 약 5.2~6.4ms였다. 평균은 전체적인 변화를 보기 쉽지만 일부 느린 요청이 섞여도 잘 드러나지 않을 수 있다.

p95는 히스토그램 버킷과 `histogram_quantile()`로 계산했다.

```text
histogram_quantile(
  0.95,
  sum by (le) (
    rate(
      http_server_requests_milliseconds_bucket{
        service_name="manyak-server-local",
        uri="/actuator/health"
      }[5m]
    )
  )
)
```

![히스토그램 버킷으로 계산한 p95 응답시간](/images/grafana-cloud-red-dashboard/06-p95-latency.png)

`sum by (le)`는 여러 시계열의 버킷을 상한값인 `le` 기준으로 합친다. `histogram_quantile(0.95, ...)`는 그 누적 분포에서 95번째 백분위 응답시간을 추정한다. 결과가 8ms라면 최근 5분 요청의 약 95%가 8ms 안에 끝났다는 의미다.

## RED 대시보드

RED는 Rate, Errors, Duration의 앞글자를 딴 서버 모니터링 관점이다. 요청이 얼마나 들어오는지, 그중 얼마나 실패하는지, 처리에는 얼마나 걸리는지를 함께 본다.

첫 번째 패널인 요청률은 전체 HTTP 요청 카운터의 초당 증가율을 합산했다.

```text
sum(
  rate(
    http_server_requests_milliseconds_count{
      service_name="manyak-server-local"
    }[5m]
  )
)
```

패널 단위는 `requests/sec (req/s)`로, 최솟값은 0으로 설정했다. 두 번째 패널에는 앞에서 만든 p95 쿼리를 넣고 단위를 milliseconds로 지정했다.

세 번째 패널인 5xx 오류율은 전체 요청 중 상태 코드가 5로 시작하는 요청의 비율을 계산한다.

```text
(
  100
  *
  sum(
    rate(
      http_server_requests_milliseconds_count{
        service_name="manyak-server-local",
        status=~"5.."
      }[5m]
    )
  )
  /
  sum(
    rate(
      http_server_requests_milliseconds_count{
        service_name="manyak-server-local"
      }[5m]
    )
  )
)
or vector(0)
```

`status=~"5.."`는 500부터 599까지의 상태 코드를 선택하는 정규식 필터다. 5xx 시계열이 아직 없을 때 쿼리 결과 자체가 사라질 수 있으므로 대시보드에서는 `or vector(0)`으로 0을 표시했다.

![요청률, p95, 5xx 오류율을 배치한 RED 대시보드](/images/grafana-cloud-red-dashboard/07-red-dashboard.png)

대시보드의 시간 범위는 최근 15분, 자동 새로고침은 10초로 설정했다. 터미널에서 health 엔드포인트를 반복 호출하자 요청률과 p95 패널이 움직였고 5xx를 만들지 않았기 때문에 오류율은 0%를 유지했다.

## 5xx 오류율 알림

대시보드는 사람이 보고 있을 때만 이상을 발견할 수 있다. Grafana Alerting에 “최근 5분의 5xx 오류율이 5%를 넘는 상태가 5분 동안 지속되면 알림”이라는 규칙을 추가했다.

알림 쿼리는 요청이 없을 때 0으로 나누는 문제까지 피하도록 작성했다.

```text
100
*
(
  sum(
    rate(
      http_server_requests_milliseconds_count{
        service_name="manyak-server-local",
        status=~"5.."
      }[5m]
    )
  )
  or vector(0)
)
/
clamp_min(
  sum(
    rate(
      http_server_requests_milliseconds_count{
        service_name="manyak-server-local"
      }[5m]
    )
  ),
  0.000001
)
```

`clamp_min()`은 분모가 0이 되지 않도록 최소값을 지정한다. 조건은 `IS ABOVE 5`, 평가 주기는 1분, Pending period는 5분, Keep firing for는 1분으로 설정했다. 짧은 순간의 오류 때문에 바로 알림이 발생하지 않고 5분 동안 문제가 이어질 때만 firing 상태가 된다.

알림에는 `service=manyak-server-local`, `environment=local`, `severity=warning` 라벨을 붙였다. 이메일 Contact point도 연결하고 RED 대시보드의 5xx 패널을 링크했다. 규칙을 저장한 직후에는 아직 평가되지 않아 `Unknown`이었지만 첫 평가가 끝난 뒤 `Normal`로 바뀌었다.

![첫 평가가 끝난 뒤 Normal 상태가 된 5xx 오류율 알림 규칙](/images/grafana-cloud-red-dashboard/10-alert-rule-normal.png)

이번에는 실제 이메일 발송까지 강제로 시험하지 않았다. 운영에 적용할 때는 통제된 5xx 응답을 발생시켜 `Normal → Pending → Firing → Normal` 전환과 수신 메시지를 끝까지 검증해야 한다.

## 운영 적용 전 점검

현재 `/actuator/prometheus`는 로컬 프로필에서만 노출된다. OTLP push 방식에서는 Grafana Cloud가 이 주소에 접근할 필요가 없으므로 운영에서 공개할 이유도 없다. 운영에 Prometheus pull 방식을 도입한다면 관리망, 방화벽 또는 인증으로 엔드포인트 접근을 제한해야 한다.

히스토그램은 p95를 계산할 수 있게 해주지만 버킷 수만큼 시계열도 늘린다. `user_id`, `story_id`, 실제 URL, 오류 메시지처럼 값의 종류가 계속 증가하는 데이터를 라벨에 넣으면 저장량과 비용이 급격히 커진다. HTTP 메트릭에는 템플릿화된 URI, 상태 코드, 메서드처럼 종류가 제한된 라벨을 사용하는 편이 맞다.

현재 대시보드는 로컬 인스턴스 하나를 대상으로 한다. 운영에서는 인스턴스별 상태, DB 커넥션 풀, JVM 메모리와 GC, No data 처리까지 추가해야 한다. 알림 임계값도 임의의 숫자를 그대로 사용하지 말고 실제 트래픽과 서비스 목표를 관찰한 뒤 조정해야 한다.

## 정리

Spring Boot의 Micrometer 메트릭을 OTLP로 Grafana Cloud에 전송하고 PromQL로 카운터, 요청률, 평균, p95, 오류율을 계산했다. 그 결과 RED 대시보드와 5xx 알림 규칙까지 만들 수 있었다. 다음 단계에서는 HTTP 공통 지표를 넘어 스토리 생성 성공률이나 LLM 호출 시간처럼 서비스가 직접 정의해야 하는 비즈니스 메트릭을 추가할 예정이다.
