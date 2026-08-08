---
title: "메트릭을 운영에 적용하며 고친 것들"
date: 2026-08-07
tags: [백엔드, 모니터링]
---

[이전 글](/posts/grafana-cloud-custom-metrics) 마지막에 운영에서는 같은 구조를 유지한 채 실제 데이터에 맞춰 확장하면 된다고 썼다. 막상 운영에 올려 보니 그렇게 간단하지 않았다. 의존성을 추가한 것만으로 전송이 이미 켜져 있었고, 생성 시간을 재던 구간에는 실제로 스토리를 만들지 않는 경로가 섞여 있었다. 인프라 배선을 다 끝냈는데도 데이터가 오지 않는 일도 있었다.

이번에는 계측을 더 붙이기보다 무엇을 재고 무엇을 빼야 하는지를 다시 정했다. 로컬에서 맞다고 생각한 가정이 운영에서 틀린 경우도 함께 정리했다.

환경은 이전과 같다. Java 21, Kotlin 2.2.21, Spring Boot 4.0.6, Micrometer 1.16.5를 쓴다. 운영은 EC2 `t3.small` 한 대에 애플리케이션 서버와 AI 서버 컨테이너를 함께 띄우고, 메트릭은 Grafana Cloud로 OTLP push한다.

## OTLP 전송의 기본값

운영에는 아직 자격증명을 넣지 않았으니 당연히 꺼져 있을 것이라 생각했다. 확인해 보니 그렇지 않았다.

```java
// io.micrometer.registry.otlp.OtlpConfig
default String url() {
    return getUrlString(this, "url").orElseGet(() -> {
        Map<String, String> env = System.getenv();
        String endpoint = env.get("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT");
        if (endpoint == null) {
            endpoint = env.get("OTEL_EXPORTER_OTLP_ENDPOINT");
        }
        if (endpoint == null) {
            endpoint = "http://localhost:4318/v1/metrics";
        }
        ...
    });
}
```

`management.otlp.metrics.export.enabled`의 기본값은 `true`다. `micrometer-registry-otlp`를 의존성에 넣는 순간 레지스트리가 만들어지고, 엔드포인트를 주지 않으면 위 코드의 마지막 분기를 타 `localhost:4318`로 전송을 시도한다. 운영뿐 아니라 테스트 프로파일도 매 주기마다 같은 일을 한다.

그래서 공통 설정에서 기본값을 뒤집었다.

```yaml
management:
  otlp:
    metrics:
      export:
        enabled: ${MANYAK_OTLP_METRICS_ENABLED:false}
        step: 60s
```

로컬 프로파일에도 `true`를 박지 않았다. 매번 환경변수를 넣기가 귀찮아 한동안 켜 뒀지만, 그러면 엔드포인트 없이 레포를 받아 실행한 앱이 10초마다 연결 거부를 쌓는다. 어느 환경에서든 엔드포인트를 먼저 주입하고 토글을 나중에 켜는 순서로 통일했다.

전송 주기는 로컬에서 쓰던 10초 대신 운영에서 60초를 쓴다. 주기가 짧을수록 분당 데이터 포인트 수에 비례해 사용량이 늘어나는데 인스턴스가 하나뿐인 서비스에서 60초보다 촘촘한 해상도가 주는 이득이 없었다. 대신 이 선택에는 trade off를 감수해야 한다. 원본 데이터 포인트가 분당 하나이므로 1분 미만의 짧은 스파이크는 대시보드에 아예 나타나지 않는다. 그런 사건은 로그나 Sentry의 몫으로 넘어간다.

## 프로파일별 Actuator 노출

OTLP push는 애플리케이션이 밖으로 밀어 넣는 방식이라 Grafana Cloud가 `/actuator/prometheus`에 접근할 일이 없다. 운영의 Actuator 노출 목록은 `health,info`로 두고 로컬에만 `prometheus`를 더했다.

문제는 Security 설정 쪽이었다. 처음에는 무인증 허용 목록에 경로를 그냥 끼워 넣었다.

```kotlin
.requestMatchers(
    "/actuator/health",
    "/actuator/prometheus",   // 전역 허용 목록
    ...
).permitAll()
```

지금은 운영 노출 목록에 `prometheus`가 없어서 접근할 수 없다. 하지만 나중에 누군가 노출 목록에 한 줄을 더하면 내부 지표가 인증 없이 공개된다. 노출 목록과 인증 설정이 두 겹으로 막고 있어야 하는데 한 겹을 미리 열어 둔 상태였다.

프로파일 조건으로 감쌌다.

```kotlin
.authorizeHttpRequests {
    if (environment.matchesProfiles("local")) {
        it.requestMatchers("/actuator/prometheus").permitAll()
    }
    it.requestMatchers("/actuator/health", ...).permitAll()
    ...
}
```

여기에 더해 운영에서는 Prometheus 레지스트리 자체를 만들지 않도록 `management.prometheus.metrics.export.enabled`를 `false`로 뒀다. 엔드포인트가 아예 존재하지 않으면 노출 실수라는 것이 성립하지 않는다.

