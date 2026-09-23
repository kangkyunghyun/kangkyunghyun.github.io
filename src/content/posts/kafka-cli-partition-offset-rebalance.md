---
title: "로컬 Kafka CLI로 파티션, 오프셋, 리밸런스 확인하기"
date: "2026-09-23T01:00:00Z"
tags: [백엔드]
---

마냑은 사용자가 설정을 넣으면 AI가 스토리를 만들고 그 스토리 속 인물과 채팅하는 서비스다. [앞 글](/posts/notification-service-sync-extraction)에서는 스토리 완성 푸시를 동기 HTTP로 알림 서비스에 넘겼고 알림 서비스가 꺼져 있거나 실행기 큐가 차면 그 푸시는 버려진다는 한계를 남겼다.

이 한계는 메시지 큐로 메울 계획이다. 로컬은 Kafka를 쓰고 dev와 운영은 SQS를 쓴다. 아웃박스와 어댑터 코드를 쓰기 전에 용어부터 정리하고 로컬 Compose에 Kafka를 올려 CLI만으로 파티션과 오프셋 그리고 리밸런스를 직접 확인했다. 결론부터 쓰면 키와 오프셋은 예상대로 움직였고 리밸런스는 예상과 달랐다.

이 글에서 사용한 환경은 `apache/kafka:4.3.1` 이미지의 KRaft 단일 노드와 Docker Compose, OrbStack이다.

## 메시지 큐 용어

실습 전에 스토리 완성 푸시를 예로 들어 용어부터 정리했다. 지금은 서버가 알림 서비스에 HTTP로 직접 요청하므로 알림 서비스가 바로 그 순간 살아 있어야 한다. 메시지 큐는 둘 사이에 브로커를 두어 둘이 동시에 살아 있지 않아도 메시지가 전달되게 한다.

| 용어 | 뜻 | 마냑에 대응하면 |
| --- | --- | --- |
| 브로커 | 메시지를 받아 디스크에 보관하고 다른 프로그램이 꺼내 가게 해 주는 서버 | 로컬은 Kafka, dev와 운영은 SQS |
| 토픽 | 브로커 안에 이름을 붙인 메시지 목록 | `push.requested` |
| 프로듀서 | 브로커에 메시지를 쓰는 쪽 | 서버의 릴레이 |
| 컨슈머 | 메시지를 꺼내 처리하는 쪽 | `manyak-notification` |
| 컨슈머 그룹 | 같은 일을 하는 컨슈머 묶음. 그룹 안에서는 메시지를 나눠 갖고 그룹이 다르면 각자 전부 받는다 | `notification` |
| 오프셋 | 그룹이 파티션을 어디까지 읽었는지 적은 번호. 컨슈머가 아니라 브로커가 보관한다 | 알림 서비스가 재시작해도 이어서 보내는 근거 |
| 파티션 | 토픽을 여러 줄로 나눈 것. 그룹은 파티션 단위로 일을 나눈다 | `push.requested`에 3개 |
| 파티션 키 | 메시지가 들어갈 파티션을 정하는 값. 같은 키는 항상 같은 파티션으로 간다 | 회원 ID |
| 리밸런스 | 그룹 멤버가 바뀔 때 파티션 담당을 다시 나누는 과정 | 알림 서비스 태스크가 늘거나 줄 때 |

큐가 모든 틈을 막지는 않는다. 컨슈머는 처리를 끝내고 완료를 기록하기 직전에 죽을 수 있고 그러면 브로커는 같은 메시지를 다시 준다. 유실 대신 중복을 고르는 이 방식을 최소 한 번 전달(at-least-once)이라고 한다. 그래서 컨슈머는 같은 메시지를 두 번 받아도 결과가 같도록 멱등하게 만든다.

서버 쪽에도 틈이 있다. 스토리 완성을 DB에 커밋한 뒤 토픽에 쓰기 전에 서버가 죽으면 푸시가 사라진다. 아웃박스는 보낼 메시지를 같은 DB 트랜잭션 안에서 테이블에 적어 두고 릴레이가 나중에 그 행을 토픽으로 옮기는 방식이다. 위 표에서 프로듀서가 업무 코드가 아니라 릴레이인 이유다.

## Compose에 KRaft 단일 브로커 올리기

KRaft는 예전에 Kafka가 따로 요구하던 ZooKeeper 없이 브로커가 컨트롤러 역할까지 겸하는 방식이다. 로컬에서는 노드 하나로 충분하다.

설정에서 가장 신경 쓴 부분은 리스너다. Kafka는 클라이언트가 처음 접속하면 "다음부터는 이 주소로 오라"는 advertised 주소를 돌려준다. Compose 안의 컨테이너는 `kafka:19092`로 접속하고 맥에서 쓰는 CLI나 `bootRun`은 `localhost:9092`로 접속하므로 주소를 둘로 나눴다. 하나로 합치면 한쪽은 첫 연결만 되고 메시지가 오가지 않는다.

