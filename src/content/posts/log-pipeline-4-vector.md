---
title: "로그 유실을 막는 Vector 디스크 버퍼와 forward 호환성 함정"
date: "2026-08-20T01:00:00Z"
tags: [백엔드, 모니터링]
---

[앞 글](/posts/log-pipeline-3-fluent-bit)에서 Fluent Bit으로 컨테이너 로그를 OpenSearch에 넣었다. 동작은 하는데 마지막에 문제를 하나 발견했다. **Fluent Bit이 잠깐 죽어 있는 동안 발생한 로그가 사라졌다.**

이 글은 그 구멍을 메우는 과정이다. Fluent Bit과 OpenSearch 사이에 Vector를 한 겹 더 두고 같은 실험을 다시 해 본다. 가는 길에 문서에 안 적힌 호환성 문제도 하나 밟았다.

## 왜 계층을 나누나

Fluent Bit만으로도 OpenSearch에 넣을 수 있다. 그럼 왜 하나를 더 두나.

두 도구의 성격이 다르다.

| | Fluent Bit | Vector |
|---|---|---|
| 언어 | C | Rust |
| 자리 | **에이전트**. 앱 옆에 붙는다 | **집계**. 중앙에 하나 |
| 개수 | 서버나 태스크마다 하나씩 (많음) | 하나 또는 소수 |
| 최적화 | 극단적으로 가벼움 | 변환 능력 + 디스크 버퍼 |

나누는 이유는 셋이다.

1. **에이전트는 가벼워야 한다.** 앱과 자원을 나눠 쓴다. 서버 300대면 Fluent Bit도 300개다. 여기에 무거운 가공을 시키면 앱 성능을 갉아먹는다.
2. **가공 규칙을 한 곳에서 바꾼다.** 파싱 규칙 하나 고치려고 에이전트 300개를 재배포하는 대신 중앙 설정만 고친다.
3. **버퍼가 중앙에 있다.** 목적지가 죽어도 로그를 잃지 않는다. ← 이번 글의 본론

## 앞 글에서 무엇이 사라졌나

복기부터. Fluent Bit을 멈추고 요청을 보낸 뒤 다시 켜고 확인했다.

```bash
docker stop manyak-fluent-bit
curl -s -o /dev/null -H 'X-Manyak-Request-Id: req_nofb' localhost:18080/api/v1/stories/simple/tags
docker start manyak-fluent-bit
sleep 8
curl -s "localhost:9200/manyak-logs-local-*/_count?q=request_id:req_nofb"
```

```text
{"count":0,...}
```

도커의 `fluentd` 로그 드라이버는 `fluentd-async: true`일 때 메모리에 잠깐 들고 있다가 한도를 넘으면 버린다. 디스크에 쌓지 않는다. 그리고 이건 로컬만의 문제가 아니다. **운영의 Fargate FireLens도 디스크 버퍼가 사실상 없다.**

## Vector 붙이기

구성을 이렇게 바꾼다.

```text
before:  앱 → 도커 → Fluent Bit ────────────→ OpenSearch
after:   앱 → 도커 → Fluent Bit → Vector → OpenSearch
                                   ↑ 디스크 버퍼
```

Vector 설정이다.

```yaml
data_dir: /var/lib/vector

sources:
  fluentbit:
    type: fluent
    address: 0.0.0.0:24225

transforms:
  refine:
    type: remap
    inputs: [fluentbit]
    source: |
      .pipeline = "vector"
      if exists(.container_name) {
        .container_name = replace(to_string!(.container_name), r'^/', "")
      }

sinks:
  opensearch:
    type: elasticsearch
    inputs: [refine]
    endpoints: ["http://opensearch:9200"]
    api_version: v7
    mode: bulk
    bulk:
      index: "manyak-logs-local-%Y.%m.%d"
    buffer:
      type: disk
      max_size: 268435488
      when_full: block
```

몇 가지 짚을 것.

