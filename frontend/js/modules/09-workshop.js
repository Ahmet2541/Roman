// ===========================================================================
// 09-workshop.js — Bölüm Atölyesi: hazırlık, derin analiz, paragraf düzenleme
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

function openChapterWorkshop(chapter) {
  loadBannedPatterns();          // üslup taramasındaki yasak kalıplar (kaçınma listesi)
  loadCanonNames();              // korunması gereken kanonik adlar
  workshopState.chapter = chapter;
  workshopState.findings = {};
  workshopState.order = [];
  workshopState.idx = 0;
  workshopState.literary = null;
  // BÖLÜME ÖZEL DURUMLAR SIFIRLANIR: hepsi paragraf NUMARASIYLA
  // anahtarlanıyor; temizlenmezse A bölümünün P5'ine ait teşhis, temel ve
  // "görülen seçenekler" B bölümünün P5'ine sızıyordu.
  workshopState.baseline = {};
  workshopState.seen = {};
  workshopState.directives = {};
  workshopState.lastGoal = {};
  workshopState.diagnoses = {};
  workshopState.roleKinds = {};
  workshopState.motif = null;
  window.__verifyRounds = {};
  let ov = document.getElementById('workshopOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'workshopOverlay';
    ov.className = 'workshop-overlay';
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
  renderWorkshopPrep();
}

function closeWorkshop() {
  const ov = document.getElementById('workshopOverlay');
  if (ov) { ov.style.display = 'none'; ov.innerHTML = ''; }
  if (currentChapter) loadChapterList(currentChapter.id);   // değişiklikleri yansıt
}

function workshopShell(baslik, adim, govde) {
  const ch = workshopState.chapter;
  return `
    <div class="workshop-box">
      <div class="workshop-head">
        <div>
          <div style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ADIM ${adim}/3 · BÖLÜM ${ch.number}</div>
          <div style="font-weight:600;font-size:14px;">${escapeHtml(baslik)}</div>
        </div>
        <button class="btn btn-sm workshop-close-btn" id="workshopClose" title="Atölyeyi kapat">✕</button>
      </div>
      <div class="workshop-body">${govde}</div>
    </div>`;
}

// --- ADIM 1: HAZIRLIK ---
async function renderWorkshopPrep() {
  const ov = document.getElementById('workshopOverlay');
  const ch = workshopState.chapter;
  ov.innerHTML = workshopShell('Hazırlık', 1, '<div class="empty-state">Kontrol ediliyor…</div>');
  el('workshopClose').addEventListener('click', closeWorkshop);

  const ozetVar = !!(ch.summary || '').trim();
  let planVar = false, olayVar = false;
  try {
    // Uç LİSTE döndürür (bir bölüme birden çok hücre bağlı olabilir).
    // Eskiden tek nesne gibi okunuyordu; plan kaydedilse bile "yok"
    // görünüyor ve "Planı kaydet" işe yaramamış gibi duruyordu.
    const plan = await api.get(`/matrix/plan-for-chapter/${ch.id}`);
    const hucreler = Array.isArray(plan) ? plan : (plan ? [plan] : []);
    planVar = hucreler.some(x => (x.content || '').trim());
  } catch (e) { /* plan yok */ }
  try {
    const olaylar = await api.get('/events/');
    olayVar = olaylar.some(e => (e.story_order || 0) >= ch.number * 1000 && (e.story_order || 0) < (ch.number + 1) * 1000);
  } catch (e) { /* olay yok */ }

  const satir = (tamam, baslik, aciklama, dugmeId, dugmeMetin) => `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:16px;">${tamam ? '✅' : '⬜'}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13.5px;">${baslik}</div>
        <div style="font-size:12.5px;color:var(--text-muted);">${aciklama}</div>
        <button class="btn btn-sm ${tamam ? '' : 'btn-primary'}" id="${dugmeId}" style="margin-top:6px;font-size:11.5px;">${tamam ? '↻ ' + dugmeMetin.replace(/^[⚡🕐]\s*/, '') : dugmeMetin}</button>
      </div>
    </div>`;

  ov.innerHTML = workshopShell('Hazırlık', 1, `
    <p style="font-size:12.5px;color:var(--text-muted);margin-top:0;">
      Bunlar incelemenin <b>kalitesini</b> belirler: özet yoksa AI bölümün ne olduğunu,
      plan yoksa ne yapması gerektiğini bilmez.
    </p>
    ${satir(ozetVar, 'Bölüm özeti', ozetVar ? 'Var - ZAMAN/OLAY/MEKAN bilgisi incelemeye gidecek.' : 'Yok. AI bölümü tanımadan inceler; bulgular yüzeysel kalır.', 'wsMakeSummary', 'AI ile özet oluştur')}
    ${satir(olayVar, 'Zaman çizelgesi', olayVar ? 'Bu bölümden olaylar çizelgede işlenmiş.' : 'Bu bölümden çizelgeye olay işlenmemiş. Kronoloji hataları görünmez kalır.', 'wsMakeEvents', '🕐 Zaman çizelgesini güncelle')}
    ${satir(planVar, 'Bölüm planı', planVar ? 'Var - paragrafların işlevi buradan miras alınacak.' : 'Yok. Paragrafların "ne yapması gerektiği" tanımsız kalır.', 'wsMakePlan', '⚡ Metinden plan çıkar')}
    ${(() => {
      const c = loadReviewCache(ch.id);
      if (!c) return '';
      const gun = Math.floor((Date.now() - c.at) / 86400000);
      const bulgu = Object.keys(c.findings || {}).length;
      const cozulen = (() => {
        try {
          const st = JSON.parse(localStorage.getItem(`roman_para_state_${ch.id}`) || '{}');
          return (st.resolved || []).length;
        } catch (e) { return 0; }
      })();
      return `<div style="font-size:12px;color:var(--text-muted);background:var(--paper-dim);padding:6px 8px;border-radius:6px;margin-top:10px;">
        📦 <b>Kayıtlı inceleme:</b> ${gun > 0 ? gun + ' gün önce' : 'bugün'} · ${bulgu} paragrafta bulgu ·
        ${cozulen} düzeltildi · edebî ortalama ${c.literary?.average ?? '?'}/5
        <div style="margin-top:2px;">Metni düzenlediysen bulgular eskimiş olabilir - o zaman
        <b>🔄 Yeniden incele</b> daha doğru sonuç verir.</div></div>`;
    })()}
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
      ${loadReviewCache(ch.id) ? `
        <button class="btn btn-primary" id="wsFullPass" style="flex:1;min-width:190px;"
          title="Kayıtlı inceleme kullanılır - analiz baştan çalışmaz (hızlı)">▶ Kayıtlı incelemeyle devam</button>
        <button class="btn" id="wsRescanPass" style="flex:1;min-width:170px;"
          title="Tüm kontroller BAŞTAN çalışır - metin değiştiyse doğru sonuç için gerekli">🔄 Yeniden incele</button>`
      : `<button class="btn btn-primary" id="wsFullPass" style="flex:1;min-width:190px;"
          title="Analiz çalıştırılır, sonra paragraf paragraf düzenleme">🔬 Bölümü değerlendir ve düzenle</button>`}
      <button class="btn" id="wsLengthPass" style="flex:1;min-width:170px;">📏 Paragraf uzunluk kontrolü</button>
      <button class="btn" id="wsToReview" style="flex:1;min-width:140px;">Sadece incele →</button>
    </div>
    <div id="wsPrepResult" style="margin-top:10px;"></div>`);
  // DİNLEYİCİ BAĞLAMA SIRASI KRİTİK: burada bir satır patlarsa SONRAKİ
  // düğmeler hiç bağlanmaz ve "düğme çalışmıyor" diye görünür. Bu sohbette
  // tam olarak bu yaşandı - önce güvenli erişim (el), sonra her bağlama
  // kendi başına.
  el('workshopClose').addEventListener('click', closeWorkshop);
  try { renderKontrolSecici('wsChecksPicker'); } catch (e) { /* seçici olmasa da akış sürer */ }
  el('wsToReview').addEventListener('click', renderWorkshopReview);
  // TAM TUR: önbelleği yok sayıp analizi TAZELER, süpürme modunu açar ve
  // doğrudan paragraf paragraf düzenlemeye geçer. Tek düğmeyle uçtan uca.
  // UZUNLUK KONTROLÜ: tamamen mekanik iş - edebî değerlendirmeyle
  // karışmasın diye ayrı düğme. Atölyeyi kapatıp Denetim > Uzunluk
  // sekmesine geçer ve bu bölümü seçili getirir.
  el('wsLengthPass').addEventListener('click', () => {
    const id = ch.id;
    closeWorkshop();
    currentDenetimTab = 'length';
    switchView('denetim');
    setTimeout(() => {
      const sel = document.getElementById('lcChapter');
      if (sel) { sel.value = String(id); document.getElementById('lcScan')?.click(); }
    }, 500);
  });
  // YENİDEN İNCELE: önbelleği yok sayıp tüm kontrolleri baştan çalıştırır.
  // Metni düzenledikten sonra kayıtlı bulgular ESKİMİŞ olur - o zaman bu
  // gerekir. Seçimi kullanıcı yapar; sistem sessizce karar vermez.
  el('wsRescanPass').addEventListener('click', () => {
    workshopState.forceRescan = true;
    workshopState.autoSweep = true;
    renderWorkshopReview();
  });
  el('wsFullPass').addEventListener('click', () => {
    // ÖNBELLEĞİ KULLAN: kayıtlı inceleme varsa analizi TEKRAR ÇALIŞTIRMA -
    // doğrudan paragraf düzenlemeye geç. Eskiden forceRescan=true idi ve
    // her tıklamada dakikalar süren analiz baştan başlıyordu. Tazelemek
    // isteyen "🔄 Yeniden incele" düğmesini kullanır.
    workshopState.autoSweep = true;
    renderWorkshopReview();
  });

  document.getElementById('wsMakeSummary')?.addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Özet yazılıyor…';
    try {
      const r = await api.post(`/chapters/${ch.id}/generate-summary`, {});
      if (confirm(`Taslak özet:\n\n${r.generated_summary}\n\nKaydedilsin mi?`)) {
        await api.put(`/chapters/${ch.id}`, { summary: r.generated_summary });
        ch.summary = r.generated_summary;
      }
    } catch (err) { alert(err.message); }
    renderWorkshopPrep();
  });
  document.getElementById('wsMakeEvents')?.addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Taranıyor…';
    const box = document.getElementById('wsPrepResult');
    try {
      const öneriler = await api.post(`/chapters/${ch.id}/suggest-events`, {});
      box.innerHTML = öneriler.length
        ? '<div style="font-size:12.5px;">Öneriler Roman menüsündeki 🕐 Zaman Çizelgesi düğmesinden onaylanabilir.</div>'
        : '<div style="font-size:12.5px;color:var(--text-muted);">Yeni olay bulunamadı.</div>';
    } catch (err) { box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
    b.disabled = false; b.textContent = '🕐 Zaman çizelgesini güncelle';
  });
  document.getElementById('wsMakePlan')?.addEventListener('click', async (e) => {
    // METİNDEN PLAN: yazılmış bölümden geriye dönük plan çıkarır. Önce
    // yazıp sonra planlayan akışta plan elle yazılmıyordu ve işlev mirası
    // çalışmıyordu.
    const b = e.target, kutu = document.getElementById('wsPrepResult');
    b.disabled = true; b.textContent = 'Metinden çıkarılıyor…';
    try {
      const r = await api.post(`/ai/plan-from-text/${ch.id}`, {});
      kutu.innerHTML = `
        <div class="panel" style="border-left:3px solid var(--gold);">
          <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">METİNDEN ÇIKARILAN PLAN - onaysız kaydedilmez</div>
          ${(r.plan || '').trim() ? '' : '<div class="error-text" style="font-size:12px;">Plan üretilemedi - bölümde yeterli metin olmayabilir.</div>'}
          <textarea id="wsPlanDraft" style="width:100%;min-height:130px;font-size:12.5px;margin-top:6px;box-sizing:border-box;">${escapeHtml(r.plan || '')}</textarea>
          <div class="form-actions">
            <button class="btn btn-sm btn-primary" id="wsPlanSave">Planı kaydet</button>
            <button class="btn btn-sm" id="wsPlanCancel">Vazgeç</button>
          </div>
        </div>`;
      el('wsPlanCancel').addEventListener('click', () => { kutu.innerHTML = ''; });
      el('wsPlanSave').addEventListener('click', async () => {
        try {
          const kayitBtn = document.getElementById('wsPlanSave');
          kayitBtn.disabled = true; kayitBtn.textContent = 'Kaydediliyor…';
          const sonuc = await api.post('/matrix/quick-plan', {
            chapter_id: ch.id, content: el('wsPlanDraft').value.trim(),
          });
          kutu.innerHTML = `<div class="panel" style="border-left:3px solid #3f7a4f;">
            <b style="color:#3f7a4f;">✓ Plan kaydedildi</b>
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(sonuc.matrix_name || 'Hızlı Planlar')} · kod ${escapeHtml(sonuc.code || '')}</div></div>`;
          setTimeout(renderWorkshopPrep, 900);
        } catch (err) { alert(err.message); }
      });
    } catch (err) { kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
    b.disabled = false; b.textContent = '⚡ Metinden plan çıkar';
  });
}

