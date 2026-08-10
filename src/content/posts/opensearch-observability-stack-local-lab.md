---
title: "OpenSearch Observability Stack 로컬 실습 — 트레이스부터 알림까지"
date: 2026-08-10
tags: [백엔드, 모니터링]
---

이번 실습의 목표는 단순히 컨테이너를 실행하는 데 있지 않았다. AI 에이전트 예제에 요청을 발생시키고, 그 요청이 OpenTelemetry Collector와 Data Prepper를 거쳐 OpenSearch에 저장되는지 확인한 다음, OpenSearch Dashboards에서 트레이스 병목과 부분 실패를 읽고, 마지막에는 Prometheus 호환 규칙이 `pending → active → resolved`로 변하는 과정까지 직접 따라가 보았다.

처음에는 거의 모든 명령을 그대로 입력하면서 진행했기 때문에 각 확인 작업이 왜 필요한지 잘 연결되지 않았다. 이 글은 그 과정을 실행 순서대로 다시 풀어 쓴 기록이다. 모든 스크린샷은 브라우저 탭 제목과 북마크 영역만 모자이크 처리했고, 로컬 URL과 OpenSearch 화면은 실습 맥락을 위해 그대로 남겼다.

## 전체 데이터 흐름부터 잡기

이번 구성에서 가장 먼저 이해해야 할 점은 트레이스·로그와 메트릭이 서로 다른 저장 경로를 사용한다는 것이다.

```text
예제 에이전트 / Canary
        │ OTLP
        ▼
OpenTelemetry Collector :4317, :4318
        │
        ├─ traces, logs ──▶ Data Prepper :21890 ──▶ OpenSearch :9200
        │                                              │
        │                                              ▼
        │                                  OpenSearch Dashboards :5601
        │
        └─ metrics ──────▶ Cortex(Prometheus 호환 API) :9090
                                │
                                ├─ recording / alert rules
                                ▼
                           Alertmanager :9093
```

OpenTelemetry Collector는 애플리케이션이 보낸 텔레메트리의 진입점이다. 트레이스와 로그는 Data Prepper가 OpenSearch 문서 형태로 가공해 저장한다. 반면 메트릭은 이 Compose 구성에서 서비스 이름이 `prometheus`인 Cortex로 전송된다. 따라서 트레이스가 보이지 않을 때와 메트릭이 보이지 않을 때 살펴봐야 할 구성 요소가 다르다.

실습 당시 주요 버전은 OpenSearch와 OpenSearch Dashboards 3.8.0, OpenTelemetry Collector Contrib 0.156.0, Data Prepper 2.16.0 SNAPSHOT 계열이었다. 버전에 따라 메트릭 이름이나 UI 위치가 달라질 수 있으므로, 아래 화면과 다른 결과가 나오면 먼저 이미지 버전을 비교하는 편이 좋다.

## Data Prepper의 `Request execution cancelled` 추적하기

처음 Data Prepper를 실행했을 때 OpenSearch sink 초기화가 약 200ms 간격으로 계속 실패했다.

```text
Failed to initialize OpenSearch sink with a retryable exception.
java.lang.RuntimeException: Request execution cancelled
Caused by: java.util.concurrent.CancellationException: Request execution cancelled
```

스택 트레이스는 `OpenSearchClusterClient.getSettings`, `AbstractIndexManager.checkISMEnabled`를 지나고 있었다. 즉 Data Prepper가 OpenSearch에 연결해 인덱스 설정과 ISM 사용 여부를 확인하는 초기화 단계에서 HTTP 클라이언트 요청이 취소된 것이다. 이 메시지만 보고 비밀번호나 네트워크를 바로 의심할 수 있지만, 먼저 계층별로 가능성을 제거했다.

OpenSearch와 Data Prepper의 상태부터 확인했다.

```bash
docker compose ps -a opensearch data-prepper
```