**`.pipeline = "vector"`**. 이 레코드가 Vector를 지났다는 표시다. 앞 글에서 "Fluent Bit이 정말 경로에 있나"를 증명할 때 쓴 것과 같은 수법으로 나중에 이 필드의 유무만 보면 경로를 확인할 수 있다.

**`api_version: v7`**. OpenSearch는 Elasticsearch 7.10에서 갈라져 나왔다. `auto`로 두면 3.8.0이라는 버전 문자열을 ES 8로 오인해 요청 형식이 어긋날 수 있다.

**`buffer.type: disk`**. 이 파일의 핵심이다. `max_size`는 최소 허용치가 256MiB라 그보다 작게 주면 기동에 실패한다. `when_full: block`은 버퍼가 가득 차면 뒤로 밀어낸다는 뜻이다. `drop_newest`로 두면 조용히 버린다.

Fluent Bit의 출력도 OpenSearch에서 Vector로 돌렸다.

```ini
[OUTPUT]
    Name  forward
    Match *
    Host  vector
    Port  24225
```

## 여기서 30분을 헤맸다

띄우고 요청을 보냈는데 로그가 안 들어왔다. 설정을 꺼내 확인해 봤다.

```bash
docker cp manyak-fluent-bit:/fluent-bit/etc/fluent-bit.conf /tmp/fb.conf
grep -A5 '^\[OUTPUT\]' /tmp/fb.conf
```

```ini
[OUTPUT]
    Name  forward
    Match *
    Host  vector
    Port  24225
```

설정은 맞다. 그런데 Vector를 **멈추고** 요청을 보내도 로그가 들어왔다.

```text
색인 문서 수: 233 → 235
{"count":1,...}
```

Vector가 죽어 있는데 로그가 도착한다? 설정에는 출력이 하나뿐인데?

원인은 이거였다. **Fluent Bit은 설정을 기동할 때 한 번만 읽는다.** 바인드 마운트한 파일을 고쳐도 재시작 전엔 옛 설정으로 돈다. 그리고 `docker cp`로 꺼낸 파일은 **현재 호스트 파일**이라 실제로 적용된 설정과 다를 수 있다. 확인 방법이 오히려 오답을 확신하게 만들었다.

판별법은 기동 로그에 있었다. 재시작 후에야 이 줄이 나타났다.

```text
[output:forward:forward.0] worker #0 started
```

옛 설정으로 돌 때는 이 줄이 없었다. Fluent Bit은 출력 플러그인을 초기화할 때 이 줄을 남긴다.

> 곁가지로 하나 더. fluent-bit 이미지에는 `cat`이 없다. `docker exec ... cat`이 실패하는데 출력이 비어 보여서 "설정이 없다"고 오독하기 쉽다. `docker cp`를 써야 한다.

## forward로는 안 된다

재시작하고 다시 보냈다. 이번엔 Vector 로그에 에러가 찍혔다.

```text
ERROR source{component_id=fluentbit component_type=fluent}:
  Error decoding fluent message.
  error=UnexpectedValue(Array([String("ef4849518e89"), Array([
    Array([Array([Ext(0, [...]), Map([])]),
    Map([("@timestamp", "2026-08-19T16:51:03.371575119Z"),
         ("message", "HikariPool-1 - Shutdown initiated..."),
         ("level", "INFO"), ...])])])]))
  error_type="parser_failed" stage="processing"
```

**데이터는 도착했다.** 에러 덤프 안에 우리 로그가 그대로 보인다. 형식 해석에서 막힌 것이다.

구조를 보면 각 항목이 `[[시각, 메타데이터], 레코드]`다. Fluent Bit 5.x가 쓰는 **v2 이벤트 형식**인데 Vector의 `fluent` 소스가 이걸 해석하지 못한다.

이 고장이 특히 나쁜 이유는 **조용하기 때문**이다. Fluent Bit 쪽은 전송에 성공했다고 보고하고(HTTP 200), OpenSearch는 아무 일도 없고, 로그만 사라진다. Vector 로그를 열어 보기 전엔 어디서 없어졌는지 알 수 없다.