## 비즈니스 로직과 계측의 격리

계측 코드도 손봤다. 이전 글에서는 `Timer.Sample`로 시작과 종료를 묶었는데 운영에 올리면서 시계를 한 번만 읽는 방식으로 바꿨다.

```kotlin
val startNanos = System.nanoTime()
try {
    val result = block()
    // 시계는 한 번만 읽어 로그(latency_ms)·DB·메트릭이 같은 구간을 가리키게 한다
    val durationNanos = System.nanoTime() - startNanos
    log.markSucceeded(latencyMs = durationNanos / 1_000_000)
    repository.save(log)
    recordDuration(context, OUTCOME_SUCCESS, durationNanos)
    return RecordedAiCall(result, log.id)
} catch (throwable: Throwable) {
    val durationNanos = System.nanoTime() - startNanos
    log.markFailed(latencyMs = durationNanos / 1_000_000, errorCode = errorCode(throwable))
    repository.save(log)
    recordDuration(context, OUTCOME_FAILURE, durationNanos)
    throw throwable
}
```

원래는 구조화 로그용으로 한 번, 타이머용으로 한 번 따로 `nanoTime()`을 읽고 있었다. 값이 크게 다르지는 않지만 나중에 로그의 `duration_ms`와 대시보드의 p95를 나란히 놓고 비교할 때 같은 구간을 가리키는 편이 낫다.

기록 자체는 `runCatching`으로 감쌌다.

```kotlin
private fun recordCreationDuration(outcome: String, durationNanos: Long) {
    // 메트릭 기록 실패가 성공한 스토리 생성을 500으로 만들거나
    // 실패 경로에서 원래 예외를 가리지 않도록 격리한다
    runCatching {
        Timer.builder("manyak.story.creation.duration")
            .tag("outcome", outcome)
            .register(meterRegistry)
            .record(durationNanos, TimeUnit.NANOSECONDS)
    }
}
```

성공 경로만 생각하다 격리를 빼먹었다. 그런데 실패 경로에서 타이머가 예외를 던지면 원래 AI 예외가 그 예외에 가려져 클라이언트가 엉뚱한 오류를 받는다. 관측이 비즈니스보다 우선할 수 없으므로 두 경로 모두 감쌌다.

## 생성 시간에 섞인 조회 경로

이전 글에서 타이머를 스토리 완성 실행 블록 전체에 걸었다. 그런데 그 블록에는 AI를 호출하지 않고 저장된 결과만 돌려주는 경로가 두 개 있다.

하나는 멱등 재요청이었다. 같은 `requestId`로 다시 들어온 완료 요청은 저장해 둔 결과를 그대로 반환한다. AI를 호출하지 않으니 몇 밀리초면 끝나는데 이 경로는 타이머가 감싸는 콜백 자체를 타지 않아 애초에 빠져 있었다.

다른 하나는 코드 리뷰가 짚어 준 경로다. 세션은 이미 완료됐는데 요청 행이 미완료로 남은 상황에서 회수 재실행이 들어오면, 저장된 스토리를 읽어 응답을 재구성해 돌려준다. 이것도 AI 호출과 저장이 없는 조회지만 콜백 안에서 조기 반환하기 때문에 타이머는 그대로 올라가고 있었다.

둘을 구분할 근거는 이미 코드에 있었다. 재구성 경로만 AI 호출 기록 식별자가 비어 있다.

```kotlin
val outcome = doCreateSimpleStory(request, userId, deviceId, isReclaim)
val durationNanos = System.nanoTime() - startNanos
// aiCallLogId가 null이면 재구성 — AI·저장을 타지 않은 조회라 측정에서 뺀다
if (outcome.aiCallLogId != null) {
    recordCreationDuration(OUTCOME_SUCCESS, durationNanos)
}
```

밀리초짜리 조회가 수십 초짜리 생성과 같은 히스토그램에 들어가면 p95가 실제 비용보다 낮게 나온다. 표본이 적을 때는 티가 나지 않지만 조회 비율이 커질수록 지표가 어긋나기 시작한다.

## 실패와 거부의 분리

같은 문제가 실패 쪽에도 있었다. `catch` 블록이 예외 종류를 가리지 않고 전부 `failure`로 기록했는데 거기 들어오는 예외는 두 갈래였다.

한쪽은 생성을 시도하기 전에 거부한 것이다. 세션을 못 찾은 404, 남의 세션을 완료하려 한 403, 이미 생성된 세션에 들어온 409, 크레딧이 부족한 402가 여기 속한다. 전부 DB 조회 몇 번으로 끝나므로 밀리초 단위다. 다른 쪽은 실제로 생성을 시도하다 깨진 것이다. AI 호출이 실패하거나 타임아웃한 502, 응답 검증에 걸린 502가 여기 속하고 수 초에서 180초까지 걸린다.

