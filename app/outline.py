"""Fihrist hiyerarşisi - sunucu tarafı hesap.

Frontend'deki buildChapterHierarchy ile AYNI kuralları uygular; matris
eşleştirme gibi işlemlerin "hangi girdi kimin altında" sorusunu backend'de
de cevaplayabilmesi için burada tekrarlanır.

Kurallar (frontend ile birebir):
- part (Üst başlık) ve subtitle (Ara başlık) kapsayıcıdır.
- Paragrafı OLMAYAN bir 'chapter', ardından bir part/subtitle geliyorsa
  kapsayıcı sayılır (kullanıcı "BİRİNCİ BÖLÜM"ü üst başlık olarak
  kullanabiliyor - tür adı değil, yapı belirleyici).
- Numaralandırma hiyerarşiktir: 1, 1-1, 1-1-2 ...
"""
from typing import List


def build_hierarchy(chapters: List) -> List[dict]:
    """[{chapter, level, display, parent_id}] döner (numara sırasına göre)."""
    items = []
    counters = [0, 0, 0, 0, 0]
    container_id = part_id = subtitle_id = None
    ordered = sorted(chapters, key=lambda c: c.number)

    def has_text(c):
        return any((p.text or "").strip() for p in c.paragraphs)

    for idx, c in enumerate(ordered):
        nxt = ordered[idx + 1] if idx + 1 < len(ordered) else None
        # Kapsayıcı bölüm: paragrafı yok VE ardından bir başlık geliyor VE
        # zaten bir başlığın ALTINDA değil. Son koşul şart: bir Kısım'ın
        # altındaki boş bölüm, ardından yeni bir Kısım gelse bile kapsayıcı
        # değildir - kendi kardeşlerini yutmamalı.
        is_container_chapter = (
            c.kind == "chapter" and not has_text(c)
            and nxt is not None and nxt.kind in ("part", "subtitle")
            and part_id is None and subtitle_id is None
        )
        if c.kind == "part":
            parent = container_id
            level = 1 if container_id else 0
            part_id, subtitle_id = c.id, None
        elif c.kind == "subtitle":
            parent = part_id or container_id
            level = (1 if container_id else 0) + (1 if part_id else 0)
            subtitle_id = c.id
        elif is_container_chapter:
            parent, level = None, 0
            container_id, part_id, subtitle_id = c.id, None, None
        else:
            parent = subtitle_id or part_id or container_id
            level = (1 if container_id else 0) + (1 if part_id else 0) + (1 if subtitle_id else 0)

        counters[level] += 1
        for l in range(level + 1, len(counters)):
            counters[l] = 0
        display = "-".join(str(x) for x in counters[: level + 1])
        items.append({"chapter": c, "level": level, "display": display, "parent_id": parent})
    return items


def children_of(chapters: List, parent_id: int) -> List:
    """Bir girdinin DOĞRUDAN alt girdileri (numara sırasına göre)."""
    return [it["chapter"] for it in build_hierarchy(chapters) if it["parent_id"] == parent_id]