```yaml
      KAFKA_LISTENERS: INTERNAL://:19092,EXTERNAL://:9092,CONTROLLER://:9093
      KAFKA_ADVERTISED_LISTENERS: INTERNAL://kafka:19092,EXTERNAL://localhost:${MANYAK_KAFKA_PORT:-9092}
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT,CONTROLLER:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: INTERNAL
```

토픽은 일회성 컨테이너 `kafka-init`이 만든다. 발송 요청과 재시도 그리고 DLQ 토픽 세 개를 파티션 3개로 만들고 끝난다. `--if-not-exists`라 다시 띄워도 안전하다. `$$topic`은 Compose가 `$`를 변수로 해석하지 않게 한 이스케이프다.

```yaml
    command:
      - |
        set -e
        for topic in push.requested push.requested.retry push.requested.dlq; do
          /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:19092 \
            --create --if-not-exists --topic "$$topic" --partitions 3 --replication-factor 1
        done
        /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:19092 --list
```

토픽 자동 생성은 `KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"`로 껐다. 켜 두면 토픽 이름에 오타가 난 메시지가 에러 없이 새 토픽에 쌓인다.

## 같은 키는 같은 파티션에 들어간다

실습에 쓴 `kafka-topics.sh` 같은 CLI는 `apache/kafka` 이미지의 `/opt/kafka/bin/`에 들어 있다. 맥에는 설치하지 않았으므로 `docker exec manyak-kafka`로 컨테이너 안에서 실행하고 컨테이너 자신의 내부 리스너인 `localhost:19092`로 접속한다. 맥에서 쓰는 `localhost:9092`는 나중에 서버를 `bootRun`으로 띄울 때 쓴다.

토픽 상태부터 봤다.

```bash
docker exec manyak-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:19092 --describe --topic push.requested
```

```text
Topic: push.requested   TopicId: hW7OsDNeRNehrhvgilLyIw PartitionCount: 3       ReplicationFactor: 1    Configs: min.insync.replicas=1
        Topic: push.requested   Partition: 0    Leader: 1       Replicas: 1     Isr: 1  Elr:    LastKnownElr:
        Topic: push.requested   Partition: 1    Leader: 1       Replicas: 1     Isr: 1  Elr:    LastKnownElr:
        Topic: push.requested   Partition: 2    Leader: 1       Replicas: 1     Isr: 1  Elr:    LastKnownElr:
```

`Leader`는 그 파티션의 읽기와 쓰기를 맡은 브로커 번호다. 브로커가 하나뿐이라 세 파티션 모두 1번이 맡고 복사본도 없다.

회원 ID 역할을 하는 키를 붙여 메시지 다섯 건을 넣었다. `:` 앞이 키다.

```bash
docker exec -i manyak-kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:19092 --topic push.requested --reader-property parse.key=true --reader-property key.separator=: <<'EOF'
user-A:스토리1 완성
user-B:스토리2 완성
user-A:스토리3 완성
user-C:스토리4 완성
user-A:스토리5 완성
EOF
```

user-A의 세 건은 같은 파티션에 들어갈 거라고 예상했다. 파티션 번호를 함께 찍어 읽었다.

```bash
docker exec manyak-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:19092 --topic push.requested --from-beginning --timeout-ms 10000 --formatter-property print.key=true --formatter-property print.partition=true
```

```text
Partition:0     user-A  스토리1 완성
Partition:0     user-B  스토리2 완성
Partition:0     user-A  스토리3 완성
Partition:0     user-A  스토리5 완성
Partition:2     user-C  스토리4 완성
[2026-09-23 05:27:42,017] ERROR Error processing message, terminating consumer process:  (org.apache.kafka.tools.consumer.ConsoleConsumer)
org.apache.kafka.common.errors.TimeoutException
Processed a total of 5 messages
```

마지막 `TimeoutException`은 10초 동안 새 메시지가 없어 종료했다는 뜻이다.

예상대로 user-A 세 건은 모두 파티션 0에 들어갔다. 키의 해시로 파티션을 고르기 때문이다. 결과에서 두 가지를 더 볼 수 있었다.

user-B도 파티션 0에 들어갔다. 규칙은 "같은 키는 같은 파티션"이지 "파티션 하나에 키 하나"가 아니다. 파티션은 3개인데 회원은 훨씬 많으니 키가 섞이는 게 정상이다. 파티션 1이 비어 있는 것도 키가 세 개뿐이라 고르게 나뉘지 않았기 때문이다.