이 둘이 한 히스토그램에 섞이면 실패 p95의 의미가 뒤집힌다. 거부 비중이 커질수록 p95가 내려가므로 AI가 실제로 느려져도 지표는 개선된 것처럼 보인다. 거부는 클라이언트 버그나 재시도 루프로 얼마든지 늘어날 수 있는 변수다. 실패 건수로 알림을 걸면 누군가 없는 주소를 반복 호출하는 것만으로 AI 장애 알림이 울린다.

그래서 `outcome` 태그를 세 값으로 늘렸다. 생성과 저장까지 끝낸 것은 `success`, 생성을 시도하다 깨진 것은 `failure`, 생성 시도 이전에 거부된 것은 `rejected`다. 태그 값이 하나 늘어도 유한한 집합이라 카디널리티 문제는 없다. 대신 알림과 실패 p95는 `outcome="failure"`만 봐야 한다는 제약이 생긴다.

## HTTP 상태 코드의 한계

처음에는 4xx면 `rejected`로 보내는 단순한 규칙을 썼다. 이것도 리뷰에서 지적을 받았다.

같은 세션에 서로 다른 요청 두 개가 겹치면 둘 다 잠금 없는 초기 검사를 통과해 AI를 호출한다. 진 쪽은 저장 단계에서 잠금을 잡은 뒤 이미 완료된 세션을 발견하고 409를 던진다. 이건 수십 초를 쓴 진짜 생성 실패인데 상태 코드만 보면 밀리초 거부로 분류된다. 막으려던 왜곡이 방향만 반대로 다시 생긴다.

그래서 판별 기준을 HTTP 상태에서 compile이 시작됐는지로 바꿨다.

```kotlin
private fun creationOutcomeOf(exception: Exception, compileStarted: Boolean): String = when {
    compileStarted -> OUTCOME_FAILURE
    exception is ResponseStatusException && exception.statusCode.is4xxClientError -> OUTCOME_REJECTED
    else -> OUTCOME_FAILURE
}
```

`compileStarted`는 AI 클라이언트를 호출하기 직전에 표시한다. 이렇게 두면 앞으로 AI 호출 이후에 4xx가 새로 생기더라도 자동으로 옳게 분류된다.

## 겹쳐 쓰는 outcome 태그

`outcome`을 세 값으로 늘리고 나서야 알아차린 것이 있다. Spring Boot가 자동으로 붙이는 `http.server.requests`에도 이미 `outcome` 태그가 있다. 값은 `SUCCESS`, `CLIENT_ERROR`, `SERVER_ERROR`, `REDIRECTION`이다.

이름만 같고 의미는 전혀 다르다. Spring 쪽은 HTTP 상태 코드를 묶고, 우리 쪽은 유스케이스가 어디까지 진행됐는지를 나타낸다. 대소문자까지 달라 쿼리에서 섞어 써도 오류 없이 빈 결과만 나온다. 그래서 더 늦게 알아차리기 쉽다.

`outcome`은 Micrometer 관례에 가까워 이름을 바꾸지 않았다. 대신 대시보드 문서 맨 앞에 두 태그를 나란히 놓고 헷갈리지 말라고 적어 뒀다.

## 상호 배타적인 카운터 테스트

분류를 고치면서 테스트를 붙일 때 한 가지를 신경 썼다. `rejected`가 1 늘었다는 것만 확인하면 분류가 틀려도 통과할 수 있다는 점이다.

```kotlin
// 4xx 거부
assertThat(storyCreationTimerCount("rejected")).isEqualTo(beforeRejected + 1)
assertThat(storyCreationTimerCount("failure")).isEqualTo(beforeFailure)

// 502 AI 실패
assertThat(storyCreationTimerCount("failure")).isEqualTo(beforeFailure + 1)
assertThat(storyCreationTimerCount("rejected")).isEqualTo(beforeRejected)
```

한쪽이 올랐다는 사실과 다른 쪽이 오르지 않았다는 사실을 함께 단정해야 분류가 맞았다고 볼 수 있다. 절대값 대신 증가분을 확인한 데에도 이유가 있다. `@SpringBootTest` 컨텍스트는 테스트 클래스 사이에서 캐시를 공유하므로 미터 레지스트리의 카운터가 계속 누적된다. `count() == 1`로 쓰면 실행 순서에 따라 깨진다.

경합 시나리오는 재현이 까다로울 것 같았는데 생각보다 간단했다. 가짜 AI 클라이언트가 `compileStory` 안에서 별도 트랜잭션으로 세션 상태를 바꾸게 하니 타이밍에 기대지 않고 재현할 수 있었다. 실패하는 테스트를 먼저 만들었을 때 `expected: 1L but was: 0L`이 떴다. 리뷰에서 지적받은 결함이 실제로 일어나는 문제였다는 뜻이다.

## 타임아웃을 반영한 히스토그램 상한

버킷 수는 시계열 수에 그대로 곱해지므로 기대 구간을 좁혀 잘라야 한다. 구간을 바꿔 가며 실제 버킷 수를 세어 봤다.

