---
title: "OpenSearch 인덱스 템플릿에서 keyword와 text를 나누는 기준"
date: "2026-08-19T02:00:00Z"
tags: [백엔드, 모니터링]
---

[앞 글](/posts/log-pipeline-1-noise-cleanup)에서 로그의 92%를 차지하던 헬스체크 노이즈를 걷어냈다. 이제 이 로그를 담을 그릇을 만들 차례다.

OpenSearch는 스키마를 미리 정하지 않아도 쓸 수 있다. 문서를 넣으면 알아서 타입을 추측한다. 편하지만 사고가 난다. 이 글은 인덱스 템플릿을 왜 미리 만들어야 하는지, `keyword`와 `text`를 나누는 기준이 무엇인지 실제 쿼리로 확인한 기록이다.

## 로컬에 OpenSearch부터 세우기

평소 개발용 `docker-compose.yml`(postgres, redis)과 **분리된 파일**로 만들었다. 관측 스택은 학습할 때만 쓰는 데다 무거워서 평소 개발 회전에 끼워 넣으면 손해다.

```yaml
name: manyak-observability

services:
  opensearch:
    image: opensearchproject/opensearch:3.8.0
    container_name: manyak-opensearch
    environment:
      - discovery.type=single-node
      - OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g
      - DISABLE_SECURITY_PLUGIN=true
      - DISABLE_INSTALL_DEMO_CONFIG=true
    ulimits:
      memlock: { soft: -1, hard: -1 }
      nofile: { soft: 65536, hard: 65536 }
    ports:
      - "9200:9200"
    volumes:
      - manyak-opensearch-data:/usr/share/opensearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9200/_cluster/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 20
      start_period: 60s
```

몇 가지는 이유를 적어 둘 만하다.

**`name: manyak-observability`**. Compose는 이름을 안 주면 **디렉터리 이름**을 프로젝트로 쓴다. 그대로 두면 두 compose 파일이 같은 프로젝트에 묶여서 한쪽에 `--remove-orphans`를 주면 다른 쪽 컨테이너가 지워진다. 실제로 처음엔 이 경고가 떴다.

```text
Found orphan containers ([manyak-postgres]) for this project
```

이름을 갈랐더니 깔끔히 분리됐다.

```bash
docker ps --format '{{.Names}}\t{{.Label "com.docker.compose.project"}}'
```

```text
manyak-opensearch-dashboards    manyak-observability
manyak-opensearch               manyak-observability
manyak-postgres                 manyak-server
```

> 여기서 함정이 하나 있었다. **프로젝트 이름을 바꾸면 `down`이 옛 컨테이너를 못 찾는다.** Docker는 컨테이너에 프로젝트 이름을 라벨로 붙이고 그걸로 추적하는데 파일의 이름을 바꾸면 새 이름으로 찾으니 옛 라벨이 걸리지 않는다. `docker rm -f`로 직접 지워야 했다.

**healthcheck에서 색을 보지 않고 응답 여부만 본다**. 상태 색을 정하는 건 노드 수가 아니라 **인덱스가 요구한 복제본을 놓을 자리가 있는가**다. 뒤에서 만들 로그 템플릿이 `number_of_replicas: 0`이라 미할당 샤드가 안 생기고, 그래서 노드가 하나여도 `green`이 나온다. 복제본을 요구하는 인덱스가 하나라도 끼면 `yellow`가 되는데 그건 기동 실패가 아니라서, 색을 조건으로 걸면 멀쩡한 컨테이너를 unhealthy로 묶게 된다.

> 처음 이 주석을 쓸 때 "단일 노드는 yellow가 정상"이라고 적었다가 나중에 고쳤다. 로컬에서도 운영 도메인에서도 실제로는 `green`이 나왔고(`unassigned_shards: 0`), 노드 수와 상태 색을 직접 연결한 게 틀렸다.

