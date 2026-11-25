---
title: "마냑 AWS Cloud Architecture"
date: 2026-10-04
tags: [백엔드]
---

마냑은 사용자가 설정을 넣으면 AI가 스토리를 만들고 그 스토리 속 인물과 채팅하는 서비스다. 이 글은 마냑의 AWS 운영 인프라 구성과 버전별 변화를 소마 최종보고서 시점(2026년 11월 초) 기준으로 정리하고, 그 뒤 11월 중순까지 한 비용 최적화를 덧붙인 기록이다.

## 시스템 구성

사용자 요청은 웹과 Android 클라이언트에서 API 서버로 간다. 웹은 Next.js의 같은 출처 프록시로 인증과 API 요청을 중계하고, Android는 Retrofit 기반 API와 별도 SSE 연결을 쓴다. API 서버(server)는 회원, 스토리, 채팅, 이프, 결제 상태를 관리하고 AI 서버(ai)에 생성 작업을 요청한다. AI 서버는 기능별 프롬프트와 모델 호출을 구성해 구조화된 결과나 스트리밍 응답을 돌려준다.

![Ver.6 구성도. server, ai, notification이 두 AZ에 나뉜 ECS 서비스로 돌고, 2c의 Fargate Spot 태스크에 OTel Collector와 Data Prepper가 있다. 트레이스와 로그는 OpenSearch, 메트릭은 AMP로 가고 OpenSearch UI에서 본다](/images/manyak-aws-cloud-architecture/ver6.png)

클라우드 구성은 AWS 서울 리전에서 동작하고 모든 리소스를 Terraform으로 관리한다. VPC는 두 AZ에 퍼블릭, 앱, DB 서브넷을 하나씩 두고, 크게 여섯 부분으로 나뉜다.

### 엣지와 퍼블릭

Cloudflare DNS가 사용자와 관리자 페이지의 요청을 ALB로 보내고 ALB가 ACM 인증서로 TLS를 종료한다. 관리자 페이지(Vercel)도 같은 ALB 경로로 server의 관리자 API를 부른다. 서비스 사이 내부 API 경로(`/internal/*`)는 ALB에서 404로 막는다. 스토리와 인물 이미지는 S3에 두고 CloudFront로 제공한다.

### 앱

server, ai, notification을 독립 ECS Fargate 서비스로 운영하고, 서비스마다 CPU 사용률에 따라 태스크를 최소 2개에서 최대 4개까지 조정한다. server가 ai를 부르는 동기 호출과 notification이 server를 부르는 내부 호출에는 Cloud Map 사설 DNS를 쓴다.

푸시 알림은 server의 아웃박스에 먼저 기록하고 SQS 표준 큐를 거쳐 notification이 받아 FCM으로 보낸다. 다섯 번 실패한 메시지는 DLQ로 간다.

### 데이터와 네트워크

PostgreSQL은 RDS Multi-AZ로 2c에 대기본을 둔다. Redis는 ElastiCache Primary/Replica 구성으로 두 AZ에 노드를 하나씩 두고 자동 장애 조치를 켰다. Redis는 캐시, 중복 생성 방지, 스트리밍 재연결 정보를 맡고, OpenSearch는 공개 스토리 검색을 맡는다. NAT Gateway는 AZ마다 하나씩 두고 각 AZ의 앱 서브넷은 같은 AZ의 NAT로 외부에 나간다.

### 관측

수집 입구를 OTel Collector 하나로 모았다. Fargate Spot 태스크 하나에 OTel Collector(`:4318`)와 Data Prepper를 함께 두고, server, ai, notification은 모두 Collector로 OTLP를 보낸다. 트레이스와 로그는 Collector에서 Data Prepper를 거쳐 OpenSearch에 쓰고, 메트릭은 Collector가 Amazon Managed Service for Prometheus(AMP)에 remote write한다. 로그와 트레이스 저장소(OpenSearch)와 메트릭 저장소(AMP)를 나누고, 조회는 OpenSearch UI 한 곳에서 한다.

각 태스크의 FireLens(Fluent Bit) 사이드카는 로그를 Collector로 보내고 CloudWatch에도 사본을 남긴다. RDS, Redis, SQS DLQ 경보는 CloudWatch에서 SNS로 알린다. 앱 단에서는 오류를 Sentry, LLM 호출을 Langfuse, 사용자 행동을 Amplitude로 본다.

### 배포

server, ai, notification은 레포가 따로 있고 GitHub Actions가 레포별 OIDC 역할을 받아 ECR에 이미지를 올린 뒤 ECS 서비스를 다시 배포한다. 태스크 정의는 Terraform만 바꾼다. DB 비밀번호가 로테이션되면 EventBridge가 부르는 Lambda가 태스크를 다시 배포해 새 비밀번호를 읽게 한다.

