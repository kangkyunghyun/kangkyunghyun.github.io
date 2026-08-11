---
title: "OpenSearch Observability Stack 실습 — Astronomy Shop 주문 추적부터 결제 장애 원인 분석까지"
date: 2026-08-11
tags: [백엔드, 모니터링]
---

이번 실습에서는 OpenTelemetry Demo의 쇼핑 애플리케이션인 **Astronomy Shop**에서 직접 주문을 만들고, 그 요청이 여러 마이크로서비스를 지나가는 과정을 OpenSearch Dashboards에서 추적했다. 이어서 결제 장애를 의도적으로 발생시킨 뒤, 사용자가 본 HTTP 500 응답에서 출발해 실제 오류가 발생한 `payment` 서비스와 예외 메시지까지 찾아갔다.

앞선 글에서는 OpenSearch, Data Prepper, OpenTelemetry Collector, Cortex와 Dashboards로 구성된 로컬 관측성 스택을 실행하고 데이터 수집 및 알림 흐름을 확인했다. 이번 글은 그다음 단계인 애플리케이션 관측 실습이다. 초기 구성 과정은 [앞선 로컬 스택 실습](/posts/opensearch-observability-stack-local-lab/)에 정리했다.

> 이 글에 사용한 화면 캡처는 브라우저 탭과 북마크에 표시된 개인 정보를 가리기 위해 상단 영역만 모자이크 처리했다. Dashboards의 데이터 영역은 원본 해상도를 유지했다.

## 이번에 확인할 흐름

이번 실습의 흐름은 다음과 같다.

1. Astronomy Shop에서 정상 주문을 한 번 만든다.
2. 주문 요청의 트레이스를 찾아 서비스 호출 구조와 지연 시간을 확인한다.
3. 같은 `traceId`를 가진 로그를 찾아 트레이스와 로그가 어떻게 연결되는지 확인한다.
4. Feature Flag로 결제 실패를 주입한다.
5. 실패한 트레이스에서 HTTP 500의 실제 원인을 찾는다.
6. 장애 주입을 해제하고 주문과 결제 흐름이 정상으로 돌아왔는지 검증한다.

관측성 도구를 공부할 때는 대시보드에 그래프가 보인다는 사실보다 **사용자 요청 → 서비스 호출 → 실패 지점 → 관련 로그**를 하나의 사건으로 연결해 보는 것이 중요하다.

## Astronomy Shop은 마이크로서비스 애플리케이션이다

Astronomy Shop은 하나의 쇼핑 화면 뒤에서 여러 서비스가 역할을 나눠 처리하는 마이크로서비스 예제다. 장바구니, 주문, 결제, 배송, 상품 조회 등이 한 프로세스에 들어 있지 않고 각각 별도 컨테이너로 실행된다.

주문 한 건을 단순화하면 다음과 같은 구조다.

```text
브라우저
  ↓
frontend
  ↓
checkout (주문 전체 조율)
  ├─ cart
  ├─ product-catalog
  ├─ currency
  ├─ shipping
  ├─ payment
  └─ email
```

`checkout`은 모든 일을 직접 처리하지 않는다. 장바구니 조회는 `cart`, 상품 정보는 `product-catalog`, 환율은 `currency`, 배송비 계산과 배송 처리는 `shipping`, 결제는 `payment`, 확인 메일은 `email`에 요청한다. 한 서비스의 구현과 배포를 독립적으로 관리할 수 있다는 장점이 있지만, 사용자 요청 하나가 여러 네트워크 호출로 분산되므로 장애 원인을 찾기는 더 어려워진다.

반면 OpenSearch, Data Prepper, OpenTelemetry Collector, Cortex, Kafka, PostgreSQL, flagd 같은 컨테이너는 애플리케이션의 비즈니스 기능을 담당하지 않는다. 애플리케이션을 지원하거나 텔레메트리를 저장·전달·조회하는 인프라 구성 요소다. `docker compose ps`에 컨테이너가 많이 보인다고 해서 모두 같은 종류의 서비스인 것은 아니다.