// --- ADIM 2: İNCELEME ---
async function renderWorkshopReview() {
  const ov = document.getElementById('workshopOverlay');
  const ch = workshopState.chapter;
  // DERİN ANALİZ: üç aşama tek akışta - ayrı düğmeler yok, hepsi burada.
  const asama = (n, metin) => {
    ov.querySelector('.workshop-body').innerHTML = `
      <div class="empty-state">
        <div style="font-size:13px;">${n}/4 · ${metin}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:6px;">Uzun bölümlerde bir-iki dakika sürebilir.</div>
      </div>`;
  };
  ov.innerHTML = workshopShell('Derin Analiz', 2, '');
  el('workshopClose').addEventListener('click', closeWorkshop);

  // Önbellek: daha önce incelenmişse sonuçları geri yükle, yeniden analiz
  // için kullanıcıya sor. Uzun bölümlerde analiz dakikalar sürüyor.
  const onbellek = loadReviewCache(ch.id);
  // Bozuk/eksik önbellek yeniden analize düşer - yarım veriyle çalışmak
  // sessiz hatalara yol açar
  const onbellekGecerli = onbellek && onbellek.literary && onbellek.findings;
  if (onbellekGecerli && !workshopState.forceRescan) {
    const gun = Math.floor((Date.now() - onbellek.at) / 86400000);
    workshopState.literary = onbellek.literary;
    workshopState.findings = onbellek.findings;
    workshopState.order = onbellek.order || [];
    workshopState.roleKinds = onbellek.roleKinds || {};
    workshopState.ranChecks = onbellek.ranChecks || [];
    workshopState.failedChecks = onbellek.failedChecks || [];
    workshopState.voice = onbellek.voice || { contract: {}, violations: [] };
    workshopState.motif = onbellek.motif || { repeats: [] };
    renderWorkshopReviewSummary(onbellek.literary, onbellek.motif || {}, true, gun);
    return;
  }
  workshopState.forceRescan = false;

  // KAYIT TABANLI ÇALIŞTIRMA: her kontrol bağımsız bir birim (bkz.
  // 08b-checks.js). Yalnızca AÇIK olanlar çalışır; biri hata verirse
  // diğerleri devam eder ve hangisinin düştüğü raporlanır. Eskiden dört
  // aşama sabit sırayla ve hep birlikte çalışıyordu.
  const secili = acikKontroller();
  const hamSonuclar = {};
  const dusenler = [];
  for (let i = 0; i < secili.length; i++) {
    const k = secili[i];
    asama(i + 1, k.label.replace(/^\S+\s/, ''), secili.length);
    try {
      hamSonuclar[k.id] = await k.run(ch);
      if (k.onDone) k.onDone(hamSonuclar[k.id]);
    } catch (err) {
      dusenler.push(`${k.label}: ${err.message || 'hata'}`);
    }
  }
  workshopState.failedChecks = dusenler;
  // Hangi kontroller GERÇEKTEN çalıştı: paragraf ekranında "hangi testten
  // geçti" göstergesi buna dayanır. Kapalı ya da düşen kontrol "geçti"
  // sayılmamalı - yanlış güven verir.
  workshopState.ranChecks = secili
    .filter(k => hamSonuclar[k.id] !== undefined)
    .map(k => k.id);

  try {
    // Edebî karne olmadan özet ekranı kurulamaz - zorunlu kontrol
    const literary = hamSonuclar.literary || { scores: [], fixes: [], average: 0, strongest: '' };
    workshopState.literary = literary;
    const motif = hamSonuclar.motif || { repeats: [], unused_senses: [], summary: '', items: [] };
    const voice = hamSonuclar.voice || { contract: {}, violations: [] };
    workshopState.motif = motif;
    workshopState.voice = voice;

    // Bulguları topla: her kontrol kendi dönüştürücüsünü kullanır
    const byPara = {};
    for (const k of secili) {
      const ham = hamSonuclar[k.id];
      if (!ham || !k.toFindings) continue;
      for (const b of k.toFindings(ham)) {
        (byPara[b.p] = byPara[b.p] || []).push({
          kaynak: b.kaynak, baslik: b.baslik, sorun: b.sorun,
          oneri: b.oneri, alinti: b.alinti,
        });
      }
    }
    workshopState.findings = byPara;
    workshopState.order = Object.keys(byPara).map(Number).sort((a, b) => a - b);
    workshopState.idx = 0;
    // İNCELEME HAFIZASI: sonuçlar saklanır - atölyeyi kapatıp açtığında
    // ya da ertesi gün döndüğünde analiz baştan çalışmaz (hem zaman hem
    // maliyet). "Yeniden incele" ile bilerek tazelenir.
    saveReviewCache(ch.id, {
      at: Date.now(), literary, findings: byPara, motif,
      order: workshopState.order, roleKinds: workshopState.roleKinds || {},
      // Hangi kontroller çalıştı: kayıtlı incelemede "çalışmadı" uyarısı
      // yanlış çıkmasın. Bunlar saklanmayınca kapsama özeti "0/5 temiz,
      // 5 çalışmadı" diyordu - oysa hepsi çalışmıştı.
      ranChecks: workshopState.ranChecks || [],
      failedChecks: workshopState.failedChecks || [],
      voice: workshopState.voice || null,
    });

    renderWorkshopReviewSummary(literary, motif, false, 0);
  } catch (err) {
    ov.querySelector('.workshop-body').innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>
      <button class="btn" id="wsRetry" style="margin-top:10px;">Tekrar dene</button>`;
    el('wsRetry').addEventListener('click', renderWorkshopReview);
  }
}

// --- ADIM 3: PARAGRAF PARAGRAF ---
async function renderWorkshopParagraph(idx) {
  const ov = document.getElementById('workshopOverlay');
  const ch = workshopState.chapter;
  const sira = workshopState.order;
  if (!sira.length) { renderWorkshopReview(); return; }
  workshopState.idx = Math.max(0, Math.min(idx, sira.length - 1));
  const num = sira[workshopState.idx];
  window.__verifyRounds = {};   // yeni paragraf = yeni tur sayacı
  const para = (ch.paragraphs || []).find(p => p.number === num);
  const kayitlar = workshopState.findings[num] || [];
  const cozuldu = resolvedParas.has(String(num));
  const kalan = sira.filter(n => !resolvedParas.has(String(n))).length;
  const issue = kayitlar.map(k => `${k.baslik}: ${k.sorun} ${k.oneri || ''}`).join(' | ');

  ov.innerHTML = workshopShell(`P${num} · ${workshopState.idx + 1}/${sira.length}`, 3, `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11.5px;color:var(--text-muted);flex-wrap:wrap;">
      <span>${cozuldu ? '<span style="color:#3f7a4f;font-weight:600;">✓ düzeltildi</span>' : `${kalan} paragraf kaldı`}</span>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;" title="Süpürme modunda bulgusu olmayan paragraflar da geziliyor. İşaretlersen sadece bulgulu paragraflarda durur.">
        <input type="checkbox" id="wsOnlyFlagged" ${workshopState.onlyFlagged ? 'checked' : ''}>
        sadece bulgulu (${(workshopState.order || []).filter(n => (workshopState.findings[n] || []).length && !resolvedParas.has(String(n))).length})
      </label>
      <span>${escapeHtml((effectiveParaPurpose(num).source) ? 'işlev: ' + effectiveParaPurpose(num).source : 'işlev tanımsız')}</span>
    </div>
    ${paragrafKontrolOzeti(num)}
    ${(paraAnswers[num] || []).length ? `
      <div style="margin-top:6px;font-size:11.5px;border-left:3px solid var(--gold);padding-left:8px;">
        <div style="color:var(--text-muted);letter-spacing:0.3px;font-size:10.5px;">YAZARDAN ALINAN BİLGİ (her üretimde AI'ya gider)</div>
        ${paraAnswers[num].map((c, i) => `
          <div style="margin-top:2px;">• ${escapeHtml(c.cevap)}
            <span class="ans-del" data-idx="${i}" style="cursor:pointer;opacity:0.5;" title="Kaldır">✕</span></div>`).join('')}
      </div>` : ''}

    <div class="field" style="margin:8px 0;">
      <label style="font-size:10.5px;">🎯 BU PARAGRAFIN İŞİ</label>
      <input type="text" id="wsPurpose" value="${escapeHtml(paraPurposes[num] || '')}" placeholder="${escapeHtml(truncate(effectiveParaPurpose(num).text || 'ör. Yangın yerini masum göstermek', 60))}" style="font-size:12.5px;">
    </div>

    <div id="wsParaText" contenteditable="true" style="border:1px solid var(--border);border-radius:8px;padding:10px;font-size:14px;line-height:1.7;background:#fff;min-height:80px;">${escapeHtml(para ? para.text : '(paragraf bulunamadı)')}</div>
    <div style="display:flex;gap:6px;margin-top:6px;">
      <button class="btn btn-sm" id="wsSaveManual" style="font-size:11.5px;">💾 Elle kaydet</button>
      <span id="wsSaveState" style="font-size:11.5px;color:var(--text-muted);align-self:center;"></span>
    </div>

    ${kayitlar.length ? `
      <div style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">BULGULAR (${kayitlar.length}) — dokun, detayı açılsın</div>
          <button class="btn btn-sm" id="wsShowDirectives" style="font-size:10.5px;padding:1px 6px;" title="Bu bulgulardan çıkarılan ve AI'ya giden kural listesi">📋 Direktifler</button>
        </div>
        <div id="wsDirectiveBox"></div>
        <div id="wsDiagnosisBox"></div>
        <div id="wsRawChips"></div>
      </div>` : ''}

    <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
      <button class="btn btn-primary" id="wsFix" style="flex:1;font-size:12px;">✨ 3 öneri getir</button>
      <button class="btn" id="wsChat" style="flex:1;font-size:12px;">💬 Konuş</button>
    </div>
    <div id="wsLongWarn"></div>
    <button class="btn btn-sm" id="wsChecksToggle" style="width:100%;margin-top:6px;font-size:11.5px;" title="Bu paragrafa uygulanabilecek kontroller">🔬 Paragraf kontrolleri</button>
    <div id="wsChecksPanel" style="display:none;">
      <button class="btn btn-sm" id="wsNecessity" style="width:100%;margin-top:6px;font-size:11.5px;" title="Bu paragraf silinirse ne kaybolur? Edebî kalite ve anlatısal gereklilik ayrı ölçülür.">🧪 Silme testi / gereklilik</button>
      <button class="btn btn-sm" id="wsShowDirectives2" style="width:100%;margin-top:6px;font-size:11.5px;" title="AI'ya giden kural listesi">📋 Direktifleri göster</button>
      <div id="wsNecessityBox"></div>
    </div>
    <div id="wsWork" style="margin-top:8px;"></div>

    <div style="display:flex;gap:6px;margin-top:16px;position:sticky;bottom:0;background:var(--paper);padding-top:8px;">
      <button class="btn" id="wsPrev" style="flex:1;" ${workshopState.idx === 0 ? 'disabled' : ''}>← Önceki</button>
      <button class="btn" id="wsSkip" style="flex:1;">Atla</button>
      <button class="btn btn-primary" id="wsNext" style="flex:1;">${workshopState.idx === sira.length - 1 ? 'Bitir ✓' : 'Sonraki →'}</button>
    </div>`);

  el('workshopClose').addEventListener('click', closeWorkshop);
  // Kontrol özeti aç/kapa
  el('paraChecksToggle').addEventListener('click', () => {
    const liste = el('paraChecksList');
    const acik = liste.style.display !== 'none';
    liste.style.display = acik ? 'none' : 'block';
  });
  document.querySelectorAll('.ans-del').forEach(b => b.addEventListener('click', () => {
    (paraAnswers[num] || []).splice(parseInt(b.dataset.idx, 10), 1);
    saveParaState();
    renderWorkshopParagraph(workshopState.idx);
  }));
  wireMicroEdit(ch, num);   // metinde ifade seçince mikro düzenleme çubuğu
  el('wsPurpose').addEventListener('input', (e) => {
    paraPurposes[num] = e.target.value; saveParaState();
  });
  // TEŞHİS FÜZYONU: ham bulguları tek teşhiste birleştirip sınıflandırır.
  // "tercih" sınıfına öneri üretilmez - yazarın bilinçli tercihi olabilir.
  if (kayitlar.length && !workshopState.diagnoses?.[num]) {
    (async () => {
      const kutu = document.getElementById('wsDiagnosisBox');
      if (!kutu) return;
      kutu.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);">Bulgular birleştiriliyor…</div>';
      try {
        const r = await api.post('/ai/fuse-diagnoses', {
          paragraph_text: para ? para.text : '',
          findings: kayitlar.map(k => ({ source: k.kaynak, title: k.baslik, detail: k.sorun || '' })),
          purpose: effectiveParaPurpose(num).text,
        });
        workshopState.diagnoses = workshopState.diagnoses || {};
        workshopState.diagnoses[num] = r.diagnoses;
        renderDiagnoses(num, r.diagnoses);
      } catch (e) { kutu.innerHTML = ''; }
    })();
  } else if (workshopState.diagnoses?.[num]) {
    renderDiagnoses(num, workshopState.diagnoses[num]);
  }

  // Teşhis gelene kadar HAM bulguları rozet olarak göster; teşhis gelince
  // renderDiagnoses bunları değiştirir (aynı şeyi iki kez yazmamak için).
  renderFindingChips('wsRawChips', kayitlar.map(k => ({
    icon: k.kaynak === 'editor' ? '📊' : (k.kaynak === 'imge' ? '🎨' : (k.kaynak === 'ses' ? '🗣' : '🎯')),
    label: k.baslik, renk: k.kaynak === 'editor' ? 'var(--gold)' : (k.kaynak === 'imge' ? '#7a5fb0' : (k.kaynak === 'ses' ? '#2f6f8f' : 'var(--danger)')),
    detay: `${k.alinti ? `<div style="font-style:italic;color:var(--text-muted);">"${escapeHtml(k.alinti)}"</div>` : ''}
      <div style="color:var(--text-muted);">${escapeHtml(k.sorun || '')}</div>
      ${k.oneri ? `<div style="margin-top:2px;">→ ${escapeHtml(k.oneri)}</div>` : ''}`,
  })));
  document.getElementById('wsShowDirectives')?.addEventListener('click', () => {
    const kutu = document.getElementById('wsDirectiveBox');
    if (kutu.innerHTML) { kutu.innerHTML = ''; return; }
    const d = buildParagraphDirectives(num, kayitlar, para ? para.text : '');
    kutu.innerHTML = `<pre style="white-space:pre-wrap;font-size:11.5px;background:var(--paper-dim);padding:8px;border-radius:6px;margin:6px 0;">${escapeHtml(d)}</pre>`;
  });
  // UZUN PARAGRAF UYARISI: 120+ kelimelik paragraf okuma temposunu düşürür
  // ve düzenlemesi zorlaşır. Bölme önerisi AI ile yapılır - tek kelime bile
  // değişmez, sadece nereye paragraf arası konacağına karar verilir.
  const kelimeSayisi = (para ? para.text : '').split(/\s+/).filter(Boolean).length;
  if (kelimeSayisi >= 120) {
    el('wsLongWarn').innerHTML = `
      <div style="font-size:11.5px;color:#b08d3f;border-left:3px solid #b08d3f;padding-left:8px;margin-top:8px;">
        ⚠ Bu paragraf ${kelimeSayisi} kelime - okuma temposunu düşürebilir.
        <button class="btn btn-sm" id="wsSplitPara" style="font-size:11px;margin-top:4px;">✂ Bölmeyi öner</button>
      </div>`;
    el('wsSplitPara').addEventListener('click', async (e2) => {
      const b2 = e2.target; b2.disabled = true; b2.textContent = 'Bölünüyor…';
      try {
        const r = await api.post(`/chapters/${ch.id}/split-preview`, { text: para.text });
        const parcalar = (r.paragraphs || []).map(x => x.text);
        const kutu = document.getElementById('wsLongWarn');
        if (parcalar.length < 2) {
          kutu.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);">Bölünecek doğal bir yer bulunamadı.</div>';
          return;
        }
        kutu.innerHTML = `
          <div class="panel" style="border-left:3px solid #b08d3f;margin-top:8px;">
            <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">${parcalar.length} PARÇAYA BÖLÜNECEK - metin değişmez</div>
            ${parcalar.map((x, i) => `<div style="font-size:12.5px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);"><b>${i + 1}.</b> ${escapeHtml(x)}</div>`).join('')}
            <div class="form-actions">
              <button class="btn btn-sm btn-primary" id="wsSplitApply">Böl ve kaydet</button>
              <button class="btn btn-sm" id="wsSplitCancel">Vazgeç</button>
            </div>
          </div>`;
        el('wsSplitCancel').addEventListener('click', () => { kutu.innerHTML = ''; });
        el('wsSplitApply').addEventListener('click', async () => {
          try {
            await applyParagraphSplit(ch, num, parcalar);
            kutu.innerHTML = '<div style="font-size:12px;color:#3f7a4f;">✓ Bölündü.</div>';
          } catch (err) { alert(err.message); }
        });
      } catch (err) {
        el('wsLongWarn').innerHTML = `<div class="error-text" style="font-size:11.5px;">${escapeHtml(err.message)}</div>`;
      }
      b2.disabled = false; b2.textContent = '✂ Bölmeyi öner';
    });
  }

  // KONTROLLER PANELİ: ekran kalabalıklaşmıştı - ana akış (öneri/konuş)
  // üstte, denetim araçları bu düğmenin arkasında.
  el('wsChecksToggle').addEventListener('click', (e) => {
    const panel = document.getElementById('wsChecksPanel');
    const acik = panel.style.display !== 'none';
    panel.style.display = acik ? 'none' : 'block';
    e.target.textContent = acik ? '🔬 Paragraf kontrolleri' : '🔬 Kontrolleri gizle';
  });
  el('wsShowDirectives2').addEventListener('click', () => {
    const kutu = document.getElementById('wsNecessityBox');
    if (kutu.dataset.mode === 'dir') { kutu.innerHTML = ''; kutu.dataset.mode = ''; return; }
    kutu.dataset.mode = 'dir';
    const d = buildParagraphDirectives(num, kayitlar, para ? para.text : '');
    kutu.innerHTML = `<pre style="white-space:pre-wrap;font-size:11px;background:var(--paper-dim);padding:8px;border-radius:6px;margin:6px 0;">${escapeHtml(d)}</pre>`;
  });
  el('wsNecessity').addEventListener('click', async (e) => {
    const b = e.target, kutu = document.getElementById('wsNecessityBox');
    b.disabled = true; b.textContent = 'Ölçülüyor…';
    try {
      const n = await api.post(`/ai/necessity/${ch.id}`, {
        paragraph_text: para ? para.text : '', purpose: effectiveParaPurpose(num).text,
      });
      const kararRenk = { korunmali: '#3f7a4f', guclendirilmeli: '#b08d3f',
                          kisaltilmali: '#b08d3f', silinebilir: 'var(--danger)' }[n.verdict];
      const kararMetin = {
        korunmali: 'Korunmalı - romanın buna ihtiyacı var',
        guclendirilmeli: 'Güçlendirilmeli - SİLME, ifadesini düzelt',
        kisaltilmali: 'Kısaltılmalı - iyi yazılmış ama fazla yer kaplıyor',
        silinebilir: 'Silinebilir - hiçbir şey kaybolmaz',
      }[n.verdict];
      kutu.innerHTML = `
        <div class="panel" style="margin-top:6px;border-left:3px solid ${kararRenk};font-size:12.5px;">
          <div style="display:flex;gap:14px;flex-wrap:wrap;">
            <span>Edebî kalite: <b>${n.literary_quality}</b>/10</span>
            <span>Anlatısal gereklilik: <b>${n.narrative_necessity}</b>/10</span>
          </div>
          <div style="color:${kararRenk};font-weight:600;margin-top:4px;">${kararMetin}</div>
          <div style="color:var(--text-muted);">Silinirse kaybolur: ${n.loses.map(escapeHtml).join(', ')}</div>
          ${n.note ? `<div style="color:var(--text-muted);margin-top:2px;">${escapeHtml(n.note)}</div>` : ''}
        </div>`;
    } catch (err) { kutu.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`; }
    b.disabled = false; b.textContent = '🧪 Silme testi / gereklilik';
  });
  // SADECE BULGULU: süpürme modunda 109 paragrafın hepsi geziliyor; çoğunda
  // yapacak bir şey yok. Bu kutu işaretliyse gezinme bulgusu olmayan
  // paragrafları ATLAR - ama liste değişmez, istediğinde geri açarsın.
  el('wsOnlyFlagged').addEventListener('change', (e) => {
    workshopState.onlyFlagged = e.target.checked;
    try { localStorage.setItem('roman_ws_only_flagged', e.target.checked ? '1' : '0'); } catch (er) { /* yoksay */ }
    if (e.target.checked && !(workshopState.findings[num] || []).length) {
      const hedef = nextFlaggedIndex(workshopState.idx, 1);
      if (hedef === null) { alert('Bulgulu başka paragraf yok.'); workshopState.onlyFlagged = false; e.target.checked = false; return; }
      renderWorkshopParagraph(hedef);
    }
  });
  el('wsPrev').addEventListener('click', () => {
    const h = workshopState.onlyFlagged ? nextFlaggedIndex(workshopState.idx, -1) : workshopState.idx - 1;
    if (h !== null && h >= 0) renderWorkshopParagraph(h);
  });
  el('wsSkip').addEventListener('click', () => {
    const h = workshopState.onlyFlagged ? nextFlaggedIndex(workshopState.idx, 1) : workshopState.idx + 1;
    if (h === null) { renderWorkshopDone(); return; }
    renderWorkshopParagraph(h);
  });
  el('wsNext').addEventListener('click', () => {
    const h = workshopState.onlyFlagged ? nextFlaggedIndex(workshopState.idx, 1) : workshopState.idx + 1;
    if (h === null || h >= sira.length) { renderWorkshopDone(); return; }
    renderWorkshopParagraph(h);
  });

  // Elle kaydet: atölyede metni doğrudan düzenleyip kaydedebilmek şart -
  // bazen AI'ya hiç gerek olmuyor, tek kelime değişecek.
  el('wsSaveManual').addEventListener('click', async () => {
    const yeni = el('wsParaText').innerText.trim();
    if (!yeni) return;
    const durum = document.getElementById('wsSaveState');
    // UZUNLUK KAPISI: sınırı aşan paragraf önce bölme teklifinden geçer
    const devam = await paragraphLengthGate(ch, num, yeni, document.getElementById('wsParaText'));
    if (!devam) { durum.textContent = '✓ bölündü ve kaydedildi'; return; }
    durum.textContent = 'kaydediliyor…';
    await replaceParagraphText(ch.id, num, yeni);
    resolvedParas.add(String(num)); saveParaState();
    if (para) para.text = yeni;
    durum.textContent = '✓ kaydedildi';
  });

  el('wsFix').addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Öneriler yazılıyor…';
    await workshopFix(ch, num, issue || 'Bu paragrafı güçlendir.');
    b.disabled = false; b.textContent = '✨ 3 öneri getir';
  });
  el('wsChat').addEventListener('click', () => {
    const box = document.getElementById('wsWork');
    if (box.dataset.mode === 'chat') { box.innerHTML = ''; box.dataset.mode = ''; return; }
    box.dataset.mode = 'chat';
    box.innerHTML = `
      <div class="para-chat-log" data-number="${num}" style="max-height:220px;overflow-y:auto;font-size:12.5px;"></div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <textarea class="para-chat-input" data-number="${num}" placeholder="Ör: hüznü çıkar, masum kalsın" style="flex:1;min-height:38px;box-sizing:border-box;font-size:12.5px;"></textarea>
        <button class="btn btn-sm btn-primary" id="wsChatSend">Gönder</button>
      </div>
      <button class="btn btn-sm" id="wsChatWrite" style="margin-top:6px;width:100%;font-size:11.5px;">✍️ Konuştuklarımıza göre yaz</button>`;
    renderParaChatLog(num);
    el('wsChatSend').addEventListener('click', () => sendParagraphChat(ch, num, '', para ? para.text : ''));
    el('wsChatWrite').addEventListener('click', () => writeParagraphVersion(ch, num, '', para ? para.text : ''));
  });
}

