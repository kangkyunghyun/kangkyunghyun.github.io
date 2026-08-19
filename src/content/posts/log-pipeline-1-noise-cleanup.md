---
title: "OpenSearch 로그 파이프라인 구축 전 헬스체크 노이즈 92% 제거"
date: 2026-08-20
tags: [백엔드, 모니터링]
---

운영 중인 서비스에 로그 수집 파이프라인을 붙이기로 했다. OpenSearch를 세우고 Fluent Bit으로 로그를 모아 넣는 구성이다. 그런데 첫 삽을 뜨기 전에 확인해야 할 게 하나 있었다. **지금 쌓이고 있는 로그가 쓸 만한가.**

결론부터 쓰면 쓸 만하지 않았다. 개발 서버 로그의 92%가 같은 경고 한 종류였고, 그 경고는 애초에 찍힐 이유가 없는 것이었다. 이 글은 인프라를 세우기 전에 로그 소스부터 고친 기록이다.

## 왜 실측부터 했나

로그 파이프라인을 만들 때 흔히 하는 순서는 이렇다.

1. OpenSearch를 띄운다
2. 수집기를 붙인다
3. 대시보드를 만든다

이 순서의 문제는 **무엇을 담을지 모르는 채로 그릇부터 만든다**는 것이다. 인덱스 크기를 잘못 잡고, 보관 정책을 잘못 걸고, 대시보드는 노이즈에 묻힌다. 그래서 순서를 뒤집어 지금 나오는 로그를 먼저 봤다.

개발 환경은 ECS에 올라가 있고 로그는 CloudWatch Logs로 나간다. 로그 그룹부터 확인했다.

```bash
aws logs describe-log-groups --region ap-northeast-2 \
  --query 'logGroups[].{name:logGroupName,storedBytes:storedBytes,retention:retentionInDays}' \
  --output table
```

```text
-------------------------------------------------
|               DescribeLogGroups               |
+-----------------+-------------+---------------+
|      name       |  retention  |  storedBytes  |
+-----------------+-------------+---------------+
|  /ecs/manyak-dev|  14         |  3359341      |
+-----------------+-------------+---------------+
```

한 태스크에 네 컨테이너가 들어 있었다.

```bash
aws logs describe-log-streams --region ap-northeast-2 \
  --log-group-name /ecs/manyak-dev \
  --order-by LastEventTime --descending --max-items 4 \
  --query 'logStreams[].logStreamName' --output text
```

```text
task/server/620ad91deb8b4ae2abcbec4d76fe6661
task/ai/620ad91deb8b4ae2abcbec4d76fe6661
task/postgres/620ad91deb8b4ae2abcbec4d76fe6661
task/redis/620ad91deb8b4ae2abcbec4d76fe6661
```

> `describe-log-streams`에서 `--log-stream-name-prefix`와 `--order-by LastEventTime`은 함께 쓸 수 없다. 같이 주면 에러가 아니라 **빈 결과**가 돌아와서, 스트림이 없는 줄 알고 한참 헤맸다.

## 서버 로그를 열어보니

Spring Boot 서버 로그는 이미 JSON으로 잘 나오고 있었다. `logback-spring.xml`에 LogstashEncoder를 붙여 둔 덕이다.

```json
{
  "@timestamp": "2026-08-15T17:59:53.217Z",
  "@version": "1",
  "message": "필수 추적 헤더 누락: missing=[X-Manyak-Device-Id, X-Manyak-Session-Id], method=GET, path=/actuator/health",
  "logger_name": "com.knk.manyak.global.observability.RequestCorrelationFilter",
  "thread_name": "http-nio-8080-exec-8",
  "level": "WARN",
  "level_value": 30000,
  "service": "manyak-server"
}
```

그런데 같은 메시지가 계속 반복됐다. 얼마나 되는지 세어 봤다.

