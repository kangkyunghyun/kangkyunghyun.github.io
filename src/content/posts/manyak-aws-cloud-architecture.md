---
title: "마냑 AWS Cloud Architecture"
date: 2026-10-04
tags: [백엔드]
---

마냑은 사용자가 설정을 넣으면 AI가 스토리를 만들고 그 스토리 속 인물과 채팅하는 서비스다. 이 글은 마냑의 AWS 운영 인프라 구성과 버전별 변화를 정리한 기록이다.

## 시스템 구성

![현재 구성도. server, notification, ai, PDC 태스크가 2a와 2c에 하나씩 있고 2a에 Data Prepper 태스크가 있다. NAT, RDS, Redis도 두 AZ에 나뉘어 있다](/images/manyak-aws-cloud-architecture/ver5.png)

마냑 운영 인프라는 AWS 서울 리전에서 동작하고 모든 리소스를 Terraform으로 관리한다. VPC는 두 AZ에 퍼블릭, 앱, DB 서브넷을 하나씩 둔다.

### 엣지

Cloudflare DNS가 API 요청을 ALB로 보내고 ALB가 ACM 인증서로 TLS를 종료한다. 서비스 사이 내부 API 경로(`/internal/*`)는 ALB에서 404로 막는다. 스토리와 인물 이미지는 S3에 두고 CloudFront로 제공한다.

### 퍼블릭 레이어

ALB와 NAT Gateway가 있다. NAT는 AZ마다 하나씩 두고 각 AZ의 앱 서브넷은 같은 AZ의 NAT를 거쳐 외부로 나간다.

### 앱 레이어

ECS Fargate 서비스 네 개가 두 AZ에 태스크를 하나씩 띄운다. server는 API 서버, ai는 스토리 생성과 채팅을 맡는 AI 서버, notification은 푸시 알림 서버, Grafana PDC는 운영 DB 통계를 Grafana Cloud로 조회하는 에이전트다. server, ai, notification은 CPU 사용률에 따라 태스크를 2개에서 4개까지 조정한다. 트레이스를 모으는 Data Prepper는 Fargate Spot 태스크 하나로 띄운다.

server가 ai를 부르는 동기 호출과 notification이 server를 부르는 내부 호출에는 Cloud Map 사설 DNS를 쓴다. server가 보내는 푸시 요청은 SQS 표준 큐를 거쳐 notification이 받고 다섯 번 실패한 메시지는 DLQ로 간다.

### 데이터 레이어

PostgreSQL은 RDS Multi-AZ로 2c에 대기본을 둔다. Redis는 ElastiCache 복제 그룹으로 두 AZ에 노드를 하나씩 두고 자동 장애 조치를 켰다. 앱은 Redis의 Primary endpoint를 써서 장애 조치 뒤에도 새 Primary로 다시 연결한다.

### 관측과 운영

각 태스크의 FireLens(Fluent Bit) 사이드카가 로그를 OpenSearch와 CloudWatch로 보낸다. server, ai, notification은 스팬을 OTLP로 Data Prepper에 보내고 Data Prepper가 트레이스와 서비스 맵을 같은 OpenSearch에 쓴다. 메트릭은 OTLP로 Grafana Cloud에 보내고 오류는 Sentry, LLM 호출은 Langfuse로 본다. RDS, Redis, SQS DLQ 경보는 CloudWatch에서 SNS로 알린다. DB 비밀번호가 로테이션되면 EventBridge가 5분마다 부르는 Lambda가 태스크를 다시 배포해 새 비밀번호를 읽게 한다.

### 배포

server, ai, notification은 레포가 따로 있고 GitHub Actions가 OIDC로 각자의 역할을 받아 ECR에 이미지를 올린 뒤 ECS 서비스를 다시 배포한다. 태스크 정의는 Terraform만 바꾼다.

## 아키텍처의 발전

### Ver.1 첫 운영과 레이어 분리

![Ver.1 구성도. 2a 앱 서브넷의 EC2 한 대에서 server와 ai 컨테이너가 돈다](/images/manyak-aws-cloud-architecture/ver1.png)

Ver.1은 첫 운영과 레이어 분리에 중점을 두었다.

VPC를 퍼블릭, 앱, DB 서브넷으로 나누고 앱 서브넷의 EC2 한 대에서 Docker Compose로 server와 ai를 띄웠다. 데이터는 RDS와 ElastiCache에 두고 EC2는 퍼블릭 IP와 SSH 없이 SSM Run Command로 배포했다. 서브넷은 ALB와 RDS가 요구해 두 AZ에 만들었지만 MVP 단계라 리소스는 모두 2a에 하나씩만 두었다.

