// ===========================================================================
// 01-core.js — Sabitler, yardımcılar, tür tanımları
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

// ---------------------------------------------------------------------------
// AI ODALARI: aynı motor, beş ön ayar. Her oda bağlam kapsamını, hangi
// araçların görüneceğini ve sohbetin çerçevesini belirler - ama DUVAR
// değildir: @isim ile her odada dışarıdan varlık çağırabilirsin. Her odanın
// kendi sohbet geçmişi vardır (karakter tartışması, bölüm tartışmasını
// kirletmesin diye).
// ---------------------------------------------------------------------------
const AI_ROOMS = {
  chapter: {
    icon: '📖', label: 'Bu Bölüm', scope: 'chapter', showPlan: true, showPicker: true, short: 'Bölüm',
    hint: 'Bölümün metni, planı ve özeti AI\'ya gider - sahne yazma, tartışma, devam ettirme.',
    frame: 'Bu sohbette ÜZERİNDE ÇALIŞILAN BÖLÜM konuşulacak: metni, planı, akışı ve sahneleri. Kısa ve somut konuş.',
    starters: ['Bu bölüm önceki bölümle bağlanıyor mu?', 'Bu bölümde tempo nerede düşüyor?', 'Plandaki hangi madde henüz işlenmemiş?'],
  },
  people: {
    icon: '👤', label: 'Kişiler', scope: 'none', showPlan: false, showPicker: true, short: 'Kişi',
    hint: 'Bölüm metni GİTMEZ - sadece seçili kişilerin profilleri. Karakter tutarlılığı ve ses için.',
    frame: 'Bu sohbette KARAKTERLER konuşulacak: profilleri, sesleri, tutarlılıkları, ilişkileri. Bölüm metni verilmedi; gerekirse sor.',
    starters: ['Bu karakterin sesi tutarlı mı?', 'Profilinde eksik ne var?', 'Bu karakteri diğerlerinden ne ayırıyor?'],
  },
  world: {
    icon: '📍', label: 'Mekân & Nesne', scope: 'none', showPlan: false, showPicker: true, short: 'Mekân',
    hint: 'Seçili mekan/nesnelerin profilleri gider. Dünya tutarlılığı ve atmosfer için.',
    frame: 'Bu sohbette MEKANLAR ve NESNELER konuşulacak: fiziksel yapı, atmosfer, kurallar, işlev. Bölüm metni verilmedi.',
    starters: ['Bu mekanın atmosferi nasıl güçlenir?', 'Bu nesnenin kuralları çelişiyor mu?', 'Mekan profilinde ne eksik?'],
  },
  paragraph: {
    icon: '✍️', label: 'Paragraf', scope: 'chapter', showPlan: false, showPicker: true, short: 'Paragraf',
    hint: 'Bölüm metni gider; "P12" gibi numarayla nokta atışı çalışırsın. Yanıt beğenilirse tek tıkla paragrafın yerine geçer.',
    frame: 'Bu sohbette TEK TEK PARAGRAFLAR üzerinde çalışılacak. Kullanıcı "P12" gibi numaralarla atıf yapar; yanıtların doğrudan o paragrafın yerine geçebilecek nitelikte, temiz metin olsun (açıklama ekleme).',
    starters: ['P1\'i daha gergin bir tonda yaz', 'Bu paragrafta hangi kelimeler fazla?', 'P2 ile P3 arasındaki geçiş pürüzlü mü?'],
  },
  novel: {
    icon: '🌍', label: 'Roman Geneli', scope: 'novel', showPlan: false, showPicker: false, short: 'Roman',
    hint: 'TÜM KİTABIN metni gider (pahalı) - tutarlılık, yapı, tekrar ve sonuç soruları için.',
    frame: 'Bu sohbette ROMANIN TAMAMI konuşulacak: yapı, tutarlılık, tekrarlar, karakter yayları, açık kalan ipuçları. Bulgularını bölüm numaralarıyla göster.',
    starters: ['Açık kalan ipuçları hangileri?', 'Hangi bölümler birbirini tekrar ediyor?', 'Karakter yayları tutarlı mı?'],
  },
};
let currentAiRoom = 'chapter';
const aiRoomHistories = {};