OpenSearch는 `healthy`, Data Prepper는 `Up`이었다. 다만 컨테이너가 실행 중이라는 사실은 애플리케이션 내부 sink 초기화가 끝났다는 뜻이 아니다. 이어서 Data Prepper 컨테이너가 Compose DNS로 `opensearch`를 찾을 수 있는지 확인했다.

```bash
docker compose exec data-prepper getent hosts opensearch
```

IP가 정상적으로 반환됐다. 그다음 같은 컨테이너 안에서 OpenSearch HTTPS API를 직접 호출했다. 실제 비밀번호는 글에 남기지 않고 환경 변수로 표기한다.

```bash
docker compose exec data-prepper \
  curl -sk \
  -u "admin:${OPENSEARCH_PASSWORD}" \
  'https://opensearch:9200/_cluster/health?pretty'
```

응답은 `yellow`였고 노드와 primary shard는 정상적으로 활성화돼 있었다. 단일 노드 환경에서 replica 수가 1이면 복제본을 배치할 두 번째 노드가 없기 때문에 `yellow`가 자연스럽다. 서비스가 죽은 `red`와는 의미가 다르다.

Data Prepper가 실제로 읽은 파이프라인 설정도 확인했다.

```bash
docker compose exec data-prepper \
  grep -n 'hosts:' /usr/share/data-prepper/pipelines/pipelines.yaml
```

세 sink 모두 `https://opensearch:9200`을 가리켰다. 관리 API의 파이프라인 목록도 정상적으로 반환됐다.

```bash
curl -s 'http://localhost:4900/list'
```

여기까지의 결과를 종합하면 DNS, 포트, TLS 연결, 계정, sink 주소가 모두 동작하고 있었다. 리소스도 확인했지만 Data Prepper는 약 490MiB/1GiB, OpenSearch는 약 1.75GiB/2GiB를 사용해 즉시 OOM이 발생한 상태는 아니었다. 남은 가능성은 OpenSearch가 컨테이너 health check는 통과했지만 Data Prepper의 인덱스 초기화 요청을 안정적으로 처리할 만큼 완전히 준비되기 전에 연결이 만들어졌거나, SNAPSHOT Data Prepper의 비동기 HTTP 클라이언트 초기화가 불안정했던 경우였다.

OpenSearch가 충분히 올라온 뒤 Data Prepper만 다시 시작했다.

```bash
docker compose restart data-prepper
```

재시작 이후 같은 오류가 멈췄고 다음 인덱스가 생성됐다.

```text
logs-otel-v1-000001
otel-v1-apm-span-000001
otel-v2-apm-service-map-000001
```

이 결과는 재시작 자체가 만능 해결책이라는 뜻이 아니다. 앞에서 연결과 설정을 확인해 잘못된 구성 가능성을 제거한 뒤, 초기화 타이밍 문제로 범위를 좁혔기 때문에 재시작 결과에도 의미가 생긴다. 같은 증상이 재현된다면 OpenSearch readiness에 대한 `depends_on` 조건, Data Prepper 이미지 버전, 재시도 간격을 함께 점검해야 한다.

### 문서 수가 0인데 데이터가 들어온 것처럼 보였던 이유

처음 `_cat/indices`에서는 span 인덱스의 `docs.count`가 0이었다. 하지만 `_stats`에는 translog operation이 수백 건 쌓여 있었다.

```bash
curl -sk \
  -u "admin:${OPENSEARCH_PASSWORD}" \
  'https://localhost:9200/otel-v1-apm-span-*/_stats/docs,translog?pretty'
```

당시 translog에는 826개의 operation이 있었지만 검색 가능한 Lucene segment로 refresh되기 전이었다. 잠시 뒤 `_count`를 실행하자 991건이 조회됐다.

```bash
curl -sk \
  -u "admin:${OPENSEARCH_PASSWORD}" \
  'https://localhost:9200/otel-v1-apm-span-*/_count?pretty'
```

