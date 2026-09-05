// ===========================================================================
// 04-ai-panel.js — AI paneli, sohbet odaları, bağlam önizleme, içe aktarma
// Bu dosya app.js'in bölünmesiyle oluştu. Tüm tanımlar GLOBAL kapsamda
// kalır (modül sistemi yok); index.html'de SIRAYLA yüklenir.
// ===========================================================================

async function renderAiPanel(chapter) {
  const panel = document.getElementById('aiPanel');
  panel.innerHTML = `<h3>AI Yazım Desteği</h3><div class="empty-state">Yükleniyor…</div>`;
  try {
    const lists = await Promise.all(PICKER_TYPES.map(t => api.get(ENTITY_TYPES[t].endpoint)));
    // Bölüme bağlı Plan Matrisi hücresi varsa yazara da göster - AI'ya
    // zaten otomatik gidiyor ama yazarın matris ekranına dönmeden planını
    // görebilmesi gerek. Hata olursa sessiz geç (plan kutusu olmadan devam).
    let planCells = [];
    try { planCells = await api.get(`/matrix/plan-for-chapter/${chapter.id}`); } catch (e) { /* yoksay */ }
    // Bu bölümde zaten geçen (mentions'tan) varlıkları otomatik işaretle -
    // her seferinde elle tek tek tıklamana gerek kalmasın.
    const mentionedKeys = new Set();
    (chapter.paragraphs || []).forEach(p => {
      (p.mentions || []).forEach(m => mentionedKeys.add(`${m.entity_type}:${m.entity_id}`));
    });

    // Her varlık türü KENDİ açılır bölümünde: başlıkta toplam ve seçili
    // sayısı, içinde liste + o menüye gidip düzenleme kısayolu. Tek yığın
    // halinde 30-40 kayıt paneli kullanılmaz hale getiriyordu.
    const TYPE_ICONS = { character: '👤', place: '📍', event: '📅', object: '🔹', foreshadowing: '🔮' };
    const pickerHtml = PICKER_TYPES.map((t, idx) => {
      const items = lists[idx];
      const selectedCount = items.filter(i => mentionedKeys.has(`${t}:${i.id}`)).length;
      const cfgLabel = ENTITY_TYPES[t].plural.toUpperCase();
      if (!items.length) {
        return `<div class="entity-type-group" data-type="${t}" style="border-top:1px solid var(--border);padding:6px 0;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:var(--text-muted);">
            <span>${TYPE_ICONS[t] || ''} ${cfgLabel} <span style="opacity:0.6;">(kayıt yok)</span></span>
            <button class="btn btn-sm goto-menu-btn" data-type="${t}" title="${cfgLabel} menüsüne git ve ekle">+ ekle</button>
          </div>
        </div>`;
      }
      return `<div class="entity-type-group" data-type="${t}" style="border-top:1px solid var(--border);padding:6px 0;">
        <div class="entity-type-header" data-type="${t}" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
          <strong style="font-size:11.5px;letter-spacing:0.3px;">
            <span class="type-caret" data-type="${t}" style="color:var(--text-muted);">${(t === 'character' || t === 'place') ? '▾' : '▸'}</span>
            ${TYPE_ICONS[t] || ''} ${cfgLabel}
            <span style="font-weight:400;color:var(--text-muted);">(${items.length})</span>
            <span class="type-selected-count" data-type="${t}" style="font-weight:400;color:var(--gold);">${selectedCount ? '· ' + selectedCount + ' seçili' : ''}</span>
          </strong>
          <button class="btn btn-sm goto-menu-btn" data-type="${t}" title="${cfgLabel} menüsünde düzenle/ekle">✎</button>
        </div>
        <div class="entity-type-body" data-type="${t}" style="display:${(t === 'character' || t === 'place') ? '' : 'none'};margin-top:4px;max-height:200px;overflow-y:auto;">
          ${items.map(i => {
            const isMentioned = mentionedKeys.has(`${t}:${i.id}`);
            return `<label class="entity-picker-label" data-name="${escapeHtml(i.name.toLowerCase())}"><input type="checkbox" class="entity-check" data-type="${t}" data-id="${i.id}" ${isMentioned ? 'checked' : ''}> ${escapeHtml(i.name)}${isMentioned ? ' <span style="color:var(--gold);font-size:11px;" title="Bu bölümde geçiyor">●</span>' : ''}</label>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    // Bölüme birden fazla FARKLI Plan Matrisi'nden hücre bağlı olabilir
    // (ör. "Ana Olay Örgüsü" + "Yan Karakter Turu" aynı bölümde kesişti).
    // Böyle bir durumda düz liste hangi sahnenin hangi matristen geldiğini
    // gizliyordu - "Tüm sahneleri yaz" da hepsini matris ayrımı olmadan tek
    // taslakta birleştiriyordu. Artık matrise göre GRUPLANIYOR: her grup
    // kendi başlığı ve kendi "Bu plandan taslak oluştur" düğmesiyle ayrı
    // gösterilir - yanlış matristen yazdırma riski ortadan kalkar.
    const matrixGroups = [];
    planCells.forEach((p, i) => {
      let g = matrixGroups.find(g => g.name === p.matrix_name);
      if (!g) { g = { name: p.matrix_name, items: [] }; matrixGroups.push(g); }
      g.items.push({ p, i });
    });
    const multiMatrix = matrixGroups.length > 1;

    // Sahne sayısı arttıkça her hücrenin TAM plan metnini panelde düz
    // basmak listeyi kilometrelerce uzatıyordu. Artık >1 sahne varsa
    // panelde sadece BAŞLIK + kısa önizleme görünür; tam metin "👁" ile
    // açılan bir pencerede (modal) gösterilir - liste kısa kalır, tam
    // metne bir tıklama uzaklığındasın.
    const truncate = (s, n) => (s.length > n ? s.slice(0, n).trim() + '…' : s);

    // Önizlemede ham metni rastgele bir karakter sayısından kesmek yerine
    // hücrenin zaten kendi içinde taşıdığı OLAY alanını (plan_schema.
    // render_cell'de içerik varsa DAİMA ilk satır: "OLAY: <tek cümle>")
    // kullanıyoruz - bu zaten "kim kime ne yapar" özeti, kelimenin
    // ortasından kesilmiş anlamsız bir parça değil.
    const extractOzet = (content) => {
      const line = content.split('\n').find(l => l.trim().toUpperCase().startsWith('OLAY:'));
      const ozet = line ? line.trim().slice(line.indexOf(':') + 1).trim() : '';
      return ozet || truncate(content.replace(/\n/g, ' '), 220);
    };

    const cellRow = (p, i, n) => {
      const compact = planCells.length > 1;
      return `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
        <div style="font-size:12px;color:var(--text-muted);">${compact ? escapeHtml(p.row_label) : `${escapeHtml(p.column_label)} × ${escapeHtml(p.row_label)}`}</div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          ${compact ? `<button class="btn btn-sm plan-cell-gor" data-i="${i}" title="Tam plan metnini pencerede gör">👁</button>` : ''}
          ${planCells.length > 1
            ? `<button class="btn btn-sm plan-tek-taslak" data-i="${i}" title="SADECE bu sahneyi yazdır - diğerleri ayrıca yazılır, mevcut metnin sonuna eklenir">📝 bu sahne</button>`
            : ''}
        </div>
      </div>
      <div style="white-space:pre-wrap;${compact ? 'color:var(--text-muted);' : ''}font-size:12.5px;margin:4px 0 8px;">${compact ? `<b>${n}. Özet:</b> ` : ''}${escapeHtml(compact ? extractOzet(p.content) : p.content)}</div>`;
    };

    const planBodyHtml = multiMatrix
      ? matrixGroups.map((g, gi) => `
          <div style="margin-bottom:10px;padding-bottom:8px;${gi < matrixGroups.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
            <div style="font-size:11px;font-weight:600;color:var(--gold);margin-bottom:4px;">📐 ${escapeHtml(g.name)}</div>
            ${g.items.map(({ p, i }, idx) => cellRow(p, i, idx + 1)).join('')}
            ${g.items.length > 1
              ? `<button class="btn btn-sm btn-primary plan-matrix-taslak" data-matrix="${escapeHtml(g.name)}" style="width:100%;margin-top:2px;">📝 Bu plandan taslak oluştur (${g.items.length} sahne)</button>`
              : ''}
          </div>`).join('')
      : planCells.map((p, i) => cellRow(p, i, i + 1)).join('');

    const planHtml = planCells.length ? `
      <div class="panel" style="border-left:3px solid var(--gold);margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;cursor:pointer;" id="chapterPlanToggle">
          <strong style="font-size:11px;letter-spacing:0.4px;">📋 BÖLÜM PLANI ${planCells.map(p => p.code ? `<span style="color:var(--text-muted);font-weight:400;">${escapeHtml(p.code)}</span>` : '').join(' ')}</strong>
          <span style="font-size:11px;color:var(--text-muted);">▾</span>
        </div>
        <div id="chapterPlanBody" style="margin-top:6px;">
          ${multiMatrix ? `<div style="font-size:11px;color:var(--danger);margin-bottom:6px;">⚠ Bu bölüme ${matrixGroups.length} FARKLI plan matrisinden hücre bağlı - hangisini yazdıracağını aşağıdan seç.</div>` : ''}
          ${planBodyHtml}
          <div style="font-size:11px;color:var(--text-muted);">Bu plan, bu bölümdeki her AI isteğine otomatik gider.</div>
          ${!multiMatrix ? `
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="btn btn-sm btn-primary" id="draftFromPlanBtn" style="flex:1;">📝 ${planCells.length > 1 ? `Tüm sahneleri yaz (${planCells.length})` : 'Plandan Bölüm Taslağı Oluştur'}</button>
            <button class="btn btn-sm" id="editPlanBtn" title="Planı buradan düzenle - matrise gitmeye gerek yok">✎</button>
          </div>` : ''}
          <div id="planDraftResult"></div>
        </div>
      </div>` : '';

    panel.innerHTML = `
      <h3>AI Yazım Desteği</h3>
      <!-- ODA ŞERİDİ: tek satır, ikon odaklı. Birincil eylem bu. -->
      <div id="aiRoomTabs" style="display:flex;gap:3px;margin-bottom:6px;">
        ${Object.entries(AI_ROOMS).map(([key, r]) => `
          <button class="btn btn-sm ai-room-btn${key === currentAiRoom ? ' btn-primary' : ''}" data-room="${key}"
            style="flex:1;padding:4px 2px;font-size:11px;min-width:0;" title="${escapeHtml(r.label)} - ${escapeHtml(r.hint)}">
            ${r.icon}<span class="room-label" style="display:block;font-size:9.5px;overflow:hidden;text-overflow:ellipsis;">${r.short}</span>
          </button>`).join('')}
      </div>
      <div id="aiRoomHint" style="font-size:11px;color:var(--text-muted);margin-bottom:6px;line-height:1.35;"></div>
      ${planHtml}
      <div id="selectedEntityChips" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;"></div>

      <!-- İKİNCİL: bağlam ayarları ve listeler tek düğmenin arkasında.
           Araştırma: kullanıcıların çoğu ayarlara hiç girmez; varsayılanlar
           doğru olduğu sürece bunları göstermek sadece gürültü yapar. -->
      <button type="button" class="btn btn-sm" id="toggleContextTools" style="width:100%;margin-bottom:6px;font-size:11.5px;">
        ⚙ Bağlam ve listeler <span id="contextToolsSummary" style="color:var(--text-muted);font-weight:400;"></span>
      </button>
      <div id="contextToolsBox" style="display:none;border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;margin-bottom:6px;flex-wrap:wrap;">
          <span style="color:var(--text-muted);">AI neyi okusun:</span>
          <select id="textScopeSelect" style="flex:1;min-width:150px;" title="Bölüm metninin AI'ya ne kadarının gideceği - maliyeti ve isabeti doğrudan etkiler">
            <option value="chapter">Bu bölümün metni</option>
            <option value="none">Metin gönderme (ucuz)</option>
            <option value="novel">Tüm kitap (pahalı)</option>
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;margin-bottom:6px;cursor:pointer;" title="Seçili varlıkların 🔒 Gizli Katmanı 'BİL ama ASLA açıkça yazma' direktifiyle gider.">
          <input type="checkbox" id="includeHiddenChk"> 🔒 Gizli katmanı alt-metin olarak ver
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;margin-bottom:6px;cursor:pointer;" title="Bölüm NUMARASI hikâye sırası değildir. Kronolojik olarak GERİYE giden bir sahne yazarken, 'önceki' bölümlerin özetleri aslında GELECEKTİR - model onları geçmiş sanıp sahneye taşır ('henüz bilmiyordu ki...'). Böyle bölümlerde fihristi kapat.">
          <input type="checkbox" id="skipIndexChk"> 🕰️ Fihristi gönderme (kronolojik geri sahne)
        </label>
        <input type="text" id="entityPickerSearch" placeholder="Kişi/mekan/olay ara…" style="width:100%;margin-bottom:6px;">
        <div class="entity-picker" id="entityPickerBox">${pickerHtml || '<div class="empty-state">Henüz kayıt yok</div>'}</div>
      </div>

      <div class="ai-mode-tabs" style="display:flex;gap:6px;margin:0 0 6px;">
        <button class="btn btn-sm ai-mode-btn active" data-mode="chat">Sohbet</button>
        <button class="btn btn-sm ai-mode-btn" data-mode="instruct">Talimat</button>
      </div>

      <div id="aiResultBox" style="display:none;margin-bottom:10px;">
        <div class="panel" style="border-color:var(--gold);background:var(--gold-dim);">
          <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">SONUÇ - PARAGRAFA HAZIR METİN</strong>
          <div id="aiResultText" style="white-space:pre-wrap;margin:8px 0;font-size:13.5px;"></div>
          <div id="aiResultExtra"></div>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button class="btn btn-primary btn-sm" id="resultInsertBtn">Paragrafa Ekle</button>
            <button class="btn btn-sm" id="resultCopyBtn">Kopyala</button>
            <button class="btn btn-sm" id="resultClearBtn">Temizle</button>
          </div>
        </div>
      </div>

      <div id="aiChatMode">
        <div id="aiChatMessages" class="ai-chat-messages"></div>
        <div class="chat-input-row" style="display:flex;gap:6px;">
          <textarea id="aiChatInput" placeholder="Sorunu yaz… ( / hazır sorular · @ kişi/mekan çağır )" style="flex:1;min-height:44px;box-sizing:border-box;max-width:100%;"></textarea>
          <button class="btn btn-primary" id="aiChatSendBtn">Gönder</button>
        </div>
        <button class="btn btn-sm" id="clearChatBtn" style="margin-top:6px;">Sohbeti temizle</button>
      </div>

      <div id="aiInstructMode" style="display:none;">
        <div class="field"><label>Talimat</label><textarea id="aiInstruction" placeholder="Örn: Ahmet'in limana varışını anlatan bir paragraf yaz"></textarea></div>
        <button class="btn btn-primary" id="aiAssistBtn" style="width:100%;">Oluştur / Düzenle</button>
        <div id="aiResultContainer"></div>
      </div>

      <button class="btn btn-sm" id="previewContextBtn" style="width:100%;margin-top:10px;">Bağlamı Önizle (AI'ya ne gidiyor?)</button>
      <div id="contextPreviewContainer"></div>`;

    const draftBtn = document.getElementById('draftFromPlanBtn');
    if (draftBtn) draftBtn.addEventListener('click', () => runPlanDraft(chapter, planCells));
    // TEK SAHNE düğmeleri: bağlama bölümün BÜTÜN planları gider (devamlılık
    // için gerekli), ama yalnızca seçilen sahne yazılır. Gelen paragraflar
    // mevcut metnin sonuna eklenir - "olayın devamı" böyle ilerler.
    panel.querySelectorAll('.plan-tek-taslak').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = planCells[parseInt(btn.dataset.i, 10)];
        if (!p) return;
        runPlanDraft(chapter, [p], `${p.column_label} × ${p.row_label}`);
      });
    });
    // Matris grubu düğmesi: SADECE tıklanan matrisin sahnelerini yaz -
    // diğer (farklı) matrislerden gelen sahnelere dokunma. Bağlamda bölümün
    // TÜM planı yine gider (devamlılık için), ama talimat hangi sahnelerin
    // YAZILACAĞINI bu matrisin hücreleriyle sınırlar.
    panel.querySelectorAll('.plan-matrix-taslak').forEach(btn => {
      btn.addEventListener('click', () => {
        const groupCells = planCells.filter(p => p.matrix_name === btn.dataset.matrix);
        if (!groupCells.length) return;
        const sceneLabels = groupCells.map(p => `${p.column_label} × ${p.row_label}`);
        runPlanDraft(chapter, groupCells, sceneLabels);
      });
    });
    // 👁 "gör" düğmesi: paneldeki kısaltılmış önizleme yerine hücrenin
    // TAM plan metnini bir pencerede (modal) gösterir - buradan da
    // doğrudan "bu sahneyi yaz" yapılabilir, panele geri dönmeye gerek yok.
    panel.querySelectorAll('.plan-cell-gor').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = planCells[parseInt(btn.dataset.i, 10)];
        if (!p) return;
        openPlanCellModal(chapter, p);
      });
    });
    const editPlanBtn = document.getElementById('editPlanBtn');
    if (editPlanBtn) {
      editPlanBtn.addEventListener('click', () => {
        if (planCells.length > 1) { alert('Bu bölüme birden fazla plan hücresi bağlı - Plan Matrisi ekranından düzenle.'); return; }
        openQuickPlanEditor(chapter, planCells[0] ? planCells[0].content : '');
      });
    }
    const planToggle = document.getElementById('chapterPlanToggle');
    if (planToggle) {
      planToggle.addEventListener('click', () => {
        const body = document.getElementById('chapterPlanBody');
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        planToggle.querySelector('span:last-child').textContent = hidden ? '▾' : '▸';
      });
    }
    // Liste varsayılan KAPALI: 30-40 karakterli seride onay kutusu yığını
    // paneli boğuyordu. Seçilenler üstte rozet olarak görünür; seçim ya
    // aramayla ya da metinde @isim yazarak yapılır.
    // Tür başlıkları: aç/kapa
    panel.querySelectorAll('.entity-type-header').forEach(h => h.addEventListener('click', (e) => {
      if (e.target.closest('.goto-menu-btn')) return;
      const t = h.dataset.type;
      const body = panel.querySelector(`.entity-type-body[data-type="${t}"]`);
      const caret = panel.querySelector(`.type-caret[data-type="${t}"]`);
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      if (caret) caret.textContent = hidden ? '▾' : '▸';
    }));
    // "✎ / + ekle": ilgili menüye geç (kayıt orada düzenlenir)
    panel.querySelectorAll('.goto-menu-btn').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      switchView(b.dataset.type);
    }));


    // Bölümde geçen varlıklar otomatik işaretli geliyor - kullanıcı en az
    // bir seçimle karşılaşırsa listeyi açmasına gerek kalmasın diye rozetler.
    renderSelectedEntityChips();
    panel.querySelectorAll('.entity-check').forEach(cb =>
      cb.addEventListener('change', () => { renderSelectedEntityChips(); updateTypeCounts(); updateContextToolsSummary(); }));
    updateTypeCounts();

    el('entityPickerSearch').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      panel.querySelectorAll('.entity-picker-label').forEach(label => {
        label.style.display = !q || label.dataset.name.includes(q) ? '' : 'none';
      });
      panel.querySelectorAll('.entity-picker-group').forEach(group => {
        const anyVisible = Array.from(group.querySelectorAll('.entity-picker-label')).some(l => l.style.display !== 'none');
        group.style.display = anyVisible ? '' : 'none';
      });
    });

    // Oda geçmişleri AYRI: karakter tartışırken bölüm konuşmasının artıkları
    // bağlamı kirletmesin. Oda değişince o odanın geçmişi yüklenir.
    aiChatMessages = aiRoomHistories[currentAiRoom] || [];
    renderChatMessages();
    applyAiRoom(currentAiRoom, chapter);

    panel.querySelectorAll('.ai-room-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        aiRoomHistories[currentAiRoom] = aiChatMessages;   // mevcut odayı sakla
        currentAiRoom = btn.dataset.room;
        panel.querySelectorAll('.ai-room-btn').forEach(b => b.classList.remove('btn-primary'));
        btn.classList.add('btn-primary');
        aiChatMessages = aiRoomHistories[currentAiRoom] || [];
        renderChatMessages();
        applyAiRoom(currentAiRoom, chapter);
      });
    });

    // Bağlam araçları: kapalı başlar, tek tıkla açılır (progressive disclosure)
    el('toggleContextTools').addEventListener('click', () => {
      const box = document.getElementById('contextToolsBox');
      box.style.display = box.style.display === 'none' ? '' : 'none';
    });
    el('textScopeSelect').addEventListener('change', updateContextToolsSummary);

    panel.querySelectorAll('.ai-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.ai-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        el('aiChatMode').style.display = btn.dataset.mode === 'chat' ? 'block' : 'none';
        el('aiInstructMode').style.display = btn.dataset.mode === 'instruct' ? 'block' : 'none';
      });
    });

    el('aiChatSendBtn').addEventListener('click', () => sendChatMessage(chapter));
    // @isim yazımı: hem sohbet hem talimat kutusunda çalışır
    ['aiChatInput', 'aiInstruction'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        handleMentionTyping(el);
        if (el.id === 'aiChatInput') handleStarterTyping(el);
      });
      if (el.id === 'aiChatInput') {
        el.addEventListener('focus', () => handleStarterTyping(el));
      }
      // capture=true: öneri kutusu açıkken Enter'ı ÖNCE burası yakalasın,
      // mesaj gönderilmesin (kutu kapalıysa hiçbir şeye karışmaz).
      el.addEventListener('keydown', (e) => {
        if (handleMentionKeydown(e) || handleStarterKeydown(e)) e.stopPropagation();
      }, true);
      el.addEventListener('blur', () => {
        setTimeout(() => {
          document.getElementById('mentionSuggestBox')?.remove();
          document.getElementById('starterSuggestBox')?.remove();
        }, 150);
      });
    });
    el('aiChatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(chapter); }
    });
    el('clearChatBtn').addEventListener('click', () => {
      aiChatMessages = [];
      aiRoomHistories[currentAiRoom] = [];   // sadece AKTİF odayı temizle
      renderChatMessages();
    });
    el('aiAssistBtn').addEventListener('click', () => runAiAssist(chapter));
    el('previewContextBtn').addEventListener('click', () => runContextPreview(chapter));

    el('resultInsertBtn').addEventListener('click', () => {
      insertChatReplyAsParagraph(el('aiResultText').textContent);
    });
    el('resultCopyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(el('aiResultText').textContent);
      } catch (e) { /* pano izni yoksa sessizce geç - kritik değil */ }
    });
    el('resultClearBtn').addEventListener('click', () => clearResult());
  } catch (err) {
    panel.innerHTML = `<h3>AI Yazım Desteği</h3><div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// SONUÇ kutusu: sohbet (alt) ile asıl kullanılabilir metni (üst) birbirinden
// AYIRAN kalıcı panel. Sohbet doğası gereği konuşma/soru/yorum içerebilir -
// bunların hiçbiri yanlışlıkla "paragrafa ekle" ile romana karışmasın diye,
// paragrafa eklenecek metin HER ZAMAN önce bu kutuya taşınır (kullanıcı
// kendi seçer - hangi mesajın gerçek "sonuç" olduğuna dair kör bir metin
// analizi yapmıyoruz, çünkü bu dil bağımlı ve kırılgan olurdu).
function showResult(text, extraHtml) {
  const box = document.getElementById('aiResultBox');
  if (!box) return;
  box.style.display = 'block';
  el('aiResultText').textContent = text;
  el('aiResultExtra').innerHTML = extraHtml || '';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearResult() {
  const box = document.getElementById('aiResultBox');
  if (!box) return;
  box.style.display = 'none';
  el('aiResultText').textContent = '';
  el('aiResultExtra').innerHTML = '';
}

let aiChatMessages = [];

function getSelectedEntities() {
  return Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
}

function renderChatMessages(scrollTo = 'last') {
  const el = document.getElementById('aiChatMessages');
  if (!el) return;
  if (!aiChatMessages.length) {
    el.innerHTML = '<div class="empty-state" style="padding:10px 0;">Bölümle ilgili ne konuşmak istersin? Fikir sorabilir, bir sahne yazmasını isteyebilir ya da yazdığın bir kısmı tartışabilirsin.</div>';
    return;
  }
  el.innerHTML = aiChatMessages.map((m, i) => `
    <div class="ai-chat-bubble ${m.role}">
      ${m.actions && m.actions.length ? `<div style="font-size:11px;color:#2f6b3a;background:#eef7ef;border-radius:6px;padding:4px 6px;margin-bottom:6px;">✓ ${m.actions.map(escapeHtml).join(' · ')}</div>` : ''}
      <div style="white-space:pre-wrap;">${escapeHtml(m.content)}</div>
      ${m.role === 'assistant' ? `<button class="btn btn-sm move-to-result-btn" data-idx="${i}" style="margin-top:6px;" title="Bu mesajın metnini yukarıdaki SONUÇ kutusuna taşı">⬆ Sonuca Taşı</button>${chatReplaceButtons(i)}` : ''}
      ${(m.pendingUpdates || []).map((p, pIdx) => renderEntityUpdateProposalCard(i, pIdx, p)).join('')}
    </div>`).join('');
  el.querySelectorAll('.move-to-result-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showResult(aiChatMessages[parseInt(btn.dataset.idx, 10)].content);
    });
  });
  el.querySelectorAll('.chat-replace-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chatReplaceParagraph(parseInt(btn.dataset.idx, 10), parseInt(btn.dataset.pid, 10));
    });
  });
  wireEntityUpdateProposalButtons();
  // Kaydırma: yeni yanıt gelince mesajın SONUNA değil BAŞINA git - uzun bir
  // cevapta kullanıcı en alta düşüp yukarı tırmanmak zorunda kalmasın.
  // Son mesaj kutuya sığıyorsa zaten hepsi görünür.
  const bubbles = el.querySelectorAll('.ai-chat-bubble, [data-msg-idx]');
  const last = bubbles[bubbles.length - 1];
  if (scrollTo === 'last' && last) {
    el.scrollTop = Math.max(0, last.offsetTop - el.offsetTop - 8);
  } else {
    el.scrollTop = el.scrollHeight;
  }
}

// AI'nın sohbet sırasında önerdiği ama HENÜZ KAYDEDİLMEMİŞ bir varlık
// güncellemesi (bkz. backend: propose_entity_update / pending_entity_updates).
// Çelişki yoksa tek bir "Ekle" butonu (sonuna ekler, hiçbir şeyi silmez);
// çelişki VARSA bunun yerine iki seçenek gösterilir - kullanıcı BİLEREK
// "üzerine yaz" (mode=replace) ya da "yine de sonuna ekle" (mode=append,
// ör. karakter zamanla değişmiş olabilir) seçer.
function renderEntityUpdateProposalCard(msgIdx, propIdx, p) {
  const key = `${msgIdx}-${propIdx}`;
  if (p.resolved) {
    return `<div class="entity-update-proposal resolved" style="margin-top:8px;font-size:12px;color:var(--text-muted);">✓ ${escapeHtml(p.entity_name)} - ${escapeHtml(p.section)} güncellendi (${p.resolvedMode === 'replace' ? 'üzerine yazıldı' : 'sonuna eklendi'})</div>`;
  }
  const sectionLabel = escapeHtml(p.section === 'notes' ? 'Notlar' : p.section);
  const conflictBlock = p.conflicts_with_existing ? `
    <div style="font-size:12px;color:#8a5a00;background:#fff6e0;border-radius:6px;padding:6px 8px;margin:6px 0;">
      ⚠️ Mevcut bilgiyle çelişiyor olabilir: ${escapeHtml(p.conflict_note || '')}
      ${p.existing_text ? `<div style="margin-top:4px;color:var(--text-muted);"><em>Mevcut (${sectionLabel}):</em> "${escapeHtml(truncate(p.existing_text, 120))}"</div>` : ''}
    </div>` : '';
  const buttons = p.conflicts_with_existing
    ? `<button class="btn btn-sm entity-update-approve-btn" data-key="${key}" data-mode="append">Yine de sonuna ekle</button>
       <button class="btn btn-sm btn-danger entity-update-approve-btn" data-key="${key}" data-mode="replace">Üzerine yaz</button>`
    : `<button class="btn btn-sm btn-primary entity-update-approve-btn" data-key="${key}" data-mode="append">Ekle</button>`;
  return `<div class="entity-update-proposal" data-key="${key}" style="margin-top:8px;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--paper-dim);">
    <div style="font-size:11.5px;color:var(--text-muted);letter-spacing:0.3px;">${escapeHtml(p.entity_name)} · ${sectionLabel}</div>
    <div style="font-size:13px;margin:4px 0;">${escapeHtml(p.content)}</div>
    ${conflictBlock}
    <div style="display:flex;gap:6px;">${buttons}<button class="btn btn-sm entity-update-dismiss-btn" data-key="${key}">Yok say</button></div>
  </div>`;
}

function findProposal(key) {
  const [msgIdx, propIdx] = key.split('-').map(s => parseInt(s, 10));
  const msg = aiChatMessages[msgIdx];
  return msg && msg.pendingUpdates ? { msg, prop: msg.pendingUpdates[propIdx] } : null;
}

function wireEntityUpdateProposalButtons() {
  document.querySelectorAll('.entity-update-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const found = findProposal(btn.dataset.key);
      if (!found) return;
      const { prop } = found;
      btn.closest('.entity-update-proposal').style.opacity = '0.6';
      try {
        await api.post('/ai/approve-entity-update', {
          entity_type: prop.entity_type, entity_id: prop.entity_id,
          section: prop.section, content: prop.content, mode: btn.dataset.mode,
        });
        prop.resolved = true;
        prop.resolvedMode = btn.dataset.mode;
        renderChatMessages();
      } catch (err) { alert(err.message); btn.closest('.entity-update-proposal').style.opacity = '1'; }
    });
  });
  document.querySelectorAll('.entity-update-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const found = findProposal(btn.dataset.key);
      if (!found) return;
      const { msg, prop } = found;
      msg.pendingUpdates = msg.pendingUpdates.filter(p => p !== prop);
      renderChatMessages();
    });
  });
}

// Bir plan hücresinin TAM metnini bir pencerede (modal) gösterir - panelde
// artık sadece kısa önizleme var, tam metni burada okuyup buradan doğrudan
// "bu sahneyi yaz" ile taslak başlatılabilir.
function openPlanCellModal(chapter, p) {
  const overlay = ensureModalOverlay();
  overlay.innerHTML = `
    <div class="panel" style="max-width:560px;width:92%;max-height:80vh;overflow-y:auto;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">📐 ${escapeHtml(p.matrix_name)}${p.code ? ` · ${escapeHtml(p.code)}` : ''}</div>
      <b>${escapeHtml(p.column_label)} × ${escapeHtml(p.row_label)}</b>
      <div style="white-space:pre-wrap;font-size:13px;margin:10px 0;">${escapeHtml(p.content)}</div>
      <div class="form-actions">
        <button class="btn btn-primary" id="pcmDraft">📝 Bu sahneyi yaz</button>
        <button class="btn" id="pcmClose">Kapat</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
  const close = () => { overlay.style.display = 'none'; overlay.innerHTML = ''; };
  el('pcmClose').addEventListener('click', close);
  el('pcmDraft').addEventListener('click', () => {
    close();
    runPlanDraft(chapter, [p], `${p.column_label} × ${p.row_label}`);
  });
}