### Ver.2 컨테이너 기반 운영 전환

![Ver.2 구성도. Fargate 태스크 하나에 FireLens, server, ai 컨테이너가 있다](/images/manyak-aws-cloud-architecture/ver2.png)

Ver.2는 컨테이너 기반 운영 전환에 중점을 두었다.

로그를 Fluent Bit으로 모아 OpenSearch에 보내기로 하면서 목표 구성이던 ECS Fargate로 옮기고 Fluent Bit은 FireLens로 붙였다. 데이터 계층은 그대로 두고 server, ai, FireLens를 태스크 하나에 담았다. 배포는 SSM에서 ECS `force-new-deployment`로 바꾸고 DB 비밀번호 재동기화도 EC2 스크립트에서 Lambda로 옮겼다.

### Ver.3 서비스 분리

![Ver.3 구성도. 운영 클러스터에 ai, server, notification, Grafana PDC 서비스가 있고 SQS와 DLQ, Cloud Map이 추가됐다](/images/manyak-aws-cloud-architecture/ver3.png)

Ver.3은 서비스 분리에 중점을 두었다.

푸시 알림을 별도 서비스로 떼어 SQS와 DLQ로 server와 비동기로 연결했다. 내부 호출은 Cloud Map 사설 DNS로 하고 공개 ALB에서는 내부 API 경로를 막았다. ai도 server 태스크에서 별도 서비스로 분리해 server가 Cloud Map 주소로 동기 호출한다. 서비스마다 따로 늘릴 수 있다.

### Ver.4 가용성 이중화

![Ver.4 구성도. server, notification, ai, PDC 태스크가 2a와 2c에 하나씩 있고 NAT, RDS, Redis도 두 AZ에 나뉘어 있다](/images/manyak-aws-cloud-architecture/ver4.png)

Ver.4는 가용성 이중화에 중점을 두었다.

2a AZ 하나에 장애가 나도 서비스가 이어지도록 NAT를 AZ마다 두고 RDS를 Multi-AZ로 바꿨다. ECS 서비스는 두 AZ에 태스크를 하나씩 띄우고 CPU 사용률로 오토스케일링한다. Redis는 단일 노드를 데이터 이전 없이 복제 그룹의 Primary로 편입하고 2c에 Replica를 붙여 자동 장애 조치를 켰다. 강제 장애 조치로 확인한 전환 시간은 RDS 24초, Redis 19초다.

### Ver.5 분산 추적

![Ver.5 구성도. 2a 앱 서브넷에 Data Prepper 태스크가 추가되고 server, ai, notification에서 스팬이 모여 OpenSearch로 간다](/images/manyak-aws-cloud-architecture/ver5.png)

Ver.5는 분산 추적에 중점을 두었다.

server, ai, notification이 OpenTelemetry로 스팬을 만들어 OTLP로 보내고 서비스 경계는 W3C `traceparent`로 잇는다. HTTP 호출은 헤더에 싣고 SQS를 거치는 푸시 요청은 메시지 속성에 싣는다. OpenSearch의 Trace Analytics 화면은 트레이스마다 루트 스팬 이름이 채워진 스팬과 서비스 사이 호출 관계를 따로 요구하는데 이 둘은 Data Prepper가 만든다. 그래서 로그 수집기와 별도로 Data Prepper를 두고 로그와 같은 OpenSearch 도메인에 쓴다.

수집기는 관리형 OpenSearch Ingestion 대신 Fargate Spot 태스크 하나로 직접 운영한다. 관리형은 최소 용량만 켜 둬도 서울 리전에서 월 약 194달러다. 앱은 스팬을 비동기로 모아 보내므로 수집기가 멈춰도 요청 처리에는 영향이 없고 그동안의 트레이스만 누락된다. Data Prepper는 상태를 유지하는 처리기라 한 트레이스의 스팬을 한 인스턴스에 모아야 하며 태스크를 늘리려면 인스턴스끼리 스팬을 넘겨주는 설정이 함께 필요하다. 지금은 하나로 두었다.

채팅 한 턴을 추적하면 10.8초 중 ai가 65%를 차지하고 스트리밍이 끝난 뒤 순서대로 이어지는 판정 호출이 2.9초다. 서버 쪽 처리는 쿼리와 큐 대기를 합쳐도 수십 밀리초다.