// Derin profil bölüm tanımları - backend'deki app/sections.py ile senkron
// tutulmalı (anahtarlar birebir aynı olmak ZORUNDA, backend bilinmeyen
// anahtarı 422 ile reddeder). "meta" AI'ya asla gönderilmez - formda da
// öyle etiketlenir. AI'ya açık 5 başlık + meta = 6.
const ENTITY_SECTIONS = {
  character: [
    { key: 'fiziksel_yapi', label: 'Fiziksel Yapı', hint: 'görünüş, boy/kilo/saç/göz, ayırt edici özellikler, giyim' },
    { key: 'duygusal_yapi', label: 'Kişilik & İç Dünya', hint: 'kişilik tipi, güçlü/zayıf yanlar, korkular, arzular, iç çatışma, karakter arc\'ı' },
    { key: 'gecmis', label: 'Geçmiş & Köken', hint: 'nereli, ait olduğu grup, meslek/kariyer, sırlar, travmalar, dönüm noktaları' },
    { key: 'iliskiler', label: 'İlişkiler', hint: 'aile/dost/düşman/aşk üzerine öznel notlar (harita için İlişkiler menüsü ayrı)' },
    { key: 'konusma_tarzi', label: 'Konuşma Tarzı', hint: 'üslup, sık kullandığı sözler, ses tonu, beden dili' },
    { key: 'gizli', label: '🔒 Gizli Katman', hint: 'sonraki kitapların sırrı: gizli bağlantılar, açığa çıkmamış motivasyonlar - AI\'ya normalde GİTMEZ, alt-metin moduyla sızdırmama direktifiyle verilir', isHidden: true },
    { key: 'meta', label: 'Meta (yazar notu)', hint: 'sembolizm, roman içindeki işlevi - AI\'ya ASLA gönderilmez', isMeta: true },
  ],
  place: [
    { key: 'fiziksel_yapi', label: 'Fiziksel Yapı', hint: 'mimari, boyut, düzen, malzeme, renk paleti, ayırt edici detaylar' },
    { key: 'atmosfer', label: 'Atmosfer & Zamansal Değişim', hint: 'ışık, ses, koku, his; saate/mevsime/olaylara göre değişim' },
    { key: 'gecmis', label: 'Geçmiş & Sırlar', hint: 'tarih, efsaneler, sahiplik, gizli alanlar, saklı sırlar' },
    { key: 'kurallar', label: 'Kurallar & Dinamikler', hint: 'kanunlar, yasaklar, güç yapısı, ritüeller, tehlikeler' },
    { key: 'baglantilar', label: 'Bağlantılar', hint: 'yakın mekanlar, ulaşım, sınırlar, sakinler' },
    { key: 'gizli', label: '🔒 Gizli Katman', hint: 'mekanın açığa çıkmamış sırrı - AI\'ya normalde gitmez', isHidden: true },
    { key: 'meta', label: 'Meta (yazar notu)', hint: 'sembolizm, roman içindeki işlevi - AI\'ya ASLA gönderilmez', isMeta: true },
  ],
  object: [
    { key: 'fiziksel_yapi', label: 'Fiziksel Yapı', hint: 'görünüm, malzeme, boyut/ağırlık, işçilik, yıpranma/hasar' },
    { key: 'gecmis', label: 'Köken & Geçmiş', hint: 'kim/ne zaman yaptı, önceki sahipler, efsanesi, sırları' },
    { key: 'islev', label: 'İşlev & Güçler', hint: 'ne işe yarar, güçleri, sınırları/bedeli, kullanım kuralları' },
    { key: 'sahiplik', label: 'Sahiplik & Konum', hint: 'şu an kimde, nerede duruyor, kimler biliyor' },
    { key: 'gizli', label: '🔒 Gizli Katman', hint: 'nesnenin açığa çıkmamış gerçek doğası - AI\'ya normalde gitmez', isHidden: true },
    { key: 'meta', label: 'Meta (yazar notu)', hint: 'sembolizm, olay örgüsündeki rolü - AI\'ya ASLA gönderilmez', isMeta: true },
  ],
};

