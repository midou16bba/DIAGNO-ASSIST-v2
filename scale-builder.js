(function () {
    'use strict';
    var E = window.ScaleEngine;
    if (!E) return;

    var DRAFT_KEY = 'diagBuilderDraft';
    var STEPS = [
        { t: 'تعريف المقياس', h: 'الاسم والوصف والتعليمات الموجّهة للأخصائي والمنبَّه إليه.' },
        { t: 'خيارات الإجابة', h: 'مجموعات الدرجات المستخدمة في بنود المقياس (اسم الخيار وقيمته).' },
        { t: 'البنود', h: 'عبارات المقياس، مع تحديد مجموعة الخيارات لكل بند وإمكانية عكس اتجاه الدرجة.' },
        { t: 'الأبعاد الفرعية', h: 'اختياري: تقسيم المقياس إلى محاور تُحتسب درجاتها بشكل منفصل.' },
        { t: 'طريقة التصحيح', h: 'الجمع أو المتوسط أو الأبعاد أو التصحيح المعياري أو حدود القطع، وسياسة الإجابات الناقصة.' },
        { t: 'فئات التفسير', h: 'حدود الشدة (منخفضة/متوسطة/مرتفعة...) داخل نطاق النتيجة الممكن.' },
        { t: 'المعايير والقطع', h: 'جداول التحويل المعيارية ونقاط القطع — عند الحاجة فقط.' },
        { t: 'المراجعة والنشر', h: 'تحقق نهائي، معاينة حسابية، ثم حفظ المقياس.' }
    ];
    var CAT3 = ['منخفضة', 'متوسطة', 'مرتفعة'];
    var CAT4 = ['منخفضة', 'متوسطة', 'مرتفعة', 'شديدة'];

    var state = { scale: null, editingId: null, step: 0, preview: {}, published: false };
    var saveTimer = null;

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function param(k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null; }
    function fmt(n) { return (typeof n === 'number' && Math.round(n) !== n) ? Number(n.toFixed(4)) : n; }

    function blankScale() {
        return {
            id: E.makeId(),
            version: 1,
            name: '',
            icon: '📝',
            description: '',
            instructions: '',
            targetGroup: '',
            author: '',
            optionSets: [{ id: 'os1', name: 'الافتراضي', options: [{ label: 'أبدًا', score: 0 }, { label: 'نادرًا', score: 1 }, { label: 'أحيانًا', score: 2 }, { label: 'غالبًا', score: 3 }, { label: 'دائمًا', score: 4 }] }],
            defaultOptionSetId: 'os1',
            items: [{ text: '', reverse: false, optionSetId: 'os1', dimensionId: null, reverseMap: null }],
            dimensions: [],
            scoring: { method: 'sum', meanMode: 'answered', includeDimensions: true },
            standard: { enabled: false, type: 'T', source: '', date: '', referenceGroup: '', selectionRule: '', sex: '', ageMin: '', ageMax: '', min: 0, max: 100, table: null, equation: null },
            cutoffs: { enabled: false, kind: 'custom', source: '', population: '', sensitivity: '', usage: '' },
            categories: [
                { label: 'منخفضة', min: 0, max: 20, color: '#16a34a' },
                { label: 'متوسطة', min: 21, max: 30, color: '#2563eb' },
                { label: 'مرتفعة', min: 31, max: 40, color: '#dc2626' }
            ],
            missingPolicy: { type: 'all', maxCount: 0, maxPercent: 0, ruleText: '' }
        };
    }

    function getPath(obj, path) {
        var p = path.split('.'), t = obj;
        for (var i = 0; i < p.length; i++) { if (t === undefined || t === null) return undefined; t = t[p[i]]; }
        return t;
    }
    function setPath(obj, path, val) {
        var p = path.split('.'), t = obj;
        for (var i = 0; i < p.length - 1; i++) {
            var k = p[i];
            if (!t[k] || typeof t[k] !== 'object') t[k] = /^\d+$/.test(p[i + 1]) ? [] : {};
            t = t[k];
        }
        t[p[p.length - 1]] = val;
    }

    function san() {
        var s = state.scale;
        if (!s) return null;
        var tmp = clone(s);
        tmp.id = tmp.id || 'cs-tmp';
        tmp.name = (tmp.name || '').trim() || 'مقياس مؤقت';
        if (!tmp.items || !tmp.items.length) tmp.items = [{ text: '', reverse: false, optionSetId: null, dimensionId: null, reverseMap: null }];
        return E._sanitizeScale(tmp);
    }

    function validateNow() {
        var s = san();
        var v = E.validateScale(s);
        var errs = v.errors.slice();
        if (!(state.scale.name || '').trim()) errs.unshift('اسم المقياس مطلوب.');
        if (!(state.scale.id || '').trim()) errs.unshift('معرّف المقياس مفقود.');
        return { errors: errs, warnings: v.warnings };
    }

    function markDirty() {
        state.published = false;
        var el = $('saveState');
        if (el) { el.textContent = 'يوجد تغييرات غير محفوظة...'; el.classList.add('dirty'); }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveDraft, 500);
    }
    function saveDraft() {
        try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(state.scale));
            var el = $('saveState');
            if (el) { el.textContent = 'مسودة محفوظة تلقائيًا'; el.classList.remove('dirty'); }
        } catch (e) { }
    }
    function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { } }

    var toastTimer = null;
    function toast(msg, kind) {
        var el = $('toast');
        el.className = 'toast show' + (kind ? ' ' + kind : '');
        el.textContent = msg;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
    }

    /* ========================= تهيئة ========================= */
    function init() {
        var id = param('id');
        if (id) {
            var sc = E.getScale(id);
            if (sc) { state.scale = clone(sc); state.editingId = id; }
            else { state.scale = blankScale(); toast('لم يُعثر على المقياس المطلوب — تم فتح مقياس جديد.', 'bad'); }
        } else {
            var d = null;
            try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { }
            if (d && d.id && d.items && d.items.length) {
                state.scale = d;
                var note = $('draftNote');
                if (note) note.classList.remove('hidden');
            } else state.scale = blankScale();
        }
        bindGlobal();
        renderStepper();
        renderManage();
        renderStep();
    }

    function bindGlobal() {
        document.addEventListener('input', onFieldEvent);
        document.addEventListener('change', onFieldEvent);
        document.addEventListener('click', onClickEvent);

        $('newBtn').onclick = function () { newScale(); };
        $('discardDraftBtn').onclick = function () { clearDraft(); location.href = 'scale-builder.html'; };
        $('exportBtn').onclick = exportAll;
        $('prevBtn').onclick = function () { goStep(state.step - 1); };
        $('nextBtn').onclick = function () { goStep(state.step + 1); };

        (function () {
            var b = $('authBtn');
            var u = null;
            try { u = JSON.parse(localStorage.getItem('diagUser') || 'null'); } catch (e) { }
            if (u) { b.textContent = (u.isAdmin ? '👨‍💼 ' : '👤 ') + (u.isAdmin ? 'المدير' : u.name); b.onclick = function () { location.href = 'profile.html'; }; }
            else b.onclick = function () { location.href = 'login.html'; };
        })();
    }

    function newScale() {
        if (state.scale && !state.editingId && ((state.scale.name || '').trim() || hasExtraItems())) {
            if (!confirm('سيتم فتح مقياس جديد وإهمال المسودة الحالية. هل تريد المتابعة؟')) return;
        }
        clearDraft();
        state.scale = blankScale();
        state.editingId = null;
        state.step = 0;
        state.preview = {};
        state.published = false;
        var note = $('draftNote'); if (note) note.classList.add('hidden');
        history.replaceState(null, '', 'scale-builder.html');
        renderStepper();
        renderStep();
        renderManage();
    }
    function hasExtraItems() {
        return state.scale && state.scale.items && state.scale.items.length > 1;
    }

    function onFieldEvent(e) {
        var el = e.target;
        if (!el || !el.getAttribute) return;
        var rmap = el.getAttribute('data-rmap');
        if (rmap !== null) {
            var parts = el.value.split(',');
            var arr = [];
            for (var i = 0; i < parts.length; i++) {
                var n = Number(parts[i].trim());
                if (parts[i].trim() !== '' && isFinite(n)) arr.push(n);
            }
            setPath(state.scale, rmap, arr.length ? arr : null);
            markDirty();
            return;
        }
        var path = el.getAttribute('data-f');
        if (path === null) return;
        var val;
        if (el.type === 'checkbox') val = el.checked;
        else if (el.type === 'radio') { if (!el.checked) return; val = el.value; }
        else if (el.getAttribute('data-num') !== null) { val = el.value === '' ? '' : Number(el.value); if (typeof val === 'number' && !isFinite(val)) return; }
        else val = el.value;
        setPath(state.scale, path, val);
        markDirty();
        if (el.getAttribute('data-render') !== null) renderStep();
    }

    function onClickEvent(e) {
        var el = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!el) return;
        var act = el.getAttribute('data-act');
        var i = parseInt(el.getAttribute('data-i'), 10);
        var j = parseInt(el.getAttribute('data-j'), 10);
        var s = state.scale;

        switch (act) {
            case 'addSet': {
                var nid = 'os' + (s.optionSets.length + 1) + '-' + Math.random().toString(36).slice(2, 6);
                s.optionSets.push({ id: nid, name: 'مجموعة ' + (s.optionSets.length + 1), options: [{ label: 'أبدًا', score: 0 }, { label: 'دائمًا', score: 4 }] });
                break;
            }
            case 'delSet':
                if (s.optionSets.length <= 1) { toast('يجب الإبقاء على مجموعة خيارات واحدة على الأقل.', 'bad'); return; }
                s.optionSets.splice(i, 1);
                var defOk = false;
                for (var dq = 0; dq < s.optionSets.length; dq++) if (s.optionSets[dq].id === s.defaultOptionSetId) defOk = true;
                if (!defOk) s.defaultOptionSetId = s.optionSets[0].id;
                for (var t = 0; t < s.items.length; t++) {
                    if (s.items[t].optionSetId !== undefined) {
                        var ok = false;
                        for (var q = 0; q < s.optionSets.length; q++) if (s.optionSets[q].id === s.items[t].optionSetId) ok = true;
                        if (!ok) s.items[t].optionSetId = null;
                    }
                }
                break;
            case 'addOpt':
                s.optionSets[i].options.push({ label: 'خيار ' + (s.optionSets[i].options.length + 1), score: s.optionSets[i].options.length });
                break;
            case 'delOpt':
                if (s.optionSets[i].options.length <= 2) { toast('لا يمكن حذف أقل من خيارين.', 'bad'); return; }
                s.optionSets[i].options.splice(j, 1);
                break;
            case 'addItem':
                s.items.push({ text: '', reverse: false, optionSetId: s.defaultOptionSetId, dimensionId: null, reverseMap: null });
                break;
            case 'delItem':
                if (s.items.length <= 1) { toast('يجب الإبقاء على بند واحد على الأقل.', 'bad'); return; }
                s.items.splice(i, 1);
                for (var d = 0; d < s.dimensions.length; d++) {
                    var ix = [];
                    for (var z = 0; z < s.dimensions[d].itemIndexes.length; z++) {
                        var v = s.dimensions[d].itemIndexes[z];
                        if (v < i) ix.push(v); else if (v > i) ix.push(v - 1);
                    }
                    s.dimensions[d].itemIndexes = ix;
                }
                break;
            case 'upItem':
                if (i <= 0) return;
                swap(s.items, i, i - 1);
                for (var d2 = 0; d2 < s.dimensions.length; d2++) {
                    var ixs = s.dimensions[d2].itemIndexes;
                    for (var y = 0; y < ixs.length; y++) {
                        if (ixs[y] === i) ixs[y] = i - 1;
                        else if (ixs[y] === i - 1) ixs[y] = i;
                    }
                    s.dimensions[d2].itemIndexes.sort(function (a, b) { return a - b; });
                }
                break;
            case 'downItem':
                if (i >= s.items.length - 1) return;
                swap(s.items, i, i + 1);
                for (var d3 = 0; d3 < s.dimensions.length; d3++) {
                    var ixs3 = s.dimensions[d3].itemIndexes;
                    for (var y3 = 0; y3 < ixs3.length; y3++) {
                        if (ixs3[y3] === i) ixs3[y3] = i + 1;
                        else if (ixs3[y3] === i + 1) ixs3[y3] = i;
                    }
                    s.dimensions[d3].itemIndexes.sort(function (a, b) { return a - b; });
                }
                break;
            case 'bulkAdd': {
                var ta = $('bulkText');
                var lines = (ta.value || '').split('\n');
                var added = 0;
                for (var L = 0; L < lines.length; L++) {
                    var txt = lines[L].trim();
                    if (!txt) continue;
                    s.items.push({ text: txt, reverse: false, optionSetId: s.defaultOptionSetId, dimensionId: null, reverseMap: null });
                    added++;
                }
                if (!added) { toast('لم يُعثر على بنود نصية لإضافتها.', 'bad'); return; }
                ta.value = '';
                toast('تمت إضافة ' + added + ' بنود.', 'ok');
                break;
            }
            case 'addDim':
                s.dimensions.push({ id: 'dim' + (s.dimensions.length + 1) + '-' + Math.random().toString(36).slice(2, 5), name: 'بُعد ' + (s.dimensions.length + 1), description: '', itemIndexes: [], scoring: 'sum', categories: [] });
                break;
            case 'delDim':
                s.dimensions.splice(i, 1);
                break;
            case 'toggleDimItem': {
                var di = parseInt(el.getAttribute('data-dim'), 10);
                var ii = parseInt(el.getAttribute('data-item'), 10);
                var dim = s.dimensions[di];
                var pos = dim.itemIndexes.indexOf(ii);
                if (pos >= 0) dim.itemIndexes.splice(pos, 1);
                else { dim.itemIndexes.push(ii); dim.itemIndexes.sort(function (a, b) { return a - b; }); }
                var cnt = document.getElementById('dimCount-' + di);
                if (cnt) cnt.textContent = dim.itemIndexes.length + ' بنود';
                el.classList.toggle('on', pos < 0);
                break;
            }
            case 'genDimCats': {
                var dim2 = s.dimensions[i];
                var ss = san();
                var r = E.dimensionRange(ss, dim2);
                var range = r.max - r.min;
                var discreteDim = dim2.scoring !== 'mean';
                if (discreteDim) {
                    var half = r.min + Math.floor(range / 2);
                    dim2.categories = [
                        { label: 'منخفض', min: r.min, max: half, color: E.PALETTE[4] },
                        { label: 'مرتفع', min: half + 1, max: r.max, color: E.PALETTE[0] }
                    ];
                } else {
                    var mid = r.min + range / 2;
                    dim2.categories = [
                        { label: 'منخفض', min: r.min, max: fmt(mid), color: E.PALETTE[4] },
                        { label: 'مرتفع', min: fmt(mid), max: r.max, color: E.PALETTE[0] }
                    ];
                }
                toast('تم توليد حدّي تفسير للبُعد من ' + r.min + ' إلى ' + r.max + '.', 'ok');
                break;
            }
            case 'addCat': {
                var dom0 = E.domainOf(san());
                s.categories.push({ label: 'فئة جديدة', min: 0, max: dom0.max, color: E.PALETTE[s.categories.length % E.PALETTE.length] });
                break;
            }
            case 'delCat':
                s.categories.splice(i, 1);
                break;
            case 'addDimCat': {
                var dd = s.dimensions[i];
                var rr2 = E.dimensionRange(san(), dd);
                dd.categories.push({ label: 'فئة جديدة', min: rr2.min, max: rr2.max, color: E.PALETTE[dd.categories.length % E.PALETTE.length] });
                break;
            }
            case 'delDimCat':
                s.dimensions[i].categories.splice(j, 1);
                break;
            case 'genCats':
                genCats(parseInt(el.getAttribute('data-count'), 10) || 3);
                break;
            case 'addTbl':
                if (!isArr(s.standard.table)) s.standard.table = [];
                s.standard.table.push({ rawMin: 0, rawMax: 0, value: 0 });
                break;
            case 'delTbl':
                s.standard.table.splice(i, 1);
                if (!s.standard.table.length) s.standard.table = null;
                break;
            case 'runPreview':
                runPreview();
                return;
            case 'publish':
                publish();
                return;
            case 'editScale':
                if (dirtyConfirm()) location.href = 'scale-builder.html?id=' + el.getAttribute('data-id');
                return;
            case 'dupScale': {
                var src = E.getScale(el.getAttribute('data-id'));
                if (!src) return;
                var copy = clone(src);
                copy.id = E.makeId();
                copy.name = src.name + ' (نسخة)';
                copy.version = 1;
                copy.createdAt = '';
                copy.createdAtISO = '';
                var rr = E.upsertScale(copy);
                if (!rr.ok) { toast(rr.error, 'bad'); return; }
                toast('تم إنشاء نسخة باسم "' + copy.name + '".', 'ok');
                renderManage();
                return;
            }
            case 'delScale': {
                var did = el.getAttribute('data-id');
                var dsc = E.getScale(did);
                if (!dsc) return;
                if (!confirm('حذف المقياس "' + dsc.name + '"؟ لن تُحذف سجلات التقييم السابقة.')) return;
                var dr = E.deleteScale(did);
                if (!dr.ok) { toast(dr.error, 'bad'); return; }
                if (state.editingId === did) { state.editingId = null; state.scale = blankScale(); state.step = 0; renderStepper(); renderStep(); }
                toast('تم حذف المقياس (بقيت سجلات التقييم).', 'ok');
                renderManage();
                return;
            }
            case 'openTest': {
                var tid = el.getAttribute('data-id');
                var ts = E.getScale(tid);
                if (!ts || E.validateScale(ts).errors.length) { toast('لا يمكن اختبار مقياس غير مكتمل — راجع التحقق أولًا.', 'bad'); return; }
                localStorage.setItem('chosenCustomScale', tid);
                location.href = 'custom-test.html';
                return;
            }
            default: return;
        }
        markDirty();
        renderStep();
    }

    function isArr(a) { return Object.prototype.toString.call(a) === '[object Array]'; }
    function swap(arr, a, b) { var x = arr[a]; arr[a] = arr[b]; arr[b] = x; }
    function dirtyConfirm() {
        if ($('saveState') && $('saveState').classList.contains('dirty')) {
            return confirm('لديك تغييرات غير محفوظة في المسودة. سيُستعاد تلقائيًا لاحقًا عند العودة. هل تريد المتابعة؟');
        }
        return true;
    }

    function genCats(count) {
        var s = san();
        var dom = E.domainOf(s);
        var discrete = E.isDiscreteDomain(s);
        var labels = count >= 4 ? CAT4 : CAT3;
        var cats = [];
        if (discrete) {
            var span = dom.max - dom.min;
            var n = Math.min(count, span + 1);
            if (n < 1) { toast('النطاق الحالي صغير جدًا لتوليد فئات.', 'bad'); return; }
            var step = span / n;
            for (var i = 0; i < n; i++) {
                var mn = i === 0 ? dom.min : Math.round(dom.min + step * i);
                var mx = i === n - 1 ? dom.max : Math.round(dom.min + step * (i + 1)) - 1;
                if (i > 0 && mn <= cats[i - 1].max) mn = cats[i - 1].max + 1;
                if (mx < mn) mx = mn;
                cats.push({ label: labels[i] || ('فئة ' + (i + 1)), min: mn, max: Math.min(mx, dom.max), color: E.PALETTE[Math.min(i, E.PALETTE.length - 1)] });
            }
            cats[cats.length - 1].max = dom.max;
        } else {
            var width = (dom.max - dom.min) / n;
            for (var k = 0; k < n; k++) {
                var mn2 = k === 0 ? dom.min : fmt(dom.min + width * k);
                var mx2 = k === n - 1 ? dom.max : fmt(dom.min + width * (k + 1));
                cats.push({ label: labels[k] || ('فئة ' + (k + 1)), min: mn2, max: mx2, color: E.PALETTE[Math.min(k, E.PALETTE.length - 1)] });
            }
        }
        state.scale.categories = cats;
        toast('تم توليد ' + cats.length + ' فئات تغطي النطاق ' + dom.min + ' إلى ' + dom.max + '.', 'ok');
    }

    /* ========================= تنقّل الخطوات ========================= */
    function goStep(n) {
        if (n < 0 || n >= STEPS.length) return;
        state.step = n;
        renderStepper();
        renderStep();
        window.scrollTo({ top: document.querySelector('.stepper').offsetTop - 110, behavior: 'smooth' });
    }

    function renderStepper() {
        var html = '';
        for (var i = 0; i < STEPS.length; i++) {
            html += '<div class="step-pill' + (i === state.step ? ' active' : (i < state.step ? ' done' : '')) + '" data-act-step="' + i + '">' +
                '<span class="num">' + (i < state.step ? '✓' : (i + 1)) + '</span><span>' + STEPS[i].t + '</span></div>';
        }
        $('stepper').innerHTML = html;
        var pills = $('stepper').querySelectorAll('[data-act-step]');
        for (var p = 0; p < pills.length; p++) {
            pills[p].onclick = function () { goStep(parseInt(this.getAttribute('data-act-step'), 10)); };
        }
    }

    function renderStep() {
        if (!state.scale) return;
        $('stepTitle').textContent = (state.step + 1) + '. ' + STEPS[state.step].t;
        $('stepHint').textContent = STEPS[state.step].h;
        var body = $('stepBody');
        var html = '';
        switch (state.step) {
            case 0: html = stepGeneral(); break;
            case 1: html = stepOptions(); break;
            case 2: html = stepItems(); break;
            case 3: html = stepDims(); break;
            case 4: html = stepScoring(); break;
            case 5: html = stepCats(); break;
            case 6: html = stepStd(); break;
            case 7: html = stepReview(); break;
        }
        body.innerHTML = html;
        $('prevBtn').disabled = state.step === 0;
        $('prevBtn').style.visibility = state.step === 0 ? 'hidden' : 'visible';
        $('nextBtn').style.display = state.step >= STEPS.length - 1 ? 'none' : 'inline-flex';
        $('footMid').textContent = 'الخطية ' + (state.step + 1) + ' من ' + STEPS.length;
        if (state.step === 7) renderValidation();
    }

    /* ========================= الخطوة 1: التعريف ========================= */
    function stepGeneral() {
        var s = state.scale;
        return '<div class="grid2">' +
            fld('اسم المقياس *', '<input type="text" data-f="name" value="' + esc(s.name) + '" placeholder="مثال: مقياس الشدة النفسية المعرَّض">', 'اسم يظهر في قائمة المقاييس وفي صفحة التطبيق.', true) +
            fld('الفئة المستهدفة', '<input type="text" data-f="targetGroup" value="' + esc(s.targetGroup) + '" placeholder="مثال: بالغون 18-45 سنة">', '', false) +
            fld('المؤلف / المصدر', '<input type="text" data-f="author" value="' + esc(s.author) + '" placeholder="اسمك أو المرجع العلمي">', '', false) +
            fld('أيقونة البطاقة', '<input type="text" data-f="icon" maxlength="4" value="' + esc(s.icon || '📝') + '" placeholder="📝">', 'رمز تعبيري يظهر في بطاقة المقياس داخل قائمة اختيار المقياس.', false) +
            fld('رقم الإصدار الحالي', '<input type="text" readonly value="' + esc('v' + (s.version || 1) + (state.editingId ? '' : ' (لم يُنشر بعد)')) + '">', 'يزداد تلقائيًا مع كل تعديل بعد النشر.', false) +
            fld('وصف المقياس', '<textarea data-f="description" placeholder="ماذا يقيس ولماذا؟">' + esc(s.description) + '</textarea>', '', true, true) +
            fld('تعليمات التطبيق', '<textarea data-f="instructions" placeholder="كيف يُطبَّق المقياس؟ مدة الإجابة، تعليمات منطوقة...">' + esc(s.instructions) + '</textarea>', 'تظهر للأخصائي قبل بدء التطبيق.', false, true) +
            '</div>';
    }
    function fld(label, input, hint, required, full) {
        return '<div class="field' + (full ? ' full' : '') + '">' +
            '<label>' + (required ? '<span style="color:#dc2626">*</span> ' : '') + label + '</label>' + input +
            (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
    }

    /* ========================= الخطوة 2: خيارات الإجابة ========================= */
    function stepOptions() {
        var s = state.scale, html = '';
        for (var i = 0; i < s.optionSets.length; i++) {
            var os = s.optionSets[i];
            var isDef = os.id === s.defaultOptionSetId;
            html += '<div class="box"><div class="box-head"><h4>مجموعة ' + (i + 1) + ' — ' + esc(os.name) + (isDef ? ' <span class="badge">افتراضية</span>' : '') + '</h4>' +
                '<div class="box-tools">' +
                '<label class="checkbox" style="padding:7px 12px;font-size:12.5px"><input type="radio" name="defset" value="' + esc(os.id) + '" data-f="defaultOptionSetId" data-render' + (isDef ? ' checked' : '') + '> استخدامها كافتراضية</label>' +
                (s.optionSets.length > 1 ? '<button class="mini-btn" data-act="delSet" data-i="' + i + '" title="حذف المجموعة">🗑</button>' : '') +
                '</div></div>' +
                '<div class="field" style="margin-bottom:12px"><label>اسم المجموعة</label><input type="text" data-f="optionSets.' + i + '.name" value="' + esc(os.name) + '" data-render></div>';
            for (var j = 0; j < os.options.length; j++) {
                html += '<div class="opt-row">' +
                    '<input type="text" data-f="optionSets.' + i + '.options.' + j + '.label" value="' + esc(os.options[j].label) + '" placeholder="نص الخيار" style="font-family:inherit;font-size:14px;padding:11px 13px;border:1.5px solid var(--line);border-radius:12px;background:#fff">' +
                    '<input type="number" data-num data-f="optionSets.' + i + '.options.' + j + '.score" value="' + esc(os.options[j].score) + '" placeholder="الدرجة" style="font-family:inherit;font-size:14px;padding:11px 13px;border:1.5px solid var(--line);border-radius:12px;background:#fff">' +
                    '<button class="mini-btn" data-act="delOpt" data-i="' + i + '" data-j="' + j + '" title="حذف الخيار">🗑</button>' +
                    '</div>';
            }
            html += '<button class="add-btn" data-act="addOpt" data-i="' + i + '">+ خيار</button>';
            html += '<div class="map-box">ترتيب الدرجات مسموح تصاعديًا أو تنازليًا. الدرجات غير المتسلسلة (مثل 0/1/5) تتطلب خريطة عكس صريحة عند عكس بند ما.</div>';
            html += '</div>';
        }
        html += '<button class="add-btn" data-act="addSet">+ مجموعة خيارات جديدة</button>';
        return html;
    }

    /* ========================= الخطوة 3: البنود ========================= */
    function stepItems() {
        var s = state.scale, html = '';
        html += '<div class="dom-info"><span class="info-chip">' + s.items.length + ' بنود</span><span class="info-chip">' + s.optionSets.length + ' مجموعات خيارات</span><span class="info-chip">النطاق المقدَّر: ' + rangeText() + '</span></div>';
        for (var i = 0; i < s.items.length; i++) {
            var it = s.items[i];
            html += '<div class="box"><div class="box-head"><h4>بند ' + (i + 1) + '</h4><div class="box-tools">' +
                '<button class="mini-btn up" data-act="upItem" data-i="' + i + '" title="تحريك لأعلى">↑</button>' +
                '<button class="mini-btn down" data-act="downItem" data-i="' + i + '" title="تحريك لأسفل">↓</button>' +
                '<button class="mini-btn" data-act="delItem" data-i="' + i + '" title="حذف البند">🗑</button>' +
                '</div></div>' +
                '<div class="field"><label>نص البند</label><textarea class="item-text" data-f="items.' + i + '.text" placeholder="مثال: شعرت بالخوف الشديد عند تذكّر الحادثة">' + esc(it.text) + '</textarea></div>' +
                '<div class="grid2" style="margin-top:12px">' +
                '<div class="field"><label>مجموعة الخيارات</label><select data-f="items.' + i + '.optionSetId" data-render>' + setOpts(s, it.optionSetId) + '</select></div>' +
                '<div class="field"><label>اتجاه الدرجة</label><label class="checkbox"><input type="checkbox" data-f="items.' + i + '.reverse" data-render' + (it.reverse ? ' checked' : '') + '> بند عكسي (تُقلب درجته)</label></div>' +
                '</div>' + reverseBox(s, i) + '</div>';
        }
        html += '<button class="add-btn" data-act="addItem">+ بند جديد</button>';
        html += '<details class="box" style="margin-top:14px"><summary style="cursor:pointer;font-weight:800;font-size:14px">+ إضافة عدة بنود دفعة واحدة (سطر لكل بند)</summary>' +
            '<div class="field" style="margin-top:12px"><textarea id="bulkText" placeholder="كل سطر يصبح بندًا جديدًا بنفس مجموعة الخيارات الافتراضية"></textarea></div>' +
            '<button class="add-btn" data-act="bulkAdd" style="margin-top:10px">إضافة البنود</button></details>';
        return html;
    }
    function setOpts(s, cur) {
        var html = '';
        for (var k = 0; k < s.optionSets.length; k++) {
            html += '<option value="' + esc(s.optionSets[k].id) + '"' + (s.optionSets[k].id === cur ? ' selected' : '') + '>' + esc(s.optionSets[k].name) + '</option>';
        }
        return html;
    }
    function reverseBox(s, i) {
        var it = s.items[i];
        if (!it.reverse) return '';
        var os = null;
        for (var k = 0; k < s.optionSets.length; k++) if (s.optionSets[k].id === it.optionSetId) os = s.optionSets[k];
        if (!os) os = s.optionSets[0];
        var scores = [];
        for (var j = 0; j < (os ? os.options.length : 0); j++) scores.push(Number(os.options[j].score));
        var auto = E.autoReverseMap(scores);
        var val = isArr(it.reverseMap) ? it.reverseMap.join(', ') : '';
        var html = '<div class="map-box' + (auto ? '' : ' warn') + '">';
        if (auto) html += 'خريطة عكس تلقائية جاهزة: <b>[' + auto.join('، ') + ']</b> — تُستخدم تلقائيًا ما لم تُدخل خريطة يدوية.';
        else html += 'درجات هذه المجموعة غير متسلسلة — <b>الخريطة اليدوية مطلوبة</b> لعكس هذا البند بدقّة.';
        html += '</div>';
        html += '<div class="field" style="margin-top:10px"><label>الخريطة العكسية اليدوية (اختياري، مفصولة بفواصل)</label>' +
            '<input type="text" data-rmap="items.' + i + '.reverseMap" value="' + esc(val) + '" placeholder="' + (auto ? auto.join(',') : 'مثال: 4,3,2,1,0') + '"></div>';
        return html;
    }

    /* ========================= الخطوة 4: الأبعاد ========================= */
    function stepDims() {
        var s = state.scale, html = '';
        html += '<div class="empty-note" style="margin-bottom:16px">الأبعاد الفرعية اختيارية: تُستخدم مع طريقة "الأبعاد الفرعية" لإظهار درجة كل محور منفصلة عن الدرجة الكلية.</div>';
        for (var i = 0; i < s.dimensions.length; i++) {
            var dim = s.dimensions[i];
            html += '<div class="box"><div class="box-head"><h4>بُعد ' + (i + 1) + ' — ' + esc(dim.name) + ' <span class="badge" id="dimCount-' + i + '">' + dim.itemIndexes.length + ' بنود</span></h4>' +
                '<div class="box-tools"><button class="mini-btn" data-act="delDim" data-i="' + i + '">🗑</button></div></div>' +
                '<div class="grid2">' +
                fld('اسم البُعد', '<input type="text" data-f="dimensions.' + i + '.name" value="' + esc(dim.name) + '">', '', false) +
                fld('طريقة احتساب البُعد', '<select data-f="dimensions.' + i + '.scoring"><option value="sum"' + (dim.scoring === 'sum' ? ' selected' : '') + '>جمع الدرجات</option><option value="mean"' + (dim.scoring === 'mean' ? ' selected' : '') + '>متوسط الدرجات</option></select>', '', false) +
                fld('وصف البُعد', '<input type="text" data-f="dimensions.' + i + '.description" value="' + esc(dim.description) + '" placeholder="ماذا يقيس هذا المحور؟">', '', false) +
                '</div>' +
                '<div class="section-sub">فئات تفسير البُعد</div>' +
                catRows(dim.categories, 'dimensions.' + i + '.categories', i) +
                '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">' +
                '<button class="add-btn" data-act="addDimCat" data-i="' + i + '">+ فئة</button>' +
                '<button class="add-btn" data-act="genDimCats" data-i="' + i + '">توليد حدّين تلقائيًا</button>' +
                '</div>' +
                '<div class="section-sub">بنود البُعد</div>' + dimItemBoxes(i) +
                '</div>';
        }
        html += '<button class="add-btn" data-act="addDim">+ بُعد فرعي</button>';
        return html;
    }
    function dimItemBoxes(di) {
        var s = state.scale, dim = s.dimensions[di], html = '<div class="dim-items">';
        for (var i = 0; i < s.items.length; i++) {
            var on = dim.itemIndexes.indexOf(i) >= 0;
            var txt = (s.items[i].text || '').trim() || 'بند بلا نص';
            html += '<label class="dim-item' + (on ? ' on' : '') + '"><input type="checkbox" data-act="toggleDimItem" data-dim="' + di + '" data-item="' + i + '"' + (on ? ' checked' : '') + '>' +
                '<span><b>بند ' + (i + 1) + ':</b> ' + esc(txt.slice(0, 60)) + (txt.length > 60 ? '…' : '') + '</span></label>';
        }
        return html + '</div>';
    }
    function catRows(cats, path, dimIdx) {
        var html = '<div class="cat-head"><span>الفئة</span><span>من</span><span>إلى</span><span>اللون</span><span></span></div>';
        for (var i = 0; i < cats.length; i++) {
            var delBtn = dimIdx === undefined
                ? '<button class="mini-btn" data-act="delCat" data-i="' + i + '">🗑</button>'
                : '<button class="mini-btn" data-act="delDimCat" data-i="' + dimIdx + '" data-j="' + i + '">🗑</button>';
            html += '<div class="cat-row">' +
                '<input type="text" data-f="' + path + '.' + i + '.label" value="' + esc(cats[i].label) + '" style="font-family:inherit;font-size:14px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px">' +
                '<input type="number" data-num data-f="' + path + '.' + i + '.min" value="' + esc(cats[i].min) + '" style="font-family:inherit;font-size:14px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px">' +
                '<input type="number" data-num data-f="' + path + '.' + i + '.max" value="' + esc(cats[i].max === null || cats[i].max === undefined ? '' : cats[i].max) + '" placeholder="إلى" style="font-family:inherit;font-size:14px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px">' +
                '<input type="color" data-f="' + path + '.' + i + '.color" value="' + esc(cats[i].color || '#2563eb') + '">' +
                delBtn +
                '</div>';
        }
        return html;
    }

    /* ========================= الخطوة 5: التصحيح ========================= */
    function stepScoring() {
        var s = state.scale, html = '';
        html += '<div class="section-sub">طريقة التصحيح</div><div class="radio-grid">';
        for (var i = 0; i < E.METHODS.length; i++) {
            var m = E.METHODS[i];
            var on = s.scoring.method === m;
            html += '<label class="radio-card' + (on ? ' on' : '') + '"><input type="radio" name="method" value="' + m + '" data-f="scoring.method" data-render' + (on ? ' checked' : '') + '>' +
                '<div class="rc-t">' + (on ? '◉ ' : '○ ') + esc(E.methodLabel(m)) + '</div><div class="rc-d">' + esc(E.methodDesc(m)) + '</div></label>';
        }
        html += '</div>';
        var em = E.effectiveMethod(san() || s);
        if (em === 'mean') {
            html += '<div class="grid2" style="margin-top:16px">' + fld('سلوك المتوسط', '<select data-f="scoring.meanMode" data-render>' +
                '<option value="answered"' + (s.scoring.meanMode === 'answered' ? ' selected' : '') + '>متوسط البنود المجابة فقط</option>' +
                '<option value="all"' + (s.scoring.meanMode === 'all' ? ' selected' : '') + '>متوسط جميع البنود (تُشترط كامل الإجابة)</option></select>', '', false) + '</div>';
        }
        if (em === 'dimensions') {
            if (!s.dimensions.length) html += '<div class="val-box val-warn" style="margin-top:16px">لم تُنشئ أبعادًا فرعية بعد — أنشئها في الخطوة 4، وإلا احتُسبت الدرجة الكلية فقط.</div>';
            html += '<div class="grid2" style="margin-top:16px"><label class="checkbox"><input type="checkbox" data-f="scoring.includeDimensions" data-render' + (s.scoring.includeDimensions ? ' checked' : '') + '> إظهار درجات الأبعاد في النتيجة</label></div>';
        }
        if (em === 'standard' && !s.standard.enabled) {
            html += '<div class="val-box val-warn" style="margin-top:16px">اخترت التصحيح المعياري — فعّل "التحويل المعياري" في الخطوة 6 واملأ جدول التحويل أو المعادلة.</div>';
        }
        if (em === 'cutoffs' && !s.cutoffs.enabled) {
            html += '<div class="val-box val-warn" style="margin-top:16px">اخترت حدود القطع — فعّلها ووثّقها في الخطوة 6.</div>';
        }

        html += '<div class="section-sub">سياسة الإجابات الناقصة</div><div class="radio-grid">';
        var MP = [
            { k: 'all', d: 'يُحتسب المقياس فقط بعد الإجابة عن جميع البنود.' },
            { k: 'count', d: 'يُسمح بعدد أقصى من البنود غير المجابة دون تعويض تلقائي.' },
            { k: 'percent', d: 'يُسمح بنسبة مئوية قصوى من البنود غير المجابة.' },
            { k: 'rule', d: 'قاعدة تعويض موثقة بنص مرجعي واضح يكتبه الأخصائي.' }
        ];
        for (var p = 0; p < MP.length; p++) {
            var on2 = s.missingPolicy.type === MP[p].k;
            html += '<label class="radio-card' + (on2 ? ' on' : '') + '"><input type="radio" name="mp" value="' + MP[p].k + '" data-f="missingPolicy.type" data-render' + (on2 ? ' checked' : '') + '>' +
                '<div class="rc-t">' + (on2 ? '◉ ' : '○ ') + esc(E.MISSING_LABELS[MP[p].k]) + '</div><div class="rc-d">' + MP[p].d + '</div></label>';
        }
        html += '</div>';
        var mp = s.missingPolicy;
        if (mp.type === 'count') html += '<div class="grid3" style="margin-top:16px">' + fld('الحد الأقصى لعدد المفقود', '<input type="number" data-num data-f="missingPolicy.maxCount" value="' + esc(mp.maxCount) + '">', '', true) + '</div>';
        if (mp.type === 'percent') html += '<div class="grid3" style="margin-top:16px">' + fld('الحد الأقصى للمفقود (%)', '<input type="number" data-num data-f="missingPolicy.maxPercent" value="' + esc(mp.maxPercent) + '" min="0" max="99">', 'يجب أن يكون أقل من 100%.', true) + '</div>';
        if (mp.type === 'rule') html += '<div style="margin-top:16px">' + fld('نص قاعدة التعويض (مرجع موثّق)', '<textarea data-f="missingPolicy.ruleText" placeholder="مثال: يُسمح ببند واحد غير مجاب وفق مرجع Smith 2020">' + esc(mp.ruleText) + '</textarea>', 'بدون نص مرجعي يمنع النشر.', true, true) + '</div>';

        html += '<div class="dom-info" style="margin-top:20px">' + domChips() + '</div>';
        return html;
    }

    /* ========================= الخطوة 6: الفئات ========================= */
    function stepCats() {
        var s = state.scale;
        var ss = san();
        var dom = E.domainOf(ss);
        var discrete = E.isDiscreteDomain(ss);
        var html = '<div class="dom-info">' + domChips() + '</div>';
        html += '<div class="empty-note" style="margin-bottom:16px">قاعدة التغطية: أول فئة تبدأ من <b>' + dom.min + '</b> وآخر فئة تنتهي عند <b>' + dom.max + '</b>، ولا فجوة ولا تداخل بين الفئات (' + (discrete ? 'الأعداد الصحيحة: تنتهي فئة عند درجة أقل بواحد من بداية التالية' : 'القيم المتصلة: تنتهي فئة حيث تبدأ التالية') + ').</div>';
        html += catRows(s.categories, 'categories');
        html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">' +
            '<button class="add-btn" data-act="addCat">+ فئة</button>' +
            '<button class="add-btn" data-act="genCats" data-count="3">توليد 3 فئات</button>' +
            '<button class="add-btn" data-act="genCats" data-count="4">توليد 4 فئات</button>' +
            '</div>';
        var errs = E.validateCategories(s.categories, dom, discrete, '');
        html += '<div style="margin-top:16px">' + (errs.length ? valBox('err', 'فئات التفسير', errs) : valBox('ok', 'فئات التفسير', ['تغطية صحيحة للكامل النطاق ' + dom.min + ' - ' + dom.max + '.'])) + '</div>';
        return html;
    }

    /* ========================= الخطوة 7: المعايير والقطع ========================= */
    function stepStd() {
        var s = state.scale, html = '';
        html += '<div class="section-sub">التحويل المعياري</div>';
        if (s.scoring.method !== 'standard') html += '<div class="val-box val-warn">الطريقة الحالية ليست "التصحيح المعياري" — يمكنك تعبئة هذه البيانات لاحقًا وتفعيلها عند تغيير الطريقة.</div>';
        html += '<label class="checkbox" style="margin-bottom:14px"><input type="checkbox" data-f="standard.enabled" data-render' + (s.standard.enabled ? ' checked' : '') + '> تفعيل التحويل المعياري</label>';
        if (s.standard.enabled) {
            var st = s.standard;
            html += '<div class="grid3">' +
                fld('نوع الدرجة المعيارية', '<select data-f="standard.type">' + stdTypeOpts(st.type) + '</select>', '', true) +
                fld('المصدر / المرجع *', '<input type="text" data-f="standard.source" value="' + esc(st.source) + '" placeholder="مثال: دراسة محلية 2024">', '', true) +
                fld('سنة المرجع', '<input type="text" data-f="standard.date" value="' + esc(st.date) + '" placeholder="2024">', '', false) +
                fld('مجموعة المرجع', '<input type="text" data-f="standard.referenceGroup" value="' + esc(st.referenceGroup) + '" placeholder="مثال: مراهقون 13-17 سنة">', '', true) +
                fld('قاعدة الاختيار', '<input type="text" data-f="standard.selectionRule" value="' + esc(st.selectionRule) + '" placeholder="مثال: حسب العمر">', '', false) +
                fld('الجنس', '<select data-f="standard.sex"><option value=""' + (st.sex === '' ? ' selected' : '') + '>الكل</option><option value="ذكر"' + (st.sex === 'ذكر' ? ' selected' : '') + '>ذكر</option><option value="أنثى"' + (st.sex === 'أنثى' ? ' selected' : '') + '>أنثى</option></select>', '', false) +
                fld('العمر من', '<input type="number" data-num data-f="standard.ageMin" value="' + esc(st.ageMin) + '">', '', false) +
                fld('العمر إلى', '<input type="number" data-num data-f="standard.ageMax" value="' + esc(st.ageMax) + '">', '', false) +
                fld('الحد الأدنى للدرجة المعيارية', '<input type="number" data-num data-f="standard.min" value="' + esc(st.min) + '">', '', true) +
                fld('الحد الأقصى للدرجة المعيارية', '<input type="number" data-num data-f="standard.max" value="' + esc(st.max) + '">', '', true) +
                '</div>';
            html += '<div class="section-sub">جدول التحويل (النطاق الخام → القيمة المعيارية)</div>';
            html += '<div class="empty-note" style="margin-bottom:12px">يجب أن يغطي الجدول كامل نطاق الدرجة الخام (' + rangeText() + ') دون فجوات — أدخل القيم كما وردت في مرجعك المعياري دون تقريب من عندك.</div>';
            html += '<div class="tbl-head"><span>من (خام)</span><span>إلى (خام)</span><span>القيمة المعيارية</span><span></span></div><div class="tbl-scroll">';
            var tbl = isArr(st.table) ? st.table : [];
            for (var i = 0; i < tbl.length; i++) {
                html += '<div class="tbl-row">' +
                    '<input type="number" data-num data-f="standard.table.' + i + '.rawMin" value="' + esc(tbl[i].rawMin) + '" style="font-family:inherit;font-size:14px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px">' +
                    '<input type="number" data-num data-f="standard.table.' + i + '.rawMax" value="' + esc(tbl[i].rawMax) + '" style="font-family:inherit;font-size:14px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px">' +
                    '<input type="number" data-num data-f="standard.table.' + i + '.value" value="' + esc(tbl[i].value) + '" style="font-family:inherit;font-size:14px;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px">' +
                    '<button class="mini-btn" data-act="delTbl" data-i="' + i + '">🗑</button></div>';
            }
            html += '</div><button class="add-btn" data-act="addTbl">+ صف في الجدول</button>';
            html += '<div class="section-sub">أو: معادلة تحويل</div>';
            html += '<div class="grid3">' +
                fld('المعامل a', '<input type="number" data-num data-f="standard.equation.a" value="' + esc(st.equation ? st.equation.a : '') + '" placeholder="0.5">', '', false) +
                fld('المعامل b', '<input type="number" data-num data-f="standard.equation.b" value="' + esc(st.equation ? st.equation.b : '') + '" placeholder="25">', '', false) +
                '<div class="field"><label>&nbsp;</label><span class="hint">الدرجة المعيارية = a × الدرجة الخام + b — تُستخدم عند غياب الجدول.</span></div>' +
                '</div>';
        }

        html += '<div class="section-sub">نقاط القطع</div>';
        if (s.scoring.method !== 'cutoffs') html += '<div class="val-box val-warn">الطريقة الحالية ليست "حدود القطع" — عُد إليها هنا عند الحاجة.</div>';
        html += '<label class="checkbox" style="margin-bottom:14px"><input type="checkbox" data-f="cutoffs.enabled" data-render' + (s.cutoffs.enabled ? ' checked' : '') + '> تفعيل حدود القطع</label>';
        if (s.cutoffs.enabled) {
            var cu = s.cutoffs;
            html += '<div class="radio-grid" style="margin-bottom:14px">' +
                '<label class="radio-card' + (cu.kind === 'custom' ? ' on' : '') + '"><input type="radio" name="cutkind" value="custom" data-f="cutoffs.kind" data-render' + (cu.kind === 'custom' ? ' checked' : '') + '><div class="rc-t">حُدود مخصصة (وصفية)</div><div class="rc-d">حدود يستخدمها الأخصائي وتُعرض كحدود وصفية لا تشخيصية.</div></label>' +
                '<label class="radio-card' + (cu.kind === 'validated' ? ' on' : '') + '"><input type="radio" name="cutkind" value="validated" data-f="cutoffs.kind" data-render' + (cu.kind === 'validated' ? ' checked' : '') + '><div class="rc-t">حُدود موثّقة (معتمدة)</div><div class="rc-d">مصدر تجريبي إلزامي (دراسة/مرجع) للاستخدام التشخيصي.</div></label>' +
                '</div><div class="grid2">' +
                fld('المصدر', '<input type="text" data-f="cutoffs.source" value="' + esc(cu.source) + '"' + (cu.kind === 'validated' ? ' placeholder="إلزامي عند الحدود الموثّقة"' : '') + '>', '', cu.kind === 'validated') +
                fld('الفئة السكانية', '<input type="text" data-f="cutoffs.population" value="' + esc(cu.population) + '" placeholder="مثال: من هم في العقد الثاني">', '', cu.kind === 'validated') +
                fld('الحساسية', '<input type="text" data-f="cutoffs.sensitivity" value="' + esc(cu.sensitivity) + '" placeholder="مثال: حد فحص أولي">', '', false) +
                fld('نطاق الاستخدام', '<input type="text" data-f="cutoffs.usage" value="' + esc(cu.usage) + '" placeholder="مثال: الفحص الأولي لا التشخيص النهائي">', '', false) +
                '</div>';
        }
        return html;
    }
    function stdTypeOpts(cur) {
        var html = '';
        for (var i = 0; i < E.STANDARD_TYPES.length; i++) {
            var t = E.STANDARD_TYPES[i];
            html += '<option value="' + t + '"' + (t === cur ? ' selected' : '') + '>' + esc(E.STANDARD_TYPE_LABELS[t] || t) + '</option>';
        }
        return html;
    }

    /* ========================= الخطوة 8: المراجعة ========================= */
    function stepReview() {
        var s = san();
        var html = '<div id="valArea"></div>';
        html += '<div class="chips">' + domChips() +
            '<span class="info-chip">' + state.scale.items.length + ' بنود</span>' +
            '<span class="info-chip">' + state.scale.dimensions.length + ' أبعاد</span>' +
            '<span class="info-chip">' + (state.editingId ? 'إصدار v' + (state.scale.version || 1) : 'جديد (لم يُنشر)') + '</span>' +
            '</div>';

        html += '<div class="section-sub">معاينة التطبيق</div>';
        html += '<div class="preview-grid">';
        for (var i = 0; i < s.items.length; i++) {
            var opts = E.optionsFor(s, i);
            var cur = state.preview[i];
            var sel = '<select data-prev="' + i + '"><option value="">— لم يُجب —</option>';
            for (var j = 0; j < opts.length; j++) {
                sel += '<option value="' + j + '"' + (cur === j ? ' selected' : '') + '>' + esc(opts[j].label) + ' (' + fmt(opts[j].score) + ')</option>';
            }
            sel += '</select>';
            html += '<div class="preview-item"><div class="pt">' + (i + 1) + '. ' + esc(s.items[i].text || 'بند بلا نص') + '</div>' + sel + '</div>';
        }
        html += '</div>';
        html += '<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-act="runPreview">احسب المعاينة الآن</button></div>';
        html += '<div id="previewResult"></div>';

        html += '<div class="section-sub">النشر</div>';
        html += '<div class="empty-note" style="margin-bottom:16px">النشر يحفظ المقياس في "مقاييسي المخصصة" ويمكن تطبيقه على المرضى من صفحة اختيار المقياس. أي تعديل لاحق يرفع رقم الإصدار تلقائيًا مع حفظ نسخة الجلسات السابقة.</div>';
        html += '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
            '<button class="btn btn-ok" data-act="publish">' + (state.editingId ? 'حفظ التعديلات ونشر' : 'نشر المقياس') + ' ✓</button>' +
            (state.published ? '<a class="btn btn-ghost" href="custom-test.html" onclick="localStorage.setItem(\'chosenCustomScale\',\'' + esc(state.scale.id) + '\')">اختبر المقياس ←</a>' : '') +
            (state.published ? '<a class="btn btn-ghost" href="tools-severity-scale.html">عرض في قائمة اختيار المقياس ←</a>' : '') +
            '</div>';
        return html;
    }

    function renderValidation() {
        var el = $('valArea');
        if (!el) return;
        var v = validateNow();
        var html = '';
        if (v.errors.length) html += valBox('err', 'أخطاء تمنع النشر (' + v.errors.length + ')', v.errors);
        if (v.warnings.length) html += valBox('warn', 'تنبيهات (' + v.warnings.length + ')', v.warnings);
        if (!v.errors.length && !v.warnings.length) html += valBox('ok', 'التحقق النهائي', ['لا أخطاء ولا تنبيهات — المقياس جاهز للنشر.']);
        else if (!v.errors.length) html += valBox('ok', 'لا توجد أخطاء', ['يمكن النشر رغم التنبيهات الواردة أعلاه.']);
        el.innerHTML = html;
    }

    function valBox(kind, title, list) {
        var icon = kind === 'err' ? '⛔' : (kind === 'warn' ? '⚠️' : '✅');
        var html = '<div class="val-box val-' + (kind === 'ok' ? 'ok' : kind) + '"><h5>' + icon + ' ' + esc(title) + '</h5><ul>';
        for (var i = 0; i < list.length; i++) html += '<li>' + esc(list[i]) + '</li>';
        return html + '</ul></div>';
    }

    function domChips() {
        var s = san();
        var dom = E.domainOf(s);
        var discrete = E.isDiscreteDomain(s);
        return '<span class="info-chip">النطاق: ' + fmt(dom.min) + ' ← ' + fmt(dom.max) + '</span>' +
            '<span class="info-chip">النوع: ' + (discrete ? 'أعداد صحيحة' : 'قيم متصلة') + '</span>' +
            '<span class="info-chip">الطريقة: ' + esc(E.methodLabel(E.effectiveMethod(s))) + '</span>';
    }
    function rangeText() {
        var s = san();
        if (!s) return '-';
        var dom = E.domainOf(s);
        return fmt(dom.min) + ' - ' + fmt(dom.max);
    }

    /* ========================= المعاينة ========================= */
    function runPreview() {
        var s = san();
        var answers = {};
        var answered = 0;
        for (var i = 0; i < s.items.length; i++) {
            var v = state.preview[i];
            if (v === undefined || v === null || v === '') continue;
            answers[i] = v;
            answered++;
        }
        var comp = E.checkCompleteness(s, answers);
        var out = $('previewResult');
        if (!comp.ok) {
            out.innerHTML = valBox('warn', 'المعاينة غير مكتملة', [comp.reason || 'أجب عن البنود المطلوبة للمعاينة (' + answered + ' من ' + s.items.length + ').']);
            return;
        }
        var r = E.compute(s, answers);
        if (!r.ok) {
            out.innerHTML = valBox('err', 'تعذّر احتساب المعاينة', r.errors);
            return;
        }
        var color = r.category && r.category.color ? r.category.color : '#2563eb';
        var scoreStr = r.score === null || r.score === undefined ? '—' : fmt(r.score);
        var html = '<div class="result-box"><div class="result-main">' +
            '<div class="score-circle" style="background:' + esc(color) + '"><span class="v">' + esc(scoreStr) + '</span><span class="l">' + (r.avg !== null && r.avg !== undefined ? 'متوسط' : 'الدرجة') + '</span></div>' +
            '<div class="result-meta"><h4>' + (r.category ? esc(r.category.label) : 'بلا فئة تفسير') + '</h4>' +
            '<p>الدرجة الخام: <b>' + esc(fmt(r.raw)) + '</b> من ' + fmt(r.min) + ' إلى ' + fmt(r.max) + ' — المجاب: ' + r.answered + ' من ' + r.total + ' بنود' +
            (r.pct !== null && r.pct !== undefined ? ' — النسبة: ' + esc(fmt(r.pct)) + '%' : '') + '</p>';
        if (r.standard && r.standard.available) html += '<p>الدرجة المعيارية: <b>' + esc(fmt(r.standard.value)) + '</b> (' + esc(E.STANDARD_TYPE_LABELS[s.standard.type] || s.standard.type) + ')</p>';
        else if (r.standard && r.standard.available === false && r.standard.reason) html += '<p>المعيار: ' + esc(r.standard.reason) + '</p>';
        html += '</div></div>';
        if (r.dimensions && r.dimensions.length) {
            html += '<div class="dim-bars">';
            for (var d = 0; d < r.dimensions.length; d++) {
                var dm = r.dimensions[d];
                var pctW = (dm.max > dm.min) ? Math.max(2, Math.min(100, ((dm.score - dm.min) / (dm.max - dm.min)) * 100)) : 50;
                html += '<div class="dim-bar"><span class="nm">' + esc(dm.name || ('بُعد ' + (d + 1))) + '</span>' +
                    '<span class="track"><span class="fill" style="width:' + pctW + '%"></span></span>' +
                    '<span class="vv">' + esc(fmt(dm.score)) + (dm.category ? ' · ' + esc(dm.category.label) : '') + '</span></div>';
            }
            html += '</div>';
        }
        if (r.notes && r.notes.length) {
            html += '<div class="dim-bars">';
            for (var n = 0; n < r.notes.length; n++) html += '<div class="dim-bar"><span style="font-size:12.5px;color:var(--muted)">• ' + esc(r.notes[n]) + '</span></div>';
            html += '</div>';
        }
        html += '</div>';
        out.innerHTML = html;
    }

    /* ========================= النشر والإدارة ========================= */
    function publish() {
        var v = validateNow();
        renderValidation();
        if (v.errors.length) {
            toast('لا يمكن النشر: ' + v.errors.length + ' أخطاء يجب إصلاحها.', 'bad');
            var area = $('valArea');
            if (area) area.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        var r = E.upsertScale(state.scale);
        if (!r.ok) { toast(r.error, 'bad'); return; }
        state.scale = clone(r.scale);
        state.editingId = r.scale.id;
        state.published = true;
        clearDraft();
        history.replaceState(null, '', 'scale-builder.html?id=' + r.scale.id);
        var note = $('draftNote'); if (note) note.classList.add('hidden');
        toast('تم النشر بنجاح — الإصدار v' + r.scale.version + '.', 'ok');
        var el = $('saveState');
        if (el) { el.textContent = 'منشور — الإصدار v' + r.scale.version; el.classList.remove('dirty'); }
        renderStep();
        renderManage();
    }

    function renderManage() {
        var list = E.loadScales();
        var el = $('manageList');
        if (!list.length) {
            el.innerHTML = '<div class="manage-empty">لا توجد مقاييس مخصصة بعد — ابدأ بـ "+ مقياس جديد" أو استورد مقياسًا لتراه هنا.</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            var v = E.validateScale(s);
            var okBadge = v.errors.length ? '<span class="badge" style="background:#fef2f2;color:#b91c1c;border-color:#fecaca">' + v.errors.length + ' أخطاء</span>' : '<span class="badge" style="background:#f0fdf4;color:#15803d;border-color:#bbf7d0">جاهز</span>';
            html += '<div class="mscale"><h4>' + esc(s.name) + '</h4>' +
                '<div class="meta"><span>v' + (s.version || 1) + '</span><span>' + s.items.length + ' بنود</span><span>' + esc(E.methodLabel(s.scoring.method)) + '</span><span>' + esc(s.updatedAt ? s.updatedAt.slice(0, 10) : (s.createdAt || '')) + '</span>' + okBadge + '</div>' +
                '<div class="row">' +
                '<button class="btn btn-sm btn-ghost" data-act="editScale" data-id="' + esc(s.id) + '">تعديل</button>' +
                '<button class="btn btn-sm btn-soft" data-act="dupScale" data-id="' + esc(s.id) + '">نسخ</button>' +
                (v.errors.length ? '' : '<button class="btn btn-sm btn-ok" style="padding:10px 16px;font-size:13px" data-act="openTest" data-id="' + esc(s.id) + '">اختبار ←</button>') +
                '<button class="btn btn-sm btn-danger" data-act="delScale" data-id="' + esc(s.id) + '">حذف</button>' +
                '</div></div>';
        }
        el.innerHTML = html;
    }

    function exportAll() {
        var list = E.loadScales();
        if (!list.length) { toast('لا توجد مقاييس للتصدير.', 'bad'); return; }
        var blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), scales: list }, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'custom-scales.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
        toast('تم تصدير ' + list.length + ' مقاييس.', 'ok');
    }

    document.addEventListener('change', function (e) {
        var el = e.target;
        if (!el || !el.getAttribute) return;
        var p = el.getAttribute('data-prev');
        if (p === null) return;
        state.preview[p] = el.value === '' ? null : Number(el.value);
        runPreview();
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
