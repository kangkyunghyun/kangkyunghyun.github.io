---
title: "제 11회 SCPC 1차 예선 후기"
date: 2026-02-08
tags: [대회]
---

![](/images/scpc-11th-first-round-review/01.png)

## 푼 문제

### 1. 거스름돈 (100/100)

그리디, 시뮬레이션 문제. 시간에 따라 생기는 화폐의 개수를 관리한다. 화폐의 가치가 배수 관계이므로 항상 가치가 큰 화폐를 먼저 사용한다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int T;
    cin >> T;
    for (int test_case = 0; test_case < T; test_case++) {
        int Answer = 0, n;
        int money[2] = {0};
        cin >> n;
        vector<int> v(n);
        for (int i = 0; i < n; i++)
            cin >> v[i];
        for (int x : v) {
            if (x == 500) {
                Answer++;
                money[0]++;
            } else if (x == 1000) {
                if (money[0]) {
                    money[0]--;
                    money[1]++;
                    Answer++;
                } else {
                    break;
                }
            } else {
                if (money[1] >= 4 && money[0] >= 1) {
                    money[1] -= 4;
                    money[0] -= 1;
                    Answer++;
                } else if (money[1] >= 3 && money[0] >= 3) {
                    money[1] -= 3;
                    money[0] -= 3;
                    Answer++;
                } else if (money[1] >= 2 && money[0] >= 5) {
                    money[1] -= 2;
                    money[0] -= 5;
                    Answer++;
                } else if (money[1] >= 1 && money[0] >= 7) {
                    money[1] -= 1;
                    money[0] -= 7;
                    Answer++;
                } else if (money[1] == 0 && money[0] >= 9) {
                    money[0] -= 9;
                    Answer++;
                } else {
                    break;
                }
            }
        }
        cout << "Case #" << test_case + 1 << '\n';
        cout << Answer << '\n';
    }
    return 0;
}
```

### 2. 폭탄 (150/150)

그리디 문제. 각 폭탄을 왼쪽, 오른쪽 중 가까운 곳까지의 거리를 구한다. 모든 폭탄이 왼쪽으로 간다면 거리의 합을 출력, 하나라도 오른쪽이 더 가깝다면 앞서 구한 거리가 가장 먼 폭탄을 들고 오른쪽으로 간다. 만약 폭탄이 하나라면 들고 왼쪽으로 가는 거리와 오른쪽으로 가는 거리를 비교한다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int T;
    cin >> T;
    for (int test_case = 0; test_case < T; test_case++) {
        int Answer = 0;
        int n, l, tmp, m = 0;
        cin >> n >> l;
        if (n == 1) {
            int b;
            cin >> b;
            Answer = min(2 * b, l);
        } else {
            int flag = 0;
            for (int i = 0; i < n; i++) {
                int b;
                cin >> b;
                if (b > l / 2) {
                    flag = 1;
                }
                tmp = min(b, l - b);
                m = max(m, tmp);
                Answer += 2 * tmp;
            }
            if (flag) {
                Answer -= 2 * m;
                Answer += l;
            }
        }
        cout << "Case #" << test_case + 1 << '\n';
        cout << Answer << '\n';
    }
    return 0;
}
```

## 못 푼 문제

### 3. 십진수 (20/200)

수학 문제. naive 하게 구현했다가 20점을 받았다. 다른 분들 풀이를 보고 주어진 N보다 같거나 작은 가장 큰 0, 1, 2로 이루어진 수를 구하고 이를 삼진수로 취급하여 십진수로 변환한다고 한다.

## 총평

군 전역 이후 첫 큰 대회라 잘하고 싶은 마음은 컸지만 준비는 많이 미흡했던 것 같다. 3번 문제 풀이를 보고 앞으로는 문제를 풀 때 손으로 종이나 태블릿에 직접 작성하며 풀어야겠다고 생각했다. 눈에 보이는 것으로부터 얻는 힌트도 만만치 않은 것 같다.

(+ 2025. 7. 18. 2차 예선 진출 메일을 받았다.)

<!-- 티스토리에서 옮김: https://khyunx.tistory.com/326 -->
<!-- 원문은 지우지 말고 본문만 이전 안내 링크로 교체할 것 (spec §4-3) -->