```text
기본(1ms~30s)     69개
10ms~10s          47개
100ms~120s        49개
100ms~240s        54개
```

처음에는 AI 호출 타이머의 상한을 120초로 잡았는데 코드 리뷰에서 이 값이 잘못됐다는 지적을 받았다. AI 클라이언트의 읽기 타임아웃이 호출 종류마다 다르고 그중 가장 긴 것이 180초이기 때문이다. 스토리라인 생성이 90초, 본문 완성이 180초, 채팅 스트림이 60초, 선택지 생성이 90초이고 연결 타임아웃은 공통 5초다.

상한을 타임아웃보다 낮게 잡으면 타임아웃 안쪽에서 정상 응답한 느린 호출까지 전부 마지막 버킷으로 밀려 들어간다. 그러면 정작 제일 보고 싶은 타임아웃 직전 구간의 분포가 사라진다. 240초로 올렸더니 버킷은 다섯 개 늘어나는 데 그쳤다.

반대로 HTTP 히스토그램은 10초 상한을 그대로 뒀다. AI를 기다리는 엔드포인트의 HTTP p95가 10초에서 뭉개진다는 뜻이지만 그 경로의 지연은 어차피 전용 타이머가 담당한다. HTTP 상한을 올리면 늘어난 버킷이 엔드포인트 수만큼 곱해져 비용이 커지므로 알고 받아들인 선택이라는 것을 문서에 적어 뒀다.

## 시크릿을 지키는 배포 스크립트

운영 배선을 준비하면서 배포 스크립트를 읽다가 계측과 무관한 문제를 발견했다. 이 스크립트는 실행할 때마다 Secrets Manager를 다시 읽어 컨테이너 환경변수 파일을 통째로 다시 쓴다. 부팅뿐 아니라 서버 배포, AI 배포, DB 비밀번호 로테이션 재동기화 때마다 일어나는 일이다.

문제는 시크릿 조회가 빈 문자열을 돌려줘도 스크립트가 그대로 진행한다는 것이었다.

```bash
APP_SECRET_JSON=""                       # 조회가 빈 값을 돌려준 상황
echo "$APP_SECRET_JSON" | jq -r '.MANYAK_AUTH_JWT_SECRET // ""'
# → exit 0, 빈 출력. set -e 가 발동하지 않는다
```

`jq -r '.KEY // ""'`는 빈 입력에도 정상 종료한다. `set -e`가 걸려 있어도 멈추지 않고 JWT 서명키, DB 비밀번호, API 키가 모두 빈 환경변수 파일을 만든다. 잘못된 JSON은 `jq`가 오류를 내면서 스크립트도 멈추지만, 빈 응답만 조용히 통과하고 있었다.

파일을 쓰는 방식에도 문제가 있었다. 원래는 그룹 리다이렉션으로 대상 파일을 바로 덮었다.

```bash
{ echo "..."; echo "..."; } > /opt/manyak/.env
sed -i 's/\$/$$/g' /opt/manyak/.env
```

이 방식은 파일을 먼저 비우기 때문에 중간에 실패하면 잘린 파일이 남는다. 게다가 이 스크립트는 기존 파일에서 이미지 태그를 읽어 보존하는 구조라, 파일이 한 번 망가지면 시크릿뿐 아니라 배포된 이미지 핀까지 잃는다.

고친 것은 셋이다. 쓰기 전에 시크릿이 유효한 object JSON인지부터 검사한다.

```bash
require_object_json() {
  if [ -z "$2" ] || ! printf '%s' "$2" | jq -e 'type == "object"' >/dev/null 2>&1; then
    echo "$1 시크릿이 비어 있거나 object JSON 이 아님 — .env 를 갱신하지 않고 중단" >&2
    exit 1
  fi
}
```

길이 검사를 `jq` 앞에 둔 이유가 있다. 빈 입력에 대한 `jq -e`의 종료 코드가 버전마다 달랐다. 로컬의 1.7.1은 4를 반환하는데 컨테이너 베이스 이미지의 1.6은 0을 반환한다. 어느 쪽이든 안전하도록 셸에서 먼저 걸렀다.

그다음 필수 키를 정의해 누락을 잡는다.

```bash
REQ_OK='[to_entries[]|select(.value|type=="string" and test("[^[:space:]]") and (test("\n")|not))|.key]'
missing_keys() { printf '%s' "$1" | jq -r --argjson r "$2" "\$r - $REQ_OK|join(\", \")"; }
```

값이 문자열이고, 공백만으로 이루어지지 않았으며, 개행이 없어야 통과한다. 개행 검사를 넣은 이유는 값이 배열이나 객체면 `jq -r`이 여러 줄로 펼쳐져 환경변수 파일 뒷줄이 깨지기 때문이다. 실제로 배열 하나를 넣어 보니 네 줄로 펼쳐졌다.