function insertChatReplyAsParagraph(text) {
  if (!currentChapter) { alert('Önce sol taraftan bir bölüm seç.'); return; }
  // AI bazen (özellikle "geliştir/yeniden yaz" gibi isteklerde) asıl metni
  // yazmak yerine soru sorup oyalanabiliyor - bu durumda "Ne dersin?",
  // "İstersen..." gibi bir sohbet cevabı OLDUĞU GİBİ paragrafa gömülürse
  // roman metnine karışır. Buraya kör bir "içerik analizi" koymak yerine
  // (dil bağımlı, kırılgan) basit bir önizleme + onay adımı koyuyoruz -
  // karar hep kullanıcıda kalıyor, ama en azından GÖRMEDEN eklenmiyor.
  const preview = text.length > 220 ? text.slice(0, 220) + '…' : text;
  const confirmed = confirm(`Bu metin paragraf olarak eklenecek:\n\n"${preview}"\n\nEklemek istediğine emin misin? (Bu bir sohbet cevabıysa - soru/açıklama içeriyorsa - "İptal"e basıp sadece asıl anlatım kısmını elle kopyalayabilirsin.)`);
  if (!confirmed) return;
  const nextNumber = currentChapter.paragraphs.length ? Math.max(...currentChapter.paragraphs.map(p => p.number)) + 1 : 1;
  addEmptyParagraphBlock(nextNumber);
  const el = document.querySelector(`.paragraph-text[data-number="${nextNumber}"]`);
  if (el) el.innerText = text;
}

