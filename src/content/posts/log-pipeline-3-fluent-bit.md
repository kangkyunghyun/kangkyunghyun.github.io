---
title: "Fluent Bit으로 ECS FireLens와 같은 경로의 컨테이너 로그 수집"
date: "2026-08-19T03:00:00Z"
tags: [백엔드, 모니터링]
---

[앞 글](/posts/log-pipeline-2-index-template)까지 OpenSearch와 인덱스 템플릿을 만들었다. 그런데 로그는 아직 손으로 넣고 있다. 개발 환경에서 받아 `curl`로 밀어 넣는 식이다.

이 글은 그 손을 없애는 과정이다. Fluent Bit을 붙이되 **운영에서 쓸 모양 그대로** 만드는 게 목표다.

## Fluent Bit은 세 부분이다

이것만 알면 나머지는 조립이다.

```text
INPUT  →  FILTER  →  OUTPUT
어디서       어떻게       어디로
가져올까     가공할까     보낼까
```

한 번에 셋을 다 맞추려다 어디서 틀렸는지 못 찾는 게 흔한 실패다. 그래서 **가장 단순한 것부터** 갔다. 가짜 로그를 만들어내는 `dummy` 입력으로 파이프라인을 먼저 검증한다.

```ini
[SERVICE]
    Flush        1
    Log_Level    info
    Grace        5

[INPUT]
    Name     dummy
    Tag      test.dummy
    Dummy    {"@timestamp":"2026-01-01T00:00:00.000Z","level":"INFO","service":"fluent-bit-test","message":"파이프라인 확인용 가짜 로그","status_code":200,"duration_ms":7}
    Rate     1

[OUTPUT]
    Name             opensearch
    Match            *
    Host             opensearch
    Port             9200
    tls              Off
    Index            manyak-logs-local-test
    Suppress_Type_Name On
```

몇 가지 주의점이 있다.

- **`Host opensearch`**. `localhost`가 아니다. 컨테이너 안에서 `localhost`는 자기 자신을 가리킨다. Docker 네트워크 안에서는 서비스 이름이 곧 호스트 이름이다.
- **`Suppress_Type_Name On`**. OpenSearch는 문서 타입(`_type`)을 쓰지 않는다. 켜 두지 않으면 bulk 요청에 `_type`이 실려 색인이 거절된다.
- **`Rate 1`**. 기본값(무제한)으로 두면 순식간에 수만 건이 쌓인다. 실제로 잠깐 놔뒀더니 1만 건이 넘었다.

띄우고 확인했다.

```bash
docker compose -f docker-compose.observability.yml up -d fluent-bit
curl -s "http://localhost:9200/_cat/indices/manyak-logs-*?v&h=index,docs.count"
```

```text
index                        docs.count
manyak-logs-local-test               16
```

파이프라인이 연결됐다. 그리고 이 인덱스에도 앞 글에서 만든 템플릿이 적용됐는지 확인했다.

```text
  duration_ms    long
  status_code    integer
  message        text
  ...
```

`manyak-logs-*` 패턴에 맞는 이름을 썼기 때문이다. 인덱스 이름이 템플릿 적용 여부를 가른다.

## 로컬 앱을 어떻게 태울 것인가

이제 `dummy` 자리에 진짜 앱 로그를 넣어야 한다. 여기서 걸림돌이 둘이었다.

**1. 앱이 컨테이너가 아니다.** 평소 개발은 `docker compose up -d`(postgres, redis) + `./gradlew bootRun`이다. Fluent Bit의 본업은 컨테이너 로그 수집인데 수집할 컨테이너가 없다.

**2. 로컬 로그가 JSON이 아니다.** `logback-spring.xml`을 보면 JSON은 `prod`, `dev` 프로파일에만 붙고 `local`은 사람이 읽는 평문 패턴이다.

2번부터 풀었다. `jsonlog`라는 프로파일을 하나 더해 평소엔 지금처럼 평문이고 필요할 때만 JSON이 되게 했다.

