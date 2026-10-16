/**
 * X Mentari — bantuan pengisian kuesioner
 *
 * Menandai pilihan pada kuesioner evaluasi menurut pola yang dipilih
 * pengguna, di halaman kuesioner MENTARI maupun survei KHS MY UNPAM.
 *
 * Tiga pola:
 *   1. Pilih Ya / nilai tertinggi semua
 *   2. Pilih Tidak / nilai terendah semua
 *   3. Custom — atur berapa yang "Tidak" dan nomor mana saja
 *
 * Batasan yang disengaja:
 *   - Tidak berjalan otomatis. Pengguna membuka panel dan memilih pola.
 *   - Tidak pernah menekan tombol Submit, Selanjutnya, atau Simpan.
 *   - Menampilkan pratinjau jumlah pertanyaan sebelum menandai apa pun.
 */
(() => {
  if (window.__XMT_SURVEY__) return;
  window.__XMT_SURVEY__ = true;

  const { HOSTS } = globalThis.XMT_CONST;
  const { el, replace, icon, selectChoice, onRoute, onMutate } = globalThis.XMTDom;
  const { clamp } = globalThis.XMTUtil;
  const UI = globalThis.XMTUI;
  const store = globalThis.XMTStore;

  const PATTERNS = [
    {
      id: 'allYes',
      label: 'Pilih Ya / nilai tertinggi semua',
      desc: 'Memilih opsi paling positif (Ya / Sangat Baik) pada setiap pertanyaan.',
      pick: () => 0
    },
    {
      id: 'allNo',
      label: 'Pilih Tidak / nilai terendah semua',
      desc: 'Memilih opsi paling negatif (Tidak / Kurang) pada setiap pertanyaan.',
      pick: (count) => count - 1
    }
  ];

  const fillHistory = [];

  /* ------------------------------------------------- pengenalan formulir */

  function findGroups() {
    const groups = [];

    const explicit = document.querySelectorAll(
      '[role="radiogroup"], .MuiRadioGroup-root, .MuiFormGroup-root'
    );

    for (const node of explicit) {
      if (node.closest('.xmt-scope')) continue;

      const inputs = Array.from(node.querySelectorAll('input[type="radio"]')).filter(
        (input) => !input.disabled
      );

      const roles = Array.from(node.querySelectorAll('[role="radio"]'));

      if (inputs.length >= 2) groups.push({ kind: 'input', options: inputs });
      else if (roles.length >= 2) groups.push({ kind: 'role', options: roles });
    }

    if (groups.length > 0) return groups;

    const byName = new Map();
    for (const input of document.querySelectorAll('input[type="radio"]')) {
      if (input.disabled || input.closest('.xmt-scope')) continue;
      const name = input.name || '(tanpa nama)';
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(input);
    }

    for (const options of byName.values()) {
      if (options.length >= 2) groups.push({ kind: 'input', options });
    }

    return groups;
  }

  function choose(group, index) {
    const target = group.options[index];
    if (!target) return false;

    if (group.kind === 'input') return selectChoice(target);

    target.click();
    return target.getAttribute('aria-checked') === 'true';
  }

  function applyPattern(pattern) {
    const startTime = Date.now();
    const groups = findGroups().filter((group) =>
      group.options.some((option) => option.offsetParent !== null || option.closest('label'))
    );

    let filled = 0;
    for (const group of groups) {
      const index = clamp(pattern.pick(group.options.length), 0, group.options.length - 1);
      if (choose(group, index)) filled += 1;
    }

    const elapsed = Date.now() - startTime;
    fillHistory.push({
      pattern: pattern.label,
      groups: groups.length,
      filled,
      elapsed,
      timestamp: Date.now()
    });

    return { groups: groups.length, filled, elapsed };
  }

  function applyCustomPattern(noCount, noNumbers) {
    const startTime = Date.now();
    const groups = findGroups().filter((group) =>
      group.options.some((option) => option.offsetParent !== null || option.closest('label'))
    );

    const noSet = new Set(noNumbers);
    let filled = 0;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const questionNum = i + 1;
      const isNo = noSet.has(questionNum);
      const index = isNo ? group.options.length - 1 : 0;
      if (choose(group, clamp(index, 0, group.options.length - 1))) filled += 1;
    }

    const elapsed = Date.now() - startTime;
    fillHistory.push({
      pattern: `Custom (${noNumbers.length} tidak)`,
      groups: groups.length,
      filled,
      elapsed,
      timestamp: Date.now()
    });

    return { groups: groups.length, filled, elapsed };
  }

  /* --------------------------------------------------------------- panel */

  let panel;
  const customState = { noCount: 2, noNumbers: [] };

  function renderPanel(region) {
    const groups = findGroups();

    replace(region, [
      UI.parts.card({
        title: 'Terdeteksi di halaman ini',
        children: [
          UI.parts.row('Pertanyaan pilihan', groups.length),
          UI.parts.row(
            'Opsi per pertanyaan',
            groups.length > 0
              ? [...new Set(groups.map((group) => group.options.length))].join(', ')
              : '-'
          ),
          el('div', { style: { marginTop: '12px' } }, [
            UI.parts.asyncButton({
              label: 'Periksa ulang halaman',
              iconName: 'refresh',
              size: 'sm',
              onClick: async () => renderPanel(region)
            })
          ])
        ]
      }),

      groups.length === 0
        ? UI.parts.notice({
            tone: 'info',
            text: 'Belum ada pertanyaan pilihan yang terbaca. Buka dulu formulir kuesionernya, lalu tekan Periksa ulang.'
          })
        : el('div', {}, [
            el('div', {
              class: 'xmt-card-label',
              style: { margin: '16px 0 8px' },
              text: 'Pilih pola pengisian'
            }),
            el(
              'div',
              { class: 'xmt-stack' },
              [
                ...PATTERNS.map((pattern) =>
                  el(
                    'button',
                    {
                      type: 'button',
                      class: 'xmt-item',
                      on: {
                        click: async () => {
                          const ok = await UI.confirm({
                            title: pattern.label,
                            message: `Tandai ${groups.length} pertanyaan dengan pola ini?`,
                            detail:
                              'Pilihan hanya ditandai pada formulir. Anda masih bisa menyuntingnya, dan tombol Submit tidak akan ditekan oleh ekstensi.',
                            confirmLabel: 'Tandai sekarang'
                          });

                          if (!ok) return;

                          const result = applyPattern(pattern);
                          UI.toast(
                            `${result.filled} dari ${result.groups} pertanyaan ditandai. Periksa dan tekan Submit sendiri.`,
                            result.filled > 0 ? 'success' : 'error'
                          );
                          renderPanel(region);
                        }
                      }
                    },
                    [
                      el('div', { class: 'xmt-item-icon' }, [icon('checklist')]),
                      el('div', { class: 'xmt-item-body' }, [
                        el('span', { class: 'xmt-item-title', text: pattern.label }),
                        el('div', { class: 'xmt-item-meta' }, [el('span', { text: pattern.desc })])
                      ]),
                      el('span', { class: 'xmt-item-trail' }, [icon('chevron')])
                    ]
                  )
                ),

                renderCustomOption(groups, region)
              ]
            )
          ]),

      fillHistory.length > 0 && UI.parts.card({
        title: 'Riwayat pengisian',
        children: fillHistory.slice(-5).reverse().map((entry, _index) =>
          el('div', { class: 'xmt-row', style: { borderBottom: '1px solid var(--xmt-border)' } }, [
            el('div', { style: { flex: 1 } }, [
              el('div', { class: 'xmt-text-sm', text: entry.pattern }),
              el('div', { class: 'xmt-text-xs xmt-text-muted' }, [
                el('span', { text: `${entry.filled}/${entry.groups} soal` }),
                el('span', { text: ` · ${entry.elapsed}ms` }),
                el('span', { text: ` · ${new Date(entry.timestamp).toLocaleTimeString('id-ID')}` })
              ])
            ]),
            el('span', {
              class: 'xmt-badge',
              dataset: { tone: entry.filled === entry.groups ? 'success' : 'warning' },
              text: entry.filled === entry.groups ? 'Lengkap' : 'Sebagian'
            })
          ])
        )
      })
    ]);
  }

  function renderCustomOption(groups, region) {
    const noCountInput = el('input', {
      type: 'number',
      class: 'xmt-input',
      value: String(customState.noCount),
      min: '0',
      max: String(groups.length),
      style: { width: '60px', marginRight: '8px' },
      on: {
        input: (event) => {
          customState.noCount = clamp(parseInt(event.target.value, 10) || 0, 0, groups.length);
        }
      }
    });

    const noNumbersInput = el('input', {
      type: 'text',
      class: 'xmt-input',
      placeholder: 'Misal: 3, 7, 10',
      value: customState.noNumbers.join(', '),
      style: { flex: '1' },
      on: {
        input: (event) => {
          customState.noNumbers = event.target.value
            .split(/[,;\s]+/)
            .map((v) => parseInt(v.trim(), 10))
            .filter((v) => Number.isInteger(v) && v >= 1 && v <= groups.length);
        }
      }
    });

    return UI.parts.card({
      title: 'Custom',
      children: [
        el('p', {
          class: 'xmt-hint',
          text: `Dari ${groups.length} pertanyaan, atur berapa yang dijawab "Tidak / nilai terendah" dan nomor berapa saja.`
        }),
        el('div', { class: 'xmt-field', style: { marginTop: '8px' } }, [
          el('label', { class: 'xmt-label', text: 'Jumlah "Tidak"' }),
          noCountInput
        ]),
        el('div', { class: 'xmt-field', style: { marginTop: '8px' } }, [
          el('label', { class: 'xmt-label', text: 'Nomor pertanyaan yang "Tidak" (pisah koma)' }),
          noNumbersInput
        ]),
        el('div', { style: { marginTop: '12px' } }, [
          UI.parts.asyncButton({
            label: 'Terapkan custom',
            iconName: 'checklist',
            variant: 'primary',
            onClick: async () => {
              let noNumbers = customState.noNumbers;

              if (noNumbers.length === 0 && customState.noCount > 0) {
                const all = Array.from({ length: groups.length }, (_, i) => i + 1);
                for (let i = all.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [all[i], all[j]] = [all[j], all[i]];
                }
                noNumbers = all.slice(0, customState.noCount);
              }

              const ok = await UI.confirm({
                title: 'Custom pengisian',
                message: `Tandai ${groups.length} pertanyaan. ${noNumbers.length} pertanyaan dijawab "Tidak" (nomor: ${noNumbers.sort((a, b) => a - b).join(', ') || 'tidak ada'}). Sisanya dijawab "Ya".`,
                detail: 'Pilihan hanya ditandai pada formulir. Tombol Submit tidak akan ditekan.',
                confirmLabel: 'Tandai sekarang'
              });

              if (!ok) return;

              const result = applyCustomPattern(customState.noCount, noNumbers);
              UI.toast(
                `${result.filled} dari ${result.groups} pertanyaan ditandai. Periksa dan tekan Submit sendiri.`,
                result.filled > 0 ? 'success' : 'error'
              );
              renderPanel(region);
            }
          })
        ])
      ]
    });
  }

  /* ------------------------------------------------- kelayakan halaman */

  function isSurveyPage() {
    const { hostname, pathname, href } = location;

    if (hostname === HOSTS.MENTARI) return /\/kuesioner\//i.test(pathname);
    if (hostname === HOSTS.MYUNPAM) return href.includes('/data-akademik/khs');

    return false;
  }

  /* ---------------------------------------------------------------- pasang */

  let fabHandle = null;
  let inlineStop = null;

  function injectInlineButtons() {
    const submitButtons = Array.from(
      document.querySelectorAll('button.MuiButton-root, button[type="submit"], button')
    ).filter((btn) => {
      if (btn.closest('.xmt-scope')) return false;
      const text = (btn.textContent ?? '').toLowerCase();
      return /submit|kirim|selanjut|simpan|lanjut/i.test(text);
    });

    for (const nativeBtn of submitButtons) {
      const host = nativeBtn.parentElement;
      if (!host || host.querySelector('.xmt-survey-inline')) continue;

      const yesBtn = el('button', {
        type: 'button',
        class: 'xmt-scope xmt-btn xmt-survey-inline',
        dataset: { variant: 'accent', size: 'sm' },
        title: 'Isi otomatis semua Ya / nilai tertinggi',
        style: { marginLeft: '8px' },
        on: {
          click: (event) => {
            event.preventDefault();
            event.stopPropagation();
            const result = applyPattern(PATTERNS[0]);
            UI.toast(
              `${result.filled}/${result.groups} pertanyaan ditandai Ya. Periksa lalu tekan Submit sendiri.`,
              result.filled > 0 ? 'success' : 'error'
            );
          }
        }
      });
      yesBtn.appendChild(icon('checklist'));
      yesBtn.appendChild(el('span', { text: 'Isi Otomatis (Ya Semua)' }));
      UI.scope(yesBtn);
      nativeBtn.insertAdjacentElement('afterend', yesBtn);
    }
  }

  function mount() {
    if (fabHandle) return;

    panel = UI.panel({
      id: 'xmt-survey-panel',
      title: 'Bantuan Kuesioner',
      subtitle: 'penandaan manual',
      iconName: 'checklist',
      anchor: 'fab-left',
      size: 'sm',
      tabs: [{ id: 'survey', label: 'Pola', render: renderPanel }]
    });

    fabHandle = UI.fab({
      id: 'xmt-survey-panel-toggle',
      title: 'X Mentari — Bantuan Kuesioner',
      iconName: 'checklist',
      side: 'left',
      order: 1,
      onClick: () => {
        if (panel.isOpen) panel.close();
        else {
          panel.refreshTab('survey');
          panel.open('survey');
        }
      }
    });

    inlineStop = onMutate(injectInlineButtons);
  }

  function unmount() {
    panel?.destroy();
    panel = null;
    fabHandle?.destroy();
    fabHandle = null;
    inlineStop?.();
    inlineStop = null;
  }

  async function init() {
    if (!(await store.enabled('surveyHelper'))) return;

    const sync = () => {
      if (isSurveyPage()) mount();
      else unmount();
    };

    sync();
    onRoute(sync);

    window.XMTSurvey = { PATTERNS, applyPattern, applyCustomPattern, findGroups };
  }

  init();
})();