멘토링에서 들었던 이야기가 여기서 맞아떨어졌다.

> 플루언트 빗이 파일을 읽어가지고 그걸 **HTTP로 해서** 벡터 그쪽으로 보냈거든요

회사에서 `forward`가 아니라 HTTP를 쓰는 이유가 이것이었다. 임의의 선택이 아니라 이 호환성 문제를 피하는 것이다.

HTTP + NDJSON으로 바꿨다.

```ini
[OUTPUT]
    Name   http
    Match  *
    Host   vector
    Port   24225
    URI    /
    Format json_lines
    Json_date_key false
```

```yaml
sources:
  fluentbit:
    type: http_server
    address: 0.0.0.0:24225
    encoding: ndjson
```

`Json_date_key false`는 Fluent Bit이 자기 시각 필드를 덧붙이지 않게 끄는 것이다. 우리 레코드에는 이미 `@timestamp`가 있고 그게 정본이다.

이번엔 됐다.

```json
{
  "@timestamp": "2026-08-19T16:56:39.898494535Z",
  "container_name": "manyak-app",
  "pipeline": "vector",
  "request_id": "req_v4",
  "status_code": 200,
  "duration_ms": 300,
  ...
}
```

`pipeline: "vector"`가 붙었고 `container_name`의 앞 슬래시가 떨어졌다(`/manyak-app` → `manyak-app`). 두 변환 다 적용됐다.

## Vector가 남긴 찌꺼기 걷어내기

그런데 자기 흔적도 같이 남겼다.

```json
"path": "/",
"source_type": "http_server",
"timestamp": "2026-08-19T16:56:40.847560426Z"
```

셋 다 쓸모없다. `path`는 Fluent Bit이 POST한 HTTP 경로라 항상 같고, `source_type`은 Vector 내부 메타데이터고, `timestamp`는 `@timestamp`와 헷갈리기만 한다. 남겨 두면 인덱스 매핑만 불어난다.

VRL로 걷어냈다. 가공 계층을 두는 이유가 이런 정리다.

```yaml
      del(.timestamp)
      del(.path)
      del(.source_type)
```

```json
{
  "@timestamp": "2026-08-19T17:05:44.254289256Z",
  "container_name": "manyak-app",
  "pipeline": "vector",
  "request_id": "req_v5",
  "event_name": "api_request_completed",
  "endpoint": "/api/v1/stories/simple/tags",
  "status_code": 200,
  "duration_ms": 34,
  "service": "manyak-server"
}
```

깨끗해졌다.

## 디스크 버퍼가 정말 막아 주나

이제 본론이다. 앞 글에서 Fluent Bit이 죽었을 때 로그가 사라졌다. 이번엔 **OpenSearch를 죽여** 본다.

```bash
docker stop manyak-opensearch
curl -s -o /dev/null -H 'X-Manyak-Request-Id: req_buffered' localhost:18080/api/v1/stories/simple/tags
```

목적지가 죽은 상태에서 로그가 발생했다. 되살린다.

```bash
docker start manyak-opensearch
sleep 45
curl -s "localhost:9200/manyak-logs-local-*/_count?q=request_id:req_buffered"
```

```text
{"count":1,...}
```

**밀린 로그가 들어왔다.** Vector의 디스크 버퍼가 목적지가 죽은 동안 받아 뒀다가 살아나자 밀어 넣었다.

같은 실험을 두 번 했는데 결과가 정반대다.

| 구성 | 실험 | 결과 |
|---|---|---|
| Fluent Bit → OpenSearch | Fluent Bit 중단 | **유실** (`count: 0`) |
| Fluent Bit → **Vector** → OpenSearch | OpenSearch 중단 | **보존** (`count: 1`) |

문서로 읽으면 "버퍼가 있으면 좋다" 정도인데 직접 두 번 재현해 보니 왜 계층을 하나 더 두는지 명확해졌다.

## 파이프라인은 실시간이 아니다

마지막으로 Dashboards에서 확인하다 한 번 더 헷갈렸다. 요청을 보내고 바로 검색했더니 아무것도 안 나왔다.

