(function () {
    'use strict';
    if (window.mycinema_loaded) return;
    window.mycinema_loaded = true;

    var ID = 'mycinema', NAME = 'Мой кинотеатр', initialized = false;
    var ICON = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 5 7 5-7 5z"/></svg>';
    var DEMO = 'https://media.w3.org/2010/05/bunny/movie.mp4';

    function httpURL(value) { return typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value); }
    function escapeText(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function serverURL() { return String(Lampa.Storage.field('mycinema_server') || '').replace(/\/+$/, ''); }
    var PUBLIC_SERVER = 'http://wtch.ch';
    // Reserved internal origin. These navigation URLs never reach the network.
    var DEVICE_ORIGIN = 'https://mycinema.invalid';
    function backend(kind) {
        if (kind === 'rutube') return {kind: kind, base: DEVICE_ORIGIN, token: ''};
        if (kind === 'device') return {kind: kind, base: DEVICE_ORIGIN, token: '',
            host: String(Lampa.Storage.field('mycinema_filmix_host') || '').trim().replace(/\/+$/, ''),
            account: String(Lampa.Storage.field('mycinema_filmix_token') || '')};
        return {kind: kind, base: kind === 'public' ? PUBLIC_SERVER : String(Lampa.Storage.field(kind === 'direct' ? 'mycinema_server' : 'mycinema_lampac') || '').trim().replace(/\/+$/, ''),
            token: kind === 'public' ? '' : String(Lampa.Storage.field(kind === 'direct' ? 'mycinema_direct_access' : 'mycinema_access') || '')};
    }
    function onlineURL(value, params, connection) {
        var base = connection.base;
        if (!httpURL(base)) throw new Error('Укажите адрес сервера в Настройки → Мой кинотеатр.');
        var url = new URL(String(value).replace(/\{localhost\}/g, base), base + '/');
        if (!httpURL(url.href)) throw new Error('Источник вернул неподдерживаемый адрес.');
        Object.keys(params || {}).forEach(function (key) { if (!url.searchParams.has(key)) url.searchParams.set(key, params[key]); });
        // A token configured for a private backend must never reach the public service.
        var access = connection.token;
        if (access && url.origin === new URL(base).origin) url.searchParams.set('token', access);
        return url.href;
    }
    function onlineParams(movie) {
        var params = {id: movie.id, source: namespace(movie), title: movie.title || movie.name || '',
            original_title: movie.original_title || movie.original_name || '', serial: mediaType(movie) === 'tv' ? 1 : 0,
            original_language: movie.original_language || '', year: String(movie.release_date || movie.first_air_date || '0000').slice(0, 4)};
        ['imdb_id', 'kinopoisk_id', 'tmdb_id'].forEach(function (key) { if (movie[key]) params[key] = movie[key]; });
        return params;
    }
    function deviceFilmix(params, connection, network, done, failed) {
        var host;
        try {
            host = new URL(connection.host);
            if (host.protocol !== 'https:' || host.username || host.password || host.pathname !== '/' || host.search || host.hash) throw new Error();
        } catch (error) { failed('Для Filmix укажите HTTPS API host без пути, например https://api.example.org.'); return; }
        var deviceID = Lampa.Storage.get('mycinema_device_id', '');
        if (!deviceID) { deviceID = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); Lampa.Storage.set('mycinema_device_id', deviceID); }
        function api(path, query, callback) {
            var url = new URL('/api/v2/' + path, host.origin);
            var args = {app_lang: 'ru_RU', user_dev_apk: '2.2.13', user_dev_id: deviceID, user_dev_name: 'MyCinema',
                user_dev_os: '12', user_dev_vendor: 'MyCinema', user_dev_token: connection.account};
            Object.keys(query || {}).forEach(function (key) { args[key] = query[key]; });
            Object.keys(args).forEach(function (key) { url.searchParams.set(key, args[key]); });
            network.timeout(15000);
            network.native(url.href, function (data) {
                try {
                    if (typeof data === 'string') data = JSON.parse(data);
                    if (!data || typeof data !== 'object' || data.error) { failed('Filmix отклонил запрос. Проверьте свой доступ и API host.'); return; }
                    callback(data);
                } catch (error) { failed('Неподдерживаемый ответ Filmix.'); }
            }, function () { failed('Нет прямого доступа к Filmix. Возможны недоступность API, ограничения CORS или авторизация. Можно подключить свой Lampac.'); }, false, {dataType: 'json'});
        }
        function link(query) {
            var url = new URL('/filmix', DEVICE_ORIGIN);
            Object.keys(query).forEach(function (key) { url.searchParams.set(key, query[key]); });
            return url.href;
        }
        function qualities(entry) {
            if (!entry || !httpURL(entry.link)) return {};
            var match = entry.link.match(/_\[([0-9,]+)\]\.mp4/), result = {};
            var advertised = match ? match[1].split(',') : (Array.isArray(entry.qualities) ? entry.qualities : []);
            advertised.map(Number).filter(function (q) { return q > 0 && q <= 480 && q % 1 === 0; }).sort(function (a, b) { return b - a; }).forEach(function (q) {
                result[q + 'p'] = match ? entry.link.replace(/_\[[0-9,]+\]\.mp4/, '_' + q + '.mp4') : entry.link.replace('_%s.mp4', '_' + q + '.mp4');
            });
            if (!Object.keys(result).length && !match && entry.link.indexOf('%s') < 0) result['Источник'] = entry.link;
            return result;
        }
        function index(value, length) {
            var i = Number(value || 0);
            if (i % 1 !== 0 || i < 0 || i >= length) throw new Error('invalid selection');
            return i;
        }
        var postid = params.postid;
        if (!postid) {
            var title = params.original_title || params.title;
            if (!title) { failed('В карточке нет названия для поиска.'); return; }
            api('search', {story: title}, function (rows) {
                if (!Array.isArray(rows)) { failed('Неподдерживаемый ответ поиска Filmix.'); return; }
                done({type: 'similar', data: rows.filter(function (row) { return row && /^\d+$/.test(String(row.id)); }).map(function (row) {
                    return {title: row.title || row.original_title || 'Название', year: row.year, method: 'link', url: link({postid: row.id})};
                })});
            }); return;
        }
        if (!/^\d+$/.test(String(postid))) { failed('Некорректный ID Filmix.'); return; }
        api('post/' + postid, {}, function (post) {
            var player = post.player_links;
            if (!player || typeof player !== 'object') { failed('Filmix не вернул данные плеера.'); return; }
            var entries, voices = [], kind = 'movie', voice = Number(params.t || 0);
            if (Array.isArray(player.movie) && player.movie.length) {
                entries = player.movie.map(function (row, i) { return {key: String(i), row: row}; });
            } else {
                var playlist = player.playlist;
                if (!playlist || typeof playlist !== 'object' || Array.isArray(playlist)) { done({type: 'movie', data: []}); return; }
                if (params.s == null) {
                    done({type: 'season', data: Object.keys(playlist).map(function (s) { return {name: 'Сезон ' + s, method: 'link', url: link({postid: postid, s: s})}; })}); return;
                }
                var translations = playlist[params.s], names = Object.keys(translations || {});
                voice = index(params.t, names.length);
                voices = names.map(function (name, i) { return {name: name, active: i === voice, url: link({postid: postid, s: params.s, t: i})}; });
                var episodes = translations[names[voice]];
                if (!episodes || typeof episodes !== 'object') throw new Error('invalid episodes');
                entries = Object.keys(episodes).map(function (key) { return {key: Array.isArray(episodes) ? String(Number(key) + 1) : key, row: episodes[key]}; });
                kind = 'episode';
            }
            if (params.resolve === '1') {
                var selected = kind === 'movie' ? String(index(params.t, entries.length)) : String(params.e);
                var entry = entries.filter(function (item) { return item.key === selected; })[0];
                var quality = qualities(entry && entry.row), keys = Object.keys(quality);
                if (!keys.length) { failed('Filmix не вернул поддерживаемую ссылку.'); return; }
                done({url: quality[keys[0]], quality: quality}); return;
            }
            done({type: kind, voice: voices, data: entries.filter(function (entry) {
                return entry.row && !/^заблокировано/i.test(entry.row.translation || '') && Object.keys(qualities(entry.row)).length;
            }).map(function (entry) {
                var query = {postid: postid, t: entry.key, resolve: 1};
                var row = {translate: entry.row.translation || 'Озвучка', method: 'call'};
                if (kind === 'episode') { query.s = params.s; query.t = voice; query.e = entry.key;
                    row.translate = 'Серия ' + entry.key; row.s = params.s === '-1' ? 1 : params.s; row.e = entry.key; }
                row.url = link(query); return row;
            })});
        });
    }
    function deviceRutube(params, network, done, failed) {
        var origin = 'https://rutube.ru';
        function api(path, query, callback) {
            var url = new URL(path, origin);
            Object.keys(query || {}).forEach(function (key) { url.searchParams.set(key, query[key]); });
            network.timeout(15000);
            network.native(url.href, function (data) {
                for (var pass = 0; typeof data === 'string' && pass < 2; pass++) {
                    var text = data.replace(/^\uFEFF/, '').trim();
                    if (!text) { failed('Rutube вернул пустой ответ.'); return; }
                    if (text.charAt(0) === '<') { failed('Rutube вернул HTML-страницу вместо JSON. Возможна проверка браузера или ограничение доступа.'); return; }
                    try { data = JSON.parse(text); }
                    catch (error) { failed('Rutube: ответ не является корректным JSON.'); return; }
                }
                if (!data || typeof data !== 'object' || Array.isArray(data)) { failed('Rutube: неожиданный тип ответа — ' + typeof data + '.'); return; }
                if (data.error || (Array.isArray(data.errors) ? data.errors.length : data.errors)) { failed('Rutube вернул ошибку или ограничил доступ к видео.'); return; }
                try { callback(data); }
                catch (error) {
                    failed('Ошибка расширения Rutube: ' + String(error.message || error).replace(/https?:\/\/\S+/g, '[URL]').slice(0, 160));
                }
            }, function (error) {
                failed(error && error.status ? 'Rutube: HTTP ' + error.status + '. Попробуйте другое видео или источник.' :
                    'Нет прямого доступа к Rutube из Lampa. Возможны CORS, ограничения сети или ошибка API. Успешный запрос из терминала не проверяет ограничения приложения.');
            }, false, {dataType: 'text', headers: {Accept: 'application/json'}});
        }
        function link(query) {
            var url = new URL('/rutube', DEVICE_ORIGIN);
            Object.keys(query).forEach(function (key) { url.searchParams.set(key, query[key]); });
            return url.href;
        }
        function restricted(video) {
            return ['is_hidden', 'is_deleted', 'is_locked', 'is_paid', 'is_adult', 'is_audio', 'is_livestream'].some(function (key) { return video[key] === true; });
        }
        function normal(value) {
            return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s\-–—.,:;!?"'«»()[\]{}\/\\_]+/g, ' ').trim();
        }
        function duration(value) {
            var seconds = Math.floor(Number(value)), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
            return (hours ? hours + ':' + ('0' + minutes).slice(-2) : String(minutes)) + ':' + ('0' + seconds % 60).slice(-2);
        }
        if (params.video) {
            if (!/^[a-f0-9]{32}$/i.test(params.video)) { failed('Некорректный ID видео Rutube.'); return; }
            api('/api/play/options/' + params.video + '/', {format: 'json', no_404: 'true', pver: 'v2', client: 'wdp'}, function (data) {
                if (restricted(data) || data.can_play === false || data.has_video === false) { failed('Это видео Rutube недоступно для прямого воспроизведения.'); return; }
                var stream = data.video_balancer && data.video_balancer.m3u8;
                if (typeof stream !== 'string' || !/^https:\/\//i.test(stream) || !httpURL(stream)) {
                    failed('Rutube не вернул прямой HTTPS HLS-поток. Выберите другое видео.'); return;
                }
                done({url: stream, quality: {'Авто': stream}});
            }); return;
        }
        if (String(params.serial) === '1') { failed('Прямой поиск Rutube пока поддерживает только фильмы.'); return; }
        var title = params.title || params.original_title;
        if (!title) { failed('В карточке нет названия для поиска Rutube.'); return; }
        var page = /^\d+$/.test(params.page || '') ? Number(params.page) : 1;
        if (page < 1 || page > 25) { failed('Некорректная страница поиска Rutube.'); return; }
        var names = [normal(params.title), normal(params.original_title)].filter(Boolean);
        var searchQuery = {query: title, content_type: 'video', duration: 'movie'};
        if (page > 1) searchQuery.page = page;
        api('/api/search/video/', searchQuery, function (data) {
            if (!Array.isArray(data.results)) { failed('Rutube: нет results[]. Поля ответа: ' + Object.keys(data).slice(0, 8).join(', ')); return; }
            var seen = Object.create(null);
            var rows = data.results.filter(function (video) {
                if (!video || !/^[a-f0-9]{32}$/i.test(String(video.id)) || seen[video.id] || restricted(video) || !isFinite(Number(video.duration)) || Number(video.duration) < 1200) return false;
                seen[video.id] = true;
                var name = normal(video.title);
                return names.some(function (expected) { return name.indexOf(expected) >= 0; }) && !/(^|\s)(трейлер|trailer|обзор|реакция)(\s|$)/.test(name);
            }).slice(0, 100).map(function (video) {
                return {id: video.id, translate: video.title, method: 'call', url: link({video: video.id}),
                    duration: duration(video.duration), img: video.thumbnail_url,
                    details: video.author && video.author.name ? 'Канал: ' + video.author.name : 'Rutube'};
            });
            var nextPage = 0;
            if (typeof data.next === 'string') {
                try {
                    var next = new URL(data.next, origin);
                    if (next.origin === origin && next.pathname === '/api/search/video/' && /^\d+$/.test(next.searchParams.get('page') || '')) nextPage = Number(next.searchParams.get('page'));
                } catch (error) { /* Ignore invalid pagination links. */ }
            } else if (data.has_next === true) nextPage = page + 1;
            if (nextPage > page && nextPage <= 25) rows.push({name: 'Следующая страница', method: 'link',
                url: link({title: title, original_title: params.original_title || '', serial: params.serial || 0, page: nextPage})});
            done({type: 'movie', data: rows});
        });
    }
    function directURL(value, base) {
        if (typeof value !== 'string' || !value) return '';
        try { var url = new URL(value.split(' or ')[0], base); return httpURL(url.href) ? url.href : ''; } catch (error) { return ''; }
    }
    function onlineItem(raw, type, base) {
        var method = raw.method || (type === 'season' || type === 'similar' ? 'link' : 'play');
        var quality = {};
        Object.keys(raw.quality || {}).forEach(function (key) {
            var value = directURL(raw.quality[key], base); if (value) quality[key] = value;
        });
        return {id: String(raw.id || raw.url || raw.title || raw.name || ''), method: method,
            title: raw.translate || raw.name || raw.title || 'Видео', voice: raw.voice_name || '',
            info: [raw.year, raw.details, raw.maxquality].filter(Boolean).join(' • '),
            url: directURL(raw.url, base), quality: quality,
            subtitles: (Array.isArray(raw.subtitles) ? raw.subtitles : []).map(function (sub) {
                return {label: sub.label || sub.name || '', url: directURL(sub.url, base)};
            }), headers: raw.headers, season: raw.s, episode: raw.e, poster: directURL(raw.img, base),
            duration: raw.duration, browse: method === 'link', hls_manifest_timeout: raw.hls_manifest_timeout};
    }
    function mediaType(movie) { return movie.media_type === 'tv' || movie.first_air_date || movie.name ? 'tv' : 'movie'; }
    function namespace(movie) { return movie.source || 'tmdb'; }
    function movieKey(movie) { return [namespace(movie), mediaType(movie), movie.id].join(':'); }
    function demoItems() {
        return [{id: 'bbb', title: 'Big Buck Bunny — тестовое видео', voice: 'Без диалогов', duration: '09:56',
            info: '© 2008 Blender Foundation • CC BY 3.0 • MP4', url: DEMO, demo: true}];
    }
    function open(movie) {
        Lampa.Activity.push({url: '', title: NAME, component: ID, movie: movie, page: 1});
    }

    function Screen(object) {
        var self = this, movie = object.movie;
        var files = new Lampa.Explorer(object);
        var scroll = new Lampa.Scroll({mask: true, over: true});
        var filter = new Lampa.Filter(object);
        var network = new Lampa.Reguest();
        var sources = [], sourceID = '', items = [], season = '', last = null;
        var ready = false, alive = true, generation = 0;
        var mode = Lampa.Storage.field('mycinema_mode') || 'all';
        var sourceStorageKey = 'mycinema_source_' + mode;
        var currentBackend = null, catalogSourceID = '', discoveryErrors = [];
        var currentOnlineURL = '', onlineStack = [], voices = [], resolving = false;

        function isActive() {
            var active = Lampa.Activity.active();
            return alive && active && active.activity === self.activity;
        }
        function refocus() { if (isActive()) self.start(); }
        function message(text, retry) {
            scroll.clear(); scroll.reset(); last = null;
            var row = $('<div class="mycinema-message"></div>').text(text);
            scroll.append(row);
            if (retry) {
                var button = $('<div class="simple-button selector">Повторить</div>');
                button.on('hover:enter', typeof retry === 'function' ? retry : load);
                scroll.append(button);
            }
            refocus();
        }
        function get(path, done, failed) {
            var base = serverURL();
            if (!httpURL(base)) { failed('Укажите адрес сервера в Настройки → Мой кинотеатр.'); return; }
            network.timeout(path === '/api/sources' ? 8000 : 15000);
            network.silent(base + path, done, function () {
                failed('Сервер не отвечает. Проверьте адрес, HTTPS и доступ из сети телевизора.');
            }, false, {dataType: 'json'});
        }
        function readOnline(url, done, failed, jsonMode, connection) {
            var discovery = !!connection;
            connection = connection || currentBackend;
            try {
                url = onlineURL(url, null, connection);
                if (jsonMode) { var parsed = new URL(url); parsed.searchParams.set('rjson', 'true'); url = parsed.href; }
            } catch (error) { failed(error.message); return; }
            if (connection.kind === 'device' || connection.kind === 'rutube') {
                var internal = new URL(url), params = {};
                var route = connection.kind === 'rutube' ? '/rutube' : '/filmix';
                if (internal.origin !== DEVICE_ORIGIN || internal.pathname !== route) { failed('Некорректный переход клиентского адаптера.'); return; }
                internal.searchParams.forEach(function (value, key) { params[key] = value; });
                if (connection.kind === 'rutube') { deviceRutube(params, network, function (data) { done(data, url); }, failed); return; }
                deviceFilmix(params, connection, network, function (data) { done(data, url); }, failed); return;
            }
            network.timeout(discovery ? 8000 : 30000);
            network.native(url, function (data) {
                if (typeof data === 'string') { try { data = JSON.parse(data); } catch (error) { failed('Lampac вернул страницу вместо JSON. Проверьте адрес и доступ к API.'); return; } }
                if (!data || typeof data !== 'object') { failed('Пустой ответ источника.'); return; }
                if (data.rch) { failed('Этот источник требует Remote Control Hub. Настройте серверный доступ в Lampac или выберите другой источник.'); return; }
                if (data.accsdb) { failed('Lampac требует авторизацию. Укажите свой токен доступа в настройках расширения.'); return; }
                if (data.error) { failed('Источник вернул ошибку. Проверьте настройки и токены выбранного сервера.'); return; }
                done(data, url);
            }, function () { failed('Нет ответа от Lampac или источника. Проверьте HTTPS, CORS, адрес и токен доступа.'); }, false, {dataType: 'json'});
        }
        function loadOnline(url, push) {
            var ticket = ++generation;
            resolving = false; network.clear(); items = []; voices = []; season = '';
            if (push && currentOnlineURL) onlineStack.push(currentOnlineURL);
            currentOnlineURL = url;
            message('Загружаем видео из источника…');
            readOnline(url, function (data, resolvedURL) {
                if (!alive || ticket !== generation) return;
                if (!data.type && Object.keys(data).length === 0) { draw(); return; }
                if (['movie', 'episode', 'season', 'similar'].indexOf(data.type) < 0 || !Array.isArray(data.data)) {
                    message('Формат ответа не поддерживается. Нужен Lampac с JSON API rjson=true.', function () { loadOnline(url, false); }); return;
                }
                voices = (Array.isArray(data.voice) ? data.voice : []).filter(function (voice) { return voice && voice.url; });
                items = data.data.filter(function (raw) { return raw && typeof raw === 'object'; }).map(function (raw) { return onlineItem(raw, data.type, resolvedURL); });
                draw();
            }, function (error) { if (alive && ticket === generation) message(error, function () { loadOnline(url, false); }); }, true);
        }
        function enter(item) {
            if (item.browse) { loadOnline(item.url, true); return; }
            if (item.method !== 'call') { chooseQuality(item); return; }
            if (resolving) return;
            resolving = true;
            var ticket = generation;
            Lampa.Noty.show('Получаем свежую ссылку на видео…');
            readOnline(item.url, function (data, url) {
                if (!alive || ticket !== generation) return;
                resolving = false;
                var resolved = onlineItem(data, 'movie', url);
                if (!resolved.url && !Object.keys(resolved.quality).length) { Lampa.Noty.show('Источник не вернул ссылку на поток.'); return; }
                resolved.title = item.title; resolved.voice = item.voice; resolved.season = item.season; resolved.episode = item.episode;
                chooseQuality(resolved);
            }, function (error) { if (alive && ticket === generation) { resolving = false; Lampa.Noty.show(error); } }, false);
        }
        function chooseQuality(item) {
            var quality = item.quality || {}, keys = Object.keys(quality).filter(function (key) { return httpURL(quality[key]); });
            if (keys.length < 2) { play(item, keys[0] ? quality[keys[0]] : item.url); return; }
            Lampa.Select.show({title: 'Качество', items: keys.map(function (key) { return {title: escapeText(key), url: quality[key]}; }),
                onBack: refocus, onSelect: function (choice) { Lampa.Select.close(); play(item, choice.url); }});
        }
        function timelineFor(item) {
            var api = Lampa.Timeline;
            if (!api || typeof api.view !== 'function') return null;
            try {
                var hash = Lampa.Utils.hash([ID, movieKey(movie), item.season || '', item.episode || ''].join('|'));
                var meta = typeof api.link === 'function' ? api.link(movie, item.season, item.episode) : undefined;
                return api.view(hash, meta);
            } catch (error) { return null; }
        }
        function play(item, url) {
            if (!httpURL(url)) { Lampa.Noty.show('Источник не вернул прямую ссылку на видео.'); return; }
            var data = {url: url, title: item.demo ? item.title : (movie.title || movie.name) + ' • ' + (item.title || item.voice),
                subtitles: (Array.isArray(item.subtitles) ? item.subtitles : []).filter(function (sub) { return sub && httpURL(sub.url); })};
            if (item.headers) data.headers = item.headers;
            if (item.hls_manifest_timeout) data.hls_manifest_timeout = item.hls_manifest_timeout;
            if (!item.demo) {
                data.card = movie;
                data.movie = movie;
                var timeline = timelineFor(item);
                if (timeline) data.timeline = timeline;
            }
            Lampa.Player.play(data);
            Lampa.Player.playlist([data]);
        }
        function draw() {
            scroll.clear(); scroll.reset(); last = null;
            filter.render().find('.filter--sort span').text('Источник');
            filter.chosen('sort', [escapeText(sources.filter(function (s) { return s.id === sourceID; })[0].name)]);
            filter.set('sort', sources.map(function (s) { return {title: escapeText(s.name), source: s.id, selected: s.id === sourceID}; }));
            var seasons = [];
            items.forEach(function (item) { if (item.season != null && seasons.indexOf(String(item.season)) < 0) seasons.push(String(item.season)); });
            seasons.sort(function (a, b) { return Number(a) - Number(b); });
            filter.set('filter', (seasons.length ? [{title: 'Все сезоны', season: '', selected: !season}] : []).concat(seasons.map(function (s) {
                return {title: 'Сезон ' + escapeText(s), season: s, selected: season === s};
            })).concat(voices.map(function (voice) { return {title: 'Озвучка: ' + escapeText(voice.name || 'Перевод'), online_url: voice.url, selected: voice.active}; })));
            filter.chosen('filter', season ? ['Сезон ' + escapeText(season)] : []);
            if (currentBackend && currentBackend.kind === 'rutube') scroll.append($('<div class="mycinema-message"></div>').text('Результаты поиска Rutube: проверьте название, год и продолжительность перед просмотром. Качество потока выбирается плеером автоматически.'));
            if (discoveryErrors.length) scroll.append($('<div class="mycinema-message"></div>').text('Недоступные подключения: ' + discoveryErrors.join(' • ') + '. Нажмите «Обновить» для повторной проверки.'));
            if (sourceID === 'demo') scroll.append($('<div class="mycinema-message"></div>').text('Демонстрация плеера: Big Buck Bunny. Это тестовое видео, а не фильм из открытой карточки.'));
            if (onlineStack.length) scroll.append($('<div class="simple-button selector">Назад к выбору</div>').on('hover:enter', back));
            var visible = items.filter(function (item) { return !season || String(item.season) === season; });
            if (!visible.length) scroll.append($('<div class="mycinema-message"></div>').text('Для этой карточки видео не найдено. Выберите другой источник или добавьте фильм в каталог сервера.'));
            visible.forEach(function (item) {
                var row = $('<div class="mycinema-row selector"><div class="mycinema-thumb">▶</div><div class="mycinema-body"><div class="mycinema-title"></div><div class="mycinema-info"></div><div class="mycinema-progress"></div></div><div class="mycinema-duration"></div></div>');
                var labels = [item.voice, item.info];
                if (item.episode != null) labels.unshift('Сезон ' + item.season + ' • Серия ' + item.episode);
                row.find('.mycinema-title').text(item.title || item.voice || 'Видео');
                row.find('.mycinema-info').text(labels.filter(Boolean).join(' • '));
                row.find('.mycinema-duration').text(item.duration || '');
                if (httpURL(item.poster)) row.find('.mycinema-thumb').empty().append($('<img alt="" />').attr('src', item.poster));
                if (item.browse) row.find('.mycinema-thumb').text('›');
                if (!item.demo && !item.browse) {
                    var timeline = timelineFor(item);
                    if (timeline && typeof Lampa.Timeline.render === 'function') row.find('.mycinema-progress').append(Lampa.Timeline.render(timeline));
                }
                row.on('hover:focus', function () { last = row[0]; scroll.update(row, true); });
                row.on('hover:enter', function () { enter(item); });
                scroll.append(row);
            });
            refocus();
        }
        function load() {
            onlineStack = []; voices = []; resolving = false; currentOnlineURL = '';
            var selected = sources.filter(function (s) { return s.id === sourceID; })[0];
            currentBackend = selected && selected.connection;
            catalogSourceID = selected && selected.catalogID || sourceID;
            if (selected && selected.url) { loadOnline(selected.url, false); return; }
            var ticket = ++generation;
            network.clear(); season = ''; items = [];
            if (sourceID === 'demo') { items = demoItems(); draw(); return; }
            message('Ищем видео…');
            var query = '?source=' + encodeURIComponent(catalogSourceID) + '&id=' + encodeURIComponent(movie.id) +
                '&media_type=' + encodeURIComponent(mediaType(movie)) + '&namespace=' + encodeURIComponent(namespace(movie));
            get('/api/streams' + query, function (data) {
                if (!alive || ticket !== generation) return;
                if (!data || !Array.isArray(data.streams)) { message('Неверный ответ API: ожидается streams[].', true); return; }
                items = data.streams.filter(function (item) { return item && typeof item === 'object'; });
                draw();
            }, function (error) { if (alive && ticket === generation) message(error, true); });
        }
        function discover() {
            var ticket = ++generation;
            network.clear(); discoveryErrors = [];
            message('Загружаем источники…');
            function found(data) {
                if (!alive || ticket !== generation) return;
                if (!data || !Array.isArray(data.sources)) { message('Неверный ответ API: ожидается sources[].', discover); return; }
                sources = data.sources.filter(function (s) { return s && typeof s.id === 'string' && s.id !== 'demo' && typeof s.name === 'string'; });
                sources.push({id: 'demo', name: 'Демо • Big Buck Bunny'});
                sourceID = Lampa.Storage.get(sourceStorageKey, '');
                if (!sources.some(function (s) { return s.id === sourceID; })) sourceID = sources[0].id;
                load();
            }
            function failed(error) {
                if (!alive || ticket !== generation) return;
                sources = [{id: 'demo', name: 'Демо • Big Buck Bunny'}]; sourceID = 'demo';
                items = []; draw();
                message(error + ' Для проверки плеера выберите «Демо» в меню «Источник».', discover);
            }
            var tasks = [], available = [];
            if (mode === 'all' || mode === 'device') {
                if (backend('device').host) tasks.push('device');
                if (Lampa.Storage.field('mycinema_rutube') !== 'no' && mediaType(movie) !== 'tv') tasks.push('rutube');
                if (mode === 'all') {
                    if (httpURL(backend('direct').base)) tasks.push('direct', 'catalog');
                    if (httpURL(backend('lampac').base)) tasks.push('lampac');
                    if (Lampa.Storage.field('mycinema_public') === 'yes') tasks.push('public');
                }
            } else tasks.push(mode);
            function next() {
                if (!alive || ticket !== generation) return;
                if (!tasks.length) {
                    if (!available.length) { failed(discoveryErrors.join(' • ') || 'Нет настроенных источников для этой карточки. Включите Rutube для фильмов или подключите другой источник в настройках.'); return; }
                    found({sources: available}); return;
                }
                var kind = tasks.shift(), connection = backend(kind);
                var label = {device: 'На устройстве', direct: 'Свой адаптер', lampac: 'Свой Lampac', public: 'WTCH', catalog: 'Каталог'}[kind] || kind;
                function error(text) { if (!alive || ticket !== generation) return; discoveryErrors.push(label + ': ' + text); next(); }
                if (kind === 'rutube') {
                    available.push({id: 'device-rutube', name: 'Rutube • На устройстве', connection: connection,
                        url: onlineURL(DEVICE_ORIGIN + '/rutube', onlineParams(movie), connection)});
                    next(); return;
                }
                if (kind === 'device') {
                    available.push({id: 'device-filmix', name: 'Filmix (до 480p) • На устройстве', connection: connection,
                        url: onlineURL(DEVICE_ORIGIN + '/filmix', onlineParams(movie), connection)});
                    next(); return;
                }
                if (kind === 'catalog') {
                    get('/api/sources', function (data) {
                        if (!alive || ticket !== generation) return;
                        if (!data || !Array.isArray(data.sources)) { error('неверный формат API'); return; }
                        data.sources.forEach(function (s) {
                            if (s && s.id && s.id !== 'demo' && typeof s.name === 'string') available.push({id: mode === 'all' ? 'catalog:' + s.id : s.id,
                                catalogID: s.id, name: s.name + (mode === 'all' ? ' • Каталог' : '')});
                        });
                        next();
                    }, error); return;
                }
                var url;
                try { url = onlineURL(connection.base + (kind === 'direct' ? '/direct/events' : '/lite/events'), Object.assign(onlineParams(movie), {life: 'false', external_ids: 'true'}), connection); }
                catch (exception) { error(exception.message); return; }
                readOnline(url, function (data) {
                    if (!alive || ticket !== generation) return;
                    if (!Array.isArray(data)) { error('не получен список источников'); return; }
                    data.forEach(function (s, index) {
                        if (!s || typeof s.url !== 'string' || typeof s.name !== 'string') return;
                        try { available.push({id: kind + '-' + (s.balanser || index), name: s.name + (mode === 'all' ? ' • ' + label : ''),
                            connection: connection, url: onlineURL(s.url, onlineParams(movie), connection)}); }
                        catch (exception) { /* Skip invalid provider URLs. */ }
                    });
                    next();
                }, error, false, connection);
            }
            next();
        }
        function back() {
            if (onlineStack.length) loadOnline(onlineStack.pop(), false);
            else Lampa.Activity.backward();
        }
        this.create = function () {
            files.appendHead(filter.render()); files.appendFiles(scroll.render());
            scroll.minus(files.render().find('.explorer__files-head'));
            filter.render().find('.filter--search').remove();
            filter.onBack = refocus;
            filter.onSelect = function (type, choice) {
                Lampa.Select.close();
                if (type === 'sort') { sourceID = choice.source; Lampa.Storage.set(sourceStorageKey, sourceID); load(); }
                else if (choice.online_url) loadOnline(choice.online_url, true);
                else { season = choice.season; draw(); }
            };
            if (filter.addButtonBack) filter.addButtonBack();
            var refresh = $('<div class="simple-button selector">Обновить</div>').on('hover:enter', discover);
            filter.render().find('.torrent-filter').append(refresh);
            return this.render();
        };
        this.start = function () {
            if (!isActive()) return;
            Lampa.Controller.add('content', {
                toggle: function () { Lampa.Controller.collectionSet(scroll.render(), files.render()); Lampa.Controller.collectionFocus(last || false, files.render()); },
                up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function () { Navigator.move('down'); },
                right: function () { if (Navigator.canmove('right')) Navigator.move('right'); else filter.show('Источник', 'sort'); },
                left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else files.toggle(); },
                back: back
            });
            Lampa.Controller.toggle('content');
            if (!ready) { ready = true; discover(); }
        };
        this.render = function () { return files.render(); };
        this.pause = this.stop = function () {};
        this.destroy = function () { alive = false; generation++; network.clear(); filter.destroy(); scroll.destroy(); files.destroy(); };
    }

    function onFull(event) {
        if (event.type !== 'complite' || !event.data || !event.data.movie) return;
        var body = event.body || event.object.activity.render();
        var container = body.find('.buttons--container');
        if (!container.length || container.find('.view--mycinema').length) return;
        var button = $('<div class="full-start__button selector view--mycinema">' + ICON + '<span>' + NAME + '</span></div>');
        button.data('subtitle', 'Озвучки и качество');
        button.on('hover:enter', function () { open(event.data.movie); });
        container.append(button);
    }
    function init() {
        if (initialized) return;
        initialized = true;
        Lampa.Component.add(ID, Screen);
        Lampa.SettingsApi.addComponent({component: ID, name: NAME, icon: ICON});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_server', type: 'input', default: ''},
            field: {name: 'Адрес личного API', description: 'Необязательный сервер пользователя для адаптеров и каталога. Например https://cinema.example.org.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_mode', type: 'select', values: {all: 'Все подключения', device: 'Напрямую с устройства', rutube: 'Rutube на устройстве', direct: 'Адаптеры личного API', public: 'Готовый сервер WTCH', lampac: 'Свой Lampac', catalog: 'Свой каталог'}, default: 'all'},
            field: {name: 'Режим', description: 'После смены режима откройте источник заново.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_rutube', type: 'select', values: {yes: 'Да', no: 'Нет'}, default: 'yes'},
            field: {name: 'Rutube: прямой поиск', description: 'Для фильмов. Поиск и получение потока выполняются на устройстве, без общего сервера и токена.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_filmix_host', type: 'input', default: ''},
            field: {name: 'Filmix: HTTPS API', description: 'Экспериментальный прямой доступ с устройства, без общего сервера. Укажите доступный API host Filmix.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_filmix_token', type: 'input', default: ''},
            field: {name: 'Filmix: личный токен', description: 'Только токен пользователя этого устройства. Хранится локально, отправляется указанному API Filmix.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_public', type: 'select', values: {no: 'Нет', yes: 'Да'}, default: 'no'},
            field: {name: 'Добавлять WTCH ко всем подключениям', description: 'Необязательный сторонний сервер. Использует HTTP; браузер может блокировать запросы.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_direct_access', type: 'input', default: ''},
            field: {name: 'Токен своего API', description: 'access_token из providers.local.json. Токены провайдеров остаются на сервере.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_lampac', type: 'input', default: ''},
            field: {name: 'Адрес Lampac', description: 'Ваш сервер, например https://lampac.example.org — без /online.js. Провайдеры загружаются из его API.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_access', type: 'input', default: ''},
            field: {name: 'Токен доступа Lampac', description: 'Если сервер требует авторизацию. Это токен вашего Lampac, а не Filmix или Kodik.'}});
        Lampa.Manifest.plugins = {type: 'video', name: NAME, version: '0.6.1', component: ID,
            description: 'Каталог видео, выбор озвучки и качества',
            onContextMenu: function () { return {name: NAME, title: NAME}; }, onContextLauch: open};
        Lampa.Listener.follow('full', onFull);
        $('<style>' +
            '.mycinema-row{display:flex;align-items:center;margin-bottom:.8em;padding:.9em;border-radius:.4em;background:rgba(255,255,255,.08);border:.16em solid transparent;min-height:7.5em}' +
            '.mycinema-row.focus{border-color:#fff;background:rgba(255,255,255,.16)}' +
            '.mycinema-thumb{width:9em;height:5.1em;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#343847;border-radius:.3em;overflow:hidden;font-size:1.1em}' +
            '.mycinema-thumb img{width:100%;height:100%;object-fit:cover}.mycinema-body{flex:1;min-width:0;padding:0 1em}' +
            '.mycinema-title{font-size:1.5em;margin-bottom:.5em}.mycinema-info{opacity:.7;font-size:.9em}.mycinema-duration{align-self:flex-start;opacity:.7}' +
            '.mycinema-message{padding:1.2em;line-height:1.5;opacity:.8}.mycinema-progress{margin-top:.5em}' +
            '</style>').appendTo('head');
    }
    if (window.appready) init();
    else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') init(); });
}());
