---
title: "Spring RestClient로 알림 서비스 동기 분리하기"
date: "2026-09-22T02:00:00Z"
tags: [백엔드]
---

마냑은 사용자가 설정을 넣으면 AI가 스토리를 만들고 그 스토리 속 인물과 채팅하는 서비스다. [앞 글](/posts/notification-service-internal-api-boundary)에서는 흩어진 발송 자격 판정을 서버 내부 API 하나로 모았다.

이번에는 그 경계를 기준으로 FCM 발송 실행을 새 프로세스로 옮겼다. 메시지 큐부터 붙이지 않고 동기 HTTP로 두 컨테이너 사이의 경계를 먼저 확인했다. 프로세스 분리와 전달 방식을 한꺼번에 바꾸면 어느 쪽에서 문제가 생겼는지 구분하기 어렵기 때문이다.

## 동기 HTTP로 발송 실행 먼저 옮기기

Kotlin 2.2.21과 Spring Boot 4.0.6 그리고 Java 21로 새 공개 저장소 `manyak-notification`을 만들었다.

알림 서비스가 제공하는 API는 `POST /internal/notifications` 하나다. 요청을 받으면 발송 자격을 서버에 확인한 뒤 FCM을 호출한다. 회원 상태와 수신 동의 판정 그리고 기기 토큰 보관은 계속 기존 서버가 맡는다. 알림 서비스는 회원 테이블을 모른다.

서버에서는 `NotificationClient`가 Spring `RestClient`로 알림 서비스를 동기 호출한다. 연결 제한 시간은 5초이고 읽기 제한 시간은 10초다.

## 설정 스위치로 발송 경로 나누기

새 서비스를 배포하면서 기존 발송기를 바로 지우지 않았다. 서버 설정을 `manyak.push.mode=local|remote`로 나누고 기본값은 `local`로 뒀다. 배포만으로는 발송 경로가 바뀌지 않는다. 환경변수를 `remote`로 바꿔야 `NotificationClient`가 알림 서비스를 호출하고 문제가 생기면 같은 값을 `local`로 되돌린다.

기존 발송기에는 `@Deprecated`만 붙였다. 컴파일 경고가 남는 호출부가 다음에 옮길 목록이 된다. `remote` 경로가 운영에서 한 릴리스 이상 버틴 뒤 삭제할 예정이다.

알림 서비스 주소가 비어 있으면 `remote` 모드에서도 발송을 건너뛴다. 주소를 먼저 주입하고 모드를 나중에 바꾸므로 설정 순서가 어긋나도 기존 요청까지 실패하지 않는다.

## 두 컨테이너 사이 왕복 확인하기

서버와 알림 서비스 컨테이너를 따로 띄운 뒤 다섯 경로를 왕복시켰다.

| 시나리오 | 결과 |
| --- | --- |
| 동의 있고 토큰 있음 | `SKIPPED / FCM_DISABLED` |
| 서비스 알림 거부 | `SKIPPED / SERVICE_PUSH_DISABLED` |
| 없는 회원 | `SKIPPED / USER_NOT_FOUND` |
| 광고 알림이고 동의 없음 | `SKIPPED / MARKETING_NOT_AGREED` |
| 이미 만료된 요청 | `EXPIRED` |

다섯 결과가 모두 예상과 같았다. 이유 문구는 서버의 자격 조회 API가 만들기 때문에 알림 서비스에서 서버까지 왕복했다는 것도 확인됐다. `FCM_DISABLED`는 로컬에 Firebase 키가 없어서 나온 정상 결과이며 자격 조회는 통과했다는 뜻이다.

브랜치 코드로 서버를 띄우고 알림 서비스는 컨테이너로 둔 채 실제 API에서 스토리를 완성했다. AI는 스텁이라 실제 호출이 없다. 두 서비스 로그에 같은 `request_id`가 남았다.

```text
manyak-server        request_id=req_trace_last_1790049101  session_id=sess_last  thread_name=push-1
                     알림 서비스에 발송을 요청했습니다.
                     (type=STORY_COMPLETED, outcome=SKIPPED, reason=FCM_DISABLED)
manyak-notification  request_id=req_trace_last_1790049101  session_id=sess_last
                     Request correlation initialized
```

`thread_name=push-1`은 푸시 전용 실행기의 워커다. 요청 스레드를 떠난 뒤에도 요청 번호가 남았고 알림 서비스까지 전달됐다. 서버 테스트 1,686건과 알림 서비스 테스트 38건도 통과했다.

## 프로세스를 가르며 드러난 스레드 경계

프로세스를 가르자 같은 프로세스 안에서는 드러나지 않던 두 가지 가정이 문제가 됐다.

하나는 요청 번호다. 두 서비스의 로그를 잇는 `request_id`는 MDC(Mapped Diagnostic Context)에 들어 있다. MDC는 SLF4J가 제공하는 로그용 키-값 저장소이고 여기에 넣어 둔 값은 같은 스레드에서 찍히는 모든 로그 줄에 자동으로 따라붙는다. 저장소는 스레드마다 따로다. 요청 번호를 넣는 쪽은 요청 스레드에서 도는 필터이고 `NotificationClient`는 호출 직전에 MDC에서 요청 번호를 꺼내 헤더에 싣는다. 기존 발송은 `@Async`로 다른 스레드에 넘겼기 때문에 워커 스레드의 MDC가 비어 있었고 헤더도 빈 채로 나갔다. 헤더가 없으면 알림 서비스가 요청 번호를 새로 발급하므로 두 서비스의 로그가 이어지지 않는다.

다른 하나는 예외가 나는 위치다. `@Async`는 프록시가 작업을 제출하므로 큐가 찼을 때의 `TaskRejectedException`이 메서드 본문 밖에서 발생한다. 리스너는 `@TransactionalEventListener(AFTER_COMMIT)`라 스토리는 이미 저장됐지만 예외가 호출부로 전파되면 HTTP 응답만 500이 된다.

둘 다 `@Async`를 떼고 실행기에 직접 제출해서 해결했다. 제출이 요청 스레드에서 일어나므로 MDC가 살아 있고 거부도 그 자리에서 잡힌다.

```kotlin
try {
    pushExecutor.execute { dispatch(event) }
} catch (ex: TaskRejectedException) {
    log.warn("푸시 실행기 포화로 스토리 완성 푸시를 버립니다. ...")
}
```

비동기로 넘기는 위치가 MDC와 예외 전파 경로를 함께 나누고 있었다. 작업 제출을 코드 안으로 가져오자 요청 번호를 작업 스레드에 복사하는 시점과 큐 거부를 처리하는 위치가 모두 드러났다.

## 동기 HTTP에서 확인한 한계

큐가 차서 거부된 푸시는 버려진다. 이번 분리는 유실 없는 전달까지 해결하지 않는다. 발송 자격 판정도 두 번 일어난다. 서버 리스너가 수신 동의를 확인하고 알림 서비스가 발송 직전에 다시 확인한다. 리스너 쪽 판정을 지우면 `local` 모드의 동작까지 바뀌므로 이번 변경에서는 남겼다.

앱 전체의 `@Async` 실행기 부재도 고치지 않았다. 다른 비동기 작업의 동작을 바꾸는 일이라 별도 티켓으로 뺐다. 동기 HTTP로 확인할 수 있는 경계는 여기까지다.

다음은 커밋과 발행 사이를 아웃박스로 메워서 버려지는 푸시를 없애는 이야기다.
