---
title: "2026 SCSC computer programming contest Div.3 후기"
date: 2026-05-21
tags: [대회]
---

![대회 최종 스코어보드](/images/scsc-2026-contest/01.png)

최종 스코어보드

![Furiosa Prize 수상자로 호명된 순간의 스크린](/images/scsc-2026-contest/02.jpg)

![대회 명찰과 상품](/images/scsc-2026-contest/03.jpg)

4등 결정 순간과 명찰 및 상품

처음으로 참여하는 오프라인 대회였고 4등을 했다. 어쩐 일로 패널티 관리를 잘한 데다 8솔까지 해서 순위권에 들 수 있었다. 전체적으로 초반보다 후반에 더 잘 풀린 느낌이었고 초반 시간을 조금 더 단축했다면 좋았을 것 같다는 아쉬움이 남는다.

최근 PS를 열심히 하지 않았는데 애드혹스러운 문제가 많아서 오히려 평소보다 좋은 퍼포먼스를 보일 수 있었던 것 같다.

[https://atcoder.jp/contests/scpc2026-div3](https://atcoder.jp/contests/scpc2026-div3)

해설은 잘할 자신이 없어서 [에디토리얼](https://github.com/AutoclickerI/SCPC/blob/main/2026/solutions.pdf)을 보길 바라며 느낀 점 위주로 코멘트를 남기고자 한다.

## 문제

### A. 빠진 한 글자 찾기

문제 제목 그대로인 쉬운 브론즈 문제였고 약간 긴장해서 손을 벌벌 떨며 코드를 짰다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    string str;
    cin >> str;
    int c = 0, s = 0;
    for (char i : str) {
        if (i == 'S')
            s++;
        else
            c++;
    }
    if (s != 2)
        cout << 'S';
    else
        cout << 'C';
}
```

### B. Mobilint 텐서 스케쥴링 (REGULUS)

처음 봤을 때 난이도 순인데 이게 왜 B지? 라는 생각을 했는데 급한 마음에 w_i = 1이라는 조건을 못 보고 naive하게 구현을 하느라 시간을 많이 소비했다. C로 도망쳤다가 돌아와서 조건을 발견했다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int n, m;
    cin >> n >> m;
    vector<int> w(n + 1), child(n + 1);
    for (int i = 1; i <= n; i++)
        cin >> w[i];
    for (int i = 2; i <= n; i++) {
        int p;
        cin >> p;
        child[p]++;
    }
    int ans = 0;
    for (int i = 1; i <= n; i++)
        if (child[i] == 0)
            ans++;
    if (ans + 1 <= m)
        cout << ans + 1 << '\n';
    else
        cout << "OOM\n";
}
```

### C. 오름차순으로 정렬했을 때 K번째 수

문제 이해가 가장 큰 고비였고 규칙성을 찾는 데 시간을 들였다. nth_element 함수를 아주 예전에 보고 쓴 적도 없었는데 이렇게 쓸 기회가 생길 줄은 몰랐다. 이 함수를 몰랐다면 코드 작성에 시간이 배로 들었을 것 같다. 변수 입력 순서를 잘못 적어서 1번 틀린게 아쉽다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int n, k, m;
    cin >> n >> k >> m;
    vector<int> a(n);
    for (int& i : a)
        cin >> i;
    if (m <= n) {
        cout << a[m - 1] << '\n';
        return 0;
    }
    nth_element(a.begin(), a.begin() + k - 1, a.end());
    cout << a[k - 1] << '\n';
}
```

### D. 스시스시 회전초밥

각 위치를 방문하는 횟수가 정해져 있으므로 각 위치별로 최대한으로 먹도록 했다. 이렇게 하면 되나? 싶었는데 되더라.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int n, t, ans = 0;
    cin >> n >> t;
    for (int i = 0; i < n; i++) {
        int k, v = 0;
        cin >> k;
        if (i < t)
            v = (t - i - 1) / n + 1;
        int sum = 0, best = 0;
        for (int j = 0; j < k; j++) {
            int x;
            cin >> x;
            if (j < v) {
                sum += x;
                best = max(best, sum);
            }
        }
        ans += best;
    }
    cout << ans << '\n';
}
```

### E. DETOX