### 외부 연동

외부 서비스는 기능별로 묶었다. 사용자 인증은 Google과 카카오, 결제는 Groble, AI 모델은 DeepSeek, OpenAI, Gemini, Anthropic, 알림은 FCM과 Slack, 관측과 분석은 Sentry, Langfuse, Amplitude다.

## 아키텍처의 발전

시스템 구성은 서비스가 커지는 데 맞춰 단일 EC2에서 컨테이너 서비스 분리, 다중 AZ 이중화, 관측 통합의 순서로 발전했다.

### Ver.1 첫 운영과 레이어 분리

![Ver.1 구성도. 2a 앱 서브넷의 EC2 한 대에서 server와 ai 컨테이너가 돈다](/images/manyak-aws-cloud-architecture/ver1.png)

Ver.1은 첫 운영과 레이어 분리에 중점을 두었다.

VPC를 퍼블릭, 앱, DB 서브넷으로 나누고 앱 서브넷의 EC2 한 대에서 Docker Compose로 server와 ai를 띄웠다. 데이터는 RDS와 ElastiCache에 두고 EC2는 퍼블릭 IP와 SSH 없이 SSM Run Command로 배포했다. 서브넷은 ALB와 RDS가 요구해 두 AZ에 만들었지만 MVP 단계라 리소스는 모두 2a에 하나씩만 두었다.

### Ver.2 컨테이너 기반 운영 전환

![Ver.2 구성도. Fargate 태스크 하나에 FireLens, server, ai 컨테이너가 있다](/images/manyak-aws-cloud-architecture/ver2.png)

Ver.2는 컨테이너 기반 운영 전환에 중점을 두었다.

로그를 Fluent Bit으로 모아 OpenSearch에 보내기로 하면서 목표 구성이던 ECS Fargate로 옮기고 Fluent Bit은 FireLens로 붙였다. 데이터 계층은 그대로 두고 server, ai, FireLens를 태스크 하나에 담았다. 배포는 SSM에서 ECS `force-new-deployment`로 바꾸고, DB 비밀번호 재동기화도 EC2 스크립트에서 Lambda로 옮긴 뒤 EC2를 회수했다.

### Ver.3 서비스 분리

![Ver.3 구성도. 운영 클러스터에 ai, server, notification, Grafana PDC 서비스가 있고 SQS와 DLQ, Cloud Map이 추가됐다](/images/manyak-aws-cloud-architecture/ver3.png)

Ver.3은 서비스 분리에 중점을 두었다.

푸시 알림을 별도 서비스로 떼어 SQS와 DLQ로 server와 비동기로 연결했다. 내부 호출은 Cloud Map 사설 DNS로 하고 공개 ALB에서는 내부 API 경로를 막았다. 이 단계에서 스토리 검색용 OpenSearch 색인(nori), 이미지 생성, FCM, Groble 결제, Gemini 연동도 들어왔다. 서버 메트릭은 Grafana Cloud로 보내고, 운영 DB 통계는 Grafana PDC 서비스로 조회했다.

도면의 ai 독립 서비스는 당시 계획을 함께 그린 것이고, 실제 분리는 Ver.5에서 했다.

### Ver.4 가용성 이중화 계획

![Ver.4 구성도. server, notification, ai 태스크가 2a와 2c에 하나씩 있고 NAT, RDS, Redis도 두 AZ에 나뉘어 있다](/images/manyak-aws-cloud-architecture/ver4.png)

Ver.4는 가용성 이중화 계획에 중점을 두었다.

AZ 하나에 장애가 나도 서비스가 이어지도록 server, ai, notification을 두 AZ에 나눠 두고, 서비스마다 최소 2개, 최대 4개 오토스케일링, RDS Multi-AZ, Redis 복제 그룹, AZ별 NAT를 갖춘 목표 구성을 설계했다.

### Ver.5 분산 추적과 이중화 적용

![Ver.5 구성도. 2c 앱 서브넷에 Data Prepper 태스크가 추가되고 server, ai, notification에서 스팬이 모여 OpenSearch로 간다](/images/manyak-aws-cloud-architecture/ver5.png)

Ver.5는 서비스 간 분산 추적에 중점을 두었고, Ver.4에서 계획한 이중화와 ai 독립 서비스도 이때 실제 운영에 적용했다.

