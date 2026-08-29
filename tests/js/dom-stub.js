// Minimal DOM/tarayıcı taklidi: modülleri Node'da çalıştırıp DAVRANIŞ
// testi yapabilmek için. Amaç piksel doğruluğu değil - "düğme bağlandı mı,
// tanımsız değişken var mı, çağrılan uç doğru mu" sorularını yakalamak.
// Bu sohbetteki arayüz hatalarının hepsi bu seviyede görünürdü.

class FakeEl {
  constructor(id = '', tag = 'div') {
    this.id = id; this.tagName = tag.toUpperCase();
    this._html = ''; this.textContent = ''; this.value = '';
    this.style = new Proxy({}, { get: (t, k) => t[k] || '', set: (t, k, v) => (t[k] = v, true) });
    this.dataset = {}; this.children = []; this.listeners = {};
    this.classList = { _s: new Set(), add(x) { this._s.add(x); }, remove(x) { this._s.delete(x); },
      toggle(x, f) { f === undefined ? (this._s.has(x) ? this._s.delete(x) : this._s.add(x)) : (f ? this._s.add(x) : this._s.delete(x)); },
      contains(x) { return this._s.has(x); } };
    this.checked = false; this.disabled = false;
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); document._index(this); }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener() {}
  // Gerçek tarayıcıda input/change olayları autocomplete ve canlı
  // sayaçları tetikliyor - taklit bunları çalıştırmazsa o kod yolları
  // hiç sınanmamış olur.
  dispatchEvent(ev) {
    const tur = (ev && ev.type) || String(ev);
    (this.listeners[tur] || []).forEach(f => f({ target: this, type: tur,
      stopPropagation() {}, preventDefault() {} }));
    return true;
  }
  click() { (this.listeners.click || []).forEach(f => f({ target: this, stopPropagation() {}, preventDefault() {} })); }
  querySelector(sel) {
    // Sınıf seçicisi: yazılan HTML'de o sınıf geçiyorsa kalıcı bir sahte
    // eleman döndür (uygulama .workshop-body gibi kapsayıcıları böyle buluyor)
    if (typeof sel === 'string' && sel.startsWith('.') && this._html.includes(sel.slice(1))) {
      this._alt = this._alt || {};
      if (!this._alt[sel]) this._alt[sel] = new FakeEl('', 'div');
      return this._alt[sel];
    }
    return document.querySelector(sel, this);
  }
  querySelectorAll(sel) { return document.querySelectorAll(sel, this); }
  insertAdjacentHTML(pos, html) { this._html += html; document._index(this); }
  insertAdjacentElement(pos, el) { this.children.push(el); return el; }
  appendChild(el) {
    this.children.push(el);
    // parentElement: uygulama bir alanın yanına sayaç/öneri kutusu
    // eklerken bunu kullanıyor. Taklitte yoksa o kod yolları sessizce
    // atlanır ve hiç sınanmamış olur.
    if (el) el.parentElement = this;
    // Oluşturulup gövdeye eklenen elemanlar getElementById ile bulunabilmeli
    // (uygulama kaplama/overlay'leri böyle kuruyor)
    if (el && el.id) document._els.set(el.id, el);
    return el;
  }
  remove() {}
  scrollIntoView() {}
  focus() {}
  closest() { return new FakeEl(); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get nextElementSibling() { return null; }
  // GERÇEK ebeveyni döndürür. Eskiden her çağrıda YENİ boş bir eleman
  // dönüyordu: uygulama bir alanın yanına sayaç/öneri kutusu eklediğinde
  // kutu hiçbir yere bağlanmıyor, o kod yolu sınanmış görünüp aslında
  // hiç doğrulanmamış oluyordu.
  get parentElement() { return this._parent || (this._parent = new FakeEl()); }
  set parentElement(v) { this._parent = v; }
}

const document = {
  _els: new Map(),
  _seenIds: new Set(),          // innerHTML içinde geçen id'ler
  body: new FakeEl('body'),
  createElement(tag) { return new FakeEl('', tag); },
  getElementById(id) {
    if (!this._els.has(id) && this._seenIds.has(id)) this._els.set(id, new FakeEl(id));
    return this._els.get(id) || null;
  },
  _index(el) {          // yazılan HTML'deki id'leri kaydet (sonradan bulunabilsin)
    const m = String(el._html).matchAll(/id="([\w-]+)"/g);
    for (const x of m) this._seenIds.add(x[1]);
  },
  // HER ZAMAN null döndürüyordu: uygulamanın querySelector ile bulduğu
  // her eleman testte "yok" sayılıyor, o kod yolları hiç çalıştırılmıyordu.
  // Panelde el() yerine querySelector'a geçince bu körlük ortaya çıktı.
  // Yazılan HTML'de id/sınıf geçiyorsa kalıcı bir sahte eleman döndür.
  querySelector(sel, kaynak) {
    const html = String((kaynak && kaynak._html) || '');
    const m = String(sel).match(/^[#.]([\w-]+)/);
    if (!m) return null;
    const ad = m[1];
    if (kaynak && !html.includes(ad)) return null;
    const anahtar = `__qs_${sel}`;
    if (!this._els.has(anahtar)) this._els.set(anahtar, new FakeEl(ad));
    return this._els.get(anahtar);
  },
  querySelectorAll(sel, kaynak) {
    const el = this.querySelector(sel, kaynak);
    return el ? [el] : [];
  },
  addEventListener() {},
  ensure(id) { const e = new FakeEl(id); this._els.set(id, e); return e; },
};

const localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
};

const window = {
  localStorage, addEventListener() {}, requestAnimationFrame(f) { f(); },
  getSelection: () => ({ toString: () => '' }),
  speechSynthesis: null, location: { href: '' },
};

global.document = document;
global.window = window;
global.localStorage = localStorage;
global.alert = () => {};
global.confirm = () => true;
global.navigator = { clipboard: { writeText() {} } };
global.FakeEl = FakeEl;

// Çağrılan API uçlarını kaydeden sahte istemci
const apiCalls = [];
global.apiCalls = apiCalls;
global.api = {
  get: async (u) => { apiCalls.push(['GET', u]); return global.__apiResponse?.(u) ?? []; },
  post: async (u, b) => { apiCalls.push(['POST', u, b]); return global.__apiResponse?.(u) ?? {}; },
  put: async (u, b) => { apiCalls.push(['PUT', u, b]); return global.__apiResponse?.(u) ?? {}; },
  del: async (u) => { apiCalls.push(['DELETE', u]); return {}; },
};
global.getToken = () => 'x';
global.getNovelId = () => 1;
global.setNovelId = () => {};
global.clearToken = () => {};
global.clearNovelId = () => {};
// Uygulamanın açılışta beklediği elemanlar - yoksa initApp çöker ve
// modüller yüklenemez. Gerçek tarayıcıda bunlar index.html'de vardır.
for (const id of ['novelSelectOverlay', 'novelListArea', 'app', 'mainArea',
                  'readerPane', 'chapterList', 'formContainer', 'entityList',
                  'sidebar', 'novelNameLabel', 'universeLabel']) {
  document.ensure(id);
}

// new Event('input') - uygulama kodu olay nesnesini böyle üretiyor.
global.Event = class { constructor(tur) { this.type = tur; } };

module.exports = { document, window, FakeEl, apiCalls };