**`DISABLE_SECURITY_PLUGIN=true`는 로컬 전용이다**. 켜면 TLS 인증서와 admin 비밀번호(2.12+부터 필수)가 따라붙는다. 학습의 본줄기와 무관한 데 시간을 쓰게 된다. 운영 도메인은 반대로 인증을 반드시 켠다.

## 필드를 추측하지 않고 세어 보기

템플릿을 만들려면 어떤 필드가 오는지 알아야 한다. 추측 대신 개발 환경 로그 7일치를 받아 JSON 키를 전수 조사했다.

```python
import json, collections
keys = collections.Counter()
types = collections.defaultdict(collections.Counter)
for line in open('devlogs.txt'):
    line = line.strip()
    if not line.startswith('{'): continue
    try: d = json.loads(line)
    except Exception: continue
    for k, v in d.items():
        keys[k] += 1
        types[k][type(v).__name__] += 1
```

```text
파싱된 JSON 문서: 72건

  @timestamp             72건  (str)
  @version               72건  (str)
  message                72건  (str)
  logger_name            72건  (str)
  thread_name            72건  (str)
  level                  72건  (str)
  level_value            72건  (int)
  service                72건  (str)
  tags                   49건  (list)
  device_id_hash          4건  (str)
  session_id              4건  (str)
  request_id              4건  (str)
  event_name              4건  (str)
  endpoint                4건  (str)
  http_method             4건  (str)
  status_code             4건  (int)
  duration_ms             4건  (int)
```

이 표본에는 없지만 예외가 실릴 때만 나오는 필드도 있었다. 더 넓은 창에서 찾았다.

```json
{
  "@timestamp": "2026-08-14T12:52:28.454389442Z",
  "message": "Error parsing HTTP request header",
  "logger_name": "org.apache.coyote.http11.Http11Processor",
  "level": "INFO",
  "stack_trace": "java.lang.IllegalArgumentException: Invalid character found in the request target [/index...",
  "service": "manyak-server"
}
```

`stack_trace`와 `tags`를 이렇게 찾았다. 평소엔 안 보이는 필드라 실측하지 않았으면 빠뜨렸을 것이다.

## 템플릿이 없으면 무엇이 곤란한가

OpenSearch는 처음 들어온 문서를 보고 타입을 굳힌다(dynamic mapping). `status_code`가 어쩌다 문자열 `"401"`로 먼저 들어오면 그 필드는 문자열이 된다. 그러면 이게 안 된다.

```text
status_code >= 400 인 로그를 찾아라
```

문자열은 사전순으로 비교되어 `"5"`가 `"400"`보다 크다는 엉뚱한 결과가 나온다. 게다가 **한 번 정해진 매핑은 바꿀 수 없다.** 인덱스를 새로 만들어 데이터를 옮겨야 한다.

그래서 인덱스가 만들어지기 **전에** 템플릿을 등록해 둔다.

```json
{
  "index_patterns": ["manyak-logs-*"],
  "priority": 100,
  "template": {
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 0,
      "refresh_interval": "5s"
    },
    "mappings": {
      "dynamic_templates": [
        {
          "strings_as_keyword": {
            "match_mapping_type": "string",
            "mapping": { "type": "keyword", "ignore_above": 1024 }
          }
        }
      ],
      "properties": {
        "@timestamp": { "type": "date" },
        "@version": { "type": "keyword" },

        "message": { "type": "text" },
        "stack_trace": { "type": "text" },

        "level": { "type": "keyword" },
        "level_value": { "type": "integer" },
        "logger_name": { "type": "keyword" },
        "thread_name": { "type": "keyword" },
        "service": { "type": "keyword" },
        "tags": { "type": "keyword" },

        "request_id": { "type": "keyword" },
        "session_id": { "type": "keyword" },
        "device_id_hash": { "type": "keyword" },

        "event_name": { "type": "keyword" },
        "endpoint": { "type": "keyword" },
        "http_method": { "type": "keyword" },
        "status_code": { "type": "integer" },
        "duration_ms": { "type": "long" }
      }
    }
  }
}
```