## 스택 실행과 수동 요청 준비

전체 예제를 실행했다.

```bash
docker compose up -d
docker compose ps -a
```

이번 실행에서 주요 버전은 다음과 같았다.

| 구성 요소 | 버전 |
| --- | --- |
| OpenTelemetry Demo | 2.2.0 |
| OpenTelemetry Collector Contrib | 0.156.0 |
| Data Prepper | 2.16.0 |
| OpenSearch / Dashboards | 3.8.0 |

![로컬에서 실행한 OpenTelemetry Demo Astronomy Shop](/images/opensearch-astronomy-shop-trace-log-fault-lab/11-otel-demo-home.webp)

Astronomy Shop에는 자동으로 트래픽을 발생시키는 `load-generator`가 포함되어 있다. 자동 요청과 내가 직접 만든 주문이 섞이지 않도록 먼저 이를 중지했다.

```bash
docker compose stop load-generator
```

이미 수집된 데이터는 사라지지 않지만, 이 시점 이후에는 수동으로 발생시킨 요청을 시간대와 동작으로 구분하기 쉬워진다. 대시보드에 이전 트래픽의 수치가 남아 있는 이유도 여기 있다.

## 정상 주문으로 기준선 만들기

`http://localhost:8080`에서 상품을 장바구니에 넣고 결제를 완료했다. 첫 주문에서는 망원경 한 개를 구매했고 주문 완료 화면까지 정상적으로 이동했다.

![Astronomy Shop에서 완료된 정상 주문](/images/opensearch-astronomy-shop-trace-log-fault-lab/01-successful-checkout.webp)

장애를 분석하기 전에 정상 흐름을 먼저 확인한 이유는 비교 기준을 만들기 위해서다. 정상 주문에서 어떤 서비스가 호출되고 각 단계가 어느 정도 걸리는지 알아야, 실패한 주문에서 사라졌거나 오류로 바뀐 구간을 구분할 수 있다.

## Astronomy Shop 대시보드 읽기

OpenSearch Dashboards의 `Astronomy Shop` 대시보드에는 비즈니스 지표와 애플리케이션 지표가 함께 배치되어 있었다.

![Astronomy Shop 비즈니스 및 애플리케이션 대시보드](/images/opensearch-astronomy-shop-trace-log-fault-lab/02-astronomy-shop-dashboard.webp)

상단의 평균 결제 금액, 장바구니 추가 횟수, 상품 리뷰 같은 값은 사용자 행동을 설명한다. 아래의 가용성, 느린 API 호출, 실시간 API 호출, 처리량과 5xx 비율은 시스템 상태를 설명한다. 같은 화면에 있다고 해서 모두 같은 텔레메트리는 아니다.

- **메트릭**은 일정 시간 동안 요청 수, 오류율, 지연 시간 등이 어떻게 변하는지 보여준다.
- **트레이스**는 특정 요청 한 건이 어느 서비스를 어떤 순서로 통과했는지 보여준다.
- **로그**는 각 서비스가 그 순간 남긴 구체적인 사건과 값을 보여준다.

대시보드는 이상 징후를 발견하는 출발점이고, 개별 요청의 원인을 분석할 때는 트레이스와 로그로 내려가야 한다.

## PPL로 주문 요청 찾기

Traces 화면에서 다음 PPL 쿼리로 `frontend` 서비스의 checkout 관련 span을 찾았다.

```text
source = `otel-v1-apm-span*`
| where serviceName = 'frontend'
| where ilike(name, '%checkout%')
| sort - startTime
```

![PPL로 frontend의 checkout span 검색](/images/opensearch-astronomy-shop-trace-log-fault-lab/03-checkout-ppl-query.webp)

각 조건의 의미는 단순하다.

