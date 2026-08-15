// ===========================================================================
// 07b-checks.js — KONTROL KAYIT DEFTERİ
//
// Neden bu dosya: analiz aşamaları eskiden tek bir fonksiyonun içinde sabit
// sırayla ve HEP BİRLİKTE çalışıyordu. Sonuçta (a) gereksiz kontrol
// kapatılamıyor, (b) yeni kontrol eklemek o fonksiyonu büyütüyor, (c) bir
// kontrol bozulunca hangisinin sorumlu olduğu belirsizleşiyordu.
//
// Artık her kontrol BAĞIMSIZ bir birim:
//   id        - kalıcı anahtar (tercih saklama)
//   label     - kullanıcıya görünen ad
//   hint      - ne işe yaradığı
//   cost      - kaba maliyet göstergesi (ucuz/orta/pahalı)
//   run       - çalıştırıcı: bölümü alır, ham sonucu döner
//   toFindings- ham sonucu PARAGRAF BULGULARINA çevirir (yoksa bulgu üretmez)
//   default   - varsayılan açık mı
//
// Kapatılan kontrol hiç çalışmaz, bulgusu da olmaz. Tercihler roman bazında
// tarayıcıda saklanır.
// ===========================================================================

// NOT: `const` ile tanımlanan üst düzey değişkenler tarayıcıda script'ler
// arasında paylaşılır ama bazı çalıştırma ortamlarında (test sanal makinesi)
// paylaşılmaz. Bu yüzden kayıt defteri ayrıca window'a bağlanır - hem
// tarayıcıda hem testte aynı biçimde erişilir.
var KONTROLLER = [
  {
    id: 'literary',
    label: '📊 Edebî ölçütler',
    hint: '10 ölçütlü editör karnesi: betimleme, atmosfer, alt metin, ritim, karakterizasyon…',
    cost: 'pahalı',
    default: true,
    zorunlu: true,          // karne olmadan özet ekranı anlamsız kalır
    run: (ch) => api.post(`/ai/literary-review/${ch.id}`, {}),
    toFindings: (r) => (r.fixes || [])
      .filter(f => f.paragraph)
      .map(f => ({ p: f.paragraph, kaynak: 'editor', baslik: f.criterion || 'Edebî',
                   sorun: f.problem, oneri: f.fix })),
  },
  {
    id: 'reader',
    label: '🎯 Okur gözü',
    hint: 'Okuru düşüren noktalar: tempo, bilgi bocası, klişe, anlaşılırlık, diyalog sorunları.',
    cost: 'pahalı',
    default: true,
    run: (ch) => api.post(`/ai/reader-test/${ch.id}`, {}),
    toFindings: (r) => (r.findings || [])
      .filter(f => f.paragraph_number)
      .map(f => ({ p: f.paragraph_number, kaynak: 'okur',
                   baslik: READER_TEST_TYPE_LABELS[f.type] || f.type,
                   sorun: f.reason, oneri: f.suggestion, alinti: f.quote })),
  },
  {
    id: 'voice',
    label: '🗣 Anlatıcı ve odak',
    hint: 'Bakış açısı kayması, anlatıcının bilemeyeceği bilgi, mesafe/zaman kayması. Diyalogsuz bölümlerde kapatılabilir.',
    cost: 'orta',
    default: true,
    run: (ch) => api.post(`/ai/voice-scan/${ch.id}`, {}),
    // Yalnızca KESİN ihlaller bulgu olur - "belirsiz" bilinçli teknik olabilir
    toFindings: (r) => (r.violations || [])
      .filter(v => v.certainty === 'kesin' && v.paragraph)
      .map(v => ({ p: v.paragraph, kaynak: 'ses',
                   baslik: ({ bakis_kaymasi: 'Bakış açısı kayması', bilgi_asimi: 'Anlatıcı bilgi aşımı',
                              mesafe_kaymasi: 'Mesafe kayması', yorum_sizmasi: 'Yorum sızması',
                              zaman_kaymasi: 'Zaman kayması' })[v.type] || v.type,
                   sorun: v.problem, oneri: v.fix, alinti: v.evidence })),
    onDone: (r) => { workshopState.voice = r; },
  },
  {
    id: 'roles',
    label: '🎯 Paragraf işlevleri',
    hint: 'Her paragrafın sahnedeki görevini çıkarır ("olay mahalli tanıtılıyor"). Yeniden yazımın ölçüsü olur.',
    cost: 'orta',
    default: true,
    run: (ch) => api.post(`/ai/paragraph-roles/${ch.id}`, {}),
    toFindings: () => [],   // bulgu üretmez, işlev doldurur
    onDone: (r) => {
      (r.roles || []).forEach(x => {
        if (!paraPurposes[x.p]) paraPurposes[x.p] = x.role;
        workshopState.roleKinds = workshopState.roleKinds || {};
        workshopState.roleKinds[x.p] = x.kind;
      });
      saveParaState();
    },
  },
  {
    id: 'motif',
    label: '🎨 İmge/motif haritası',
    hint: 'Tüm paragrafların imgelerini çıkarıp tekrarları bulur; leitmotif ile tekrarı ayırır.',
    cost: 'pahalı',
    default: true,
    run: (ch) => api.post(`/ai/motif-map/${ch.id}`, {}),
    // Yalnızca KANITLI tekrarlar (güven ≥ %60) bulgu olur - kanıtsız
    // iddiadan öneri üretmek sistemin en tehlikeli davranışı
    toFindings: (r) => (r.repeats || [])
      .filter(x => x.kind === 'tekrar' && (x.confidence ?? 1) >= 0.6)
      .flatMap(x => (x.paragraphs || []).map(pn => ({
        p: pn, kaynak: 'imge', baslik: `İmge tekrarı: ${x.image}`,
        sorun: `${x.reason || ''} (P${(x.paragraphs || []).join(', P')} aynı imgeyi taşıyor)`,
        oneri: x.fix || 'Bu paragrafta imgeyi değiştir ya da yeni bir katman ekle.',
      }))),
    onDone: (r) => { workshopState.motif = r; },
  },
];