async function sendChatMessage(chapter) {
  const input = document.getElementById('aiChatInput');
  const text = input.value.trim();
  if (!text) return;
  const selected = getSelectedEntities();

  aiChatMessages.push({ role: 'user', content: text });
  input.value = '';
  renderChatMessages();

  const messagesEl = document.getElementById('aiChatMessages');
  const thinking = document.createElement('div');
  thinking.className = 'empty-state';
  thinking.id = 'chatThinking';
  thinking.textContent = 'Yazıyor…';
  messagesEl.appendChild(thinking);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  el('aiChatSendBtn').disabled = true;

  try {
    const resultBox = document.getElementById('aiResultBox');
    const currentResult = (resultBox && resultBox.style.display !== 'none')
      ? el('aiResultText').textContent
      : null;
    const payload = {
      chapter_number: chapter ? chapter.number : 0,
      selected_entities: selected,
      messages: aiChatMessages,
      current_result: currentResult,
      include_hidden: !!document.getElementById('includeHiddenChk')?.checked,
      include_index: !document.getElementById('skipIndexChk')?.checked,
      text_scope: document.getElementById('textScopeSelect')?.value || 'chapter',
    };
    // Oda çerçevesi: AI'ya bu odanın amacını söyler (ilk mesaja iliştirilir)
    if (aiChatMessages.length === 1 && AI_ROOMS[currentAiRoom]?.frame) {
      payload.messages = [
        { role: 'user', content: AI_ROOMS[currentAiRoom].frame },
        ...payload.messages,
      ];
    }
    const result = await api.post('/ai/chat', payload);
    aiChatMessages.push({
      role: 'assistant', content: result.reply, actions: result.actions_taken || [],
      pendingUpdates: (result.pending_entity_updates || []).map(p => ({ ...p, resolved: false })),
    });
    renderChatMessages();
    // Qwen set_draft_result aracını çağırdıysa (bkz. backend), SONUÇ
    // kutusunu OTOMATİK dolduruyoruz - kullanıcının elle "Sonuca Taşı"
    // demesine gerek yok. "ev değil bina yap" gibi bir düzenleme isteğinde
    // de aynı şekilde kutu GÜNCELLENMİŞ tam metinle otomatik yenilenir.
    if (result.draft_result) {
      showResult(result.draft_result);
    }
    if (result.actions_taken && result.actions_taken.length) {
      if (currentChapter) dirtyChapterId = currentChapter.id;
      await refreshAfterChatActions();
    }
  } catch (err) {
    document.getElementById('chatThinking')?.remove();
    alert(err.message);
  } finally {
    el('aiChatSendBtn').disabled = false;
  }
}

