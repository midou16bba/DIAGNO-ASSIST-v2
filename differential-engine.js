/*!
 * DIAGNO-ASSIST — محرك التشخيص الفارقي (يعمل محلياً بالكامل)
 * differential-engine.js
 *
 * الوظائف:
 *   analyzeSymptoms(text)              -> محكات متعرف عليها + 2-3 فرضيات متكافئة (دون درجات)
 *   buildQuestions(candidateIds)       -> أسئلة فارقية مولّدة ديناميكياً من الفرضيات نفسها فقط
 *   interpretFreeText(axisKey, text)   -> تحويل إجابة نصية حرة إلى خيار
 *   resolve(candidateIds, answers, fit)-> اضطراب واحد نهائي + أسباب الاستبعاد
 *
 * يعمل في المتصفح (window.DifferentialEngine) وفي Node (module.exports) للاختبارات.
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module && module.exports) {
        module.exports = factory(require('./dsm-db.js'));
    } else {
        root.DifferentialEngine = factory(root.DSM_DB);
    }
})(typeof self !== 'undefined' ? self : this, function (DB) {
    'use strict';

    if (!DB || !DB.disorders) {
        throw new Error('DifferentialEngine: قاعدة معارف DSM غير محمّلة (dsm-db.js).');
    }

    /* ================== تطبيع النص العربي ================== */
    var TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
    var AR_DIGITS = /[\u0660-\u0669]/g;
    var FA_DIGITS = /[\u06F0-\u06F9]/g;

    function normalize(s) {
        return String(s == null ? '' : s)
            .replace(TASHKEEL, '')
            .replace(AR_DIGITS, function (d) { return String(d.charCodeAt(0) - 0x0660); })
            .replace(FA_DIGITS, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
            .replace(/[\u0623\u0625\u0622\u0671\u0627]/g, 'ا')
            .replace(/[\u0649\u0626\u064A]/g, 'ي')
            .replace(/[\u0629\u0647]/g, 'ه')
            .replace(/[\u0624\u0648]/g, 'و')
            .replace(/\u0621/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    var PREFIX = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال', 'و', 'ف', 'ب', 'ك', 'ل'];
    var SUFFIX = ['هما', 'هم', 'هن', 'ها', 'كم', 'كن', 'نا', 'ات', 'ون', 'ين', 'ان', 'يه', 'ه', 'ك', 'ي'];

    function stem(w) {
        var out = w;
        for (var i = 0; i < PREFIX.length; i++) {
            var p = PREFIX[i];
            if (out.length - p.length >= 3 && out.indexOf(p) === 0) { out = out.slice(p.length); break; }
        }
        for (var j = 0; j < SUFFIX.length; j++) {
            var s = SUFFIX[j];
            if (out.length - s.length >= 3 && out.slice(-s.length) === s) { out = out.slice(0, -s.length); break; }
        }
        return out;
    }

    function tokenize(text) {
        var n = normalize(text);
        return n ? n.split(' ') : [];
    }

    function levenshtein(a, b, limit) {
        if (a === b) return 0;
        if (Math.abs(a.length - b.length) > limit) return limit + 1;
        var prev = [], cur = [], i, j;
        for (j = 0; j <= b.length; j++) prev[j] = j;
        for (i = 1; i <= a.length; i++) {
            cur[0] = i;
            var best = cur[0];
            for (j = 1; j <= b.length; j++) {
                var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
                if (cur[j] < best) best = cur[j];
            }
            if (best > limit) return limit + 1;
            prev = cur.slice();
        }
        return prev[b.length];
    }

    /* هل تطابق كلمة نصية كلمة مفتاحية (مع تجاوز الاختلافات الصرفية والأخطاء البسيطة)؟ */
    function tokenHit(token, tokenStem, kw, kwStem) {
        if (token === kw || tokenStem === kwStem) return true;
        if (kw.length >= 3 && token.indexOf(kw) === 0 && token.length - kw.length <= 3) return true;
        if (kw.length >= 4 && token.indexOf(kw) >= 0) return true;
        if (kwStem.length >= 4 && tokenStem.indexOf(kwStem) >= 0) return true;
        if (kw.length >= 5 && token.charAt(0) === kw.charAt(0) && levenshtein(token, kw, 1) <= 1) return true;
        if (kwStem.length >= 5 && tokenStem.charAt(0) === kwStem.charAt(0) && levenshtein(tokenStem, kwStem, 1) <= 1) return true;
        return false;
    }

    function anyTokenHit(kw, kwStem, toks, stems) {
        for (var j = 0; j < toks.length; j++) {
            if (tokenHit(toks[j], stems[j], kw, kwStem)) return true;
        }
        return false;
    }

    /*
     * عبارة مفتاحية: كل كلماتها موجودة داخل نافذة قريبة من النص (دون اشتراط الترتيب).
     * النافذة تمنع المطابقات الزائفة بين كلمات متباعدة مثل «ما» + «يتحرك» في جملتين مختلفتين.
     */
    function phraseHit(kwTokens, toks, stems) {
        if (!kwTokens.length) return false;
        if (kwTokens.length === 1) return anyTokenHit(kwTokens[0], stem(kwTokens[0]), toks, stems);

        var k = kwTokens.length;
        var win = k + 2;
        for (var s = 0; s < toks.length; s++) {
            var end = Math.min(toks.length, s + win);
            if (end - s < k) break;
            var used = {};
            var ok = true;
            for (var i = 0; i < k; i++) {
                var kw = kwTokens[i];
                var kwStem = stem(kw);
                var found = false;
                for (var j = s; j < end; j++) {
                    if (used[j]) continue;
                    if (tokenHit(toks[j], stems[j], kw, kwStem)) { used[j] = 1; found = true; break; }
                }
                if (!found) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }

    function preparePhrase(phrase) {
        return tokenize(phrase);
    }

    /* ================== فهرسة قاعدة المعارف ================== */
    var byId = {};
    var catOrder = {};

    DB.categories.forEach(function (c, i) { catOrder[c.id] = i; });

    DB.disorders.forEach(function (d) {
        byId[d.id] = d;
        d._criteria = (d.c || []).map(function (raw) {
            var parts = String(raw).split('::');
            var label = (parts[0] || '').trim();
            var kws = (parts[1] || '').split('|').map(function (k) { return k.trim(); }).filter(Boolean);
            return { label: label, phrases: kws.map(preparePhrase) };
        });
    });

    var axesByKey = {};
    DB.axes.forEach(function (a) { axesByKey[a.key] = a; });

    function getDisorder(id) { return byId[id] || null; }
    function categoryName(id) {
        for (var i = 0; i < DB.categories.length; i++) {
            if (DB.categories[i].id === id) return DB.categories[i].ar;
        }
        return '';
    }

    /* ================== تحليل الأعراض ================== */
    function scoreDisorder(d, toks, stems) {
        var labels = [];
        var hits = [];
        var weight = 0;
        for (var i = 0; i < d._criteria.length; i++) {
            var crit = d._criteria[i];
            for (var k = 0; k < crit.phrases.length; k++) {
                if (phraseHit(crit.phrases[k], toks, stems)) {
                    /* عبارة من كلمتين أو أكثر دليل أقوى من كلمة عامة واحدة */
                    var w = Math.max(1, crit.phrases[k].length);
                    labels.push(crit.label);
                    hits.push({ label: crit.label, kw: crit.phrases[k].join(' '), crit: i, w: w });
                    weight += w;
                    break;
                }
            }
        }
        var total = d._criteria.length || 1;
        var ratio = labels.length / total;
        return {
            id: d.id,
            matched: labels.length,
            total: total,
            ratio: ratio,
            labels: labels,
            hits: hits,
            weight: weight,
            score: weight + ratio
        };
    }

    /** تشخيص سبب المطابقة (للاختبارات وضبط القاعدة، لا يُعرض للمستخدم). */
    function explain(text) {
        var toks = tokenize(text);
        var stems = toks.map(stem);
        var out = [];
        DB.disorders.forEach(function (d) {
            var s = scoreDisorder(d, toks, stems);
            if (s.matched) out.push({ id: d.id, ar: d.ar, score: s.score, hits: s.hits });
        });
        out.sort(function (a, b) { return b.score - a.score; });
        return out;
    }

    function candidateNeed(m) {
        return Math.max(2, Math.min(4, Math.round(m.total * 0.35)));
    }

    function publicCandidate(d) {
        return {
            id: d.id,
            ar: d.ar,
            en: d.en,
            code: d.code,
            ico: d.ico,
            cat: d.cat,
            catAr: categoryName(d.cat)
        };
    }

    /**
     * تحليل نص الأعراض.
     * يعيد: { recognized:[أسماء المحكات], candidates:[2-3 فرضيات], fit:{id:مؤشر داخلي} }
     * لا يعرض أي درجة أو نسبة للمستخدم؛ الترتيب أبجدي/حسب الفصل (محايد).
     */
    function analyzeSymptoms(text) {
        var toks = tokenize(text);
        var stems = toks.map(stem);
        var all = [];

        DB.disorders.forEach(function (d) {
            var s = scoreDisorder(d, toks, stems);
            if (s.matched > 0) all.push(s);
        });

        all.sort(function (a, b) {
            if (b.score !== a.score) return b.score - a.score;
            if (b.matched !== a.matched) return b.matched - a.matched;
            return a.id < b.id ? -1 : 1;
        });

        var fit = {};
        all.forEach(function (m) { fit[m.id] = m.score; });

        if (!all.length) return { recognized: [], candidates: [], fit: fit };

        var top = all[0];

        /*
         * لا يُعرض إلا ما له دليل حقيقي: محكان على الأقل (أو محكان مطلوبان حسب حجم
         * الاضطراب) ودرجة قريبة من الأقوى. عند غياب منافس بهذا المستوى تُعرض فرضية
         * واحدة بدل حشو القائمة باضطرابات لا تسندها الأعراض.
         */
        var picked = all.filter(function (m) {
            return m.matched >= 2 && m.matched >= candidateNeed(m) && m.score >= top.score * 0.5;
        }).slice(0, 3);

        if (!picked.length) {
            picked = all.filter(function (m) {
                return m.matched >= 2 && m.score >= top.score * 0.4;
            }).slice(0, 3);
        }
        if (!picked.length) picked = [top];

        /*
         * الفرضيات تُناقش دائماً بالمقارنة. إن لم يوجد منافس قوي من نفس الفصل
         * التشخيصي، يُضاف أقرب اضطراب في الفصل نفسه (دليل واحد على الأقل) بدل
         * ترك المستخدم بفرضية واحدة، ودون إضافة اضطرابات بعيدة عن الصورة.
         */
        if (picked.length < 2) {
            var sameCat = all.filter(function (m) {
                return m.id !== top.id && byId[m.id].cat === byId[top.id].cat && m.weight >= 2 &&
                    !picked.some(function (p) { return p.id === m.id; });
            })[0];
            if (sameCat) picked.push(sameCat);
        }
        if (picked.length > 3) picked = picked.slice(0, 3);

        var candidates = picked.map(function (m) { return publicCandidate(byId[m.id]); });
        candidates.sort(function (a, b) {
            var ca = catOrder[a.cat], cb = catOrder[b.cat];
            if (ca !== cb) return ca - cb;
            return a.ar.localeCompare(b.ar, 'ar');
        });

        var recognized = [];
        var seen = {};
        picked.forEach(function (m) {
            m.labels.forEach(function (l) {
                if (!seen[l]) { seen[l] = 1; recognized.push(l); }
            });
        });

        return { recognized: recognized, candidates: candidates, fit: fit };
    }

    /* ================== الأسئلة الفارقية ================== */
    function sameSet(a, b) {
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) < 0) return false;
        return true;
    }

    /*
     * هل يفصل المحور بين اضطرابين؟
     * - كلاهما يعلن المحور: يفصل إذا اختلفت القيم المقبولة.
     * - أحدهما فقط يعلنه: يفصل أيضاً، لأن الإجابة قد تستبعد صاحبه أو تدعمه بلا معارض.
     */
    function separates(a, b, axisKey) {
        var va = a.ax && a.ax[axisKey];
        var vb = b.ax && b.ax[axisKey];
        if (!va && !vb) return false;
        if (!va || !vb) return true;
        return !sameSet(va, vb);
    }

    /**
     * توليد أسئلة فارقية تعتمد حصراً على الفرضيات المعطاة.
     * يُسأل فقط عن المحاور التي تختلف فيها الفرضيات فعلياً (لا أسئلة ثابتة).
     */
    function buildQuestions(candidateIds) {
        var cands = (candidateIds || []).map(getDisorder).filter(Boolean);
        if (cands.length < 2) return [];

        var out = [];
        DB.axes.forEach(function (ax, idx) {
            var declared = cands.filter(function (d) { return d.ax && d.ax[ax.key]; });
            if (!declared.length) return;

            var pairs = 0, sep = 0;
            for (var i = 0; i < cands.length; i++) {
                for (var j = i + 1; j < cands.length; j++) {
                    pairs++;
                    if (separates(cands[i], cands[j], ax.key)) sep++;
                }
            }
            if (!sep) return;

            out.push({
                key: ax.key,
                label: ax.label,
                q: ax.q,
                hint: ax.hint,
                weight: ax.weight || 2,
                opts: ax.opts.map(function (o) { return { v: o.v, l: o.l }; }),
                coverage: pairs ? sep / pairs : 0,
                order: idx
            });
        });

        out.sort(function (a, b) {
            if (b.coverage !== a.coverage) return b.coverage - a.coverage;
            if (b.weight !== a.weight) return b.weight - a.weight;
            return a.order - b.order;
        });

        var max = 7;
        var chosen = out.slice(0, max);

        /* ضمان تغطية كل زوج من الفرضيات بسؤال واحد على الأقل */
        for (var i = 0; i < cands.length; i++) {
            for (var j = i + 1; j < cands.length; j++) {
                var a = cands[i], b = cands[j];
                var covered = chosen.some(function (q) { return separates(a, b, q.key); });
                if (covered) continue;
                var extra = out.filter(function (q) {
                    return !chosen.some(function (c) { return c.key === q.key; }) && separates(a, b, q.key);
                })[0];
                if (extra) chosen.push(extra);
            }
        }

        return chosen.map(function (q) {
            return { key: q.key, label: q.label, q: q.q, hint: q.hint, weight: q.weight, opts: q.opts };
        });
    }

    /* ================== تفسير الإجابة النصية الحرة ================== */
    var NUMBER_WORDS = {
        'واحد': 1, 'واحده': 1, 'اثنين': 2, 'اثنتين': 2, 'ثلاث': 3, 'ثلاثه': 3, 'اربع': 4, 'اربعه': 4,
        'خمس': 5, 'خمسه': 5, 'ست': 6, 'سته': 6, 'سبع': 7, 'سبعه': 7, 'ثمان': 8, 'ثمانيه': 8,
        'تسع': 9, 'تسعه': 9, 'عشر': 10, 'عشره': 10, 'احدعشر': 11, 'اثناعشر': 12
    };

    function bucketMonths(m) {
        if (!isFinite(m) || m <= 0) return null;
        if (m < 0.23) return 'w_lt1';
        if (m < 1) return 'w_1_4';
        if (m < 3) return 'w_1_3m';
        if (m < 6) return 'w_3_6m';
        if (m < 12) return 'w_6_12m';
        if (m < 24) return 'w_1_2y';
        return 'w_gt2y';
    }

    function parseDurationMonths(raw) {
        var t = normalize(raw);
        if (!t) return null;
        var hasYear = /(سنه|سنوات|سنين|عام|اعوام)/.test(t);
        if (/نصف\s+سنه|سنه\s+و\s+نصف|عام\s+و\s+نصف/.test(t)) return 18;
        /* «سنة وشهرين / سنة وثلاثة أشهر»: السنتان تُحسبان قبل شهرين المنفردة */
        var yearPlus = t.match(/(?:سنه|عام)\s+و\s*(نصف|شهرين|شهر|ثلاثه اشهر|اربعه اشهر|ستة اشهر|خمسه اشهر)/);
        if (yearPlus) {
            var extra = /نصف/.test(yearPlus[1]) ? 6 : /شهرين/.test(yearPlus[1]) ? 2 :
                /ثلاثه/.test(yearPlus[1]) ? 3 : /اربعه/.test(yearPlus[1]) ? 4 :
                /خمسه/.test(yearPlus[1]) ? 5 : /سته/.test(yearPlus[1]) ? 6 : 1;
            return 12 + extra;
        }
        if (hasYear && /شهرين/.test(t)) return 14;
        if (!hasYear && /شهرين/.test(t)) return 2;
        if (/اسبوعين/.test(t)) return 0.5;

        var re = /(\d+(?:[.,]\d+)?)\s*(يوم|ايام|ليله|ليال|اسبوع|اسابيع|شهر|شهور|اشهر|سنه|سنوات|سنين|عام|اعوام)/;
        var m = t.match(re);
        if (m) {
            var n = parseFloat(String(m[1]).replace(',', '.'));
            var unit = m[2];
            if (/يوم|ليله/.test(unit)) return n / 30;
            if (/اسبوع/.test(unit)) return n / 4.345;
            if (/شهر|شهور|اشهر/.test(unit)) return n;
            return n * 12;
        }

        /* أرقام مكتوبة: "ستة أشهر" */
        var words = t.split(' ');
        for (var i = 0; i < words.length - 1; i++) {
            var num = NUMBER_WORDS[words[i]];
            if (!num) continue;
            var next = words[i + 1];
            if (/يوم|ليله/.test(next)) return num / 30;
            if (/اسبوع/.test(next)) return num / 4.345;
            if (/شهر|شهور|اشهر/.test(next)) return num;
            if (/سنه|سنوات|سنين|عام|اعوام/.test(next)) return num * 12;
        }
        return null;
    }

    function parseAge(raw) {
        var t = normalize(raw);
        if (!t) return null;
        var m = t.match(/(\d{1,2})\s*(?:سنه|سنة|عام|سنه|سنوات)/);
        if (m) return parseInt(m[1], 10);
        m = t.match(/(?:عمره|عمرها|عمر المريض)\s*(\d{1,2})\b/);
        if (m) return parseInt(m[1], 10);
        /* «قبل سن 12» تعني أن البداية كانت دون الثانية عشرة */
        m = t.match(/قبل\s*(?:سن\s*)?(\d{1,2})\b/);
        if (m) return Math.max(0, parseInt(m[1], 10) - 1);
        m = t.match(/سن\s*(\d{1,2})\b/);
        if (m) return parseInt(m[1], 10);
        m = t.match(/(?:في|منذ)\s*(\d{1,2})\b/);
        if (m) return parseInt(m[1], 10);
        return null;
    }

    function ageBucket(age) {
        if (age == null) return null;
        if (age < 12) return 'child';
        if (age < 18) return 'teen';
        if (age < 30) return 'young';
        return 'adult';
    }

    function optByValue(axis, v) {
        for (var i = 0; i < axis.opts.length; i++) if (axis.opts[i].v === v) return axis.opts[i];
        return null;
    }

    function bestOptionByKeywords(axis, toks, stems) {
        var best = null, bestScore = 0;
        axis.opts.forEach(function (o) {
            if (!o.kw || o.v === 'unknown') return;
            var score = 0;
            o.kw.forEach(function (k) {
                var phrase = preparePhrase(k);
                if (phraseHit(phrase, toks, stems)) score += Math.max(1, phrase.length);
            });
            if (score > bestScore) { bestScore = score; best = o; }
        });
        return bestScore > 0 ? best : null;
    }

    /**
     * تحويل إجابة حرة إلى قيمة خيار في محور معيّن.
     * يعيد { v, l } أو null إذا لم يُتعرف على الإجابة.
     */
    function interpretFreeText(axisKey, text) {
        var axis = axesByKey[axisKey];
        if (!axis) return null;
        var t = normalize(text);
        if (!t) return null;
        var toks = t.split(' ');
        var stems = toks.map(stem);

        if (axisKey === 'duration') {
            var months = parseDurationMonths(text);
            var b = bucketMonths(months);
            if (b) { var ob = optByValue(axis, b); if (ob) return { v: ob.v, l: ob.l }; }
        }

        if (axisKey === 'onset') {
            var age = parseAge(text);
            var ab = ageBucket(age);
            if (ab) { var oa = optByValue(axis, ab); if (oa) return { v: oa.v, l: oa.l }; }
        }

        /* نعم / لا العامة */
        var hasYes = /(^| )(نعم|ايه|ايوه|يب|بلا شك|موجود|موجوده|اكيد)( |$)/.test(t);
        var hasNo = /(^| )(لا يوجد|مافي|ما في|ما حصل|لم يحدث|ابدا|غير موجود|ما صار|لا)( |$)/.test(t);
        if (hasNo && !hasYes) {
            var noOpt = optByValue(axis, 'no') || optByValue(axis, 'none');
            if (noOpt) return { v: noOpt.v, l: noOpt.l };
        }
        if (hasYes && !hasNo) {
            var yesOpt = optByValue(axis, 'yes');
            if (yesOpt) return { v: yesOpt.v, l: yesOpt.l };
        }

        var byKw = bestOptionByKeywords(axis, toks, stems);
        if (byKw) return { v: byKw.v, l: byKw.l };

        return null;
    }

    /* ================== الحسم التشخيصي ================== */
    function acceptedLabels(d, axisKey) {
        var acc = d.ax && d.ax[axisKey];
        if (!acc) return [];
        var axis = axesByKey[axisKey];
        return acc.map(function (v) {
            var o = optByValue(axis, v);
            return o ? o.l : v;
        });
    }

    function optionLabel(axisKey, v) {
        var axis = axesByKey[axisKey];
        if (!axis) return v;
        var o = optByValue(axis, v);
        return o ? o.l : v;
    }

    /**
     * تطبيق الإجابات: استبعاد الفرضيات غير المتوافقة والوصول إلى اضطراب واحد.
     * answers: { axisKey: optionValue }
     * fit: مؤشر توافق الأعراض (داخلي، يُستخدم فقط لكسر التعادل)
     */
    function resolve(candidateIds, answers, fit) {
        var cands = (candidateIds || []).map(getDisorder).filter(Boolean);
        fit = fit || {};
        answers = answers || {};

        var scores = {};
        cands.forEach(function (d) { scores[d.id] = 0; });

        var answered = [];
        Object.keys(answers).forEach(function (key) {
            var v = answers[key];
            if (!v) return;
            var axis = axesByKey[key];
            if (!axis) return;
            var label = optionLabel(key, v);
            answered.push({ key: key, label: axis.label, value: v, answer: label });
            if (v === 'unknown' || v === 'na') return;
            var w = axis.weight || 2;
            cands.forEach(function (d) {
                var acc = d.ax && d.ax[key];
                if (!acc) return;
                if (acc.indexOf(v) >= 0) scores[d.id] += w;
                else scores[d.id] -= w;
            });
        });

        var ranked = cands.slice().sort(function (a, b) {
            if (scores[b.id] !== scores[a.id]) return scores[b.id] - scores[a.id];
            var fa = fit[a.id] || 0, fb = fit[b.id] || 0;
            if (fb !== fa) return fb - fa;
            return 0;
        });

        var winner = ranked[0] || null;
        var excluded = [];

        if (winner) {
            ranked.slice(1).forEach(function (d) {
                /* المحور الأقوى الذي استُبعد به هذا الاضطراب */
                var reasonAxis = null;
                answered.forEach(function (a) {
                    if (a.value === 'unknown' || a.value === 'na') return;
                    var acc = d.ax && d.ax[a.key];
                    if (!acc || acc.indexOf(a.value) >= 0) return;
                    if (!reasonAxis || (axesByKey[a.key].weight || 2) > (axesByKey[reasonAxis.key].weight || 2)) {
                        reasonAxis = a;
                    }
                });
                var reason;
                if (reasonAxis) {
                    reason = 'الإجابة على «' + reasonAxis.label + '»: ' + reasonAxis.answer +
                        ' — بينما يشترط هذا الاضطراب: ' + acceptedLabels(d, reasonAxis.key).join(' أو ') + '.';
                } else {
                    reason = 'لم تتوافق إجاباته مع المحكات الفارقة التي رجّحت التشخيص النهائي.';
                }
                excluded.push({ id: d.id, ar: d.ar, ico: d.ico, code: d.code, reason: reason });
            });
        }

        var decisions = [];
        if (winner) {
            answered.forEach(function (a) {
                if (a.value === 'unknown' || a.value === 'na') return;
                var acc = winner.ax && winner.ax[a.key];
                if (!acc || acc.indexOf(a.value) < 0) return;
                var favoursWinner = ranked.slice(1).some(function (d) {
                    var other = d.ax && d.ax[a.key];
                    return !other || other.indexOf(a.value) < 0;
                });
                if (favoursWinner) decisions.push({ label: a.label, answer: a.answer });
            });
            if (decisions.length > 4) decisions = decisions.slice(0, 4);
        }

        return {
            winner: winner ? publicCandidate(winner) : null,
            excluded: excluded,
            decisions: decisions,
            answers: answered
        };
    }

    return {
        normalize: normalize,
        tokenize: tokenize,
        stem: stem,
        analyzeSymptoms: analyzeSymptoms,
        buildQuestions: buildQuestions,
        interpretFreeText: interpretFreeText,
        resolve: resolve,
        parseDurationMonths: parseDurationMonths,
        parseAge: parseAge,
        getDisorder: getDisorder,
        explain: explain,
        axes: DB.axes,
        disorders: DB.disorders,
        categories: DB.categories,
        meta: DB.meta
    };
});
