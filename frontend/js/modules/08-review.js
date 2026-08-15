// ===========================================================================
// 08-review.js — Denetim menüsü, bölüm incelemesi, teşhis füzyonu
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

function renderDenetimView(view) {
  // Eski menü yolları (fullscan/stylescan) doğrudan ilgili sekmeyi açar
  if (view === 'fullscan' || view === 'stylescan') currentDenetimTab = view;
  main().innerHTML = `
    <h1 class="view-title">Denetim</h1>
    <p style="color:var(--text-muted);font-size:13.5px;max-width:680px;">
      Metni kontrol eden tüm araçlar burada. <b>Tutarlılık</b> ve <b>Üslup</b> roman genelini tarar;
      <b>Bölüm İncelemesi</b> tek bir bölüme odaklanır.
    </p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;">
      ${Object.entries(DENETIM_SEKMELERI).map(([key, t]) => `
        <button class="btn btn-sm denetim-tab${key === currentDenetimTab ? ' btn-primary' : ''}" data-tab="${key}">${t.label}</button>`).join('')}
    </div>
    <div id="denetimHint" style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;"></div>
    <div id="denetimBody"></div>`;

  const goster = (key) => {
    currentDenetimTab = key;
    document.querySelectorAll('.denetim-tab').forEach(b => b.classList.toggle('btn-primary', b.dataset.tab === key));
    el('denetimHint').textContent = DENETIM_SEKMELERI[key].hint;
    DENETIM_SEKMELERI[key].render(document.getElementById('denetimBody'));
  };
  document.querySelectorAll('.denetim-tab').forEach(b =>
    b.addEventListener('click', () => goster(b.dataset.tab)));
  goster(currentDenetimTab);
}

