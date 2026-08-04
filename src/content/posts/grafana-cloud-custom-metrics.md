---
title: "Spring Boot 커스텀 메트릭으로 스토리 생성과 AI 호출 시간 관측하기"
date: 2026-08-05
tags: [백엔드, 모니터링]
---

[이전 글](/posts/grafana-cloud-red-dashboard)에서는 Spring Boot의 HTTP 메트릭을 Grafana Cloud로 보내 요청률, p95 응답시간, 5xx 오류율을 보는 RED 대시보드를 만들었다. 서버 입구의 상태는 볼 수 있게 됐지만, HTTP 요청 하나 안에서 실제 서비스 로직의 어느 구간이 느린지는 여전히 알 수 없었다.

만약의 간편 스토리 완성 요청에는 소유권 확인, 체험 한도 또는 크레딧 처리, AI 컴파일 호출, 여러 테이블 저장이 함께 들어간다. HTTP p95가 높아졌다는 사실만으로는 AI가 느린지, 저장 과정이 느린지 구분하기 어렵다. 그래서 이번에는 서비스가 직접 정의하는 두 가지 커스텀 타이머를 추가하고 기존 Grafana 대시보드에 연결했다.

```text
manyak.story.creation.duration
  └─ 간편 스토리 완성 실행 블록 전체

manyak.ai.call.duration
  └─ AI 클라이언트를 호출하는 공통 경계
```

## HTTP 요청보다 안쪽의 서비스 경계를 측정했다

스토리 완성 시간은 컨트롤러가 아니라 `SimpleStoryCreationService`의 실제 실행 블록에서 측정했다. 컨트롤러 시간을 재면 인증 필터와 응답 직렬화까지 포함되지만, 여기서 알고 싶은 것은 스토리 완성 유스케이스 자체가 소비한 시간이었다.

Micrometer의 `Timer.Sample`을 작업 직전에 시작하고 성공과 실패 양쪽에서 같은 타이머에 기록했다. 이때 계측 코드의 실패가 정상 요청을 실패로 바꾸지 않도록 실제 작업과 메트릭 기록을 분리해야 한다. 작업 결과를 먼저 정한 뒤 `finally`에서 타이머를 기록하는 구조로 정리했다.

```kotlin
val timerSample = Timer.start(meterRegistry)
var timerOutcome = "failure"

try {
    val outcome = doCreateSimpleStory(request, userId, deviceId, isReclaim)
    timerOutcome = "success"
    outcome.response
} finally {
    recordStoryCreationDuration(timerSample, timerOutcome)
}
```

타이머 기록은 별도 함수로 모으고 `runCatching`으로 격리했다. 성공한 비즈니스 로직 뒤에 타이머 등록이나 기록이 실패하더라도 응답 결과는 바뀌지 않는다.

```kotlin
private fun recordStoryCreationDuration(sample: Timer.Sample, outcome: String) {
    runCatching {
        sample.stop(
            Timer.builder("manyak.story.creation.duration")
                .description("간편 스토리 완성 처리시간")
                .tag("outcome", outcome)
                .publishPercentileHistogram()
                .register(meterRegistry),
        )
    }
}
```

`outcome`에는 `success`와 `failure`만 사용했다. 요청 ID, 사용자 ID, 스토리 ID처럼 계속 새로운 값이 생기는 정보를 라벨에 넣으면 값마다 시계열이 만들어져 저장량과 조회 비용이 빠르게 증가한다. 성공 여부처럼 값의 종류가 제한된 정보만 라벨로 남기는 편이 안전하다.

`publishPercentileHistogram()`은 처리시간을 버킷별로 누적한다. 이 버킷이 있어야 Grafana에서 여러 인스턴스의 값을 합쳐 p95를 계산할 수 있다. 애플리케이션이 미리 계산한 단일 인스턴스 백분위수를 평균 내는 방식보다 확장에 유리하다.

라벨 값이 제한돼 있어도 히스토그램 비용이 사라지는 것은 아니다. `feature`와 `outcome`의 조합마다 버킷 시계열이 함께 만들어진다. 운영에서는 실제 지연 범위에 맞춰 `minimumExpectedValue`와 `maximumExpectedValue`를 정하거나, 서비스 목표에 필요한 SLO 버킷만 발행해 시계열 수를 제한해야 한다.

## 성공과 실패가 별도 시계열로 기록되는지 확인했다

서버를 재시작한 뒤 의도적인 실패 요청 한 번과 성공 요청 한 번을 실행했다. 로컬의 `/actuator/prometheus`에서는 다음 값이 확인됐다.

```text
manyak_story_creation_duration_seconds_count{outcome="failure"} 1
manyak_story_creation_duration_seconds_sum{outcome="failure"} 0.0060635

manyak_story_creation_duration_seconds_count{outcome="success"} 1
manyak_story_creation_duration_seconds_sum{outcome="success"} 0.071397542
```