async function runContextPreview(chapter) {
  const selected = Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
  const container = document.getElementById('contextPreviewContainer');
  container.innerHTML = '<div class="empty-state">Bağlam oluşturuluyor…</div>';
  try {
    // Talimat kutusu doluysa önizlemeye de gönder - böylece önizleme,
    // /ai/assist'in GERÇEKTE kuracağı context'le birebir aynı olur (talimata
    // göre otomatik seçilen derin profil bölümleri dahil).
    const instructionEl = document.getElementById('aiInstruction');
    const payload = {
      chapter_number: chapter ? chapter.number : 0,
      selected_entities: selected,
      instruction: instructionEl ? instructionEl.value.trim() : '',
      include_hidden: !!document.getElementById('includeHiddenChk')?.checked,
      include_index: !document.getElementById('skipIndexChk')?.checked,
      text_scope: document.getElementById('textScopeSelect')?.value || 'chapter',
      include_chapter_text: true,  // önizleme sohbetle AYNI bağlamı göstermeli
    };
    const result = await api.post('/ai/context-preview', payload);
    // BAĞLAM ŞEFFAFLIĞI: sadece "ne gidiyor" değil "ne kadar" ve "hangi
    // katman ne kadar yer kaplıyor". Maliyeti ve şişkinliği görünür kılar.
    const tokens = result.approx_tokens;
    const level = tokens > 60000 ? 'var(--danger)' : (tokens > 25000 ? '#b08d3f' : 'var(--text-muted)');
    const bar = (result.breakdown || []).map(b => {
      const pct = result.char_count ? Math.round(b.char_count / result.char_count * 100) : 0;
      return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--text-muted);">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(b.name)}</span>
        <span style="white-space:nowrap;">~${b.approx_tokens} tk · %${pct}</span>
      </div>`;
    }).join('');
    container.innerHTML = `
      <div style="font-size:12px;color:${level};margin-bottom:4px;font-weight:600;">
        ${result.char_count.toLocaleString('tr-TR')} karakter · ~${tokens.toLocaleString('tr-TR')} token
        ${tokens > 60000 ? '(çok büyük - kapsamı daralt)' : (tokens > 25000 ? '(büyük)' : '')}
      </div>
      ${bar ? `<div style="border:1px solid var(--border);border-radius:6px;padding:6px;margin-bottom:6px;">${bar}</div>` : ''}
      <div class="ai-result" style="white-space:pre-wrap;font-size:12px;max-height:260px;overflow:auto;">${escapeHtml(result.context) || '<em>Bu seçimle context boş olacak.</em>'}</div>`;
  } catch (err) {
    container.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function runAiAssist(chapter) {
  const instruction = el('aiInstruction').value.trim();
  if (!instruction) { alert('Bir talimat yaz.'); return; }
  const selected = Array.from(document.querySelectorAll('.entity-check:checked')).map(cb => ({
    entity_type: cb.dataset.type, entity_id: parseInt(cb.dataset.id, 10),
  }));
  const resultContainer = document.getElementById('aiResultContainer');
  resultContainer.innerHTML = '<div class="empty-state">Qwen yanıtlıyor…</div>';
  try {
    const payload = {
      chapter_number: chapter ? chapter.number : 0,
      instruction,
      selected_entities: selected,
      existing_text: null,
      include_hidden: !!document.getElementById('includeHiddenChk')?.checked,
      include_index: !document.getElementById('skipIndexChk')?.checked,
    };
    const result = await api.post('/ai/assist', payload);
    let extraHtml = '';

    if (result.consistency_notes && result.consistency_notes.length) {
      extraHtml += `<div style="margin-top:8px;"><strong style="font-size:12px;">Tutarlılık notları:</strong>
        <ul style="font-size:12.5px;margin:6px 0 0 16px;">${result.consistency_notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>`;
    }
    if (result.new_entity_suggestions && result.new_entity_suggestions.length) {
      extraHtml += `<div style="margin-top:8px;"><strong style="font-size:12px;">Yeni öneriler:</strong>` +
        result.new_entity_suggestions.map((s, idx) => `
          <div class="suggestion-item">
            <label><input type="checkbox" class="suggestion-check" data-idx="${idx}"> ${escapeHtml(s.entity_type)}: ${escapeHtml(s.name)}</label>
          </div>`).join('') +
        `<button class="btn btn-sm" id="approveBtn" style="margin-top:8px;">Seçilenleri onayla</button></div>`;
    }
    resultContainer.innerHTML = '';
    showResult(result.generated_text, extraHtml);
    window.__lastAiSuggestions = result.new_entity_suggestions || [];

    const approveBtn = document.getElementById('approveBtn');
    if (approveBtn) {
      approveBtn.addEventListener('click', async () => {
        const checked = Array.from(document.querySelectorAll('.suggestion-check:checked'))
          .map(cb => window.__lastAiSuggestions[parseInt(cb.dataset.idx, 10)]);
        if (!checked.length) return;
        try {
          await api.post('/ai/approve-suggestions', { suggestions: checked });
          alert('Onaylanan öneriler ilgili menülere eklendi.');
        } catch (err) { alert(err.message); }
      });
    }
  } catch (err) {
    resultContainer.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------
// İçe aktarma görünümü
// ---------------------------------------------------------------------

function renderImportView() {
  main().innerHTML = `
    <h1 class="view-title">Yedekle & İçe Aktar</h1>
    <div class="panel" style="border-left:3px solid var(--gold);margin-bottom:14px;">
      <strong style="font-size:12px;letter-spacing:0.4px;">📖 ROMANI İNDİR (el yazması)</strong>
      <p style="font-size:13px;color:var(--text-muted);margin:6px 0;">
        Romanın <b>okunur</b> hâli: fihrist hiyerarşisi korunur, paragraflar okunacak
        gibi dizilir. Basmak, birine göndermek, editöre vermek için.
        (Aşağıdaki JSON yedeği bundan farklı - o veri yedeğidir, geri yükleme içindir.)
      </p>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <select id="manuscriptFormat" style="flex:0 0 auto;">
          <option value="docx">Word (.docx) — yazdır, paylaş, not al</option>
          <option value="md">Markdown (.md) — her yerde açılır</option>
          <option value="txt">Düz metin (.txt) — sadece roman</option>
        </select>
        <button class="btn btn-primary" id="exportManuscriptBtn">Romanı İndir</button>
        <span id="manuscriptState" style="font-size:12px;color:var(--text-muted);"></span>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
      <strong style="font-size:12px;letter-spacing:0.4px;">💾 YEDEK AL (JSON)</strong>
      <p style="font-size:13px;color:var(--text-muted);margin:6px 0;">
        Aktif kitabın tüm bölüm/paragrafları + evrenin paylaşılan verisi (kişiler,
        mekanlar, nesneler, kurallar, olaylar, ilişkiler) tek JSON dosyası olarak iner.
        Dosya <b>şifresizdir</b> - romanın düz metin okunabilir, güvenli bir yerde sakla.
      </p>
      <button class="btn btn-primary" id="exportBackupBtn">Yedeği İndir</button>
      <span id="exportBackupState" style="font-size:12px;color:var(--text-muted);margin-left:8px;"></span>
      <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
      <strong style="font-size:12px;letter-spacing:0.4px;">♻ YEDEKTEN GERİ YÜKLE</strong>
      <p style="font-size:12.5px;color:var(--text-muted);margin:6px 0;">
        <b>Ekle</b>: yedektekiler yeni kayıt olarak eklenir. <b>Sıfırla</b>: bu kitabın
        TÜM bölüm/paragrafları önce silinir (kişi/mekan gibi evren verisi hiçbir modda silinmez).
      </p>
      <div class="field"><input type="file" id="restoreFile" accept=".json"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="restoreMode" style="max-width:230px;">
          <option value="merge">Ekle (güvenli)</option>
          <option value="wipe">Sıfırla ve yaz (bölümleri siler)</option>
        </select>
        <button class="btn" id="restoreBackupBtn">Geri Yükle</button>
        <span id="restoreState" style="font-size:12px;color:var(--text-muted);"></span>
      </div>
    </div>
    <h2 style="font-size:16px;margin:0 0 6px;">Metin Dosyası İçe Aktar (.txt)</h2>
    <div class="panel">
      <p style="font-size:13.5px;color:var(--text-muted);">Elinde zaten yazılmış bir .txt dosyası varsa yükle — "Bölüm N" başlıklarına göre otomatik olarak bölüm/paragraf oluşturur ve mevcut menülerdeki isimleri paragraflarda arar. İçe aktarma otomatik olarak yeni karakter/mekan oluşturmaz; her bölüm için "AI ile varlık öner" ile Qwen'e henüz kayıtlı olmayan adayları buldurup onaylayarak ekleyebilirsin.</p>
      <div class="field"><input type="file" id="importFile" accept=".txt,.json"></div>
      <label style="font-size:13px;display:flex;align-items:center;gap:6px;margin:8px 0;">
        <input type="checkbox" id="aiSplitImportCheck">
        Paragraf araları net değilse (boş satır yoksa) AI ile böl - daha yavaş ama düzensiz yapıştırılmış metinlerde çok daha iyi sonuç verir
      </label>
      <button class="btn btn-primary" id="importBtn">Yükle ve İçe Aktar</button>
      <div id="importResult"></div>
      <hr style="margin:22px 0;border:none;border-top:1px solid var(--border);">
      <p style="font-size:13.5px;color:var(--text-muted);">Yeni bir karakter/mekan ekledikten sonra, geçmiş bölümlerdeki izlerini bulmak için romanı yeniden tara:</p>
      <button class="btn" id="reindexBtn">Tüm romanı yeniden tara</button>
      <div id="reindexResult"></div>
    </div>`;

  // Yedeği indir: api.js JSON parse ettiği için burada doğrudan fetch -
  // yanıt blob olarak alınıp tarayıcıya indirtilir.
  el('restoreBackupBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('restoreFile');
    const mode = el('restoreMode').value;
    const state = document.getElementById('restoreState');
    if (!fileInput.files.length) { alert('Önce bir .json yedek dosyası seç.'); return; }
    if (!confirm(mode === 'wipe'
      ? 'DİKKAT: Bu kitabın TÜM bölüm ve paragrafları SİLİNİP yedekteki hâliyle değiştirilecek. Devam?'
      : 'Yedekteki içerik mevcut kayıtlara EKLENECEK. Devam?')) return;
    const btn = document.getElementById('restoreBackupBtn');
    btn.disabled = true; state.textContent = 'Geri yükleniyor…';
    try {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      const res = await fetch(`/admin/import?mode=${mode}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'X-Novel-Id': String(getNovelId() || '') },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Geri yükleme başarısız (${res.status})`);
      alert('Yedek geri yüklendi. Sayfa yenileniyor.');
      window.location.reload();
    } catch (err) {
      state.textContent = '✕ ' + err.message;
    } finally { btn.disabled = false; }
  });

  // EL YAZMASI: okunur çıktı. Yedekten ayrı tutuldu çünkü ikisi farklı
  // işler - yedek geri yüklemek için, bu okumak/basmak için.
  el('exportManuscriptBtn').addEventListener('click', async () => {
    const btn = document.getElementById('exportManuscriptBtn');
    const state = document.getElementById('manuscriptState');
    const bicim = document.getElementById('manuscriptFormat').value;
    const kitap = getNovelId();
    if (!kitap) { state.textContent = '✕ Önce bir kitap seç'; return; }
    btn.disabled = true; state.textContent = 'Hazırlanıyor…';
    try {
      const res = await fetch(`/novels/${kitap}/manuscript?format=${bicim}`, {
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'X-Novel-Id': String(kitap),
        },
      });
      if (!res.ok) throw new Error(`İndirilemedi (${res.status})`);
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `roman-${stamp}.${bicim}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      try {
        const ist = await api.get(`/novels/${kitap}/manuscript-stats`);
        state.textContent = `✓ ${ist.yazili_bolum} bölüm · ${ist.paragraf} paragraf · ${ist.kelime} kelime`;
      } catch (e) { state.textContent = '✓ indirildi'; }
    } catch (err) {
      state.textContent = '✕ ' + err.message;
    } finally { btn.disabled = false; }
  });

  el('exportBackupBtn').addEventListener('click', async () => {
    const btn = document.getElementById('exportBackupBtn');
    const state = document.getElementById('exportBackupState');
    btn.disabled = true; state.textContent = 'Hazırlanıyor…';
    try {
      const res = await fetch('/admin/export', {
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'X-Novel-Id': String(getNovelId() || ''),
        },
      });
      if (!res.ok) throw new Error(`Yedek alınamadı (${res.status})`);
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `roman-yedek-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      state.textContent = '✓ indirildi';
      setTimeout(() => { state.textContent = ''; }, 4000);
    } catch (err) {
      state.textContent = '✕ ' + err.message;
    } finally { btn.disabled = false; }
  });

  el('importBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('importFile');
    if (!fileInput.files.length) { alert('Bir dosya seç.'); return; }
    const aiSplit = el('aiSplitImportCheck').checked;
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const resultEl = document.getElementById('importResult');
    resultEl.innerHTML = aiSplit
      ? '<div class="empty-state">Yükleniyor - AI paragraf ayracı kullanılıyor, biraz sürebilir…</div>'
      : '<div class="empty-state">Yükleniyor…</div>';
    try {
      const res = await fetch(`/chapters/import?ai_split_long_chapters=${aiSplit}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'X-Novel-Id': getNovelId() },
        body: formData,
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Yükleme başarısız'); }
      const data = await res.json();
      resultEl.innerHTML = `<div class="success-text">${data.imported_chapters.length} bölüm içe aktarıldı.</div>
        <div style="margin-top:10px;">
          ${data.imported_chapters.map(c => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
              <span style="font-size:13px;">Bölüm ${c.chapter_number}${c.title ? ' — ' + escapeHtml(c.title) : ''} (${c.paragraph_count} paragraf)</span>
              <button class="btn btn-sm suggest-entities-btn" data-chapter-id="${c.chapter_id}">AI ile varlık öner</button>
            </div>
            <div class="suggest-entities-panel" data-chapter-id="${c.chapter_id}"></div>
          `).join('')}
        </div>`;
      resultEl.querySelectorAll('.suggest-entities-btn').forEach(btn => {
        btn.addEventListener('click', () => runSuggestEntities(btn.dataset.chapterId));
      });
    } catch (err) {
      resultEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });

  el('reindexBtn').addEventListener('click', async () => {
    const resultEl = document.getElementById('reindexResult');
    resultEl.innerHTML = '<div class="empty-state">Taranıyor…</div>';
    try {
      const data = await api.post('/chapters/reindex-mentions', {});
      resultEl.innerHTML = `<div class="success-text">${data.reindexed_paragraphs} paragraf yeniden tarandı.</div>`;
    } catch (err) {
      resultEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
    }
  });
}

async function runSuggestEntities(chapterId) {
  const panel = document.querySelector(`.suggest-entities-panel[data-chapter-id="${chapterId}"]`);
  if (!panel) return;
  panel.innerHTML = '<div class="empty-state">Bölüm taranıyor, yeni varlıklar aranıyor…</div>';
  try {
    const suggestions = await api.post(`/chapters/${chapterId}/suggest-entities`, {});
    renderEntitySuggestionsInto(panel, chapterId, suggestions);
  } catch (err) {
    panel.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderEntitySuggestionsInto(panel, chapterId, suggestions) {
  if (!suggestions.length) {
    panel.innerHTML = '<div class="empty-state" style="text-align:left;padding:6px 0;">Bu bölümde menülerde kayıtlı olmayan yeni bir varlık bulunamadı.</div>';
    return;
  }
  panel.innerHTML = `
    <div class="panel" style="margin:8px 0;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNERİLEN YENİ VARLIKLAR</strong>
      ${suggestions.map((s, i) => `
        <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <input type="checkbox" class="suggestion-check" data-idx="${i}" checked style="margin-top:3px;">
          <span><strong>[${escapeHtml((ENTITY_TYPES[s.entity_type] || {}).label || s.entity_type)}] ${escapeHtml(s.name)}</strong><br>
          <span style="color:var(--text-muted);">${escapeHtml(s.description)}</span></span>
        </label>`).join('')}
      <button class="btn btn-primary btn-sm" id="approveSuggestionsBtn-${chapterId}" style="margin-top:8px;">Seçilenleri Ekle</button>
    </div>`;

  panel.querySelector(`#approveSuggestionsBtn-${chapterId}`).addEventListener('click', async () => {
    const checks = panel.querySelectorAll('.suggestion-check:checked');
    const chosen = Array.from(checks).map(cb => suggestions[parseInt(cb.dataset.idx, 10)]);
    if (!chosen.length) { alert('Hiç seçim yapılmadı.'); return; }
    try {
      const result = await api.post('/ai/approve-suggestions', { suggestions: chosen });
      panel.innerHTML = `<div class="success-text">${result.created.length} yeni kayıt eklendi.</div>`;
    } catch (err) { alert(err.message); }
  });
}

