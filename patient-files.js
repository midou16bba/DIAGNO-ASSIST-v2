/*
 * patient-files.js — صفحة «ملفات المرضى»: القائمة، البحث، الترتيب، الإضافة، التعديل، الأرشفة، الحذف
 * يعتمد على patient-store.js (نفس مفاتيح localStorage في الموقع).
 */
(function () {
    'use strict';
    var S = window.PatientStore;
    if (!S) return;

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var state = { tab: 'active', q: '', sort: 'updated', editingId: null, confirmAction: null };
    var toastTimer = null;

    function toast(msg, type) {
        var t = $('toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'toast show' + (type ? ' ' + type : '');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
    }

    function visibleList() {
        var list = S.load();
        var q = state.q.trim().toLowerCase();
        var out = list.filter(function (p) {
            if (state.tab === 'active' && p.archived) return false;
            if (state.tab === 'archived' && !p.archived) return false;
            if (q) {
                var hay = (String(p.name || '') + ' ' + String(p.fileNum || '')).toLowerCase();
                if (hay.indexOf(q) < 0) return false;
            }
            return true;
        });
        out.sort(function (a, b) {
            if (state.sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
            var pa = state.sort === 'created' ? (a.createdAt || '') : (a.updatedAt || a.createdAt || '');
            var pb = state.sort === 'created' ? (b.createdAt || '') : (b.updatedAt || b.createdAt || '');
            if (pa === pb) return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
            return pb < pa ? -1 : (pb > pa ? 1 : 0); /* الأحدث أولًا */
        });
        return out;
    }

    function cardHTML(p) {
        var counts = S.sessionCounts(p.id);
        var initial = String(p.name || 'م').charAt(0);
        var meta = [];
        if (p.age) meta.push(esc(p.age));
        else if (p.birth) meta.push('تاريخ الميلاد: ' + esc(p.birth));
        if (p.sex) meta.push(esc(p.sex));
        if (p.openedAt) meta.push('فتح الملف: ' + esc(p.openedAt));
        return '<div class="file-card' + (p.archived ? ' archived' : '') + '" data-id="' + esc(p.id) + '">' +
            '<div class="fc-head">' +
            '<div class="fc-avatar">' + esc(initial) + '</div>' +
            '<div class="fc-id">' +
            '<div class="fc-name">' + esc(p.name) + '</div>' +
            '<span class="fc-code">' + esc(p.fileNum || '—') + '</span>' +
            '</div></div>' +
            '<div class="fc-badges">' +
            '<span class="badge ' + (p.archived ? 'arch' : 'active') + '">' + (p.archived ? 'مؤرشف' : 'نشط') + '</span>' +
            '<span class="badge sessions">' + counts.total + ' جلسة تقييم</span>' +
            (p.tag ? '<span class="badge">' + esc(p.tag) + '</span>' : '') +
            '</div>' +
            '<div class="fc-meta">' +
            (meta.length ? meta.join(' • ') : 'لا توجد بيانات إضافية') +
            '<br><b>الإنشاء:</b> ' + esc(S.fmtDate(p.createdAt || p.openedAt)) +
            ' — <b>آخر تحديث:</b> ' + esc(S.fmtDate(p.updatedAt || p.createdAt)) +
            '</div>' +
            '<div class="fc-actions">' +
            '<button class="fbtn open" data-act="open">فتح الملف ←</button>' +
            '<button class="fbtn" data-act="edit">تعديل</button>' +
            '<button class="fbtn ghost" data-act="archive">' + (p.archived ? 'استرجاع' : 'أرشفة') + '</button>' +
            '<button class="fbtn danger" data-act="delete">حذف</button>' +
            '</div></div>';
    }

    function render() {
        var grid = $('filesGrid'), empty = $('emptyState'), countLine = $('countLine');
        if (!grid) return;
        var list = visibleList();
        var total = S.load().length;
        grid.innerHTML = list.map(cardHTML).join('');
        if (countLine) countLine.textContent = list.length
            ? ('عرض ' + list.length + ' من أصل ' + total + ' ملف')
            : (total ? 'لا نتائج مطابقة' : '');
        if (empty) {
            if (list.length) { empty.style.display = 'none'; }
            else {
                empty.style.display = 'block';
                var noData = !total;
                $('emptyTitle').textContent = noData ? 'لا توجد ملفات مرضى بعد' : 'لا نتائج مطابقة لبحثك';
                $('emptyText').textContent = noData
                    ? 'ابدأ بإنشاء أول ملف مريض لربط جلسات التقييم ونتائجها بهذا الملف.'
                    : 'جرّب كلمة بحث أخرى أو غيّر تبويب العرض أو ترتيب الملفات.';
                $('btnEmptyNew').style.display = noData ? '' : 'none';
            }
        }
        if (grid.style) grid.style.display = list.length ? '' : 'none';
    }

    /* ===== نموذج الإضافة/التعديل ===== */
    function openForm(id) {
        state.editingId = id || null;
        var err = $('formError'); if (err) { err.className = 'form-error'; err.textContent = ''; }
        if (id) {
            var p = S.get(id);
            if (!p) { toast('الملف غير موجود.', 'err'); return; }
            $('formTitle').textContent = '✏️ تعديل ملف المريض';
            $('formSub').textContent = 'رمز الملف ثابت ولا يمكن تغييره للحفاظ على ترابط الجلسات القديمة.';
            $('fFileNum').value = p.fileNum || '';
            $('fName').value = p.name || '';
            $('fAge').value = p.age || p.birth || '';
            $('fSex').value = p.sex || '';
            $('fOpened').value = p.openedAt || '';
            $('fPhone').value = p.phone || '';
            $('fNotes').value = p.notes || '';
        } else {
            $('formTitle').textContent = '＋ إضافة ملف جديد';
            $('formSub').textContent = 'يُنشأ رمز الملف تلقائيًا ويكون فريدًا. الحقول المطلوبة فقط: الاسم أو الاسم المستعار.';
            $('fFileNum').value = S.uniqueFileNum();
            $('fName').value = '';
            $('fAge').value = '';
            $('fSex').value = '';
            $('fOpened').value = S.todayStr();
            $('fPhone').value = '';
            $('fNotes').value = '';
        }
        var m = $('formModal'); if (m) m.classList.add('show');
        var n = $('fName'); if (n) setTimeout(function () { try { n.focus(); } catch (e) { } }, 60);
    }

    function closeForm() { var m = $('formModal'); if (m) m.classList.remove('show'); }

    function showFormError(msg) {
        var err = $('formError');
        if (err) { err.textContent = msg; err.className = 'form-error show'; }
        toast(msg, 'err');
    }

    function saveForm() {
        var data = {
            name: $('fName').value,
            age: $('fAge').value.trim(),
            sex: $('fSex').value,
            openedAt: $('fOpened').value.trim(),
            phone: $('fPhone').value.trim(),
            notes: $('fNotes').value.trim()
        };
        /* يقبل تاريخ ميلاد في نفس حقل العمر/تاريخ الميلاد */
        if (/\d{4}|\d{1,2}\/\d{1,2}\/\d{1,4}/.test(data.age) && !/\d\s*سنة/.test(data.age)) data.birth = data.age;
        var errors = S.validate(data);
        if (errors.length) { showFormError(errors[0]); return; }
        var r;
        if (state.editingId) r = S.update(state.editingId, data);
        else {
            data.fileNum = $('fFileNum').value.trim();
            r = S.create(data);
        }
        if (!r.ok) { showFormError(r.error || 'تعذّر حفظ الملف.'); return; }
        closeForm();
        render();
        toast(state.editingId ? ('✓ تم تحديث ملف: ' + r.patient.name) : ('✓ تم إنشاء الملف — رمز: ' + r.patient.fileNum), 'ok');
        state.editingId = null;
    }

    /* ===== نافذة التأكيد ===== */
    function openConfirm(opts) {
        state.confirmAction = opts.onYes || null;
        $('confirmTitle').textContent = opts.title || 'تأكيد';
        $('confirmText').innerHTML = opts.text || '';
        $('confirmWarn').innerHTML = opts.warn || '';
        $('confirmYes').textContent = opts.okLabel || 'تأكيد';
        var m = $('confirmModal'); if (m) m.classList.add('show');
    }
    function closeConfirm() {
        var m = $('confirmModal'); if (m) m.classList.remove('show');
        state.confirmAction = null;
    }

    function askArchive(p) {
        if (p.archived) {
            openConfirm({
                title: 'استرجاع الملف',
                text: 'هل تريد استرجاع الملف <b>' + esc(p.name) + '</b> (' + esc(p.fileNum) + ') وجعله نشطًا مجددًا؟ الجلسات المرتبطة تبقى محفوظة.',
                okLabel: 'استرجاع',
                onYes: function () {
                    var r = S.setArchived(p.id, false);
                    closeConfirm(); render();
                    toast(r.ok ? '✓ تم استرجاع الملف.' : (r.error || 'تعذّر الاسترجاع'), r.ok ? 'ok' : 'err');
                }
            });
            return;
        }
        openConfirm({
            title: 'أرشفة الملف',
            text: 'سيتم نقل الملف <b>' + esc(p.name) + '</b> (' + esc(p.fileNum) + ') إلى المؤرشفة. يمكنك استرجاعه لاحقًا، وجلساته لا تُحذف.',
            okLabel: 'أرشفة',
            onYes: function () {
                var r = S.setArchived(p.id, true);
                closeConfirm(); render();
                toast(r.ok ? '✓ تم أرشفة الملف.' : (r.error || 'تعذّر الأرشفة'), r.ok ? 'ok' : 'err');
            }
        });
    }

    function askDelete(p) {
        var c = S.sessionCounts(p.id);
        var warn = '';
        if (c.total > 0) {
            var lines = [];
            if (c.ptsd) lines.push('جلسات مقياس PTSD: <b>' + c.ptsd + '</b>');
            if (c.mdd) lines.push('جلسات مقياس الاكتئاب: <b>' + c.mdd + '</b>');
            if (c.custom) lines.push('جلسات مقاييس مخصصة: <b>' + c.custom + '</b>' + (c.names.length ? ' (' + esc(c.names.join('، ')) + ')' : ''));
            warn = '<div class="warn-list">⚠️ <b>تحذير:</b> حذف هذا الملف سيحذف نهائيًا <b>' + c.total + '</b> جلسة تقييم ونتائجها ومسوداته:<br>' +
                lines.join('<br>') + '<br>لا يمكن التراجع عن هذا الإجراء. إن أردت الاحتفاظ بالسجل يمكنك استخدام «أرشفة» بدلًا من الحذف.</div>';
        } else {
            warn = '<div class="warn-list">لا توجد جلسات تقييم مرتبطة بهذا الملف. الحذف نهائي ولا يمكن التراجع عنه.</div>';
        }
        openConfirm({
            title: 'تأكيد حذف الملف',
            text: 'هل أنت متأكد من حذف الملف <b>' + esc(p.name) + '</b> (' + esc(p.fileNum) + ')؟',
            warn: warn,
            okLabel: c.total > 0 ? ('حذف الملف و' + c.total + ' جلسات') : 'حذف الملف',
            onYes: function () {
                var r = S.remove(p.id);
                closeConfirm(); render();
                if (r.ok) toast('✓ تم حذف الملف' + (r.removed && r.removed.total ? (' و' + r.removed.total + ' جلسة مرتبطة') : '') + '.', 'ok');
                else toast(r.error || 'تعذّر الحذف.', 'err');
            }
        });
    }

    /* ===== الربط ===== */
    function bind() {
        var grid = $('filesGrid');
        if (grid) {
            grid.onclick = function (e) {
                var t = e.target;
                var btn = t && t.closest ? t.closest('[data-act]') : null;
                if (!btn) return;
                var card = btn.closest('.file-card');
                if (!card) return;
                var p = S.get(card.getAttribute('data-id'));
                if (!p) return;
                var act = btn.getAttribute('data-act');
                if (act === 'open') location.href = 'patient-file.html?id=' + encodeURIComponent(p.id);
                else if (act === 'edit') openForm(p.id);
                else if (act === 'archive') askArchive(p);
                else if (act === 'delete') askDelete(p);
            };
        }
        var search = $('searchInput');
        if (search) search.addEventListener('input', function () { state.q = this.value; render(); });
        var sort = $('sortSelect');
        if (sort) sort.addEventListener('change', function () { state.sort = this.value; render(); });
        var tabs = document.querySelectorAll ? document.querySelectorAll('.tab') : [];
        for (var i = 0; i < tabs.length; i++) {
            (function (tab) {
                tab.onclick = function () {
                    state.tab = tab.getAttribute('data-tab');
                    var all = document.querySelectorAll('.tab');
                    for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
                    tab.classList.add('active');
                    render();
                };
            })(tabs[i]);
        }
        var bNew = $('btnNewFile'); if (bNew) bNew.onclick = function () { openForm(null); };
        var bEmpty = $('btnEmptyNew'); if (bEmpty) bEmpty.onclick = function () { openForm(null); };
        var bSave = $('btnSaveFile'); if (bSave) bSave.onclick = function (e) { if (e && e.preventDefault) e.preventDefault(); saveForm(); };
        var bCancel = $('btnCancelFile'); if (bCancel) bCancel.onclick = function () { closeForm(); };
        var form = $('patientForm');
        if (form) form.onsubmit = function (e) { if (e && e.preventDefault) e.preventDefault(); saveForm(); return false; };
        var cYes = $('confirmYes'); if (cYes) cYes.onclick = function () { var a = state.confirmAction; if (typeof a === 'function') a(); else closeConfirm(); };
        var cNo = $('confirmNo'); if (cNo) cNo.onclick = function () { closeConfirm(); };
        var fm = $('formModal');
        if (fm) fm.addEventListener('click', function (e) { if (e.target === fm) closeForm(); });
        var cm = $('confirmModal');
        if (cm) cm.addEventListener('click', function (e) { if (e.target === cm) closeConfirm(); });

        var btn = $('authBtn');
        if (btn) {
            var u = null;
            try { u = JSON.parse(localStorage.getItem('diagUser') || 'null'); } catch (e) { }
            if (u) { btn.textContent = (u.isAdmin ? '👨‍💼 ' : '👤 ') + (u.isAdmin ? 'المدير' : u.name); btn.onclick = function () { location.href = 'profile.html'; }; }
            else btn.onclick = function () { location.href = 'login.html'; };
        }
    }

    function init() { bind(); render(); }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    /* للتجربة والاختبار من الوحدات */
    window.__patientFiles = { state: state, render: render, openForm: openForm, saveForm: saveForm, askDelete: askDelete, askArchive: askArchive, visibleList: visibleList };
})();