실패 경로는 약 6ms, 성공 경로는 약 71ms로 기록됐다. 각 표본이 한 건뿐이므로 이 숫자를 성능 기준으로 해석할 수는 없다. 이 단계에서 확인한 것은 두 경로가 모두 계측되고, `outcome`에 따라 시계열이 분리되며, 히스토그램 버킷까지 생성된다는 사실이다.

로컬 Prometheus 엔드포인트에는 메트릭이 `manyak_story_creation_duration_seconds_*`로 노출됐지만 Grafana Cloud에서는 `manyak_story_creation_duration_milliseconds_*`로 보였다. 같은 Timer라도 Prometheus 텍스트 노출과 OTLP 전송 과정에서 기본 시간 단위와 이름이 달라질 수 있다. 쿼리를 작성할 때는 기억에 의존하기보다 Grafana Metrics browser에서 실제 수신된 이름을 먼저 확인하는 것이 정확하다.

## AI 호출은 공통 Recorder 한 곳에서 측정했다

AI 호출은 스토리라인 생성과 스토리 완성 외에도 채팅 같은 여러 기능에서 발생한다. 각 서비스 메서드에 타이머를 반복하면 계측을 빠뜨리거나 서로 다른 라벨 규칙을 사용할 가능성이 생긴다.

프로젝트에는 이미 모든 AI 요청을 감싸 로그를 기록하는 `AiCallRecorder`가 있었다. AI 클라이언트를 호출하기 직전부터 응답 또는 예외가 돌아올 때까지의 시간을 이 공통 경계에서 측정했다.

실제 구현에서 계측과 관련된 부분만 줄이면 다음과 같다. `block()`이 AI 클라이언트 호출이며, 성공과 실패 모두 같은 시작 시각을 기준으로 경과 시간을 계산한다.

```kotlin
val startNanos = System.nanoTime()

try {
    val result = block()
    val durationNanos = System.nanoTime() - startNanos
    recordAiCallDuration(context, "success", durationNanos)
    return result
} catch (throwable: Throwable) {
    val durationNanos = System.nanoTime() - startNanos
    recordAiCallDuration(context, "failure", durationNanos)
    throw throwable
}
```

계산한 시간을 Timer에 기록하는 함수는 다음과 같다.

```kotlin
private fun recordAiCallDuration(
    context: AiCallContext,
    outcome: String,
    durationNanos: Long,
) {
    runCatching {
        Timer.builder("manyak.ai.call.duration")
            .description("AI API 호출 처리시간")
            .tag("feature", context.feature.value)
            .tag("outcome", outcome)
            .publishPercentileHistogram()
            .register(meterRegistry)
            .record(durationNanos, TimeUnit.NANOSECONDS)
    }
}
```

`feature`에는 `storyline_generation`, `story_completion`, `chat_response`처럼 서버 코드가 정의한 제한된 값이 들어간다. `outcome`도 성공과 실패로 제한했다. 메트릭 기록 자체의 문제가 AI 요청을 실패시키면 안 되기 때문에 계측 코드는 `runCatching`으로 격리했다.

테스트에서는 `SimpleMeterRegistry`를 사용해 기능과 성공 여부가 올바른 Timer를 만들고 count가 증가하는지 확인했다. 이후 로컬에서 실제 흐름을 실행하자 다음 두 시계열이 생성됐다.

```text
manyak_ai_call_duration_seconds_count{
  feature="story_completion",
  outcome="success"
} 1

manyak_ai_call_duration_seconds_count{
  feature="storyline_generation",
  outcome="success"
} 1
```

이때 측정된 값은 약 1.6ms와 0.6ms였다. 로컬 실습에서는 실제 외부 AI가 아니라 빠른 스텁 응답을 사용했기 때문에 운영 AI 응답시간을 나타내지 않는다. 여기서는 공통 호출 경계에서 기능별 시계열이 나뉘고 Grafana Cloud까지 도착하는지만 검증했다.

## Grafana Cloud에서 두 종류의 p95를 만들었다

스토리 완성 p95 패널에는 성공 요청의 히스토그램 버킷만 사용했다.

```text
histogram_quantile(
  0.95,
  sum by (le) (
    rate(
      manyak_story_creation_duration_milliseconds_bucket{
        service_name="manyak-server-local",
        outcome="success"
      }[5m]
    )
  )
)
```

`rate(...[5m])`는 최근 5분 동안 각 버킷의 초당 증가율을 구하고, `sum by (le)`는 인스턴스가 여러 개여도 같은 버킷 경계끼리 합친다. `histogram_quantile(0.95, ...)`는 그 누적 분포에서 95%의 요청이 완료된 시간을 추정한다.

