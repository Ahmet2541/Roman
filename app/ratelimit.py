"""Basit, bellek içi (in-memory) rate limiter.

Amaç: yanlışlıkla art arda çok fazla AI isteği atıp DashScope faturasını
şişirmemek. Tek process/tek kullanıcı ölçeğinde Redis gibi ayrı bir
bağımlılık gerekmiyor - process içi bir sözlükte son istek zamanlarını
tutmak yeterli. Railway yeniden deploy ettiğinde sıfırlanır, bu sorun
değil (sadece bir sayaç, kalıcı veri değil)."""
import time
from collections import defaultdict
from fastapi import Depends, HTTPException

from .auth import get_current_user

_calls: dict[str, list[float]] = defaultdict(list)


def rate_limit(max_calls: int, window_seconds: int, label: str = "istek"):
    """Depends() olarak kullan: aynı kullanıcı window_seconds içinde
    max_calls'tan fazla çağrı yaparsa 429 döner."""

    def dependency(user=Depends(get_current_user)):
        now = time.time()
        key = f"{label}:{user.username}"
        calls = _calls[key]
        calls[:] = [t for t in calls if now - t < window_seconds]
        if len(calls) >= max_calls:
            retry_after = max(1, int(window_seconds - (now - calls[0])))
            raise HTTPException(
                status_code=429,
                detail=f"Çok fazla {label} isteği attın. {retry_after} saniye sonra tekrar dene.",
            )
        calls.append(now)
        return user

    return dependency