// ---------------------------------------------------------------------------
// YAPISAL AKIŞ TARAMASI (bölümler arası). Diğer denetimler TEK bölüme ya da
// cümlelere bakar; buradaki sorunlar ancak bölümler ARASI okununca görünür:
// nedensellik kopukluğu ("ve sonra" zinciri), tekrar eden çatışma, sabit
// kalan bahis, ölü bölgeler. Özetlerle çalışır - ucuzdur.
// ---------------------------------------------------------------------------
async function renderStructureScan(el) {
  el.innerHTML = `
    <p style="font-size:13.5px;color:var(--text-muted);max-width:680px;margin-top:0;">
      Editörlerin klasik testleri: her bölümün sonucu bir sonrakinin hedefini doğuruyor mu
      (<b>"bu yüzden"</b> mi, yoksa <b>"ve sonra"</b> mı), aynı çatışma tekrarlanıyor mu,
      bahis yükseliyor mu, çıkarılsa fark edilmeyecek bölüm var mı. Bölüm ÖZETLERİ kullanılır.
    </p>
    <button class="btn btn-primary" id="startStructureScan">Yapısal Taramayı Başlat</button>
    <div id="structureResult" style="margin-top:14px;">${(() => {
      const onceki = loadGlobalScan('structure');
      return onceki ? `<div style="font-size:11.5px;color:var(--text-muted);background:var(--paper-dim);padding:6px 8px;border-radius:6px;">
        📦 Son tarama ${scanAgeLabel(onceki)}${onceki.veri.summary ? ' · ' + escapeHtml(truncate(onceki.veri.summary, 100)) : ''}</div>` : '';
    })()}</div>`;

  el.querySelector('#startStructureScan').addEventListener('click', async () => {
    const box = el.querySelector('#structureResult');
    box.innerHTML = '<div class="empty-state">Bölüm zinciri inceleniyor…</div>';
    try {
      const r = await api.post('/ai/structure-scan', {});
      saveGlobalScan('structure', r);   // sonuç saklanır
      const trendRenk = { 'yükseliyor': '#3f7a4f', 'sabit': '#b08d3f', 'düşüyor': 'var(--danger)' }[r.stakes?.trend] || 'var(--text-muted)';
      const blok = (baslik, icerik) => icerik ? `<div style="margin-top:12px;"><strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">${baslik}</strong>${icerik}</div>` : '';
      box.innerHTML = `
        <div class="panel">
          ${r.summary ? `<div style="font-size:13px;">${escapeHtml(r.summary)}</div>` : ''}
          ${r.missing_summaries.length ? `<div style="font-size:12px;color:var(--danger);margin-top:6px;">⚠ Özeti olmayan ${r.missing_summaries.length} bölüm taramaya girmedi (Bölüm ${r.missing_summaries.join(', ')}). Zincirde kör nokta oluşturur - önce özetle.</div>` : ''}

          ${r.stakes?.trend ? `<div style="margin-top:10px;font-size:13px;">📈 <b>Bahis eğrisi:</b> <span style="color:${trendRenk};font-weight:600;">${escapeHtml(r.stakes.trend)}</span> — ${escapeHtml(r.stakes.comment || '')}</div>` : ''}

          ${blok('NEDENSELLİK ZİNCİRİ ("bu yüzden" testi)', r.causality.map(c => `
            <div style="border-left:3px solid ${c.link && c.link.includes('sonra') ? 'var(--danger)' : 'var(--border)'};padding-left:10px;margin-top:8px;font-size:12.5px;">
              <b>Bölüm ${c.from} → ${c.to}</b> <span style="color:var(--text-muted);">bağ: "${escapeHtml(c.link || '?')}"</span>
              <div style="color:var(--text-muted);">${escapeHtml(c.problem || '')}</div>
              ${c.fix ? `<div>→ ${escapeHtml(c.fix)}</div>` : ''}
            </div>`).join(''))}

          ${blok('TEKRAR EDEN ÇATIŞMA', r.repetition.map(x => `
            <div style="border-left:3px solid var(--gold);padding-left:10px;margin-top:8px;font-size:12.5px;">
              <b>Bölüm ${x.chapters.join(', ')}</b>
              <div style="color:var(--text-muted);">${escapeHtml(x.problem || '')}</div>
              ${x.fix ? `<div>→ ${escapeHtml(x.fix)}</div>` : ''}
            </div>`).join(''))}

          ${blok('ÖLÜ BÖLGELER', r.dead_zones.map(d => `
            <div style="border-left:3px solid var(--danger);padding-left:10px;margin-top:8px;font-size:12.5px;">
              <b>Bölüm ${d.chapter ?? '?'}</b>
              <div style="color:var(--text-muted);">${escapeHtml(d.reason || d.problem || '')}</div>
              ${d.fix ? `<div>→ ${escapeHtml(d.fix)}</div>` : ''}
            </div>`).join(''))}

          ${blok('BÖLÜM KAPANIŞLARI', r.endings.map(e => `
            <div style="border-left:3px solid var(--border);padding-left:10px;margin-top:8px;font-size:12.5px;">
              <b>Bölüm ${e.chapter ?? '?'}</b>
              <div style="color:var(--text-muted);">${escapeHtml(e.problem || e.reason || '')}</div>
              ${e.fix ? `<div>→ ${escapeHtml(e.fix)}</div>` : ''}
            </div>`).join(''))}
        </div>`;
    } catch (err) {
      box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });
}

// Paragraf işlevleri (oturum boyunca bellekte): { "7": "Yangın yerini masum
// göstermek..." }. Yeniden yazımın ÖLÇÜSÜ budur - talimatların en başına
// konur ve kabul kontrolünde "işini yapıyor mu" sorusuna kaynak olur.

// Eleman yoksa sessizce geçen güvenli yazım. Asenkron bir yanıt döndüğünde
// kullanıcı çoktan başka ekrana geçmiş olabilir; o zaman hedef eleman DOM'da
// olmaz ve doğrudan .innerHTML ataması "Cannot set properties of null" ile
// çöker. Bu, düzenleme akışını kesen en sinsi hata türüydü.
function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
  return el;
}


// GÜVENLİ ELEMAN ERİŞİMİ: asenkron bir yanıt döndüğünde kullanıcı çoktan
// başka ekrana geçmiş olabilir; hedef eleman DOM'da olmaz ve doğrudan
// .innerHTML ataması "Cannot set properties of null" ile çöker - düzenleme
// akışını kesen en sinsi hata türü buydu. el() her zaman bir nesne döner;
// eleman yoksa yazımlar sessizce yok sayılır.
const _NULL_EL = new Proxy({}, {
  get: (t, k) => (k === 'style' || k === 'dataset' || k === 'classList') ? _NULL_EL
    : (typeof k === 'string' && ['addEventListener', 'remove', 'scrollIntoView', 'focus',
       'insertAdjacentHTML', 'insertAdjacentElement', 'querySelector', 'querySelectorAll',
       'toggle', 'add', 'contains', 'closest'].includes(k) ? (() => _NULL_EL) : undefined),
  set: () => true,
});
function el(id) { return document.getElementById(id) || _NULL_EL; }