```xml
<springProfile name="prod,dev,jsonlog">
    <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <customFields>{"service":"manyak-server"}</customFields>
        </encoder>
    </appender>
    <root level="INFO"><appender-ref ref="JSON"/></root>
</springProfile>

<springProfile name="!prod &amp; !dev &amp; !jsonlog">
    <include resource="org/springframework/boot/logging/logback/console-appender.xml"/>
    <root level="INFO"><appender-ref ref="CONSOLE"/></root>
</springProfile>
```

**두 조건이 서로 배타적이어야 한다.** 한쪽만 고치면 두 appender가 동시에 붙어 같은 로그가 두 줄씩 찍힌다. 프로파일을 추가할 때는 위 목록과 아래 부정 조건을 함께 고쳐야 한다.

확인해 봤다.

```bash
set -a; source .env; set +a; SPRING_PROFILES_ACTIVE=local,jsonlog ./gradlew bootRun
```

> `set -a`는 이후 만드는 변수를 자동으로 export하고 `source .env`는 그 파일 내용을 현재 셸에서 실행한다. `docker compose`는 `.env`를 자동으로 읽지만 **Gradle은 읽지 않아서** 이렇게 넣어 줘야 한다.

```json
{"@timestamp":"2026-08-19T21:48:38.662891+09:00","@version":"1","message":"The following 2 profiles are active: \"local\", \"jsonlog\"","logger_name":"com.knk.manyak.ManyakApplicationKt","thread_name":"restartedMain","level":"INFO","level_value":20000,"service":"manyak-server"}
```

중복 여부는 세어서 확인했다.

```text
JSON 줄: 50      평문 줄: 0
고유 메시지 49종 / 전체 50줄
```

두 appender가 동시에 붙었다면 모든 줄이 2배가 되어 25종/50줄이 됐을 것이다. 49종/50줄이니 배타 조건이 맞게 걸렸다. (2번 나온 하나는 Spring이 원래 두 번 찍는 메시지다.)

## 운영과 같은 경로 만들기

1번은 앱을 컨테이너로 띄워서 풀었다. 여기서 **어떻게 띄우느냐**가 중요하다.

운영은 ECS Fargate이고 로그는 FireLens로 나간다. FireLens의 실체는 Fluent Bit이고 경로는 이렇다.

```text
앱 컨테이너 stdout → 도커 로그 드라이버 → Fluent Bit 사이드카
```

로컬에서 이걸 그대로 흉내 내려면 도커의 `fluentd` 로그 드라이버를 쓰면 된다. 파일을 `tail`하는 방식보다 운영에 훨씬 가깝다.

```yaml
  app:
    profiles: ["app"]
    image: eclipse-temurin:21-jre-alpine
    container_name: manyak-app
    volumes:
      - ./build/libs/app.jar:/app/app.jar:ro
    command: ["java", "-jar", "/app/app.jar"]
    environment:
      SPRING_PROFILES_ACTIVE: "local,jsonlog"
      MANYAK_DB_URL: "jdbc:postgresql://host.docker.internal:${MANYAK_DB_PORT:-5432}/${MANYAK_DB_NAME:-manyak}"
      SPRING_DATA_REDIS_HOST: "host.docker.internal"
    env_file:
      - .env
    ports:
      - "18080:8080"
    logging:
      driver: fluentd
      options:
        fluentd-address: "localhost:24224"
        fluentd-async: "true"
```

설계상 정한 것들.

**`profiles: ["app"]`**. 평소 `up -d`에는 뜨지 않는다. 일상 개발과 테스트는 종전대로 `bootRun`을 쓰고 파이프라인을 확인할 때만 `--profile app`으로 켠다.

**이미지를 빌드하지 않는다**. 루트 Dockerfile은 컨테이너 안에서 Gradle 빌드를 다시 돌려 느리다. 로컬에서 만든 jar를 그대로 얹으면 `./gradlew bootJar`가 1초이고 컨테이너 기동은 수 초다.

**`fluentd-address: localhost:24224`**. 컨테이너 이름이 아니라 호스트 주소다. 로그 드라이버는 **컨테이너가 아니라 도커 데몬**이 실행하기 때문이다. 그래서 Fluent Bit 쪽에서 24224 포트를 호스트로 게시해야 한다.

**`fluentd-async: true`**. Fluent Bit이 아직 안 떠 있어도 컨테이너가 기동하게 한다. 기본값(false)이면 접속 실패 시 컨테이너가 아예 시작하지 못한다.

