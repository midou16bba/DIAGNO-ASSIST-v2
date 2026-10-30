(function () {
    'use strict';
    var E = window.ScaleEngine;
    if (!E) return;

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function param(k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null; }
    function fmt(n) { return (typeof n === 'number' && Math.round(n) !== n) ? Number(n.toFixed(4)) : n; }
    function num(v) { return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v); }

    function init() {
        (function () {
            var b = $('authBtn');
            var u = null;
            try { u = JSON.parse(localStorage.getItem('diagUser') || 'null'); } catch (e) { }
            if (u) { b.textContent = (u.isAdmin ? '👨‍💼 ' : '👤 ') + (u.isAdmin ? 'المدير' : u.name); b.onclick = function () { location.href = 'profile.html'; }; }
            else b.onclick = function () { location.href = 'login.html'; };
        })();

        var id = param('id') || localStorage.getItem('chosenCustomScale');
        var scale = id ? E.getScale(id) : null;
        var AP = null;
        try { AP = JSON.parse(localStorage.getItem('diagActivePatient') || 'null'); } catch (e) { }
        var pid = AP && AP.id !== undefined && AP.id !== null && AP.id !== '' ? String(AP.id) : 'guest';
        var pname = AP && AP.name ? AP.name : '';

        var sessions = id ? E.loadSessions(id, pid) : [];
        if (!sessions.length) {
            $('resTitle').textContent = 'لا توجد نتائج بعد';
            $('resSub').textContent = 'ستظهر هنا بعد حفظ أول جلسة تطبيق لهذا المقياس.';
            $('heroStats').innerHTML = '';
            $('mainBox').innerHTML = '<div class="card"><div class="empty">' +
                (scale
                    ? 'هذا المقياس جاهز — <a href="custom-test.html?id=' + esc(id) + '">ابدأ التطبيق الآن ←</a>'
                    : 'لم يُختر مقياس بعد — <a href="tools-severity-scale.html">اختر مقياسًا ←</a>') +
                '</div></div>';
            return;
        }

        var latest = sessions[sessions.length - 1];
        var prev = sessions.length > 1 ? sessions[sessions.length - 2] : null;
        var scaleName = latest.scaleName || (scale ? scale.name : 'مقياس مخصص');
        var sum = null;
        try { sum = E.summarize(latest); } catch (e) { sum = null; }
        if (!sum) sum = { dims: [], items: [], topItems: [], lowItems: [], zones: [], notes: [], warnings: [] };

        $('resTitle').textContent = scaleName + (pname ? ' — ملف: ' + pname : '');
        $('resSub').textContent = 'جلسة رقم ' + latest.number + ' — ' + latest.date + ' — الإصدار v' + (latest.scaleVersion || 1);

        /* ==== شريط إحصاءات الهيدر (نفس آلية charts.html) ==== */
        var catLabel = sum.category ? sum.category.label : (latest.state || '—');
        var catColor = sum.category ? sum.category.color : (latest.color || '#2563eb');
        $('heroStats').innerHTML =
            '<div class="hero-stat"><span class="stat-icon">📋</span><div><span class="stat-label">النسبة</span><span class="stat-value">' + (num(latest.pct) === null ? '—' : fmt(latest.pct) + '%') + '</div></div>' +
            '<div class="hero-stat"><span class="stat-icon">🔬</span><div><span class="stat-label">الجلسات</span><span class="stat-value">' + sessions.length + '</div></div>' +
            '<div class="hero-stat"><span class="stat-icon">📅</span><div><span class="stat-label">آخر جلسة</span><span class="stat-value">' + esc(latest.date) + '</div></div>' +
            '<div class="hero-stat"><span class="stat-icon">⚡</span><div><span class="stat-label">الشدة</span><span class="stat-value">' + esc(catLabel) + '</div></div>';

        var html = '';
        var chartPending = false;

        /* شريط الشارات */
        html += '<div class="card"><div class="chips">' +
            '<span class="chip">' + esc(sum.methodLabel || latest.methodLabel || '') + '</span>' +
            '<span class="chip">الجلسة ' + latest.number + ' من ' + sessions.length + '</span>' +
            '<span class="chip">' + esc(latest.date) + '</span>' +
            '<span class="chip">v' + (latest.scaleVersion || 1) + '</span>' +
            '<span class="chip patient">' + (pname ? esc(pname) : 'تطبيق بدون ملف مريض') + '</span>';
        var sc = num(latest.pct), pc = prev ? num(prev.pct) : null;
        if (sc !== null && pc !== null) {
            var diff = Math.round((sc - pc) * 100) / 100;
            html += '<span class="chip ' + (diff > 0 ? 'trend-up' : (diff < 0 ? 'trend-down' : '')) + '">' +
                (diff > 0 ? '▲ +' + fmt(diff) + '%' : (diff < 0 ? '▼ ' + fmt(diff) + '%' : '— بدون تغيير')) + ' عن الجلسة السابقة</span>';
        }
        html += '</div>';
        if (scale && scale.version && latest.scaleVersion && scale.version !== latest.scaleVersion) {
            html += '<div class="val-box val-warn">المقياس حُدّث لاحقًا إلى v' + scale.version + ' — هذه النتيجة محسوبة ومخزنة بنسخة وقت التطبيق v' + latest.scaleVersion + ' (كما هي في النسخة المحفوظة).</div>';
        }
        html += '</div>';

        /* بطاقة الشدة العامة */
        var scoreStr = num(latest.score) === null ? '—' : fmt(latest.score);
        html += '<div class="card">' +
            '<div class="card-title">📋 شدة الاضطراب</div>' +
            '<div class="overview">' +
            '<div class="score-circle" style="background:' + esc(catColor) + '"><span class="v">' + esc(scoreStr) + '</span><span class="l">' + (num(latest.avg) !== null ? 'متوسط' : 'الدرجة') + '</span></div>' +
            '<div class="overview-text">' +
            '<div class="big-score">' + (num(latest.pct) === null ? '—' : fmt(latest.pct) + '%') + '</div>' +
            '<div class="severity-badge" style="background:' + esc(catColor) + '22;color:' + esc(catColor) + '">' + esc(catLabel) + '</div>' +
            '<div class="desc">آخر نتيجة مسجلة من جلسة رقم ' + latest.number + ' — الدرجة الخام <b>' + esc(fmt(latest.raw)) + '</b> ضمن النطاق ' + esc(fmt(latest.min)) + ' إلى ' + esc(fmt(latest.max)) + ' — المجاب: ' + latest.answered + ' من ' + latest.total + '.</div>' +
            '</div></div>';

        html += '<div class="stat-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:18px">' +
            stat('النسبة المئوية', num(latest.pct) === null ? '—' : fmt(latest.pct) + '%') +
            (num(latest.avg) !== null ? stat('المتوسط', fmt(latest.avg)) : '') +
            stat('المجابة', latest.answered + ' / ' + latest.total) +
            stat('المفقود', latest.missing === null || latest.missing === undefined ? 0 : latest.missing) +
            stat('الجلسة', latest.number) +
            stat('الإصدار', 'v' + (latest.scaleVersion || 1)) +
            '</div>';
        if (num(latest.standard) !== null && latest.standard && latest.standard.available) {
            html += '<div class="val-box val-ok"><b>الدرجة المعيارية:</b> ' + esc(fmt(latest.standard.value)) + '</div>';
        }
        html += '</div>';

        /* بطاقة الأبعاد المرتبة */
        var dims = sum.dims || [];
        if (dims.length) {
            var dimColors = ['#dc2626', '#d97706', '#2563eb', '#8b5cf6', '#16a34a', '#06b6d4', '#f59e0b', '#ec4899'];
            var dimHtml = '<div class="card"><div class="card-title">🎯 الأبعاد الأكثر بروزًا</div><div class="dim-list">';
            for (var d = 0; d < dims.length; d++) {
                var dm = dims[d];
                var c = dimColors[d % dimColors.length];
                dimHtml += '<div class="dim-item">' +
                    '<div class="dim-rank" style="background:' + c + '">' + (d + 1) + '</div>' +
                    '<div class="dim-info"><div class="dim-name">' + esc(dm.name) + '</div>' +
                    '<div class="dim-bar-wrap"><div class="dim-bar" style="width:' + dm.pct + '%;background:linear-gradient(90deg,' + c + ',' + c + 'cc)"></div></div></div>' +
                    '<div class="dim-score">' + dm.pct + '%<div class="dim-sub">' + esc(fmt(dm.score)) + (dm.category ? ' · ' + esc(dm.category.label) : '') + '</div></div>' +
                    '</div>';
            }
            dimHtml += '</div><div class="info-box" style="margin-top:14px">💡 كل بُعد يُحسب كنسبة من نطاقه الممكن (' + esc(fmt(dims[0].min)) + ' إلى ' + esc(fmt(dims[0].max)) + ') وفق إعدادات المقياس. الأبعاد الأعلى هي الأكثر بروزًا في إجابات الجلسة.</div></div>';
            html += dimHtml;

            var top3 = '<div class="card"><div class="card-title">🏆 أبرز 3 أبعاد</div><div class="dim-list">';
            var medals = ['🥇', '🥈', '🥉'];
            for (var t = 0; t < Math.min(3, dims.length); t++) {
                top3 += '<div class="dim-item">' +
                    '<div class="dim-rank" style="background:#2563eb;font-size:1.1rem">' + medals[t] + '</div>' +
                    '<div class="dim-info"><div class="dim-name">' + esc(dims[t].name) + '</div></div>' +
                    '<div class="dim-score" style="color:#2563eb">' + dims[t].pct + '%</div>' +
                    '</div>';
            }
            top3 += '</div></div>';
            html += top3;
        }

        /* بطاقة أعلى/أدنى البنود (تحليل ديناميكي من الإجابات) */
        var topItems = sum.topItems || [], lowItems = sum.lowItems || [];
        if (topItems.length) {
            var itHtml = '<div class="card"><div class="card-title">📊 نقاط الارتفاع والانخفاض في البنود</div>';
            itHtml += '<div class="section-sub" style="font-size:.85rem;font-weight:800;color:#16a34a;margin-bottom:8px">أعلى 3 بنود (نسبة من درجتها القصوى)</div><div class="dim-list">';
            for (var ti = 0; ti < topItems.length; ti++) {
                itHtml += itemRow(topItems[ti], '#16a34a', ti + 1);
            }
            itHtml += '</div><div class="section-sub" style="font-size:.85rem;font-weight:800;color:#dc2626;margin:16px 0 8px">أدنى 3 بنود (نسبة من درجتها القصوى)</div><div class="dim-list">';
            for (var li = 0; li < lowItems.length; li++) {
                itHtml += itemRow(lowItems[li], '#dc2626', li + 1);
            }
            itHtml += '</div><div class="info-box" style="margin-top:14px">💡 نسب البنود محسوبة من إجابات هذه الجلسة مقابل نطاق كل بند وفق تعريف المقياس وقت التطبيق — تتغير تلقائيًا عند تغيير الإجابات.</div></div>';
            html += itHtml;
        }

        /* بطاقة التطور عبر الجلسات */
        html += '<div class="card"><div class="card-title">📈 تطور النسبة عبر الجلسات</div>' +
            '<div class="chart-wrap"><canvas id="trendChart"></canvas></div>' +
            '<div id="trendMessage"></div></div>';
        chartPending = true;

        /* بطاقة آخر نتيجة */
        var diffHtml = '';
        if (prev) {
            var d2 = (num(latest.pct) || 0) - (num(prev.pct) || 0);
            var arrow = '', cls = '', txt = '';
            if (d2 > 0) { arrow = '↑'; cls = 'up'; txt = 'ارتفاع'; }
            else if (d2 < 0) { arrow = '↓'; cls = 'down'; txt = 'انخفاض'; }
            else { arrow = '→'; cls = 'stable'; txt = 'لا تغير'; }
            diffHtml = '<div class="last-diff ' + cls + '">' + arrow + ' ' + txt + ' ' + Math.abs(Math.round(d2 * 100) / 100) + '%</div>';
        }
        html += '<div class="card"><div class="card-title">📋 آخر نتيجة</div>' +
            '<div class="last-result">' +
            '<div class="last-score">' + (num(latest.pct) === null ? '—' : fmt(latest.pct) + '%') + '</div>' +
            '<div class="severity-badge" style="background:' + esc(catColor) + '22;color:' + esc(catColor) + ';display:inline-block;padding:5px 16px;border-radius:20px;font-size:.85rem;font-weight:700">' + esc(catLabel) + '</div>' +
            diffHtml + '</div></div>';

        /* بطاقة التفسير الديناميكي */
        html += '<div class="card"><div class="card-title">💡 ماذا تعني نتيجتك؟</div><div class="info-box">' + interpretation(sum, sessions, latest) + '</div>';
        if (sum.notes && sum.notes.length) {
            html += '<div class="notes">';
            for (var n = 0; n < sum.notes.length; n++) html += '<div>• ' + esc(sum.notes[n]) + '</div>';
            html += '</div>';
        }
        if (sum.warnings && sum.warnings.length) {
            html += '<div class="val-box val-warn"><b>تنبيهات:</b><ul>' + sum.warnings.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
        }
        html += '</div>';

        /* جدول إجابات الجلسة */
        if (latest.answers && latest.answers.length) {
            html += '<div class="card"><div class="card-title">📝 إجابات الجلسة ' + latest.number + '</div><div class="table-scroll"><table><thead><tr>' +
                '<th>#</th><th>العبارة</th><th>الخيار المختار</th><th>الدرجة</th></tr></thead><tbody>';
            for (var a = 0; a < latest.answers.length; a++) {
                var ans = latest.answers[a];
                html += '<tr><td><span class="ans-no">' + esc(ans.no) + '</span></td>' +
                    '<td>' + esc(ans.text) + '</td>' +
                    '<td>' + esc(ans.label) + '</td>' +
                    '<td class="score">' + esc(fmt(ans.score)) + '</td></tr>';
            }
            html += '</tbody></table></div></div>';
        }

        /* سجل الجلسات */
        html += '<div class="card"><div class="card-title">📈 سجل الجلسات (' + sessions.length + ')</div><div class="table-scroll"><table><thead><tr>' +
            '<th>الجلسة</th><th>التاريخ</th><th>الدرجة</th><th>النسبة</th><th>الفئة</th><th>الإصدار</th></tr></thead><tbody>';
        for (var sI = 0; sI < sessions.length; sI++) {
            var ss = sessions[sI];
            html += '<tr' + (sI === sessions.length - 1 ? ' class="latest"' : '') + '>' +
                '<td>' + ss.number + '</td>' +
                '<td>' + esc(ss.date) + '</td>' +
                '<td class="score">' + esc(num(ss.score) === null ? '—' : fmt(ss.score)) + '</td>' +
                '<td>' + esc(num(ss.pct) === null ? '—' : fmt(ss.pct) + '%') + '</td>' +
                '<td>' + esc((ss.category && ss.category.label) || ss.state || '—') + '</td>' +
                '<td>v' + (ss.scaleVersion || 1) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';

        /* الإجراءات */
        html += '<div class="card"><div class="action-row">' +
            '<button class="btn btn-primary2" id="printBtn">🖨️ طباعة التقرير</button>' +
            '<a class="btn btn-soft" href="custom-test.html?id=' + esc(id) + '">تطبيق جلسة جديدة ←</a>' +
            (scale ? '<a class="btn btn-soft" href="scale-builder.html?id=' + esc(scale.id) + '">تحرير المقياس</a>' : '') +
            '<a class="btn btn-soft" href="tools-severity-scale.html">اختيار مقياس آخر</a>' +
            (AP && AP.id ? '<a class="btn btn-soft" href="patient-file.html?id=' + encodeURIComponent(AP.id) + '">📁 ملف المريض</a>' : '') +
            '</div></div>';

        $('mainBox').innerHTML = html;
        var pb = $('printBtn');
        if (pb) pb.onclick = function () { window.print(); };

        if (chartPending) renderTrend(sessions, sum);
    }

    function stat(k, v) {
        return '<div class="stat" style="background:#f8fafc;border:1px solid #e3ecfe;border-radius:14px;padding:13px 15px;text-align:center">' +
            '<div style="font-size:11.5px;font-weight:800;color:#5b6b8c;margin-bottom:4px">' + esc(k) + '</div>' +
            '<div style="font-size:18px;font-weight:900;color:#1d4ed8">' + esc(v) + '</div></div>';
    }

    function itemRow(it, color, rank) {
        var pct = it.pct === null || it.pct === undefined ? 0 : it.pct;
        var name = it.text || ('بند ' + it.no);
        if (name.length > 70) name = name.slice(0, 68) + '…';
        return '<div class="dim-item">' +
            '<div class="dim-rank" style="background:' + color + '">' + rank + '</div>' +
            '<div class="dim-info"><div class="dim-name">' + esc(name) + '</div>' +
            '<div class="dim-bar-wrap"><div class="dim-bar" style="width:' + pct + '%;background:linear-gradient(90deg,' + color + ',' + color + 'cc)"></div></div></div>' +
            '<div class="dim-score">' + pct + '%<div class="dim-sub">' + esc(fmt(it.score)) + ' · ' + esc(it.label) + '</div></div>' +
            '</div>';
    }

    /* تفسير ديناميكي مبني على فئة الجلسة وموقعها داخل فئات المقياس + أبرز الأبعاد/البنود */
    function interpretation(sum, sessions, latest) {
        var out = '';
        var cat = sum.category;
        var zones = sum.zones || [];
        var pos = null; /* 'first' | 'mid' | 'last' */
        if (cat && zones.length > 1) {
            for (var z = 0; z < zones.length; z++) {
                if (zones[z].label === cat.label) { pos = z === 0 ? 'first' : (z === zones.length - 1 ? 'last' : 'mid'); break; }
            }
        }
        out += 'بناءً على إجابات الجلسة رقم ' + sum.number + ' بتاريخ ' + esc(sum.date) + ' على مقياس <strong>' + esc(sum.scaleName) + '</strong>، ';
        out += 'درجتك <strong>' + esc(fmt(sum.score)) + '</strong> من النطاق ' + esc(fmt(sum.min)) + ' إلى ' + esc(fmt(sum.max)) +
            ' (النسبة ' + esc(fmt(sum.pct)) + '%) وتقع في فئة <strong>«' + esc(cat ? cat.label : (sum.stateLabel || '—')) + '»</strong>. ';

        if (pos === 'last') out += 'هذه الفئة العليا ضمن فئات هذا المقياس، مما يشير إلى وجود أعراض بمستوى مرتفع وفق إعدادات المقياس، وقد يستدعي مراجعة متخصصة. ';
        else if (pos === 'first') out += 'هذه الفئة الدنيا ضمن فئات هذا المقياس — استمر في المتابعة الدورية. ';
        else if (pos === 'mid') out += 'هذه فئة وسطية ضمن تدرّج فئات المقياس، ويُنصح بمتابعة التقييم مع متخصص. ';

        var dims = sum.dims || [];
        if (dims.length) {
            var topNames = dims.slice(0, 2).map(function (x) { return x.name; });
            out += '<br><br>الأبعاد الأعلى في إجابات هذه الجلسة هي: <strong>' + topNames.map(esc).join(' و ') + '</strong>';
            if (dims.length > 2) out += '، بينما الأدنى <strong>' + esc(dims[dims.length - 1].name) + '</strong>';
            out += '.';
        } else {
            var ti = sum.topItems || [], li = sum.lowItems || [];
            if (ti.length) {
                out += '<br><br>أعلى البنود درجة: <strong>' + esc(short(ti[0].text)) + '</strong>';
                if (ti.length > 1) out += '، <strong>' + esc(short(ti[1].text)) + '</strong>';
                out += '.';
            }
            if (li.length) {
                out += ' وأدنىها: <strong>' + esc(short(li[0].text)) + '</strong>.';
            }
        }
        if (sessions.length > 1) {
            var lastPct = num(latest.pct), prevPct = num(sessions[sessions.length - 2].pct);
            if (lastPct !== null && prevPct !== null) {
                var d = lastPct - prevPct;
                if (d > 0) out += '<br><br>مقارنةً بالجلسة السابقة ارتفعت النسبة بمقدار ' + esc(fmt(Math.round(d * 100) / 100)) + '%.';
                else if (d < 0) out += '<br><br>مقارنةً بالجلسة السابقة انخفضت النسبة بمقدار ' + esc(fmt(Math.abs(Math.round(d * 100) / 100))) + '%.';
                else out += '<br><br>لم تتغير النسبة مقارنةً بالجلسة السابقة.';
            }
        }
        out += ' <br><br>⚠️ هذه النتائج مبنية على إعدادات المقياس المخصص (فئاته وحدوده وطريقة تصحيحه) وليست تشخيصًا نهائيًا. يُنصح بمراجعة متخصص.';
        return out;
    }

    function short(s) {
        s = String(s || '');
        return s.length > 55 ? s.slice(0, 53) + '…' : s;
    }

    /* رسم التطور مع خلفيات فئات الشدة (نفس آلية charts.html لكن بحدود ديناميكية من المقياس) */
    function renderTrend(sessions, sum) {
        if (sessions.length === 1) {
            var tm = $('trendMessage');
            if (tm) tm.innerHTML = '<div class="no-sessions">هذه جلساتك الأولى. قم بإجراء جلسات إضافية لرؤية تطور النسبة.</div>';
            return;
        }
        if (typeof Chart === 'undefined' || !$('trendChart')) {
            var tm2 = $('trendMessage');
            if (tm2) tm2.innerHTML = '<div class="no-sessions">تعذّر تحميل الرسم البياني — اعرض سجل الجلسات أدناه للتطور الرقمي.</div>';
            return;
        }
        var zones = sum.zones || [];
        var tLabels = sessions.map(function (s) { return 'الجلسة ' + s.number; });
        var tData = sessions.map(function (s) { return num(s.pct) === null ? 0 : num(s.pct); });
        var zoneColors = {};
        for (var z = 0; z < zones.length; z++) zoneColors[zones[z].label] = zones[z].color;

        var bgPlugin = {
            id: 'bgZones',
            beforeDraw: function (chart) {
                if (!zones.length) return;
                var ctx = chart.ctx, yAxis = chart.scales.y, xAxis = chart.scales.x;
                var top = yAxis.top, bottom = yAxis.bottom, left = xAxis.left, right = xAxis.right;
                var h = bottom - top;
                ctx.save();
                ctx.globalAlpha = 0.1;
                for (var i = 0; i < zones.length; i++) {
                    var from = Math.max(0, Math.min(100, zones[i].fromPct));
                    var to = Math.max(0, Math.min(100, zones[i].toPct));
                    var yTop = top + h * (1 - to / 100);
                    var yBot = top + h * (1 - from / 100);
                    ctx.fillStyle = zones[i].color || '#2563eb';
                    ctx.fillRect(left, yTop, right - left, Math.max(1, yBot - yTop));
                }
                ctx.restore();
            }
        };

        new Chart($('trendChart'), {
            type: 'line',
            data: { labels: tLabels, datasets: [{ label: 'النسبة', data: tData, borderColor: '#2563eb', backgroundColor: '#2563eb', borderWidth: 3, pointRadius: 5, pointBackgroundColor: tData.map(function (p, i) { var s = sessions[i]; return (s && s.color) || sum.color || '#2563eb'; }), tension: .3, fill: false }] },
            options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.y + '%'; } } } }, scales: { y: { beginAtZero: true, max: 100, grid: { color: '#f1f5f9' }, ticks: { font: { family: 'Cairo', size: 11 }, callback: function (v) { return v + '%'; } } }, x: { grid: { display: false }, ticks: { font: { family: 'Cairo', size: 10 }, maxRotation: 45 } } } },
            plugins: [bgPlugin]
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