```bash
aws logs filter-log-events --region ap-northeast-2 \
  --log-group-name /ecs/manyak-dev \
  --log-stream-names task/server/620ad91d... \
  --start-time $ST --max-items 3000 \
  --query 'events[].message' --output text | tr '\t' '\n' > srv.log

grep -o '"logger_name":"[^"]*"' srv.log | sed 's/.*://' | sort | uniq -c | sort -rn
grep -o '"level":"[^"]*"' srv.log | sed 's/.*://' | sort | uniq -c | sort -rn
```

```text
 524 "com.knk.manyak.global.observability.RequestCorrelationFilter"
  46 "com.knk.manyak.global.observability.StructuredLogger"

 524 "WARN"
  46 "INFO"
```

최근 1시간 표본 570줄 중 **524줄(92%)이 같은 WARN 하나**였다. 대상 경로를 보니 원인이 분명해졌다.

```text
 478 path=/actuator/health
   6 path=/
   1 path=/zend/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php
   1 path=/yii/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php
```

`/actuator/health`. ALB와 ECS가 15초마다 두드리는 헬스체크다.

## 헬스체커는 앱 헤더를 보내지 않는다

이 서비스는 모든 요청에 `X-Manyak-Device-Id`, `X-Manyak-Session-Id`, `X-Manyak-Request-Id` 세 헤더를 실어 보낸다. 서버는 필터에서 이 헤더를 받아 MDC에 넣고, 이후 모든 로그가 같은 `request_id`로 묶이게 한다. 요청 하나를 끝까지 추적하기 위한 장치다.

헤더가 없으면 추적이 끊기니 경고를 남기게 해 뒀다.

```kotlin
private fun warnIfRequiredHeadersMissing(
    request: HttpServletRequest,
    rawSessionId: String?,
    rawDeviceId: String?,
) {
    val missing = buildList {
        if (rawDeviceId == null) add(HEADER_DEVICE_ID)
        if (rawSessionId == null) add(HEADER_SESSION_ID)
    }
    if (missing.isNotEmpty()) {
        log.warn(
            "필수 추적 헤더 누락: missing={}, method={}, path={}",
            missing, request.method, request.requestURI,
        )
    }
}
```

의도 자체는 맞다. **프론트엔드가 실제 API 호출에서 헤더를 빠뜨리는 것**을 잡으려는 경고다.

문제는 대상이다. ALB 헬스체커는 우리 앱의 헤더 규약을 알 리가 없다. 취약점 스캐너도 마찬가지다. 이런 기계 트래픽은 헤더가 없는 게 **정상**이다. 정상 상황에 경고를 찍고 있었고, 그게 로그의 92%를 차지했다.

## 경고 대상을 비즈니스 API로 좁히기

동작 변경이라 테스트를 먼저 썼다. 이 레포는 기능 변경에 TDD를 적용한다.

```kotlin
@Test
fun `비즈니스 API가 아닌 경로(헬스체크·스캐너)는 헤더가 없어도 경고를 남기지 않는다`() {
    val logger = LoggerFactory.getLogger(RequestCorrelationFilter::class.java) as Logger
    val appender = ListAppender<ILoggingEvent>().apply { start() }
    logger.addAppender(appender)
    try {
        for (path in listOf("/actuator/health", "/", "/zend/vendor/phpunit/eval-stdin.php")) {
            val (mdc, _) = runFilter(MockHttpServletRequest("GET", path))
            // 경고만 끄는 것이다 — MDC unknown 적재는 그대로 동작해야 한다.
            assertThat(mdc["session_id"]).isEqualTo("unknown")
        }
    } finally {
        logger.detachAppender(appender)
    }

    assertThat(appender.list).noneMatch { it.level == Level.WARN }
}
```

돌려서 실패를 확인했다. 지금 코드가 문제라는 증명이다.