처음 최근 15분 범위에서는 결과가 보이지 않았다. 요청 시점이 화면 밖으로 밀려났고 표본도 한 건뿐이었기 때문이다. 범위를 30분으로 넓히자 약 60ms 지점에 데이터가 나타났다. p95는 충분한 요청이 쌓여야 의미가 있으므로 이 결과 역시 성능 평가가 아니라 쿼리와 전송 경로를 확인한 것으로 봤다.

AI 호출 p95는 한 패널에서 기능별로 비교할 수 있게 `feature` 라벨을 남겼다.

```text
histogram_quantile(
  0.95,
  sum by (le, feature) (
    rate(
      manyak_ai_call_duration_milliseconds_bucket{
        service_name="manyak-server-local",
        outcome="success"
      }[5m]
    )
  )
)
```

Grafana 패널의 Display name에는 `${__field.labels.feature}`를 입력했다. 그 결과 범례에 전체 라벨 문자열 대신 `story_completion`, `storyline_generation`만 표시됐다.

쿼리 검증을 마친 뒤 아래 화면은 패널 배치를 확인하기 위해 시간 범위를 다시 15분으로 돌린 상태에서 캡처했다. 따라서 이미지는 표본이 나타난 30분 범위가 아니라 최종 대시보드 구성을 보여준다.

![HTTP RED 지표에 스토리 완성과 AI 호출 p95 패널을 추가한 대시보드 구성](/images/grafana-cloud-custom-metrics/01-final-dashboard.png)

최종 대시보드에는 기존 요청률, HTTP p95, 5xx 오류율과 함께 스토리 완성 p95, AI API 호출 p95가 놓였다. 이제 HTTP 응답시간이 늘어날 때 스토리 완성과 AI 호출 지표가 같은 시점에 함께 상승하는지 비교해 원인 후보를 좁힐 수 있다. 두 p95는 서로 다른 표본에서 계산되므로 빼거나 나눠 AI 호출의 기여도를 구할 수는 없다. 요청별 구간 시간을 연결해 보려면 트레이스나 요청 ID로 연관된 별도 계측이 필요하다.

## 로컬 실습을 끝낸 뒤 알림 규칙을 Pause했다

이전 글에서 만든 5xx 오류율 규칙은 로컬 서버가 꺼지면 데이터가 더 이상 들어오지 않는다. No data 처리 설정에 따라 이를 이상 상태로 판단하면 개발을 마치고 서버를 끌 때마다 이메일이 올 수 있다.

실습이 끝난 뒤 규칙을 삭제하지 않고 Pause했다. Pause는 규칙 정의를 보존한 채 평가와 알림 전송만 멈추므로 나중에 다시 시험하기 쉽다. 다만 운영에서는 No data가 애플리케이션 중단이나 수집 파이프라인 장애를 뜻할 수 있다. 운영 규칙을 단순히 Pause하거나 No data를 정상으로 취급하기보다 서비스 가용성 알림과 메트릭 수집 장애 알림을 따로 설계해야 한다.

## 운영 적용 전에는 표본과 경계를 다시 봐야 한다

이번 결과는 로컬 인스턴스 하나와 극소수 표본으로 계측 흐름을 검증한 것이다. 실제 임계값은 운영 트래픽의 기준선이 쌓인 뒤 정해야 한다. 스토리 완성 시간은 AI 외에도 DB 저장, 크레딧 처리, 락 대기 시간을 포함한다. 전체 p95만 상승하고 AI p95가 같은 시점에 변하지 않는 현상이 반복된다면 내부 처리 구간을 더 세분화해 볼 근거가 된다. 이것은 원인 확정이 아니라 다음 계측 대상을 정하기 위한 신호다.

AI 지표도 호출 시간 하나로 끝나지 않는다. 운영에서는 기능별 성공률, 타임아웃, 외부 제공자 오류를 함께 봐야 한다. 인프라 측면에서는 CPU, JVM 메모리와 GC, HikariCP 커넥션 풀을 같은 시간축에 놓으면 서비스 지연이 애플리케이션 자원 부족에서 시작됐는지도 확인할 수 있다.

## 정리

HTTP RED 지표는 서버 입구에 문제가 있다는 사실을 알려주지만 서비스 내부의 원인까지 설명하지는 못한다. 스토리 완성 유스케이스 전체와 AI 호출 공통 경계에 Micrometer Timer를 추가하면서 두 구간의 p95를 따로 볼 수 있게 됐다.

이번 실습의 핵심은 대시보드 패널의 개수가 아니라 측정할 경계를 먼저 정하고, 값의 종류가 제한된 라벨만 사용하고, 로컬 원문부터 Grafana Cloud 수신 결과까지 차례로 검증한 과정이었다. 운영에서는 이 구조를 유지한 채 실제 데이터에 맞춰 지표와 알림 기준을 확장하면 된다.