무엇을 필수로 볼지가 이 작업의 실제 판단이었다. 없으면 컨테이너가 뜨지 못하는 JWT 서명키와 AI API 키, 그리고 비면 로그인이 전면 차단되는 Google client-id까지 세 개만 필수로 묶었다. Sentry DSN이나 Slack webhook, 그리고 이번에 추가한 OTLP 자격증명은 선택으로 뒀다. 관측 설정이 빠졌다고 운영 배포 전체가 막히는 편이 더 나쁜 실패 모드라고 봤기 때문이다.

파일은 임시 이름으로 쓰고 치환까지 끝낸 뒤에 옮기도록 바꿨다.

```bash
trap 'rm -f /opt/manyak/.env.tmp' EXIT
{ ... } > /opt/manyak/.env.tmp
chmod 600 /opt/manyak/.env.tmp
sed -i 's/\$/$$/g' /opt/manyak/.env.tmp
mv /opt/manyak/.env.tmp /opt/manyak/.env
```

중간에 무엇이 실패하든 기존 파일은 그대로 남는다.

## 배포 파이프라인과 메트릭 공백

배선은 Secrets Manager에 자격증명을 넣고 배포 스크립트가 그 값을 환경변수 파일에 기록하는 방식이다. 환경변수 이름은 표준 `OTEL_EXPORTER_OTLP_*` 대신 Spring 전용 이름을 썼는데 공용 환경변수 파일을 AI 컨테이너가 함께 읽기 때문이다. 표준 이름은 OpenTelemetry 규약이라 AI 쪽 SDK도 같은 값을 그대로 집어 든다.

적용하고 환경변수 파일에 세 줄이 기록된 것까지 확인했다. 그런데 데이터가 오지 않았고 오류 로그도 없었다.

원인은 계측 코드가 아직 운영 이미지에 없다는 것이었다. 운영 이미지는 `main` 브랜치를 기준으로 빌드되는데 계측 커밋은 `dev`에만 있었다. `micrometer-registry-otlp`가 클래스패스에 없으니 레지스트리가 만들어지지 않았고, 그래서 전송 시도도 오류도 없었던 것이다. 릴리스를 내보내고 나서야 기동 로그에 이 줄이 찍혔다.

```text
Publishing metrics for OtlpMeterRegistry every 1m to
https://otlp-gateway-.../otlp/v1/metrics
with resource attributes {service.name=manyak-server}
```

배포 문서에 main 푸시만 프로덕션 배포를 트리거한다고 적혀 있었는데도 놓쳤다. 인프라 배선과 애플리케이션 릴리스가 서로 다른 파이프라인을 탄다는 사실을 확인 조건에 넣지 않은 탓이다.

한 가지 더 있었다. 인프라 적용은 인스턴스를 교체하는데 새로 뜬 인스턴스에는 기존 환경변수 파일이 없다. 배포 스크립트는 바로 그 파일에서 이미지 태그를 읽어 보존하므로 파일이 없으면 terraform 기본값인 `:latest`로 떨어진다. 특정 커밋으로 고정해 둔 이미지 핀이 인스턴스 교체와 함께 조용히 풀린 것이다. 이번에는 두 태그가 같은 이미지를 가리키고 있어서 실제로 뜨는 컨테이너가 달라지지 않았지만 롤백 중이었다면 롤백이 취소됐을 상황이다.

## 서버 레포의 대시보드 JSON

이전에는 대시보드를 Grafana 화면에서 손으로 만들었다. 이번에는 JSON 모델을 서버 레포에 두고 import하는 방식으로 바꿨다.

이번 작업에서 이유가 분명해졌다. `outcome` 태그가 두 값에서 세 값으로 바뀌자 알림과 p95 쿼리도 함께 바꿔야 했다. 대시보드 쿼리는 서버 코드가 정의한 메트릭 이름과 라벨에 의존한다. 같은 레포에 두면 계약이 바뀔 때 대시보드도 고쳐야 한다는 사실이 리뷰에 드러나지만, 다른 곳에 있으면 어긋난 줄 모르고 지나간다. 수동 검증용 요청 파일을 `http/` 디렉터리에 두는 것과 같은 성격이다.

Terraform provider로 관리하면 IaC가 되어 인프라 레포로 가야 하지만 손으로 import하는 JSON은 IaC가 아니다. 대시보드가 늘어 수동 import가 번거로워지면 그때 옮기면 되고 JSON 자체는 그대로 재사용된다. JSON에 UID를 명시해 두면 몇 번을 덮어써도 대시보드 주소가 유지된다는 것도 알아 뒀다. 명시하지 않으면 import할 때마다 새 대시보드가 생긴다.

## 세 층으로 나눈 지연

패널은 세 층으로 배치했다. 한 요청은 여러 구간을 지나는데 지표를 한 층만 보면 느리다는 사실까지만 알고 어디가 느린지는 모르기 때문이다.

```text
HTTP 입구        http.server.requests            서비스가 밖에서 정상으로 보이나
  └ 유스케이스   manyak.story.creation.duration  스토리 완성이 느린가
      └ 외부 경계 manyak.ai.call.duration        AI가 느린가
```

