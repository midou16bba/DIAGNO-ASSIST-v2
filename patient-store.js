/*
 * patient-store.js — طبقة تخزين ملفات المرضى (مشتركة بين قائمة الملفات وصفحة التفاصيل)
 * تعتمد على نفس مفاتيح localStorage الموجودة في الموقع:
 *   diagPatients        -> قائمة الملفات (نفس المفتاح المستخدم في patient.html / patient-severity.html)
 *   diagActivePatient   -> الملف النشط (يستخدمه test.html و charts.html و custom-test/results لربط الجلسات)
 *   diagSessionsV2_<id> / diagSessionsMddV2_<id> / sessionsCustom_<sid>_<id> -> جلسات التقييم
 */
(function (root) {
    'use strict';

    var PKEY = 'diagPatients';
    var AKEY = 'diagActivePatient';
    var CUSTOM_KEY = 'diagCustomScales';

    var BUILTIN = {
        ptsd: { kind: 'ptsd', key: 'diagSessionsV2', name: 'اضطراب ما بعد الصدمة (PTSD)', chart: 'ptsd' },
        mdd: { kind: 'mdd', key: 'diagSessionsMddV2', name: 'مقياس الاكتئاب (MDD)', chart: 'mdd' }
    };

    function ls() { return (typeof localStorage !== 'undefined') ? localStorage : null; }

    function safeGet(k) { try { return ls().getItem(k); } catch (e) { return null; } }
    function safeSet(k, v) { try { ls().setItem(k, v); return true; } catch (e) { return false; } }
    function safeRemove(k) { try { ls().removeItem(k); return true; } catch (e) { return false; } }

    function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
    function str(x) { return (x === undefined || x === null) ? '' : String(x); }
    function nowISO() { try { return new Date().toISOString(); } catch (e) { return ''; } }

    function load() {
        var raw = safeGet(PKEY);
        if (!raw) return [];
        try {
            var arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            return arr.filter(function (p) { return isObj(p) && p.id; });
        } catch (e) { return []; }
    }

    function save(list) { return safeSet(PKEY, JSON.stringify(list || [])); }

    function get(id) {
        if (!id) return null;
        var list = load();
        for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
        return null;
    }

    /* معرّف فريد حتى بعد الحذف (يتجنّب تعارض 'p'+length) */
    function uniqueId(list) {
        list = list || load();
        var max = 0;
        var used = {};
        list.forEach(function (p) {
            used[String(p.id)] = true;
            var n = parseInt(String(p.id).replace(/\D/g, ''), 10);
            if (!isNaN(n) && n > max) max = n;
        });
        var id = 'p' + (max + 1);
        while (used[id]) { max++; id = 'p' + (max + 1); }
        return id;
    }

    /* رمز ملف فريد: PT-YYYY-0001 ... */
    function uniqueFileNum(list) {
        list = list || load();
        var used = {};
        var max = 0;
        var year = String(new Date().getFullYear());
        list.forEach(function (p) {
            var code = str(p.fileNum);
            if (code) used[code] = true;
            var m = code.match(/(\d{1,6})\s*$/);
            var n = m ? parseInt(m[1], 10) : 0;
            if (!isNaN(n) && n > max) max = n;
        });
        var num = max + 1;
        var code;
        do {
            code = 'PT-' + year + '-' + String(num).padStart(4, '0');
            num++;
        } while (used[code]);
        return code;
    }

    function validate(data) {
        var errors = [];
        if (!str(data.name).trim()) errors.push('الاسم أو الاسم المستعار مطلوب.');
        if (str(data.name).trim().length > 80) errors.push('الاسم طويل جدًا (الحد الأقصى 80 حرفًا).');
        if (data.age && !/^[0-9٠-٩]{1,3}(\s*سنة|\s*سنوات|\s*شهر|\s*أشهر)?$/.test(str(data.age).trim()) && isNaN(parseInt(str(data.age), 10))) {
            errors.push('العمر يجب أن يكون رقمًا (مثال: 34 أو 34 سنة).');
        }
        return errors;
    }

    function create(data) {
        data = data || {};
        var errors = validate(data);
        if (errors.length) return { ok: false, error: errors[0], errors: errors };
        var list = load();
        var p = {
            id: uniqueId(list),
            fileNum: str(data.fileNum).trim() || uniqueFileNum(list),
            name: str(data.name).trim(),
            age: str(data.age).trim(),
            birth: str(data.birth).trim(),
            sex: str(data.sex).trim(),
            phone: str(data.phone).trim(),
            job: str(data.job).trim(),
            marital: str(data.marital).trim(),
            reason: str(data.reason).trim(),
            notes: str(data.notes).trim(),
            visit: str(data.visit).trim() || 'أول استشارة عبّر منصة DIAGNO-ASSIST.',
            openedAt: str(data.openedAt).trim() || todayStr(),
            tag: str(data.tag).trim() || 'ملف جديد',
            archived: false,
            createdAt: nowISO(),
            updatedAt: nowISO()
        };
        var dupe = list.some(function (x) { return str(x.fileNum) === p.fileNum; });
        if (dupe) return { ok: false, error: 'رمز الملف مستخدم بالفعل.' };
        list.push(p);
        save(list);
        return { ok: true, patient: p };
    }

    function update(id, patch) {
        patch = patch || {};
        var list = load();
        var idx = -1;
        for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) { idx = i; break; }
        if (idx < 0) return { ok: false, error: 'الملف غير موجود.' };
        var merged = {};
        for (var k in list[idx]) if (Object.prototype.hasOwnProperty.call(list[idx], k)) merged[k] = list[idx][k];
        for (var k2 in patch) if (Object.prototype.hasOwnProperty.call(patch, k2)) merged[k2] = patch[k2];
        if (merged.name !== undefined) {
            var errors = validate(merged);
            if (errors.length) return { ok: false, error: errors[0], errors: errors };
        }
        merged.id = list[idx].id;
        merged.fileNum = list[idx].fileNum;
        merged.updatedAt = nowISO();
        list[idx] = merged;
        save(list);
        return { ok: true, patient: merged };
    }

    function setArchived(id, flag) {
        var list = load();
        var found = null;
        list.forEach(function (p) { if (String(p.id) === String(id)) { p.archived = !!flag; p.updatedAt = nowISO(); found = p; } });
        if (!found) return { ok: false, error: 'الملف غير موجود.' };
        save(list);
        return { ok: true, patient: found };
    }

    /* ===== الجلسات ===== */
    function parseArr(raw) {
        if (!raw) return [];
        try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }

    function customScales() {
        var list = parseArr(safeGet(CUSTOM_KEY));
        return list.filter(function (s) {
            if (!isObj(s) || !s.id) return false;
            /* مقاييس صالحة فقط (نفس فحص المحرك إن توفر) */
            var E = root.ScaleEngine;
            if (E && typeof E.validateScale === 'function') {
                try { return !E.validateScale(s).errors.length; } catch (e) { return false; }
            }
            return !!(s.name && s.items && s.items.length);
        });
    }

    function sessionsFor(pid) {
        var out = [];
        if (!pid) return out;
        ['ptsd', 'mdd'].forEach(function (kind) {
            var meta = BUILTIN[kind];
            var arr = parseArr(safeGet(meta.key + '_' + pid));
            arr.forEach(function (s, i) {
                if (!isObj(s)) return;
                out.push({
                    kind: kind, scaleId: kind, scaleName: meta.name, key: meta.key + '_' + pid, index: i,
                    number: s.number, date: s.date, dateTime: s.dateTime || '',
                    score: (s.total !== undefined && s.total !== null) ? s.total : s.score,
                    pct: s.pct, state: s.state || (s.category && s.category.label) || '',
                    color: s.color || '', max: s.max, session: s, summary: s.summary || null
                });
            });
        });
        customScales().forEach(function (sc) {
            var key = 'sessionsCustom_' + sc.id + '_' + pid;
            var arr = parseArr(safeGet(key));
            arr.forEach(function (s, i) {
                if (!isObj(s)) return;
                out.push({
                    kind: 'custom', scaleId: sc.id, scaleName: (s.scaleName || sc.name), key: key, index: i,
                    number: s.number, date: s.date, dateTime: s.dateTime || '',
                    score: s.score, pct: s.pct, state: s.state || (s.category && s.category.label) || '',
                    color: s.color || (s.category && s.category.color) || '', max: s.max, session: s, summary: s.summary || null
                });
            });
        });
        out.sort(function (a, b) { return dateValue(b) - dateValue(a); });
        return out;
    }

    function dateValue(x) {
        var d = str(x.dateTime);
        if (d) { var t = Date.parse(d); if (!isNaN(t)) return t; }
        var p = str(x.date).split('/');
        if (p.length === 3) {
            var t2 = Date.parse(p[2] + '-' + p[1] + '-' + p[0]);
            if (!isNaN(t2)) return t2;
        }
        return 0;
    }

    function sessionCounts(pid) {
        var all = sessionsFor(pid);
        var c = { ptsd: 0, mdd: 0, custom: 0, total: all.length, names: [] };
        var names = {};
        all.forEach(function (s) {
            if (s.kind === 'ptsd') c.ptsd++;
            else if (s.kind === 'mdd') c.mdd++;
            else { c.custom++; names[s.scaleName] = (names[s.scaleName] || 0) + 1; }
        });
        for (var n in names) if (Object.prototype.hasOwnProperty.call(names, n)) c.names.push(n + ' (' + names[n] + ')');
        return c;
    }

    /* هل يخص هذا المفتاح الملف المحدد فقط؟ (تجنّب حذف بيانات ملف آخر مثل p30 عند حذف p3) */
    function ownsKey(k, id) {
        if (!k || !id) return false;
        var direct = ['diagSessionsV2_', 'diagSessionsMddV2_', 'diagTestAnswered_', 'activeChartTest_', 'chosenTest_'];
        for (var i = 0; i < direct.length; i++) if (k === direct[i] + id) return true;
        var dyn = ['sessionsCustom_', 'draftCustom_'];
        for (var j = 0; j < dyn.length; j++) {
            if (k.indexOf(dyn[j]) === 0) {
                var minLen = dyn[j].length + 1 + id.length + 1;
                return k.length >= minLen && k.slice(k.length - id.length - 1) === '_' + id;
            }
        }
        return false;
    }

    /* حذف ملف + كل بياناته المرتبطة (بعد تأكيد المستخدم) */
    function remove(id) {
        id = str(id);
        if (!id) return { ok: false, error: 'الملف غير موجود.' };
        var counts = sessionCounts(id);
        var list = load().filter(function (p) { return String(p.id) !== id; });
        save(list);
        var removedKeys = [];
        var store = ls();
        var keys = [];
        try { for (var i = 0; i < store.length; i++) keys.push(store.key(i)); } catch (e) { keys = []; }
        keys.forEach(function (k) {
            if (ownsKey(k, id)) { safeRemove(k); removedKeys.push(k); }
        });
        var act = getActive();
        if (act && String(act.id) === id) setActive(null);
        return { ok: true, removed: counts, removedKeys: removedKeys };
    }

    /* ===== الملف النشط ===== */
    function getActive() {
        var raw = safeGet(AKEY);
        if (!raw) return null;
        try { var p = JSON.parse(raw); return isObj(p) && p.id ? p : null; } catch (e) { return null; }
    }

    function setActive(p) {
        if (!p) { safeRemove(AKEY); return null; }
        var latest = get(p.id) || p;
        safeSet(AKEY, JSON.stringify(latest));
        return latest;
    }

    /* بدء تقييم من ملف مريض — يستخدم نفس مفاتيح test.html / custom-test.js */
    function startAssessment(pid, kind, scaleId) {
        var p = get(pid);
        if (!p) return { ok: false, error: 'الملف غير موجود.' };
        setActive(p);
        if (kind === 'ptsd' || kind === 'mdd') {
            safeSet('diagSelectedScale', kind);
            safeSet('chosenTest_' + p.id, kind);
            return { ok: true, href: 'test.html' };
        }
        if (kind === 'custom') {
            var sid = str(scaleId);
            if (!sid) return { ok: false, error: 'لم يتم تحديد المقياس.' };
            var okScale = customScales().some(function (s) { return String(s.id) === sid; });
            if (!okScale) return { ok: false, error: 'هذا المقياس غير منشور أو غير صالح للتطبيق.' };
            safeSet('diagSelectedScale', sid);
            safeSet('chosenCustomScale', sid);
            return { ok: true, href: 'custom-test.html?id=' + encodeURIComponent(sid) };
        }
        return { ok: false, error: 'نوع تقييم غير معروف.' };
    }

    /* رابط عرض نتيجة جلسة محفوظة عبر صفحات الملخص الحالية */
    function resultHref(pid, sess) {
        if (!sess) return null;
        var p = get(pid);
        if (p) setActive(p);
        if (sess.kind === 'ptsd' || sess.kind === 'mdd') {
            safeSet('activeChartTest_' + pid, sess.kind);
            return 'charts.html';
        }
        if (sess.kind === 'custom') return 'custom-results.html?id=' + encodeURIComponent(sess.scaleId);
        return null;
    }

    function todayStr() {
        var d = new Date();
        return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
    }

    function fmtDate(v) {
        if (!v) return '—';
        var t = Date.parse(v);
        if (isNaN(t)) return str(v);
        var d = new Date(t);
        return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
    }

    root.PatientStore = {
        PKEY: PKEY, AKEY: AKEY, BUILTIN: BUILTIN,
        load: load, save: save, get: get, create: create, update: update, setArchived: setArchived, remove: remove,
        uniqueId: uniqueId, uniqueFileNum: uniqueFileNum, validate: validate,
        getActive: getActive, setActive: setActive,
        sessionsFor: sessionsFor, sessionCounts: sessionCounts, customScales: customScales,
        startAssessment: startAssessment, resultHref: resultHref,
        todayStr: todayStr, fmtDate: fmtDate
    };
})(typeof window !== 'undefined' ? window : this);