- `source`는 Data Prepper가 저장한 trace span 인덱스를 지정한다.
- `serviceName = 'frontend'`는 사용자 요청을 받은 프론트엔드 서비스로 범위를 줄인다.
- `ilike(name, '%checkout%')`는 span 이름에 checkout이 포함된 결과만 남긴다.
- `sort - startTime`은 최근 요청을 위에서 볼 수 있게 정렬한다.

한 번의 checkout 요청에도 client, internal, server span이 각각 생길 수 있다. 이는 중복 데이터가 아니라 한 요청을 보내는 측, 내부 처리, 받는 측을 서로 다른 작업 단위로 기록한 결과다.

## 트레이스에서 서비스 호출 구조 읽기

정상 주문의 트레이스 ID는 `9c9b7c0e1a4081a20cbae3955648bdd0`이었다. 트레이스 상세 화면에서는 48개의 span이 하나의 부모-자식 구조로 연결되어 있었다.

최상단의 `frontend-web: HTTP POST`에서 시작해 `frontend-proxy`, `frontend`, `checkout`으로 이어졌고, 그 아래에서 장바구니, 상품, 환율, 배송, 결제 등의 호출이 분기됐다. 막대의 시작 위치는 호출 시점, 길이는 소요 시간을 뜻한다. 따라서 트리 구조와 타임라인을 함께 보면 **누가 누구를 호출했는지**와 **어디에서 시간을 썼는지**를 동시에 확인할 수 있다.

![정상 주문 요청의 전체 서비스 호출 타임라인](/images/opensearch-astronomy-shop-trace-log-fault-lab/12-successful-trace-timeline.webp)

checkout span의 Metadata에는 단순한 기술 정보뿐 아니라 주문 문맥도 들어 있었다.

![정상 주문 checkout span의 비즈니스 메타데이터](/images/opensearch-astronomy-shop-trace-log-fault-lab/04-checkout-business-metadata.webp)

화면에서 확인한 주요 값은 다음과 같다.

```text
app.order.amount: 138
app.order.items.count: 1
app.shipping.amount: 8
app.user.currency: USD
app.order.id: 01ef0715-9561-11f1-8d43-d6af533bb93f
```

이런 속성이 없으면 트레이스는 “어떤 API가 75ms 걸렸다” 정도만 알려준다. 주문 ID, 금액, 상품 수 같은 비즈니스 속성이 함께 있으면 “어느 주문이 실패했는가”라는 운영 질문에도 답할 수 있다. 단, 개인정보나 결제 정보처럼 민감한 값을 span이나 log에 무분별하게 넣어서는 안 된다.

## traceId로 트레이스와 로그 연결하기

트레이스 상세 화면의 `Related logs`에는 같은 요청에서 발생한 로그가 서비스 경계를 넘어 모여 있었다.

![정상 주문 트레이스에 연결된 Related logs](/images/opensearch-astronomy-shop-trace-log-fault-lab/05-trace-related-logs.webp)

정상 주문에서는 다음과 같은 사건을 확인했다.

```text
Product Found
Calculated quote
payment went through
order placed
Order confirmation email sent
```

이 연결을 가능하게 만드는 핵심 값은 `traceId`다. 동일한 사용자 요청에 참여한 서비스가 같은 trace context를 전파하고 로그에도 trace ID를 기록하면, OpenSearch에서 서비스별 로그를 하나의 요청 단위로 다시 묶을 수 있다. `spanId`까지 있으면 그 로그가 트레이스의 어느 작업에서 생성됐는지도 더 정확하게 연결할 수 있다.

Discover Logs로 이동해 `traceId = 9c9b7c0e1a4081a20cbae3955648bdd0` 조건을 적용했을 때 checkout, payment, cart, email, quote, product-catalog 등 여러 서비스의 로그 12건이 함께 조회됐다. 즉, 트레이스와 로그는 별도 인덱스에 저장되지만 공통 식별자를 통해 같은 사건으로 탐색할 수 있다.