// Açık/kapalı tercihleri (roman bazında kalıcı)
function kontrolAcikMi(id) {
  const k = KONTROLLER.find(x => x.id === id);
  if (!k) return false;
  if (k.zorunlu) return true;
  try {
    const kayit = JSON.parse(localStorage.getItem(`roman_checks_${getNovelId() || 0}`) || '{}');
    return kayit[id] ?? k.default;
  } catch (e) { return k.default; }
}

function kontrolAyarla(id, acik) {
  try {
    const anahtar = `roman_checks_${getNovelId() || 0}`;
    const kayit = JSON.parse(localStorage.getItem(anahtar) || '{}');
    kayit[id] = !!acik;
    localStorage.setItem(anahtar, JSON.stringify(kayit));
  } catch (e) { /* depolama yoksa varsayılanla devam */ }
}

function acikKontroller() {
  return KONTROLLER.filter(k => kontrolAcikMi(k.id));
}

// Kontrol seçim şeridi: hangi analizlerin çalışacağını kullanıcı seçer.
function renderKontrolSecici(kapsayiciId) {
  const kap = el(kapsayiciId);
  if (!kap || !kap.innerHTML === undefined) return;
  const maliyetRenk = { ucuz: '#3f7a4f', orta: '#b08d3f', pahalı: 'var(--danger)' };
  kap.innerHTML = `
    <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">ÇALIŞACAK KONTROLLER</div>
    <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">
      ${KONTROLLER.map(k => `
        <label style="display:flex;align-items:flex-start;gap:6px;font-size:12.5px;cursor:${k.zorunlu ? 'default' : 'pointer'};opacity:${k.zorunlu ? 0.75 : 1};">
          <input type="checkbox" class="kontrol-kutu" data-id="${k.id}"
            ${kontrolAcikMi(k.id) ? 'checked' : ''} ${k.zorunlu ? 'disabled' : ''}>
          <span style="flex:1;min-width:0;">
            <b>${k.label}</b>
            <span style="font-size:10px;color:${maliyetRenk[k.cost]};">· ${k.cost}</span>
            ${k.zorunlu ? '<span style="font-size:10px;color:var(--text-muted);">· zorunlu</span>' : ''}
            <div style="color:var(--text-muted);font-size:11.5px;">${k.hint}</div>
          </span>
        </label>`).join('')}
    </div>`;
  kap.querySelectorAll('.kontrol-kutu').forEach(b => b.addEventListener('change', () => {
    kontrolAyarla(b.dataset.id, b.checked);
  }));
}


// Global erişim (tarayıcı + test ortamı)
if (typeof window !== 'undefined') {
  window.KONTROLLER = KONTROLLER;
  window.kontrolAcikMi = kontrolAcikMi;
  window.kontrolAyarla = kontrolAyarla;
  window.acikKontroller = acikKontroller;
  window.renderKontrolSecici = renderKontrolSecici;
}
