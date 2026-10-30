/*!
 * DIAGNO-ASSIST — محرك المقاييس النفسية المخصصة
 * scale-engine.js
 * يعمل في المتصفح (window.ScaleEngine) وفي Node (module.exports) للاختبارات الوحداتية.
 * لا يمس أي بيانات موجودة؛ يستخدم مفاتيح تخزين خاصة بالمقاييس المخصصة فقط.
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module && module.exports) {
        module.exports = factory();
    } else {
        root.ScaleEngine = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ================== ثوابت ================== */
    var SCALES_KEY = 'diagCustomScales';
    var SESSIONS_PREFIX = 'sessionsCustom_';
    var DRAFT_PREFIX = 'draftCustom_';

    var METHODS = ['sum', 'mean', 'dimensions', 'standard', 'cutoffs'];
    var METHOD_LABELS = {
        sum: 'مجموع الدرجات',
        mean: 'متوسط الدرجات',
        dimensions: 'التصحيح وفق الأبعاد الفرعية',
        standard: 'التصحيح المعياري',
        cutoffs: 'نقاط القطع السريرية'
    };
    var METHOD_DESCS = {
        sum: 'تُجمع درجات إجابات البنود للحصول على الدرجة الكلية، وتُقارن بالحدود التي تحددها.',
        mean: 'تُحسب النتيجة من متوسط درجات البنود التي تمت الإجابة عنها وفق سياسة الإجابات الناقصة.',
        dimensions: 'تُحسب درجة كل بُعد فرعي على حدة وتُعرض منفصلة عن الدرجة الكلية.',
        standard: 'تُحوّل الدرجة الخام إلى درجة معيارية (T أو مئينية...) باستخدام جدول تحويل أو معادلة موثقة.',
        cutoffs: 'تُجمع الدرجات وتُقارن بنقاط قطع سريرية موثقة ذات مصدر وفئة سكانية محددة.'
    };
    var MISSING_TYPES = ['all', 'count', 'percent', 'rule'];
    var MISSING_LABELS = {
        all: 'اشتراط الإجابة عن جميع البنود',
        count: 'السماح بعدد معين من البنود غير المجابة',
        percent: 'السماح بنسبة معينة من البنود غير المجابة',
        rule: 'قاعدة تعويض/سماح موثقة للمقياس'
    };
    var STANDARD_TYPES = ['T', 'percentile', 'z', 'other'];
    var STANDARD_TYPE_LABELS = {
        T: 'درجة T',
        percentile: 'الرتبة المئينية',
        z: 'درجة Z',
        other: 'درجة معيارية أخرى'
    };
    var PALETTE = ['#dc2626', '#d97706', '#ca8a04', '#2563eb', '#16a34a', '#7c3aed', '#0891b2', '#be185d'];

    /* ================== أدوات عامة ================== */
    function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
    function isObj(v) { return v !== null && typeof v === 'object' && !isArr(v); }
    function str(v, d) { return typeof v === 'string' ? v : (d === undefined ? '' : d); }
    function num(v, d) {
        if (typeof v === 'number' && isFinite(v)) return v;
        if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
        return d === undefined ? 0 : d;
    }
    function round(v, p) {
        var f = Math.pow(10, p === undefined ? 2 : p);
        return Math.round(num(v) * f) / f;
    }
    function uid() {
        return 'cs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function todayStr(d) {
        d = d || new Date();
        return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
    }
    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function uniq(arr) {
        var out = [];
        for (var i = 0; i < arr.length; i++) if (out.indexOf(arr[i]) === -1) out.push(arr[i]);
        return out;
    }

    /* ================== طبقة التخزين (قابلة للاستبدال للاختبارات) ================== */
    var memoryStore = {};
    var liveObject = null;
    var useMemory = false;
    function backend() {
        if (liveObject) {
            return {
                getItem: function (k) { return Object.prototype.hasOwnProperty.call(liveObject, k) ? liveObject[k] : null; },
                setItem: function (k, v) { liveObject[k] = String(v); },
                removeItem: function (k) { try { delete liveObject[k]; } catch (e) { liveObject[k] = undefined; } }
            };
        }
        if (useMemory) {
            return {
                getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null; },
                setItem: function (k, v) { memoryStore[k] = String(v); },
                removeItem: function (k) { delete memoryStore[k]; }
            };
        }
        try {
            if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
        } catch (e) { /* قد يكون محجوبًا */ }
        useMemory = true;
        return backend();
    }
    function setStorageForTests(store) {
        liveObject = null;
        if (store === null) { useMemory = false; memoryStore = {}; return; }
        if (store && typeof store === 'object') { liveObject = store; return; }
        useMemory = true;
        memoryStore = {};
    }

    /* ================== تخزين المقاييس ================== */
    function rawList() {
        var txt = null;
        try { txt = backend().getItem(SCALES_KEY); } catch (e) { txt = null; }
        if (!txt) return [];
        var data;
        try { data = JSON.parse(txt); } catch (e) { return []; }
        if (!isArr(data)) return [];
        var out = [];
        for (var i = 0; i < data.length; i++) {
            var s = sanitizeScale(data[i]);
            if (s) out.push(s);
        }
        return out;
    }
    function loadScales() { return rawList(); }
    function getScale(id) {
        if (!id) return null;
        var list = rawList();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }
    function persist(list) {
        try {
            backend().setItem(SCALES_KEY, JSON.stringify(list));
            return { ok: true };
        } catch (e) {
            return { ok: false, error: 'تعذّر الحفظ: مساحة التخزين في المتصفح ممتلئة أو محجوبة. احذف بيانات غير ضرورية وحاول مجددًا.' };
        }
    }
    function upsertScale(scale) {
        if (!isObj(scale)) return { ok: false, error: 'بيانات المقياس غير صالحة.' };
        if (!scale.id) scale.id = uid();
        var list = rawList();
        var idx = -1;
        for (var i = 0; i < list.length; i++) if (list[i].id === scale.id) { idx = i; break; }
        var clean = sanitizeScale(scale);
        if (!clean) return { ok: false, error: 'تعذّر تجهيز بيانات المقياس للحفظ.' };
        clean.updatedAt = new Date().toISOString();
        if (idx >= 0) {
            var prev = list[idx];
            clean.version = (num(prev.version, 1) | 0) + 1;
            clean.createdAt = prev.createdAt || clean.createdAt;
            clean.createdAtISO = prev.createdAtISO || clean.createdAtISO;
            list[idx] = clean;
        } else {
            clean.version = 1;
            if (!clean.createdAt) { clean.createdAt = todayStr(); clean.createdAtISO = new Date().toISOString(); }
            list.push(clean);
        }
        var r = persist(list);
        if (!r.ok) return r;
        return { ok: true, scale: clean };
    }
    function deleteScale(id) {
        var list = rawList();
        var next = [];
        for (var i = 0; i < list.length; i++) if (list[i].id !== id) next.push(list[i]);
        if (next.length === list.length) return { ok: false, error: 'المقياس غير موجود.' };
        return persist(next);
    }

    /* ================== تطبيع / معالجة بيانات قديمة أو ناقصة ================== */
    function sanitizeScale(raw) {
        if (!isObj(raw)) return null;
        var id = str(raw.id).trim();
        var name = str(raw.name).trim();
        if (!id || !name) return null;
        if (!isArr(raw.items) || raw.items.length === 0) return null;

        var sets = [];
        if (isArr(raw.optionSets)) {
            for (var i = 0; i < raw.optionSets.length; i++) {
                var os = raw.optionSets[i];
                if (!isObj(os) || !isArr(os.options)) continue;
                var opts = [];
                for (var j = 0; j < os.options.length; j++) {
                    var o = os.options[j];
                    if (!isObj(o)) continue;
                    opts.push({ label: str(o.label, 'خيار ' + (j + 1)), score: num(o.score, 0) });
                }
                if (!opts.length) continue;
                sets.push({ id: str(os.id, 'os' + (sets.length + 1)), name: str(os.name, 'مجموعة ' + (sets.length + 1)), options: opts });
            }
        }
        if (!sets.length) {
            sets = [{
                id: 'os1', name: 'الافتراضي', options: [
                    { label: 'لا', score: 0 },
                    { label: 'نعم', score: 1 }
                ]
            }];
        }
        var defaultId = str(raw.defaultOptionSetId);
        var defOk = false;
        for (var d = 0; d < sets.length; d++) if (sets[d].id === defaultId) defOk = true;
        if (!defOk) defaultId = sets[0].id;

        var items = [];
        for (var m = 0; m < raw.items.length; m++) {
            var it = raw.items[m];
            if (!isObj(it)) continue;
            var setRef = str(it.optionSetId);
            var setOk = false;
            for (var s2 = 0; s2 < sets.length; s2++) if (sets[s2].id === setRef) setOk = true;
            var reverseMap = null;
            if (isArr(it.reverseMap)) {
                reverseMap = [];
                for (var r2 = 0; r2 < it.reverseMap.length; r2++) reverseMap.push(num(it.reverseMap[r2], NaN));
            }
            items.push({
                text: str(it.text),
                reverse: !!it.reverse,
                optionSetId: setOk ? setRef : null,
                dimensionId: str(it.dimensionId) || null,
                reverseMap: reverseMap
            });
        }
        if (!items.length) return null;

        var dims = [];
        if (isArr(raw.dimensions)) {
            for (var q = 0; q < raw.dimensions.length; q++) {
                var dm = raw.dimensions[q];
                if (!isObj(dm)) continue;
                var ix = [];
                if (isArr(dm.itemIndexes)) {
                    for (var z = 0; z < dm.itemIndexes.length; z++) {
                        var n = Math.floor(num(dm.itemIndexes[z], -1));
                        if (n >= 0 && n < items.length) ix.push(n);
                    }
                }
                dims.push({
                    id: str(dm.id, 'dim' + (dims.length + 1)),
                    name: str(dm.name, 'بُعد ' + (dims.length + 1)),
                    description: str(dm.description),
                    itemIndexes: ix,
                    scoring: dm.scoring === 'mean' ? 'mean' : 'sum',
                    categories: sanitizeCats(dm.categories)
                });
            }
        }

        var scoring = isObj(raw.scoring) ? raw.scoring : {};
        var method = str(scoring.method, 'sum');
        if (METHODS.indexOf(method) === -1) method = 'sum';

        var std = isObj(raw.standard) ? raw.standard : {};
        var table = null;
        if (isArr(std.table)) {
            table = [];
            for (var t = 0; t < std.table.length; t++) {
                var row = std.table[t];
                if (!isObj(row)) continue;
                table.push({ rawMin: num(row.rawMin, 0), rawMax: num(row.rawMax, 0), value: num(row.value, 0) });
            }
            if (!table.length) table = null;
        }
        var equation = null;
        if (isObj(std.equation) && isFinite(Number(std.equation.a)) && std.equation.a !== '' && std.equation.a !== null) {
            equation = { a: num(std.equation.a, 1), b: num(std.equation.b, 0) };
        }
        var standard = {
            enabled: !!std.enabled,
            type: STANDARD_TYPES.indexOf(str(std.type)) >= 0 ? str(std.type) : 'T',
            source: str(std.source),
            date: str(std.date),
            referenceGroup: str(std.referenceGroup),
            selectionRule: str(std.selectionRule),
            sex: str(std.sex),
            ageMin: std.ageMin === '' || std.ageMin === undefined || std.ageMin === null ? '' : num(std.ageMin, ''),
            ageMax: std.ageMax === '' || std.ageMax === undefined || std.ageMax === null ? '' : num(std.ageMax, ''),
            min: std.min === undefined || std.min === null || std.min === '' ? 0 : num(std.min, 0),
            max: std.max === undefined || std.max === null || std.max === '' ? 100 : num(std.max, 100),
            table: table,
            equation: equation
        };

        var cut = isObj(raw.cutoffs) ? raw.cutoffs : {};
        var cutoffs = {
            enabled: !!cut.enabled,
            kind: cut.kind === 'validated' ? 'validated' : 'custom',
            source: str(cut.source),
            population: str(cut.population),
            sensitivity: str(cut.sensitivity),
            usage: str(cut.usage)
        };

        var mp = isObj(raw.missingPolicy) ? raw.missingPolicy : {};
        var mpType = str(mp.type, 'all');
        if (MISSING_TYPES.indexOf(mpType) === -1) mpType = 'all';

        return {
            id: id,
            version: Math.max(1, num(raw.version, 1) | 0),
            createdAt: str(raw.createdAt, todayStr()),
            createdAtISO: str(raw.createdAtISO, ''),
            updatedAt: str(raw.updatedAt, ''),
            name: name,
            description: str(raw.description),
            instructions: str(raw.instructions),
            targetGroup: str(raw.targetGroup),
            author: str(raw.author),
            icon: str(raw.icon).trim() || '📝',
            optionSets: sets,
            defaultOptionSetId: defaultId,
            items: items,
            dimensions: dims,
            scoring: {
                method: method,
                meanMode: scoring.meanMode === 'all' ? 'all' : 'answered',
                includeDimensions: scoring.includeDimensions === undefined ? true : !!scoring.includeDimensions
            },
            standard: standard,
            cutoffs: cutoffs,
            categories: sanitizeCats(raw.categories),
            missingPolicy: {
                type: mpType,
                maxCount: Math.max(0, Math.floor(num(mp.maxCount, 0))),
                maxPercent: Math.min(100, Math.max(0, num(mp.maxPercent, 0))),
                ruleText: str(mp.ruleText)
            }
        };
    }
    function sanitizeCats(cats) {
        var out = [];
        if (!isArr(cats)) return out;
        for (var i = 0; i < cats.length; i++) {
            var c = cats[i];
            if (!isObj(c)) continue;
            var label = str(c.label).trim();
            if (!label) continue;
            var hasMax = !(c.max === undefined || c.max === null || c.max === '');
            out.push({
                label: label,
                min: num(c.min, 0),
                max: hasMax ? num(c.max, NaN) : null,
                color: str(c.color, PALETTE[Math.min(i, PALETTE.length - 1)])
            });
        }
        return out;
    }

    /* ================== خيارات الإجابة ================== */
    function optionSetOf(scale, item) {
        var want = item && item.optionSetId;
        var sets = scale.optionSets || [];
        for (var i = 0; i < sets.length; i++) if (sets[i].id === want) return sets[i];
        for (var j = 0; j < sets.length; j++) if (sets[j].id === scale.defaultOptionSetId) return sets[j];
        return sets[0] || null;
    }
    function optionsFor(scale, itemIndex) {
        var it = (scale.items || [])[itemIndex];
        var os = optionSetOf(scale, it);
        return os ? os.options : [];
    }
    function defaultOptions(scale) {
        var sets = scale.optionSets || [];
        for (var i = 0; i < sets.length; i++) if (sets[i].id === scale.defaultOptionSetId) return sets[i].options;
        return sets[0] ? sets[0].options : [];
    }
    function isMonotonicContiguous(scores) {
        if (!isArr(scores) || scores.length < 2) return scores && scores.length === 1;
        for (var i = 0; i < scores.length; i++) if (!isFinite(Number(scores[i]))) return false;
        var asc = true, desc = true;
        for (var j = 1; j < scores.length; j++) {
            var diff = scores[j] - scores[j - 1];
            if (diff > 0) desc = false;
            if (diff < 0) asc = false;
        }
        if (!asc && !desc) return false;
        var step = Math.abs(scores[1] - scores[0]);
        if (step === 0) return uniq(scores).length === 1;
        for (var k = 1; k < scores.length; k++) {
            if (Math.abs(Math.abs(scores[k] - scores[k - 1]) - step) > 1e-9) return false;
        }
        return true;
    }
    function autoReverseMap(scores) {
        if (!isArr(scores) || !scores.length) return null;
        if (!isMonotonicContiguous(scores)) return null;
        var mn = Math.min.apply(null, scores.map(Number));
        var mx = Math.max.apply(null, scores.map(Number));
        var out = [];
        for (var i = 0; i < scores.length; i++) out.push(round(mn + mx - Number(scores[i]), 6));
        return out;
    }
    function reverseMapFor(scale, itemIndex) {
        var it = (scale.items || [])[itemIndex];
        if (!it || !it.reverse) return null;
        var opts = optionsFor(scale, itemIndex);
        var scores = opts.map(function (o) { return Number(o.score); });
        if (isArr(it.reverseMap) && it.reverseMap.length === opts.length) {
            var ok = true;
            for (var i = 0; i < it.reverseMap.length; i++) if (!isFinite(Number(it.reverseMap[i]))) ok = false;
            if (ok) return it.reverseMap.map(Number);
        }
        var auto = autoReverseMap(scores);
        return auto;
    }
    function scoreFor(scale, itemIndex, optionIndex) {
        var opts = optionsFor(scale, itemIndex);
        if (optionIndex < 0 || optionIndex >= opts.length) return null;
        var base = Number(opts[optionIndex].score);
        var it = (scale.items || [])[itemIndex];
        if (!it || !it.reverse) return base;
        var map = reverseMapFor(scale, itemIndex);
        if (!map) return base; /* لا يوجد خريطة عكس صالحة — يُفضَّل منع الحفظ على ذلك */
        if (optionIndex >= map.length) return base;
        return Number(map[optionIndex]);
    }

    /* ================== نطاقات النتائج ================== */
    function usedScoreValues(scale) {
        var vals = [];
        var sets = scale.optionSets || [];
        for (var i = 0; i < sets.length; i++) {
            for (var j = 0; j < sets[i].options.length; j++) vals.push(Number(sets[i].options[j].score));
        }
        for (var k = 0; k < (scale.items || []).length; k++) {
            var m = reverseMapFor(scale, k);
            if (m) for (var n = 0; n < m.length; n++) vals.push(Number(m[n]));
        }
        return vals;
    }
    function itemRange(scale, itemIndex) {
        var opts = optionsFor(scale, itemIndex);
        var scores = opts.map(function (o) { return Number(o.score); });
        var it = (scale.items || [])[itemIndex];
        if (it && it.reverse) {
            var map = reverseMapFor(scale, itemIndex);
            if (map) scores = map.slice();
        }
        if (!scores.length) return { min: 0, max: 0 };
        return { min: Math.min.apply(null, scores), max: Math.max.apply(null, scores) };
    }
    function indexesOfDimension(scale, dim) {
        var out = [];
        var idx = dim.itemIndexes || [];
        for (var i = 0; i < idx.length; i++) {
            var n = Math.floor(num(idx[i], -1));
            if (n >= 0 && n < scale.items.length) out.push(n);
        }
        return out;
    }
    function scaleRange(scale) {
        var mn = 0, mx = 0;
        for (var i = 0; i < scale.items.length; i++) {
            var r = itemRange(scale, i);
            mn += r.min; mx += r.max;
        }
        return { min: mn, max: mx };
    }
    function meanRange(scale) {
        var vals = usedScoreValues(scale);
        if (!vals.length) return { min: 0, max: 1 };
        return { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) };
    }
    function dimensionRange(scale, dim) {
        var idx = indexesOfDimension(scale, dim);
        if (dim.scoring === 'mean') {
            var vals = [];
            for (var i = 0; i < idx.length; i++) {
                var opts = optionsFor(scale, idx[i]);
                for (var j = 0; j < opts.length; j++) vals.push(Number(opts[j].score));
            }
            if (!vals.length) return { min: 0, max: 1 };
            return { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) };
        }
        var mn = 0, mx = 0;
        for (var k = 0; k < idx.length; k++) { var r = itemRange(scale, idx[k]); mn += r.min; mx += r.max; }
        return { min: mn, max: mx };
    }
    function effectiveMethod(scale) {
        var m = (scale.scoring && scale.scoring.method) || 'sum';
        return m === 'cutoffs' ? 'sum' : m;
    }
    function methodOf(scale) { return (scale.scoring && scale.scoring.method) || 'sum'; }
    function domainOf(scale) {
        var em = effectiveMethod(scale);
        if (em === 'mean') return meanRange(scale);
        if (em === 'standard') return { min: num(scale.standard.min, 0), max: num(scale.standard.max, 100) };
        return scaleRange(scale);
    }
    function isDiscreteDomain(scale) {
        var em = effectiveMethod(scale);
        if (em === 'mean') return false;
        var dom = domainOf(scale);
        if (!Number.isInteger(dom.min) || !Number.isInteger(dom.max)) return false;
        if (em === 'standard') {
            var vals = [];
            if (scale.standard.table) for (var t = 0; t < scale.standard.table.length; t++) vals.push(Number(scale.standard.table[t].value));
            if (!vals.length) return false;
            for (var v = 0; v < vals.length; v++) if (!Number.isInteger(vals[v])) return false;
            return true;
        }
        var used = usedScoreValues(scale);
        for (var i = 0; i < used.length; i++) if (!Number.isInteger(used[i])) return false;
        return true;
    }

    /* ================== فئات التفسير ================== */
    function deriveCategories(scale, cats, domain, discrete) {
        if (!isArr(cats) || !cats.length) return [];
        var list = cats.slice().sort(function (a, b) { return a.min - b.min; });
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var isLast = i === list.length - 1;
            var hasMax = list[i].max !== null && list[i].max !== undefined && isFinite(Number(list[i].max));
            var max;
            if (hasMax && !isLast) max = Number(list[i].max);
            else if (isLast) max = domain.max;
            else if (discrete) max = Math.min(domain.max, Number(list[i + 1].min) - 1);
            else max = Number(list[i + 1].min);
            var inclusive = discrete || isLast;
            out.push({
                label: list[i].label,
                min: Number(list[i].min),
                max: Number(max),
                inclusive: inclusive,
                color: list[i].color || PALETTE[i % PALETTE.length]
            });
        }
        return out;
    }
    function derivedCategoriesOf(scale) {
        return deriveCategories(scale, scale.categories, domainOf(scale), isDiscreteDomain(scale));
    }
    function categoryFor(cats, value) {
        if (!isArr(cats) || !cats.length) return null;
        var v = Number(value);
        var first = cats[0], last = cats[cats.length - 1];
        if (v < Number(first.min)) return first;
        if (v > Number(last.max)) return last;
        for (var i = 0; i < cats.length; i++) {
            var c = cats[i];
            var incl = c.inclusive !== false;
            if (incl ? v <= Number(c.max) : v < Number(c.max)) return c;
        }
        return last;
    }
    function validateCategories(cats, domain, discrete, label) {
        var errs = [];
        var w = label ? label + ': ' : '';
        if (!isArr(cats) || !cats.length) { errs.push(w + 'أضف فئة تفسير واحدة على الأقل.'); return errs; }
        for (var i = 0; i < cats.length; i++) {
            var c = cats[i];
            if (!str(c.label).trim()) errs.push(w + 'الفئة رقم ' + (i + 1) + ' بلا اسم.');
            if (!isFinite(Number(c.min))) errs.push(w + 'الفئة "' + str(c.label, i + 1) + '" لها حد أدنى غير رقمي.');
            if (c.max === null || c.max === undefined || c.max === '' || !isFinite(Number(c.max))) {
                errs.push(w + 'الفئة "' + str(c.label, i + 1) + '": حدّد الحد الأعلى للفرجة (حقل "إلى").');
                continue;
            }
            if (Number(c.max) < Number(c.min)) errs.push(w + 'الفئة "' + str(c.label) + '": الحد الأعلى أقل من الحد الأدنى.');
            if (Number(c.min) < domain.min || Number(c.max) > domain.max) {
                errs.push(w + 'مدى الفئة "' + str(c.label) + '" خارج نطاق النتيجة الممكن (' + domain.min + ' إلى ' + domain.max + ').');
            }
        }
        var sorted = cats.slice().sort(function (a, b) { return Number(a.min) - Number(b.min); });
        if (Number(sorted[0].min) !== Number(domain.min)) {
            errs.push(w + 'أول فئة يجب أن تبدأ من الحد الأدنى للنتيجة (' + domain.min + ')، وقيمتها الحالية ' + sorted[0].min + '.');
        }
        var lastOne = cats.slice().sort(function (a, b) { return Number(b.max) - Number(a.max); })[0];
        if (lastOne && isFinite(Number(lastOne.max)) && Number(lastOne.max) !== Number(domain.max)) {
            errs.push(w + 'آخر فئة يجب أن تنتهي عند الحد الأقصى للنتيجة (' + domain.max + ')، وقيمتها الحالية ' + lastOne.max + '.');
        }
        for (var j = 1; j < sorted.length; j++) {
            var prevMin = Number(sorted[j - 1].min);
            var prevMax = Number(sorted[j - 1].max);
            var curMin = Number(sorted[j].min);
            if (!isFinite(prevMax)) continue;
            if (discrete) {
                if (curMin <= prevMax) errs.push(w + 'فئتان متداخلتان: "' + sorted[j - 1].label + '" (تنتهي ' + prevMax + ') و"' + sorted[j].label + '" (تبدأ ' + curMin + ').');
                else if (curMin !== prevMax + 1) errs.push(w + 'فجوة غير مقصودة بين "' + sorted[j - 1].label + '" (تنتهي ' + prevMax + ') و"' + sorted[j].label + '" (تبدأ ' + curMin + ').');
            } else {
                if (curMin < prevMax) errs.push(w + 'فئتان متداخلتان: "' + sorted[j - 1].label + '" (تنتهي ' + prevMax + ') و"' + sorted[j].label + '" (تبدأ ' + curMin + ').');
                else if (curMin > prevMax) errs.push(w + 'فجوة غير مقصودة بين "' + sorted[j - 1].label + '" (تنتهي ' + prevMax + ') و"' + sorted[j].label + '" (تبدأ ' + curMin + ').');
            }
            if (prevMin > prevMax) errs.push(w + 'فئة "' + sorted[j - 1].label + '": الحد الأعلى أقل من الحد الأدنى.');
        }
        return uniq(errs);
    }

    /* ================== التحقق من صحة تعريف المقياس ================== */
    function validateScale(scale) {
        var errors = [], warnings = [];
        if (!isObj(scale)) return { errors: ['بيانات المقياس غير صالحة.'], warnings: [] };
        if (!str(scale.name).trim()) errors.push('اسم المقياس مطلوب.');

        var sets = scale.optionSets || [];
        if (!sets.length) errors.push('أنشئ مجموعة خيارات إجابة واحدة على الأقل.');
        var setIds = {};
        for (var i = 0; i < sets.length; i++) {
            var os = sets[i];
            setIds[os.id] = true;
            if (!os.options || !os.options.length) errors.push('مجموعة الخيارات "' + os.name + '" لا تحتوي على خيارات.');
            else {
                for (var j = 0; j < os.options.length; j++) {
                    if (!str(os.options[j].label).trim()) errors.push('في مجموعة "' + os.name + '": خيار رقم ' + (j + 1) + ' بلا اسم.');
                    if (!isFinite(Number(os.options[j].score))) errors.push('في مجموعة "' + os.name + '": درجة الخيار "' + os.options[j].label + '" ليست رقمًا صالحًا.');
                }
            }
        }
        if (sets.length && !setIds[scale.defaultOptionSetId]) errors.push('مجموعة الخيارات الافتراضية غير محددة بشكل صحيح.');

        var items = scale.items || [];
        if (!items.length) errors.push('أضف بندًا واحدًا على الأقل.');
        var texts = {};
        for (var m = 0; m < items.length; m++) {
            var it = items[m];
            if (!str(it.text).trim()) errors.push('البند رقم ' + (m + 1) + ' نصه فارغ.');
            var t = str(it.text).trim();
            if (t && texts[t]) warnings.push('نص متكرر في البندَين رقم ' + texts[t] + ' و' + (m + 1) + '.');
            if (t) texts[t] = m + 1;
            if (it.optionSetId && !setIds[it.optionSetId]) errors.push('البند رقم ' + (m + 1) + ' مرتبط بمجموعة خيارات غير موجودة.');
            if (it.reverse) {
                var opts = optionsFor(scale, m);
                var scores = opts.map(function (o) { return Number(o.score); });
                var map = reverseMapFor(scale, m);
                if (!map) {
                    errors.push('البند رقم ' + (m + 1) + ' محدد كعكسي لكن درجات خياراته غير متسلسلة (مثل: 0/1/5) ولا توجد خريطة عكس صريحة. حدّد درجة معاكسة لكل خيار.');
                } else {
                    if (map.length !== scores.length) errors.push('البند العكسي رقم ' + (m + 1) + ': خريطة العكس لا تغطي كل الخيارات.');
                    else {
                        var a = scores.slice().sort(function (x, y) { return x - y; });
                        var b = map.slice().sort(function (x, y) { return x - y; });
                        var same = true;
                        for (var s2 = 0; s2 < a.length; s2++) if (Math.abs(a[s2] - b[s2]) > 1e-9) same = false;
                        if (!same) errors.push('البند العكسي رقم ' + (m + 1) + ': خريطة العكس يجب أن تكون تحويلًا على نفس مجموعة الدرجات الممكنة (0/1/5 ← 0/5/1 مثلًا) مع الحفاظ على النطاق.');
                    }
                }
            }
        }

        var method = methodOf(scale);
        if (METHODS.indexOf(method) === -1) errors.push('طريقة التصحيح غير معروفة.');
        var em = effectiveMethod(scale);

        if (em === 'mean') {
            if (scale.missingPolicy && scale.missingPolicy.type === 'all' && scale.scoring.meanMode === 'answered') {
                warnings.push('سياسة "الإجابة عن كل البنود" تتعارض مع "متوسط البنود المجابة فقط": عند اكتمال الإجابات يتساوى الحالان.');
            }
        }

        var dims = scale.dimensions || [];
        if (em === 'dimensions') {
            if (!dims.length) errors.push('طريقة الأبعاد الفرعية تتطلب بُعدًا فرعيًا واحدًا على الأقل.');
            for (var d = 0; d < dims.length; d++) {
                var dim = dims[d];
                if (!str(dim.name).trim()) errors.push('بُعد فرعي رقم ' + (d + 1) + ' بلا اسم.');
                var ix = indexesOfDimension(scale, dim);
                if (!ix.length) errors.push('البُعد "' + dim.name + '" لا يرتبط بأي بند.');
                else {
                    var dom = dimensionRange(scale, dim);
                    var disc = Number.isInteger(dom.min) && Number.isInteger(dom.max) && dim.scoring !== 'mean';
                    var ce = validateCategories(dim.categories, dom, disc, 'فئات البُعد "' + dim.name + '"');
                    errors = errors.concat(ce);
                }
            }
            if (!scale.categories || !scale.categories.length) {
                warnings.push('في طريقة الأبعاد الفرعية تُعرض درجات الأبعاد منفصلة ولا تُحتسب درجة كلية تفسيرية.');
            }
        } else {
            var dom2 = domainOf(scale);
            var disc2 = isDiscreteDomain(scale);
            errors = errors.concat(validateCategories(scale.categories, dom2, disc2, 'فئات التفسير'));
        }

        if (method === 'standard') {
            var st = scale.standard || {};
            if (!str(st.source).trim()) errors.push('التصحيح المعياري يتطلب تحديد مصدر المعايير.');
            if (!str(st.type).trim()) errors.push('حدّد نوع الدرجة المعيارية (T، مئينية...).');
            var hasTable = st.table && st.table.length;
            var hasEq = st.equation && isFinite(Number(st.equation.a));
            if (!hasTable && !hasEq) {
                errors.push('لا توجد جداول تحويل أو معادلة معتمدة. المقياس يحتاج إلى توفير معايير مناسبة، ويمكن استخدام طريقة أخرى متاحة للتصحيح إذا كانت ملائمة.');
            }
            if (hasTable) {
                for (var r = 0; r < st.table.length; r++) {
                    var row = st.table[r];
                    if (!isFinite(Number(row.rawMin)) || !isFinite(Number(row.rawMax)) || !isFinite(Number(row.value))) {
                        errors.push('صف جدول التحويل رقم ' + (r + 1) + ' يحتوي قيمًا غير رقمية.');
                    } else if (Number(row.rawMin) > Number(row.rawMax)) {
                        errors.push('صف جدول التحويل رقم ' + (r + 1) + ': الحد الأدنى أعلى من الأقصى.');
                    }
                }
                var rng = scaleRange(scale);
                var covered = true;
                for (var rr = rng.min; rr <= rng.max; rr++) {
                    var hit = false;
                    for (var t2 = 0; t2 < st.table.length; t2++) {
                        if (rr >= Number(st.table[t2].rawMin) && rr <= Number(st.table[t2].rawMax)) hit = true;
                    }
                    if (!hit) { covered = false; break; }
                }
                if (!covered) errors.push('جدول التحويل لا يغطي كل الدرجات الخام الممكنة (' + rng.min + ' إلى ' + rng.max + ').');
            }
            if (!str(st.referenceGroup).trim()) warnings.push('لم تُحدد الفئة المرجعية للمعايير (عمر/جنس/فئة سكانية) — تأكد من مطابقتها للحالات التي تطبّق عليها.');
            if (st.sex && !(st.ageMin === '' && st.ageMax === '')) { /* معيار مقيّد */ }
        }

        var mp = scale.missingPolicy || { type: 'all' };
        if (MISSING_TYPES.indexOf(mp.type) === -1) errors.push('سياسة الإجابات الناقصة غير معروفة.');
        else if (mp.type === 'count') {
            if (!isFinite(Number(mp.maxCount)) || Number(mp.maxCount) < 0) errors.push('حد البنود غير المجابة يجب أن يكون رقمًا غير سالب.');
            else if (Number(mp.maxCount) >= items.length && items.length > 0) errors.push('حد البنود غير المجابة (' + mp.maxCount + ') يساوي أو يتجاوز عدد البنود (' + items.length + ') — هذا يُبطل شرط الإجابة.');
        } else if (mp.type === 'percent') {
            if (!isFinite(Number(mp.maxPercent)) || Number(mp.maxPercent) < 0 || Number(mp.maxPercent) > 100) errors.push('النسبة المسموح بها من البنود غير المجابة يجب أن تكون بين 0 و100.');
            else if (Number(mp.maxPercent) >= 100) errors.push('نسبة 100% تعني السماح بعدم الإجابة عن أي بند — اختر حدًا أقل.');
        } else if (mp.type === 'rule') {
            if (!str(mp.ruleText).trim()) errors.push('قاعدة التعويض الموثقة تتطلب نص المرجع الخاص بها.');
            if (!isFinite(Number(mp.maxCount)) || Number(mp.maxCount) < 0) errors.push('قاعدة التعويض تتطلب حدًا رقميًا للبنود غير المجابة.');
            else if (Number(mp.maxCount) >= items.length && items.length > 0) errors.push('حد البنود في قاعدة التعويض يساوي أو يتجاوز عدد البنود.');
        }

        if (scale.cutoffs && scale.cutoffs.enabled) {
            if (scale.cutoffs.kind === 'validated') {
                if (!str(scale.cutoffs.source).trim()) errors.push('نقاط القطع "الموثقة" تتطلب تحديد المصدر العلمي.');
                if (!str(scale.cutoffs.population).trim()) errors.push('نقاط القطع "الموثقة" تتطلب تحديد الفئة السكانية التي تم التحقق من صلاحية الحدود لها.');
            } else {
                warnings.push('حدود التفسير الحالية مخصصة من قِبل المستخدم وليست حدودًا تشخيصية معتمدة علميًا.');
            }
            if (scale.cutoffs.usage && /تشخيص/.test(scale.cutoffs.usage) && scale.cutoffs.kind !== 'validated') {
                warnings.push('لا تخلط بين حدود الفحص الأولي والتشخيص السريري النهائي: صنّف هذه الحدود كحدود تفسير مخصصة.');
            }
        } else if (method === 'cutoffs') {
            if (!str((scale.cutoffs || {}).source).trim()) warnings.push('حدّد مصدر نقاط القطع حتى تُصنَّف كحدود موثقة، وإلا تُعامل كحدود تفسير مخصصة.');
        }

        if (items.length > 200) warnings.push('عدد البنود كبير (' + items.length + ') — تأكد من ملاءمة المقياس للتطبيق العملي.');
        return { errors: uniq(errors), warnings: uniq(warnings) };
    }

    /* ================== سياسة الإجابات الناقصة ================== */
    function checkCompleteness(scale, answers) {
        var items = scale.items || [];
        var total = items.length;
        var answered = 0;
        for (var i = 0; i < total; i++) {
            var a = answers ? answers[i] : null;
            if (a === undefined || a === null || a === '') continue;
            var opts = optionsFor(scale, i);
            var idx = Number(a);
            if (!isFinite(idx) || idx < 0 || idx >= opts.length) continue;
            answered++;
        }
        var missing = total - answered;
        var mp = scale.missingPolicy || { type: 'all' };
        var ok = false, reason = '';
        if (!total) { return { ok: false, answered: 0, missing: 0, total: 0, reason: 'لا توجد بنود في المقياس.' }; }
        if (mp.type === 'count') {
            var mc = num(mp.maxCount, 0);
            ok = missing <= mc;
            if (!ok) reason = 'يُسمح بعدم الإجابة عن ' + mc + ' بند كحد أقصى، والحالي ' + missing + '.';
        } else if (mp.type === 'percent') {
            var mpPct = num(mp.maxPercent, 0);
            var actual = (missing / total) * 100;
            ok = actual <= mpPct + 1e-9;
            if (!ok) reason = 'يُسمح بعدم الإجابة عن ' + mpPct + '% من البنود، والآن ' + round(actual, 1) + '% (' + missing + ' بند).';
        } else if (mp.type === 'rule') {
            var mc2 = num(mp.maxCount, 0);
            var hasRule = !!str(mp.ruleText).trim();
            ok = hasRule && missing <= mc2;
            if (!hasRule) reason = 'قاعدة التعويض الموثقة غير معرّفة في إعدادات المقياس.';
            else if (!ok) reason = 'قاعدة التعويض الموثقة تسمح بعدم الإجابة عن ' + mc2 + ' بند كحد أقصى، والحالي ' + missing + '.';
        } else {
            ok = missing === 0;
            if (!ok) reason = 'شرط هذا المقياس هو الإجابة عن جميع البنود (' + answered + ' من ' + total + ').';
        }
        if (scale.scoring && scale.scoring.meanMode === 'all' && missing > 0) {
            ok = false;
            reason = 'طريقة المتوسط تتطلب اكتمال الإجابات قبل الحساب (' + answered + ' من ' + total + ').';
        }
        return { ok: ok, answered: answered, missing: missing, total: total, reason: reason };
    }

    /* ================== المعايير المعيارية ================== */
    function standardFor(scale, raw) {
        var st = scale.standard || {};
        if (!st.enabled) return { available: false, reason: 'المقياس لا يستخدم تصحيحًا معياريًا.' };
        var hasTable = st.table && st.table.length;
        var hasEq = st.equation && isFinite(Number(st.equation.a));
        if (!hasTable && !hasEq) {
            return { available: false, reason: 'لا توجد جداول تحويل أو معادلات معتمدة لهذا المقياس بعد — لا يمكن إظهار درجة معيارية تقديرية. وفّر معايير مناسبة أو استخدم طريقة تصحيح أخرى.' };
        }
        if (hasTable) {
            for (var i = 0; i < st.table.length; i++) {
                var row = st.table[i];
                if (raw >= Number(row.rawMin) && raw <= Number(row.rawMax)) {
                    return { available: true, type: st.type, typeLabel: STANDARD_TYPE_LABELS[st.type] || st.type, value: round(Number(row.value), 2), source: str(st.source), via: 'جدول تحويل' };
                }
            }
            return { available: false, reason: 'لا يوجد معيار مسجّل للدرجة الخام ' + raw + ' في جدول التحويل.' };
        }
        var v = round(Number(st.equation.a) * raw + Number(st.equation.b), 2);
        var mn = num(st.min, 0), mx = num(st.max, 100);
        if (v < mn || v > mx) return { available: false, reason: 'الدرجة المعيارية المحسوبة (' + v + ') خارج النطاق المسموح (' + mn + ' إلى ' + mx + ').' };
        return { available: true, type: st.type, typeLabel: STANDARD_TYPE_LABELS[st.type] || st.type, value: v, source: str(st.source), via: 'معادلة تحويل' };
    }
    function matchReference(scale, patient) {
        var st = scale.standard || {};
        if (!st.enabled) return { checked: false, ok: true };
        var notes = [];
        var ok = true;
        if (patient) {
            if (st.sex) {
                var psex = str(patient.sex);
                if (psex && psex !== st.sex) {
                    ok = false;
                    notes.push('الفئة المرجعية للمعيار محددة لـ "' + st.sex + '" بينما بيانات المريض "' + psex + '" — لا يُطبَّق المعيار على فئة غير مطابقة.');
                }
            }
            if (!(st.ageMin === '' && st.ageMax === '') && patient.age) {
                var m = String(patient.age).match(/\d+/);
                if (m) {
                    var age = Number(m[0]);
                    if ((st.ageMin !== '' && age < num(st.ageMin, 0)) || (st.ageMax !== '' && age > num(st.ageMax, 1e9))) {
                        ok = false;
                        notes.push('الفئة العمرية للمعيار (' + st.ageMin + '–' + st.ageMax + ') لا تشمل عمر المريض (' + age + ').');
                    }
                }
            }
        }
        if (st.referenceGroup && !notes.length) notes.push('الفئة المرجعية المعلنة للمعايير: ' + st.referenceGroup + '.');
        return { checked: true, ok: ok, notes: notes };
    }

    /* ================== حساب النتيجة ================== */
    function normalizeAnswers(scale, answers) {
        var out = {};
        if (!answers) return out;
        if (isArr(answers)) {
            for (var i = 0; i < answers.length; i++) out[i] = answers[i];
            return out;
        }
        for (var k in answers) if (Object.prototype.hasOwnProperty.call(answers, k)) out[k] = answers[k];
        return out;
    }
    /* حساب نتائج الأبعاد الفرعية (يُستخدم في طريقة "الأبعاد" وعند تفعيل إظهار الأبعاد) */
    function fillDimensions(scale, ans, base) {
        for (var d = 0; d < scale.dimensions.length; d++) {
            var dim = scale.dimensions[d];
            var r = dimensionRange(scale, dim);
            var ix = indexesOfDimension(scale, dim);
            var dsum = 0, dAns = 0, dMiss = 0;
            for (var k = 0; k < ix.length; k++) {
                var a2 = ans[ix[k]];
                if (a2 === undefined || a2 === null || a2 === '') { dMiss++; continue; }
                var sc2 = scoreFor(scale, ix[k], Number(a2));
                if (sc2 === null) { dMiss++; continue; }
                dsum += sc2; dAns++;
            }
            if (!dAns) { base.errors.push('البُعد "' + dim.name + '" لم تُجب عنه أي بنود.'); return false; }
            var dscore = dim.scoring === 'mean' ? round(dsum / dAns, 3) : round(dsum, 3);
            var dcats = deriveCategories(scale, dim.categories, r, Number.isInteger(r.min) && Number.isInteger(r.max) && dim.scoring !== 'mean');
            var dcat = categoryFor(dcats, dscore);
            base.dimensions.push({
                id: dim.id, name: dim.name, description: str(dim.description),
                score: dscore, min: r.min, max: r.max,
                pct: r.max > r.min ? Math.max(0, Math.min(100, Math.round(((dscore - r.min) / (r.max - r.min)) * 100))) : 0,
                answered: dAns, missing: dMiss, count: ix.length,
                category: dcat, scoringLabel: dim.scoring === 'mean' ? 'متوسط' : 'مجموع'
            });
        }
        return true;
    }

    function compute(scale, answers, patient) {
        scale = sanitizeScale(scale);
        if (!scale) return { ok: false, errors: ['المقياس غير موجود أو تالف.'], notes: [] };
        var val = validateScale(scale);
        var ans = normalizeAnswers(scale, answers);
        var comp = checkCompleteness(scale, ans);
        var base = {
            ok: false,
            scaleId: scale.id,
            scaleName: scale.name,
            scaleVersion: scale.version,
            method: methodOf(scale),
            effectiveMethod: effectiveMethod(scale),
            methodLabel: METHOD_LABELS[methodOf(scale)] || '',
            answered: comp.answered,
            missing: comp.missing,
            total: comp.total,
            errors: [],
            warnings: val.warnings.slice(),
            notes: [],
            dimensions: [],
            standard: null,
            category: null,
            raw: null, score: null, min: null, max: null, pct: null, avg: null,
            answers: []
        };
        if (val.errors.length) {
            base.errors = val.errors.slice();
            base.notes.push('تعريف المقياس يحتوي أخطاء تمنع الحساب.');
            return base;
        }
        if (!comp.ok) { base.errors.push(comp.reason); return base; }

        var em = effectiveMethod(scale);
        var perItem = [], sum = 0;
        for (var i = 0; i < scale.items.length; i++) {
            var rawAns = ans[i];
            if (rawAns === undefined || rawAns === null || rawAns === '') continue; /* بند غير مجاب — لا يُعوَّض بصفر */
            var idx = Number(rawAns);
            var opts = optionsFor(scale, i);
            if (!isFinite(idx) || idx < 0 || idx >= opts.length) {
                base.errors.push('إجابة غير صالحة في البند رقم ' + (i + 1) + '.');
                return base;
            }
            var sc = scoreFor(scale, i, idx);
            if (sc === null || !isFinite(sc)) { base.errors.push('تعذّر احتساب درجة البند رقم ' + (i + 1) + '.'); return base; }
            sum += sc;
            perItem.push({ score: sc, label: str(opts[idx].label), optIdx: idx });
            base.answers.push({ no: i + 1, text: scale.items[i].text, label: str(opts[idx].label), score: sc });
        }
        if (perItem.length !== comp.answered) {
            base.errors.push('تعذّر مطابقة الإجابات المعروضة مع ما تم الإجابة عنه.');
            return base;
        }
        base.raw = round(sum, 4);

        var dom, discrete, cats = [];
        if (em === 'mean') {
            var avg = sum / comp.answered;
            base.avg = round(avg, 3);
            base.score = round(avg, 3);
            dom = meanRange(scale);
            discrete = false;
            cats = deriveCategories(scale, scale.categories, dom, discrete);
            base.notes.push('طريقة الحساب: متوسط درجات البنود المجابة (' + comp.answered + ' بنود). النطاق النظري للمتوسط ' + dom.min + ' إلى ' + dom.max + '.');
        } else if (em === 'standard') {
            dom = domainOf(scale);
            discrete = isDiscreteDomain(scale);
            cats = deriveCategories(scale, scale.categories, dom, discrete);
            var st = standardFor(scale, sum);
            var match = matchReference(scale, patient);
            if (st.available && match.checked && !match.ok) {
                st = { available: false, reason: match.notes.join(' ') };
            }
            base.standard = st;
            if (st.available) {
                base.score = st.value;
                base.notes.push('الدرجة الخام ' + sum + ' حوّلت إلى ' + (st.typeLabel || 'درجة معيارية') + ' = ' + st.value + ' عبر ' + (st.via || 'جدول التحويل') + '. المصدر: ' + (st.source || 'غير محدد') + '.');
            } else {
                base.score = sum;
                base.notes.push('الدرجة المعيارية غير متاحة: ' + st.reason + ' — تُعرض الدرجة الخام فقط (' + sum + ').');
            }
            if (match.checked && match.notes.length) base.notes = base.notes.concat(match.notes);
            if (st.available) {
                /* الفئات على نطاق المعيار؛ إن كانت الفئات معرّفة على نطاق الخام فلن تتطابق */
                var domRaw = scaleRange(scale);
                if (Number(cats[0].min) >= domRaw.min && Number(cats[cats.length - 1].max) <= domRaw.max && dom.min !== domRaw.min) {
                    base.warnings.push('فئات التفسير تبدو معرّضة على نطاق الدرجة الخام بينما طريقة التصحيح معيارية — راجع حدود الفئات.');
                }
            }
        } else {
            dom = scaleRange(scale);
            discrete = isDiscreteDomain(scale);
            cats = deriveCategories(scale, scale.categories, dom, discrete);
            base.score = sum;
            base.notes.push('طريقة الحساب: ' + (methodOf(scale) === 'cutoffs' ? 'مجموع الدرجات مع مقارنة بنقاط القطع' : 'مجموع الدرجات') + '. النطاق النظري ' + dom.min + ' إلى ' + dom.max + '.');
        }
        base.min = dom.min; base.max = dom.max;
        base.pct = dom.max > dom.min ? Math.max(0, Math.min(100, Math.round(((Number(base.score) - dom.min) / (dom.max - dom.min)) * 100))) : 0;

        if (em === 'dimensions') {
            base.notes.push('تُعرض نتائج الأبعاد الفرعية منفصلة، ولا يُفترض أن جمع الأبعاد يمثل درجة كلية تفسيرية.');
            base.category = null;
            base.stateLabel = null;
            if (!fillDimensions(scale, ans, base)) return base;
        } else {
            if (scale.dimensions && scale.dimensions.length && scale.scoring && scale.scoring.includeDimensions) {
                if (!fillDimensions(scale, ans, base)) return base;
            }
            if (cats.length) {
                var valueForCat = (em === 'standard' && base.standard && base.standard.available) ? base.standard.value : base.score;
                var cat = categoryFor(cats, valueForCat);
                base.category = cat;
                base.stateLabel = cat ? cat.label : null;
                if (cat) base.notes.push('فئة التفسير: "' + cat.label + '" (المدى ' + cat.min + ' إلى ' + cat.max + ').');
            }
        }

        if (scale.missingPolicy && scale.missingPolicy.type !== 'all' && comp.missing > 0) {
            base.notes.push('سياسة الإجابات الناقصة: احتُسبت النتيجة على ' + comp.answered + ' بنود، ولم تُعوَّض البنود المفقودة بأصفار. عدد المفقود: ' + comp.missing + '.');
        }
        if (scale.cutoffs && scale.cutoffs.enabled) {
            if (scale.cutoffs.kind === 'validated') {
                base.notes.push('نقاط قطع موثقة — المصدر: ' + (scale.cutoffs.source || 'غير محدد') + '؛ الفئة السكانية: ' + (scale.cutoffs.population || 'غير محددة') + '.');
            } else {
                base.warnings.push('حدود التفسير مخصصة من قِبل المستخدم وليست حدودًا تشخيصية معتمدة.');
            }
            if (scale.cutoffs.sensitivity) base.notes.push('ملاحظات الحساسية: ' + scale.cutoffs.sensitivity);
            if (scale.cutoffs.usage) base.notes.push('الاستخدام المقصود: ' + scale.cutoffs.usage);
        }
        base.ok = true;
        return base;
    }

    /* ================== الجلسات والمسودات ================== */
    function patientSuffix(patientId) { return patientId ? '_' + patientId : ''; }
    function sessionsKey(scaleId, patientId) { return SESSIONS_PREFIX + scaleId + patientSuffix(patientId); }
    function draftKey(scaleId, patientId) { return DRAFT_PREFIX + scaleId + patientSuffix(patientId); }
    function loadSessions(scaleId, patientId) {
        try {
            var v = JSON.parse(backend().getItem(sessionsKey(scaleId, patientId)) || '[]');
            return isArr(v) ? v : [];
        } catch (e) { return []; }
    }
    function saveSessions(scaleId, patientId, list) {
        try {
            var arr = isArr(list) ? list : [];
            if (arr.length > 50) arr = arr.slice(arr.length - 50);
            backend().setItem(sessionsKey(scaleId, patientId), JSON.stringify(arr));
            return { ok: true };
        } catch (e) { return { ok: false, error: 'تعذّر حفظ الجلسة: مساحة التخزين ممتلئة.' }; }
    }
    function addSession(scaleId, patientId, session) {
        var list = loadSessions(scaleId, patientId);
        list.push(session);
        return saveSessions(scaleId, patientId, list);
    }
    function loadDraft(scaleId, patientId) {
        try {
            var v = JSON.parse(backend().getItem(draftKey(scaleId, patientId)) || 'null');
            return isObj(v) ? v : null;
        } catch (e) { return null; }
    }
    function saveDraft(scaleId, patientId, answers) {
        try {
            backend().setItem(draftKey(scaleId, patientId), JSON.stringify({ answers: answers || {}, updatedAt: new Date().toISOString() }));
            return { ok: true };
        } catch (e) { return { ok: false }; }
    }
    function clearDraft(scaleId, patientId) {
        try { backend().removeItem(draftKey(scaleId, patientId)); } catch (e) { /* تجاهل */ }
    }
    function makeSession(result, scale, number, dateStr) {
        var sess = {
            number: number,
            date: dateStr || todayStr(),
            dateTime: new Date().toISOString(),
            scaleId: scale.id,
            scaleName: scale.name,
            scaleVersion: scale.version,
            method: result.method,
            methodLabel: result.methodLabel,
            raw: result.raw,
            score: result.score,
            min: result.min,
            max: result.max,
            pct: result.pct,
            avg: result.avg,
            state: result.stateLabel || '—',
            color: (result.category && result.category.color) || '#2563eb',
            category: result.category || null,
            standard: result.standard || null,
            dimensions: result.dimensions || [],
            answered: result.answered,
            missing: result.missing,
            total: result.total,
            notes: result.notes || [],
            warnings: result.warnings || [],
            answers: result.answers || [],
            snapshot: clone(scale) /* نسخة من تعريف المقياس وقت التطبيق لضمان إعادة التفسير التاريخي */
        };
        /* ملخص الجلسة (تحليل وتفسيير ديناميكي) يُحفظ داخل الجلسة نفسها */
        try { sess.summary = summarize(sess); } catch (e) { sess.summary = null; }
        return sess;
    }

    /* ================== ملخص الجلسة (آلية موحّدة شبيهة بـ charts.html) ================== */
    function summarize(session) {
        if (!isObj(session)) return null;
        var snap = isObj(session.snapshot) ? session.snapshot : null;
        var dom = { min: num(session.min, 0), max: num(session.max, 0) };
        if (snap) { try { var d2 = domainOf(snap); if (d2 && isFinite(d2.min) && isFinite(d2.max)) dom = d2; } catch (e) { } }
        var span = dom.max - dom.min;
        function toPct(v) { return span > 0 ? Math.max(0, Math.min(100, Math.round(((Number(v) - dom.min) / span) * 100))) : 0; }

        /* مناطق الشدة لرسم الخلفيات (من فئات النسخة المحفوظة وقت التطبيق) */
        var zones = [];
        if (snap) {
            try {
                var cats = derivedCategoriesOf(snap);
                for (var c = 0; c < cats.length; c++) {
                    zones.push({
                        label: str(cats[c].label), color: str(cats[c].color, PALETTE[c % PALETTE.length]),
                        fromPct: toPct(cats[c].min), toPct: toPct(cats[c].max)
                    });
                }
            } catch (e) { zones = []; }
        }

        /* ترتيب الأبعاد تنازليًا حسب النسبة */
        var dims = [];
        var rawDims = isArr(session.dimensions) ? session.dimensions : [];
        for (var i = 0; i < rawDims.length; i++) {
            var dm = rawDims[i];
            var dmin = num(dm.min, 0), dmax = num(dm.max, 0);
            var pct = (dm.pct !== undefined && dm.pct !== null) ? num(dm.pct, 0)
                : (dmax > dmin ? Math.max(0, Math.min(100, Math.round(((num(dm.score, 0) - dmin) / (dmax - dmin)) * 100))) : 0);
            dims.push({
                name: str(dm.name, 'بُعد ' + (i + 1)), score: num(dm.score, 0),
                min: dmin, max: dmax, pct: pct,
                category: dm.category && dm.category.label ? { label: str(dm.category.label), color: str(dm.category.color) } : null
            });
        }
        dims.sort(function (a, b) { return b.pct - a.pct; });

        /* تحليل البنود: نسبة كل إجابة مقابل نطاق البند الممكن */
        var items = [];
        var ans = isArr(session.answers) ? session.answers : [];
        for (var k = 0; k < ans.length; k++) {
            var a = isObj(ans[k]) ? ans[k] : {};
            var idx = Math.floor(num(a.no, k + 1)) - 1;
            var r = null;
            if (snap) { try { r = itemRange(snap, idx); } catch (e2) { r = null; } }
            var sc = num(a.score, 0);
            var pctI = null;
            if (r && isFinite(r.max) && isFinite(r.min) && r.max > r.min) {
                pctI = Math.max(0, Math.min(100, Math.round(((sc - r.min) / (r.max - r.min)) * 100)));
            }
            items.push({
                no: Math.floor(num(a.no, k + 1)), text: str(a.text), label: str(a.label),
                score: sc, itemMin: r ? r.min : null, itemMax: r ? r.max : null, pct: pctI
            });
        }
        var ranked = items.filter(function (it) { return it.pct !== null; });
        ranked.sort(function (x, y) { return y.pct - x.pct || x.no - y.no; });
        var topItems = ranked.slice(0, 3);
        var lowItems = ranked.slice().reverse().slice(0, 3);
        if (lowItems.length > 3) lowItems = lowItems.slice(0, 3);

        var cat = isObj(session.category) && session.category.label ? session.category : null;
        return {
            number: num(session.number, 0),
            date: str(session.date),
            scaleName: str(session.scaleName),
            scaleVersion: num(session.scaleVersion, 1),
            methodLabel: str(session.methodLabel) || methodLabel(session.method),
            raw: session.raw === undefined ? null : session.raw,
            score: session.score === undefined ? null : session.score,
            avg: session.avg === undefined ? null : session.avg,
            min: dom.min, max: dom.max,
            pct: session.pct === undefined || session.pct === null ? null : num(session.pct, 0),
            category: cat ? { label: str(cat.label), color: str(cat.color, '#2563eb'), min: cat.min, max: cat.max } : null,
            stateLabel: session.state ? str(session.state) : (cat ? str(cat.label) : null),
            color: str(session.color) || (cat ? str(cat.color) : '') || '#2563eb',
            answered: num(session.answered, 0), total: num(session.total, 0),
            zones: zones,
            dims: dims,
            items: items,
            topItems: topItems,
            lowItems: lowItems,
            notes: isArr(session.notes) ? session.notes : [],
            warnings: isArr(session.warnings) ? session.warnings : []
        };
    }

    /* ================== تسميات ونصوص جاهزة ================== */
    function methodLabel(m) { return METHOD_LABELS[m] || str(m); }
    function methodDesc(m) { return METHOD_DESCS[m] || ''; }
    function missingLabel(t) { return MISSING_LABELS[t] || str(t); }
    function standardTypeLabel(t) { return STANDARD_TYPE_LABELS[t] || str(t); }

    return {
        SCALES_KEY: SCALES_KEY,
        METHODS: METHODS,
        MISSING_TYPES: MISSING_TYPES,
        STANDARD_TYPES: STANDARD_TYPES,
        PALETTE: PALETTE,
        METHOD_LABELS: METHOD_LABELS,
        METHOD_DESCS: METHOD_DESCS,
        MISSING_LABELS: MISSING_LABELS,
        STANDARD_TYPE_LABELS: STANDARD_TYPE_LABELS,

        _setStorageForTests: setStorageForTests,
        _sanitizeScale: sanitizeScale,

        loadScales: loadScales,
        getScale: getScale,
        upsertScale: upsertScale,
        deleteScale: deleteScale,
        makeId: uid,

        optionSetOf: optionSetOf,
        optionsFor: optionsFor,
        defaultOptions: defaultOptions,
        autoReverseMap: autoReverseMap,
        isMonotonicContiguous: isMonotonicContiguous,
        reverseMapFor: reverseMapFor,
        scoreFor: scoreFor,

        itemRange: itemRange,
        scaleRange: scaleRange,
        meanRange: meanRange,
        dimensionRange: dimensionRange,
        domainOf: domainOf,
        effectiveMethod: effectiveMethod,
        methodOf: methodOf,
        isDiscreteDomain: isDiscreteDomain,
        usedScoreValues: usedScoreValues,
        indexesOfDimension: indexesOfDimension,

        validateScale: validateScale,
        validateCategories: validateCategories,
        deriveCategories: deriveCategories,
        derivedCategoriesOf: derivedCategoriesOf,
        categoryFor: categoryFor,

        checkCompleteness: checkCompleteness,
        standardFor: standardFor,
        matchReference: matchReference,
        compute: compute,

        sessionsKey: sessionsKey,
        loadSessions: loadSessions,
        saveSessions: saveSessions,
        addSession: addSession,
        draftKey: draftKey,
        loadDraft: loadDraft,
        saveDraft: saveDraft,
        clearDraft: clearDraft,
        makeSession: makeSession,
        summarize: summarize,

        methodLabel: methodLabel,
        methodDesc: methodDesc,
        missingLabel: missingLabel,
        standardTypeLabel: standardTypeLabel,

        todayStr: todayStr,
        esc: esc,
        clone: clone,
        round: round
    };
});