![request_id로 검색했으나 결과가 없는 Discover 화면](/images/log-pipeline-4-vector/01-no-results.webp)

로그가 안 오는 줄 알고 컨테이너 상태부터 뒤졌는데 잠시 뒤 다시 보니 있었다.

![잠시 후 새로고침하자 조회된 로그](/images/log-pipeline-4-vector/02-request-id-found.webp)

지연이 층층이 쌓인다.

```text
Fluent Bit  Flush 1s
Vector      배치 전송
OpenSearch  refresh_interval 5s
```

6초만 기다리고 "안 온다"고 판단한 게 성급했다. 로그 파이프라인을 확인할 때는 **십수 초는 기다려야 한다**는 걸 감으로 잡아 두는 게 좋다.

조회된 문서에는 지금까지 만든 게 다 들어 있다.

```text
request_id:     req_dashboard
pipeline:       vector
container_name: manyak-app
status_code:    200   duration_ms: 48
event_name:     api_request_completed
```

## Vector와 Data Prepper

OpenSearch 진영에는 Data Prepper라는 도구가 있다. Vector와 **같은 자리**를 놓고 겨루므로 둘 중 하나만 쓴다.

| | Vector | Data Prepper |
|---|---|---|
| 만든 곳 | Datadog(Timber.io 인수) | OpenSearch 프로젝트 |
| 언어 | Rust | Java |
| 로그 | 가볍고 VRL로 변환이 자유롭다 | 되지만 무겁다 |
| 트레이스 | **서비스 맵을 만들 수 없다** | `service_map_stateful` 전용 프로세서 |
| 목적지 | OpenSearch, S3, Kafka, CloudWatch 등 다수 | OpenSearch 중심 |

**로그만 놓고 보면 Vector가 낫다.** 메모리를 적게 쓰고, VRL이 Data Prepper의 프로세서 조합보다 표현력이 좋고, 디스크 버퍼가 제대로 동작한다.

**트레이스는 얘기가 다르다.** OpenSearch Dashboards의 Trace Analytics는 `otel-v1-apm-span-*`과 `otel-v1-apm-service-map` 인덱스를 읽는데 뒤쪽을 만드는 `service_map_stateful` 프로세서가 Data Prepper에만 있다. Vector에는 대응물이 없다.

그래서 트레이스를 붙일 때는 **로그는 Vector, 트레이스는 Data Prepper**로 두 경로를 따로 두게 된다. 둘 중 하나를 고르는 문제가 아니다.

## 정리

네 편에 걸쳐 만든 것을 되짚으면 이렇다.

```text
앱 stdout → 도커 fluentd 드라이버 → Fluent Bit → Vector → OpenSearch → Dashboards
                                    (수집)     (가공, 버퍼)   (저장)      (조회)
```

앞쪽 절반이 운영(ECS FireLens)과 같은 모양이라 로컬에서 검증한 파싱과 전송 설정이 그대로 넘어간다. 그게 로컬 스택을 운영과 같은 경로로 만든 이유다.

실측에서 얻은 것 중 인상적이었던 것들.

- **로그의 92%가 노이즈였다.** 파이프라인을 먼저 만들었으면 그대로 색인했을 것이다.
- **`text` 필드는 서버 집계가 안 된다.** Discover 사이드바에서는 되는 것처럼 보여서 오해하기 쉽다.
- **싱크가 죽으면 로그가 사라진다.** 디스크 버퍼가 있는 계층이 필요한 이유를 두 실험으로 확인했다.
- **Fluent Bit → Vector는 HTTP로 연결해야 한다.** `forward`는 조용히 버려진다.
- **Fluent Bit은 설정을 기동 시 한 번만 읽는다.** 파일을 고쳐도 재시작 전엔 반영되지 않는다.

문서만 읽고 넘어갔으면 마지막 셋은 운영에 올린 뒤에 알았을 것이다. 로컬에 같은 모양으로 세워 보는 값이 거기에 있다고 생각한다.