재미있는 애드혹이었다. 첫 턴에 손을 안드는 경우가 xo_xo 또는 ox_ox 밖에 없고 양쪽 인접한 두 사람 중 한 명은 반드시 첫 턴에 손을 들게 되어 있으므로 첫 번째가 아니면 두 번째다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int t;
    cin >> t;
    while (t--) {
        int n;
        string s;
        cin >> n >> s;
        for (int i = 0; i < n; i++)
            cout << (s[(i - 2 + n) % n] == s[(i - 1 + n) % n] || s[(i - 1 + n) % n] == s[(i + 1) % n] || s[(i + 1) % n] == s[(i + 2) % n] ? 1 : 2) << ' ';
        cout << '\n';
    }
}
```

### F. SQL

처음엔 약간 복잡하게 생각을 했고 path를 다 갱신하는 방식으로 했는데 TLE가 났다. 쿼리를 따라가다보면 최종 목적지는 정해져 있으므로 유니온-파인드를 적용해서 해결했다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

vector<int> p;

int find(int x) {
    if (p[x] != x)
        p[x] = find(p[x]);
    return p[x];
}

void merge(int x, int y) {
    x = find(x);
    y = find(y);
    if (x < y)
        p[y] = x;
    else
        p[x] = y;
}

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int q;
    cin >> q;
    p.resize(q + 1);
    iota(p.begin(), p.end(), 0);
    vector<int> x(q + 1);
    for (int i = 1; i <= q; i++)
        cin >> x[i];
    for (int i = 1; i <= q; i++) {
        if (x[i] > 0)
            merge(i, x[i]);
    }
    vector<int> ans(q + 1, 0);
    for (int i = 1; i <= q; i++)
        if (x[i] < 0)
            ans[find(i)] = x[-x[i]];
    for (int i = 1; i <= q; i++)
        cout << (ans[find(i)] ? ans[find(i)] : 1) << ' ';
    cout << '\n';
}
```

### G. SCSC 게임

노트에 가능한 경우들을 몇개 적다보니 첫 턴에 끝낼 수 있는 경우가 2가지 밖에 없었고 문자열 길이의 홀짝성을 이용해 쉽게 풀 수 있었다.

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
    cin.tie(0)->sync_with_stdio(0);
    int t;
    cin >> t;
    while (t--) {
        string s;
        cin >> s;
        string ans = s.size() % 2 ? "Terra" : "Lulu";
        for (int i = 0; i + 4 < s.size(); i++) {
            string str = s.substr(i, 5);
            if (str == "SCCSC" || str == "SCSSC")
                ans = "Terra";
        }
        cout << ans << '\n';
    }
}
```

### H. 시험공부

마지막으로 푼 문제였다. 트리 형태라서 항상 첫 과목에 걸리는 시간만 A고 나머진 A-B가 걸린다. 이를 바탕으로 가능한 답을 계산하고 과목 순서만 bfs로 탐색했다. 이 문제도 노트에 그림을 그려가며 풀었더니 금방 깨달을 수 있었는데 손으로 쓰는 것이 효과가 있음을 크게 느꼈다.

```cpp
#include <bits/stdc++.h>
using namespace std;
#define int long long

signed main() {
    cin.tie(0)->sync_with_stdio(0);
    int n, t, a, b;
    cin >> n >> t >> a >> b;
    vector<vector<int>> edge(n + 1);
    for (int i = 1; i < n; i++) {
        int u, v;
        cin >> u >> v;
        edge[u].push_back(v);
        edge[v].push_back(u);
    }
    if (t < a) {
        cout << "0 0";
        return 0;
    }
    int afterFirst = max(1LL, a - b);
    int k = min(n, (t - a) / afterFirst + 1);
    int minTime = a + (k - 1) * afterFirst;
    cout << k << ' ' << minTime << '\n';
    vector<int> ans, parent(n + 1, 0);
    queue<int> q;
    q.push(1);
    parent[1] = -1;
    while (!q.empty() && ans.size() < k) {
        int curr = q.front();
        q.pop();
        ans.push_back(curr);
        for (int next : edge[curr]) {
            if (parent[next])
                continue;
            parent[next] = curr;
            q.push(next);
        }
    }
    for (int i : ans)
        cout << i << ' ';
    cout << '\n';
}
```

## 총평

첫 오프라인 + 개인 참가였던 데다가 참가자가 많은 대회였다 보니 꽤나 떨렸다. 심지어 오전에 일정이 있어서 급하게 이동했음에도 빠듯하게 도착했는데 결과가 좋아서 매우 만족스럽다. PS를 접을 만할 때마다 도파민 충전이 되니 재미는 있어서 큰일이다.

<!-- 티스토리에서 옮김: https://khyunx.tistory.com/382 -->
<!-- 원문은 지우지 말고 본문만 이전 안내 링크로 교체할 것 (spec §4-1-3) -->
