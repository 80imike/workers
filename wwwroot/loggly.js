(function () {
    'use strict';

    var CONFIG = {
        // Settings > API Tokens
        apiToken: '6ebc94ed-8979-4a5a-89e9-5d86fd2f81bf',
        subdomain: 'netnr',
        baseUrl: 'https://netnr.loggly.com/apiv2',
        query: {
            q: '*',
            until: 'now'
        },
        fields: {
            defaultFilterPrefix: 'json.',
            preferredField: 'json.proxyHost'
        },
        time: {
            ranges: [
                { label: 'Last hour', from: '-1h' },
                { label: 'Last 6 hours', from: '-6h' },
                { label: 'Last day', from: '-24h' },
                { label: 'Last 7 days', from: '-7d' }
            ],
            defaultFrom: '-24h'
        },
        limits: {
            statsTopNOptions: [30, 100],
            detailLimitOptions: [30, 100],
            defaultTopN: 30,
            defaultDetailLimit: 30
        }
    };

    var state = {
        allFields: [],
        activeField: null,
        detailEvents: [],
        detailFilter: null,
        currentStatsRows: [],
        rangeFrom: CONFIG.time.defaultFrom,
        topN: CONFIG.limits.defaultTopN,
        detailLimit: CONFIG.limits.defaultDetailLimit
    };

    var $q = document.getElementById.bind(document);
    var $fieldList = $q('fieldList');
    var $fieldFilter = $q('fieldFilter');
    var $fieldTotal = $q('fieldTotal');
    var $statusText = $q('statusText');
    var $resultsArea = $q('resultsArea');
    var $timeChips = $q('timeChips');

    function setStatus(msg) {
        if ($statusText) {
            $statusText.textContent = msg;
        }
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmt(n) {
        return Number(n || 0).toLocaleString();
    }

    function buildQuery() {
        return {
            q: CONFIG.query.q,
            from: state.rangeFrom || CONFIG.time.defaultFrom,
            until: CONFIG.query.until
        };
    }

    function buildDetailQuery(query, detailFilter) {
        if (!detailFilter || !detailFilter.field) {
            return query.q;
        }

        var term = String(detailFilter.term == null ? '' : detailFilter.term)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
        var filterQuery = detailFilter.field + ':"' + term + '"';
        return query.q === '*' ? filterQuery : '(' + query.q + ') AND ' + filterQuery;
    }

    function getStatsTopN() {
        var sel = $q('statsTopNSelect');
        if (sel) {
            var v = parseInt(sel.value, 10);
            if (!isNaN(v) && v > 0) {
                state.topN = v;
            }
        }
        return state.topN;
    }

    function getDetailLimit() {
        var sel = $q('detailLimitSelect');
        if (sel) {
            var v = parseInt(sel.value, 10);
            if (!isNaN(v) && v > 0) {
                state.detailLimit = v;
            }
        }
        return state.detailLimit;
    }

    function apiGet(url) {
        return fetch(url, {
            headers: {
                'Authorization': 'Bearer ' + CONFIG.apiToken
            }
        }).then(function (r) {
            if (!r.ok) {
                throw new Error('HTTP ' + r.status);
            }
            return r.json();
        });
    }

    function renderSelectOptions(options, selectedValue) {
        return (options || []).map(function (v) {
            var sel = Number(selectedValue) === Number(v) ? ' selected' : '';
            return '<option value="' + v + '"' + sel + '>' + v + ' items</option>';
        }).join('');
    }

    function initChips() {
        var ranges = CONFIG.time.ranges || [];
        ranges.forEach(function (range) {
            var btn = document.createElement('button');
            btn.className = 'chip';
            btn.textContent = range.label;
            btn.addEventListener('click', function () {
                var chips = document.querySelectorAll('.chip');
                chips.forEach(function (c) {
                    c.classList.remove('active');
                });
                btn.classList.add('active');
                state.rangeFrom = range.from;
                runQuery();
            });
            $timeChips.appendChild(btn);
        });

        var defaultIndex = ranges.findIndex(function (r) {
            return r.from === CONFIG.time.defaultFrom;
        });
        if (defaultIndex < 0) {
            defaultIndex = 0;
        }
        if ($timeChips.children[defaultIndex]) {
            $timeChips.children[defaultIndex].classList.add('active');
            state.rangeFrom = ranges[defaultIndex].from;
        } else {
            state.rangeFrom = CONFIG.time.defaultFrom;
        }
    }

    function getFilteredFields() {
        var kw = ($fieldFilter.value || '').trim().toLowerCase();
        if (!kw) {
            return state.allFields;
        }
        return state.allFields.filter(function (name) {
            return name.toLowerCase().indexOf(kw) !== -1;
        });
    }

    function renderFieldList(fields) {
        $fieldList.innerHTML = '';
        if (!fields.length) {
            $fieldList.innerHTML = '<li class="hint-item">No matching fields</li>';
            return;
        }
        fields.forEach(function (name) {
            var li = document.createElement('li');
            li.textContent = name;
            li.title = name;
            if (name === state.activeField) {
                li.classList.add('active');
            }
            li.addEventListener('click', function () {
                selectField(name);
            });
            $fieldList.appendChild(li);
        });
    }

    function renderResultShell() {
        var statsOptions = renderSelectOptions(CONFIG.limits.statsTopNOptions, state.topN);
        var detailOptions = renderSelectOptions(CONFIG.limits.detailLimitOptions, state.detailLimit);

        $resultsArea.innerHTML = '' +
            '<div class="result-split">' +
            '<section class="result-pane">' +
            '<div class="pane-head">' +
            '<span id="statsTitle" class="pane-title">Field Stats</span>' +
            '<select id="statsTopNSelect" class="pane-select">' +
            statsOptions +
            '</select>' +
            '</div>' +
            '<div id="statsPane" class="detail-wrap"><div class="empty-card">Select a field to view stats</div></div>' +
            '</section>' +
            '<section class="result-pane">' +
            '<div class="pane-head">' +
            '<span class="pane-head-main"><span class="pane-title">Details</span><span id="detailFilterText" class="detail-filter-label"></span><button id="clearDetailFilterBtn" class="mini-btn" type="button" style="display:none">Clear</button></span>' +
            '<select id="detailLimitSelect" class="pane-select">' +
            detailOptions +
            '</select>' +
            '</div>' +
            '<div class="detail-wrap">' +
            '<table class="detail-table">' +
            '<thead><tr><th>Timestamp</th><th>Raw</th></tr></thead>' +
            '<tbody id="detailBody"><tr><td colspan="2" class="loading-row">Loading details...</td></tr></tbody>' +
            '</table>' +
            '</div>' +
            '</section>' +
            '</div>';

        var clearBtn = $q('clearDetailFilterBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                state.detailFilter = null;
                loadRecentEvents(buildQuery(), null);
            });
        }

        var topSel = $q('statsTopNSelect');
        if (topSel) {
            topSel.addEventListener('change', function () {
                getStatsTopN();
                if (state.activeField) {
                    fetchFieldStats(state.activeField);
                }
            });
        }

        var detailSel = $q('detailLimitSelect');
        if (detailSel) {
            detailSel.addEventListener('change', function () {
                getDetailLimit();
                loadRecentEvents(buildQuery(), state.detailFilter);
            });
        }
    }

    function updateFieldHighlight() {
        var items = $fieldList.querySelectorAll('li');
        items.forEach(function (li) {
            li.classList.toggle('active', li.textContent === state.activeField);
        });
    }

    function loadFieldsList(query) {
        var url = CONFIG.baseUrl + '/fields/?q=' + encodeURIComponent(query.q) +
            '&from=' + encodeURIComponent(query.from) +
            '&until=' + encodeURIComponent(query.until);

        return apiGet(url).then(function (data) {
            state.allFields = (data.fields || []).map(function (f) {
                return f.name;
            }).sort();
            $fieldTotal.textContent = state.allFields.length;
            renderFieldList(getFilteredFields());
            return state.allFields;
        });
    }

    function showDetailLoading() {
        var body = $q('detailBody');
        if (body) {
            body.innerHTML = '<tr><td colspan="2" class="loading-row">Querying details...</td></tr>';
        }
    }

    function loadRecentEvents(query, detailFilter) {
        var detailLimit = getDetailLimit();
        var finalQuery = buildDetailQuery(query, detailFilter);
        var searchUrl = CONFIG.baseUrl + '/search?q=' + encodeURIComponent(finalQuery) +
            '&from=' + encodeURIComponent(query.from) +
            '&until=' + encodeURIComponent(query.until) +
            '&size=' + detailLimit;

        showDetailLoading();

        return apiGet(searchUrl).then(function (searchData) {
            var rsid = searchData && searchData.rsid && searchData.rsid.id;
            if (!rsid) {
                throw new Error('search rsid missing');
            }
            var eventsUrl = CONFIG.baseUrl + '/events?rsid=' + encodeURIComponent(rsid) + '&page=0';
            return apiGet(eventsUrl);
        }).then(function (eventData) {
            state.detailEvents = (eventData && eventData.events) ? eventData.events.slice(0, detailLimit) : [];
            renderDetails();
            return state.detailEvents;
        });
    }

    function selectField(name) {
        state.activeField = name;
        state.detailFilter = null;
        state.currentStatsRows = [];
        updateFieldHighlight();

        var statsPane = $q('statsPane');
        var statsTitle = $q('statsTitle');
        if (statsPane) {
            statsPane.innerHTML = '<table class="stat-table"><tbody><tr class="loading-row"><td colspan="3">Querying stats...</td></tr></tbody></table>';
        }
        if (statsTitle) {
            statsTitle.textContent = 'Field Stats (' + name + ')';
        }

        fetchFieldStats(name);
        renderDetails();
    }

    function fetchFieldStats(fieldName) {
        var query = buildQuery();
        var facetSize = getStatsTopN();
        var url = CONFIG.baseUrl + '/fields/' + encodeURIComponent(fieldName) +
            '?q=' + encodeURIComponent(query.q) +
            '&from=' + encodeURIComponent(query.from) +
            '&until=' + encodeURIComponent(query.until) +
            '&facet_size=' + facetSize;

        setStatus('Querying stats for ' + fieldName + '...');

        apiGet(url).then(function (data) {
            var totalEvents = data.total_events || 0;
            var rows = (data[fieldName] || []).slice().sort(function (a, b) {
                return b.count - a.count;
            });
            state.currentStatsRows = rows;
            renderStats(fieldName, rows, totalEvents, facetSize);
            setStatus('Total events ' + fmt(totalEvents));
        }).catch(function (err) {
            var statsPane = $q('statsPane');
            if (statsPane) {
                statsPane.innerHTML = '<div class="empty-card">Stats query failed: ' + esc(err.message) + '</div>';
            }
            setStatus('Stats failed: ' + err.message);
        });
    }

    function renderStats(fieldName, rows, totalEvents, facetSize) {
        var statsPane = $q('statsPane');
        if (!statsPane) {
            return;
        }

        if (!rows.length) {
            statsPane.innerHTML = '<div class="empty-card">No stats data for field ' + esc(fieldName) + '</div>';
            return;
        }

        var maxCount = rows[0].count || 1;
        var sumCount = 0;
        var body = '';
        rows.forEach(function (row, i) {
            sumCount += Number(row.count || 0);
            var pct = totalEvents > 0 ? (row.count / totalEvents * 100) : 0;
            var barW = maxCount > 0 ? (row.count / maxCount * 100) : 0;
            var cls = 'stat-term';
            if (state.detailFilter && state.detailFilter.field === fieldName && String(state.detailFilter.term) === String(row.term)) {
                cls += ' filter-hit';
            }
            body += '<tr class="' + cls + '" data-term="' + esc(row.term) + '">' +
                '<td><span class="rank">#' + (i + 1) + '</span> ' + esc(row.term) + '</td>' +
                '<td class="bar-cell"><div class="bar-wrap"><div class="bar-rail"><div class="bar-fill" style="width:' + barW.toFixed(1) + '%"></div></div><span class="bar-pct">' + pct.toFixed(1) + '%</span></div></td>' +
                '<td>' + fmt(row.count) + '</td>' +
                '</tr>';
        });

        statsPane.innerHTML = '<table class="stat-table">' +
            '<thead><tr><th>Value (click to filter details)</th><th>Ratio</th><th>Count</th></tr></thead>' +
            '<tbody>' + body + '</tbody>' +
            '</table>' +
            '<div class="pane-head"><span></span><span>Total count <strong>' + fmt(sumCount) + '</strong></span></div>';

        var rowsDom = statsPane.querySelectorAll('tr.stat-term');
        rowsDom.forEach(function (tr) {
            tr.addEventListener('click', function () {
                var term = tr.getAttribute('data-term');
                state.detailFilter = {
                    field: fieldName,
                    term: term
                };
                renderStats(fieldName, state.currentStatsRows, totalEvents, facetSize);
                loadRecentEvents(buildQuery(), state.detailFilter);
            });
        });
    }

    function tryParseJson(v) {
        if (!v || typeof v !== 'string') {
            return null;
        }
        var s = v.trim();
        if (!s || (s[0] !== '{' && s[0] !== '[')) {
            return null;
        }
        try {
            return JSON.parse(s);
        } catch (e) {
            return null;
        }
    }

    function unwrapEvent(evt) {
        if (!evt || typeof evt !== 'object') {
            return {};
        }

        if (evt.json && typeof evt.json === 'object') {
            return evt.json;
        }

        var raw = evt.event;
        if (raw && typeof raw === 'object') {
            if (raw.json && typeof raw.json === 'object') {
                return raw.json;
            }
            return raw;
        }

        var parsed = tryParseJson(raw);
        if (parsed && typeof parsed === 'object') {
            if (parsed.json && typeof parsed.json === 'object') {
                return parsed.json;
            }
            return parsed;
        }

        return evt;
    }

    function readFieldValue(evt, fieldName) {
        if (!evt || !fieldName) {
            return null;
        }

        if (Object.prototype.hasOwnProperty.call(evt, fieldName)) {
            return evt[fieldName];
        }

        var payload = unwrapEvent(evt);
        if (Object.prototype.hasOwnProperty.call(payload, fieldName)) {
            return payload[fieldName];
        }

        if (fieldName.indexOf('json.') === 0) {
            var sub = fieldName.substring(5);
            if (Object.prototype.hasOwnProperty.call(payload, sub)) {
                return payload[sub];
            }
            if (payload.json && typeof payload.json === 'object' && Object.prototype.hasOwnProperty.call(payload.json, sub)) {
                return payload.json[sub];
            }
        }

        var parts = fieldName.split('.');
        var cur = payload;
        var i;
        for (i = 0; i < parts.length; i++) {
            if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, parts[i])) {
                cur = null;
                break;
            }
            cur = cur[parts[i]];
        }

        if (cur != null) {
            return cur;
        }

        return null;
    }

    function renderDetails() {
        var body = $q('detailBody');
        var filterText = $q('detailFilterText');
        if (!body) {
            return;
        }

        var events = state.detailEvents.slice();
        var clearBtn = $q('clearDetailFilterBtn');
        if (state.detailFilter && state.detailFilter.field) {
            if (filterText) {
                filterText.textContent = '（' + state.detailFilter.field + ' = ' + state.detailFilter.term + '）';
            }
            if (clearBtn) { clearBtn.style.display = ''; }
        } else {
            if (filterText) { filterText.textContent = ''; }
            if (clearBtn) { clearBtn.style.display = 'none'; }
        }

        if (!events.length) {
            body.innerHTML = '<tr><td colspan="2" class="loading-row">No matching details</td></tr>';
            return;
        }

        var html = '';
        events.forEach(function (evt) {
            var payload = unwrapEvent(evt);
            var t = formatTimestamp(evt.timestamp || evt.timestamp_usec || evt.timestamp_ms || payload.time || payload.timestamp || '');
            var raw = evt.event;
            if (raw && typeof raw === 'object') {
                raw = JSON.stringify(raw);
            }
            if (!raw) {
                raw = JSON.stringify(payload);
            }
            raw = String(raw || '');
            html += '<tr>' +
                '<td>' + esc(t) + '</td>' +
                '<td>' + esc(raw) + '</td>' +
                '</tr>';
        });

        body.innerHTML = html;
    }

    function formatTimestamp(v) {
        var num = Number(v);
        if (isNaN(num) || !isFinite(num) || num <= 0) {
            return String(v || '-');
        }

        if (num > 9999999999999) {
            num = Math.floor(num / 1000);
        } else if (num < 1000000000000) {
            num = num * 1000;
        }

        var d = new Date(num);
        if (isNaN(d.getTime())) {
            return String(v || '-');
        }

        function p2(n) { return n < 10 ? '0' + n : '' + n; }
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
            p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    }

    function runQuery() {
        state.activeField = null;
        state.detailFilter = null;
        state.currentStatsRows = [];
        renderResultShell();
        setStatus('Querying...');

        var query = buildQuery();

        Promise.allSettled([
            loadFieldsList(query),
            loadRecentEvents(query, null)
        ]).then(function (results) {
            var fieldsOk = results[0].status === 'fulfilled';
            var detailsOk = results[1].status === 'fulfilled';

            if (fieldsOk) {
                var visible = getFilteredFields();
                renderFieldList(visible);
                if (visible.length) {
                    var preferredName = CONFIG.fields.preferredField;
                    var preferred = visible.indexOf(preferredName) >= 0 ? preferredName : visible[0];
                    selectField(preferred);
                }
            } else {
                $fieldList.innerHTML = '<li class="hint-item">Field query failed</li>';
            }

            if (!detailsOk) {
                var body = $q('detailBody');
                if (body) {
                    body.innerHTML = '<tr><td colspan="2" class="loading-row">Details query failed</td></tr>';
                }
            }

            if (fieldsOk && detailsOk) {
                setStatus('Ready');
            } else if (!fieldsOk && !detailsOk) {
                setStatus('Fields and details queries both failed');
            } else if (!fieldsOk) {
                setStatus('Field query failed, details available');
            } else {
                setStatus('Details query failed, stats available');
            }
        });
    }

    $fieldFilter.addEventListener('input', function () {
        renderFieldList(getFilteredFields());
    });

    var $logo = document.querySelector('.logo');
    if ($logo) {
        $logo.textContent = CONFIG.subdomain + '.loggly.com';
    }

    if ($fieldFilter && !$fieldFilter.value) {
        $fieldFilter.value = CONFIG.fields.defaultFilterPrefix;
    }
    initChips();
    runQuery();
}());
