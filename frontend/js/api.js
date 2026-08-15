const TOKEN_KEY = 'roman_token';
const NOVEL_KEY = 'roman_novel_id';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function getNovelId() { return localStorage.getItem(NOVEL_KEY); }
function setNovelId(id) { localStorage.setItem(NOVEL_KEY, String(id)); }
function clearNovelId() { localStorage.removeItem(NOVEL_KEY); }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = opts.headers ? { ...opts.headers } : {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // /novels endpoint'i romandan BAĞIMSIZ çalışır (roman seçmeden önce de
  // listelenebilmeli/oluşturulabilmeli) - o yüzden ona header eklemiyoruz.
  const novelId = getNovelId();
  if (novelId && !path.startsWith('/novels')) headers['X-Novel-Id'] = novelId;

  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }

  // KONTROL AJANI: her isteğin süresi ölçülür ve başarısızlıklar kayda
  // geçer. Eskiden ajan yalnızca YAKALANMAMIŞ hataları görüyordu; oysa
  // sorunların çoğu yakalanan hatalar (502 Qwen, 400 doğrulama, ağ kesintisi)
  // ve bunlar hiçbir yere yazılmıyordu - kullanıcı ekran görüntüsü almak
  // zorunda kalıyordu.
  const _baslangic = Date.now();
  let res;
  try {
    res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body });
  } catch (agHatasi) {
    if (typeof reportIssue === 'function') {
      reportIssue('ag_hatasi', `Sunucuya ulaşılamadı: ${path}`, String(agHatasi && agHatasi.message || agHatasi));
    }
    throw new Error('Sunucuya ulaşılamadı. Bağlantını kontrol et; işlem uzun sürüyorsa tekrar dene.');
  }
  const _sure = Date.now() - _baslangic;
  // Yavaş istekler de kaydedilir: hata değil ama akışı kesen bir sorun.
  // AI uçlarında 45 sn, diğerlerinde 8 sn eşiği.
  const _esik = path.startsWith('/ai/') ? 45000 : 8000;
  if (_sure > _esik && typeof reportIssue === 'function') {
    reportIssue('yavas_istek', `${Math.round(_sure / 1000)} sn sürdü: ${path}`, '');
  }

  if (res.status === 401) {
    clearToken();
    window.location.href = '/app/login.html';
    throw new Error('Oturum sona erdi, tekrar giriş yapmalısın.');
  }
  if (!res.ok) {
    let detail = `İstek başarısız (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === 'string') {
        detail = data.detail;
      } else if (Array.isArray(data.detail)) {
        // FastAPI 422 doğrulama hatası: [{loc:[...], msg:'...', ...}, ...]
        detail = data.detail.map(d => {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : '';
          return field ? `${field}: ${d.msg}` : d.msg;
        }).join(' / ');
      } else if (data.detail) {
        detail = JSON.stringify(data.detail);
      }
    } catch (e) { /* ignore */ }
    // Sunucu hatası kayda geçer - hangi uç, hangi kod, ne mesaj
    if (typeof reportIssue === 'function') {
      reportIssue(res.status >= 500 ? 'sunucu_hatasi' : 'istek_hatasi',
                  `${res.status} ${path}: ${detail}`, '');
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const api = {
  get: (path) => apiFetch(path),
  post: (path, json) => apiFetch(path, { method: 'POST', json }),
  put: (path, json) => apiFetch(path, { method: 'PUT', json }),
  del: (path) => apiFetch(path, { method: 'DELETE' }),
};