![RED 지표와 AI 호출 패널](/images/metrics-to-production/01-dashboard-red-ai.png)

세 층을 함께 읽으면 원인 후보가 좁아진다. AI p95와 HTTP p95가 같이 오르면 AI 지연이 그대로 사용자에게 전달되는 중이라 우리가 손댈 것이 없다. AI p95는 정상인데 완성 p95만 오르면 저장이나 크레딧 처리, 락 대기처럼 AI 밖에서 시간을 쓰는 중이다. 완성 p95는 정상인데 HTTP p95가 오르면 다른 엔드포인트를 봐야 한다는 신호다.

완성 p95는 성공과 실패를 아예 다른 선으로 그렸다. 성격이 다르기 때문이다. 성공 쪽은 사용자가 체감하는 성능이지만 실패 쪽은 대부분 타임아웃까지 기다린 시간이라 180초 근처에 붙는다. 한 선으로 합치면 실패 비중이 변할 때마다 값이 출렁여 해석이 불가능해진다.

요청률 패널에서는 급증보다 급감이 더 위험한 신호라는 것도 뒤늦게 정리했다. 요청이 0에 수렴하면 서버가 아니라 그 앞단이 깨졌을 가능성이 있는데 이때 5xx 오류율은 오히려 깨끗해 보인다. 처리할 요청이 없으니 실패할 요청도 없기 때문이다.

![스토리 완성과 인프라 패널](/images/metrics-to-production/02-dashboard-story-infra.png)

인프라 패널도 같은 화면에 뒀다. 운영은 `t3.small` 한 대에 서버와 AI 컨테이너를 함께 얹은 구성이라 자원 경합이 실제로 일어날 수 있다. 외부 AI가 느린 경우와 서버 자원이 부족한 경우는 대응이 완전히 다르다.

CPU 패널에 프로세스와 시스템 두 선을 함께 그린 것도 그래서다. 시스템만 높고 프로세스가 낮으면 CPU를 먹는 쪽이 우리 서버가 아니라 옆 컨테이너라는 뜻이라, 서버 코드를 뒤질 일이 아니다. HikariCP는 대기 커넥션 수만 보면 되는데 이 값이 0이 아니면 다른 해석의 여지 없이 DB 병목이고 그 대기는 HTTP p95에 그대로 더해진다.

다만 두 p95를 빼서 AI 기여도를 구할 수는 없다. 서로 다른 표본에서 계산한 분위수라 산술이 성립하지 않는다. 요청별 구간 시간을 연결하려면 트레이스나 요청 ID 기반의 별도 계측이 필요하다. 이 대시보드는 원인 후보를 좁히는 도구이지 원인을 확정하는 도구가 아니다.

## Micrometer와 Langfuse의 역할

대시보드를 만들고 나서 스스로 의심이 들었다. AI 서버는 이미 Langfuse로 LLM 호출을 추적하고 있다. 그러면 `manyak.ai.call.duration`은 중복 아닌가.

따져 보니 겹치는 것은 지연 하나뿐이었고, 그것도 재는 구간이 달랐다.

```text
manyak-server ──① 컨테이너 왕복 + AI 서버 처리 ──▶ manyak-ai ──② LLM ──▶ 제공자
              └───── manyak.ai.call.duration ─────┘  └── Langfuse ──┘
```

Micrometer는 ①과 ②를 합쳐 재고 Langfuse는 ②만 잰다. 그 사이에 프롬프트 조립, 응답 검증, 재시도, 컨테이너 간 네트워크가 있고, 서버와 AI가 같은 인스턴스에 얹혀 있으니 자원 경합도 여기 들어간다. Langfuse만 보면 LLM은 3초인데 사용자는 12초를 기다린 상황을 잡지 못한다.

장애가 났을 때의 동작은 더 갈렸다. Langfuse는 AI 서버가 살아 있어야 기록한다. AI 서버가 죽거나 타임아웃하면 trace가 아예 생기지 않고, 없는 것으로는 실패율을 셀 수 없다. 실패율이 오르는 게 아니라 그래프가 비어 버린다. 뒤에 나오는 `No data` 문제와 정확히 같은 구조다. 관측 대상이 죽을 때 같이 조용해지는 도구는 장애 감지에 쓸 수 없다.

실패의 정의도 어긋난다. AI가 200을 돌려줬는데 서버가 응답 검증에서 깐 경우 Langfuse에는 성공으로 남는다. 사용자는 502를 받았는데도 그렇다.

둘은 대체재가 아니라 순서가 다른 도구였다. Micrometer로 알림을 걸고, 알림이 울리면 Langfuse로 원인을 파고든다. Micrometer에는 모델명이나 프롬프트 버전, 토큰 수를 태그로 붙이지 않기로 했다. 값이 바뀔 때마다 시계열이 늘어나는 전형적인 카디널리티 폭발이고, 그 정보는 Langfuse에서 보는 편이 낫다.

