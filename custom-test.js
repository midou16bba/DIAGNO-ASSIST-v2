(function () {
    'use strict';
    var E = window.ScaleEngine;
    if (!E) return;

    var state = { scale: null, answers: {}, pid: 'guest', pname: '', lastResult: null, restored: false };

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function param(k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null; }
    function fmt(n) { return (typeof n === 'number' && Math.round(n) !== n) ? Number(n.toFixed(4)) : n; }
    function answeredCount() { var c = 0; for (var k in state.answers) if (state.answers[k] !== null && state.answers[k] !== undefined) c++; return c; }

    var toastTimer = null;
    function toast(msg, kind) {
        var el = $('toast');
        el.className = 'toast show' + (kind ? ' ' + kind : '');
        el.textContent = msg;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
    }

    function init() {
        document.addEventListener('click', onClick);
        (function () {
            var b = $('authBtn');
            var u = null;
            try { u = JSON.parse(localStorage.getItem('diagUser') || 'null'); } catch (e) { }
            if (u) { b.textContent = (u.isAdmin ? '👨‍💼 ' : '👤 ') + (u.isAdmin ? 'المدير' : u.name); b.onclick = function () { location.href = 'profile.html'; }; }
            else b.onclick = function () { location.href = 'login.html'; };
        })();

        var id = param('id') || localStorage.getItem('chosenCustomScale');
        var scale = id ? E.getScale(id) : null;
        if (!scale) { renderPicker(); return; }
        var v = E.validateScale(scale);
        if (v.errors.length) { renderBroken(scale, v.errors); return; }

        state.scale = scale;
        var AP = null;
        try { AP = JSON.parse(localStorage.getItem('diagActivePatient') || 'null'); } catch (e) { }
        state.pid = AP && AP.id !== undefined && AP.id !== null && AP.id !== '' ? String(AP.id) : 'guest';
        state.pname = AP && AP.name ? AP.name : '';
        localStorage.setItem('chosenCustomScale', scale.id);

        var d = E.loadDraft(scale.id, state.pid);
        if (d && d.answers && typeof d.answers === 'object') {
            for (var k in d.answers) {
                var i = Number(k);
                var opts = E.optionsFor(scale, i);
                var val = d.answers[k];
                if (opts.length && val !== null && val !== undefined && val >= 0 && val < opts.length) state.answers[i] = Number(val);
            }
            state.restored = answeredCount() > 0;
        }
        renderAll();
    }

    function renderAll() {
        var s = state.scale;
        $('scaleName').textContent = s.name + (state.pname ? ' — ملف: ' + state.pname : '');
        $('scaleDesc').textContent = s.description || s.targetGroup || '';
        $('infoCard').style.display = 'block';
        $('testCard').style.display = 'block';
        $('pickerCard').style.display = 'none';

        var dom = E.domainOf(s);
        var chips = '<span class="chip">' + s.items.length + ' بنود</span>' +
            '<span class="chip">' + esc(E.methodLabel(E.effectiveMethod(s))) + '</span>' +
            '<span class="chip">النطاق ' + fmt(dom.min) + ' - ' + fmt(dom.max) + '</span>' +
            '<span class="chip">الإكمال: ' + esc(E.MISSING_LABELS[s.missingPolicy.type]) + '</span>' +
            '<span class="chip">v' + (s.version || 1) + '</span>';
        chips += state.pname
            ? '<span class="chip patient">المريض: ' + esc(state.pname) + '</span>'
            : '<span class="chip patient">تطبيق بدون ملف مريض نشط</span>';
        $('infoChips').innerHTML = chips;

        if (s.instructions) {
            $('instrBox').style.display = 'block';
            $('instrBox').innerHTML = '<b>تعليمات التطبيق:</b> ' + esc(s.instructions);
        } else $('instrBox').style.display = 'none';

        var notice = '';
        if (state.restored) notice += '<div class="notice info">تم استرجاع إجابات محفوظة من مسودة سابقة — راجعها ثم احسب النتيجة. <b>(المسودة تُحفظ تلقائيًا)</b></div>';
        $('noticeBox').innerHTML = notice;

        renderQuestions();
        updateProgress();
    }

    function renderQuestions() {
        var s = state.scale, html = '';
        for (var i = 0; i < s.items.length; i++) {
            var opts = E.optionsFor(s, i);
            var sel = state.answers[i];
            var isAns = sel !== undefined && sel !== null;
            html += '<div class="question-card' + (isAns ? ' answered' : '') + '">' +
                '<div class="tq-header"><div class="tq-num">' + (i + 1) + '</div>' +
                '<div class="tq-text">' + esc(s.items[i].text || ('بند ' + (i + 1))) + '</div></div>' +
                '<div class="answers-row">';
            for (var j = 0; j < opts.length; j++) {
                html += '<button data-act="answer" data-item="' + i + '" data-opt="' + j + '" title="قيمة هذا الخيار: ' + fmt(opts[j].score) + '"' +
                    (isAns && sel === j ? ' class="sel"' : '') + '>' + esc(opts[j].label) + '</button>';
            }
            html += '</div></div>';
        }
        $('questions').innerHTML = html;
    }

    function updateProgress() {
        var total = state.scale.items.length;
        var done = answeredCount();
        var el = $('questCount');
        el.textContent = done + ' / ' + total;
        el.classList.toggle('done', done === total && total > 0);
        var pct = total ? (done / total) * 100 : 0;
        var fill = $('progressFill');
        fill.style.width = pct + '%';
        fill.classList.toggle('complete', done === total && total > 0);
    }

    function saveDraft() {
        try { E.saveDraft(state.scale.id, state.pid, state.answers); } catch (e) { }
    }

    function onClick(e) {
        var el = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!el) return;
        var act = el.getAttribute('data-act');
        if (act === 'answer') {
            var i = parseInt(el.getAttribute('data-item'), 10);
            var j = parseInt(el.getAttribute('data-opt'), 10);
            state.answers[i] = j;
            state.lastResult = null;
            $('resPanel').className = 'res-panel';
            $('resPanel').innerHTML = '';
            saveDraft();
            renderQuestions();
            updateProgress();
            return;
        }
        if (act === 'calc') { calc(false); return; }
        if (act === 'save') { calc(true); return; }
        if (act === 'clear') {
            if (!confirm('مسح جميع الإجابات والمسودة المحفوظة؟')) return;
            state.answers = {};
            state.lastResult = null;
            state.restored = false;
            E.clearDraft(state.scale.id, state.pid);
            $('resPanel').className = 'res-panel';
            $('resPanel').innerHTML = '';
            $('noticeBox').innerHTML = '';
            renderQuestions();
            updateProgress();
            toast('تم مسح الإجابات.', 'ok');
            return;
        }
        if (act === 'pick') {
            location.href = 'custom-test.html?id=' + encodeURIComponent(el.getAttribute('data-id'));
            return;
        }
    }

    function calc(forSave) {
        var s = state.scale;
        var comp = E.checkCompleteness(s, state.answers);
        if (!comp.ok) {
            $('resPanel').className = 'res-panel show';
            $('resPanel').innerHTML = '<div class="val-box val-warn"><h5>⚠️ الإجابة غير مكتملة</h5>' + esc(comp.reason || 'أكمل البنود المطلوبة أولًا.') +
                ' — المجاب: ' + answeredCount() + ' من ' + s.items.length + '.</div>';
            $('resPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (forSave) toast('لا يمكن الحفظ قبل استيفاء شروط الإكمال.', 'bad');
            return;
        }
        var r = E.compute(s, state.answers);
        if (!r.ok) {
            $('resPanel').className = 'res-panel show';
            $('resPanel').innerHTML = '<div class="val-box val-err"><h5>⛔ تعذّر الحساب</h5><ul>' +
                r.errors.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
            return;
        }
        state.lastResult = r;
        if (forSave) {
            var sessions = E.loadSessions(s.id, state.pid);
            var num = sessions.length + 1;
            var dateStr = new Date().getDate() + '/' + (new Date().getMonth() + 1) + '/' + new Date().getFullYear();
            var sess = E.makeSession(r, s, num, dateStr);
            var add = E.addSession(s.id, state.pid, sess);
            if (!add.ok) { toast(add.error || 'تعذّر حفظ الجلسة.', 'bad'); return; }
            E.clearDraft(s.id, state.pid);
            localStorage.setItem('chosenCustomScale', s.id);
            location.href = 'custom-results.html?id=' + encodeURIComponent(s.id);
            return;
        }
        var panel = $('resPanel');
        panel.className = 'res-panel show';
        panel.innerHTML = resultHtml(r, s);
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function resultHtml(r, s) {
        var color = r.category && r.category.color ? r.category.color : '#2563eb';
        var scoreStr = r.score === null || r.score === undefined ? '—' : fmt(r.score);
        var html = '<div class="result-main">' +
            '<div class="score-circle" style="background:' + esc(color) + '"><span class="v">' + esc(scoreStr) + '</span><span class="l">' + (r.avg !== null && r.avg !== undefined ? 'متوسط' : 'الدرجة') + '</span></div>' +
            '<div class="result-meta"><h4>' + (r.category ? esc(r.category.label) : 'بلا فئة تفسير') + '</h4>' +
            '<p>الدرجة الخام: <b>' + esc(fmt(r.raw)) + '</b> — النطاق ' + esc(fmt(r.min)) + ' إلى ' + esc(fmt(r.max)) +
            ' — المجاب: ' + r.answered + ' من ' + r.total + (r.missing ? ' (المفقود ' + r.missing + ')' : '') +
            (r.pct !== null && r.pct !== undefined ? ' — النسبة ' + esc(fmt(r.pct)) + '%' : '') + '</p>';
        if (r.stateLabel) html += '<p>التصنيف: <b>' + esc(r.stateLabel) + '</b></p>';
        if (r.standard && r.standard.available) html += '<p>الدرجة المعيارية: <b>' + esc(fmt(r.standard.value)) + '</b> (' + esc(E.STANDARD_TYPE_LABELS[s.standard.type] || s.standard.type) + ')</p>';
        else if (r.standard && r.standard.available === false && r.standard.reason) html += '<p>المعيار المعياري: ' + esc(r.standard.reason) + '</p>';
        html += '</div></div>';

        if (r.dimensions && r.dimensions.length) {
            html += '<div class="dim-bars">';
            for (var d = 0; d < r.dimensions.length; d++) {
                var dm = r.dimensions[d];
                var w = (dm.max > dm.min) ? Math.max(2, Math.min(100, ((dm.score - dm.min) / (dm.max - dm.min)) * 100)) : 50;
                html += '<div class="dim-bar"><span class="nm">' + esc(dm.name || ('بُعد ' + (d + 1))) + '</span>' +
                    '<span class="track"><span class="fill" style="width:' + w + '%"></span></span>' +
                    '<span class="vv">' + esc(fmt(dm.score)) + (dm.category ? ' · ' + esc(dm.category.label) : '') + '</span></div>';
            }
            html += '</div>';
        }
        if (r.notes && r.notes.length) {
            html += '<div class="notes">';
            for (var n = 0; n < r.notes.length; n++) html += '<div>• ' + esc(r.notes[n]) + '</div>';
            html += '</div>';
        }
        html += '<div class="val-box val-ok"><h5>✅ جاهز للحفظ</h5>اضغط "حفظ الجلسة والمتابعة" لتسجيل هذه الجلسة وعرضها في صفحة النتائج.</div>';
        return html;
    }

    function renderPicker() {
        $('pickerCard').style.display = 'block';
        $('infoCard').style.display = 'none';
        $('testCard').style.display = 'none';
        $('scaleName').textContent = 'اختر مقياسًا مخصصًا';
        $('scaleDesc').textContent = 'لم يُحدد مقياس للتطبيق — اختر واحدًا من المقاييس المنشورة أو أنشئ مقياسًا جديدًا.';
        var list = E.loadScales();
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            var v = E.validateScale(s);
            if (v.errors.length) continue;
            html += '<button class="picker-item" data-act="pick" data-id="' + esc(s.id) + '">' +
                '<h4>' + esc(s.name) + '</h4>' +
                '<div class="meta">' + s.items.length + ' بنود · ' + esc(E.methodLabel(s.scoring.method)) + ' · v' + (s.version || 1) + '</div></button>';
        }
        if (!html) html = '<div class="notice err">لا توجد مقاييس مخصصة منشورة بعد. <a href="scale-builder.html" style="color:#b45309">أنشئ مقياسًا من المنشئ ←</a></div>';
        $('pickerList').innerHTML = html;
    }

    function renderBroken(scale, errors) {
        $('scaleName').textContent = scale.name || 'مقياس غير مكتمل';
        $('scaleDesc').textContent = '';
        $('pickerCard').style.display = 'block';
        $('infoCard').style.display = 'none';
        $('testCard').style.display = 'none';
        $('pickerList').innerHTML = '<div class="notice err"><b>لا يمكن تطبيق هذا المقياس — ' + errors.length + ' أخطاء:</b><ul style="padding-right:20px;margin-top:6px">' +
            errors.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
            '<a href="scale-builder.html?id=' + esc(scale.id) + '" style="color:#b45309;font-weight:900">إصلاح الأخطاء في المنشئ ←</a></div>';
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
