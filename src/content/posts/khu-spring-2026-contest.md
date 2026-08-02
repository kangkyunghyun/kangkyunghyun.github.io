---
title: "2026 경희대학교 봄 프로그래밍 경시대회 후기"
date: 2026-06-08
tags: [대회]
---

![대회 스코어보드에서 3위를 기록한 결과](/images/khu-spring-2026-contest/01.jpg)

대회 스코어보드. 7문제를 해결해 3위로 대회를 마쳤다.

![A번부터 G번까지 해결한 제출 결과](/images/khu-spring-2026-contest/02.jpg)

5월 31일 열린 경희대학교 봄 프로그래밍 경시대회에 처음으로 개인 참가했다. 1학년 때부터 이어온 알고리즘 공부의 성과를 확인하고, 팀원이 없는 대회에서 내 힘만으로 어디까지 풀 수 있는지 점검해보고 싶었다.

결과는 A번부터 G번까지 7문제 해결, 326점으로 3위였다. 우수상도 받을 수 있었다. 순위도 기뻤지만 초반 실수에서 빠르게 벗어나 평소 페이스를 되찾았다는 점이 더 기억에 남는다.

[KHSPC 2026 문제 목록](https://doj.kr/ko/categories/school/kyunghee/khspc2026)

## 대회 흐름

첫 문제부터 황당한 실수를 했다. A번의 S/N 분기에서 두 경우의 반환값을 모두 `N`으로 적어 첫 제출에서 WA를 받았다. 대회가 시작되자마자 긴장한 탓이었다. 다행히 바로 오타를 찾아 같은 분에 다시 제출했고 AC를 받았다.

첫 제출을 틀리고 나니 오히려 완벽하게 풀어야 한다는 압박이 줄었다. 이후 B, C, D를 차례로 해결했고, E에서 한 번 더 WA를 받은 뒤 41분에 AC를 받았다. F는 82분, G는 116분에 해결했다. 남은 시간에는 J와 H를 시도했지만 추가 솔브로 이어지지는 않았다.

## 문제

### A. MBTI 1 (AC+1 / 2 min)

입력으로 주어진 MBTI의 각 지표를 반대 문자로 바꾸는 문제다. 풀이는 단순했지만 S/N 분기에 오타를 내 첫 WA를 받았다. 아래 코드는 해당 분기를 고친 버전이다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    string s, ans = "";
    cin >> s;
    ans += (s[0] == 'I' ? 'E' : 'I');
    ans += (s[1] == 'S' ? 'N' : 'S');
    ans += (s[2] == 'T' ? 'F' : 'T');
    ans += (s[3] == 'P' ? 'J' : 'P');
    cout << ans;
}
```

### B. 도서관 예약하기 (AC / 8 min)

예약 시작 시각과 종료 시각이 모두 정해진 시간 범위 안에 드는지 확인했다. 시각이 항상 `HH:MM` 형식으로 주어지므로 별도의 분 단위 변환 없이 문자열을 그대로 비교할 수 있다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int n, cnt = 0;
    cin >> n;
    string ans = "KHU Library";
    for (int i = 0; i < n; i++) {
        string a, t, b;
        cin >> a >> t >> b;
        if ("01:00" <= a && b <= "12:59")
            cnt++;
    }
    if (cnt == n)
        ans = "check the time again";
    cout << ans;
}
```

### C. MBTI 2 (AC / 16 min)

16개의 문자열에서 각 자리마다 등장하는 두 문자를 모았다. 이후 주어진 문자열의 각 문자를 같은 자리에 올 수 있는 다른 문자로 바꾸면 답을 만들 수 있다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    vector<int> v[4];
    for (int i = 0; i < 16; i++) {
        string s;
        cin >> s;
        for (int j = 0; j < 4; j++) {
            v[j].push_back(s[j]);
        }
    }
    for (int i = 0; i < 4; i++) {
        sort(v[i].begin(), v[i].end());
        v[i].erase(unique(v[i].begin(), v[i].end()), v[i].end());
    }
    string s, ans = "";
    cin >> s;
    for (int i = 0; i < 4; i++) {
        ans += (s[i] == v[i][0] ? v[i][1] : v[i][0]);
    }
    cout << ans;
}
```

### D. A+B (AC / 21 min)

`A + B = N`을 만족하면서 A와 B를 이어 붙인 수가 최대가 되도록 해야 한다. 가능한 B가 10의 거듭제곱이라는 조건을 이용해 `1, 10, 100, ...`만 확인하고 가장 큰 결과를 저장했다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int n;
    cin >> n;
    int a = n - 1, b = 1;
    int best = a * 10 + b;
    for (int p = 1; p < n; p *= 10) {
        int tmpB = p;
        int tmpA = n - tmpB;
        int concat = tmpA * (p * 10) + tmpB;
        if (concat > best) {
            best = concat;
            a = tmpA;
            b = tmpB;
        }
    }
    cout << a << ' ' << b;
}
```

### E. 버프 중첩 (AC+1 / 41 min)