이중화는 Redis 단일 노드를 데이터 이전 없이 복제 그룹의 Primary로 편입하고 2c에 Replica를 붙여 자동 장애 조치를 켜는 방식으로 했다. 강제 장애 조치로 확인한 전환 시간은 RDS 24초, Redis 19초다.

분산 추적은 server, ai, notification이 OpenTelemetry로 스팬을 만들어 OTLP로 보내고 서비스 경계를 W3C `traceparent`로 잇는다. HTTP 호출은 헤더에 싣고 SQS를 거치는 푸시 요청은 메시지 속성에 싣는다. OpenSearch의 Trace Analytics 화면은 트레이스마다 루트 스팬 이름이 채워진 스팬과 서비스 사이 호출 관계를 따로 요구하는데 이 둘은 Data Prepper가 만든다. 그래서 로그 수집기와 별도로 Data Prepper를 두고 로그와 같은 OpenSearch 도메인에 쓴다.

수집기는 관리형 OpenSearch Ingestion 대신 Fargate Spot 태스크 하나로 직접 운영한다. 관리형은 최소 용량만 켜 둬도 서울 리전에서 월 약 194달러다. 앱은 스팬을 비동기로 모아 보내므로 수집기가 멈춰도 요청 처리에는 영향이 없고 그동안의 트레이스만 누락된다. Data Prepper는 상태를 유지하는 처리기라 한 트레이스의 스팬을 한 인스턴스에 모아야 하며 태스크를 늘리려면 인스턴스끼리 스팬을 넘겨주는 설정이 함께 필요하다. 그래서 하나로 두었다.

채팅 한 턴을 추적하면 10.8초 중 ai가 65%를 차지하고 스트리밍이 끝난 뒤 순서대로 이어지는 판정 호출이 2.9초다. 서버 쪽 처리는 쿼리와 큐 대기를 합쳐도 수십 밀리초다.

### Ver.6 관측 통합과 운영 도구 정리

![Ver.6 구성도](/images/manyak-aws-cloud-architecture/ver6.png)

Ver.6은 관측 통합과 운영 도구 정리에 중점을 두었다.

Ver.5까지는 트레이스는 Data Prepper, 로그는 FireLens, 메트릭은 Grafana Cloud로 경로가 셋이었다. Ver.6에서는 OTel Collector로 수집 입구를 하나로 모으고, 트레이스와 로그는 OpenSearch에, 메트릭은 AMP에 나눠 저장해 OpenSearch UI에서 함께 본다. 서버 메트릭만 보내던 것을 ai와 notification까지 넓혔다. 이 과정에서 Grafana Cloud와 PDC 서비스를 없앴고, 관리자 페이지의 인프라 지표는 server가 ECS, ALB, RDS, Redis, OpenSearch에서 직접 읽어 보여 준다.

## 비용 최적화

Ver.6 뒤에는 운영비를 줄였다. 11월 초 AWS 비용은 하루 평균 약 18.75달러, 한 달로 치면 약 560달러였다.

### 1~3차: 사양 축소, Fargate Spot, Graviton

먼저 이중화는 그대로 두고 남는 자원을 줄였다. 7일간 CPU와 메모리 사용량을 근거로 과하게 잡힌 태스크 사양을 낮췄다. server는 1 vCPU에서 0.5 vCPU로, ai는 0.5 vCPU, 1 GiB에서 0.25 vCPU, 512 MiB로 줄였다. notification은 JVM 힙 상한 때문에 메모리를 줄이면 OOM이 날 수 있어 사양은 두고 Fargate Spot으로만 옮겼다. server와 ai는 온디맨드 태스크 하나를 남기고 나머지를 Spot으로 띄운다.

이어서 앱 태스크를 ARM64(Graviton)로 바꾸고 RDS와 Redis 인스턴스도 t4g로 옮겼다. 반영 뒤 11월 11~15일 하루 평균은 약 13.30달러로, 한 달 기준 약 560달러에서 약 400달러로 29% 줄었다.

### 4차: 이중화 정리와 NAT 제거

트래픽에 비해 이중화 비용이 컸기 때문에 11월 17일 새벽 가용성을 낮추는 쪽을 택했다. RDS를 단일 AZ로, Redis를 1노드로 줄이고, 세 앱 서비스의 오토스케일링 최소 수를 2개에서 1개로 낮췄다. 모든 태스크를 RDS가 있는 2a의 퍼블릭 서브넷으로 옮겨 공인 IP로 외부에 나가게 하고 NAT Gateway 두 개를 지웠다. 인바운드는 보안 그룹이 ALB와 내부 보안 그룹에서 오는 요청만 받는다. AZ 하나의 장애에 버티는 구성은 이 단계에서 내려놓았다.
