/**
 * X Mentari — rekap presensi
 *
 * Mengambil jadwal kuliah dan status pertemuan dari MY UNPAM, lalu
 * menyajikan persentase kehadiran per mata kuliah beserta rincian tiap
 * pertemuan.
 *
 * Total kehadiran dihitung dari jumlah pertemuan sebenarnya, bukan
 * rata-rata persentase antar mata kuliah — kedua angka itu berbeda bila
 * jumlah pertemuan tidak sama, dan yang pertama yang benar.
 */
(() => {
  if (window.__XMT_PRESENSI__) return;
  window.__XMT_PRESENSI__ = true;

  const { el, replace, icon, dismissOn } = globalThis.XMTDom;
  const { percent, attendanceTone, formatDate, formatDateTime } = globalThis.XMTUtil;
  const UI = globalThis.XMTUI;
  const store = globalThis.XMTStore;
  const api = globalThis.XMTApi;

  const state = {
    student: {},
    courses: [],
    loading: false,
    error: null
  };

  let sheet;
  let mainLayer;

  /* --------------------------------------------------------------- hitung */

  function isPresent(meeting) {
    return String(meeting?.presensi_status ?? '').toLowerCase() === 'hadir';
  }

  function courseStats(course) {
    const meetings = Array.isArray(course?.pertemuan) ? course.pertemuan : [];
    const present = meetings.filter(isPresent).length;
    return {
      meetings,
      present,
      total: meetings.length,
      value: percent(present, meetings.length)
    };
  }

  function overallStats() {
    let present = 0;
    let total = 0;

    for (const course of state.courses) {
      const stats = courseStats(course);
      present += stats.present;
      total += stats.total;
    }

    return { present, total, value: percent(present, total) };
  }

  /* --------------------------------------------------------------- render */

  function percentBadge(value) {
    const tone = attendanceTone(value);
    return el('span', {
      class: 'xmt-badge',
      dataset: { tone },
      text: `${value}%`,
      style: { fontSize: 'var(--xmt-text-sm)' }
    });
  }

  function renderDetail(course) {
    const { meetings, present, total, value } = courseStats(course);

    const rows = meetings
      .map((meeting, index) => ({ meeting, number: index + 1 }))
      // Pertemuan terbaru di atas, karena itu yang paling sering dicek.
      .reverse()
      .map(({ meeting, number }) => {
        const present2 = isPresent(meeting);

        return el('div', { class: 'xmt-item', style: { cursor: 'default' } }, [
          el('div', { class: 'xmt-item-icon', dataset: { tone: present2 ? 'success' : 'danger' } }, [
            icon(present2 ? 'checkCircle' : 'cancel')
          ]),
          el('div', { class: 'xmt-item-body' }, [
            el('span', {
              class: 'xmt-item-title',
              text: `Pertemuan ${number} — ${meeting.jenis_perkuliahan ?? 'Perkuliahan'}`
            }),
            el('div', { class: 'xmt-item-meta' }, [
              el('span', { text: formatDate(meeting.tanggal_mulai) }),
              meeting.presensi_date && el('span', { text: `Absen ${formatDateTime(meeting.presensi_date)}` })
            ])
          ]),
          el('span', {
            class: 'xmt-text-xs',
            style: {
              fontWeight: '700',
              textTransform: 'uppercase',
              color: present2 ? 'var(--xmt-success)' : 'var(--xmt-danger)'
            },
            text: meeting.presensi_status ?? 'Tidak hadir'
          })
        ]);
      });

    const layer = UI.scope(el('div', { class: 'xmt-sheet-layer' }));

    layer.appendChild(
      el('div', { class: 'xmt-panel-head' }, [
        el('div', { class: 'xmt-panel-head-row' }, [
          el(
            'button',
            {
              type: 'button',
              class: 'xmt-btn',
              dataset: { variant: 'ghost', size: 'sm' },
              on: { click: () => layer.remove() }
            },
            [icon('back'), el('span', { text: 'Kembali' })]
          ),
          el('div', { class: 'xmt-panel-title', text: course.nama ?? 'Mata kuliah' })
        ])
      ])
    );

    layer.appendChild(
      el('div', { class: 'xmt-panel-body' }, [
        el('div', { class: 'xmt-grid' }, [
          UI.parts.stat({ label: 'Kehadiran', value: `${value}%`, highlight: true }),
          UI.parts.stat({ label: 'Hadir', value: present }),
          UI.parts.stat({ label: 'Tidak hadir', value: total - present }),
          UI.parts.stat({ label: 'Total pertemuan', value: total })
        ]),
        el('div', { class: 'xmt-card-label', style: { margin: '16px 0 8px' }, text: 'Rincian pertemuan' }),
        rows.length > 0
          ? el('div', { class: 'xmt-stack' }, rows)
          : el('p', { class: 'xmt-hint', text: 'Belum ada pertemuan yang tercatat.' })
      ])
    );

    mainLayer.appendChild(layer);
  }

  function renderMain() {
    // Lembar mungkin belum dibangun bila load() dipanggil dari luar
    // (misalnya lewat XMTPresensi.reload) sebelum panel pernah dibuka.
    const body = mainLayer?.querySelector('.xmt-panel-body');
    if (!body) return;

    if (state.loading) {
      replace(body, [
        el('div', { class: 'xmt-loading' }, [
          el('div', { class: 'xmt-spinner' }),
          el('span', { text: 'Mengambil data presensi dari MY UNPAM…' })
        ])
      ]);
      return;
    }

    if (state.error) {
      replace(body, [
        UI.parts.notice({ tone: 'danger', text: state.error }),
        el('div', { style: { marginTop: '12px' } }, [
          UI.parts.asyncButton({
            label: 'Coba lagi',
            iconName: 'refresh',
            variant: 'primary',
            onClick: load
          })
        ])
      ]);
      return;
    }

    if (state.courses.length === 0) {
      replace(body, [
        el('div', { class: 'xmt-empty' }, [
          el('div', { class: 'xmt-empty-title', text: 'Belum ada jadwal' }),
          el('div', {
            class: 'xmt-empty-text',
            text: 'Data presensi belum tersedia. Dosen mungkin belum membuka rekap pertemuan di sistem.'
          })
        ])
      ]);
      return;
    }

    const overall = overallStats();

    replace(body, [
      UI.parts.notice({
        tone: 'info',
        title: 'Catatan.',
        text: 'Mata kuliah yang tidak muncul di sini berarti rekap presensinya belum diterbitkan dosen di MY UNPAM.'
      }),

      el('div', { class: 'xmt-grid', style: { marginTop: '12px' } }, [
        UI.parts.stat({ label: 'Mahasiswa', value: state.student.nama ?? '-' }),
        UI.parts.stat({ label: 'NIM', value: state.student.nim ?? '-' }),
        UI.parts.stat({ label: 'Semester', value: state.student.semester ?? '-' }),
        UI.parts.stat({
          label: 'Total kehadiran',
          value: `${overall.value}%`,
          highlight: true
        })
      ]),

      el('p', {
        class: 'xmt-hint',
        style: { marginTop: '8px' },
        text: `Dihitung dari ${overall.present} kehadiran pada ${overall.total} pertemuan di seluruh mata kuliah.`
      }),

      el('div', { class: 'xmt-card-label', style: { margin: '16px 0 8px' }, text: 'Per mata kuliah' }),

      el(
        'div',
        { class: 'xmt-stack' },
        state.courses.map((course) => {
          const { present, total, value } = courseStats(course);

          return el(
            'button',
            {
              type: 'button',
              class: 'xmt-card',
              style: { display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' },
              on: { click: () => renderDetail(course) }
            },
            [
              el('div', { class: 'xmt-card-head' }, [
                el('div', { class: 'xmt-card-title', text: course.nama ?? 'Mata kuliah' }),
                percentBadge(value)
              ]),
              el('div', { class: 'xmt-item-meta' }, [
                el('span', { text: `SKS ${course.sks ?? '-'}` }),
                el('span', { text: `Hadir ${present}`, style: { color: 'var(--xmt-success)' } }),
                el('span', {
                  text: `Tidak hadir ${total - present}`,
                  style: { color: total - present > 0 ? 'var(--xmt-danger)' : undefined }
                }),
                el('span', { text: 'Lihat rincian', style: { color: 'var(--xmt-accent)' } })
              ])
            ]
          );
        })
      )
    ]);
  }

  /* ------------------------------------------------------------- pemuatan */

  async function load() {
    state.loading = true;
    state.error = null;
    renderMain();

    const live = globalThis.XMTDom.live;
    const body = mainLayer?.querySelector('.xmt-panel-body');
    if (body) {
      live.mount(body, { hidden: false });
      live.report('Presensi: mengambil jadwal…', { instant: true });
    }

    try {
      const data = await api.myunpam.attendance({
        onStep: (step) => {
          if (step?.phase === 'course-start' && step?.code) {
            live.report(`Presensi: ${step.code}…`);
          }
        }
      });
      state.student = data.student;
      state.courses = data.courses;
      live.done('Presensi: selesai.');
    } catch (error) {
      state.error = error.message;
      live.done('');
    } finally {
      state.loading = false;
      renderMain();
    }
  }

  /* --------------------------------------------------------------- lembar */

  function buildSheet() {
    mainLayer = el('div', { class: 'xmt-sheet-inner' }, [
      el('div', { class: 'xmt-panel-head' }, [
        el('div', { class: 'xmt-panel-head-row' }, [
          el('div', { class: 'xmt-panel-title' }, [
            icon('stats'),
            el('span', {}, [
              'Rekap Presensi',
              el('span', { class: 'xmt-panel-subtitle', text: ' MY UNPAM' })
            ])
          ]),
          el('div', { class: 'xmt-panel-actions' }, [
            UI.parts.asyncButton({
              label: 'Muat ulang',
              iconName: 'refresh',
              size: 'sm',
              busyLabel: 'Memuat…',
              onClick: load
            }),
            el(
              'button',
              {
                type: 'button',
                class: 'xmt-icon-btn',
                title: 'Tutup',
                'aria-label': 'Tutup rekap presensi',
                on: { click: close }
              },
              [icon('close')]
            )
          ])
        ])
      ]),
      el('div', { class: 'xmt-panel-body' })
    ]);

    sheet = UI.scope(
      el(
        'div',
        {
          class: 'xmt-sheet',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': 'Rekap presensi',
          on: {
            pointerdown: (event) => {
              if (event.target === sheet) close();
            }
          }
        },
        [mainLayer]
      )
    );

    document.body.appendChild(sheet);
  }

  let releaseDismiss = null;

  function open() {
    if (!sheet) buildSheet();

    sheet.classList.add('xmt-open');
    UI.syncTheme();

    releaseDismiss?.();
    releaseDismiss = dismissOn(mainLayer, {
      // Tombol apung dikecualikan agar pointerdown padanya tidak menutup
      // lembar sebelum penangan kliknya berjalan.
      ignore: Array.from(document.querySelectorAll('.xmt-fab')),
      onDismiss: close
    });

    if (state.courses.length === 0 && !state.loading) load();
    else renderMain();
  }

  function close() {
    sheet?.classList.remove('xmt-open');
    releaseDismiss?.();
    releaseDismiss = null;
    // Buang lapisan rincian agar lembar selalu terbuka di tampilan utama.
    mainLayer?.querySelectorAll('.xmt-sheet-layer').forEach((node) => node.remove());
  }

  /* ---------------------------------------------------------------- pasang */

  async function init() {
    if (!(await store.enabled('presensi'))) return;

    UI.fab({
      id: 'xmt-presensi-fab',
      title: 'X Mentari — Rekap Presensi',
      iconName: 'stats',
      order: 1,
      onClick: () => {
        if (sheet?.classList.contains('xmt-open')) close();
        else open();
      }
    });

    UI.registerOpener('presensi', open);

    window.XMTPresensi = { open, close, reload: load };
  }

  init();
})();