// var: `const` bazı çalıştırma ortamlarında script'ler arası paylaşılmıyor
var paraPurposes = {};

// PARAGRAF UZUNLUK SINIRI: bu eşiği aşan paragraf kaydedilmeden önce
// bölünmesi istenir. Sert engel DEĞİL (yazının kaybolması en kötüsüdür)
// ama geçmek için bilinçli bir onay gerekir - "farkında olmadan 300
// kelimelik blok yazmak" böylece imkânsızlaşır.
const PARA_WORD_LIMIT = 150;

function wordCount(t) {
  return (t || '').trim().split(/\s+/).filter(Boolean).length;
}

// Uzun paragrafı bölme kapısı: sınır aşıldıysa önce bölmeyi teklif eder.
// Kullanıcı "yine de kaydet" derse geçer. true dönerse kaydetme DEVAM eder.
async function paragraphLengthGate(chapter, number, text, anchorEl) {
  const n = wordCount(text);
  if (n < PARA_WORD_LIMIT) return true;
  return new Promise((resolve) => {
    const kutu = document.createElement('div');
    kutu.style.cssText = 'margin-top:8px;border:1px solid #b08d3f;border-left:3px solid #b08d3f;'
      + 'border-radius:6px;padding:8px;font-size:12.5px;background:#fffdf6;';
    kutu.innerHTML = `
      <div style="color:#b08d3f;font-weight:600;">⚠ ${n} kelime - sınır ${PARA_WORD_LIMIT}</div>
      <div style="color:var(--text-muted);margin-top:2px;">
        Uzun paragraf okuma temposunu düşürür ve düzenlemesi zorlaşır.
        Bölme önerisinde metin DEĞİŞMEZ, sadece nereye paragraf arası konacağına karar verilir.
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
        <button class="btn btn-sm btn-primary lg-split" style="font-size:11.5px;">✂ Böl ve kaydet</button>
        <button class="btn btn-sm lg-keep" style="font-size:11.5px;">Yine de tek paragraf kaydet</button>
      </div>
      <div class="lg-result"></div>`;
    (anchorEl || document.body).insertAdjacentElement('afterend', kutu);
    kutu.querySelector('.lg-keep').addEventListener('click', () => { kutu.remove(); resolve(true); });
    kutu.querySelector('.lg-split').addEventListener('click', async (e) => {
      const b = e.target; b.disabled = true; b.textContent = 'Bölünüyor…';
      const sonuc = kutu.querySelector('.lg-result');
      try {
        const r = await api.post(`/chapters/${chapter.id}/split-preview`, { text });
        const parcalar = (r.paragraphs || []).map(x => x.text).filter(Boolean);
        if (parcalar.length < 2) {
          sonuc.innerHTML = '<div style="color:var(--text-muted);margin-top:6px;">Bölünecek doğal bir yer bulunamadı - tek paragraf kaydedilecek.</div>';
          setTimeout(() => { kutu.remove(); resolve(true); }, 1200);
          return;
        }
        sonuc.innerHTML = `
          <div style="margin-top:8px;">
            <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">${parcalar.length} PARÇA - metin değişmedi</div>
            ${parcalar.map((x, i) => `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);"><b>${i + 1}.</b> ${escapeHtml(truncate(x, 110))} <span style="color:var(--text-muted);">(${wordCount(x)} kelime)</span></div>`).join('')}
            <button class="btn btn-sm btn-primary lg-apply" style="margin-top:8px;width:100%;font-size:11.5px;">Bu şekilde kaydet</button>
          </div>`;
        sonuc.querySelector('.lg-apply').addEventListener('click', async () => {
          try {
            await applyParagraphSplit(chapter, number, parcalar);
            kutu.remove();
            resolve(false);   // kaydetme zaten bölme sırasında yapıldı
          } catch (err) { alert(err.message); }
        });
      } catch (err) {
        sonuc.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
        b.disabled = false; b.textContent = '✂ Böl ve kaydet';
      }
    });
  });
}

// İŞLEV MİRASI: 100 paragraflık bölümde her paragrafa elle işlev yazmak
// gerçekçi değil. Paragrafın kendi işlevi boşsa SAHNENİN işlevi (bölüm
// planı) kullanılır - plan zaten "bu bölümde ne olacak" diyor. Sadece
// istisna paragraflarda elle yazılır.
function effectiveParaPurpose(number) {
  const kendi = (paraPurposes[number] || '').trim();
  if (kendi) return { text: kendi, source: 'paragraf' };
  const plan = (window.__currentChapterPlan || '').trim();
  if (plan) return { text: plan, source: 'bölüm planı' };
  return { text: '', source: '' };
}

// Kalıcılık: işlevler ve paragraf kararları tarayıcıda saklanır - sayfa
// yenilenince ya da ertesi gün dönünce kaybolmasın.
// Çözülmüş bulgular: düzeltilip KAYDEDİLEN paragraflar. İncelemede tekrar
// önerilmez, gezinmede atlanır - "bir ileri bir geri" dönmeyi bitirir.
const resolvedParas = new Set();

function markParagraphResolved(number) {
  resolvedParas.add(String(number));
  saveParaState();
  // Okuyucudaki puan rozetini anında tazele (tam yeniden çizim olmadan)
  const rozet = document.querySelector(`.paragraph-number[data-pnum="${number}"] .para-score`);
  if (rozet) { rozet.textContent = '✓5'; rozet.style.color = '#3f7a4f'; }
  const kart = document.querySelector(`.finding-card[data-num="${number}"]`);
  if (kart) {
    kart.dataset.resolved = '1';
    kart.style.opacity = '0.5';
    kart.style.borderLeftColor = '#3f7a4f';
    const rozet = kart.querySelector('.finding-status');
    if (rozet) rozet.innerHTML = '<span style="color:#3f7a4f;font-weight:600;">✓ düzeltildi</span>';
    kart.querySelectorAll('.rt-fix, .review-chat').forEach(b => b.remove());
  }
  // Sıradaki ÇÖZÜLMEMİŞ bulguya otomatik ilerle
  if (typeof window.__gotoNextFinding === 'function') window.__gotoNextFinding();
}

function saveParaState() {
  try {
    localStorage.setItem(`roman_para_state_${currentChapter?.id || 0}`,
      JSON.stringify({ purposes: paraPurposes, chats: paraChatHistories, resolved: [...resolvedParas] }));
  } catch (e) { /* depolama dolu olabilir - sessiz geç */ }
}
function loadParaState(chapterId) {
  Object.keys(paraPurposes).forEach(k => delete paraPurposes[k]);
  Object.keys(paraChatHistories).forEach(k => delete paraChatHistories[k]);
  resolvedParas.clear();
  // Karşılaştırma temeli de bölüme özeldir - taşınırsa yanlış kıyas olur
  if (workshopState) workshopState.baseline = {};
  try {
    const raw = localStorage.getItem(`roman_para_state_${chapterId}`);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(paraPurposes, data.purposes || {});
    Object.assign(paraChatHistories, data.chats || {});
    (data.resolved || []).forEach(x => resolvedParas.add(String(x)));
  } catch (e) { /* bozuk kayıt - yoksay */ }
}

// ---------------------------------------------------------------------------
// KABUL KONTROLÜ: yeni versiyon paragrafa YAZILMADAN ÖNCE denetlenir.
// Zincirin son halkasıydı ve yoktu: metin üretiliyor, onaylanıyor, bitiyordu -
// işini yapıyor mu, somut detay düştü mü, komşuyla çelişti mi, yasak kalıp
// girdi mi kimse sormuyordu. Sayı/isim kaybı ve kalıp kontrolü
// deterministiktir (AI'ya sorulmaz).
// ---------------------------------------------------------------------------
// Deterministik ön kontrol (AI'sız, anlık): sayı ve özel isim kaybı.
// 100 paragraflık bölümde her uygulamada AI çağırmak hem pahalı hem yavaş;
// çoğu sorun zaten buradan yakalanıyor. AI kontrolü ancak burada bulgu
// çıkarsa ya da kullanıcı isterse çalışır.
function quickFactCheck(oldText, newText) {
  const sayilar = (t) => new Set((t || '').match(/\b\d+(?:[.,]\d+)?\b/g) || []);
  // İsim kontrolü KANON listesinden: "büyük harfle başlayan her kelime özel
  // isimdir" varsayımı cümle başı kelimeleri ("Ama", "Sonra") isim sanıyor,
  // cümle yapısı değişince haksız "isim düştü" uyarısı üretiyordu.
  const canon = window.__canonNames || [];
  const gecen = (t) => canon.filter(ad => (t || '').includes(ad));
  const kayipSayi = [...sayilar(oldText)].filter(x => !sayilar(newText).has(x));
  const kayipIsim = gecen(oldText).filter(ad => !newText.includes(ad));
  const bulgular = [];
  if (kayipSayi.length) bulgular.push(`Somut sayı düştü: ${kayipSayi.join(', ')}`);
  if (kayipIsim.length) bulgular.push(`Özel isim düştü: ${kayipIsim.join(', ')}`);
  return bulgular;
}

// Karşılaştırma temeli: sohbette tur tur ilerlerken referans ORİJİNAL
// kalırsa, 1. turda bilerek çıkardığın şey 4. turda hâlâ "kayıp" diye
// işaretlenir - sarmalın asıl kaynağı buydu. Temel her onaylanan/üretilen
// versiyonla İLERLER; kontrol yalnızca SON adımdaki sapmayı ölçer.
function verifyBaseline(number, fallbackOld) {
  workshopState.baseline = workshopState.baseline || {};
  return workshopState.baseline[number] || fallbackOld;
}
function setVerifyBaseline(number, metin) {
  workshopState.baseline = workshopState.baseline || {};
  if ((metin || '').trim()) workshopState.baseline[number] = metin.trim();
}

async function verifyBeforeApply(chapterId, number, oldText, newText) {
  const paras = (currentChapter?.paragraphs || []).slice().sort((a, b) => a.number - b.number);
  const idx = paras.findIndex(p => p.number === number);
  const clip = (t) => { const v = (t || '').trim(); return v.length > 300 ? v.slice(0, 300) + '…' : v; };
  const komsular = idx >= 0
    ? [...paras.slice(Math.max(0, idx - 1), idx), ...paras.slice(idx + 1, idx + 2)]
        .map(p => `[P${p.number}] ${clip(p.text)}`).join('\n')
    : '';
  try {
    return await api.post('/ai/verify-rewrite', {
      old_text: verifyBaseline(number, oldText), new_text: newText,
      purpose: effectiveParaPurpose(number).text, neighbors: komsular,
      // Önerinin AMACI: "metin değişti mi" değil "hedef gerçekleşti mi"
      proposal_goal: (workshopState.lastGoal && workshopState.lastGoal[number]) || '',
      expected_effect: (workshopState.diagnoses?.[number] || [])
        .filter(d => d.cls === 'hata' || d.cls === 'zayif')
        .map(d => `${d.title}${d.why ? ' — ' + d.why : ''}`).join(' | '),
      // KABUL EDİLEN DEĞİŞİKLİKLER: sohbette varılan kararlar. Bunlar
      // olmadan kontrol, bilerek yapılmış her çıkarmayı "anlam kaybı" diye
      // yeniden işaretliyor ve sonsuz döngü kuruluyordu.
      accepted_changes: acceptedChangesFor(number),
    });
  } catch (err) {
    return { verdict: 'kabul', hard_issues: [], issues: [], note: 'Kontrol yapılamadı: ' + err.message };
  }
}

// Kontrol sonucunu gösterir; kullanıcı yine de yazdırabilir (karar onun).
// Kademeli akış: önce ÜCRETSİZ deterministik kontrol gösterilir; temizse
// tek tıkla yazılır. Kullanıcı isterse (ya da bulgu varsa) AI'lı derin
// kontrol çalıştırılır.
function renderQuickCheck(oldText, newText, onApply, onDeep, onDiscuss) {
  const bulgular = quickFactCheck(oldText, newText);
  const temiz = !bulgular.length;
  const div = document.createElement('div');
  div.style.cssText = 'margin-top:8px;border:1px solid var(--border);border-left:3px solid '
    + (temiz ? '#3f7a4f' : 'var(--danger)') + ';border-radius:6px;padding:8px;';
  div.innerHTML = `
    <div style="font-size:12.5px;color:${temiz ? '#3f7a4f' : 'var(--danger)'};font-weight:600;">
      ${temiz ? '✓ Hızlı kontrol temiz (sayı/isim kaybı yok)' : '⚠ Hızlı kontrol uyarıyor'}
    </div>
    ${bulgular.length ? `<ul style="margin:6px 0 0 16px;padding:0;font-size:12px;">${bulgular.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
      <button class="btn btn-sm ${temiz ? 'btn-primary' : ''} qc-apply" style="font-size:11.5px;">${temiz ? 'Paragrafa yaz' : 'Yine de yaz'}</button>
      <button class="btn btn-sm qc-deep" style="font-size:11.5px;" title="İşlev, süreklilik ve eylem sırası için AI kontrolü (ek istek)">🔎 Derin kontrol</button>
      <button class="btn btn-sm qc-tradeoff" style="font-size:11.5px;" title="Bu öneri ne kazandırıyor, ne kaybettiriyor? Karşı argüman üretir.">⚖ Kazanç-kayıp</button>
      ${onDiscuss ? `<button class="btn btn-sm qc-discuss" style="font-size:11.5px;" title="Bulgular + metin + AI yorumu ile tartış">💬 AI ile sohbet et</button>` : ''}
      <button class="btn btn-sm qc-cancel" style="font-size:11.5px;">Vazgeç</button>
    </div>`;
  div.querySelector('.qc-apply').addEventListener('click', () => { div.remove(); onApply(); });
  div.querySelector('.qc-cancel').addEventListener('click', () => div.remove());
  // TAKILMAYI ÖNLEME: kontrol bir şey söylediğinde tek çıkış "yine de yaz"
  // ya da "vazgeç" olmasın - bulguları hesaba katıp yeniden üretebilmeli.
  // KAZANÇ-KAYIP: öneri sadece kazandırdığını değil KAYBETTİRDİĞİNİ de
  // göstermeli. Net negatifse sistem kendi önerisini reddeder.
  div.querySelector('.qc-tradeoff')?.addEventListener('click', async (e) => {
    const b = e.target;
    b.disabled = true; b.textContent = 'Ölçülüyor…';
    try {
      const t = await api.post('/ai/tradeoff', { old_text: oldText, new_text: newText });
      const renk = { uygula: '#3f7a4f', tartis: '#b08d3f', reddet: 'var(--danger)' }[t.recommend];
      const satir = (x, isaret) => `<div>${isaret} ${escapeHtml(x.dim)} ${x.score > 0 ? '+' : ''}${x.score} — <span style="color:var(--text-muted);">${escapeHtml(x.why)}</span></div>`;
      div.insertAdjacentHTML('beforeend', `
        <div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:6px;font-size:12px;">
          <div style="color:${renk};font-weight:600;">⚖ Net ${t.net > 0 ? '+' : ''}${t.net} · ${escapeHtml(t.recommend)}</div>
          ${t.gains.map(x => satir(x, '↑')).join('')}
          ${t.losses.map(x => satir(x, '↓')).join('')}
          ${t.counter_argument ? `<div style="margin-top:4px;color:var(--text-muted);">🤔 Karşı argüman: ${escapeHtml(t.counter_argument)}</div>` : ''}
        </div>`);
    } catch (err) {
      div.insertAdjacentHTML('beforeend', `<div class="error-text" style="font-size:11.5px;">${escapeHtml(err.message)}</div>`);
    }
    b.disabled = false; b.textContent = '⚖ Kazanç-kayıp';
  });
  div.querySelector('.qc-discuss')?.addEventListener('click', () => {
    onDiscuss(bulgular, '');
    div.remove();
  });
  div.querySelector('.qc-deep').addEventListener('click', async (e) => {
    const b = e.target;
    b.disabled = true; b.textContent = 'Kontrol ediliyor…';
    const v = await onDeep();
    b.disabled = false; b.textContent = '🔎 Derin kontrol';
    // Tur sayacı: aynı paragrafta kaçıncı derin kontrol
    window.__verifyRounds = window.__verifyRounds || {};
    const anahtar = (newText || '').slice(0, 40);
    window.__verifyRounds[anahtar] = (window.__verifyRounds[anahtar] || 0) + 1;
    const turSayisi = Object.values(window.__verifyRounds).reduce((a, b) => a + b, 0);
    div.insertAdjacentElement('afterend', renderVerifyResult(v, () => { div.remove(); onApply(); }, onDiscuss, turSayisi));
    div.querySelector('.qc-deep').remove();
  });
  return div;
}

function renderVerifyResult(v, onApply, onDiscuss, tur) {
  const renk = { kabul: '#3f7a4f', duzelt: '#b08d3f', red: 'var(--danger)' }[v.verdict] || 'var(--text-muted)';
  const etiket = { kabul: '✓ Kabul edilebilir', duzelt: '⚠ Düzeltilmeli', red: '✕ Reddedildi' }[v.verdict] || v.verdict;
  const tumBulgular = [...(v.hard_issues || []), ...(v.issues || [])];
  const div = document.createElement('div');
  div.style.cssText = 'margin-top:8px;border:1px solid var(--border);border-left:3px solid ' + renk + ';border-radius:6px;padding:8px;';
  div.innerHTML = `
    <div style="font-size:12.5px;color:${renk};font-weight:600;">${etiket}</div>
    ${v.note ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${escapeHtml(v.note)}</div>` : ''}
    ${tumBulgular.length ? `<ul style="margin:6px 0 0 16px;padding:0;font-size:12px;">${tumBulgular.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
    ${(tur || 0) >= 2 ? `<div style="font-size:11.5px;color:#b08d3f;margin-top:6px;padding:6px 8px;background:var(--paper-dim);border-radius:6px;">
      🔁 <b>${tur}. kontrol turu.</b> Kontrol aynı noktaları tekrar ediyor olabilir - her yeniden yazım
      yeni "kayıp"lar üretir. Metin senin gözünde iyiyse <b>"Yine de yaz"</b> demek doğru karardır.
    </div>` : ''}
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
      <button class="btn btn-sm ${v.verdict === 'kabul' || (tur || 0) >= 2 ? 'btn-primary' : ''} verify-apply" style="font-size:11.5px;">${v.verdict === 'kabul' ? 'Paragrafa yaz' : 'Yine de yaz'}</button>
      ${onDiscuss && tumBulgular.length ? `<button class="btn btn-sm btn-primary verify-discuss" style="font-size:11.5px;" title="Kontrol uyarıları + seçtiğin metin + AI yorumu ile tartış">💬 AI ile sohbet et</button>` : ''}
      <button class="btn btn-sm verify-cancel" style="font-size:11.5px;">Vazgeç</button>
    </div>`;
  div.querySelector('.verify-apply').addEventListener('click', () => { div.remove(); onApply(); });
  div.querySelector('.verify-cancel').addEventListener('click', () => div.remove());
  // ÇIKMAZ ÖNLEME: "uyarılara göre yeniden yaz" bağa giriyordu (aynı
  // uyarılar tekrar çıkıyor, döngü kapanmıyor). Yerine SOHBET: kontrol
  // uyarıları + seçilen metin + AI'nın kendi yorumu birlikte tartışılıyor -
  // en iyi sonucu bu veriyor, çünkü karar insanla birlikte veriliyor.
  div.querySelector('.verify-discuss')?.addEventListener('click', () => {
    onDiscuss(tumBulgular, v.note || '');
    div.remove();
  });
  return div;
}

// ---------------------------------------------------------------------------
// BÖLÜM ATÖLYESİ: yazılmış bir bölümü profesyonel biçimde elden geçirmek için
// tam ekran, adım adım akış. Mobilde asıl kullanılabilir mod budur - masaüstü
// panelleri küçük ekranda sıkışıyordu.
//   ADIM 1 HAZIRLIK: özet var mı (yoksa üret), zaman çizelgesi işlenmiş mi
//     (yoksa çalıştır), plan bağlı mı. Bunlar incelemenin KALİTESİNİ belirler:
//     özet yoksa AI bölümün ne olduğunu bilmez, plan yoksa işlevini bilmez.
//   ADIM 2 İNCELEME: editör gözü (10 ölçüt) + okur gözü, bulgular paragrafa
//     bağlanır.
//   ADIM 3 PARAGRAF PARAGRAF: tek ekranda tek paragraf - metni, bulguları,
//     3 seçenek, sohbet, kaydet ve ilerle. Çözülenler işaretlenir.
// ---------------------------------------------------------------------------
var workshopState = {
  chapter: null, findings: {}, order: [], idx: 0, literary: null,
  // Süpürme modunda bulgusu olmayan paragrafları atla (tercih hatırlanır)
  onlyFlagged: (() => { try { return localStorage.getItem('roman_ws_only_flagged') === '1'; } catch (e) { return false; } })(),
};

// ---------------------------------------------------------------------------
// SİSTEM SAĞLIĞI: hata ajanının topladığı arayüz hatalarını gösterir.
// Bir şey çalışmadığında kullanıcının ekran görüntüsü almasına gerek
// kalmaz - hata, bağlamıyla (hangi ekran, hangi eylem) burada durur.
// ---------------------------------------------------------------------------
async function renderHealthView(kap) {
  kap.innerHTML = '<div class="empty-state">Kayıtlar yükleniyor…</div>';
  try {
    const hatalar = await api.get('/diagnostics/client-errors');
    if (!hatalar.length) {
      kap.innerHTML = `
        <div class="panel" style="border-left:3px solid #3f7a4f;">
          <b style="color:#3f7a4f;">✓ Kayıtlı arayüz hatası yok</b>
          <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">
            Bir şey çalışmadığında hata burada otomatik kaydedilir - hangi ekranda ve
            hangi eylemde olduğu bilgisiyle. Ekran görüntüsü almana gerek yok.
          </div>
        </div>`;
      return;
    }
    // TÜRE GÖRE GRUPLAMA: hepsi "hata" değil - yavaş istek bir uyarı,
    // boş yanıt bir kalite sorunu. Karıştırmak önceliği bulanıklaştırıyor.
    const TUR = {
      hata:          { ad: '💥 Çökme',        renk: 'var(--danger)', not: 'Arayüz hatası - akış kesildi.' },
      sunucu_hatasi: { ad: '🔥 Sunucu hatası', renk: 'var(--danger)', not: 'AI ulaşılamadı ya da iç hata (5xx).' },
      ag_hatasi:     { ad: '📡 Bağlantı',      renk: 'var(--danger)', not: 'Sunucuya hiç ulaşılamadı.' },
      istek_hatasi:  { ad: '⚠ İstek reddedildi', renk: '#b08d3f',    not: 'Doğrulama/kısıt hatası (4xx).' },
      yavas_istek:   { ad: '🐢 Yavaş istek',   renk: '#b08d3f',      not: 'Hata değil ama akışı kesiyor.' },
      bos_yanit:     { ad: '🫥 Boş/eksik yanıt', renk: '#b08d3f',    not: 'AI istenen sayıda seçenek üretmedi.' },
    };
    const gruplar = {};
    hatalar.forEach(h => { (gruplar[h.kind || 'hata'] = gruplar[h.kind || 'hata'] || []).push(h); });
    const toplamAdet = hatalar.reduce((t, h) => t + (h.count || 1), 0);
    kap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="font-size:13px;"><b>${hatalar.length}</b> farklı kayıt · ${toplamAdet} olay</div>
        <button class="btn btn-sm" id="healthClear">Kayıtları temizle</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        ${Object.entries(gruplar).map(([t, liste]) => `
          <span style="font-size:11.5px;border:1px solid ${(TUR[t] || TUR.hata).renk};color:${(TUR[t] || TUR.hata).renk};
            border-radius:999px;padding:2px 9px;" title="${(TUR[t] || TUR.hata).not}">
            ${(TUR[t] || TUR.hata).ad}: ${liste.length}</span>`).join('')}
      </div>
      ${hatalar.map(h => `
        <div class="panel" style="margin-top:8px;border-left:3px solid ${(TUR[h.kind] || TUR.hata).renk};">
          <div style="font-size:10.5px;color:${(TUR[h.kind] || TUR.hata).renk};letter-spacing:0.3px;">${(TUR[h.kind] || TUR.hata).ad}</div>
          <div style="font-size:12.5px;font-weight:600;color:${(TUR[h.kind] || TUR.hata).renk};">
            ${escapeHtml(h.message)}${h.count > 1 ? ` <span style="color:var(--text-muted);font-weight:400;">· ${h.count} kez</span>` : ''}
          </div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">
            ${h.view ? `ekran: ${escapeHtml(h.view)} · ` : ''}${h.action ? `eylem: ${escapeHtml(h.action)} · ` : ''}${escapeHtml(h.at.replace('T', ' ').replace('+00:00', ''))}
          </div>
          ${h.stack ? `<details style="margin-top:4px;"><summary style="cursor:pointer;font-size:11.5px;color:var(--text-muted);">Teknik ayrıntı</summary>
            <pre style="white-space:pre-wrap;font-size:11px;background:var(--paper-dim);padding:6px;border-radius:4px;margin-top:4px;">${escapeHtml(h.stack)}</pre></details>` : ''}
        </div>`).join('')}`;
    el('healthClear').addEventListener('click', async () => {
      try { await api.del('/diagnostics/client-errors'); renderHealthView(kap); }
      catch (err) { alert(err.message); }
    });
  } catch (err) {
    kap.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}


// Global erişim (tarayıcı + test ortamı)
if (typeof window !== 'undefined') {
  window.workshopState = workshopState;
  window.paraPurposes = paraPurposes;
  window.resolvedParas = typeof resolvedParas !== 'undefined' ? resolvedParas : new Set();
}