인덱스 이름은 `manyak-logs-{환경}-{YYYY.MM.DD}` 규칙으로 잡았다. 날짜로 나누는 이유는 보관 정책을 날짜 단위로 걸어 오래된 인덱스를 **통째로** 지우기 위해서다. 문서를 개별 삭제하는 것보다 훨씬 싸다.

등록한다.

```bash
curl -X PUT "http://localhost:9200/_index_template/manyak-logs" \
  -H 'Content-Type: application/json' -d @opensearch/index-template.json
```

## 실제 로그로 검증하기

템플릿이 맞는지 확인하려면 실제 데이터를 넣어 봐야 한다. 개발 환경에서 받아 둔 로그 500건을 `_bulk`로 색인했다.

```text
색인 성공: 500 | 실패: 0
```

가장 걱정한 건 `@timestamp`였다. 값이 나노초 9자리로 온다.

```text
2026-08-14T04:56:16.422096282Z
```

OpenSearch의 `date` 타입은 밀리초 단위라 9자리를 못 읽고 색인이 통째로 실패할 수도 있었다. 확인해 보니 정상이었다.

```text
원본 @timestamp : 2026-08-14T04:56:16.422096282Z
정렬키(epoch ms): 1786683376422
```

밀리초로 절삭해서 파싱한다. 추측으로 넘어갔으면 운영에 올린 뒤에 알았을 문제다.

적용된 매핑도 확인했다.

```bash
curl -s "http://localhost:9200/manyak-logs-dev-2026.08.19/_mapping"
```

```text
  @timestamp         date
  device_id_hash     keyword
  duration_ms        long
  endpoint           keyword
  level              keyword
  level_value        integer
  logger_name        keyword
  message            text
  request_id         keyword
  stack_trace        text
  status_code        integer
  ...
```

18개 필드 전부 지정한 타입 그대로다. 추측 매핑이 하나도 끼지 않았다.

## Dashboards에서 보기

OpenSearch Dashboards(5601)를 열고 Discover로 들어갔다. 그런데 바로 막혔다.

![Discover에서 index-pattern-field를 찾지 못해 발생한 오류](/images/log-pipeline-2-index-template/01-timestamp-field-error.webp)

```text
Search Error
Could not locate that index-pattern-field (id: @timestamp)
```

원인은 **인덱스 패턴을 API로 만들면서 필드 목록을 안 채운 것**이었다. Dashboards는 필드 목록을 인덱스 패턴 객체에 캐시해 두고 쓰는데 `title`과 `timeFieldName`만 등록하면 그게 비어 있어 `@timestamp`를 못 찾는다.

여기서 용어를 정리하고 넘어가는 게 좋다. 이름이 비슷한 게 둘인데 **역할과 저장 위치가 다르다.**

| | 무엇을 정하나 | 어디에 저장되나 |
|---|---|---|
| **인덱스 템플릿** | 로그를 어떤 **타입으로 저장**할지 | OpenSearch(9200) |
| **인덱스 패턴** | Discover에서 어떤 인덱스를 **어떤 시간축으로 볼지** | Dashboards(5601) |

필드 목록을 채워 다시 등록했다.

```bash
FIELDS=$(curl -s "http://localhost:5601/api/index_patterns/_fields_for_wildcard?pattern=manyak-logs-*&meta_fields=_source&meta_fields=_id&meta_fields=_type&meta_fields=_index&meta_fields=_score")
# fields 를 JSON 문자열로 넣어 저장 객체를 만든다
curl -X POST "http://localhost:5601/api/saved_objects/index-pattern/manyak-logs?overwrite=true" \
  -H 'osd-xsrf: true' -H 'Content-Type: application/json' -d "$BODY"
```

여기에도 함정이 둘 더 있었다.