덧셈 버프와 곱셈 버프의 적용 순서를 정해 최종 능력치를 최대화하는 문제다. 덧셈 값은 모두 더하고 0이 아닌 곱셈 값도 하나로 합쳤다. 현재 값의 부호와 0을 곱하는 버프의 존재 여부에 따라 후보를 비교했다. 처음에는 이 예외 처리를 놓쳐 한 번 틀렸다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int n, x, add = 0, mul = 1, zero = 0;
    cin >> n >> x;
    for (int i = 0; i < n; i++) {
        char a;
        int b;
        cin >> a >> b;
        if (a == '*') {
            if (b == 0)
                zero = 1;
            else
                mul = mul * b;
        } else
            add += b;
    }
    int ans = x + add;
    if (ans >= 0)
        ans = max(ans, ans * mul);
    if (zero)
        ans = max(ans, add * mul);
    cout << ans;
}
```

### F. 골프 연습 (AC / 82 min)

공이 같은 방향으로 이동하는 동안에는 추가 타격이 필요 없고, 방향을 바꿀 때마다 비용이 1 증가한다고 보았다. 따라서 위치만으로는 상태를 표현할 수 없고 현재 진행 방향까지 함께 저장해야 한다.

간선 비용은 직진할 때 0, 방향을 바꿀 때 1이므로 0-1 BFS를 사용했다. 직진 상태는 덱의 앞에, 방향을 바꾼 상태는 뒤에 넣어 최소 타격 횟수를 구했다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long
#define INF 4e18

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int n, m;
    cin >> n >> m;
    vector<string> v(n);
    int s = -1, t = -1;
    for (int i = 0; i < n; i++) {
        cin >> v[i];
        for (int j = 0; j < m; j++) {
            if (v[i][j] == 'S')
                s = i * m + j;
            if (v[i][j] == 'T')
                t = i * m + j;
        }
    }
    int dx[] = {1, -1, 0, 0}, dy[] = {0, 0, 1, -1};
    vector<vector<int>> dist(n * m, vector<int>(4, INF));
    deque<pair<int, int>> q;
    for (int i = 0; i < 4; i++) {
        q.push_back({s, i});
        dist[s][i] = 1;
    }
    while (!q.empty()) {
        auto [curr, dir] = q.front();
        q.pop_front();
        int x = curr / m;
        int y = curr % m;
        for (int i = 0; i < 4; i++) {
            int nx = x + dx[i];
            int ny = y + dy[i];
            if (v[nx][ny] == '#')
                continue;
            int next = nx * m + ny;
            int cost = dist[curr][dir] + (dir != i);
            if (cost < dist[next][i]) {
                dist[next][i] = cost;
                if (dir == i)
                    q.push_front({next, i});
                else
                    q.push_back({next, i});
            }
        }
    }
    int ans = *min_element(dist[t].begin(), dist[t].end());
    cout << (ans != INF ? ans : -1);
}
```

### G. 격자판 점수 구하기 (AC / 116 min)

크기가 `2^N × 2^N`인 배열을 네 사분면으로 계속 나눴다. 각 구간에서는 만들 수 있는 결과의 최솟값과 최댓값인 `mn`, `mx`, 구간 원소의 최솟값과 최댓값인 `lo`, `hi`를 함께 반환했다.

네 사분면을 합칠 때는 우선 각 사분면 결과의 합을 구한다. 그다음 한 사분면의 결과를 해당 구간의 원소 최솟값 또는 최댓값으로 바꾼 후보를 모두 비교해 현재 구간의 답을 갱신했다. 필요한 네 값만 상위 호출로 넘기므로 전체 배열을 매 단계 다시 순회할 필요가 없다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

struct Node {
    int mn, mx, lo, hi;
};

int a[1024][1024];

Node solve(int x, int y, int size) {
    if (size == 1)
        return {a[x][y], a[x][y], a[x][y], a[x][y]};
    int h = size / 2;
    Node v[4] = {
        solve(x, y, h),
        solve(x, y + h, h),
        solve(x + h, y, h),
        solve(x + h, y + h, h),
    };
    int mn = 4e18, mx = 0, lo = 4e18, hi = 0;
    int tmn = 0, tmx = 0;
    for (int i = 0; i < 4; i++) {
        tmn += v[i].mn;
        tmx += v[i].mx;
        lo = min(lo, v[i].lo);
        hi = max(hi, v[i].hi);
    }
    for (int i = 0; i < 4; i++) {
        mn = min(mn, tmn - v[i].mn + v[i].lo);
        mx = max(mx, tmx - v[i].mx + v[i].hi);
    }
    return {mn, mx, lo, hi};
}

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int n;
    cin >> n;
    int size = 1 << n;
    for (int i = 0; i < size; i++)
        for (int j = 0; j < size; j++)
            cin >> a[i][j];
    Node ans = solve(0, 0, size);
    cout << ans.mn << ' ' << ans.mx;
}
```

## 총평

문제를 붙잡고 고민한 끝에 답을 찾아가는 과정은 여전히 즐거웠다. 1학년 때부터 꾸준히 공부한 내용이 긴장되는 상황에서도 해결책을 찾는 기반이 되어주었다는 것도 확인할 수 있었다.

최근에는 PS를 많이 하지 않고 AI를 활용한 코딩을 주로 하다 보니, 내 손으로 처음부터 끝까지 코드를 작성하는 일이 오랜만이었다. 제한된 시간 안에 직접 풀이를 떠올리고 구현하며 예외를 점검하는 과정 자체가 즐거운 시간이었다.

무엇보다 첫 제출의 실수에 오래 끌려가지 않은 것이 이번 대회의 가장 큰 수확이었다. 예상하지 못한 WA를 받았을 때 낙담하기보다 원인을 바로 찾고 다음 문제로 넘어가는 회복력이 실전에서는 중요했다. 후반에 H와 J를 해결하지 못한 점은 아쉽지만, 첫 개인 참가에서 3위와 우수상이라는 결과를 얻어 자신감을 쌓을 수 있었다.