## 추정과 실측의 차이

가장 먼저 걸린 것은 라벨 이름이었다. 설계 메모에 Grafana Cloud가 `service.name`을 `job` 라벨로 승격한다고 적어 뒀는데 실제로는 `service_name`으로 들어온다. 이전 글에서 로컬 쿼리를 쓸 때 이미 `service_name`을 썼으면서도 문서에만 다르게 적혀 있었다. 실습에서 손으로 확인한 사실과 정리해 둔 문장이 따로 놀고 있었다. `job`으로 쿼리하면 오류가 나는 것이 아니라 그냥 빈 패널이 되기 때문에 이런 종류는 한참 뒤에야 알아차리게 된다.

메트릭 이름도 절반만 맞았다. 로컬 `/actuator/prometheus`는 `_seconds_*`인데 Grafana Cloud에는 `_milliseconds_*`로 도착한다는 것은 이전 글에서 이미 확인했다. 다만 그때는 커스텀 타이머 두 개만 그런 줄 알았는데, 이번에 다른 패널을 만들면서 보니 `http_server_requests`와 `jvm_gc_pause`를 포함해 타이머라면 예외 없이 같은 변환을 거친다.

시계열 수는 네 배 넘게 틀렸다. 엔드포인트 40개에 상태 코드 두세 종을 곱해 약 5,500개로 추정했는데 실측은 약 1,200개였다. 존재하는 엔드포인트가 아니라 실제로 호출된 조합만 시계열이 생기기 때문이다. 배포 직후에는 헬스체크와 일부 엔드포인트만 활성이니 당연히 훨씬 적을 수밖에 없었는데 계산할 때는 코드에 있는 매핑을 전부 세고 있었다.

![무료 티어 예산 감시 패널](/images/metrics-to-production/03-dashboard-budget.png)

1,200이라는 숫자도 아직 안정화된 값은 아니다. 각 엔드포인트가 처음 호출될 때마다 시계열이 하나씩 늘어나므로 며칠 뒤 그래프가 평탄해진 다음에야 실제 사용량을 알 수 있다.

## 트래픽과 무관한 시계열 수

무료 티어 한도가 10,000이라 여유가 있지만, 이 값이 대시보드에 없으면 한도에 다가가는 것을 알 수 없다. 그래서 사용량 지표 패널을 서비스 지표와 같은 화면에 뒀다. 체험 기간에는 한도가 걸리지 않아 넘겨도 아무 증상이 없다가 만료 시점에 데이터가 잘리기 시작하는데 그때 원인을 찾기가 까다롭다.

제품 분석 도구의 이벤트 수와 대조해 보니 이 점이 분명해졌다. 광고 캠페인이 있던 날은 평상시의 13배였지만 시계열 수는 거의 같았다. 같은 라벨 조합에 요청이 더 많이 꽂힐 뿐이다. 예산을 위협하는 것은 트래픽 성장이 아니라 엔드포인트 추가다. 엔드포인트 하나가 늘면 상태 코드 종류만큼 조합이 생기고 각 조합에 히스토그램 버킷 수가 곱해진다.

그래서 이 패널은 절대값보다 기울기를 본다. 계단식으로 오르면 배포로 엔드포인트가 늘었다는 뜻이라 예상 가능한 변화지만 완만하게 계속 오르면 고유값이 라벨에 섞여 들어갔다는 신호다. 후자가 훨씬 위험하다.

한도에 근접하면 쓸 수 있는 수단을 순서대로 적어 뒀다. 먼저 HTTP 히스토그램 상한을 10초에서 3초로 낮추고, 그래도 모자라면 HTTP 히스토그램을 끄고 애플리케이션이 계산한 p95를 쓴다. 두 번째가 훨씬 크게 줄지만 시간 구간 재집계를 포기해야 하는데 인스턴스가 하나인 지금은 그 손실이 실질적으로 없다.

## 오류 0과 수집 중단의 구분

대시보드를 붙여 보니 5xx 오류율과 AI 실패율 패널이 `No data`였다. 오류가 한 건도 없기 때문이었지만, 수집이 끊겨도 화면에는 똑같이 `No data`가 나타난다.

원인은 PromQL의 동작이다. 5xx가 하나도 없으면 분자는 0이 아니라 빈 벡터이고, 빈 벡터를 나누면 결과도 비어 버린다.

```promql
# 라벨 없는 집계 — vector(0)으로 대체
100 * (sum(rate(m{status=~"5.."}[5m])) or vector(0))
      / clamp_min(sum(rate(m[5m])), 0.0001)
```

`by`로 묶은 쿼리에는 이 방법이 통하지 않는다. `vector(0)`은 라벨이 없어서 어느 그룹에도 붙지 못하기 때문인데, 대신 전체 비율에 0을 곱해 더하면 그룹마다 0인 시계열이 만들어져 같은 효과를 낸다.