const ENTITY_TYPES = {
  character: { endpoint: '/characters/', label: 'Kişi', plural: 'Kişiler', hasStatus: true, statusOptions: ['aktif', 'pasif', 'öldü'], isRule: false, hasAliases: true },
  place: { endpoint: '/places/', label: 'Mekan', plural: 'Mekanlar', hasStatus: false, isRule: false, hasAliases: true },
  event: { endpoint: '/events/', label: 'Olay', plural: 'Olaylar', hasStatus: false, isRule: false, isCustom: true },
  object: { endpoint: '/objects/', label: 'Nesne', plural: 'Nesneler', hasStatus: false, isRule: false, hasAliases: true },
  foreshadowing: { endpoint: '/foreshadowings/', label: 'İpucu', plural: 'İpuçları', hasStatus: true, statusOptions: ['açık', 'kapandı'], isRule: false },
  term: { endpoint: '/glossary/', label: 'Terim', plural: 'Terimler', hasStatus: false, isRule: false },
  rule: { endpoint: '/rules/', label: 'Kural', plural: 'Roman Kuralları', hasStatus: false, isRule: true, hasTags: true },
  faction: { endpoint: '/factions/', label: 'Grup / Kurum', plural: 'Gruplar & Kurumlar', hasStatus: false, isRule: false },
};

const main = () => document.getElementById('mainContent');

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function truncate(str, n) { return str && str.length > n ? str.slice(0, n) + '…' : (str || ''); }

// Bölüm/Başlık/Alt Başlık metinleri bazen bir AI sohbetinden ya da başka bir
// yerden kopyala-yapıştır ile geliyor ve markdown işaretlerini ("> alıntı",
// "**kalın**" vb.) ham haliyle taşıyor. Fihriste bunlar olduğu gibi
// göründüğünde çirkin duruyor (ör. "> **DİJİTAL DOĞUMUN SANCILARI.**").
// Bu fonksiyon hem yeni girilen metni temizlemek hem de daha önce böyle
// kaydedilmiş eski verileri EKRANDA düzgün göstermek için kullanılır -
// veritabanındaki veriyi değiştirmez, sadece görüntüyü/yeni girdiyi temizler.
function stripMarkdownArtifacts(str) {
  if (!str) return str || '';
  let s = String(str).trim();
  // Başındaki "> " / ">> " gibi alıntı (blockquote) işaretlerini temizle
  s = s.replace(/^>+\s*/, '');
  // Başındaki "#", "##" başlık işaretleri (boşluksuz "#BİRİNCİ" dahil) -
  // içe aktarılan el yazmalarında başlıklar markdown # ile gelebiliyor
  s = s.replace(/^#+\s*/, '');
  // **kalın** ve __kalın__
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/__(.+?)__/g, '$1');
  // *italik* ve _italik_ (kelime ortasındaki tekil * / _ karakterlerine dokunma)
  s = s.replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$)/g, '$1$2');
  s = s.replace(/(^|\s)_(\S.*?\S|\S)_(?=\s|$)/g, '$1$2');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// HATA AJANI (istemci tarafı). Tarayıcıda oluşan hataları yakalar ve
// sunucuya bildirir. Neden: bu projedeki arayüz hatalarının hepsini
// kullanıcı ekran görüntüsüyle bildirdi - hata kutusu çıkıp kayboluyor,
// ne zaman/hangi ekranda/hangi eylemde olduğu kayıt altına alınmıyordu.
// Artık sistem kendi hatasını raporluyor.
//
// Gizlilik: metin İÇERİĞİ gönderilmez - yalnızca hata mesajı, yığın izi ve
// bağlam (ekran + son eylem).
// ---------------------------------------------------------------------------
let __lastAction = '';
function noteAction(ad) { __lastAction = String(ad || '').slice(0, 120); }

async function reportClientError(message, stack) {
  try {
    await api.post('/diagnostics/client-error', {
      message: String(message || '').slice(0, 500),
      stack: String(stack || '').slice(0, 2000),
      view: (typeof currentView !== 'undefined' ? currentView : '') || '',
      action: __lastAction,
      url: (window.location && window.location.hash) || '',
    });
  } catch (e) { /* bildirim başarısızsa sessiz kal - hata döngüsü kurma */ }
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', (e) => {
    reportClientError(e.message, e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    reportClientError(r && r.message ? r.message : String(r), r && r.stack);
  });
}
