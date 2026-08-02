#!/usr/bin/env python3
"""티스토리 글 하나를 이 저장소의 마크다운으로 옮긴다.

    python3 tools/import-tistory.py https://khyunx.tistory.com/382 scsc-2026

원본은 RSS(`/rss`)에서 가져온다. 본문 HTML과 발행일이 그대로 들어 있어
페이지를 긁는 것보다 깨끗하다. RSS에 없는 오래된 글은 티스토리 페이지의
`.tt_article_useless_p_margin` 본문 컨테이너를 폴백으로 사용한다.

이미지는 public/images/<슬러그>/ 로 내려받고 경로를 바꾼다.
외부 호스트에 의존하지 않기 위해서다(spec §4-3).

의존성 없음. 표준 라이브러리만 쓴다.
"""

from __future__ import annotations

import html
import os
import re
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
POSTS = ROOT / "src" / "content" / "posts"
IMAGES = ROOT / "public" / "images"
UA = {"User-Agent": "Mozilla/5.0 (import-tistory)"}

# 그대로 버리는 태그. 티스토리 에디터가 남기는 껍데기들.
DROP = {"script", "style", "iframe", "svg"}
# 줄바꿈만 남기고 통과시키는 태그
PASS = {"figure", "span", "div", "section", "article", "figcaption", "tbody", "thead"}
# 닫는 태그가 없는 요소. 버리기 깊이를 셀 때 세면 안 된다.
VOID = {"img", "br", "hr", "input", "meta", "link", "source"}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def rss_items(blog: str) -> list[dict]:
    """RSS를 파싱해 {title, link, pubDate, body} 목록을 만든다."""
    xml = fetch(f"{blog}/rss").decode("utf-8", "replace")
    out = []
    for chunk in re.findall(r"<item>(.*?)</item>", xml, re.S):

        def pick(tag: str) -> str:
            m = re.search(rf"<{tag}>(.*?)</{tag}>", chunk, re.S)
            if not m:
                return ""
            v = m.group(1).strip()
            cdata = re.match(r"<!\[CDATA\[(.*?)\]\]>$", v, re.S)
            return cdata.group(1) if cdata else html.unescape(v)

        out.append(
            {
                "title": pick("title"),
                "link": pick("link"),
                "pubDate": pick("pubDate"),
                "body": pick("description"),
            }
        )
    return out


def rfc822_to_date(s: str) -> str:
    """'Wed, 21 May 2026 00:59:04 +0900' → '2026-05-21'."""
    m = re.search(r"(\d{1,2}) (\w{3}) (\d{4})", s)
    if not m:
        return ""
    day, mon, year = m.groups()
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    return f"{year}-{months.index(mon) + 1:02d}-{int(day):02d}"


def page_date(s: str) -> str:
    """페이지의 ISO 또는 화면 날짜 표기를 YYYY-MM-DD로 바꾼다."""
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if not m:
        m = re.search(r"(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})", s)
    if not m:
        return ""
    year, month, day = m.groups()
    return f"{year}-{int(month):02d}-{int(day):02d}"