OpenSearch의 색인과 검색 가시성은 완전히 같은 순간에 갱신되지 않는다. `docs.count = 0`만 보고 ingest가 실패했다고 단정하기보다는 translog, refresh, `_count`를 함께 보는 편이 안전하다.

여기서 셸 문법 문제도 한 번 겪었다. 역슬래시(`\`)로 줄을 이어 쓸 때 그 다음에 빈 줄이 들어가면 명령이 끝난 것으로 해석되어 `curl: (2) no URL specified`가 발생한다. 역슬래시는 반드시 바로 다음 줄과 붙여 사용해야 한다.

## Collector를 올리고 메트릭 경로 확인하기

Data Prepper와 OpenSearch 사이가 안정화된 뒤 OpenTelemetry Collector를 시작했다.

```bash
docker compose up -d otel-collector
docker compose logs --no-log-prefix otel-collector | sed -n '1,100p'
```

로그에는 `prometheusremotewrite`, `otlp`, `resourcedetection` alias가 deprecated라는 경고와 OTTL 표현식에 `span.` 같은 context prefix를 자동으로 붙였다는 정보가 나왔다. 이는 당장 파이프라인을 중단시키는 오류가 아니었다. 중요한 로그는 gRPC 서버가 4317, HTTP 서버가 4318에서 시작됐고 마지막에 다음 메시지가 출력됐다는 점이었다.

```text
Everything is ready. Begin running and processing data.
```

Collector의 memory limiter는 총 500MiB를 기준으로 400MiB limit와 125MiB spike limit를 사용하고 있었다. 이후 메모리 알림 임계값이 400MiB로 설정된 이유도 이 값과 연결된다.

`frontend-proxy:10000`을 찾지 못한다는 Prometheus receiver 경고도 있었지만, 해당 예제 서비스를 아직 실행하지 않았기 때문에 발생한 별도 scrape 실패였다. Collector 전체가 준비되지 않았다는 뜻은 아니다.

Collector self-metric이 Cortex까지 전달됐는지 Prometheus 호환 API로 조회했다. 처음에는 익숙한 경로를 사용했다.

```bash
curl -sG 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=otelcol_process_runtime_heap_alloc_bytes'
```

결과는 `404 page not found`였다. 이 구성의 9090 포트는 일반 Prometheus가 아니라 URL prefix를 사용하는 Cortex여서 API 앞에 `/prometheus`가 필요했다.

```bash
curl -sG 'http://localhost:9090/prometheus/api/v1/query' \
  --data-urlencode 'query=otelcol_process_runtime_heap_alloc_bytes'
```

수정한 요청에서는 `status: success`와 metric vector가 반환됐다. 이것으로 애플리케이션 트레이스 경로와 별개로 Collector self-metric이 Cortex에 저장되고 쿼리 가능하다는 사실을 확인했다.

## 예제 요청을 지속적으로 만들기

관측 시스템은 관측할 트래픽이 있어야 의미가 있다. `example-canary`를 시작하자 의존하는 Travel Planner, Weather Agent, Events Agent, MCP Server, Fault Panel도 함께 빌드되고 실행됐다.

```bash
docker compose up -d example-canary
```

Canary는 처음 두 번 Travel Planner의 8000 포트에서 `Connection refused`를 받았다. 몇 초 뒤 `Travel planner is healthy`가 출력됐고 정상·deep·fault injection 시나리오를 반복해서 호출하기 시작했다. 컨테이너가 `Up`인 시점과 애플리케이션이 요청을 받을 준비가 된 시점 사이에 짧은 차이가 있다는 점을 여기서도 볼 수 있다.

## Dashboards 초기화와 워크스페이스 생성

OpenSearch Dashboards를 5601 포트에 띄운 뒤 인증 없이 `/api/status`를 호출하면 HTTP 401이 반환됐다. 보안 플러그인이 활성화된 환경에서는 정상적인 결과다. 브라우저에서 로그인한 다음 초기화 컨테이너를 실행했다.

```bash
docker compose up -d opensearch-dashboards-init
docker compose logs --tail=100 opensearch-dashboards-init
```

초기화 작업은 ISM 보존 정책을 갱신하고 `Observability Stack` 워크스페이스를 만들었다. 이어서 logs, span, service map 인덱스 패턴과 trace-to-logs correlation을 생성하고 Agent Observability, Observability Stack Overview, Observability Pipeline Health, OpenSearch Cluster Health 대시보드를 등록했다. 작업이 끝난 컨테이너는 `Exited (0)`이 됐다. init 컨테이너는 계속 실행되는 서비스가 아니라 한 번 작업하고 정상 종료하는 job이므로 `Exited (0)`이 성공 상태다.

![Observability Stack 워크스페이스가 생성된 OpenSearch 시작 화면](/images/opensearch-observability-stack-local-lab/01-workspace.webp)

## Agent Traces에서 한 요청을 읽는 법

Agent Traces 화면에는 최근 15분 동안 26개의 trace, 452개의 span, 약 53K token이 보였다. P50 latency는 5.43초, P99는 17.45초였고 22개의 error span도 집계됐다.

![Agent Traces 목록과 전체 지표](/images/opensearch-observability-stack-local-lab/02-agent-traces-overview.webp)

Trace는 사용자 요청 하나의 전체 여정이고, span은 그 안에서 수행된 개별 작업이다. `POST /plan` 한 행을 열어 보면 Travel Planner가 Weather Agent와 Events Agent를 호출하고, 각 에이전트가 LLM 및 MCP tool을 실행하는 부모-자식 구조를 확인할 수 있다.

![Travel Planner 요청의 Trace Tree](/images/opensearch-observability-stack-local-lab/03-trace-tree.webp)

선택한 요청은 “Plan a trip to Mumbai”였고 전체 17.45초 동안 52개의 span과 2,908개의 token을 사용했다. 오른쪽 패널에서는 입력과 출력뿐 아니라 trace ID, span ID, 시작·종료 시간, raw span까지 확인할 수 있다. 운영 환경에서는 이 입력·출력에 사용자 텍스트나 개인정보가 포함될 수 있으므로 수집 전 redaction과 접근 제어가 필요하다.

### Timeline으로 지연 시간을 분해하기

Tree가 호출 관계를 설명한다면 Timeline은 시간이 어디에서 소비됐는지 보여준다.

![같은 요청을 시간축으로 펼친 Timeline](/images/opensearch-observability-stack-local-lab/04-trace-timeline.webp)

이 요청에서 Travel Planner의 `chat planning`은 약 286ms였다. 반면 Weather Agent 호출은 약 6.5초, Events Agent 호출은 약 5.34초였고 그 아래 tool 호출 대부분이 비슷한 시간을 차지했다. LLM 응답보다 외부 API 또는 tool 호출이 전체 latency를 지배하고 있었다. “에이전트가 느리다”는 현상을 LLM 문제로 뭉뚱그리지 않고, 어느 downstream에서 기다렸는지를 분리할 수 있다는 것이 distributed trace의 가치다.

### Trace Map으로 서비스 의존성 보기

Trace Map은 같은 정보를 호출 그래프로 펼친다. Travel Planner에서 여러 agent와 MCP 호출로 가지가 나뉘는 형태가 한눈에 보인다.

![서비스와 도구 사이의 부모-자식 호출을 보여주는 Trace Map](/images/opensearch-observability-stack-local-lab/05-trace-map.webp)

Tree는 세부 span을 순서대로 탐색할 때, Timeline은 병목을 찾을 때, Map은 의존성 구조를 설명할 때 특히 유용했다.

## HTTP 200 안에 숨어 있는 부분 실패 찾기

Span 탭의 facet에서 `status.code` 값을 확인하면 0, 1, 2가 각각 집계됐다. OpenTelemetry status code에서 2는 `ERROR`다. 해당 값의 돋보기 아이콘을 누르자 PPL 필터가 자동으로 만들어졌다.

```text
WHERE `status.code` = 2
```

![status.code 2로 좁힌 오류 span 목록](/images/opensearch-observability-stack-local-lab/06-error-span-filter.webp)

오류 span 중 하나를 열어 보니 흥미로운 구조가 나왔다. 루트 `POST /plan` trace는 `Success`였지만, 그 아래 `invoke_agent Events Agent`에 빨간 오류 표시가 있었다.

![루트 요청은 성공이지만 Events Agent 하위 span은 실패한 trace](/images/opensearch-observability-stack-local-lab/07-partial-failure-trace.webp)

오류가 난 Events Agent span의 자식인 `chat events-reasoning`은 다시 `Success`였다.

![실패한 Events Agent 아래에서 성공한 LLM chat span](/images/opensearch-observability-stack-local-lab/08-successful-child-span.webp)

컨테이너 로그에서는 같은 시간대의 `/events` 요청이 모두 `200 OK`로 기록돼 있었다.

```text
"POST /events HTTP/1.1" 200 OK
```

서버는 일부 기능 실패를 응답 안에 포함하고 전체 요청은 성공으로 처리하는 graceful degradation을 구현할 수 있다. 따라서 HTTP access log만 보면 정상인데 trace에는 하위 agent 실패가 남을 수 있다. 운영 로그에도 `trace_id`, `span_id`, 업무 결과를 나타내는 `outcome`이나 `error_type`을 함께 기록해야 로그와 trace를 빠르게 연결할 수 있다.

## Pipeline Health 대시보드 해석하기

초기화 스크립트가 만든 대시보드 목록에는 Agent Observability 외에도 파이프라인과 클러스터 상태를 위한 화면이 포함돼 있었다.

![초기화된 OpenSearch Dashboards 목록](/images/opensearch-observability-stack-local-lab/09-dashboard-list.webp)

Observability Pipeline Health 상단에서는 Collector가 받은 span과 OpenSearch 방향으로 내보낸 span의 초당 비율이 거의 같은 형태로 움직였다. 수신량만 늘고 export가 따라오지 못한다면 queue 또는 downstream 문제를 의심해야 하지만, 이 구간에서는 두 그래프가 함께 움직였다. Metric received/sec도 지속적으로 값이 들어왔다.

![Collector 수신량과 export 처리량을 비교하는 Pipeline Health 상단](/images/opensearch-observability-stack-local-lab/10-pipeline-health-top.webp)

Exporter queue size는 0이었고 Collector CPU 사용량도 낮았다. Batch metadata cardinality는 3으로 안정적이었다.

![Exporter queue, CPU, batch cardinality 패널](/images/opensearch-observability-stack-local-lab/11-pipeline-health-collector.webp)

하지만 화면 아래쪽의 Cortex와 Data Prepper 패널 상당수에는 `No results found`가 표시됐다.

![Data Prepper 관련 패널에 No results found가 표시된 화면](/images/opensearch-observability-stack-local-lab/12-pipeline-health-no-data.webp)

여기서 `No results found`와 값 0을 구분해야 한다. 값 0은 시계열이 존재하고 현재 측정값이 0이라는 뜻이다. `No results found`는 쿼리가 일치하는 시계열 자체를 찾지 못했다는 뜻이다. Data Prepper self-metric을 수집하지 않았거나, 버전이 바뀌면서 metric 이름과 dashboard query가 맞지 않을 수 있다. 실제로 메모리 규칙 화면에서는 `otelcol_process_memory_rss`가 약 95~102MiB로 조회됐지만, Pipeline Health의 Collector memory 패널은 비어 있었다. 이런 경우 대시보드만 보고 “메모리가 0”이라고 판단하면 안 된다. 패널의 PromQL과 실제 `/metrics`의 이름을 비교해야 한다.

## 기본 알림 규칙과 모니터 만들기

알림 초기화 컨테이너를 실행했다.

```bash
docker compose up -d alerting-rules-monitors-init
docker compose logs --tail=120 alerting-rules-monitors-init
```

init job은 Cortex의 `/rules/stack/stack-alerts.yml`을 `stack` namespace에 올리고 4개의 Prometheus 규칙을 등록했다. 이어서 OpenSearch에는 `Observability Stack - Cluster Health Red` 모니터를 만들고 `Exited (0)`으로 끝났다.

OpenSearch Dashboards에는 classic Alerting 화면과 통합 Observability Alerting 화면이 함께 있어 처음에 UI를 찾기 어려웠다. classic `/app/alerts#/dashboard`에는 Rules 탭이 없었다. 통합 화면 `/app/observability-alerting#/rules`로 이동하면 `Alerts`, `Rules`, `Routing` 탭과 OpenSearch·Prometheus datasource를 한 화면에서 볼 수 있다.

![OpenSearch monitor와 Prometheus 규칙이 함께 보이는 Rules 화면](/images/opensearch-observability-stack-local-lab/13-alert-rules.webp)

이 화면의 상태 용어는 datasource에 따라 해석이 다르다.

| 표시 | Prometheus/Cortex 규칙 | OpenSearch monitor |
| --- | --- | --- |
| `muted` | 현재 조건이 거짓이라 발화하지 않는 inactive 상태 | 해당 없음 |
| `pending` | 조건은 참이지만 `for` 시간을 채우는 중 | 트리거 대기 상태 |
| `active` | 현재 alert가 firing 중 | monitor가 활성화되어 평가 중 |
| `healthy` | 규칙 평가 자체가 정상 | monitor 실행 자체가 정상 |

따라서 기본 Prometheus 규칙 네 개가 `muted · healthy`인 것은 고장 난 상태가 아니라 평가 결과가 임계값 아래라는 뜻이다. 반면 OpenSearch의 Cluster Health Red monitor는 `active · healthy`여도 cluster가 red라는 뜻이 아니다. 실제 발생 여부는 Alerts 탭의 alert instance로 확인해야 한다.

### Collector High Memory

메모리 규칙은 RSS를 MiB로 변환해 400MiB를 5분 동안 넘는지 평가한다.

```text
otelcol_process_memory_rss{job="otel-collector"} / 1024 / 1024 > 400
```

![Collector RSS 400MiB 임계값을 사용하는 High Memory 규칙](/images/opensearch-observability-stack-local-lab/14-high-memory-rule.webp)

Collector 컨테이너 제한이 500MiB이고 memory limiter가 400MiB에 설정돼 있으므로, 이 임계값은 OOM까지 약 100MiB의 여유가 남은 지점이다. 실습 중 실제 값은 약 100MiB로 조건을 만족하지 않았다.

### Exporter Queue Near Capacity

Queue 규칙은 현재 queue size를 capacity로 나눈 값이 0.8을 5분 동안 넘는지 본다.

```text
(otelcol_exporter_queue_size / otelcol_exporter_queue_capacity) > 0.8
and otelcol_exporter_queue_capacity > 0
```

![Exporter queue 사용률 80%를 감시하는 규칙](/images/opensearch-observability-stack-local-lab/15-queue-capacity-rule.webp)

queue가 차기 시작한다는 것은 downstream 쓰기가 수신 속도를 따라가지 못한다는 뜻이다. 실제 export failure가 증가하기 전에 backpressure를 감지하는 선행 지표다. 당시 latest evaluated value는 0이었다.

### Prometheus Target Down

Collector self-metric scrape가 중단됐는지는 `up`으로 감시한다.

```text
up{job="otel-collector"} == 0
```

![otel-collector scrape target의 up 값을 감시하는 규칙](/images/opensearch-observability-stack-local-lab/16-target-down-rule.webp)

그래프의 값은 1이어서 target이 정상적으로 scrape되고 있었다. 다만 감시 대상과 감시 주체가 같은 로컬 스택에 묶여 있으면 전체 스택이 함께 종료될 때 알림 자체도 전송되지 못한다. 완전한 장애 감지가 필요하면 외부 Prometheus나 별도 synthetic probe처럼 독립된 관찰자가 필요하다.

### OpenSearch Cluster Health Red

OpenSearch monitor는 `/_cluster/health` API를 1분마다 호출하고 `status == red`인지 확인한다.

![OpenSearch cluster health API를 사용하는 Cluster Red monitor](/images/opensearch-observability-stack-local-lab/17-cluster-red-monitor.webp)

단일 노드에서 replica 때문에 발생하는 `yellow`는 이 규칙을 발화시키지 않는다. 이 monitor 역시 OpenSearch 내부에서 실행되므로 OpenSearch 프로세스가 완전히 죽었을 때는 외부에서 죽음을 감지할 장치가 별도로 필요하다.

## Alertmanager Routing 읽기

Routing 탭은 읽기 전용이며 실제 구성은 Alertmanager 설정 파일 또는 API에서 관리한다. 실습 당시 Alertmanager 0.27.0은 ready 상태였고 root receiver는 `opensearch-webhook`이었다.

![Alertmanager route tree, receiver, inhibition 설정](/images/opensearch-observability-stack-local-lab/18-alert-routing.webp)

Root route는 모든 alert를 받아 `alertname`, `service_name`으로 묶고, 30초 기다린 뒤 알림을 전송하며 5분 간격으로 group을 갱신하고 4시간 후 반복한다. `component="otel-demo"`이면서 severity가 critical 또는 warning인 alert만 하위 route로 내려간다. 실습에서 만든 `component="learning-test"` alert는 하위 matcher와 일치하지 않으므로 root의 `opensearch-webhook`으로 간다.

Receiver 목록에 dummy Slack, email, PagerDuty가 보인다는 것만으로 해당 통합이 실제 전송 가능하다고 해석해서는 안 된다. route가 어떤 receiver를 선택했는지와 receiver가 최종 목적지에 성공적으로 전송했는지는 별도 단계다.

Inhibit rule은 같은 `service`에서 critical alert가 있을 때 warning을 억제한다. 상위 장애 하나 때문에 파생 warning이 폭주하는 것을 줄이는 장치다.

## 학습용 규칙으로 `pending → active → resolved` 재현하기

기본 High Memory 임계값은 400MiB인데 실제 Collector RSS는 약 100MiB였다. 컨테이너를 일부러 메모리 부족으로 몰아넣는 대신, 안전하게 임계값만 50MiB로 낮춘 임시 규칙을 새로 만들었다. 기존 규칙을 clone하는 과정에서는 UI 목록이 늦게 갱신되어 복사본이 생겼다가 사라진 것처럼 보였다. 잠시 뒤 다시 나타난 것으로 보아 rule API와 화면 refresh 사이의 eventual consistency 문제였고, 정확한 이름을 확인한 뒤 복사본은 삭제했다.

새 규칙의 이름은 `LearningTestCollectorMemory`로 정했다. query는 비교 연산을 제외한 원시 RSS MiB 값으로 입력하고 UI의 Alert Condition에서 `> 50 MiB`를 설정했다.

```text
otelcol_process_memory_rss{job="otel-collector"} / 1024 / 1024
```

평가 간격은 30초, For Duration과 Pending Period는 1분, 최소 Firing Period도 1분으로 설정했다.

![학습용 Collector memory 규칙의 쿼리와 평가 설정](/images/opensearch-observability-stack-local-lab/19-create-memory-rule.webp)

Routing과 화면 식별을 위해 `severity=warning`, `component=learning-test`, `service_name=otel-collector` 라벨을 추가했다. summary와 description도 alert만 보고 실험 목적을 알 수 있게 작성했다.

![학습용 규칙의 label, annotation, YAML 미리보기](/images/opensearch-observability-stack-local-lab/20-rule-yaml-preview.webp)

UI가 만든 최종 규칙은 다음과 같은 형태였다.

```yaml
- alert: LearningTestCollectorMemory
  expr: otelcol_process_memory_rss{job="otel-collector"} / 1024 / 1024 > 50
  for: 1m
  labels:
    severity: warning
    component: learning-test
    service_name: otel-collector
  annotations:
    summary: "Learning test: Collector RSS exceeds 50 MiB"
    description: "Temporary local alert for verifying pending, firing, and routing. Delete after test."
```

저장 직후 RSS는 이미 50MiB를 넘고 있었지만 `for: 1m`을 아직 채우지 않았기 때문에 상태가 `pending`이었다.

![조건은 참이지만 대기 시간을 채우는 pending 상태](/images/opensearch-observability-stack-local-lab/21-rule-pending.webp)

1분이 지나자 규칙 상태가 `active`로 바뀌고 Alerts 탭의 개수도 1이 됐다. 이 화면에서 Prometheus 규칙의 `active`는 firing을 의미한다.

![1분 조건을 채워 active가 된 학습용 규칙](/images/opensearch-observability-stack-local-lab/22-rule-active.webp)

Alerts 탭에는 warning이 UI severity `medium`으로 표시됐고 시작 시각과 duration이 나타났다.

![통합 Alerts 화면에 나타난 active alert](/images/opensearch-observability-stack-local-lab/23-alert-active.webp)

Alertmanager API에서도 같은 alert를 확인했다.

```bash
curl -s 'http://localhost:9093/api/v2/alerts' | python3 -m json.tool
```

응답에는 `status.state: active`, `receiver: opensearch-webhook`, `component: learning-test`, `severity: warning`이 포함됐다. Collector가 전달한 resource attribute가 Prometheus label로 승격되어 `service_instance_id`, `host_name`, `service_version` 같은 라벨도 함께 붙어 있었다.

여기서 `receivers: [{"name": "opensearch-webhook"}]`는 routing이 해당 receiver를 선택했다는 증거다. webhook 서버가 최종 요청을 성공적으로 처리했다는 증거까지 되지는 않는다. 실제 전달을 검증하려면 Alertmanager 로그와 수신 측 로그 또는 delivery metric을 추가로 확인해야 한다.

실험을 끝내고 `LearningTestCollectorMemory` 규칙을 삭제했다. 잠시 뒤 Alertmanager API는 빈 배열을 반환했다.

```json
[]
```

`/api/v2/alerts`는 현재 활성 alert만 보여 주므로 해결된 alert가 사라진다. 반면 OpenSearch Dashboards의 통합 Alerts 화면에는 같은 항목이 `resolved`로 남아 lifecycle 이력을 확인할 수 있었다.

![규칙 삭제 후 resolved로 남은 학습용 alert](/images/opensearch-observability-stack-local-lab/24-alert-resolved.webp)

이로써 `metric 수집 → Cortex rule 평가 → pending → firing → Alertmanager routing → 규칙 제거 → resolved` 전 과정을 한 번 재현했다.

## 마치며

이번 실습에서 가장 큰 수확은 “실행되고 있다”와 “관측 가능하다”가 다르다는 점이었다. 컨테이너 상태, 실제 API 연결, 저장소의 refresh, trace의 부모-자식 상태, metric query 결과, alert lifecycle을 각각 확인해야 전체 경로가 정상이라고 말할 수 있다.

특히 HTTP 200 안의 부분 실패와 `No results found`를 0으로 오해하지 않는 습관은 실제 장애 분석에서도 그대로 중요하다. 다음 단계에서는 비어 있던 Data Prepper·Cortex 대시보드 쿼리를 실제 노출 metric과 맞추고, `opensearch-webhook`의 최종 delivery까지 검증하면 이 로컬 스택을 한 단계 더 운영 환경에 가깝게 만들 수 있다.