Fluent Bit의 입력도 바꿨다.

```ini
[INPUT]
    Name    forward
    Listen  0.0.0.0
    Port    24224
```

## 도커가 감싼 것을 풀기

띄우고 나서 첫 시도는 실패했다.

```text
manyak-app	Exited (1) 54 seconds ago
```

로그를 보니 원인이 나왔다.

```text
java.lang.IllegalArgumentException: Empty key
  at com.knk.manyak.auth.jwt.JwtTokenProvider.<init>(JwtTokenProvider.kt:39)
```

`.env`에 `MANYAK_AUTH_JWT_SECRET=`가 **빈 값으로** 있었다. 환경변수는 yml보다 우선하므로 `application-local.yml`의 로컬용 기본값을 빈 값이 덮어 버린 것이다. `bootRun`은 `.env`를 안 읽어서 이 문제가 드러나지 않았다.

Compose에서 막았다. `:-`는 값이 없거나 **비어 있을 때** 기본값을 쓴다.

```yaml
MANYAK_AUTH_JWT_SECRET: "${MANYAK_AUTH_JWT_SECRET:-local-dev-only-jwt-secret-change-me-please-32b}"
```

이번엔 떴다. 그리고 로그가 들어왔다.

```text
index                        docs.count
manyak-logs-local-2026.08.19        146
```

그런데 문서를 열어 보니 그대로는 쓸 수 없었다. 도커 로그 드라이버는 우리 JSON을 **문자열로 감싸서** 보낸다.

```json
{
  "log": "{\"@timestamp\":\"2026-08-19T15:36:35Z\",\"level\":\"INFO\",...}",
  "container_name": "/manyak-app",
  "source": "stdout",
  "container_id": "ef4849518e89..."
}
```

이대로 색인하면 필드가 `log` 하나뿐이라 `level`이나 `status_code`로 검색할 수 없다. 그래서 `parser` 필터로 풀었다.

```ini
[FILTER]
    Name         parser
    Match        *
    Key_Name     log
    Parser       manyak_json
    Reserve_Data On
```

파서는 따로 정의한다.

```ini
[PARSER]
    Name        manyak_json
    Format      json
    Time_Key    @timestamp
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z
    Time_Keep   On
```

**`Reserve_Data On`이 중요하다.** `Off`면 파싱 결과만 남고 `container_name` 같은 도커 메타데이터가 사라진다. 어느 컨테이너 로그인지 알 수 없게 된다.

**`Time_Keep On`도 그렇다.** 파싱에 쓴 `@timestamp` 필드를 레코드에 남긴다. 앞 글에서 만든 인덱스 템플릿이 `@timestamp`를 `date`로 매핑해 두었으므로 실제 시간 해석은 OpenSearch가 한다. 즉 여기 `Time_Format`이 어긋나도 필드만 남으면 색인은 정상이다. 이중 안전장치다.

결과는 이렇다.

```json
{
  "@timestamp": "2026-08-19T15:36:35.445328449Z",
  "message": "HHH000489: No JTA platform available ...",
  "logger_name": "org.hibernate.orm.core",
  "level": "INFO",
  "level_value": 20000,
  "service": "manyak-server",
  "container_name": "/manyak-app",
  "source": "stdout",
  "container_id": "ef4849518e894dc1..."
}
```

`log` 문자열이 필드로 펼쳐졌고 도커 메타데이터도 남았다.

## 이 파이프라인을 만드는 이유

여기까지 왔으면 확인할 게 하나 있다. **요청 하나를 추적할 수 있는가.**

추적 헤더를 붙여 API를 호출했다.

```bash
curl -s -o /dev/null \
  -H 'X-Manyak-Device-Id: local-demo-device' \
  -H 'X-Manyak-Session-Id: local-demo-session' \
  -H 'X-Manyak-Request-Id: req_demo_0001' \
  http://localhost:18080/api/v1/stories/simple/tags
```

그리고 그 `request_id`로 찾았다.

```bash
curl -s "http://localhost:9200/manyak-logs-local-*/_search?q=request_id:req_demo_0001&pretty"
```

