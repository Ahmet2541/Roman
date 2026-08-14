// DAVRANIŞ TESTİ: modülleri yükleyip kritik akışları çalıştırır.
// Yakaladığı hata türleri (bu sohbette hepsi yaşandı):
//   - tanımsız değişken (ReferenceError) -> "3 öneri çalışmıyor"
//   - olmayan elemana yazma -> "Cannot set properties of null"
//   - yanlış uca istek -> sessizce çalışmayan düğmeler
require('./dom-stub.js');
// Modüller yüklenirken initApp gibi başlangıç kodları çalışabilir; bunlar
// gerçek DOM bekler. Yakalanmayan reddi/hataları teste dönüştürmek için
// süreç seviyesinde toplarız - test ÇÖKMEZ, hata RAPORLANIR.
const baslangicHatalari = [];
process.on('unhandledRejection', (e) => baslangicHatalari.push(String(e && e.message || e)));
process.on('uncaughtException', (e) => baslangicHatalari.push(String(e && e.message || e)));
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MODULES = path.join(__dirname, '..', '..', 'frontend', 'js', 'modules');
const sonuc = { yuklendi: [], hatalar: [], testler: [] };

// Modülleri tek bir global bağlamda sırayla çalıştır (tarayıcıdaki gibi)
const ctx = vm.createContext(global);
for (const f of fs.readdirSync(MODULES).sort()) {
  const kod = fs.readFileSync(path.join(MODULES, f), 'utf8');
  try {
    vm.runInContext(kod, ctx, { filename: f });
    sonuc.yuklendi.push(f);
  } catch (e) {
    sonuc.hatalar.push({ dosya: f, hata: `${e.name}: ${e.message}` });
  }
}

function test(ad, fn) {
  try { fn(); sonuc.testler.push({ ad, ok: true }); }
  catch (e) { sonuc.testler.push({ ad, ok: false, hata: `${e.name}: ${e.message}` }); }
}

// --- 1. Kritik fonksiyonlar tanımlı mı ---
test('kritik fonksiyonlar tanımlı', () => {
  for (const ad of ['switchView', 'renderReader', 'openChapterWorkshop', 'workshopFix',
                    'verifyBeforeApply', 'replaceParagraphText', 'el', 'renderFindingChips',
                    'buildParagraphDirectives', 'parseOptionBlocks', 'quickFactCheck']) {
    if (typeof global[ad] !== 'function') throw new Error(`${ad} tanımsız`);
  }
});

// --- 2. el() olmayan elemanda ÇÖKMEZ ---
test('el() olmayan elemanda çökmez', () => {
  const x = el('kesinlikle-yok-boyle-bir-id');
  x.innerHTML = 'deneme';       // çökmemeli
  x.style.display = 'none';
  x.addEventListener('click', () => {});
});

// --- 3. Seçenek ayrıştırma (Türkçe I/ı tuzağı dahil) ---
test('parseOptionBlocks üç biçimi de ayrıştırır', () => {
  const bicimler = [
    '###YAKLAŞIM: a | NEDEN: x\nMetin A.\n###YAKLAŞIM: b | NEDEN: y\nMetin B.',
    '###Yaklaşım: a\nMetin A.\n###Yaklaşım: b\nMetin B.',      // doğal Türkçe
    '### a\nMetin A.\n### b\nMetin B.',
  ];
  for (const b of bicimler) {
    const r = parseOptionBlocks(b);
    if (r.length !== 2) throw new Error(`beklenen 2, gelen ${r.length}: ${b.slice(0, 20)}`);
    if (!r[0].text.includes('Metin A')) throw new Error('metin kayboldu');
  }
  if (parseOptionBlocks('').length !== 0) throw new Error('boş girdi boş dönmeli');
});

// --- 4. Deterministik kontrol: cümle başı kelimeler isim SAYILMAZ ---
test('quickFactCheck cümle başı kelimeyi isim saymaz', () => {
  global.window.__canonNames = ['Vicdan'];
  const temiz = quickFactCheck('Ama çatlak vardı. Sonra sustu.', 'Çatlak vardı; ardından sustu.');
  if (temiz.length) throw new Error('haksız uyarı: ' + temiz.join(', '));
  const kayip = quickFactCheck('Vicdan 47. blokta.', 'Sistem blokta.');
  if (kayip.length !== 2) throw new Error('gerçek kayıp yakalanmadı: ' + JSON.stringify(kayip));
});

// --- 5. Direktif sentezi: işlev + koru + kaçın ---
test('buildParagraphDirectives koru listesi üretir', () => {
  const d = buildParagraphDirectives(1,
    [{ kaynak: 'okur', baslik: 'Klişe', sorun: 'yargı sıfatı', oneri: 'tozla göster' }],
    'On santimetre cam. Vicdan bekledi.');
  if (!d.includes('DEĞİŞTİR')) throw new Error('bulgular girmedi');
  if (!d.includes('KORU')) throw new Error('koru listesi yok');
  if (!d.includes('EN KÜÇÜK ETKİLİ')) throw new Error('en küçük müdahale kuralı yok');
  if (!d.includes('YENİ BİLGİ EKLEME YASAĞI')) throw new Error('kanon yasağı yok');
});

// --- 6. Fark vurgulama tıklanabilir öbek üretir ---
test('highlightDiff değişen öbeği işaretler', () => {
  const h = highlightDiff('Bir cam vardı.', 'Bir kalın cam vardı.');
  if (!h.includes('diff-clickable')) throw new Error('tıklanabilir öbek yok');
  if (!h.includes('kalın')) throw new Error('yeni kelime kayboldu');
});

// Başlangıç hataları yalnızca BİLGİ - gerçek tarayıcıda DOM var olduğu
// için bunların çoğu orada oluşmaz. Modül YÜKLEME hataları ise gerçek.
sonuc.baslangic_uyarilari = baslangicHatalari.slice(0, 5);
console.log(JSON.stringify(sonuc, null, 1));
