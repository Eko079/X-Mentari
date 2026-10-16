/**
 * X Mentari — pelacak forum, notifikasi dosen, dan todo list
 *
 * Tab panel:
 *   Forum       — forum diskusi yang belum dikerjakan, dan peta mata kuliah.
 *   Notifikasi  — balasan dosen terbaru dari seluruh forum yang diikuti.
 *   Mahasiswa   — daftar mahasiswa beserta NIM dari forum.
 *   Todo        — daftar tugas forum yang terbuka otomatis + override manual.
 *   Teman       — progres e-learning teman per pertemuan (proxy pre+post).
 */
(() => {
  if (window.__XMT_FORUM_TRACKER__) return;
  window.__XMT_FORUM_TRACKER__ = true;

  const { KEYS, TEMPLATE, LIMITS, HOSTS } = globalThis.XMT_CONST;
  const { el, replace, icon } = globalThis.XMTDom;
  const { mapLimit, values, truncate, timeAgo, uniqueBy, htmlToText } = globalThis.XMTUtil;
  const UI = globalThis.XMTUI;
  const store = globalThis.XMTStore;
  const api = globalThis.XMTApi;

  const state = {
    courses: [],
    notifications: [],
    students: [],
    lecturers: {},
    forumParticipants: {},
    forumReplyCounts: {},
    studentProfile: null,
    loading: false,
    error: null,
    loadedAt: 0,
    progress: '',
    progressNode: null,
    progressAt: 0,
    peer: {
      courseCode: null,
      sectionCode: null,
      query: '',
      rows: null,
      info: null,
      cache: new Map(),
      mode: 'section',
      overview: null,
      overviewQuery: ''
    }
  };

  /** Tulis status progres live; throttle agar tidak flicker. */
  function reportProgress(text) {
    state.progress = text;
    const now = Date.now();
    if (now - state.progressAt < 100) return;
    state.progressAt = now;
    if (state.progressNode?.isConnected) {
      state.progressNode.textContent = text;
      state.progressNode.style.display = '';
    }
  }

  /* ----------------------------------------------------------- penautan */

  const COURSE_URL = (code) => `https://${HOSTS.MENTARI}/u-courses/${encodeURIComponent(code)}`;

  function templateIcon(template) {
    return (
      {
        [TEMPLATE.FORUM]: 'forum',
        [TEMPLATE.QUIZ]: 'quiz',
        [TEMPLATE.PRE_TEST]: 'checklist',
        [TEMPLATE.POST_TEST]: 'checkCircle',
        [TEMPLATE.EXAM]: 'checkCircle',
        [TEMPLATE.SURVEY]: 'checklist',
        VIDEO_AJAR: 'video',
        MATERI_LAINNYA: 'article',
        POWER_POINT: 'slides',
        BUKU_ISBN: 'book',
        ARTIKEL_RISET: 'article',
        LINK: 'link',
        FILE: 'file'
      }[template] ?? 'doc'
    );
  }

  function itemUrl(item, section, course) {
    const code = course?.kode_course;
    if (!code) return null;
    if (item.link) return item.link;

    const base = COURSE_URL(code);
    const id = item.id;

    switch (item.kode_template) {
      case TEMPLATE.FORUM:
        return id ? `${base}/forum/${id}` : base;
      case TEMPLATE.QUIZ:
      case TEMPLATE.PRE_TEST:
        return id ? `${base}/quiz/${id}` : base;
      case TEMPLATE.POST_TEST:
      case TEMPLATE.EXAM:
        return id ? `${base}/exam/${id}` : base;
      case TEMPLATE.SURVEY:
        return section?.kode_section ? `${base}/kuesioner/${section.kode_section}` : base;
      default:
        return base;
    }
  }

  function extractSectionNumber(sectionName) {
    const match = String(sectionName ?? '').match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Menentukan apakah sebuah forum sudah terbuka / bisa dikerjakan.
   *
   * Perbaikan: forum dianggap terbuka bila:
   * 1. Mempunyai id (ada di server)
   * 2. Belum dikerjakan (completion !== true)
   * 3. Tidak ada warningAlert 'sudah'
   *
   * Post-test check tetap dilakukan tapi lebih lenient:
   * jika post-test belum ada ID berarti belum di-setup, forum mungkin
   * sudah terbuka melalui jalur lain.
   */
  function isPendingForum(item, _section) {
    if (item?.kode_template !== TEMPLATE.FORUM) return false;
    if (!item.id) return false;
    if (item.completion === true) return false;
    if (String(item.warningAlert ?? '').toLowerCase().includes('sudah')) return false;

    return true;
  }

  function isOpenForum(item) {
    if (item?.kode_template !== TEMPLATE.FORUM) return false;
    return Boolean(item.id);
  }

  function isForumLikelyOpen(sectionName, sks) {
    const num = extractSectionNumber(sectionName);
    if (!num || !sks) return null;
    if (sks >= 3) {
      return LIMITS.FORUM_PATTERN_3SKS.includes(num);
    }
    return null;
  }

  /**
   * Progres e-learning satu pertemuan. Alurnya berurutan:
   * pre-test → forum diskusi → post-test → kuesioner.
   *
   * `done` (e-learning FINI / DONE) hanya true bila kuesioner — langkah
   * terakhir — sudah dikerjakan. Status forum yang centang belum tentu
   * diabsen MENTARI sebelum kuesioner selesai, jadi forum tidak dipakai
   * sebagai penanda selesai.
   */
  function hasCompletedPrePostTest(section) {
    const subs = section?.sub_section ?? [];
    const find = (template) => subs.find((entry) => entry?.kode_template === template);
    const preTest = find(TEMPLATE.PRE_TEST);
    const forum = find(TEMPLATE.FORUM);
    const postTest = find(TEMPLATE.POST_TEST);
    const survey = find(TEMPLATE.SURVEY);
    const preTestDone = preTest?.completion === true;
    const forumDone = forum?.completion === true;
    const postTestDone = postTest?.completion === true;
    const surveyDone = survey?.completion === true;
    return {
      preTestDone,
      forumDone,
      postTestDone,
      surveyDone,
      // Kuesioner adalah langkah terakhir: DONE = e-learning pertemuan fini.
      bothDone: surveyDone,
      finished: surveyDone
    };
  }

  function collectPending(courses) {
    const pending = [];
    for (const course of courses) {
      for (const section of course?.data ?? []) {
        for (const item of section?.sub_section ?? []) {
          if (isPendingForum(item, section)) pending.push({ course, section, item });
        }
      }
    }
    return pending;
  }

  function extractLecturers(courses) {
    const lecturers = {};
    for (const course of courses) {
      const code = course?.kode_course;
      if (!code) continue;
      const dosen = course?.dosen ?? course?.nama_dosen ?? course?.lecturer ?? null;
      if (dosen) {
        lecturers[code] = typeof dosen === 'string' ? dosen : dosen?.nama ?? dosen?.fullname ?? String(dosen);
      }
    }
    return lecturers;
  }

  /* ------------------------------------------------- pengambilan data */

  async function collectLecturerReplies(courses) {
    const forums = [];
    for (const course of courses) {
      for (const section of course?.data ?? []) {
        for (const item of section?.sub_section ?? []) {
          if (item?.kode_template === TEMPLATE.FORUM && item.id) {
            forums.push({ course, section, item });
          }
        }
      }
    }

    const topicResults = await mapLimit(forums, LIMITS.CONCURRENCY, async (forum) => {
      const topics = await api.mentari.forumTopics(forum.item.id);
      return topics.slice(0, LIMITS.TOPICS_PER_FORUM).map((topic) => ({ ...forum, topic }));
    });

    const topics = values(topicResults).flat();

    const replyResults = await mapLimit(topics, LIMITS.CONCURRENCY, async (entry) => {
      const replies = await api.mentari.forumReplies(entry.topic.id);

      const forumKey = `${entry.course.kode_course}::${entry.item.id}`;
      if (!state.forumReplyCounts[forumKey]) {
        state.forumReplyCounts[forumKey] = { total: 0, byUser: {} };
      }
      state.forumReplyCounts[forumKey].total += replies.length;

      for (const reply of replies) {
        const name = reply.fullname ?? reply.nama ?? 'Anonim';
        const role = String(reply?.role ?? '').toUpperCase();
        if (!state.forumReplyCounts[forumKey].byUser[name]) {
          state.forumReplyCounts[forumKey].byUser[name] = { count: 0, role };
        }
        state.forumReplyCounts[forumKey].byUser[name].count += 1;
      }

      return replies
        .filter((reply) => String(reply?.role ?? '').toUpperCase() === 'DOSEN')
        .map((reply) => ({
          id: `${entry.topic.id}-${reply.id ?? reply.created_at ?? Math.random()}`,
          lecturer: reply.fullname ?? reply.nama ?? 'Dosen',
          text: htmlToText(reply.message ?? reply.content ?? ''),
          date: reply.created_at ?? reply.createdAt ?? null,
          courseName: entry.course.coursename ?? '',
          topicTitle: entry.topic.judul ?? 'Topik',
          url: `${COURSE_URL(entry.course.kode_course)}/forum/${entry.item.id}/topics/${entry.topic.id}`
        }));
    });

    const notifications = uniqueBy(values(replyResults).flat(), (entry) => entry.id);
    notifications.sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0));
    return notifications.slice(0, LIMITS.NOTIF_MAX);
  }

  async function collectStudents(courses) {
    const studentMap = new Map();

    const forums = [];
    for (const course of courses) {
      for (const section of course?.data ?? []) {
        for (const item of section?.sub_section ?? []) {
          if (item?.kode_template === TEMPLATE.FORUM && item.id) {
            forums.push({ course, item });
          }
        }
      }
    }

    const topicResults = await mapLimit(forums.slice(0, 8), LIMITS.CONCURRENCY, async (forum) => {
      const topics = await api.mentari.forumTopics(forum.item.id);
      return topics.slice(0, 3).map((topic) => ({ ...forum, topic }));
    });

    const topics = values(topicResults).flat();

    await mapLimit(topics.slice(0, 12), LIMITS.CONCURRENCY, async (entry) => {
      const replies = await api.mentari.forumReplies(entry.topic.id);
      for (const reply of replies) {
        const role = String(reply?.role ?? '').toUpperCase();
        if (role === 'DOSEN') continue;
        const name = reply.fullname ?? reply.nama ?? '';
        const nim = reply.nim ?? reply.username ?? '';
        if (name && !studentMap.has(name)) {
          studentMap.set(name, {
            nama: name,
            nim,
            courseCount: new Set(),
            forumCount: 0
          });
        }
        if (studentMap.has(name)) {
          studentMap.get(name).courseCount.add(entry.course.kode_course);
          studentMap.get(name).forumCount += 1;
        }
      }
    });

    return Array.from(studentMap.values()).map((student) => ({
      ...student,
      courseCount: student.courseCount.size
    }));
  }

  async function syncTodoList(courses) {
    const openForums = [];
    for (const course of courses) {
      for (const section of course?.data ?? []) {
        for (const item of section?.sub_section ?? []) {
          reportProgress(
            `Cek: ${course?.kode_course ?? ''} — ${section?.kode_section ?? section?.nama_section ?? ''} — ${item?.kode_template ?? ''}`
          );
          if (isOpenForum(item)) {
            openForums.push({
              course,
              section,
              item,
              done: item.completion === true,
              ...hasCompletedPrePostTest(section)
            });
          }
        }
      }
    }
    const overrides = (await store.get(KEYS.TODO_OVERRIDES)) ?? {};

    const todos = openForums.map((forum) => {
      const key = `${forum.course.kode_course}::${forum.item.id}`;
      const overridden = overrides[key];
      // DONE = flag `finished`: kuesioner (langkah terakhir) completion-nya
      // true. Sumbernya sama persis dengan label hijau "Selesai" di tab
      // Forum. Tidak ada request tambahan: GET kuesioner tidak bisa
      // membedakan sudah/belum (jawaban selalu terisi default), dan di
      // balik Cloudflare request ekstra itu rapuh.
      const done = overridden != null ? overridden : forum.finished;
      return {
        key,
        title: forum.item.judul ?? forum.item.nama_sub_section ?? 'Forum diskusi',
        courseName: forum.course.coursename ?? '',
        sectionName: forum.section?.nama_section ?? '',
        done,
        preTestDone: forum.preTestDone,
        forumDone: forum.forumDone,
        postTestDone: forum.postTestDone,
        surveyDone: forum.surveyDone,
        url: itemUrl(forum.item, forum.section, forum.course),
        overridden: overridden != null
      };
    });

    await store.set(KEYS.TODO_LIST, todos);
    return todos;
  }

  async function load({ force = false } = {}) {
    if (state.loading) return;

    if (!force) {
      const [cached, cachedAt, notifs] = await Promise.all([
        store.get(KEYS.COURSE_CACHE),
        store.get(KEYS.COURSE_CACHE_AT),
        store.get(KEYS.NOTIF_CACHE)
      ]);

      const fresh = Date.now() - (cachedAt ?? 0) < LIMITS.CACHE_TTL_MS;
      if (fresh && Array.isArray(cached) && cached.length > 0) {
        state.courses = cached;
        state.notifications = Array.isArray(notifs) ? notifs : [];
        state.loadedAt = cachedAt;
        state.lecturers = extractLecturers(cached);
        await syncTodoList(cached);
        return;
      }
    }

    state.loading = true;
    state.error = null;

    try {
      reportProgress('Cek: mengambil daftar mata kuliah…');
      const [courses, profile] = await Promise.all([
        api.mentari.allCourseDetails({
          onStep: (step) => {
            if (step?.phase === 'course-start' && step?.code) {
              reportProgress(`Cek: ${step.code}`);
            }
          }
        }),
        api.mentari.studentProfile()
      ]);

      state.courses = courses;
      state.studentProfile = profile;
      state.loadedAt = Date.now();
      state.lecturers = extractLecturers(courses);

      await store.merge({
        [KEYS.COURSE_CACHE]: state.courses,
        [KEYS.COURSE_CACHE_AT]: state.loadedAt
      });

      await syncTodoList(courses);

      if (await store.enabled('lecturerNotif')) {
        state.notifications = await collectLecturerReplies(state.courses);
        await store.set(KEYS.NOTIF_CACHE, state.notifications);

        state.students = await collectStudents(state.courses);
      }
    } catch (error) {
      state.error = error?.message ?? 'Gagal mengambil data dari server kampus.';
    } finally {
      state.loading = false;
    }
  }

  /* -------------------------------------------------------------- render */

  function renderStudentProfile() {
    const p = state.studentProfile;
    if (!p) return null;
    const nim = p.nim ?? p.username ?? p.nomor_mahasiswa ?? '';
    const nama = p.nama ?? p.fullname ?? p.nama_mahasiswa ?? '';
    if (!nim && !nama) return null;

    return UI.parts.card({
      title: 'Profil Mahasiswa',
      children: [
        nama && UI.parts.row('Nama', nama),
        nim && UI.parts.row('NIM', nim)
      ]
    });
  }

  function renderCourseMap(courses) {
    return courses.map((course) => {
      const lecturerName = state.lecturers[course?.kode_course] ?? null;

      const sections = (course?.data ?? []).map((section) => {
        const items = (section?.sub_section ?? []).map((item) => {
          const url = itemUrl(item, section, course);
          const done = item.completion === true;

          const metaParts = [];
          if (done) {
            metaParts.push(el('span', {
              text: 'Selesai',
              style: { color: 'var(--xmt-success)' }
            }));
          } else {
            metaParts.push(el('span', {
              text: 'Belum',
              style: { color: 'var(--xmt-warning)' }
            }));
          }

          if (item.kode_template === TEMPLATE.FORUM && item.id) {
            const forumKey = `${course.kode_course}::${item.id}`;
            const replies = state.forumReplyCounts[forumKey];
            if (replies) {
              metaParts.push(el('span', {
                text: `${replies.total} balasan`,
                style: { color: 'var(--xmt-accent)' }
              }));
            }
          }

          return UI.parts.item({
            iconName: templateIcon(item.kode_template),
            tone: done ? 'success' : undefined,
            title: item.judul ?? item.nama_sub_section ?? item.kode_template ?? 'Materi',
            meta: metaParts,
            href: url,
            trailIcon: 'external'
          });
        });

        const pendingCount = (section?.sub_section ?? []).filter((item) =>
          isPendingForum(item, section)
        ).length;

        const sectionNum = extractSectionNumber(section?.nama_section);
        const patternHint = isForumLikelyOpen(section?.nama_section, course?.sks);

        const sectionTitle = section?.nama_section ?? 'Pertemuan';
        const sectionBadges = [];
        if (pendingCount > 0) sectionBadges.push(UI.parts.badge(`${pendingCount} forum`, 'brand'));
        if (patternHint === true && sectionNum) {
          sectionBadges.push(UI.parts.badge('prediksi buka', 'accent'));
        }

        return UI.parts.collapse({
          title: sectionTitle,
          badge: sectionBadges.length > 0
            ? el('span', { class: 'xmt-cluster' }, sectionBadges)
            : null,
          children: items.length > 0 ? items : el('p', { class: 'xmt-hint', text: 'Belum ada materi.' })
        });
      });

      const courseTitle = course?.coursename ?? 'Mata kuliah';
      const courseMeta = [];
      courseMeta.push(UI.parts.badge(course?.kode_course ?? '', 'accent'));
      if (lecturerName) {
        courseMeta.push(UI.parts.badge(`Dosen: ${lecturerName}`, 'brand'));
      }

      return UI.parts.collapse({
        title: courseTitle,
        badge: el('span', { class: 'xmt-cluster' }, courseMeta),
        children:
          sections.length > 0
            ? sections
            : el('p', { class: 'xmt-hint', text: 'Detail pertemuan belum tersedia.' })
      });
    });
  }

  function renderForumTab(region, panel) {
    if (state.loading) {
      panel.loading('Mengambil data mata kuliah…', 'forum');
      return;
    }

    if (state.error) {
      panel.error(state.error, () => refresh(panel, 'forum'), 'forum');
      return;
    }

    if (state.courses.length === 0) {
      panel.empty(
        {
          title: 'Belum ada data',
          text: 'Tekan Muat ulang untuk mengambil daftar mata kuliah Anda.',
          action: UI.parts.asyncButton({
            label: 'Muat ulang',
            iconName: 'refresh',
            variant: 'primary',
            onClick: () => refresh(panel, 'forum')
          })
        },
        'forum'
      );
      return;
    }

    const pending = collectPending(state.courses);

    replace(region, [
      renderStudentProfile(),

      pending.length > 0
        ? UI.parts.card({
            title: `Forum belum dikerjakan (${pending.length})`,
            children: pending.map(({ course, section, item }) =>
              UI.parts.item({
                iconName: 'forum',
                title: item.judul ?? item.nama_sub_section ?? 'Forum diskusi',
                meta: [
                  course.coursename,
                  section?.nama_section,
                  state.lecturers[course.kode_course]
                    ? `Dosen: ${state.lecturers[course.kode_course]}`
                    : null
                ].filter(Boolean),
                href: itemUrl(item, section, course),
                trailIcon: 'external'
              })
            )
          })
        : UI.parts.notice({
            tone: 'success',
            title: 'Semua beres.',
            text: 'Tidak ada forum diskusi yang menunggu dikerjakan saat ini.'
          }),

      el('div', { class: 'xmt-card-label', style: { margin: '16px 0 8px' }, text: 'Semua mata kuliah' }),
      ...renderCourseMap(state.courses)
    ]);
  }

  function renderNotifTab(region, panel) {
    if (state.loading) {
      panel.loading('Memindai balasan dosen…', 'notif');
      return;
    }

    if (state.error) {
      panel.error(state.error, () => refresh(panel, 'notif'), 'notif');
      return;
    }

    if (state.notifications.length === 0) {
      panel.empty(
        {
          title: 'Belum ada balasan dosen',
          text: 'Balasan dosen dari seluruh forum akan terkumpul di sini setelah data dimuat.',
          action: UI.parts.asyncButton({
            label: 'Muat ulang',
            iconName: 'refresh',
            variant: 'primary',
            onClick: () => refresh(panel, 'notif')
          })
        },
        'notif'
      );
      return;
    }

    replace(
      region,
      state.notifications.map((entry) =>
        el('div', { class: 'xmt-card', style: { borderLeft: '3px solid var(--xmt-brand)' } }, [
          el('div', { class: 'xmt-card-head' }, [
            el('div', { class: 'xmt-card-title', text: entry.lecturer }),
            el('span', { class: 'xmt-text-xs xmt-text-muted', text: timeAgo(entry.date) })
          ]),
          el('div', { class: 'xmt-text-xs xmt-text-muted', text: entry.courseName }),
          el('p', {
            class: 'xmt-text-sm',
            style: { margin: '8px 0 0', lineHeight: '1.6', whiteSpace: 'pre-wrap' },
            text: truncate(entry.text, 320)
          }),
          el('div', { class: 'xmt-cluster', style: { marginTop: '12px' } }, [
            el(
              'a',
              {
                class: 'xmt-btn',
                dataset: { size: 'sm' },
                href: entry.url,
                target: '_blank',
                rel: 'noopener noreferrer'
              },
              [icon('external'), el('span', { text: 'Buka diskusi' })]
            ),
            UI.parts.copyButton(() => entry.text)
          ])
        ])
      )
    );
  }

  function renderStudentTab(region, panel) {
    if (state.loading) {
      panel.loading('Mengumpulkan data mahasiswa…', 'students');
      return;
    }

    if (state.students.length === 0) {
      panel.empty(
        {
          title: 'Belum ada data mahasiswa',
          text: 'Data mahasiswa dikumpulkan dari balasan forum. Muat ulang untuk mengambil data.',
          action: UI.parts.asyncButton({
            label: 'Muat ulang',
            iconName: 'refresh',
            variant: 'primary',
            onClick: () => refresh(panel, 'students')
          })
        },
        'students'
      );
      return;
    }

    const sorted = [...state.students].sort((a, b) => b.forumCount - a.forumCount);

    replace(region, [
      UI.parts.card({
        title: `Mahasiswa terdeteksi (${sorted.length})`,
        children: [
          ...sorted.map((student, index) =>
            UI.parts.item({
              iconName: 'person',
              tone: student.forumCount >= 3 ? 'success' : undefined,
              title: `${index + 1}. ${student.nama}`,
              meta: [
                student.nim ? `NIM: ${student.nim}` : null,
                `${student.forumCount} balasan forum`,
                `${student.courseCount} mata kuliah`
              ].filter(Boolean)
            })
          )
        ]
      })
    ]);
  }

  /* ------------------------------------------------- progres teman */

  /** Semua pertemuan yang punya forum diskusi, untuk dropdown tab Teman. */
  function peerSections() {
    const list = [];
    for (const course of state.courses) {
      for (const section of course?.data ?? []) {
        const subs = section?.sub_section ?? [];
        const find = (template) => subs.find((entry) => entry?.kode_template === template);
        const forum = find(TEMPLATE.FORUM);
        if (!forum) continue;
        const pre = find(TEMPLATE.PRE_TEST);
        const post = find(TEMPLATE.POST_TEST);
        list.push({
          courseCode: course?.kode_course ?? '',
          courseName: course?.coursename ?? course?.kode_course ?? '',
          sectionCode: section?.kode_section ?? '',
          sectionName: section?.nama_section ?? section?.kode_section ?? '',
          forumId: forum.id ?? null,
          preId: pre?.id ?? null,
          postId: post?.id ?? null
        });
      }
    }
    return list;
  }

  /** Gabung hasil pre+post by NIM; `quiz` ada = sudah mengerjakan. */
  function mergePeerRows(preRows, postRows) {
    const map = new Map();
    const put = (row, slot) => {
      const nim = String(row?.nim ?? '').trim();
      if (!nim) return;
      if (!map.has(nim)) {
        map.set(nim, {
          nim,
          nama: row?.nama_mahasiswa ?? row?.fullname ?? nim,
          pre: null,
          post: null
        });
      }
      const entry = map.get(nim);
      if (row?.nama_mahasiswa && !entry.nama) entry.nama = row.nama_mahasiswa;
      if (row?.quiz) entry[slot] = row.quiz.grade ?? true;
    };
    for (const row of preRows) put(row, 'pre');
    for (const row of postRows) put(row, 'post');
    return Array.from(map.values()).sort((a, b) => {
      const rank = (entry) => (entry.pre != null && entry.post != null ? 0 : entry.pre != null || entry.post != null ? 1 : 2);
      return rank(a) - rank(b) || String(a.nama).localeCompare(String(b.nama));
    });
  }

  function peerStatus(entry) {
    if (entry.pre != null && entry.post != null) return { label: 'DONE', tone: 'success' };
    if (entry.pre != null) return { label: 'Pre saja', tone: undefined };
    if (entry.post != null) return { label: 'Post saja', tone: undefined };
    return { label: 'Belum', tone: 'warning' };
  }

  function renderPeerRows(region) {
    const host = region.querySelector('[data-peer-list]');
    if (!host) return;
    const query = state.peer.query.trim().toLowerCase();
    const rows = (state.peer.rows ?? []).filter(
      (entry) =>
        !query ||
        entry.nama?.toLowerCase().includes(query) ||
        entry.nim?.toLowerCase().includes(query)
    );
    replace(host, rows.map((entry, index) => {
      const status = peerStatus(entry);
      return el('div', { class: 'xmt-item', style: { cursor: 'default' } }, [
        el('div', { class: 'xmt-item-icon', dataset: { tone: status.tone === 'success' ? 'success' : undefined } }, [
          icon('person')
        ]),
        el('div', { class: 'xmt-item-body' }, [
          el('span', { class: 'xmt-item-title', text: `${index + 1}. ${entry.nama}` }),
          el('div', { class: 'xmt-item-meta' }, [
            el('span', { text: `NIM: ${entry.nim}` }),
            el('span', { text: `Pre: ${entry.pre ?? '-'}` }),
            el('span', { text: `Post: ${entry.post ?? '-'}` })
          ])
        ]),
        el('span', { class: 'xmt-badge', dataset: { tone: status.tone }, text: status.label })
      ]);
    }));
  }

  async function checkPeers(region, { courseCode, sectionCode, preId, postId }) {
    const live = globalThis.XMTDom.live;
    const key = `${courseCode}::${sectionCode}`;
    state.peer.rows = null;
    state.peer.info = null;

    if (!preId && !postId) {
      state.peer.info = { done: 0, total: 0, avg: 0, empty: true };
      renderPeerSummary(region);
      return;
    }
    if (state.peer.cache.has(key)) {
      const cached = state.peer.cache.get(key);
      state.peer.rows = cached.rows;
      state.peer.info = cached.info;
      renderPeerSummary(region);
      renderPeerRows(region);
      return;
    }

    live.report(`Cek: ${courseCode} — ${sectionCode} — PRE/POST…`, { instant: true });
    try {
      const [pre, post] = await Promise.all([
        preId ? api.mentari.quizParticipants(preId).catch(() => ({ data: [] })) : { data: [] },
        postId ? api.mentari.quizParticipants(postId).catch(() => ({ data: [] })) : { data: [] }
      ]);
      const rows = mergePeerRows(pre?.data ?? [], post?.data ?? []);
      const done = rows.filter((entry) => entry.pre != null && entry.post != null).length;
      const postGrades = rows.map((entry) => Number(entry.post)).filter((grade) => Number.isFinite(grade));
      const info = {
        done,
        total: rows.length,
        avg: postGrades.length > 0 ? postGrades.reduce((sum, grade) => sum + grade, 0) / postGrades.length : 0
      };
      state.peer.cache.set(key, { rows, info });
      state.peer.rows = rows;
      state.peer.info = info;
      live.report('Cek: selesai.', { instant: true });
    } catch {
      live.report('Cek: gagal.', { instant: true });
      state.peer.rows = [];
      state.peer.info = { done: 0, total: 0, avg: 0 };
    }
    renderPeerSummary(region);
    renderPeerRows(region);
  }

  function renderPeerSummary(region) {
    const host = region.querySelector('[data-peer-summary]');
    if (!host) return;
    const info = state.peer.info;
    if (!info) {
      replace(host, []);
      return;
    }
    if (info.empty) {
      replace(host, [UI.parts.notice({ tone: 'warning', text: 'Pre-test / post-test belum di-setup.' })]);
      return;
    }
    replace(host, [
      el('div', { class: 'xmt-cluster' }, [
        UI.parts.stat({ label: 'Fini', value: `${info.done}/${info.total}`, highlight: true }),
        UI.parts.stat({ label: '%', value: info.total > 0 ? Math.round((info.done / info.total) * 100) : 0 }),
        UI.parts.stat({ label: 'Rata-rata post', value: info.avg.toFixed(1) })
      ])
    ]);
  }

  /* ----------------------------------------- ikhtisar semua pertemuan */

  async function checkAllPeers(region, courseCode) {
    const live = globalThis.XMTDom.live;
    const sections = peerSections().filter((s) => s.courseCode === courseCode);
    const results = [];

    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      live.report(`Cek: ${sec.sectionName} (${i + 1}/${sections.length})…`, { instant: true });
      const key = `${sec.courseCode}::${sec.sectionCode}`;

      if (state.peer.cache.has(key)) {
        const cached = state.peer.cache.get(key);
        results.push({ section: sec, rows: cached.rows, info: cached.info });
        continue;
      }

      if (!sec.preId && !sec.postId) {
        const info = { done: 0, total: 0, avg: 0, empty: true };
        results.push({ section: sec, rows: [], info });
        continue;
      }

      try {
        const [pre, post] = await Promise.all([
          sec.preId ? api.mentari.quizParticipants(sec.preId).catch(() => ({ data: [] })) : { data: [] },
          sec.postId ? api.mentari.quizParticipants(sec.postId).catch(() => ({ data: [] })) : { data: [] }
        ]);
        const rows = mergePeerRows(pre?.data ?? [], post?.data ?? []);
        const done = rows.filter((e) => e.pre != null && e.post != null).length;
        const postGrades = rows.map((e) => Number(e.post)).filter((g) => Number.isFinite(g));
        const info = {
          done,
          total: rows.length,
          avg: postGrades.length > 0 ? postGrades.reduce((a, b) => a + b, 0) / postGrades.length : 0
        };
        state.peer.cache.set(key, { rows, info });
        results.push({ section: sec, rows, info });
      } catch {
        results.push({ section: sec, rows: [], info: { done: 0, total: 0, avg: 0 } });
      }
    }

    live.report('Cek: selesai.', { instant: true });

    const studentMap = new Map();
    for (const result of results) {
      if (result.info.empty) continue;
      for (const row of result.rows) {
        if (!studentMap.has(row.nim)) {
          studentMap.set(row.nim, { nim: row.nim, nama: row.nama, sections: [] });
        }
        const entry = studentMap.get(row.nim);
        if (row.nama && entry.nama === row.nim) entry.nama = row.nama;
        entry.sections.push({
          sectionName: result.section.sectionName,
          pre: row.pre,
          post: row.post,
          done: row.pre != null && row.post != null
        });
      }
    }

    const validResults = results.filter((r) => !r.info.empty);
    const totalSections = validResults.length;

    state.peer.overview = {
      sections: results,
      students: studentMap,
      totalSections
    };

    renderOverview(region);
  }

  function barTone(pct) {
    if (pct >= 80) return 'success';
    if (pct >= 50) return 'warning';
    return 'danger';
  }

  function renderCompletionChart(sections) {
    const valid = sections.filter((r) => !r.info.empty);
    if (valid.length === 0) {
      return el('p', { class: 'xmt-hint', text: 'Tidak ada pertemuan dengan pre/post test.' });
    }
    return el('div', { class: 'xmt-stack' }, valid.map((r) => {
      const pct = r.info.total > 0 ? Math.round((r.info.done / r.info.total) * 100) : 0;
      const tone = barTone(pct);
      return el('div', { class: 'xmt-ov-bar-row' }, [
        el('span', { class: 'xmt-ov-bar-label', text: r.section.sectionName }),
        el('div', { class: 'xmt-ov-bar-track' }, [
          el('div', {
            class: 'xmt-ov-bar-fill',
            dataset: { tone },
            style: { width: `${pct}%` }
          })
        ]),
        el('span', { class: 'xmt-ov-bar-pct', text: `${pct}%` })
      ]);
    }));
  }

  function renderOverviewTable(sections) {
    const valid = sections.filter((r) => !r.info.empty);
    if (valid.length === 0) return null;

    const headRow = el('div', { class: 'xmt-ov-trow xmt-ov-thead' }, [
      el('span', { class: 'xmt-ov-tcell xmt-ov-tcell-name', text: 'Pertemuan' }),
      el('span', { class: 'xmt-ov-tcell', text: 'Fini' }),
      el('span', { class: 'xmt-ov-tcell', text: 'Total' }),
      el('span', { class: 'xmt-ov-tcell', text: '%' }),
      el('span', { class: 'xmt-ov-tcell', text: 'Avg Post' })
    ]);

    const bodyRows = valid.map((r) => {
      const pct = r.info.total > 0 ? Math.round((r.info.done / r.info.total) * 100) : 0;
      return el('div', { class: 'xmt-ov-trow' }, [
        el('span', { class: 'xmt-ov-tcell xmt-ov-tcell-name', text: r.section.sectionName }),
        el('span', { class: 'xmt-ov-tcell', text: String(r.info.done) }),
        el('span', { class: 'xmt-ov-tcell', text: String(r.info.total) }),
        el('span', {
          class: 'xmt-ov-tcell',
          style: { color: `var(--xmt-${barTone(pct)})`, fontWeight: '700' },
          text: `${pct}%`
        }),
        el('span', { class: 'xmt-ov-tcell', text: r.info.avg.toFixed(1) })
      ]);
    });

    return el('div', { class: 'xmt-ov-table' }, [headRow, ...bodyRows]);
  }

  function renderIncompleteStudents(region) {
    const host = region.querySelector('[data-ov-students]');
    if (!host) return;
    const overview = state.peer.overview;
    if (!overview) { replace(host, []); return; }

    const query = state.peer.overviewQuery.trim().toLowerCase();
    const totalSections = overview.totalSections;

    const incomplete = [];
    for (const student of overview.students.values()) {
      const doneCount = student.sections.filter((s) => s.done).length;
      if (doneCount >= totalSections) continue;
      const match = !query ||
        student.nama?.toLowerCase().includes(query) ||
        student.nim?.toLowerCase().includes(query);
      if (match) incomplete.push({ ...student, doneCount });
    }
    incomplete.sort((a, b) => a.doneCount - b.doneCount || String(a.nama).localeCompare(String(b.nama)));

    replace(host, incomplete.map((student, idx) => {
      const pct = totalSections > 0 ? Math.round((student.doneCount / totalSections) * 100) : 0;
      const missing = student.sections.filter((s) => !s.done);

      return el('div', { class: 'xmt-card', style: { padding: 'var(--xmt-space-2) var(--xmt-space-3)' } }, [
        el('div', { class: 'xmt-item', style: { border: 'none', padding: '0', cursor: 'default' } }, [
          el('div', { class: 'xmt-item-icon', dataset: { tone: pct >= 50 ? undefined : 'danger' } }, [
            icon('person')
          ]),
          el('div', { class: 'xmt-item-body' }, [
            el('span', { class: 'xmt-item-title', text: `${idx + 1}. ${student.nama}` }),
            el('div', { class: 'xmt-item-meta' }, [
              el('span', { text: `NIM: ${student.nim}` }),
              el('span', {
                text: `Selesai ${student.doneCount}/${totalSections}`,
                style: { color: `var(--xmt-${barTone(pct)})` }
              })
            ])
          ]),
          el('div', { class: 'xmt-ov-mini-bar-wrap' }, [
            el('div', { class: 'xmt-ov-bar-track', style: { width: '60px', height: '6px' } }, [
              el('div', {
                class: 'xmt-ov-bar-fill',
                dataset: { tone: barTone(pct) },
                style: { width: `${pct}%` }
              })
            ])
          ])
        ]),
        missing.length > 0 && el('div', {
          class: 'xmt-cluster',
          style: { paddingLeft: '42px', paddingBottom: 'var(--xmt-space-1)' }
        }, missing.map((s) => {
          const status = peerStatus({ pre: s.pre, post: s.post });
          return el('span', {
            class: 'xmt-badge',
            dataset: { tone: status.tone ?? 'warning' },
            text: `${s.sectionName}: ${status.label}`
          });
        }))
      ]);
    }));

    const allCount = Array.from(overview.students.values()).filter(
      (s) => s.sections.filter((sec) => sec.done).length >= totalSections
    ).length;
    const totalStudents = overview.students.size;

    const summaryHost = region.querySelector('[data-ov-global-summary]');
    if (summaryHost) {
      replace(summaryHost, [
        el('div', { class: 'xmt-cluster' }, [
          UI.parts.stat({ label: 'Semua Fini', value: `${allCount}/${totalStudents}`, highlight: true }),
          UI.parts.stat({ label: '%', value: totalStudents > 0 ? Math.round((allCount / totalStudents) * 100) : 0 }),
          UI.parts.stat({ label: 'Belum lengkap', value: String(incomplete.length) })
        ])
      ]);
    }
  }

  function renderOverview(region) {
    const overview = state.peer.overview;
    if (!overview) {
      replace(region.querySelector('[data-ov-content]'), []);
      return;
    }

    const contentHost = region.querySelector('[data-ov-content]');
    if (!contentHost) return;

    replace(contentHost, [
      el('div', { class: 'xmt-card-label', style: { margin: '0 0 var(--xmt-space-1)' }, text: 'Grafik Completion' }),
      renderCompletionChart(overview.sections),

      el('div', { class: 'xmt-card-label', style: { margin: 'var(--xmt-space-3) 0 var(--xmt-space-1)' }, text: 'Ringkasan Per Pertemuan' }),
      renderOverviewTable(overview.sections),

      el('div', { dataset: { ovGlobalSummary: '' }, style: { marginTop: 'var(--xmt-space-3)' } }),

      el('div', { class: 'xmt-card-label', style: { margin: 'var(--xmt-space-3) 0 var(--xmt-space-1)' }, text: 'Mahasiswa Belum Lengkap' }),
      el('input', {
        class: 'xmt-input',
        type: 'search',
        placeholder: 'Cari nama / NIM…',
        value: state.peer.overviewQuery,
        on: {
          input: (event) => {
            state.peer.overviewQuery = event.target.value;
            renderIncompleteStudents(region);
          }
        }
      }),
      el('div', { class: 'xmt-stack', dataset: { ovStudents: '' } })
    ]);

    renderIncompleteStudents(region);
  }

  async function renderPeerTab(region) {
    if (state.loading) {
      region.textContent = '';
      region.append(el('div', { class: 'xmt-loading' }, [
        el('div', { class: 'xmt-spinner' }),
        el('span', { text: 'Memuat…' })
      ]));
      return;
    }

    const sections = peerSections();
    if (sections.length === 0) {
      region.textContent = '';
      region.append(el('p', { class: 'xmt-hint', text: 'Belum ada forum. Muat ulang dulu.' }));
      return;
    }

    if (!sections.some((entry) => entry.courseCode === state.peer.courseCode && entry.sectionCode === state.peer.sectionCode)) {
      const fallback = sections[0];
      state.peer.courseCode = fallback.courseCode;
      state.peer.sectionCode = fallback.sectionCode;
      state.peer.rows = null;
      state.peer.info = null;
    }

    const courses = uniqueBy(sections, (entry) => entry.courseCode);
    const courseSections = sections.filter((entry) => entry.courseCode === state.peer.courseCode);
    if (!courseSections.some((entry) => entry.sectionCode === state.peer.sectionCode)) {
      state.peer.sectionCode = courseSections[0]?.sectionCode ?? null;
      state.peer.rows = null;
      state.peer.info = null;
    }

    const courseSelect = el('select', {
      class: 'xmt-input',
      on: {
        change: (event) => {
          state.peer.courseCode = event.target.value;
          state.peer.sectionCode = sections.find((entry) => entry.courseCode === state.peer.courseCode)?.sectionCode ?? null;
          state.peer.rows = null;
          state.peer.info = null;
          state.peer.overview = null;
          renderPeerTab(region);
        }
      }
    }, courses.map((entry) =>
      el('option', {
        value: entry.courseCode,
        selected: entry.courseCode === state.peer.courseCode ? true : undefined,
        text: truncate(entry.courseName, 40)
      })
    ));

    const modeToggle = el('div', { class: 'xmt-peer-mode' }, [
      el('button', {
        type: 'button',
        class: 'xmt-peer-mode-btn',
        'aria-pressed': state.peer.mode === 'section' ? 'true' : 'false',
        text: 'Per Pertemuan',
        on: {
          click: () => {
            if (state.peer.mode === 'section') return;
            state.peer.mode = 'section';
            renderPeerTab(region);
          }
        }
      }),
      el('button', {
        type: 'button',
        class: 'xmt-peer-mode-btn',
        'aria-pressed': state.peer.mode === 'overview' ? 'true' : 'false',
        text: 'Ikhtisar',
        on: {
          click: () => {
            if (state.peer.mode === 'overview') return;
            state.peer.mode = 'overview';
            renderPeerTab(region);
          }
        }
      })
    ]);

    const progressHost = el('div', {});
    globalThis.XMTDom.live.mount(progressHost, { hidden: true });

    if (state.peer.mode === 'overview') {
      replace(region, [
        el('div', { class: 'xmt-stack' }, [
          courseSelect,
          modeToggle,
          el('div', { class: 'xmt-cluster' }, [
            UI.parts.asyncButton({
              label: 'Cek Semua Pertemuan',
              iconName: 'refresh',
              size: 'sm',
              busyLabel: 'Mengecek…',
              onClick: async () => {
                await checkAllPeers(region, state.peer.courseCode);
              }
            })
          ]),
          progressHost,
          el('div', { dataset: { ovContent: '' } })
        ])
      ]);
      if (state.peer.overview) renderOverview(region);
      return;
    }

    const sectionSelect = el('select', {
      class: 'xmt-input',
      on: {
        change: (event) => {
          state.peer.sectionCode = event.target.value;
          state.peer.rows = null;
          state.peer.info = null;
          renderPeerSummary(region);
          renderPeerRows(region);
        }
      }
    }, courseSections.map((entry) =>
      el('option', {
        value: entry.sectionCode,
        selected: entry.sectionCode === state.peer.sectionCode ? true : undefined,
        text: entry.sectionName
      })
    ));

    const searchInput = el('input', {
      class: 'xmt-input',
      type: 'search',
      placeholder: 'Cari nama / NIM…',
      value: state.peer.query,
      on: {
        input: (event) => {
          state.peer.query = event.target.value;
          renderPeerRows(region);
        }
      }
    });

    replace(region, [
      el('div', { class: 'xmt-stack' }, [
        courseSelect,
        modeToggle,
        sectionSelect,
        el('div', { class: 'xmt-cluster' }, [
          UI.parts.asyncButton({
            label: 'Cek',
            iconName: 'refresh',
            size: 'sm',
            busyLabel: 'Mengecek…',
            onClick: async () => {
              const current = sections.find(
                (entry) => entry.courseCode === state.peer.courseCode && entry.sectionCode === state.peer.sectionCode
              );
              if (current) await checkPeers(region, current);
            }
          })
        ]),
        progressHost,
        el('div', {}, [el('div', { dataset: { peerSummary: '' } })]),
        searchInput,
        el('div', { class: 'xmt-stack', dataset: { peerList: '' } })
      ])
    ]);

    renderPeerSummary(region);
    if (state.peer.rows) renderPeerRows(region);
  }

  async function renderTodoTab(region, panel) {
    if (state.loading) {
      panel.loading('Memuat daftar tugas…', 'todo');
      return;
    }

    const todos = (await store.get(KEYS.TODO_LIST)) ?? [];
    const overrides = (await store.get(KEYS.TODO_OVERRIDES)) ?? {};

    if (todos.length === 0) {
      panel.empty(
        {
          title: 'Belum ada forum terbuka',
          text: 'Forum yang terdeteksi terbuka akan muncul di sini.',
          action: UI.parts.asyncButton({
            label: 'Muat ulang',
            iconName: 'refresh',
            variant: 'primary',
            onClick: () => refresh(panel, 'todo')
          })
        },
        'todo'
      );
      return;
    }

    const pending = todos.filter((t) => !t.done);
    const done = todos.filter((t) => t.done);

    const progressHost = el('div', { style: { marginTop: '8px' } });
    // Node progres global pindah ke sini tiap render; teks terakhir
    // dipertahankan agar "Cek: selesai." tidak hilang.
    globalThis.XMTDom.live.mount(progressHost, { hidden: !/^Cek: /.test(state.progress) });

    replace(region, [
      UI.parts.card({
        title: 'Deteksi otomatis',
        children: [
          UI.parts.row(
            'Tanda manual aktif',
            String(todos.filter((t) => t.overridden).length)
          ),
          el('div', { style: { marginTop: '8px' } }, [
            UI.parts.asyncButton({
              label: 'Cek ulang otomatis',
              iconName: 'refresh',
              size: 'sm',
              busyLabel: 'Mengecek…',
              onClick: async () => {
                // Tombol sudah menampilkan "Mengecek…" sendiri; progres
                // live ditulis ke baris status lewat helper global.
                const live = globalThis.XMTDom.live;
                live.mount(progressHost);
                live.report('Cek: mulai…', { instant: true });
                const tick = setInterval(() => live.report(state.progress), 120);
                try {
                  await store.set(KEYS.TODO_OVERRIDES, {});
                  await load({ force: true });
                } finally {
                  // Hentikan tick DULU, baru tulis final tanpa throttle —
                  // kalau tidak, tick menimpa "selesai" dengan item terakhir.
                  clearInterval(tick);
                  live.reportNow('Cek: selesai.');
                }
                await renderTodoTab(region, panel);
              }
            })
          ]),
          progressHost
        ]
      }),

      pending.length > 0 && UI.parts.card({
        title: `Belum selesai (${pending.length})`,
        children: pending.map((todo) => renderTodoItem(todo, overrides, region, panel))
      }),

      done.length > 0 && UI.parts.card({
        title: `Selesai (${done.length})`,
        children: done.map((todo) => renderTodoItem(todo, overrides, region, panel))
      })
    ]);
  }

  function renderTodoItem(todo, overrides, region, panel) {
    // Pipeline: pre-test → fordis → post-test → kuesioner = DONE (fini).
    const steps = [
      todo.preTestDone && 'Pre ✓',
      todo.forumDone && 'Fordis ✓',
      todo.postTestDone && 'Post ✓',
      todo.surveyDone && 'Kuesioner ✓'
    ].filter(Boolean);
    const statusParts = [...steps];
    if (todo.done) statusParts.push('DONE — e-learning fini');

    return el('div', { class: 'xmt-item', style: { opacity: todo.done ? '0.6' : '1' } }, [
      el('div', { class: 'xmt-item-icon', dataset: { tone: todo.done ? 'success' : undefined } }, [
        icon(todo.done ? 'checkCircle' : 'forum')
      ]),
      el('div', { class: 'xmt-item-body' }, [
        el('span', { class: 'xmt-item-title', text: todo.title }),
        el('div', { class: 'xmt-item-meta' }, [
          el('span', { text: todo.courseName }),
          el('span', { text: todo.sectionName }),
          statusParts.length > 0 && el('span', {
            text: statusParts.join(' · '),
            style: { color: 'var(--xmt-accent)' }
          }),
          todo.overridden && el(
            'button',
            {
              type: 'button',
              class: 'xmt-badge',
              dataset: { tone: 'warning' },
              title: 'Kembalikan ke deteksi otomatis untuk item ini',
              style: { cursor: 'pointer' },
              on: {
                click: async (event) => {
                  event.stopPropagation();
                  const next = { ...overrides };
                  delete next[todo.key];
                  await store.set(KEYS.TODO_OVERRIDES, next);
                  await syncTodoList(state.courses);
                  renderTodoTab(region, panel);
                }
              }
            },
            ['manual — klik untuk lepas']
          )
        ].filter(Boolean))
      ]),
      el('div', { class: 'xmt-cluster' }, [
        el('button', {
          type: 'button',
          class: 'xmt-btn',
          dataset: { size: 'sm', variant: todo.done ? 'ghost' : 'accent' },
          title: todo.done ? 'Tandai belum selesai' : 'Tandai selesai',
          on: {
            click: async () => {
              const newOverrides = { ...overrides, [todo.key]: !todo.done };
              await store.set(KEYS.TODO_OVERRIDES, newOverrides);
              await syncTodoList(state.courses);
              renderTodoTab(region, panel);
            }
          }
        }, [icon(todo.done ? 'cancel' : 'check')]),
        todo.url && el('a', {
          class: 'xmt-btn',
          dataset: { size: 'sm' },
          href: todo.url,
          target: '_blank',
          rel: 'noopener noreferrer'
        }, [icon('external')])
      ])
    ]);
  }

  /* ------------------------------------------------------------- kendali */

  let panelRef = null;
  let buttonRef = null;

  async function refresh(panel, tabId) {
    const live = globalThis.XMTDom.live;
    live.mount(panelRef.root.querySelector('.xmt-panel-foot') ?? panelRef.root, { hidden: false });
    live.report('Muat ulang: mulai…', { instant: true });
    const tick = setInterval(() => live.report(state.progress), 120);
    try {
      await load({ force: true });
    } finally {
      clearInterval(tick);
      live.reportNow('Muat ulang: selesai.');
    }
    panel.refreshTab(tabId ?? 'forum');
    updateBadge();

    if (state.error) UI.toast(state.error, 'error');
    else UI.toast('Data diperbarui.', 'success');
  }

  function updateBadge() {
    if (!buttonRef) return;
    buttonRef.setBadge(collectPending(state.courses).length);
  }

  async function openPanel(tabId) {
    if (panelRef.isOpen) {
      panelRef.close();
      return;
    }

    panelRef.open(tabId);

    if (state.courses.length === 0 && !state.loading) {
      panelRef.loading('Mengambil data mata kuliah…', tabId ?? 'forum');
      await load();
      panelRef.refreshTab(tabId ?? 'forum');
      updateBadge();
    }
  }

  async function init() {
    if (!(await store.enabled('forumTracker'))) return;

    const showNotif = await store.enabled('lecturerNotif');

    const tabs = [
      { id: 'forum', label: 'Forum', render: renderForumTab },
      { id: 'todo', label: 'Todo', render: renderTodoTab }
    ];
    if (showNotif) tabs.push({ id: 'notif', label: 'Notifikasi', render: renderNotifTab });
    tabs.push({ id: 'students', label: 'Mahasiswa', render: renderStudentTab });
    tabs.push({ id: 'peer', label: 'Teman', render: renderPeerTab });

    panelRef = UI.panel({
      id: 'xmt-forum-panel',
      title: 'Forum Tracker',
      subtitle: 'MENTARI',
      iconName: 'forum',
      anchor: 'header',
      tabs,
      headActions: [
        UI.parts.asyncButton({
          label: 'Muat ulang',
          iconName: 'refresh',
          size: 'sm',
          busyLabel: 'Memuat…',
          onClick: () => refresh(panelRef)
        })
      ],
      footActions: [
        el('span', {
          class: 'xmt-text-xs',
          text: state.loadedAt ? `Diperbarui ${timeAgo(state.loadedAt)}` : ''
        })
      ]
    });

    buttonRef = UI.headerButton({
      id: 'xmt-forum-btn',
      title: 'X Mentari — Forum Tracker',
      iconName: 'forum',
      onClick: () => openPanel()
    });

    load().then(updateBadge);

    UI.registerOpener('forum', () => openPanel());

    window.XMTForum = {
      open: openPanel,
      refresh: () => refresh(panelRef),
      get pending() {
        return collectPending(state.courses).length;
      }
    };
  }

  init();
})();