스토리4는 네 번째로 넣었는데 맨 마지막에 나왔다. 컨슈머가 파티션 0을 다 읽고 나서 파티션 2를 읽었다. 순서는 파티션 안에서만 지켜지고 파티션끼리는 섞인다. 한 회원의 알림 순서를 지키려면 회원 ID를 키로 줘야 하는 이유가 여기 있다.

## 컨슈머 그룹의 책갈피와 LAG

방금은 `--group` 없이 읽었다. 그러면 CLI가 매번 임시 그룹을 만들어 읽은 위치가 남지 않는다. 이번에는 알림 서비스가 쓸 그룹 이름 `notification`을 붙였다.

```bash
docker exec manyak-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:19092 --topic push.requested --group notification --from-beginning --timeout-ms 10000 --formatter-property print.key=true --formatter-property print.partition=true
```

`notification` 그룹은 이 명령 전에는 없었다. Kafka에는 그룹을 만드는 단계가 따로 없고 컨슈머가 처음 그 이름으로 붙을 때 그룹이 생긴다. 새 그룹이라 오프셋도 없어서 첫 실행은 `--from-beginning`대로 다섯 건을 모두 읽었다.

```text
Partition:0     user-A  스토리1 완성
Partition:0     user-B  스토리2 완성
Partition:0     user-A  스토리3 완성
Partition:0     user-A  스토리5 완성
Partition:2     user-C  스토리4 완성
Processed a total of 5 messages
```

같은 명령을 한 번 더 실행하자 이번에는 `Processed a total of 0 messages`가 나왔다. `--from-beginning`을 그대로 붙였는데도 처음부터 읽지 않았다. 이 옵션은 그룹에 오프셋이 아직 없을 때만 적용되고 오프셋이 생긴 뒤에는 그룹이 항상 이어서 읽는다. 알림 서비스가 재시작할 때마다 처음부터 다시 보내면 안 되니 맞는 동작이다.

그룹 상태를 보면 오프셋이 보인다.

```bash
docker exec manyak-kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:19092 --describe --group notification
```

```text
Consumer group 'notification' has no active members.

GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
notification    push.requested  0          4               4               0
notification    push.requested  1          0               0               0
notification    push.requested  2          1               1               0
```

오른쪽 열 셋은 지면상 생략했다. `CURRENT-OFFSET`은 그룹이 다음에 읽을 번호이고 `LOG-END-OFFSET`은 파티션에 다음 메시지가 쓰일 번호다. 파티션 0에는 메시지가 네 건 있어 둘 다 4다. `LAG`는 `LOG-END-OFFSET - CURRENT-OFFSET`이라 아직 안 읽은 메시지 수가 된다.

`no active members`도 눈여겨볼 만했다. 콘솔 컨슈머가 이미 종료돼 그룹에 붙은 컨슈머가 없는데도 오프셋은 브로커에 남아 있다.

이 상태가 알림 서비스가 꺼져 있는 상황과 같다. 여기서 스토리 두 편이 완성됐다고 치고 메시지 두 건을 넣었다.

```bash
docker exec -i manyak-kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:19092 --topic push.requested --reader-property parse.key=true --reader-property key.separator=: <<'EOF'
user-A:스토리6 완성
user-C:스토리7 완성
EOF
```

```text
GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
notification    push.requested  0          4               5               1
notification    push.requested  1          0               0               0
notification    push.requested  2          1               2               1
```

읽는 쪽이 없으니 `LOG-END-OFFSET`만 늘고 그만큼 LAG가 생겼다. 그룹 전체로는 두 건이 밀렸다. 같은 그룹으로 다시 읽었다.

```text
Partition:0     user-A  스토리6 완성
Partition:2     user-C  스토리7 완성
```

밀린 두 건만 나왔고 앞에서 읽은 다섯 건은 다시 나오지 않았다. 알림 서비스를 꺼 둔 동안 쌓인 발송 요청을 켜자마자 이어서 처리하는 장면을 CLI로 먼저 봤다. 운영에서 LAG는 소비가 밀리는지 멈췄는지를 알려 주는 첫 번째 지표가 된다.

## 파티션 3개에 컨슈머 4대를 붙이면

처음에는 같은 그룹의 컨슈머가 파티션보다 많으면 한 파티션을 여러 컨슈머가 함께 읽는다고 생각했다. 확인하려고 터미널 네 개에서 같은 그룹으로 컨슈머를 띄웠다.

```bash
docker exec -it manyak-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:19092 --topic push.requested --group notification --formatter-property print.key=true --formatter-property print.partition=true
```

다섯 번째 터미널에서 누가 어느 파티션을 맡았는지 봤다. 컨슈머 ID는 앞 8자리만 남기고 열도 줄였다.