```json
{
  "request_id":     "req_demo_0001",
  "session_id":     "local-demo-session",
  "device_id_hash": "device_hash_5d612fb6b0477573",
  "event_name":     "api_request_completed",
  "endpoint":       "/api/v1/stories/simple/tags",
  "http_method":    "GET",
  "status_code":    200,
  "duration_ms":    328,
  "container_name": "/manyak-app"
}
```

보낸 헤더가 그대로 필드로 남았다. `device_id_hash`를 보면 원본(`local-demo-device`)이 아니라 해시가 저장돼 있다. 식별자 원본이 로그에 남지 않게 필터가 해싱한 결과다.

**이게 운영에서 오류를 쫓을 때 쓸 능력이다.** 사용자가 겪은 요청의 `request_id` 하나로 관련 로그를 전부 모을 수 있다.

## Fluent Bit이 정말 경로에 있나

"로그가 쌓였다"만으로는 누가 넣었는지 알 수 없다. 근거를 넷 확인했다.

**1. 앱은 OpenSearch의 존재를 모른다.** 소스와 설정 어디에도 9200이나 opensearch가 없다. 환경변수에도 없다. 앱은 stdout에 글자를 뱉을 뿐이다.

**2. 앱이 쓰지 않은 필드가 붙어 있다.** `container_name`, `container_id`, `source`. 앱은 자기가 컨테이너인지도 모른다. 도커 로그 드라이버가 붙인 지문이다.

**3. 인덱스 이름을 앱이 정할 수 없다.** `manyak-logs-local-2026.08.19`라는 날짜 붙은 이름은 Fluent Bit의 `Logstash_Format` 설정이 만든 것이다.

**4. 끊어 보면 된다.** 이게 결정적이다.

```bash
docker stop manyak-fluent-bit
curl -s -o /dev/null -H 'X-Manyak-Request-Id: req_nofb' localhost:18080/api/v1/stories/simple/tags
sleep 3
curl -s "localhost:9200/manyak-logs-local-*/_count?q=request_id:req_nofb"
```

```text
{"count":0,...}
```

앱은 200을 잘 응답했는데 로그가 안 들어왔다. 그 사이에 있는 게 Fluent Bit 말고 없다는 뜻이다.

## 그런데 그 로그는 어디로 갔나

여기서 예상 못 한 걸 발견했다. Fluent Bit을 다시 켜고 확인해 봤다.

```bash
docker start manyak-fluent-bit
sleep 8
curl -s "localhost:9200/manyak-logs-local-*/_count?q=request_id:req_nofb"
```

```text
{"count":0,...}
```

**여전히 0이다. 그 로그는 유실됐다.**

이유는 `fluentd-async: true`에 있다. 이게 없으면 Fluent Bit이 죽어 있을 때 컨테이너가 시작조차 못 한다. 켜면 시작은 되지만 대신 도커가 메모리에 잠깐 들고 있다가 **한도를 넘으면 버린다.** 디스크에 쌓아 두지 않는다.

| | Fluent Bit이 죽으면 |
|---|---|
| `fluentd-async: false` | 앱 컨테이너가 **시작 실패** |
| `fluentd-async: true` | 앱은 살지만 **로그 유실** |

둘 다 좋지 않다. 그리고 이 문제는 로컬에만 있는 게 아니다. 운영의 Fargate FireLens도 디스크 버퍼가 사실상 없어 같은 위험을 안는다.

## 남는 생각

파싱에 실패한 줄도 확인해 봤다. Spring 배너 같은 비 JSON 줄이다.

```json
{"log": "  .   ____          _            __ _ _", "container_name": "/manyak-app", ...}
```

기동당 20줄 남짓이고 **버려지지 않고 `log` 필드를 단 채 통과한다.** 파서가 까다롭게 굴다 로그를 잃는 것보다 낫다. 관측 시스템에서 유실은 최악이다.

그런데 방금 본 것처럼 정작 유실은 다른 데서 났다. 파서가 아니라 **전송 계층**에서.

다음 글에서는 그 구멍을 메운다. Fluent Bit과 OpenSearch 사이에 Vector를 한 겹 더 두고 같은 실험을 다시 해 본다.