- **필드 목록은 실제 인덱스가 있어야 읽힌다.** 인덱스가 하나도 없으면 `_fields_for_wildcard`가 400을 낸다. 그래서 빈 인덱스를 먼저 만들어 둔다.
- **저장 객체 생성은 `POST ?overwrite=true`다.** `PUT`은 기존 객체 수정 전용이라 처음 실행에서 404가 난다.

셋 다 스크립트로 묶어 뒀다. `down -v`로 볼륨을 지우면 이 설정도 함께 사라지므로 다시 세울 때 손으로 반복하지 않으려면 필요하다.

고치고 나니 정상적으로 떴다.

![인덱스 패턴 수정 후 정상 동작하는 Discover 화면](/images/log-pipeline-2-index-template/02-discover-working.webp)

왼쪽 필드 목록의 아이콘을 보면 템플릿이 먹은 게 보인다. `#` `duration_ms`, `#` `status_code`, `#` `level_value`, 달력 `@timestamp`, `t` `level`. 템플릿이 없었다면 `status_code`가 `t`(문자열)로 잡혔을 것이다.

## 타입이 맞아야만 되는 것들

이제 템플릿이 없었으면 안 됐을 쿼리들을 돌려 봤다.

### 숫자 범위 검색

Discover 검색창에 DQL로 입력했다.

```text
status_code >= 400
```

![status_code가 400 이상인 로그 17건이 조회된 화면](/images/log-pipeline-2-index-template/03-status-code-range.webp)

17건이 걸렸다. `integer`라서 대소 비교가 된다.

문서를 보면 재밌는 게 있다. `message` 안에도 `status_code=401`이라는 글자가 들어 있고 옆에 `status_code: 401`이라는 필드도 따로 있다. 앞의 것은 그냥 문장이라 범위 검색이 안 되고 뒤의 것으로는 된다. 서버가 `StructuredLogger`로 필드를 따로 실어 보내는 이유가 이것이다.

### 집계

왼쪽 필드 목록에서 `logger_name`을 클릭하면 상위 값이 뜬다.

![logger_name 필드의 상위 5개 값 분포](/images/log-pipeline-2-index-template/04-logger-name-top5.webp)

`RequestCorrelationFilter`가 58.3%다. [앞 글](/posts/log-pipeline-1-noise-cleanup)에서 고친 그 헤더누락 WARN이 이 데이터에 그대로 남아 있는 것이다.

## 여기서 오해를 하나 했다

`keyword`는 집계가 되고 `text`는 안 된다고 알고 있었다. 그래서 `message`(text)를 클릭하면 아무것도 안 나올 줄 알았는데 똑같이 나왔다.

![message 필드에서도 상위 5개 값이 표시되는 화면](/images/log-pipeline-2-index-template/05-message-top5.webp)

이유는 **Discover 사이드바의 Top 5가 서버 집계가 아니기 때문**이다. 화면에 불러온 문서 표본만 브라우저에서 세는 것이라 `text`든 `keyword`든 다 나온다. 두 패널 아래를 비교하면 단서가 보인다.

```text
logger_name : Exists in 499 / 500 records
message     : Exists in 500 / 500 records
```

둘 다 분모가 500이다. 인덱스 전체는 501건인데도. 불러온 표본만 센 것이다.

진짜 차이는 서버에 집계를 시켜 보면 드러난다.

```bash
curl -s "http://localhost:9200/manyak-logs-dev-2026.08.19/_search" \
  -H 'Content-Type: application/json' \
  -d '{"size":0,"aggs":{"t":{"terms":{"field":"message","size":3}}}}'
```

```text
Text fields are not optimised for operations that require per-document field data
like aggregations and sorting, so these operations are disabled by default.
Please use a keyword field instead.
```

같은 쿼리를 `logger_name`으로 바꾸면 통과한다.