![같은 traceId로 조회한 여러 마이크로서비스 로그](/images/opensearch-astronomy-shop-trace-log-fault-lab/13-trace-id-discover-logs.webp)

![order placed 로그 문서에 저장된 주문 속성](/images/opensearch-astronomy-shop-trace-log-fault-lab/14-business-log-document.webp)

## Agent Traces가 비어 있는 이유

일반 Traces에는 데이터가 많았지만 Agent Traces 화면에는 `No agent traces found`가 표시됐다.

![Astronomy Shop 데이터에서 비어 있는 Agent Traces 화면](/images/opensearch-astronomy-shop-trace-log-fault-lab/06-agent-traces-empty.webp)

이것은 수집 장애가 아니다. Agent Traces는 `gen_ai.operation.name` 같은 OpenTelemetry Gen-AI semantic convention 속성을 가진 AI agent span을 대상으로 한다. Astronomy Shop의 주문, 장바구니, 결제 요청은 일반 애플리케이션 트레이스이므로 이 화면에 나타나지 않는 것이 정상이다.

같은 OpenSearch에 저장된 span이라도 목적에 맞는 UI가 다르다.

- 일반 HTTP/gRPC 마이크로서비스 요청: **Traces**
- `invoke_agent`, `execute_tool`, `chat` 같은 Gen-AI 작업: **Agent Traces**

## 결제 장애 주입하기

정상 흐름을 확인한 뒤 `http://localhost:8080/feature`의 flagd UI에서 `paymentFailure`를 `100%`로 설정했다.

![flagd UI에서 paymentFailure를 100%로 설정](/images/opensearch-astronomy-shop-trace-log-fault-lab/07-payment-failure-flag.webp)

이 설정은 결제 서비스가 모든 결제 요청을 실패시키도록 만든다. 선택 직후 화면 변화가 작아 같은 값을 한 번 더 선택했지만, 결과적으로 상태는 동일한 `100%`였다. 같은 Feature Flag 값을 다시 설정하는 것은 추가 장애를 두 번 만드는 동작이 아니라 현재 값을 다시 저장하는 동작이다.

그 상태에서 새 상품을 장바구니에 담고 결제를 시도하자 주문 완료 대신 오류가 발생했다. 이제 관측 데이터만 이용해 원인을 좁혀 본다.

## HTTP 500에서 실제 실패 지점까지 내려가기

실패한 주문의 trace ID는 `f6419d9d42c74c202bf94ed54ce60a40`이었다. 최상위 `POST /api/checkout` span은 HTTP 500과 Error 상태를 보여줬고, 상위 호출 경로에도 오류 표시가 전파되어 있었다.

![결제 장애가 전파된 실패 checkout 트레이스](/images/opensearch-astronomy-shop-trace-log-fault-lab/08-failed-checkout-trace.webp)

여기서 `frontend`의 HTTP 500은 원인이라기보다 사용자에게 드러난 **증상**이다. 트레이스 트리를 아래로 따라가면 cart, product-catalog, currency, shipping 호출은 정상이고 `checkout → payment → grpc.oteldemo.PaymentService/Charge` 구간에 오류 표시가 있었다.

결제 span의 `Errors` 탭에서 실제 예외를 확인했다.

![payment span에 기록된 Invalid token 예외](/images/opensearch-astronomy-shop-trace-log-fault-lab/09-payment-exception.webp)

```text
Payment request failed. Invalid token. app.loyalty.level=gold
```

스택 트레이스에는 `/usr/src/app/charge.js:37:13`도 기록되어 있었다. 이를 통해 다음과 같이 원인을 단계적으로 구분할 수 있었다.

```text
사용자 증상: 주문 요청 실패
HTTP 계층: frontend POST /api/checkout → 500
실패 서비스: payment
실패 작업: PaymentService/Charge
직접 원인: Invalid token 예외
주입 원인: paymentFailure Feature Flag 100%
```