// ---------------------------------------------------------------------------
// DİREKTİF SENTEZİ: edebî + okur testlerinin bulgularını TEK bir kural
// listesine çevirir. Eksik olan halka buydu - bulgular ham hâlde talimata
// yapıştırılıyordu ve (daha kötüsü) altın kelimeye tıklayıp alternatif
// istendiğinde bu kurallar hiç gitmiyordu; kelime kuralsız değişiyordu.
// Artık hem 3 seçenek hem tek kelime AYNI direktiflere uyar.
// Sentez yereldir (ek AI isteği yok): DEĞİŞTİR / KORU / KAÇIN başlıkları.
// ---------------------------------------------------------------------------
function buildParagraphDirectives(num, kayitlar, paraText) {
  const etiket = { editor: '[editör]', okur: '[okur]', imge: '[imge]', ses: '[anlatıcı]' };
  const degistir = (kayitlar || []).map(k =>
    `${etiket[k.kaynak] || '[okur]'} ${k.baslik}: ${k.sorun || ''}${k.oneri ? ' → ' + k.oneri : ''}`);

  // KORU: metindeki somut veriler (kaybolmamalı - kabul kontrolü de bunu arar)
  const sayilar = (paraText.match(/\b\d+(?:[.,]\d+)?\b/g) || []);
  const isimler = (paraText.match(/\b[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}\b/g) || []);
  const koru = [...new Set([...sayilar, ...isimler])].slice(0, 12);

  // KAÇIN: üslup taramasında eşiği aşmış kalıplar (varsa)
  const kacin = (window.__styleBanned || []).slice(0, 8);

  const purpose = effectiveParaPurpose(num).text;
  const cevaplar = (typeof paraAnswers !== 'undefined' && paraAnswers[num]) || [];
  const satirlar = [];
  if (purpose) satirlar.push(`İŞLEV (öncelikli ölçüt): ${purpose}`);
  // YAZARDAN ALINAN BİLGİ: metinde olmayan ama kurguyu belirleyen gerçekler.
  // AI bunları tahmin edemez - sorup öğrendikleri burada kalıcılaşır.
  if (cevaplar.length) {
    satirlar.push('YAZARDAN ALINAN BİLGİ (metinde yok ama BAĞLAYICI - kurgunun gerçeği budur):\n- '
      + cevaplar.map(c => `${c.soru} → ${c.cevap}`).join('\n- '));
  }
  if (degistir.length) satirlar.push('DEĞİŞTİR (testlerden çıkan bulgular):\n- ' + degistir.join('\n- '));
  // BAŞARI ÖLÇÜTÜ: "neyin yanlış olduğu" yetmiyor - "neyin doğru sayılacağı"
  // da söylenmezse model aynı eksende eşanlamlılar üretiyor. Ölçütler
  // teşhis aşamasında üretilir ve hem ÜRETİME hem DOĞRULAMAYA aynı hedefi
  // verir.
  const olcutler = ((workshopState.diagnoses || {})[num] || [])
    .filter(d => (d.success_criterion || '').trim())
    .map(d => d.success_criterion.trim());
  if (olcutler.length) {
    satirlar.push('BAŞARI ÖLÇÜTÜ (yeni metin BUNLARI sağlamalı - sağlamayan seçenek üretme):\n- '
      + olcutler.join('\n- '));
  }
  if (koru.length) satirlar.push(
    'KORU - bu veriler yeni metinde AYNEN geçmeli (kontrol bunları arar): ' + koru.join(', '));
  if (kacin.length) satirlar.push('KAÇIN (aşırı kullanılmış kalıplar): ' + kacin.join(', '));
  satirlar.push('DAİMA: eylem sırasını bozma, olay akışını ve zamanı koru, '
    + '"sanki/gibi/adeta" ile açıklama yapma, yargı sıfatı kullanma.');
  // BAĞLI DETAY ZİNCİRİ: bir olguyu değiştirmek tek kelimelik iş değildir.
  // Malzeme, mekân, zaman ya da nesne değişirse ona BAĞLI duyusal ve
  // fiziksel detaylar da değişmeli - yoksa metin kendi içinde çelişir
  // (tahta gıcırdar, çelik çınlar; gece gölge yapmaz, gündüz yapar).
  satirlar.push('BAĞLI DETAY ZİNCİRİ: bir olguyu (malzeme, mekân, zaman, nesne, hava, '
    + 'mesafe) değiştirirsen ona BAĞLI tüm duyusal/fiziksel detayları da tutarlı hale getir. '
    + 'Tahta gıcırdar, çelik çınlar; ıslak kayar, kuru tutar; gece gölge düşürmez. '
    + 'Değişiklikle çelişen ESKİ detay bırakma - metin kendi içinde çelişir.');
  // ÜRETİM, DENETİMİ ÖNCEDEN BİLSİN: aynı ölçütlerle üretilmeyen metin
  // kontrolde takılıyor ve döngü kuruluyordu. Kontrol listesi burada.
  // EN KÜÇÜK ETKİLİ MÜDAHALE: model "paragrafı baştan yazalım, yeni sembol
  // ekleyelim" eğilimindeydi. Teşhisi giderecek EN AZ değişiklik istenir.
  satirlar.push('MÜDAHALE ÖLÇÜSÜ: teşhisi gideren EN KÜÇÜK ETKİLİ değişikliği yap. '
    + 'Sorun tek bir cümledeyse sadece o cümleyi değiştir; paragrafı baştan yazma. '
    + 'İşe yarayan cümleleri AYNEN koru.');
  // KANON DIŞI EKLEME YASAĞI: model olmayan geçmiş/olay/nesne uyduruyordu
  satirlar.push('YENİ BİLGİ EKLEME YASAĞI: metinde ya da kayıtlarda BULUNMAYAN '
    + 'karakter geçmişi, olay, nesne, ilişki, motivasyon EKLEME. '
    + '("Çocukluğunda babası dövmüştü" gibi uydurma geçmiş yasak.) '
    + 'Önerinin uygulanması mevcut kanondan mümkün olmalı.');
  satirlar.push('YAZDIKTAN SONRA KENDİ METNİNİ ŞU KONTROLDEN GEÇİR (kontrol bunlara bakacak): '
    + '(1) yukarıdaki KORU listesindeki her veri metinde var mı, '
    + '(2) paragrafın işlevi yerine geliyor mu, '
    + '(3) tamamlanmış bir eylemi yeniden başlattın mı, '
    + '(4) komşu paragraflarda geçen bir imgeyi tekrarladın mı. '
    + 'Bir madde bile ihlal ediliyorsa o seçeneği DÜZELT, öyle yaz.');
  return satirlar.join('\n');
}