```bash
docker exec manyak-kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:19092 --describe --group notification --members --verbose
```

```text
CONSUMER-ID        #PARTITIONS  CURRENT-ASSIGNMENT
...-3fe2ac8e       1            push.requested:0
...-8e829852       1            push.requested:1
...-cd38077f       0            -
...-b6e2cd77       1            push.requested:2
```

생각과 달랐다. 같은 그룹 안에서 파티션 하나는 한 번에 한 컨슈머만 맡고 남는 `cd38077f`는 아무것도 받지 않는다. 한 파티션을 둘이 읽으면 같은 알림이 두 번 나가기 때문이다. 그래서 파티션 수가 동시에 일할 수 있는 컨슈머 수의 상한이 된다.

다음으로 파티션 0 담당을 끄면 대기하던 `cd38077f`가 파티션 0만 넘겨받을 거라고 예상했다. 어느 터미널이 파티션 0 담당인지는 ID로 알 수 없어서 user-A 메시지를 하나 보내 찍히는 창을 찾았고 그 창을 `Ctrl-C`로 껐다.

```text
CONSUMER-ID        #PARTITIONS  CURRENT-ASSIGNMENT
...-8e829852       1            push.requested:0
...-cd38077f       1            push.requested:2
...-b6e2cd77       1            push.requested:1
```

대기하던 컨슈머가 일을 받긴 했지만 받은 건 파티션 2였다. 살아 있던 두 컨슈머도 자리를 옮겼다. `8e829852`는 1에서 0으로 옮겼고 `b6e2cd77`은 2에서 1로 옮겼다. 한 대가 빠지자 브로커가 파티션 전체를 다시 나눈 것이다. 이 과정을 리밸런스라고 한다. 콘솔 컨슈머의 기본 배정 방식은 매번 멤버 순서대로 파티션을 다시 늘어놓아서 한 대만 빠져도 모두가 움직인다.

user-A 메시지를 하나 더 보내자 꺼진 창이 아니라 이제 파티션 0을 맡은 다른 창에 찍혔다. 키가 가는 파티션은 그대로이고 그 파티션을 맡은 컨슈머만 바뀌었다.

리밸런스가 일어나는 동안에는 그룹 전체가 파티션을 내려놓고 새로 받는다. 넘겨받은 컨슈머는 그룹 오프셋부터 읽으므로 이전 담당자가 처리는 했지만 오프셋을 아직 커밋하지 못한 메시지를 다시 처리한다. 알림 서비스 소비자가 같은 메시지를 두 번 받아도 결과가 한 번 받은 것과 같도록 멱등하게 만들어야 하는 이유 중 하나다.

실습 내내 출력 맨 위에 KIP-848 안내가 찍혔다. 필요한 파티션만 옮기는 새 리밸런스 프로토콜이 운영 수준으로 준비됐다는 안내다. 알림 서비스 컨슈머를 설정할 때 이 프로토콜을 쓸지 정하려고 한다.

## 운영의 SQS와 다른 점

로컬 Kafka에서 본 성질이 운영 SQS에서 그대로 성립하지는 않는다. 운영에서 쓸 SQS 표준 큐에는 파티션도 순서 보장도 없고 컨슈머 그룹 대신 누가 메시지를 가져가면 잠시 다른 컨슈머에게 숨기는 방식으로 중복 소비를 막는다. 로컬에서 키 덕분에 순서대로 처리되던 코드가 운영에서는 순서가 뒤섞인 메시지를 받는다. 소비자 로직이 순서에 기대지 않게 만들어야 한다.

복제도 다르다. 로컬은 브로커가 하나라 `Replicas: 1`이고 그 브로커의 디스크가 유일한 사본이다. 운영 Kafka라면 파티션 복사본을 다른 브로커에 두고 리더가 죽으면 복사본이 이어받는다. SQS에서는 이 부분을 AWS가 관리한다.

## 정리

CLI만으로도 브로커가 메시지를 어떻게 보관하고 나눠 주는지 대부분 볼 수 있었다. 키는 파티션을 정하고 그룹은 파티션을 컨슈머에게 나눠 주며 오프셋은 브로커에 그룹 단위로 남는다. 그래서 컨슈머가 바뀌거나 꺼졌다 켜져도 밀린 메시지부터 이어서 처리한다. 예상이 틀린 곳은 리밸런스 하나였고 거기서 중복 소비가 생기는 경로를 하나 더 알게 됐다.

아직 서버는 이 토픽에 아무것도 보내지 않는다. 다음에는 스토리 완성과 같은 트랜잭션에 발송 요청을 아웃박스 테이블로 남기고 릴레이가 그 행을 `push.requested`로 옮기게 만든다.