```promql
# by (feature) 집계
100 * sum by (feature) (rate(m{outcome="failure"}[5m]) or 0 * rate(m[5m]))
      / clamp_min(sum by (feature) (rate(m[5m])), 0.0001)
```

분모의 `clamp_min`은 트래픽이 없는 새벽에 0으로 나누는 것을 막는다.

비슷한 함정이 하나 더 있었다. 메트릭 데이터소스와 사용량 데이터소스가 둘 다 Prometheus 타입이라, 데이터소스 변수가 엉뚱한 쪽을 기본값으로 집어 사용량 패널만 비어 있었다. 화면에서 고르고 저장하면 되는 문제이긴 하지만 저장을 잊으면 다시 초기화되므로 변수에 정규식을 걸어 애초에 잘못 고를 수 없게 했다.

```json
{ "name": "datasource",       "regex": "/^(?!.*usage).*$/" }
{ "name": "usage_datasource", "regex": "/usage/" }
```

## 남은 관측 사각지대

대시보드를 다 만든 뒤에도 볼 수 없는 것을 따로 적어 뒀다. 어디가 비어 있는지 알아야 다음 계측 대상을 정할 수 있기 때문이다.

스토리라인 생성은 통째로 비어 있다. 유스케이스 타이머를 스토리 완성에만 붙였고 스토리라인 생성에는 붙이지 않았다. 일부러 뺀 것이 아니라 완성 경로의 결함 두 개를 고치다가 대칭을 맞추지 못했다. AI 호출 시간은 공통 경계에서 재지만, 게스트 사용 한도가 소진돼 402로 거부되는 경우는 어디에도 잡히지 않는다. AI를 부르기 전에 끊겨 Langfuse trace도, 유스케이스 타이머도 남지 않는다. 다음 작업은 결과 분포부터 붙이는 것이다.

인프라 쪽에도 사각지대가 있다. `t3`는 CPU 크레딧이 소진되면 같은 부하에서도 갑자기 느려지는 버스트 인스턴스다. 크레딧 잔량은 Micrometer가 수집하지 않아 CloudWatch를 따로 봐야 한다. 컨테이너가 메모리 부족으로 강제 종료되면 JVM이 아무 값도 남기지 못하고 죽으므로 대시보드에서는 그래프만 끊긴다.

알림도 아직 없다. 이전 글에서 만든 로컬 5xx 알림은 실습이 끝난 뒤 Pause했는데, 서버를 끄면 데이터가 끊기고 No data 처리 설정에 따라 이상 상태로 판단돼 메일이 오기 때문이었다.

운영에서 같은 처리를 할 수는 없다. 서버가 죽었을 때의 No data는 무시할 잡음이 아니라 가장 중요한 신호다. 반대로 모든 규칙을 그렇게 두면 서버가 꺼질 때마다 품질 지표 알림까지 함께 울린다. 서비스 가용성 알림은 No data를 서버 중단으로 보고 발화시키고, p95나 실패율 같은 품질 지표에서는 판단 불가로 처리하기로 했다. 가용성 알림이 그 공백을 실제로 덮는지도 확인해야 한다. 수신을 시작한 지 몇 시간밖에 되지 않아 임계값은 아직 정하지 않았다. 근거 없는 숫자는 오발화만 만든다.

## 정리

로컬에서 동작하던 계측을 운영에 올리는 일은 설정을 그대로 옮기는 작업이 아니었다. 기본값이 이미 켜져 있었고 노출 범위를 다시 정해야 했다. 인프라와 애플리케이션이 서로 다른 경로로 배포된다는 사실도 확인 조건에 넣어야 했다.

가장 크게 고친 부분은 계측을 늘리는 일이 아니라 빼고 나누는 일이었다. AI 없이 응답만 재구성하는 경로를 측정에서 뺐고, 생성 시도 이전의 거부를 실패에서 분리했다. 판별 기준도 상태 코드에서 실제 생성 시작 여부로 바꿨다. 지표가 없으면 모른다는 사실이라도 알지만, 잘못된 지표가 있으면 안다고 착각한다.

라벨 이름, 메트릭 이름, 시계열 수에 대한 추정은 모두 실측과 달랐다. 그중 시계열 수는 네 배 넘게 차이가 났다. 관측을 설계할 때 하는 계산은 대체로 상한이지 실측이 아니었다.

이번에 만난 문제는 대부분 오류를 내지 않고 조용히 빈 상태를 남겼다. 잘못된 OTLP 전송은 로그에만 쌓이고, 계측 코드가 없는 이미지는 아무것도 보내지 않았다. 빈 시크릿은 환경변수 파일을 덮고, 죽은 AI 서버는 실패율 대신 빈 그래프를 남겼다. 지표를 붙인 뒤에는 값이 뜨는지뿐 아니라 수집이 끊겼을 때 제대로 알려 주는지도 확인해야 한다.

다음은 알림이다. 기준선이 쌓이면 임계값과 No data 동작을 함께 설계하고, 그때는 규칙을 Pause하지 않아도 되는 구조로 만들 예정이다.