// Üslup taramasındaki yasak kalıpları bir kez yükle (kaçınma listesi)
// Kayıtlı karakter/mekan/nesne adları: kontrolün "korunmalı" ölçütü.
async function loadCanonNames() {
  try {
    const [k, m, n] = await Promise.all([
      api.get('/characters/'), api.get('/places/'), api.get('/objects/'),
    ]);
    const isimler = [];
    [k, m, n].forEach(liste => (liste || []).forEach(x => {
      if (x.name) isimler.push(x.name);
      (x.aliases || []).forEach(a => a && isimler.push(a));
    }));
    window.__canonNames = [...new Set(isimler)].filter(a => a.length > 2);
  } catch (e) { window.__canonNames = []; }
}

async function loadBannedPatterns() {
  try {
    const rapor = await api.get('/style/report');
    window.__styleBanned = (rapor.patterns || []).filter(p => p.exceeded).map(p => p.name);
  } catch (e) { window.__styleBanned = []; }
}

// Atölyede 3 seçenekli öneri (mobil: tam genişlik kartlar)
async function workshopFix(chapter, num, issue, bicimDenemesi = 0) {
  // SAVUNMA: kapsayıcı yoksa (kullanıcı bu arada başka paragrafa geçtiyse)
  // çökmek yerine sessizce çık. "Cannot set properties of null" hatası
  // buradan geliyordu.
  const box = document.getElementById('wsWork');
  if (!box) return;
  box.dataset.mode = 'fix';
  box.innerHTML = '<div class="empty-state">Üç seçenek hazırlanıyor…</div>';
  const para = (chapter.paragraphs || []).find(p => p.number === num);
  const kayitlar = workshopState.findings[num] || [];
  // Görülen versiyonlar: "farklı 3 öneri" gerçekten farklı gelsin diye
  // önceki turlarda üretilenler talimatta AÇIKÇA dışlanır.
  workshopState.seen = workshopState.seen || {};
  const gorulenler = workshopState.seen[num] || [];
  await loadBannedPatterns();   // kaçınma listesi taze olsun (düzelttikçe değişiyor)
  const direktifler = buildParagraphDirectives(num, kayitlar, para ? para.text : '');
  workshopState.directives = workshopState.directives || {};
  workshopState.directives[num] = direktifler;
  workshopState.lastGoal = workshopState.lastGoal || {};
  // Amaç, ölçüt ANAHTARI değil TAM CÜMLE olmalı. Eskiden başlıklar
  // yazılıyordu ve edebî ölçütlerde bu "yapi" gibi anlamsız bir etikete
  // dönüşüyordu; kontrol de haklı olarak "amaç belirsiz" diye şikâyet
  // edip aynı noktaları tekrar tekrar işaretliyordu.
  workshopState.lastGoal[num] = (kayitlar.length
    ? kayitlar.map(k => `${k.baslik}: ${(k.oneri || k.sorun || '').slice(0, 120)}`).join(' | ')
    : issue).slice(0, 500);
  // Bölüm seçimi (derin profil) talimattaki anahtar kelimelere bakıyor;
  // paragrafın KENDİ metnini de talimata katarak doğru bölümlerin
  // seçilmesini sağlıyoruz (diyalog varsa konuşma tarzı, betimleme varsa
  // fiziksel yapı gelsin).
  const instruction =
    `P${num} paragrafını aşağıdaki DİREKTİFLERE göre yeniden yaz.\n${direktifler}\n`
    + `PARAGRAFIN MEVCUT HÂLİ (bağlam): ${(para ? para.text : '').slice(0, 300)}\n`
    + (issue && !kayitlar.length ? `EK NOT: ${issue}\n` : '')
    + 'BETİMLEME MATEMATİĞİ: geniş plan (en fazla iki nitelik) → orta plan → MİKRO DETAY (anlamı taşısın) '
    + '→ bir duyu (görme dışında) → anlamı SÖYLEME. Bütçe: en fazla bir benzetme, "sanki/gibi/adeta" ile '
    + 'açıklama yok, yargı sıfatı yok.\n'
    + 'ÜÇ FARKLI YAKLAŞIM üret (aynı fikrin varyasyonu DEĞİL): biri mikro detaya, '
    + 'biri sese/sessizliğe, biri harekete yaslansın.\n'
    + 'SİLME SINIRI (kesin): bulgunun İŞARET ETMEDİĞİ cümleleri silme. Özellikle '
    + 'paragrafın KAPANIŞ VURUŞUNU (son cümle ya da son iki cümle) koru - orası çoğu '
    + 'zaman paragrafın işlevini taşır. Bir bulgu "fazla sıfat" diyorsa çözüm sıfatı '
    + 'atmaktır, cümleyi atmak değil. Yaklaşımlar BİRBİRİNDEN farklı olsun ama üçü de '
    + 'paragrafın İŞLEVİNİ korusun; işlevi kaybeden bir seçenek üretme.\n'
    + 'SORU SORMA HAKKIN VAR: paragrafın kurgusal gerekçesi metinde YOKSA ve cevabı '
    + 'yeniden yazımı DEĞİŞTİRECEKSE, tahmin etme - SOR. Örnek: bir uyarının ("dikkat et, '
    + 'karışmasın") sebebi metinde açıklanmamışsa, o sebebi bilmeden doğru vurguyu kuramazsın. '
    + 'En fazla 2 soru, her biri tek cümle. Biçim (seçeneklerden ÖNCE):\n'
    + '###SORU: <soru metni>\n'
    + 'Soru yoksa hiç yazma. Sorular seçenek üretmene ENGEL değil - yine üç seçenek ver, '
    + 'ama belirsizliği soruyla belirt.\n'
    + (gorulenler.length
        ? 'DAHA ÖNCE ŞU VERSİYONLARI ÜRETTİN - HİÇBİRİNİ TEKRARLAMA, benzerini de yazma:\n'
          + gorulenler.map((t, i) => `(${i + 1}) ${t.slice(0, 180)}`).join('\n')
          + '\nTamamen farklı üç yol dene: farklı giriş cümlesi, farklı odak, farklı duyu.\n'
        : '')
    + `UZUNLUK BÜTÇESİ: mevcut paragraf ${(para ? para.text : '').split(/\s+/).filter(Boolean).length} kelime. `
    + 'Yeni hâli bunun %70-140 aralığında kalsın - her turda uzayıp komşu paragrafların '
    + 'ritmini bozmasın.\n'
    + (bicimDenemesi > 0
        ? 'ÖNCEKİ DENEMEDE BİÇİMİ BOZDUN - tek blok döndürdün. Bu sefer KESİNLİKLE '
          + 'üç ayrı blok yaz, her biri "###" ile başlasın. Blokların arasında açıklama, '
          + 'giriş cümlesi, numaralandırma OLMASIN. Yalnızca üç blok.\n'
        : '')
    + 'BİÇİM (kesin): her seçeneği şöyle yaz, arada başka hiçbir şey olmasın:\n'
    + '### mikro detay | NEDEN: tek cümlelik gerekçe\n<paragrafın tam yeni hâli>\n'
    + '### ses ve sessizlik | NEDEN: ...\n<paragrafın tam yeni hâli>\n'
    + '### hareket | NEDEN: ...\n<paragrafın tam yeni hâli>\n'
    + 'Açıklama, başlık, tırnak, madde işareti EKLEME. Her seçenek paragrafın '
    + 'TAMAMI olsun - kısmi cümle değil.';
  try {
    const result = await api.post('/ai/assist', {
      chapter_number: chapter.number, instruction,
      // Paragrafta GEÇEN varlıkların profilleri bağlama girsin: Vicdan'ın
      // konuşma tarzını bilmeden onun sahnesini yeniden yazmak körlemesine
      // iş. Eskiden boş liste gidiyordu - hiçbir karakter profili yoktu.
      selected_entities: paragraphEntities(para),
      existing_text: para ? para.text : '',
      include_own_summary: true,   // bölümün ZAMAN/ATMOSFER/DUYGU bilgisi
    });
    const ham = result.generated_text || '';
    // AI'NIN SORULARI: kurgusal gerekçe metinde yoksa model tahmin etmek
    // yerine sorabilir. Cevaplar direktiflere eklenir ve saklanır - aynı
    // soru ikinci kez sorulmaz.
    const sorular = [...ham.matchAll(/^###\s*SORU\s*:?\s*(.+)$/gim)]
      .map(m => m[1].trim()).filter(Boolean).slice(0, 3);
    const secenekler = parseOptionBlocks(ham.replace(/^###\s*SORU\s*:?.*$/gim, ''));
    // Üretilenleri belleğe al (sonraki turda dışlanacak - son 6 tanesi yeter)
    workshopState.seen[num] = [...gorulenler, ...secenekler.map(o => o.text)].slice(-6);

    // KAYDIRMALI KARTLAR: mobilde üç seçeneği alt alta okumak yorucu;
    // parmakla sağa/sola geçilen tek kart daha doğal. Noktalar hangi
    // seçenekte olduğunu gösterir, klavyeyle de gezilebilir.
    if (!secenekler.length) {
      // SESSİZ KALİTE SORUNU: hata değil ama akışı kesiyor - ajana bildir
      reportIssue('bos_yanit', `P${num} için AI boş yanıt döndürdü`, (result.generated_text || '').slice(0, 300));
      box.innerHTML = '<div class="error-text" style="font-size:12.5px;">AI boş yanıt döndürdü. Tekrar dene ya da "💬 Konuş" ile yönlendir.</div>';
      return;
    }
    const eskiMetin = para ? para.text : '';
    // TEK SEÇENEK UYARISI: model üç seçenek üretmediyse bunu SÖYLE. Eskiden
    // sessizce "SEÇENEK 1/1" görünüyordu ve kullanıcı kaydırma düğmelerinin
    // bozulduğunu sanıyordu.
    const tekSecenek = secenekler.length < 2;
    if (tekSecenek) {
      reportIssue('bos_yanit', `P${num}: AI ${secenekler.length} seçenek döndürdü (3 istenmişti)`, '');
      // TEK SEFERLİK BİÇİM DENEMESİ: bu bir KALİTE reddi değil, BİÇİM
      // düzeltmesidir - model üç blok yerine tek blok döndürdü. Sonsuz
      // döngü riski yok çünkü yalnızca bir kez ve yalnızca ayrıştırma
      // başarısız olduğunda tekrarlanır.
      if (bicimDenemesi === 0) {
        box.innerHTML = '<div class="empty-state">Biçim bozuk geldi - üç seçenek için tekrar isteniyor…</div>';
        return workshopFix(chapter, num, issue, 1);
      }
    }
    // Orijinalle aynı gelen seçenek varsa da uyar (fark vurgusu boş çıkar)
    const ayniOlanlar = secenekler.filter(o =>
      o.text.replace(/\s+/g, ' ').trim() === (eskiMetin || '').replace(/\s+/g, ' ').trim()).length;
    // ÜRETİLDİĞİ ANDA DENETİM: her seçenek için ücretsiz/anlık kontrol
    // (sayı-isim kaybı) hemen çalışır ve karta rozet olarak basılır. Böylece
    // "uygula -> kontrol -> geri dön -> yeniden yaz" döngüsüne girmeden
    // hangi seçeneğin temiz olduğunu görüp doğrudan seçersin.
    secenekler.forEach(o => {
      o.quick = quickFactCheck(eskiMetin, o.text);
      // AŞIRI SİLME KONTROLÜ (deterministik, ücretsiz): üreteç bulgunun
      // işaret etmediği cümleleri de siliyor - özellikle KAPANIŞ vuruşunu.
      // Testte üç seçeneğin üçü de paragrafın son cümlesini attı, oysa
      // denetçi aynı silmeyi "işlev kaybı" diye reddediyordu.
      o.quick = o.quick.concat(overDeletionWarnings(eskiMetin, o.text));
    });
    box.innerHTML = `
      ${sorular.length ? `
        <div style="border:1px solid var(--gold);border-radius:8px;padding:8px;margin-bottom:8px;background:#fffdf6;">
          <div style="font-size:10.5px;color:var(--gold);font-weight:600;letter-spacing:0.4px;">❓ AI'NIN SORUSU — cevaplarsan öneriler isabetlenir</div>
          ${sorular.map((q, i) => `
            <div style="margin-top:6px;">
              <div style="font-size:12.5px;">${escapeHtml(q)}</div>
              <input type="text" class="ai-answer" data-idx="${i}" placeholder="cevabın…"
                style="width:100%;font-size:12.5px;margin-top:3px;box-sizing:border-box;">
            </div>`).join('')}
          <button class="btn btn-sm btn-primary" id="wsAnswerGo" style="margin-top:8px;width:100%;font-size:11.5px;">
            Cevapları kullanarak yeniden üret
          </button>
        </div>` : ''}
      ${tekSecenek || ayniOlanlar ? `<div style="font-size:11.5px;color:#b08d3f;margin-bottom:6px;padding:5px 8px;background:var(--paper-dim);border-radius:6px;">
        ${tekSecenek ? '⚠ AI tek seçenek döndürdü (üç istenmişti). ' : ''}${ayniOlanlar ? `⚠ ${ayniOlanlar} seçenek orijinalle AYNI - fark vurgusu boş görünür. ` : ''}
        <b>🔄 Farklı 3 öneri getir</b> ile tekrar dene ya da <b>💬 Konuş</b> ile yönlendir.
      </div>` : ''}
      <div class="option-swiper" tabindex="0">
        ${secenekler.map((o, i) => `
          <div class="option-card" data-idx="${i}">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
              <div style="font-size:10.5px;color:var(--gold);font-weight:600;">SEÇENEK ${i + 1}/${secenekler.length}${o.approach ? ' · ' + escapeHtml(o.approach) : ''}</div>
              <div class="opt-badge" data-idx="${i}" style="font-size:10.5px;color:${o.quick.length ? 'var(--danger)' : '#3f7a4f'};white-space:nowrap;">
                ${o.quick.length ? `⚠ ${o.quick.length} uyarı` : '✓ temiz'}
              </div>
            </div>
            ${o.reason ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;font-style:italic;">${escapeHtml(o.reason)}</div>` : ''}
            ${o.quick.length ? `<div style="font-size:11px;color:var(--danger);margin-top:3px;">${o.quick.map(escapeHtml).join('<br>')}</div>` : ''}
            <div style="white-space:pre-wrap;font-size:13px;margin-top:4px;line-height:1.65;">${highlightDiff(eskiMetin, o.text)}</div>
            <div style="font-size:10.5px;color:var(--text-muted);margin-top:4px;">Altın = değişen, siyah = korunan · altına tıkla: alternatif iste</div>
            <div class="opt-deep" data-idx="${i}"></div>
            <button class="btn btn-sm btn-primary ws-apply" data-idx="${i}" style="margin-top:8px;width:100%;font-size:11.5px;">Bunu uygula</button>
          </div>`).join('')}
      </div>
      <div class="option-dots">
        ${secenekler.map((_, i) => `<span class="option-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></span>`).join('')}
        <span style="font-size:11px;color:var(--text-muted);margin-left:6px;">← kaydır →</span>
      </div>
      <div id="wsOptReview"></div>
      <button class="btn btn-sm" id="wsDeepAll" style="width:100%;margin-top:6px;font-size:11.5px;" title="Üç seçeneği de işlev, süreklilik ve eylem sırası açısından denetler">🔎 Üçünü de derin kontrol et</button>
      <button class="btn btn-sm" id="wsMoreOptions" style="width:100%;margin-top:6px;font-size:11.5px;">🔄 Farklı 3 öneri getir</button>
      <div id="wsPhraseBox"></div>`;
    wireOptionSwiper(box);

    // Cevaplar kalıcı: direktiflere girer, aynı soru tekrar sorulmaz
    el('wsAnswerGo').addEventListener('click', async (e) => {
      const cevaplar = [...box.querySelectorAll('.ai-answer')]
        .map((inp, i) => ({ soru: sorular[i], cevap: inp.value.trim() }))
        .filter(x => x.cevap);
      if (!cevaplar.length) { alert('Önce en az bir soruyu cevapla.'); return; }
      paraAnswers[num] = [...(paraAnswers[num] || []), ...cevaplar].slice(-6);
      saveParaState();
      e.target.disabled = true; e.target.textContent = 'Cevaplarla yeniden üretiliyor…';
      await workshopFix(chapter, num, issue);
    });

    // BİRLİKTE DEĞERLENDİRME (otomatik, TEK istek): adaylar kıyaslanır -
    // hangisi bulguları gerçekten giderdi, hangisi yeni sorun getirdi.
    // Her adayı ayrı denetlemekten ucuz ve daha isabetli.
    if (secenekler.length > 1 && kayitlar.length) {
      (async () => {
        const kutu = el('wsOptReview');
        kutu.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px;">Adaylar bulgulara karşı kıyaslanıyor…</div>';
        try {
          const rv = await api.post('/ai/review-options', {
            original: eskiMetin,
            options: secenekler.map(o => o.text),
            findings: [
              ...kayitlar.map(k => `${k.baslik}: ${k.sorun || ''}`),
              // Ölçütler bulgularla birlikte gider: adaylar aynı hedefe
              // karşı değerlendirilsin
              ...((workshopState.diagnoses || {})[num] || [])
                .filter(d => (d.success_criterion || '').trim())
                .map(d => `BAŞARI ÖLÇÜTÜ: ${d.success_criterion.trim()}`),
            ],
            purpose: effectiveParaPurpose(num).text,
          });
          const simge = { iyi: '✅', kismi: '🟡', kotu: '❌' };
          const renk = { iyi: '#3f7a4f', kismi: '#b08d3f', kotu: 'var(--danger)' };
          // Rozetleri güncelle + en iyiyi işaretle
          (rv.options || []).forEach(o => {
            const rozet = box.querySelector(`.opt-badge[data-idx="${o.index}"]`);
            if (rozet) {
              rozet.textContent = `${simge[o.verdict]} ${o.verdict}`;
              rozet.style.color = renk[o.verdict];
            }
            const kart = box.querySelector(`.option-card[data-idx="${o.index}"]`);
            if (kart && o.index === rv.best_index) kart.style.borderColor = '#3f7a4f';
            const kutucuk = box.querySelector(`.opt-deep[data-idx="${o.index}"]`);
            if (kutucuk) kutucuk.innerHTML = `
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px;border-top:1px dashed var(--border);padding-top:4px;">
                ${o.resolved.length ? `<div style="color:#3f7a4f;">✓ giderdi: ${o.resolved.map(escapeHtml).join('; ')}</div>` : ''}
                ${o.remaining.length ? `<div style="color:#b08d3f;">◌ duruyor: ${o.remaining.map(escapeHtml).join('; ')}</div>` : ''}
                ${o.new_issues.length ? `<div style="color:var(--danger);">⚠ yeni: ${o.new_issues.map(escapeHtml).join('; ')}</div>` : ''}
                ${o.note ? `<div>${escapeHtml(o.note)}</div>` : ''}
              </div>`;
          });
          kutu.innerHTML = rv.all_insufficient
            ? `<div style="font-size:12px;color:var(--danger);margin-top:6px;padding:6px 8px;border:1px solid var(--danger);border-radius:6px;">
                 ⚠ <b>Hiçbir aday yeterli değil.</b>${rv.retry_hint ? ' ' + escapeHtml(rv.retry_hint) : ''}
                 <div style="margin-top:6px;">Kararı sen ver: <b>🔄 Farklı 3 öneri</b> ile yeniden üret,
                 <b>💬 Konuş</b> ile yönlendir ya da yine de bir adayı uygula.</div>
               </div>`
            : `<div style="font-size:12px;color:#3f7a4f;margin-top:6px;">
                 ✓ Önerilen: <b>SEÇENEK ${(rv.best_index ?? 0) + 1}</b>${rv.best_reason ? ' — ' + escapeHtml(rv.best_reason) : ''}
               </div>`;
        } catch (err) {
          kutu.innerHTML = '';   // değerlendirme başarısızsa sessiz - adaylar zaten görünüyor
        }
      })();
    }

    // TOPLU DERİN KONTROL: üçünü birden denetler, sonuçları kartlara yazar.
    // Tek tek uygulayıp geri dönmek yerine hepsini önden görürsün.
    el('wsDeepAll').addEventListener('click', async (e) => {
      const b = e.target; b.disabled = true; b.textContent = 'Üçü denetleniyor…';
      const sonuclar = await Promise.all(secenekler.map(o =>
        verifyBeforeApply(chapter.id, num, eskiMetin, o.text)));
      sonuclar.forEach((v, i) => {
        secenekler[i].deep = v;
        const renk = { kabul: '#3f7a4f', duzelt: '#b08d3f', red: 'var(--danger)' }[v.verdict] || 'var(--text-muted)';
        const etiket = { kabul: '✓ kabul', duzelt: '⚠ düzeltilmeli', red: '✕ red' }[v.verdict] || v.verdict;
        const rozet = box.querySelector(`.opt-badge[data-idx="${i}"]`);
        if (rozet) { rozet.style.color = renk; rozet.textContent = etiket; }
        const kutu = box.querySelector(`.opt-deep[data-idx="${i}"]`);
        const bulgular = [...(v.hard_issues || []), ...(v.issues || [])];
        if (kutu) kutu.innerHTML = `
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;border-top:1px dashed var(--border);padding-top:4px;">
            ${v.note ? escapeHtml(v.note) : ''}
            ${bulgular.length ? `<ul style="margin:4px 0 0 14px;padding:0;">${bulgular.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
          </div>`;
      });
      // En iyi seçeneği işaretle
      const enIyi = sonuclar.findIndex(v => v.verdict === 'kabul');
      if (enIyi >= 0) {
        const kart = box.querySelector(`.option-card[data-idx="${enIyi}"]`);
        if (kart) kart.style.borderColor = '#3f7a4f';
      }
      b.disabled = false; b.textContent = '🔎 Üçünü de derin kontrol et';
    });

    // FARKLI 3 ÖNERİ: önceki yaklaşımları dışlayarak yeniden üret
    el('wsMoreOptions').addEventListener('click', async (e) => {
      const b = e.target; b.disabled = true; b.textContent = 'Yeni seçenekler…';
      const oncekiler = secenekler.map(o => o.approach).filter(Boolean).join(', ');
      await workshopFix(chapter, num, issue
        + (oncekiler ? ` ÖNCEKİ YAKLAŞIMLARI TEKRARLAMA (${oncekiler}); tamamen farklı üç yol dene.` : ''), 0);
    });

    // İFADE BAZLI DEĞİŞTİRME: altın bir öbeğe tıkla -> sadece o ifade için
    // alternatifler. Tüm paragrafı yeniden yazdırmadan nokta atışı düzeltme.
    box.querySelectorAll('.diff-clickable').forEach(sp => sp.addEventListener('click', () =>
      openPhraseAlternatives(chapter, num, sp, secenekler)));
    box.querySelectorAll('.ws-apply').forEach(b => b.addEventListener('click', async (e) => {
      const secenek = secenekler[parseInt(e.target.dataset.idx, 10)];
      const secilen = secenek.text;
      const eski = para ? para.text : '';
      // Zaten denetlenmiş ve TEMİZ ise ikinci kez kontrol etme - kullanıcı
      // sonucu görerek seçti, tekrar sormak gereksiz sürtünme.
      if (secenek.deep && secenek.deep.verdict === 'kabul' && !secenek.quick.length) {
        await replaceParagraphText(chapter.id, num, secilen);
        resolvedParas.add(String(num)); saveParaState();
        if (para) para.text = secilen;
        const paraEl = document.getElementById('wsParaText');
        if (paraEl) paraEl.textContent = secilen;
        box.innerHTML = `
          <div style="font-size:12.5px;color:#3f7a4f;">✓ Kaydedildi (denetimden geçmişti).</div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            <button class="btn btn-sm" id="wsRefine" style="font-size:11.5px;">✨ Bunu da geliştir</button>
            <button class="btn btn-sm btn-primary" id="wsGoNext" style="font-size:11.5px;">Sonraki paragraf →</button>
          </div>`;
        el('wsRefine').addEventListener('click', () =>
          workshopFix(chapter, num, 'Metni bir tur daha güçlendir; aynı yaklaşımları tekrarlama.'));
        el('wsGoNext').addEventListener('click', () => {
          const sira = workshopState.order;
          if (workshopState.idx === sira.length - 1) renderWorkshopDone();
          else renderWorkshopParagraph(workshopState.idx + 1);
        });
        return;
      }
      e.target.insertAdjacentElement('afterend', renderQuickCheck(
        eski, secilen,
        async () => {
          await replaceParagraphText(chapter.id, num, secilen);
          resolvedParas.add(String(num)); saveParaState();
          if (para) para.text = secilen;
          const paraEl = document.getElementById('wsParaText');
        if (paraEl) paraEl.textContent = secilen;
          box.innerHTML = `
            <div style="font-size:12.5px;color:#3f7a4f;">✓ Kaydedildi.</div>
            <div id="wsRetest" style="margin-top:8px;font-size:12.5px;color:var(--text-muted);">Bulgular yeniden sınanıyor…</div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
              <button class="btn btn-sm" id="wsRefine" style="font-size:11.5px;">✨ Bunu da geliştir</button>
              <button class="btn btn-sm" id="wsUndo" style="font-size:11.5px;" title="Bu paragrafı önceki hâline döndür">↩ Geri al</button>
              <button class="btn btn-sm btn-primary" id="wsGoNext" style="font-size:11.5px;">Sonraki paragraf →</button>
            </div>`;
          // GERİ ALMA: uyguladıktan sonra pişman olunca atölyeden çıkmak
          // gerekmesin - eski metin elimizde, tek tıkla geri yazılır.
          el('wsUndo').addEventListener('click', async () => {
            await replaceParagraphText(chapter.id, num, eski);
            if (para) para.text = eski;
            const paraEl3 = document.getElementById('wsParaText');
            if (paraEl3) paraEl3.textContent = eski;
            resolvedParas.delete(String(num)); saveParaState();
            box.innerHTML = '<div style="font-size:12.5px;color:var(--text-muted);">↩ Önceki hâline döndürüldü.</div>';
          });
          // YENİDEN TEST: bulgular gerçekten giderildi mi? Kabul kontrolü
          // "detay düştü mü" bakıyordu; bu "klişe kalktı mı" bakıyor.
          runParagraphRetest(num, eski, secilen, kayitlar);
          // Kaydettikten sonra da yol açık: metin üzerinde tekrar çalışılabilir
          el('wsRefine').addEventListener('click', () =>
            workshopFix(chapter, num, 'Metni bir tur daha güçlendir; aynı yaklaşımları tekrarlama.'));
          el('wsGoNext').addEventListener('click', () => {
            const sira = workshopState.order;
            if (workshopState.idx === sira.length - 1) renderWorkshopDone();
            else renderWorkshopParagraph(workshopState.idx + 1);
          });
        },
        () => verifyBeforeApply(chapter.id, num, eski, secilen),
        (uyarilar, not) => openWorkshopVerifyChat(chapter, num, eski, secilen, uyarilar, not),
      ));
    }));
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderWorkshopDone() {
  const ov = document.getElementById('workshopOverlay');
  const sira = workshopState.order;
  const cozulen = sira.filter(n => resolvedParas.has(String(n))).length;
  ov.innerHTML = workshopShell('Tamamlandı', 3, `
    <div style="text-align:center;padding:20px 0;">
      <div style="font-size:40px;">${cozulen === sira.length ? '🎉' : '📝'}</div>
      <div style="font-size:16px;font-weight:600;margin-top:8px;">${cozulen}/${sira.length} paragraf düzeltildi</div>
      <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">
        ${cozulen === sira.length ? 'Tüm bulgular ele alındı.' : `${sira.length - cozulen} paragraf atlandı - istediğinde geri dönebilirsin.`}
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn" id="wsAgain" style="flex:1;">Yeniden incele</button>
      <button class="btn btn-primary" id="wsFinish" style="flex:1;">Bitir</button>
    </div>`);
  el('workshopClose').addEventListener('click', closeWorkshop);
  el('wsAgain').addEventListener('click', renderWorkshopReview);
  el('wsFinish').addEventListener('click', closeWorkshop);
}

// ---------------------------------------------------------------------------
// ATÖLYE SEÇİCİ: hangi bölüm/kısım üzerinde çalışılacağını Denetim menüsünden
// seçmek. Atölye eskiden yalnızca AÇIK bölümden başlatılabiliyordu; 56
// bölümlük bir romanda "hangisini elden geçireceğim" sorusu tek yerde
// cevaplanmalı. Liste hiyerarşik numaralarla gelir ve her girdinin DURUMU
// görünür: özet var mı, kaç paragraf, daha önce elden geçirilmiş mi.
// ---------------------------------------------------------------------------
async function renderWorkshopPicker(el) {
  el.innerHTML = '<div class="empty-state">Fihrist yükleniyor…</div>';
  try {
    const tumu = await api.get('/chapters/');
    const hiyerarsi = buildChapterHierarchy(tumu);
    const metinliler = hiyerarsi.filter(it => (it.chapter.paragraph_count || 0) > 0);
    if (!metinliler.length) {
      el.innerHTML = '<div class="empty-state">Henüz metin yazılmış bir bölüm yok.</div>';
      return;
    }

    const durum = (c) => {
      const ozet = (c.summary || '').trim();
      let elden = 0;
      try {
        const raw = localStorage.getItem(`roman_para_state_${c.id}`);
        if (raw) elden = (JSON.parse(raw).resolved || []).length;
      } catch (e) { /* yoksay */ }
      return { ozet: !!ozet, elden };
    };

    el.innerHTML = `
      <p style="font-size:12.5px;color:var(--text-muted);margin-top:0;max-width:680px;">
        Elden geçirilecek girdiyi seç. Atölye üç adımda ilerler: <b>hazırlık</b> (özet,
        zaman çizelgesi, plan) → <b>inceleme</b> (editör + okur gözü) → <b>paragraf paragraf düzeltme</b>.
        Mobilde tam ekran çalışır.
      </p>
      <input type="text" id="wsFilter" placeholder="Başlıkta ara…" style="max-width:280px;margin-bottom:8px;">
      <div id="wsPickerList">
        ${metinliler.map(it => {
          const c = it.chapter;
          const d = durum(c);
          const tur = c.kind === 'part' ? 'ÜST' : (c.kind === 'subtitle' ? 'ARA' : 'metin');
          return `
          <div class="entity-row ws-pick-row" data-title="${escapeHtml((c.title || '').toLowerCase())}" data-id="${c.id}" style="flex-wrap:wrap;">
            <div style="flex:1;min-width:220px;">
              <div class="name">#${it.displayNumber} ${escapeHtml(stripMarkdownArtifacts(c.title) || '(başlıksız)')}</div>
              <div class="desc" style="display:flex;gap:8px;flex-wrap:wrap;font-size:11.5px;">
                <span>${c.paragraph_count} paragraf</span>
                <span style="color:${d.ozet ? '#3f7a4f' : 'var(--danger)'}">${d.ozet ? '✓ özet var' : '✗ özet yok'}</span>
                ${d.elden ? `<span style="color:#3f7a4f;">✓ ${d.elden} paragraf elden geçmiş</span>` : ''}
                <span style="color:var(--text-muted);">[${tur}]</span>
              </div>
            </div>
            <div class="actions">
              <button class="btn btn-sm btn-primary ws-open" data-id="${c.id}">🛠 Atölyeyi aç</button>
              <button class="btn btn-sm ws-goto" data-id="${c.id}">Bölüme git</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;

    el.querySelector('#wsFilter').addEventListener('input', (e) => {
      const q = _trLowerJs(e.target.value.trim());
      el.querySelectorAll('.ws-pick-row').forEach(row => {
        row.style.display = !q || _trLowerJs(row.dataset.title).includes(q) ? '' : 'none';
      });
    });
    el.querySelectorAll('.ws-open').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Açılıyor…';
      try {
        const ch = await api.get(`/chapters/${b.dataset.id}`);
        currentChapter = ch;                 // atölye içindeki işlemler bunu kullanır
        loadParaState(ch.id);                // o bölümün önceki kararları
        openChapterWorkshop(ch);
      } catch (err) { alert(err.message); }
      b.disabled = false; b.textContent = '🛠 Atölyeyi aç';
    }));
    el.querySelectorAll('.ws-goto').forEach(b => b.addEventListener('click', () => {
      switchView('roman');
      setTimeout(() => loadChapterList(parseInt(b.dataset.id, 10)), 200);
    }));
  } catch (err) {
    el.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// Seçenek kartları arası kaydırma: dokunmatikte parmakla, masaüstünde
// ok tuşları ve noktalarla. scroll-snap sayesinde kart tam ortalanır.
function wireOptionSwiper(box) {
  const swiper = box.querySelector('.option-swiper');
  const dots = box.querySelectorAll('.option-dot');
  if (!swiper) return;
  const guncelle = () => {
    const kartGenislik = swiper.querySelector('.option-card')?.offsetWidth || 1;
    const aktif = Math.round(swiper.scrollLeft / kartGenislik);
    dots.forEach((d, i) => d.classList.toggle('active', i === aktif));
  };
  swiper.addEventListener('scroll', () => { window.requestAnimationFrame(guncelle); });
  dots.forEach(d => d.addEventListener('click', () => {
    const kartGenislik = swiper.querySelector('.option-card')?.offsetWidth || 0;
    swiper.scrollTo({ left: kartGenislik * parseInt(d.dataset.idx, 10), behavior: 'smooth' });
  }));
  swiper.addEventListener('keydown', (e) => {
    const kartGenislik = swiper.querySelector('.option-card')?.offsetWidth || 0;
    if (e.key === 'ArrowRight') { e.preventDefault(); swiper.scrollBy({ left: kartGenislik, behavior: 'smooth' }); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); swiper.scrollBy({ left: -kartGenislik, behavior: 'smooth' }); }
  });
}

// ---------------------------------------------------------------------------
// SEÇENEK AYRIŞTIRMA: "###YAKLAŞIM: x" satırlarıyla ayrılmış blokları okur.
// Neden JSON değil: /ai/assist düz metin üretmeye ayarlı; JSON istendiğinde
// model kimi zaman hiç metin döndürmüyor ve kart BOŞ görünüyordu. Ayraç,
// metin modelleri için çok daha dayanıklı - bozulsa bile ham metin kalır.
// ---------------------------------------------------------------------------
function parseOptionBlocks(raw) {
  const metin = (raw || '').trim();
  if (!metin) return [];
  // AYRAÇ: ### ile başlayan HER satır seçenek ayracıdır. Neden bu kadar
  // gevşek: eskiden "^###\s*YAKLAŞIM" aranıyordu ama JavaScript'te büyük
  // "I" ile küçük "ı" case-insensitive EŞLEŞMEZ - model doğal biçimde
  // "###Yaklaşım:" yazınca ayrıştırma tamamen düşüyor ve "3 öneri getir"
  // çalışmıyordu. Artık başlık metni ne olursa olsun bölme çalışır.
  // AYRAÇ ESNEKLİĞİ: model her seferinde aynı biçimi kullanmıyor. Sadece
  // "###" aranınca "SEÇENEK 1:", numaralı liste ya da "---" biçimlerinde
  // üç seçenek TEK bloğa yapışıyor ve ekranda "1/1" görünüyordu (fark
  // vurgulaması da anlamsızlaşıyordu). Tanınan biçimler:
  //   ### başlık        ## başlık
  //   SEÇENEK 1 / SEÇENEK 1:        1. / 1)          **1)** / **Seçenek 1**
  //   --- (yatay çizgi)
  const AYRAC = new RegExp(
    '^\\s*(?:' +
      '#{2,}\\s*' +                                   // ### başlık
      '|-{3,}\\s*$' +                                  // --- ayraç
      '|\\**\\s*(?:SEÇENEK|SECENEK|Seçenek|Secenek|ALTERNATİF|Alternatif)\\s*\\d+\\s*\\**\\s*:?\\s*' +
      '|\\**\\s*\\d+\\s*[.)]\\s*\\**\\s*' +          // 1. / 1) / **1)**
    ')', 'm');
  // split() yakalama grubu içermemeli ve ilk parça kaybolmamalı:
  // ayraçları satır başına işaretleyip öyle böleriz.
  const ISARET = '\u0000';
  const isaretli = metin.split('\n').map(satir =>
    AYRAC.test(satir) ? ISARET + satir.replace(AYRAC, '') : satir).join('\n');
  let parcalar = isaretli.split(ISARET).filter(x => x && x.trim());

  // SON ÇARE: model hiçbir ayraç kullanmadıysa ama BOŞ SATIRLA ayrılmış
  // 2-4 tam paragraf döndürdüyse, bunları seçenek say. Ölçüt sıkı tutulur
  // (her parça en az 40 karakter ve cümle gibi bitiyor) - yoksa tek bir
  // paragrafın içindeki boş satırlar yanlışlıkla bölünür.
  if (parcalar.length === 1) {
    const bloklar = parcalar[0].split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
    const uygun = bloklar.length >= 2 && bloklar.length <= 4
      && bloklar.every(b => b.length >= 40 && /[.!?"'…»]\s*$/.test(b));
    if (uygun) parcalar = bloklar;
  }
  if (parcalar.length <= 1) {
    // Ayraç yok - tek seçenek olarak ele al (JSON geldiyse temizle)
    const temiz = metin.replace(/^```(?:json)?|```$/gm, '').trim();
    try {
      const veri = JSON.parse(temiz.slice(temiz.indexOf('{'), temiz.lastIndexOf('}') + 1));
      const opts = (veri.options || []).filter(o => (o.text || '').trim());
      if (opts.length) return opts.map(o => ({ text: o.text.trim(), approach: (o.approach || '').trim() }));
    } catch (e) { /* düz metin */ }
    return [{ text: temiz, approach: '' }];
  }
  return parcalar.map(p => {
    const satirlar = p.split('\n');
    // Ayraç satırında metin de varsa ("1. Metin A." ya da "--- " sonrası),
    // ilk satır BAŞLIK değil METİNDİR - başlığı boş bırakıp metni koru.
    const ilk = satirlar[0].trim();
    const baslikGibi = ilk.length <= 60 && !/[.!?]\s*$/.test(ilk);
    if (!baslikGibi) {
      return { text: p.trim(), approach: '', reason: '' };
    }
    // Başlık satırı: "YAKLAŞIM: mikro detay | NEDEN: gerekçe" ya da sadece
    // "mikro detay". Başındaki etiket kelimesi (yaklaşım/approach) atılır.
    let bas = satirlar[0].trim()
      .replace(/\*+/g, '')                                   // **kalın** işaretleri
      .replace(/^(yakla[şs][iı]m|approach)\s*:?\s*/i, '')
      .trim();
    const m = bas.match(/^(.*?)\s*\|\s*(?:NEDEN|WHY)\s*:?\s*(.*)$/i);
    const approach = (m ? m[1] : bas).trim().slice(0, 40);
    const reason = (m ? m[2] : '').trim().slice(0, 160);
    const text = satirlar.slice(1).join('\n').trim();
    return { text, approach, reason };
  }).filter(o => o.text);
}

// ---------------------------------------------------------------------------
// FARK VURGULAMA: önerinin DEĞİŞEN kısımları altın, korunan kısımlar siyah.
// Kelime bazlı LCS - "neresi değişmiş" sorusunu okumadan görebilmek için.
// ---------------------------------------------------------------------------
function highlightDiff(eski, yeni) {
  const a = (eski || '').split(/(\s+)/);
  const b = (yeni || '').split(/(\s+)/);
  // LCS tablosu (kelime sayısı makul: paragraf ölçeği)
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Ardışık değişen kelimeler TEK öbekte toplanır: "cam kılıf" iki ayrı
  // span değil, tıklanıp topluca değiştirilebilen bir ifade olur.
  let i = 0, j = 0;
  const parcalar = [];   // {changed: bool, text: string}
  const ekle = (changed, text) => {
    const son = parcalar[parcalar.length - 1];
    if (son && son.changed === changed) son.text += text;
    else parcalar.push({ changed, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) { ekle(false, b[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; }
    else { ekle(true, b[j]); j++; }
  }
  while (j < m) { ekle(true, b[j]); j++; }

  return parcalar.map((p, idx) => {
    if (!p.changed || !p.text.trim()) return escapeHtml(p.text);
    return `<span class="diff-new diff-clickable" data-phrase="${escapeHtml(p.text.trim())}" data-pi="${idx}" title="Tıkla: bu ifade için alternatif iste">${escapeHtml(p.text)}</span>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// İFADE BAZLI ALTERNATİF: önerideki altın (değişmiş) bir öbeğe tıklayınca
// SADECE o ifade için üç alternatif ister. Tüm paragrafı yeniden yazdırmak
// yerine nokta atışı düzeltme - "cam kılıf yerine başka ne olur?" sorusunun
// doğrudan cevabı. Seçilen alternatif kartın metnine yerinde işlenir.
// ---------------------------------------------------------------------------
async function openPhraseAlternatives(chapter, num, spanEl, secenekler) {
  const box = document.getElementById('wsPhraseBox');
  if (!box) return;
  const ifade = spanEl.dataset.phrase;
  const kart = spanEl.closest('.option-card');
  const idx = parseInt(kart?.dataset.idx || '0', 10);
  const tamMetin = secenekler[idx]?.text || '';

  box.innerHTML = `<div class="panel" style="margin-top:8px;">
    <div style="font-size:12px;">"<b>${escapeHtml(ifade)}</b>" için alternatifler aranıyor…</div></div>`;
  // Kelime bazlı istek de AYNI direktiflere uyar: testlerden çıkan kurallar,
  // korunacak veriler ve kaçınılacak kalıplar burada da geçerli. Eskiden
  // kelime kuralsız değişiyordu ve paragrafın geri kalanıyla çelişebiliyordu.
  const direktifler = (workshopState.directives && workshopState.directives[num])
    || buildParagraphDirectives(num, workshopState.findings[num] || [], tamMetin);
  const instruction =
    `Aşağıdaki paragrafta geçen "${ifade}" ifadesi için ÜÇ ALTERNATİF öner.\n`
    + `UYULACAK DİREKTİFLER (paragrafın tamamı için geçerli):\n${direktifler}\n`
    + 'Kurallar: alternatifler aynı uzunluk mertebesinde olsun, paragrafın akışına ve '
    + 'zamanına uysun, klişe olmasın. Sadece ifadeyi ver, cümleyi yeniden yazma.\n'
    + 'BİÇİM: her satırda tek alternatif, başına "- " koy, başka hiçbir şey yazma.\n'
    + `PARAGRAF:\n${tamMetin}`;
  try {
    const r = await api.post('/ai/assist', {
      chapter_number: chapter.number, instruction, selected_entities: [], existing_text: ifade,
    });
    const alternatifler = (r.generated_text || '').split('\n')
      .map(x => x.replace(/^[-*•]\s*/, '').trim())
      .filter(x => x && x.length < 200).slice(0, 5);
    if (!alternatifler.length) {
      box.innerHTML = '<div class="error-text" style="font-size:12px;">Alternatif üretilemedi.</div>';
      return;
    }
    box.innerHTML = `
      <div class="panel" style="margin-top:8px;">
        <div style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">"${escapeHtml(ifade)}" YERİNE</div>
        ${alternatifler.map((a, i) => `
          <button class="btn btn-sm phrase-pick" data-alt="${escapeHtml(a)}" style="display:block;width:100%;text-align:left;margin-top:6px;font-size:12.5px;">${escapeHtml(a)}</button>`).join('')}
        <button class="btn btn-sm" id="phraseClose" style="margin-top:8px;font-size:11.5px;">Kapat</button>
      </div>`;
    el('phraseClose').addEventListener('click', () => { box.innerHTML = ''; });
    box.querySelectorAll('.phrase-pick').forEach(b => b.addEventListener('click', () => {
      // Seçilen alternatifi kartın metnine YERİNDE işle
      const yeni = tamMetin.replace(ifade, b.dataset.alt);
      secenekler[idx].text = yeni;
      const govde = kart.querySelector('div[style*="white-space:pre-wrap"]');
      const para = (chapter.paragraphs || []).find(p => p.number === num);
      if (govde) govde.innerHTML = highlightDiff(para ? para.text : '', yeni);
      kart.querySelectorAll('.diff-clickable').forEach(sp => sp.addEventListener('click', () =>
        openPhraseAlternatives(chapter, num, sp, secenekler)));
      box.innerHTML = '<div style="font-size:12px;color:#3f7a4f;margin-top:6px;">✓ İfade değiştirildi - kartta güncellendi.</div>';
    }));
  } catch (err) {
    box.innerHTML = `<div class="error-text" style="font-size:12px;">${escapeHtml(err.message)}</div>`;
  }
}

// Düzeltme sonrası yeniden test: her bulgunun durumu ayrı ayrı gösterilir.
// BULGU BAZLI ÇÖZÜM: paragraf ancak TÜM bulguları giderildiyse "çözüldü"
// sayılır; kısmi kalanlar listede durur (eskiden ilk düzeltmede paragrafın
// tamamı çözülmüş sayılıyor, kalan bulgular gözden kayboluyordu).
async function runParagraphRetest(num, eskiMetin, yeniMetin, kayitlar) {
  const kutu = document.getElementById('wsRetest');
  if (!kutu) return;
  const bulguMetinleri = (kayitlar || []).map(k => `${k.baslik}: ${k.sorun || ''}`);
  if (!bulguMetinleri.length) { kutu.innerHTML = ''; return; }
  try {
    const r = await api.post('/ai/retest-paragraph', {
      old_text: eskiMetin, new_text: yeniMetin, findings: bulguMetinleri,
      proposal_goal: (workshopState.lastGoal && workshopState.lastGoal[num]) || '',
      expected_effect: bulguMetinleri.join(' | '),
    });
    const simge = { giderildi: '✅', kismen: '🟡', giderilmedi: '❌' };
    const kalanlar = r.results.filter(x => x.status !== 'giderildi');
    const yon = { iyilesti: '#3f7a4f', ayni: '#b08d3f', kotulesti: 'var(--danger)' }[r.verdict];
    kutu.innerHTML = `
      <div style="border-left:3px solid ${yon};padding-left:8px;">
        <div style="font-weight:600;color:${yon};">Yeniden test: ${escapeHtml(r.verdict)}</div>
        ${r.results.map(x => `<div>${simge[x.status] || '•'} ${escapeHtml(x.finding)}${x.note ? ` — <span style="color:var(--text-muted);">${escapeHtml(x.note)}</span>` : ''}</div>`).join('')}
        ${r.new_issues.length ? `<div style="color:var(--danger);margin-top:4px;">⚠ Yeni sorun: ${r.new_issues.map(escapeHtml).join('; ')}</div>` : ''}
        ${kalanlar.length ? `<button class="btn btn-sm" id="wsFixRest" style="margin-top:6px;font-size:11.5px;">✨ Kalan ${kalanlar.length} bulguyu da gider</button>` : ''}
      </div>`;
    // Bulgu bazlı çözüm: hepsi giderilmediyse paragraf "çözüldü" sayılmaz
    if (kalanlar.length) {
      resolvedParas.delete(String(num));
      saveParaState();
      document.getElementById('wsFixRest')?.addEventListener('click', () =>
        workshopFix(workshopState.chapter, num,
          'Kalan bulgular: ' + kalanlar.map(x => x.finding).join(' | ')));
    }
  } catch (err) {
    kutu.innerHTML = `<span style="color:var(--danger);">Yeniden test yapılamadı: ${escapeHtml(err.message)}</span>`;
  }
}

// ---------------------------------------------------------------------------
// KONTROL SONRASI SOHBET: derin kontrol bir sorun bulduğunda "uyarılara göre
// yeniden yaz" bağa giriyordu (aynı uyarılar tekrar çıkıyor, döngü
// kapanmıyor). En iyi sonucu şu üçlü veriyor: KONTROL UYARILARI + SEÇİLEN
// METİN + AI'nın kendi yorumu, birlikte tartışılarak. Karar insanla
// birlikte veriliyor; anlaşınca "✍️ yeni versiyonu yaz" ile üretiliyor.
// ---------------------------------------------------------------------------
function openWorkshopVerifyChat(chapter, num, eskiMetin, secilenMetin, uyarilar, aiNotu) {
  const box = document.getElementById('wsWork');
  if (!box) return;
  const para = (chapter.paragraphs || []).find(p => p.number === num);

  // Sohbeti üç bilgiyle tohumla: uyarılar, seçilen metin, AI yorumu
  paraChatHistories[num] = paraChatHistories[num] || [];
  const acilis =
    `P${num} için seçtiğim versiyon şu:\n"${secilenMetin}"\n\n`
    + (uyarilar.length ? `Kontrol şu uyarıları verdi:\n- ${uyarilar.join('\n- ')}\n` : '')
    + (aiNotu ? `Kontrolün notu: ${aiNotu}\n` : '')
    + '\nSence bu uyarılar haklı mı? Hangisini nasıl çözelim - metni bozmadan?';

  box.dataset.mode = 'chat';
  box.innerHTML = `
    <div class="panel" style="margin-top:8px;border-left:3px solid var(--gold);">
      <div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;">💬 KONTROL SONRASI TARTIŞMA</div>
      <div class="para-chat-log" data-number="${num}" style="max-height:240px;overflow-y:auto;font-size:12.5px;margin-top:6px;"></div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <textarea class="para-chat-input" data-number="${num}" placeholder="Ör: ilk uyarı haklı, ikincisi değil" style="flex:1;min-height:38px;box-sizing:border-box;font-size:12.5px;"></textarea>
        <button class="btn btn-sm btn-primary" id="wsVcSend">Gönder</button>
      </div>
      <button class="btn btn-sm btn-primary" id="wsVcWrite" style="margin-top:6px;width:100%;font-size:11.5px;">✍️ Konuştuklarımıza göre yeni versiyonu yaz</button>
      <button class="btn btn-sm" id="wsVcKeep" style="margin-top:6px;width:100%;font-size:11.5px;">Yine de seçtiğim metni uygula</button>
    </div>`;

  renderParaChatLog(num);
  // İlk soruyu otomatik gönder - kullanıcı yazmadan tartışma başlasın
  const input = box.querySelector('.para-chat-input');
  input.value = acilis;
  sendParagraphChat(chapter, num, '', para ? para.text : eskiMetin);

  el('wsVcSend').addEventListener('click', () =>
    sendParagraphChat(chapter, num, '', para ? para.text : eskiMetin));
  el('wsVcWrite').addEventListener('click', () =>
    writeParagraphVersion(chapter, num, '', para ? para.text : eskiMetin));
  el('wsVcKeep').addEventListener('click', async () => {
    await replaceParagraphText(chapter.id, num, secilenMetin);
    resolvedParas.add(String(num)); saveParaState();
    if (para) para.text = secilenMetin;
    const el = document.getElementById('wsParaText');
    if (el) el.textContent = secilenMetin;
    box.innerHTML = '<div style="font-size:12.5px;color:#3f7a4f;">✓ Kaydedildi.</div>';
  });
}

// Teşhisleri sınıflarıyla göster. Kritik: "tercih" sınıfı için düzeltme
// düğmesi ÇIKMAZ - bir edebî normdan sapma otomatik olarak hata değildir.
function renderDiagnoses(num, teshisler) {
  const kutu = document.getElementById('wsDiagnosisBox');
  if (!kutu) return;
  if (!teshisler || !teshisler.length) { kutu.innerHTML = ''; return; }
  // Teşhis geldi: HAM bulgu rozetlerini kaldır - aynı şey iki kez
  // yazılıyordu (üstte ham, altta birleştirilmiş).
  const ham = document.getElementById('wsRawChips');
  if (ham) ham.innerHTML = '';
  const stil = {
    hata: { renk: 'var(--danger)', etiket: '⛔ HATA', not: 'Nesnel kusur - düzeltilmeli.' },
    zayif: { renk: '#b08d3f', etiket: '⚠ ZAYIF', not: 'Tartışılabilir zayıflık.' },
    tercih: { renk: '#3f7a4f', etiket: '✎ YAZAR TERCİHİ', not: 'Bilinçli olabilir - öneri üretilmiyor.' },
    belirsiz: { renk: 'var(--text-muted)', etiket: '? BELİRSİZ', not: 'Kanıt yetersiz.' },
  };
  const siraDegeri = { hata: 0, zayif: 1, belirsiz: 2, tercih: 3 };
  const sirali = teshisler.slice().sort((a, b) => (siraDegeri[a.cls] ?? 9) - (siraDegeri[b.cls] ?? 9));
  kutu.innerHTML = `<div style="font-size:10.5px;color:var(--text-muted);letter-spacing:0.4px;margin-top:8px;">TEŞHİS (${sirali.length}) - dokun, detayı açılsın</div><div id="wsDiagChips"></div>`;
  renderFindingChips('wsDiagChips', sirali.map(d => {
    const st = stil[d.cls] || stil.belirsiz;
    return {
      icon: st.etiket.split(' ')[0],
      label: d.title,
      renk: st.renk,
      detay: `
        <div style="font-size:10.5px;color:${st.renk};font-weight:600;">${st.etiket}
          ${d.sources?.length ? `<span style="color:var(--text-muted);font-weight:400;">· ${d.sources.length} test birleşti</span>` : ''}
          ${d.confidence ? `<span style="color:var(--text-muted);font-weight:400;">· güven %${Math.round(d.confidence * 100)}</span>` : ''}</div>
        ${d.evidence ? `<div style="font-style:italic;color:var(--text-muted);margin-top:2px;">"${escapeHtml(d.evidence)}"</div>` : ''}
        ${d.why ? `<div style="color:var(--text-muted);margin-top:2px;">${escapeHtml(d.why)}</div>` : ''}
        ${d.success_criterion ? `<div style="margin-top:3px;color:#3f7a4f;">🎯 <b>Başarı ölçütü:</b> ${escapeHtml(d.success_criterion)}</div>` : ''}
        ${d.cls === 'tercih' && d.intent_note ? `<div style="color:#3f7a4f;margin-top:2px;">💡 ${escapeHtml(d.intent_note)}</div>` : ''}
        <div style="font-size:10.5px;color:var(--text-muted);margin-top:3px;">${st.not}</div>`,
    };
  }));
}

// ---------------------------------------------------------------------------
// BULGU ROZETLERİ: uzun uzun alt alta metin yerine dokunmatik rozetler.
// Mobilde bulguları okumak için sürekli kaydırmak gerekiyordu; artık
// hepsi tek satırda görünüyor, dokunulan açılıyor. Aynı anda tek detay
// açık kalır - ekran temiz durur.
// ---------------------------------------------------------------------------
function renderFindingChips(kapsayiciId, ogeler) {
  const kap = document.getElementById(kapsayiciId);
  if (!kap) return;
  if (!ogeler || !ogeler.length) { kap.innerHTML = ''; return; }
  kap.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
      ${ogeler.map((o, i) => `
        <button class="btn btn-sm finding-chip" data-idx="${i}"
          style="font-size:11.5px;padding:3px 9px;border-left:3px solid ${o.renk};max-width:100%;
                 white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${o.icon} ${escapeHtml(truncate(o.label, 34))}
        </button>`).join('')}
    </div>
    <div class="chip-detail" style="font-size:12.5px;"></div>`;
  const detayEl = kap.querySelector('.chip-detail');
  const goster = (i) => {
    kap.querySelectorAll('.finding-chip').forEach((b, j) => b.classList.toggle('btn-primary', j === i));
    detayEl.innerHTML = i === null ? '' : `
      <div style="border-left:3px solid ${ogeler[i].renk};padding:6px 8px;margin-top:6px;background:var(--paper-dim);border-radius:0 6px 6px 0;">
        <b>${escapeHtml(ogeler[i].label)}</b>
        ${ogeler[i].detay}
      </div>`;
  };
  kap.querySelectorAll('.finding-chip').forEach((b, i) => b.addEventListener('click', () => {
    const acikMi = b.classList.contains('btn-primary');
    goster(acikMi ? null : i);   // ikinci dokunuş kapatır
  }));
  goster(0);   // ilki açık başlasın
}

// ---------------------------------------------------------------------------
// PARAGRAF KONTROL ÖZETİ: bu paragrafın HANGİ testlerden geçtiğini gösterir.
// Neden gerekli: bulgu çıkmaması "sorunsuz" anlamına gelmiyordu - kontrol
// hiç çalışmamış da olabilir (kapalıydı ya da hata verdi). Kapsama
// görünmeyince yanlış güven oluşuyordu.
//
// Üç durum: ✓ temiz (çalıştı, bulgu yok) · ⚠ bulgu var · ○ çalışmadı.
// ---------------------------------------------------------------------------
function paragrafKontrolDurumu(num) {
  const kayitlar = (workshopState.findings || {})[num] || [];
  const calisanlar = workshopState.ranChecks || [];
  const dusenMetni = (workshopState.failedChecks || []).join(' ');
  return (typeof KONTROLLER !== 'undefined' ? KONTROLLER : []).map(k => {
    if (!calisanlar.includes(k.id)) {
      const dustu = dusenMetni.includes(k.label);
      return { k, durum: 'yok', not: dustu ? 'hata verdi' : (kontrolAcikMi(k.id) ? 'çalışmadı' : 'kapalı') };
    }
    if (!k.kaynak) return { k, durum: 'bilgi', not: 'işlev dolduruldu' };
    const bulgu = kayitlar.filter(x => x.kaynak === k.kaynak);
    return bulgu.length
      ? { k, durum: 'bulgu', not: `${bulgu.length} bulgu`, bulgular: bulgu }
      : { k, durum: 'temiz', not: 'temiz' };
  });
}

function paragrafKontrolOzeti(num) {
  const durumlar = paragrafKontrolDurumu(num);
  if (!durumlar.length) return '';
  const temiz = durumlar.filter(d => d.durum === 'temiz').length;
  const bulgulu = durumlar.filter(d => d.durum === 'bulgu').length;
  const yok = durumlar.filter(d => d.durum === 'yok').length;
  const simge = { temiz: '✓', bulgu: '⚠', yok: '○', bilgi: 'ℹ' };
  const renk = { temiz: '#3f7a4f', bulgu: '#b08d3f', yok: 'var(--text-muted)', bilgi: 'var(--text-muted)' };
  const ozetRenk = bulgulu ? '#b08d3f' : (yok ? 'var(--text-muted)' : '#3f7a4f');
  return `
    <div style="margin-top:6px;">
      <button class="btn btn-sm" id="paraChecksToggle" style="font-size:11px;padding:2px 8px;color:${ozetRenk};"
        title="Bu paragrafın hangi kontrollerden geçtiği - dokun, listeyi aç">
        🧪 ${temiz}/${durumlar.filter(d => d.durum !== 'bilgi').length} kontrol temiz${bulgulu ? ` · ${bulgulu} bulgu` : ''}${yok ? ` · ${yok} çalışmadı` : ''}
      </button>
      <div id="paraChecksList" style="display:none;margin-top:4px;font-size:11.5px;">
        ${durumlar.map(d => `
          <div style="display:flex;gap:6px;padding:2px 0;color:${renk[d.durum]};">
            <span>${simge[d.durum]}</span>
            <span style="flex:1;min-width:0;">${escapeHtml(d.k.label)}
              <span style="color:var(--text-muted);">· ${escapeHtml(d.not)}</span></span>
          </div>`).join('')}
        ${yok ? `<div style="color:var(--text-muted);margin-top:4px;">
          ○ işaretli kontroller çalışmadı - bu paragraf o açıdan <b>denetlenmedi</b>,
          "sorunsuz" olduğu anlamına gelmez.</div>` : ''}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// AŞIRI SİLME UYARISI (deterministik, AI'sız). Üreteç, bulgunun işaret
// etmediği cümleleri de silebiliyor - en sık kurban paragrafın KAPANIŞ
// vuruşu oluyor, ki işlevi çoğu zaman orası taşır. Denetçi bunu sonradan
// "işlev kaybı" diye reddediyor; bu kontrol aynı sorunu ÜCRETSİZ ve ANINDA
// yakalar, kullanıcı seçeneğe bakarken görür.
// ---------------------------------------------------------------------------
function cumlelereAyir(metin) {
  return (metin || '')
    .split(/(?<=[.!?…])\s+/)
    .map(c => c.trim())
    .filter(Boolean);
}

function overDeletionWarnings(eski, yeni) {
  const uyarilar = [];
  const e = cumlelereAyir(eski);
  const y = cumlelereAyir(yeni);
  if (!e.length) return uyarilar;

  // 1) KAPANIŞ VURUŞU korunmuş mu? Tek kelimenin hayatta kalması yetmez -
  //    "Mendil kalmıştı. Sadece mendil." kapanışında yalnızca "mendil"
  //    geçiyor diye korunmuş sayılırsa kontrol işe yaramaz. Kapanışın
  //    ayırt edici kelimelerinin ÇOĞU korunmalı. Son cümle çok kısaysa
  //    (vuruş etkisi için) bir önceki cümleyle birlikte değerlendirilir.
  let kapanis = e[e.length - 1];
  if (e.length >= 2 && kapanis.split(/\s+/).length < 5) {
    kapanis = e[e.length - 2] + ' ' + kapanis;
  }
  const anahtarlar = [...new Set(
    kapanis.toLowerCase()
      .replace(/[.,!?;:—–-]/g, ' ')
      .split(/\s+/)
      .filter(k => k.length > 3)
  )];
  if (anahtarlar.length >= 2) {
    const yeniNorm = (yeni || '').toLowerCase();
    const kalan = anahtarlar.filter(k => yeniNorm.includes(k));
    if (kalan.length / anahtarlar.length < 0.6) {
      uyarilar.push(`Kapanış vuruşu düşmüş: "${truncate(kapanis, 50)}" - paragrafın işlevi çoğu zaman orada durur.`);
    }
  }

  // 2) Cümle sayısında sert düşüş (bulgu "fazla sıfat" ise cümle atılmamalı)
  if (e.length >= 4 && y.length <= Math.ceil(e.length * 0.6)) {
    uyarilar.push(`${e.length} cümle → ${y.length} cümle: bulgunun işaret etmediği cümleler silinmiş olabilir.`);
  }
  return uyarilar;
}