해당 payment span의 Logs 탭에는 `Charge request received.` 이후 `Payment request failed. Invalid token...` 경고가 같은 span과 연결되어 있었다. 트레이스는 실패 위치를 빠르게 좁혀 주고, 예외 이벤트와 로그는 왜 실패했는지를 구체화했다.

![실패한 payment span에 연결된 요청 및 오류 로그](/images/opensearch-astronomy-shop-trace-log-fault-lab/15-payment-span-related-logs.webp)

이것이 분산 추적의 실질적인 장점이다. 프론트엔드 로그만 보면 “checkout 500”에서 멈출 수 있지만, trace context가 서비스 사이에 전파되면 한 화면에서 하위 결제 호출까지 내려갈 수 있다.

## 장애 해제와 복구 확인

flagd UI에서 `paymentFailure`를 다시 `off`로 바꾸고 새 주문을 만들었다. 상품 두 개, 총액 `$402.93`인 주문이 정상적으로 완료됐다.

![paymentFailure 해제 후 정상 완료된 주문](/images/opensearch-astronomy-shop-trace-log-fault-lab/16-recovered-checkout.webp)

복구 후 trace ID는 `c1b904080dbeca9518e732b99ef3fd56`이었다. checkout 요청은 HTTP 200이었고 payment 호출도 OK 상태였다.

![장애 해제 후 정상으로 돌아온 payment 호출](/images/opensearch-astronomy-shop-trace-log-fault-lab/10-recovered-payment-trace.webp)

정상 payment 구간을 자세히 보면 payment 서비스가 flagd의 `ResolveFloat`를 호출한 span도 확인할 수 있다. 즉, Feature Flag는 단순히 UI에만 존재하는 스위치가 아니라 실제 결제 요청 처리 과정에서 평가되고 있었다.

복구 검증에서는 컨테이너가 `Up`인지보다 실제 사용자 동작이 성공하고 새로운 트레이스의 오류 상태가 사라졌는지를 확인해야 한다. 이번에는 주문 완료 화면, checkout HTTP 200, payment span OK를 함께 확인했으므로 장애 해제 후 기능과 텔레메트리 모두 정상으로 돌아왔다고 판단할 수 있었다.

## 이번 실습에서 이해한 관측 데이터의 역할

같은 주문을 세 가지 데이터가 서로 다른 관점에서 설명했다.

| 데이터 | 이번 실습에서 답한 질문 |
| --- | --- |
| 메트릭 | 오류가 언제 늘었고 전체 요청 중 어느 정도였는가? |
| 트레이스 | 실패한 주문은 어떤 서비스를 거쳤고 어느 호출에서 깨졌는가? |
| 로그 | payment 서비스가 남긴 구체적인 오류 메시지는 무엇인가? |

메트릭만으로는 개별 주문을 찾기 어렵고, 로그만으로는 여러 서비스의 호출 관계를 복원하기 어렵다. 트레이스만으로도 오류 위치는 찾을 수 있지만 구체적인 애플리케이션 메시지가 부족할 수 있다. 세 신호가 `service.name`, `traceId`, `spanId` 같은 공통 문맥을 가지고 연결될 때 장애 조사 속도가 빨라진다.

## 마무리

이번 실습에서는 정상 주문을 기준선으로 만든 뒤 Feature Flag로 결제 장애를 주입하고, `frontend`의 HTTP 500에서 `payment` 서비스의 Invalid token 예외까지 추적했다. 특히 `traceId`를 중심으로 트레이스와 여러 서비스의 로그를 연결하면서 분산 환경에서 관측성이 필요한 이유를 직접 확인했다. 다음 단계에서는 이 실패 조건을 메트릭과 알림 규칙으로 연결해, 사용자가 장애를 신고하기 전에 시스템이 먼저 이상을 감지하도록 확장할 수 있다.