class TistoryPage(HTMLParser):
    """실제 티스토리 페이지에서 본문과 발행 메타데이터를 뽑는다.

    현재 스킨에서는 ``.article-view`` 바깥에 광고가 있고, 실제 글은
    ``.tt_article_useless_p_margin.contents_style`` 안에 있다. 오래된 스킨의
    ``.article_view`` / ``.entry-content``도 함께 인식하되, 클래스 토큰이
    정확히 일치하는 컨테이너만 본문으로 선택한다.
    """

    ARTICLE_CLASSES = {"article_view", "entry-content", "tt_article_useless_p_margin"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.article: list[str] = []
        self.article_tag = ""
        self.article_depth = 0
        self.published_time = ""
        self.date_text: list[str] = []
        self.date_depth = 0
        self.article_title: list[str] = []
        self.article_title_depth = 0
        self.page_title: list[str] = []
        self.page_title_depth = 0

    @staticmethod
    def classes(attrs: list[tuple[str, str | None]]) -> set[str]:
        return set((dict(attrs).get("class") or "").split())

    def observe(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "meta" and a.get("property") == "article:published_time":
            self.published_time = a.get("content") or ""

        classes = self.classes(attrs)
        if "date" in classes and not self.date_depth:
            self.date_depth = 1
        elif self.date_depth and tag not in VOID:
            self.date_depth += 1

        if tag == "title" and not self.page_title_depth:
            self.page_title_depth = 1
        elif self.page_title_depth and tag not in VOID:
            self.page_title_depth += 1

        if tag == "h2" and "title-article" in classes and not self.article_title_depth:
            self.article_title_depth = 1
        elif self.article_title_depth and tag not in VOID:
            self.article_title_depth += 1

    def handle_starttag(self, tag, attrs):
        raw = self.get_starttag_text() or ""
        self.observe(tag, attrs)
        if self.article_depth:
            self.article.append(raw)
            if tag not in VOID:
                self.article_depth += 1
        elif self.classes(attrs) & self.ARTICLE_CLASSES:
            self.article_tag = tag
            self.article_depth = 1

    def handle_startendtag(self, tag, attrs):
        raw = self.get_starttag_text() or ""
        self.observe(tag, attrs)
        if self.article_depth:
            self.article.append(raw)

    def handle_endtag(self, tag):
        if self.date_depth:
            self.date_depth -= 1
        if self.page_title_depth:
            self.page_title_depth -= 1
        if self.article_title_depth:
            self.article_title_depth -= 1

        if not self.article_depth:
            return
        if self.article_depth == 1 and tag == self.article_tag:
            self.article_depth = 0
            return
        self.article.append(f"</{tag}>")
        if self.article_depth > 1:
            self.article_depth -= 1

    def handle_data(self, data):
        if self.article_depth:
            self.article.append(data)
        if self.date_depth:
            self.date_text.append(data)
        if self.article_title_depth:
            self.article_title.append(data)
        if self.page_title_depth:
            self.page_title.append(data)

    def handle_entityref(self, name):
        raw = f"&{name};"
        if self.article_depth:
            self.article.append(raw)
        if self.date_depth:
            self.date_text.append(html.unescape(raw))
        if self.article_title_depth:
            self.article_title.append(html.unescape(raw))
        if self.page_title_depth:
            self.page_title.append(html.unescape(raw))

    def handle_charref(self, name):
        raw = f"&#{name};"
        if self.article_depth:
            self.article.append(raw)
        if self.date_depth:
            self.date_text.append(html.unescape(raw))
        if self.article_title_depth:
            self.article_title.append(html.unescape(raw))
        if self.page_title_depth:
            self.page_title.append(html.unescape(raw))

    def handle_comment(self, data):
        if self.article_depth:
            self.article.append(f"<!--{data}-->")

    def item(self, url: str) -> dict:
        title = "".join(self.article_title).strip() or "".join(self.page_title).strip()
        date = page_date(self.published_time or "".join(self.date_text))
        body = "".join(self.article).strip()
        if not body:
            raise ValueError("페이지에서 본문 컨테이너를 찾지 못함")
        if not title:
            raise ValueError("페이지에서 제목을 찾지 못함")
        if not date:
            raise ValueError("페이지에서 발행일을 찾지 못함")
        return {"title": title, "link": url, "pubDate": date, "body": body}


def page_item(url: str) -> dict:
    """RSS에 없는 글을 페이지 HTML에서 가져온다."""
    page = fetch(url).decode("utf-8", "replace")
    parser = TistoryPage()
    parser.feed(page)
    parser.close()
    return parser.item(url)


class ToMarkdown(HTMLParser):
    """티스토리가 뱉는 HTML을 마크다운으로 바꾼다.

    완벽한 변환기가 아니다. 티스토리 에디터가 실제로 쓰는 태그만 다루고,
    모르는 태그는 내용만 통과시킨다. 결과는 사람이 한 번 읽고 손본다는 전제다.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0
        self.pre = 0
        self.list_stack: list[str] = []
        self.li_index: list[int] = []
        self.images: list[str] = []
        self.href: str | None = None
        self.link_buf: list[str] = []
        self.in_cell = False

    # ── 유틸 ──────────────────────────────────
    def emit(self, s: str) -> None:
        (self.link_buf if self.href is not None else self.out).append(s)

    def block(self) -> None:
        while self.out and self.out[-1] == "\n":
            self.out.pop()
        self.out.append("\n\n")

    # ── 태그 ──────────────────────────────────
    def drops(self, tag: str, a: dict) -> bool:
        """이 태그부터 서브트리를 통째로 버릴지."""
        if tag in DROP:
            return True
        # 링크 미리보기 카드. 본문 링크와 중복되고 설명이 통째로 딸려온다
        if a.get("data-ke-type") == "opengraph":
            return True
        # 접힘 블록의 '더보기' 버튼. 안의 내용은 살리고 버튼만 버린다
        if tag == "a" and "btn-toggle-moreless" in (a.get("class") or ""):
            return True
        return False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.skip:
            # 버리는 중에는 깊이만 센다. void 요소는 닫는 태그가 없어 세지 않는다
            if tag not in VOID:
                self.skip += 1
            return
        if self.drops(tag, a):
            self.skip = 1 if tag not in VOID else 0
            return

        if tag == "img":
            src = a.get("src") or a.get("data-url") or ""
            if src:
                self.images.append(src)
                alt = (a.get("alt") or "").strip()
                self.block()
                self.out.append(f"![{alt}]({src})")
                self.block()
        elif tag == "a":
            self.href = a.get("href")
            self.link_buf = []
        elif tag == "br":
            self.emit("\n")
        elif tag == "hr":
            self.block()
            self.out.append("---")
            self.block()
        elif tag in ("strong", "b"):
            self.emit("**")
        elif tag in ("em", "i"):
            self.emit("*")
        elif tag == "code" and not self.pre:
            self.emit("`")
        elif tag == "pre":
            self.pre += 1
            self.block()
            self.out.append("```\n")
        elif tag == "blockquote":
            self.block()
            self.out.append("> ")
        elif re.fullmatch(r"h[1-6]", tag):
            self.block()
            # 글 제목이 h1 이므로 본문 최상위 제목은 h2 로 내린다
            level = max(2, int(tag[1]))
            self.out.append("#" * level + " ")
        elif tag == "p":
            self.block()
        elif tag in ("ul", "ol"):
            self.list_stack.append(tag)
            self.li_index.append(0)
            self.block()
        elif tag == "li":
            if self.list_stack:
                depth = len(self.list_stack) - 1
                if self.list_stack[-1] == "ol":
                    self.li_index[-1] += 1
                    marker = f"{self.li_index[-1]}. "
                else:
                    marker = "- "
                self.out.append("  " * depth + marker)
        elif tag == "table":
            self.block()
        elif tag == "tr":
            self.out.append("\n|")
        elif tag in ("td", "th"):
            self.in_cell = True
            self.out.append(" ")
        elif tag in PASS:
            pass

    def handle_endtag(self, tag):
        if self.skip:
            self.skip -= 1
            return

        if tag == "a":
            text = "".join(self.link_buf).strip()
            self.href, buf, self.link_buf = None, self.href, []
            if text:
                self.out.append(f"[{text}]({buf})" if buf else text)
        elif tag in ("strong", "b"):
            self.emit("**")
        elif tag in ("em", "i"):
            self.emit("*")
        elif tag == "code" and not self.pre:
            self.emit("`")
        elif tag == "pre":
            self.pre = max(0, self.pre - 1)
            self.out.append("\n```")
            self.block()
        elif re.fullmatch(r"h[1-6]", tag) or tag in ("p", "blockquote"):
            self.block()
        elif tag in ("ul", "ol"):
            if self.list_stack:
                self.list_stack.pop()
                self.li_index.pop()
            self.block()
        elif tag == "li":
            self.out.append("\n")
        elif tag in ("td", "th"):
            self.in_cell = False
            self.out.append(" |")
        elif tag == "table":
            self.block()

    def handle_data(self, data):
        if self.skip:
            return
        if self.pre:
            self.out.append(data)
            return
        text = re.sub(r"\s+", " ", data)
        if text.strip() or (self.out and not self.out[-1].endswith("\n")):
            self.emit(text)

    def result(self) -> str:
        md = "".join(self.out)
        md = re.sub(r"[ \t]+\n", "\n", md)
        md = re.sub(r"\n{3,}", "\n\n", md)
        return md.strip() + "\n"


def localize_images(md: str, urls: list[str], slug: str) -> str:
    """이미지를 public/images/<slug>/ 로 내려받고 경로를 바꾼다."""
    if not urls:
        return md
    dest = IMAGES / slug
    dest.mkdir(parents=True, exist_ok=True)
    for i, url in enumerate(dict.fromkeys(urls), 1):
        ext = os.path.splitext(urlparse(url).path)[1] or ".png"
        if len(ext) > 5:
            ext = ".png"
        name = f"{i:02d}{ext}"
        try:
            (dest / name).write_bytes(fetch(url))
        except Exception as e:  # 이미지 하나 실패가 이관 전체를 막지 않게
            print(f"  ! 이미지 실패 {url} — {e}", file=sys.stderr)
            continue
        md = md.replace(url, f"/images/{slug}/{name}")
        print(f"  ↓ {name}")
    return md


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    url = sys.argv[1].rstrip("/")
    parsed = urlparse(url)
    blog = f"{parsed.scheme}://{parsed.netloc}"
    slug = sys.argv[2] if len(sys.argv) > 2 else parsed.path.strip("/").split("/")[-1]

    print(f"RSS 조회: {blog}/rss")
    items = rss_items(blog)
    item = next((i for i in items if i["link"].rstrip("/") == url), None)
    if item is None:
        print(f"RSS 최근 {len(items)}편에 없음: {url}")
        print("페이지 HTML 폴백 조회: .tt_article_useless_p_margin")
        item = page_item(url)
    else:
        print("RSS 본문 사용")

    p = ToMarkdown()
    p.feed(item["body"])
    body = p.result()
    print(f"제목: {item['title']}")
    body = localize_images(body, p.images, slug)

    date = rfc822_to_date(item["pubDate"]) or page_date(item["pubDate"])
    if not date:
        raise ValueError("발행일을 YYYY-MM-DD로 변환하지 못함")
    title = item["title"].replace('"', "'")
    out = POSTS / f"{slug}.md"
    out.write_text(
        f"---\ntitle: \"{title}\"\ndate: {date}\ntags: []\ndraft: true\n---\n\n"
        f"{body}\n"
        f"<!-- 티스토리에서 옮김: {url} -->\n"
        f"<!-- 원문은 지우지 말고 본문만 이전 안내 링크로 교체할 것 (spec §4-3) -->\n",
        encoding="utf-8",
    )
    print(f"\n생성: {out.relative_to(ROOT)}  (draft: true)")
    print("확인 후 draft 를 지우고 tags 를 채울 것.")
    return 0


def selftest() -> None:
    p = ToMarkdown()
    p.feed(
        "<p>안녕 <strong>굵게</strong>와 <a href='https://x.com'>링크</a>.</p>"
        "<h2>소제목</h2><ul><li>하나</li><li>둘</li></ul>"
        "<pre><code>print(1)</code></pre>"
        "<blockquote>인용</blockquote>"
        "<p><img src='https://cdn/img.png' alt='그림'></p>"
    )
    md = p.result()
    assert "**굵게**" in md, md
    assert "[링크](https://x.com)" in md, md
    assert "## 소제목" in md, md
    assert "- 하나" in md and "- 둘" in md, md
    assert "```\nprint(1)\n```" in md, md
    assert "> 인용" in md, md
    assert "![그림](https://cdn/img.png)" in md, md
    assert p.images == ["https://cdn/img.png"], p.images

    # 티스토리 껍데기가 걷혔는지
    q = ToMarkdown()
    q.feed(
        "<p>본문</p>"
        '<figure data-ke-type="opengraph"><a href="https://x.com">제목설명설명</a></figure>'
        '<div data-ke-type="moreLess"><a class="btn-toggle-moreless">더보기</a>'
        '<div class="moreless-content"><pre>code</pre></div></div>'
        "<p>끝</p>"
    )
    md2 = q.result()
    assert "설명설명" not in md2, md2  # 링크 카드 제거
    assert "더보기" not in md2, md2  # 토글 버튼 제거
    assert "code" in md2, md2  # 접힌 내용은 살아남아야 함
    assert "본문" in md2 and "끝" in md2, md2  # 앞뒤 본문 온전

    # 오래된 글의 페이지 HTML 폴백: 실제 스킨의 본문 컨테이너와 메타 날짜
    page = TistoryPage()
    page.feed(
        '<meta property="article:published_time" content="2023-02-11T23:29:16+09:00">'
        '<h2 class="title-article">오래된 글</h2>'
        '<div class="article-view"><div class="tt_article_useless_p_margin contents_style">'
        '<p>본문 <strong>내용</strong></p></div></div>'
    )
    page_item_result = page.item("https://khyunx.tistory.com/42")
    assert page_item_result["title"] == "오래된 글", page_item_result
    assert page_item_result["pubDate"] == "2023-02-11", page_item_result
    assert page_item_result["body"] == "<p>본문 <strong>내용</strong></p>", page_item_result

    assert rfc822_to_date("Wed, 21 May 2026 00:59:04 +0900") == "2026-05-21"
    assert rfc822_to_date("Mon, 02 Feb 2026 09:00:00 +0900") == "2026-02-02"
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        raise SystemExit(main())