```text
   291건  com.knk.manyak.global.observability.RequestCorrelationFilter
    60건  org.springframework.data.repository.config.RepositoryConfigu
    59건  org.flywaydb.core.internal.command.DbMigrate
```

UI에서도 같은 벽에 부딪힌다. `message` 패널의 `Visualize` 버튼을 누르면 이렇게 나온다.

![message 필드로 Terms 집계를 시도했을 때의 오류](/images/log-pipeline-2-index-template/06-visualize-terms-error.webp)

```text
Saved field "message" is invalid for use with the "Terms" aggregation.
Please select a new field.
```

정리하면 이렇다.

| | Discover 사이드바 Top 5 | 서버 집계 (대시보드, 시각화) | 정렬 |
|---|---|---|---|
| `keyword` | ○ | **○** | ○ |
| `text` | ○ (표본만) | **✗ 에러** | ✗ |

대시보드와 시각화는 전부 서버 집계 위에 만들어진다. `status_code`나 `logger_name`을 `text`로 뒀다면 대시보드를 하나도 못 만들었을 것이다.

그래서 나눈 기준은 이렇게 정리된다.

- **`keyword`**. 정확히 일치, 집계, 정렬이 필요한 값(식별자, 경로, 열거형). 분석기를 거치지 않고 통째로 저장한다.
- **`text`**. 사람이 읽는 문장에서 단어로 찾아야 하는 값(`message`, `stack_trace`). 토큰으로 쪼개져 집계에는 못 쓴다.

## 모르는 필드가 들어오면

로그 필드는 계속 늘어난다. 구조화 로그에 인자를 추가하거나 다른 서비스가 자기 필드를 실어 보내거나.

OpenSearch의 기본 동작은 모르는 문자열에 **`text`와 `keyword`를 둘 다** 만드는 것이다(`field`와 `field.keyword`). 저장 공간이 두 배가 되고 필드가 늘수록 매핑이 폭증한다. 그래서 `dynamic_templates`로 `keyword` 하나만 만들게 했다.

```json
"dynamic_templates": [
  { "strings_as_keyword": {
      "match_mapping_type": "string",
      "mapping": { "type": "keyword", "ignore_above": 1024 } } }
]
```

`ignore_above: 1024`는 1024자가 넘는 문자열을 색인하지 않는다는 뜻이다. 저장은 되지만 검색 대상에서 빠진다. 거대한 문자열 하나가 인덱스를 부풀리는 걸 막는다.

없던 필드를 넣어 확인했다.

```bash
curl -X POST "http://localhost:9200/manyak-logs-dev-2026.08.19/_doc?refresh=true" \
  -H 'Content-Type: application/json' -d '{
    "@timestamp":"2026-08-19T10:00:00.123456789Z","level":"INFO","service":"manyak-ai",
    "message":"dynamic template 확인용","llm_provider":"deepseek",
    "llm_model":"deepseek-chat","token_count":1234 }'
```

```text
  llm_provider   keyword
  llm_model      keyword
  token_count    long
```

문자열이 `text`가 아니라 `keyword`로 잡혔다. 숫자는 자동으로 `long`이 된다.

## 남는 생각

인덱스 템플릿은 **파이프라인을 만들기 전에** 있어야 한다. 인덱스가 생기는 순간에만 적용되고 이미 만들어진 인덱스의 매핑은 바꾸지 못하기 때문이다.

그리고 필드는 실측해서 정하는 게 낫다. `stack_trace`와 `tags`는 평소 로그에 안 보이다가 예외나 특정 로거에서만 나온다. 문서만 보고 짐작했으면 빠뜨렸을 것이고 `@timestamp`의 나노초 9자리는 실제로 색인해 보기 전엔 되는지 알 수 없었다.

다음 글에서는 이 인덱스에 로그를 자동으로 넣는다. 지금까지는 개발 환경 로그를 손으로 받아 `curl`로 밀어 넣었다. Fluent Bit이 그 손을 없앤다.