```text
RequestCorrelationFilterTests > 비즈니스 API가 아닌 경로(헬스체크·스캐너)는 헤더가 없어도 경고를 남기지 않는다() FAILED
    java.lang.AssertionError at RequestCorrelationFilterTests.kt:129
9 tests completed, 1 failed
```

구현은 한 줄이다.

```kotlin
// 이 경고의 목적은 "프론트엔드가 실제 API 호출에서 추적 헤더를 빠뜨림"을 잡는 것이다.
// 비즈니스 API(/api/*) 밖의 경로는 헬스체크(ALB·ECS)·취약점 스캐너 등 기계 트래픽이라
// 헤더가 없는 게 정상이고, 경고를 찍으면 로그의 대부분을 노이즈로 채운다(실측 92%).
// MDC unknown 적재·request_id 발급은 경로와 무관하게 그대로 동작한다.
if (!request.requestURI.startsWith("/api/")) return
```

**경고만 끈다**는 점이 중요하다. `request_id` 발급과 MDC 적재는 경로와 무관하게 그대로 돈다. 헬스체크 요청도 추적 자체는 되어야 하고, 다만 "헤더가 없다"고 떠들 필요가 없을 뿐이다.

기존 테스트가 `/api/v1` 경로에서는 종전대로 경고하는 것을 고정하고 있어서, 이 조건이 너무 넓어지는 것도 함께 막힌다.

## 배포 후 실측

머지하고 개발 환경에 배포된 뒤 같은 방식으로 다시 셌다.

```text
배포 전 (1시간):  570줄 중 524줄(92%)이 헤더누락 WARN
배포 후 (2시간):   79줄 중   2줄(2.8%)
```

전체 로그량이 2시간에 79줄로 줄었다. 남은 WARN 2줄의 대상 경로를 확인했다.

```text
path=/api/v1/auth/login/google
path=/api/v1/auth/me
```

둘 다 진짜 API 요청이다. **헤더를 빠뜨린 실제 호출**이라 경고가 나오는 게 맞다. 의도한 대로 정확히 동작했다.

남은 로그는 이런 것들이다.

```json
{
  "@timestamp": "2026-08-14T04:25:58.158Z",
  "message": "{event_name=api_request_completed, endpoint=/, http_method=GET, status_code=401, duration_ms=11}",
  "logger_name": "com.knk.manyak.global.observability.StructuredLogger",
  "level": "INFO",
  "device_id_hash": "unknown",
  "session_id": "unknown",
  "request_id": "req_2f35cfbee49c481f8dffd6c34c04253b",
  "event_name": "api_request_completed",
  "endpoint": "/",
  "http_method": "GET",
  "status_code": 401,
  "duration_ms": 11,
  "service": "manyak-server"
}
```

`event_name`, `status_code`, `duration_ms`가 개별 필드로 실려 있다. 이 정도면 OpenSearch에 그대로 넣어도 되는 품질이다.

## 남는 생각

**노이즈 92%를 그대로 두고 인덱스를 세웠다면** 저장 용량을 10배로 잡았을 것이고, 보관 기간을 잘못 계산했을 것이고, 대시보드를 열 때마다 헬스체크 경고를 스크롤로 넘겨야 했을 것이다. 알림 임계값도 헛짚었을 테고.

고친 코드는 여섯 줄이다. 조건 한 줄과 주석 다섯 줄. 그런데 이 한 줄을 파이프라인 **뒤에** 넣었다면 이미 쌓인 쓰레기는 그대로 남는다.

로그 파이프라인을 만들기 전에 한 번 세어 보는 것을 권한다. 로거 이름별로 몇 건인지 세는 데는 `grep`과 `sort | uniq -c`면 충분하다.

다음 글에서는 이 로그를 담을 OpenSearch 인덱스 템플릿을 만든다. `status_code`를 문자열로 잡으면 왜 곤란해지는지, `keyword`와 `text`를 나누는 기준이 무엇인지 실제 쿼리로 확인한다.