async function runSuggestProgressions(chapter) {
  const container = document.getElementById('progressionScanResult');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">Bölüm taranıyor, yeni/değişen bilgi aranıyor…</div>';
  try {
    const suggestions = await api.post(`/chapters/${chapter.id}/suggest-progressions`, {});
    renderProgressionSuggestionsInto(container, suggestions);
  } catch (err) {
    container.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderProgressionSuggestionsInto(container, suggestions) {
  if (!suggestions.length) {
    container.innerHTML = '<div class="empty-state" style="text-align:left;padding:6px 0;">Bu bölümde, geçen kayıtlar hakkında zaten bilinenin ötesinde yeni bir bilgi bulunamadı.</div>';
    return;
  }
  container.innerHTML = `
    <div class="panel" style="margin:8px 0;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNERİLEN GELİŞİM NOTLARI</strong>
      ${suggestions.map((s, i) => `
        <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <input type="checkbox" class="progression-suggestion-check" data-idx="${i}" checked style="margin-top:3px;">
          <span><strong>${escapeHtml(s.entity_name)}</strong> (Bölüm ${s.chapter_number}): ${escapeHtml(s.note)}</span>
        </label>`).join('')}
      <button class="btn btn-primary btn-sm" id="approveProgressionsBtn" style="margin-top:8px;">Seçilenleri Haritaya Ekle</button>
    </div>`;

  container.querySelector('#approveProgressionsBtn').addEventListener('click', async (e) => {
    const checks = container.querySelectorAll('.progression-suggestion-check:checked');
    const chosen = Array.from(checks).map(cb => suggestions[parseInt(cb.dataset.idx, 10)]);
    if (!chosen.length) { alert('Hiç seçim yapılmadı.'); return; }
    e.target.disabled = true;
    try {
      for (const s of chosen) {
        await api.post('/progressions/', {
          entity_type: s.entity_type, entity_id: s.entity_id,
          chapter_number: s.chapter_number, note: s.note,
        });
      }
      container.innerHTML = `<div class="success-text">${chosen.length} gelişim notu haritaya eklendi.</div>`;
    } catch (err) { alert(err.message); e.target.disabled = false; }
  });
}

function renderRelationshipSuggestionsInto(container, suggestions) {
  if (!suggestions.length) {
    container.innerHTML = '<div class="empty-state" style="text-align:left;padding:6px 0;">Yeni bir karakter ilişkisi bulunamadı.</div>';
    return;
  }
  container.innerHTML = `
    <div class="panel" style="margin:8px 0;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNERİLEN İLİŞKİLER</strong>
      ${suggestions.map((s, i) => `
        <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <input type="checkbox" class="relationship-suggestion-check" data-idx="${i}" checked style="margin-top:3px;">
          <span><strong>${escapeHtml(s.character_a_name)}</strong> — ${escapeHtml(s.label)} — <strong>${escapeHtml(s.character_b_name)}</strong>
          ${s.notes ? `<br><span style="color:var(--text-muted);">${escapeHtml(s.notes)}</span>` : ''}</span>
        </label>`).join('')}
      <button class="btn btn-primary btn-sm" id="approveRelationshipsBtn" style="margin-top:8px;">Seçilenleri Haritaya Ekle</button>
    </div>`;

  container.querySelector('#approveRelationshipsBtn').addEventListener('click', async (e) => {
    const checks = container.querySelectorAll('.relationship-suggestion-check:checked');
    const chosen = Array.from(checks).map(cb => suggestions[parseInt(cb.dataset.idx, 10)]);
    if (!chosen.length) { alert('Hiç seçim yapılmadı.'); return; }
    e.target.disabled = true;
    try {
      for (const s of chosen) {
        await api.post('/relationships/', {
          character_a_id: s.character_a_id, character_b_id: s.character_b_id,
          label: s.label, notes: s.notes || '',
        });
      }
      container.innerHTML = `<div class="success-text">${chosen.length} ilişki İlişki Haritası'na eklendi.</div>`;
    } catch (err) { alert(err.message); e.target.disabled = false; }
  });
}

function renderEventSuggestionsInto(container, suggestions) {
  if (!suggestions.length) {
    container.innerHTML = '<div class="empty-state" style="text-align:left;padding:6px 0;">Zaman çizelgesine eklenmeye değer yeni bir olay bulunamadı.</div>';
    return;
  }
  container.innerHTML = `
    <div class="panel" style="margin:8px 0;">
      <strong style="font-size:11px;color:var(--text-muted);letter-spacing:0.4px;">ÖNERİLEN OLAYLAR</strong>
      ${suggestions.map((s, i) => `
        <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <input type="checkbox" class="event-suggestion-check" data-idx="${i}" checked style="margin-top:3px;">
          <span><strong>${escapeHtml(s.name)}</strong> (Bölüm ${s.chapter_number}${s.place_name ? ' — ' + escapeHtml(s.place_name) : ''})
          ${s.character_names.length ? `<br><span style="color:var(--text-muted);">Kişiler: ${escapeHtml(s.character_names.join(', '))}</span>` : ''}
          ${s.description ? `<br><span style="color:var(--text-muted);">${escapeHtml(s.description)}</span>` : ''}</span>
        </label>`).join('')}
      <button class="btn btn-primary btn-sm" id="approveEventsBtn" style="margin-top:8px;">Seçilenleri Zaman Çizelgesine Ekle</button>
    </div>`;

  container.querySelector('#approveEventsBtn').addEventListener('click', async (e) => {
    const checks = container.querySelectorAll('.event-suggestion-check:checked');
    const chosen = Array.from(checks).map(cb => suggestions[parseInt(cb.dataset.idx, 10)]);
    if (!chosen.length) { alert('Hiç seçim yapılmadı.'); return; }
    e.target.disabled = true;
    try {
      for (const s of chosen) {
        await api.post('/events/', {
          name: s.name, description: s.description, place_id: s.place_id,
          story_order: s.story_order, character_ids: s.character_ids,
        });
      }
      container.innerHTML = `<div class="success-text">${chosen.length} olay Zaman Çizelgesine eklendi.</div>`;
    } catch (err) { alert(err.message); e.target.disabled = false; }
  });
}

// ---------------------------------------------------------------------
// Olaylar / Zaman Çizelgesi (özel görünüm - mekan, hikaye içi tarih,
// katılımcı karakterler ve çakışma kontrolü içerir)
// ---------------------------------------------------------------------

async function renderEventsView() {
  main().innerHTML = `
    <h1 class="view-title">Olaylar / Zaman Çizelgesi</h1>
    <div class="toolbar">
      <button class="btn" id="scanAllEventsBtn" title="Özeti olan TÜM bölümleri tarayıp zaman çizelgesine eklenecek olayları önerir">🕐 Bölümlerden Güncelle</button>
      <button class="btn" id="checkConflictsBtn">Çakışma kontrolü yap</button>
      <button class="btn btn-primary" id="addEventBtn">+ Yeni Olay</button>
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 10px;">
      <label style="font-size:12.5px;">Sırala:
        <select id="eventSortSelect" style="max-width:220px;">
          <option value="occurred">Gerçekleşme zamanı (kronoloji)</option>
          <option value="story">Anlatı sırası (romanda)</option>
        </select>
      </label>
      <input type="text" id="eventDateFilter" placeholder="Tarihe göre süz: 2030 / 2030-06 / 2023" style="max-width:260px;">
      <label style="font-size:12.5px;display:flex;align-items:center;gap:4px;">
        <input type="checkbox" id="eventMissingOnly"> Sadece tarihi eksik olanlar
      </label>
      <span id="eventDateStats" style="font-size:12px;color:var(--text-muted);"></span>
    </div>
    <div id="conflictsBox"></div>
    <div id="bulkEventScanResult"></div>
    <div class="entity-list" id="eventList"><div class="empty-state">Yükleniyor…</div></div>
    <div id="eventFormContainer"></div>`;

  el('addEventBtn').addEventListener('click', () => showEventForm(null));
  el('checkConflictsBtn').addEventListener('click', checkEventConflicts);
  el('scanAllEventsBtn').addEventListener('click', runBulkEventScan);
  ['eventSortSelect', 'eventDateFilter', 'eventMissingOnly'].forEach(id =>
    document.getElementById(id).addEventListener('input', loadEventList));
  await loadEventList();
}

async function loadEventList() {
  const listEl = document.getElementById('eventList');
  try {
    const sort = document.getElementById('eventSortSelect')?.value || 'occurred';
    const dateFilter = (document.getElementById('eventDateFilter')?.value || '').trim();
    const missingOnly = document.getElementById('eventMissingOnly')?.checked;
    let events = await api.get(`/events/?sort=${sort}`);

    // Tarih eksiği istatistiği: kurguda zaman hatası olmaması için önce
    // KAÇ olayın tarihsiz olduğu görünür olmalı.
    const missingCount = events.filter(e => !(e.occurred_at || '').trim()).length;
    const stats = document.getElementById('eventDateStats');
    if (stats) {
      stats.innerHTML = missingCount
        ? `<span style="color:var(--danger);">${missingCount} olayın gerçekleşme zamanı yok</span> · toplam ${events.length}`
        : `Tüm olayların zamanı tanımlı · toplam ${events.length}`;
    }
    if (missingOnly) events = events.filter(e => !(e.occurred_at || '').trim());
    if (dateFilter) events = events.filter(e => (e.occurred_at || '').startsWith(dateFilter));

    if (!events.length) {
      listEl.innerHTML = `<div class="empty-state">${missingOnly || dateFilter ? 'Bu süzgece uyan olay yok.' : 'Henüz olay yok.'}</div>`;
      return;
    }
    listEl.innerHTML = events.map(ev => {
      const hasDate = (ev.occurred_at || '').trim();
      const dateChip = hasDate
        ? `<span style="font-size:11.5px;background:var(--paper-dim);border:1px solid var(--border);border-radius:4px;padding:1px 6px;" title="Gerçekleşme zamanı (sıralama bu değere göre)">🕐 ${escapeHtml(ev.occurred_at)}</span>`
        : `<span style="font-size:11.5px;color:var(--danger);border:1px solid var(--danger);border-radius:4px;padding:1px 6px;" title="Bu olay kronolojide sıralanamaz">🕐 tarih yok</span>`;
      return `
      <div class="entity-row" style="flex-wrap:wrap;">
        <div>
          <div class="name">${escapeHtml(ev.name)}${formatStoryOrder(ev.story_order)}</div>
          <div class="desc" style="margin:3px 0;">${dateChip}${ev.story_date ? ' <span style="font-size:12px;">' + escapeHtml(ev.story_date) + '</span>' : ''}</div>
          <div class="desc">${ev.place_name ? '📍 ' + escapeHtml(ev.place_name) : ''}${ev.character_names.length ? (ev.place_name ? ' · ' : '') + ev.character_names.map(escapeHtml).join(', ') : ''}</div>
          <div class="desc">${escapeHtml(truncate(ev.description, 100))}</div>
        </div>
        <div class="actions">
          ${hasDate ? '' : `<button class="btn btn-sm infer-date-btn" data-id="${ev.id}" title="Anlatıldığı bölümün özetinden gerçekleşme zamanını çıkar">🕐 AI ile tarih bul</button>`}
          <button class="btn btn-sm edit-event-btn" data-id="${ev.id}">Düzenle</button>
          <button class="btn btn-sm progression-btn" data-id="${ev.id}">Gelişim</button>
          <button class="btn btn-sm btn-danger del-event-btn" data-id="${ev.id}">Sil</button>
        </div>
        <div class="date-suggest-panel" data-id="${ev.id}" style="display:none;width:100%;margin-top:6px;"></div>
        <div class="progression-panel" data-id="${ev.id}" style="display:none;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);"></div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.infer-date-btn').forEach(btn =>
      btn.addEventListener('click', () => runInferEventDate(parseInt(btn.dataset.id, 10))));

    listEl.querySelectorAll('.progression-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleProgressionPanel('event', btn.dataset.id));
    });

    listEl.querySelectorAll('.edit-event-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ev = events.find(e => String(e.id) === btn.dataset.id);
        showEventForm(ev);
      });
    });
    listEl.querySelectorAll('.del-event-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu olayı silmek istediğine emin misin?')) return;
        try { await api.del(`/events/${btn.dataset.id}`); await loadEventList(); }
        catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function showEventForm(event) {
  const container = document.getElementById('eventFormContainer');
  const isEdit = !!event;
  container.innerHTML = `<div class="panel"><div class="empty-state">Yükleniyor…</div></div>`;

  try {
    const [places, characters] = await Promise.all([api.get('/places/'), api.get('/characters/')]);
    const selectedCharIds = isEdit ? event.character_ids : [];

    container.innerHTML = `
      <div class="panel" style="max-width:640px;">
        <div class="field"><label>Olay adı</label><input type="text" id="ev_name" value="${escapeHtml(isEdit ? event.name : '')}"></div>
        <div class="field"><label>Açıklama</label><textarea id="ev_desc">${escapeHtml(isEdit ? event.description : '')}</textarea></div>
        <div class="field"><label>Notlar</label><textarea id="ev_notes">${escapeHtml(isEdit ? event.notes : '')}</textarea></div>
        <div class="field"><label>Mekan</label>
          <select id="ev_place">
            <option value="">— seçilmedi —</option>
            ${places.map(p => `<option value="${p.id}" ${isEdit && event.place_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Hikaye içi tarih (serbest metin, ör. "3. gün")</label><input type="text" id="ev_date" value="${escapeHtml(isEdit ? event.story_date : '')}"></div>
        <div class="field">
          <label>🕐 Gerçekleşme zamanı <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(SIRALANABİLİR biçim - kronoloji buna göre kurulur. Tam: 2030-06-28T21:00 · Gün: 2030-06-28 · Ay: 2023-02 · Yıl: 2023)</span></label>
          <input type="text" id="ev_occurred" placeholder="2030-06-28T21:00" value="${isEdit ? escapeHtml(event.occurred_at || '') : ''}">
        </div>
        <div class="field">
          <label>Anlatı sırası <span style="font-weight:400;color:var(--text-muted);font-size:11.5px;">(olayın ROMANDA anlatıldığı sıra - takvim sırası değil. Otomatik: bölüm no × 1000 + o bölümdeki kaçıncı olay)</span></label>
          <input type="number" id="ev_order" value="${isEdit && event.story_order !== null ? event.story_order : ''}">
        </div>
        <div class="field"><label>Katılan karakterler</label>
          <div class="entity-picker">
            ${characters.length ? characters.map(c => `<label><input type="checkbox" class="ev-char-check" value="${c.id}" ${selectedCharIds.includes(c.id) ? 'checked' : ''}> ${escapeHtml(c.name)}</label>`).join('') : '<div class="empty-state">Henüz karakter yok</div>'}
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="saveEventBtn">${isEdit ? 'Güncelle' : 'Kaydet'}</button>
          <button class="btn" id="cancelEventBtn">Vazgeç</button>
        </div>
        <div id="eventFormError" class="error-text"></div>
      </div>`;

    el('cancelEventBtn').addEventListener('click', () => { container.innerHTML = ''; });
    el('saveEventBtn').addEventListener('click', async () => {
      const name = el('ev_name').value.trim();
      if (!name) { el('eventFormError').textContent = 'Olay adı boş olamaz.'; return; }
      const placeVal = el('ev_place').value;
      const orderVal = el('ev_order').value;
      const payload = {
        name,
        description: el('ev_desc').value,
        notes: el('ev_notes').value,
        place_id: placeVal ? parseInt(placeVal, 10) : null,
        story_date: el('ev_date').value,
        story_order: orderVal !== '' ? parseInt(orderVal, 10) : null,
        occurred_at: el('ev_occurred').value.trim(),
        character_ids: Array.from(document.querySelectorAll('.ev-char-check:checked')).map(cb => parseInt(cb.value, 10)),
      };
      try {
        if (isEdit) await api.put(`/events/${event.id}`, payload);
        else await api.post('/events/', payload);
        container.innerHTML = '';
        await loadEventList();
      } catch (err) {
        el('eventFormError').textContent = err.message;
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="panel error-text">${escapeHtml(err.message)}</div>`;
  }
}

async function checkEventConflicts() {
  const box = document.getElementById('conflictsBox');
  box.innerHTML = `<div class="empty-state">Kontrol ediliyor…</div>`;
  try {
    const conflicts = await api.get('/events/conflicts');
    if (!conflicts.length) {
      box.innerHTML = `<div class="success-text" style="margin-bottom:12px;">Çakışma bulunamadı.</div>`;
      return;
    }
    box.innerHTML = conflicts.map(c => `
      <div class="panel" style="border-color:var(--danger);margin-top:0;margin-bottom:10px;">
        <strong style="color:var(--danger);">Çakışma</strong> — "${escapeHtml(c.event_a)}" ve "${escapeHtml(c.event_b)}" olayları aynı zamanda (${escapeHtml(c.story_key)}) gerçekleşiyor ama farklı mekanlarda; ortak karakter(ler): ${c.shared_characters.map(escapeHtml).join(', ')}
      </div>`).join('');
  } catch (err) {
    box.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------
// İlişki Haritası
// ---------------------------------------------------------------------

async function renderRelationshipsView() {
  main().innerHTML = `
    <h1 class="view-title">İlişki Haritası</h1>
    <div class="toolbar"><div></div><button class="btn btn-primary" id="addRelBtn">+ Yeni İlişki</button></div>
    <div id="relGraph" style="margin-bottom:20px;"></div>
    <div class="entity-list" id="relList"><div class="empty-state">Yükleniyor…</div></div>
    <div id="relFormContainer"></div>`;

  el('addRelBtn').addEventListener('click', showRelationshipForm);
  await loadRelationships();
}

async function loadRelationships() {
  const listEl = document.getElementById('relList');
  const graphEl = document.getElementById('relGraph');
  try {
    const rels = await api.get('/relationships/');
    if (!rels.length) {
      listEl.innerHTML = `<div class="empty-state">Henüz ilişki eklenmedi.</div>`;
      graphEl.innerHTML = '';
      return;
    }
    graphEl.innerHTML = buildRelationshipGraphSvg(rels);
    listEl.innerHTML = rels.map(r => `
      <div class="entity-row">
        <div>
          <div class="name">${escapeHtml(r.character_a_name)} — ${escapeHtml(r.label)} — ${escapeHtml(r.character_b_name)}</div>
          <div class="desc">${escapeHtml(truncate(r.notes, 100))}</div>
        </div>
        <div class="actions"><button class="btn btn-sm btn-danger del-rel-btn" data-id="${r.id}">Sil</button></div>
      </div>`).join('');
    listEl.querySelectorAll('.del-rel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu ilişkiyi silmek istediğine emin misin?')) return;
        try { await api.del(`/relationships/${btn.dataset.id}`); await loadRelationships(); }
        catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="error-text">${escapeHtml(err.message)}</div>`;
  }
}

function buildRelationshipGraphSvg(rels) {
  const names = [];
  rels.forEach(r => {
    if (!names.includes(r.character_a_name)) names.push(r.character_a_name);
    if (!names.includes(r.character_b_name)) names.push(r.character_b_name);
  });
  const w = 640, h = 320, cx = w / 2, cy = h / 2, radius = Math.min(w, h) / 2 - 60;
  const positions = {};
  names.forEach((name, i) => {
    const angle = (2 * Math.PI * i) / names.length - Math.PI / 2;
    positions[name] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });

  let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;background:#fff;border:1px solid var(--border);border-radius:8px;">`;
  rels.forEach(r => {
    const a = positions[r.character_a_name], b = positions[r.character_b_name];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#c9a227" stroke-width="1.5" />`;
    svg += `<text x="${mx}" y="${my}" font-size="10.5" fill="#746b5c" text-anchor="middle" font-family="Inter,sans-serif">${escapeHtml(r.label)}</text>`;
  });
  names.forEach(name => {
    const p = positions[name];
    svg += `<circle cx="${p.x}" cy="${p.y}" r="26" fill="#1b2230" />`;
    svg += `<text x="${p.x}" y="${p.y}" font-size="11" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="Inter,sans-serif">${escapeHtml(truncate(name, 10))}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

async function showRelationshipForm() {
  const container = document.getElementById('relFormContainer');
  container.innerHTML = `<div class="panel"><div class="empty-state">Yükleniyor…</div></div>`;
  try {
    const characters = await api.get('/characters/');
    if (characters.length < 2) {
      container.innerHTML = `<div class="panel">İlişki kurabilmek için en az 2 karakter olmalı.</div>`;
      return;
    }
    container.innerHTML = `
      <div class="panel">
        <div class="field"><label>Karakter A</label>
          <select id="rel_a">${characters.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Karakter B</label>
          <select id="rel_b">${characters.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>İlişki (ör. kız kardeşi, düşmanı)</label><input type="text" id="rel_label"></div>
        <div class="field"><label>Notlar</label><textarea id="rel_notes"></textarea></div>
        <div class="form-actions">
          <button class="btn btn-primary" id="saveRelBtn">Kaydet</button>
          <button class="btn" id="cancelRelBtn">Vazgeç</button>
        </div>
        <div id="relFormError" class="error-text"></div>
      </div>`;

    el('cancelRelBtn').addEventListener('click', () => { container.innerHTML = ''; });
    el('saveRelBtn').addEventListener('click', async () => {
      const label = el('rel_label').value.trim();
      if (!label) { el('relFormError').textContent = 'İlişki tanımı boş olamaz.'; return; }
      const payload = {
        character_a_id: parseInt(el('rel_a').value, 10),
        character_b_id: parseInt(el('rel_b').value, 10),
        label,
        notes: el('rel_notes').value,
      };
      try {
        await api.post('/relationships/', payload);
        container.innerHTML = '';
        await loadRelationships();
      } catch (err) {
        el('relFormError').textContent = err.message;
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="panel error-text">${escapeHtml(err.message)}</div>`;
  }
}
