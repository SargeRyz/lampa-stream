(function () {
    'use strict';
    if (window.mycinema_loaded) return;
    window.mycinema_loaded = true;

    var ID = 'mycinema', NAME = 'Мой кинотеатр', initialized = false, playbackSequence = 0;
    var ICON = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 5 7 5-7 5z"/></svg>';
    var DEMO = 'https://media.w3.org/2010/05/bunny/movie.mp4';

    function httpURL(value) { return typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value); }
    function qualityHeight(label) {
        var dimensions = label.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
        if (dimensions) return Math.min(Number(dimensions[1]), Number(dimensions[2]));
        if (/\b8k\b/i.test(label)) return 4320;
        if (/\b4k\b|\buhd\b/i.test(label)) return 2160;
        if (/\b2k\b|\bqhd\b/i.test(label)) return 1440;
        var pixels = label.match(/\d{3,4}/);
        if (pixels) return Number(pixels[0]);
        if (/\bfhd\b|full\s*hd/i.test(label)) return 1080;
        return /\bhd\b/i.test(label) ? 720 : 0;
    }
    function escapeText(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function serverURL() { return String(Lampa.Storage.field('mycinema_server') || '').replace(/\/+$/, ''); }
    var PUBLIC_SERVER = 'http://wtch.ch';
    var CINEMA_SERVER = 'http://88.218.62.180:9118';
    // Reserved internal origin. These navigation URLs never reach the network.
    var DEVICE_ORIGIN = 'https://mycinema.invalid';
    function backend(kind) {
        if (kind === 'cinema') return {kind: kind, base: String(Lampa.Storage.field('mycinema_cinema_url') || CINEMA_SERVER).trim().replace(/\/+$/, ''), token: ''};
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
            var title = params.clarification === '1' ? params.title : params.original_title || params.title;
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
        var releaseYear = /^\d{4}$/.test(params.year || '') ? Number(params.year) : 0;
        if (releaseYear < 1888 || releaseYear > new Date().getFullYear() + 2) { failed('Для точного поиска Rutube в карточке нужен год выпуска.'); return; }
        var names = [normal(params.title), normal(params.original_title)].filter(function (name, i, all) { return name && all.indexOf(name) === i; });
        function exactTitle(value) {
            return String(value || '').split(/\s(?:\/|\||—|–|-)\s|[([]/).some(function (part) {
                part = part.replace(/\s+(?:19|20)\d{2}(?:\D.*)?$/, '');
                return names.indexOf(normal(part)) >= 0 || names.indexOf(normal(part.replace(/^(?:художественный\s+фильм|фильм|кино|смотреть)(?:\s*[:—-]\s*|\s+)/i, ''))) >= 0;
            });
        }
        function videoYear(value) {
            var metadata = ' ' + normal(value) + ' ';
            names.forEach(function (name) { metadata = metadata.replace(' ' + name + ' ', ' '); });
            var years = metadata.match(/\b(?:19|20)\d{2}\b/g) || [];
            years.sort(function (a, b) { return Math.abs(Number(a) - releaseYear) - Math.abs(Number(b) - releaseYear); });
            return years.length && Math.abs(Number(years[0]) - releaseYear) <= 1 ? Number(years[0]) : 0;
        }
        var searchQuery = {query: params.query || title + ' ' + releaseYear, content_type: 'video', duration: 'movie'};
        if (page > 1) searchQuery.page = page;
        api('/api/search/video/', searchQuery, function (data) {
            if (!Array.isArray(data.results)) { failed('Rutube: нет results[]. Поля ответа: ' + Object.keys(data).slice(0, 8).join(', ')); return; }
            var seen = Object.create(null);
            var rows = data.results.filter(function (video) {
                if (!video || !/^[a-f0-9]{32}$/i.test(String(video.id)) || seen[video.id] || restricted(video) || !isFinite(Number(video.duration)) || Number(video.duration) < 1200) return false;
                seen[video.id] = true;
                if (Number(video.category && typeof video.category === 'object' ? video.category.id : video.category) !== 4 || !exactTitle(video.title) || !videoYear(video.title)) return false;
                var name = normal(video.title);
                return !/(^|\s)(трейлер|trailer|обзор|реакция)(\s|$)/.test(name);
            }).sort(function (a, b) { return Math.abs(videoYear(a.title) - releaseYear) - Math.abs(videoYear(b.title) - releaseYear); }).slice(0, 100).map(function (video) {
                return {id: video.id, translate: video.title, method: 'call', url: link({video: video.id}),
                    year: videoYear(video.title), duration: duration(video.duration), img: video.thumbnail_url,
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
                url: link({title: title, original_title: params.original_title || '', year: releaseYear, serial: params.serial || 0, page: nextPage, query: params.query || ''})});
            done({type: 'movie', data: rows});
        });
    }
    function directURL(value, base) {
        if (typeof value !== 'string' || !value) return '';
        try { var url = new URL(value.split(' or ')[0], base); return httpURL(url.href) ? url.href : ''; } catch (error) { return ''; }
    }
    function reserveURL(value, base) {
        return typeof value === 'string' ? directURL(value.split(' or ')[1], base) : '';
    }
    function audioTracks(raw) {
        var translate = raw.translate && typeof raw.translate === 'object' ? raw.translate : {};
        var tracks = raw.audioTracks || raw.audio_tracks || raw.audios || translate.tracks || (Array.isArray(translate) ? translate : []);
        return (Array.isArray(tracks) ? tracks : []).map(function (track, index) {
            if (typeof track === 'string') return {name: track};
            track = track || {};
            var extra = track.extra || {}, channels = Number(track.channels || extra.channels);
            return {name: String(track.name || track.title || 'Дорожка ' + (index + 1)), language: String(track.language || track.lang || ''),
                label: String(track.label || track.author && track.author.title || (track.language || track.lang) && (track.name || track.title) || ''),
                extra: {channels: channels > 0 && isFinite(channels) ? channels : undefined, fourCC: String(track.codec || extra.fourCC || '')}};
        });
    }
    function onlineItem(raw, type, base) {
        var method = raw.method || (type === 'season' || type === 'similar' ? 'link' : 'play');
        var quality = {}, qualityReserve = {};
        Object.keys(raw.quality || {}).forEach(function (key) {
            var value = directURL(raw.quality[key], base); if (value) quality[key] = value;
            var reserve = reserveURL(raw.quality[key], base); if (reserve) qualityReserve[key] = reserve;
        });
        return {id: String(raw.id || raw.url || raw.title || raw.name || ''), method: method, kind: type,
            title: type === 'episode' ? raw.name || raw.title || raw.translate || 'Серия ' + raw.e : raw.translate || raw.name || raw.title || 'Видео',
            voice: raw.voice_name || (typeof raw.translate === 'string' ? raw.translate : ''),
            info: [raw.year, raw.details, raw.maxquality].filter(Boolean).join(' • '),
            url: directURL(raw.url, base), url_reserve: directURL(raw.url_reserve, base) || reserveURL(raw.url, base), quality: quality, qualityReserve: qualityReserve,
            subtitles: (Array.isArray(raw.subtitles) ? raw.subtitles : []).map(function (sub) {
                return {label: sub.label || sub.name || '', url: directURL(sub.url, base)};
            }), headers: raw.headers, season: raw.s, episode: raw.e, poster: directURL(raw.img || raw.thumbnail, base),
            date: raw.air_date || '', rating: raw.vote_average, qualityLabel: raw.maxquality || '',
            audioTracks: audioTracks(raw), ffprobe: raw.ffprobe,
            segments: raw.segments, duration: raw.duration, browse: method === 'link', hls_manifest_timeout: raw.hls_manifest_timeout};
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
        if (!movie.title && movie.name) movie.title = movie.name;
        if (!movie.original_title && movie.original_name) movie.original_title = movie.original_name;
        var files = new Lampa.Explorer(object);
        var scroll = new Lampa.Scroll({mask: true, over: true});
        var searchParams = Object.assign({}, object, {search: object.search || movie.title || movie.name || '',
            search_one: movie.title || movie.name || '', search_two: movie.original_title || movie.original_name || ''});
        var filter = new Lampa.Filter(searchParams);
        var network = new Lampa.Reguest();
        var metadataNetwork = new Lampa.Reguest();
        var playbackNetwork = new Lampa.Reguest(), playbackID = 0;
        var audioNetwork = new Lampa.Reguest(), audioRequest = 0, audioSeeking = false, episodeResolving = false, cancelAudioSeek = function () {};
        var sources = [], sourceID = '', items = [], season = '', last = null;
        var ready = false, alive = true, generation = 0;
        var mode = Lampa.Storage.field('mycinema_mode') || 'all';
        var sourceStorageKey = 'mycinema_source_' + mode;
        var currentBackend = null, catalogSourceID = '', discoveryErrors = [];
        var externalIDsTried = {};
        var currentOnlineURL = '', onlineStack = [], voices = [], resolving = false;
        var seasonChoices = [], selectedSeason = '', queryOverride = object.clarification ? object.search || '' : '';
        var metadata = {}, metadataPending = {}, globalSearch = false, historyRow = null, autoSeasonOpened = false;
        var voiceRestoreAttempts = 0;

        function choiceKey() { return sourceID + '|' + movieKey(movie); }
        function choices() { return Lampa.Storage.cache('mycinema_choices', 300, {}); }
        function savedChoice() { return choices()[choiceKey()] || {}; }
        function saveChoice(update) {
            if (sourceID === 'demo') return;
            var saved = choices(), key = choiceKey();
            saved[key] = Object.assign({}, saved[key] || {}, update);
            Lampa.Storage.set('mycinema_choices', saved);
        }
        function forgetChoice() {
            var saved = choices(); delete saved[choiceKey()];
            Lampa.Storage.set('mycinema_choices', saved);
        }
        function episodeTitle(item) {
            var episode = episodeMetadata(item);
            return episode.name && (!item.title || /^(?:(?:серия|episode)\s*\d+|\d+\s*(?:серия|episode))$/i.test(item.title)) ? episode.name : item.title || item.voice || 'Видео';
        }

        function searchURL(url, connection) {
            if (!queryOverride) return url;
            var parsed = new URL(url);
            if (connection.kind === 'rutube') parsed.searchParams.set('query', queryOverride);
            else { parsed.searchParams.set('title', queryOverride); parsed.searchParams.set('clarification', '1'); }
            if (globalSearch) parsed.searchParams.set('similar', 'true');
            return parsed.href;
        }
        function activeVoice() {
            var active = voices.filter(function (voice) { return voice.active; })[0];
            return active ? active.name || '' : '';
        }
        function seasonNumber(item) {
            var match = String(item.title || '').match(/\d+/);
            return item.season != null ? String(item.season) : match ? String(Number(match[0])) : '';
        }
        function durationText(value) {
            if (typeof value !== 'number') return value || '';
            if (!isFinite(value) || value <= 0) return '';
            return Math.floor(value / 60) + ':' + ('0' + Math.floor(value % 60)).slice(-2);
        }
        function dateText(value) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || '';
            try { return Lampa.Utils.parseTime(value).full; } catch (error) { return value; }
        }
        function enrichEpisodes() {
            var numbers = [];
            items.forEach(function (item) {
                if (!item.browse && item.episode != null && item.season != null && numbers.indexOf(String(item.season)) < 0) numbers.push(String(item.season));
            });
            if (mediaType(movie) !== 'tv' || ['tmdb', 'cub'].indexOf(namespace(movie)) < 0 || !/^\d+$/.test(String(movie.id))) return;
            numbers.forEach(function (number) {
                if (!/^\d+$/.test(number) || metadata[number] || metadataPending[number] || !Lampa.TMDB || typeof Lampa.TMDB.api !== 'function' || typeof Lampa.TMDB.key !== 'function') return;
                metadataPending[number] = true;
                var language = String(Lampa.Storage.field('language') || 'ru');
                var url = Lampa.TMDB.api('tv/' + movie.id + '/season/' + number + '?api_key=' + encodeURIComponent(Lampa.TMDB.key()) + '&language=' + encodeURIComponent(language));
                metadataNetwork.timeout(10000);
                metadataNetwork.native(url, function (data) {
                    if (!alive || !data || !Array.isArray(data.episodes)) return;
                    metadata[number] = data.episodes;
                    updateMetadata();
                }, function () { /* Optional artwork must not block playback. */ }, false, {dataType: 'json'});
            });
        }
        function episodeMetadata(item) {
            return (metadata[String(item.season)] || []).filter(function (episode) { return Number(episode.episode_number) === Number(item.episode); })[0] || {};
        }
        function updateMetadata() {
            scroll.render().find('.mycinema-row').each(function () {
                var row = $(this), item = row.data('mycinema-item');
                if (item) decorateRow(row, item);
            });
        }

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
        function readOnline(url, done, failed, jsonMode, connection, transport) {
            var discovery = !!connection && !transport;
            connection = connection || currentBackend;
            transport = transport || network;
            try {
                url = onlineURL(url, null, connection);
                if (jsonMode) { var parsed = new URL(url); parsed.searchParams.set('rjson', 'true'); url = parsed.href; }
            } catch (error) { failed(error.message); return; }
            if (connection.kind === 'device' || connection.kind === 'rutube') {
                var internal = new URL(url), params = {};
                var route = connection.kind === 'rutube' ? '/rutube' : '/filmix';
                if (internal.origin !== DEVICE_ORIGIN || internal.pathname !== route) { failed('Некорректный переход клиентского адаптера.'); return; }
                internal.searchParams.forEach(function (value, key) { params[key] = value; });
                if (connection.kind === 'rutube') { deviceRutube(params, transport, function (data) { done(data, url); }, failed); return; }
                deviceFilmix(params, connection, transport, function (data) { done(data, url); }, failed); return;
            }
            var publicConnection = connection.kind === 'cinema' || connection.kind === 'public';
            var requestTimeout = discovery && !publicConnection ? 8000 : 30000;
            var started = Date.now();
            transport.timeout(requestTimeout);
            transport.native(url, function (data) {
                if (typeof data === 'string') { try { data = JSON.parse(data); } catch (error) { failed('Lampac вернул страницу вместо JSON. Проверьте адрес и доступ к API.'); return; } }
                if (!data || typeof data !== 'object') { failed('Пустой ответ источника.'); return; }
                if (data.rch) { failed('Этот источник требует Remote Control Hub. Настройте серверный доступ в Lampac или выберите другой источник.'); return; }
                if (data.accsdb) { failed('Lampac требует авторизацию. Укажите свой токен доступа в настройках расширения.'); return; }
                if (data.error) { failed('Источник вернул ошибку. Проверьте настройки и токены выбранного сервера.'); return; }
                done(data, url);
            }, function (error, exception) {
                var host = new URL(url).host;
                var status = Number(error && error.status) || 0;
                var reason = String(exception || error && error.statusText || '');
                var elapsed = Math.round((Date.now() - started) / 100) / 10;
                if (reason === 'timeout') { failed(host + ': Тайм-аут ' + requestTimeout / 1000 + ' с. Сервер не успел ответить. Нажмите «Повторить».'); return; }
                if (reason === 'parsererror') { failed(host + ': Ответ не является JSON' + (status ? ' (HTTP ' + status + ')' : '') + '. Проверьте адрес API.'); return; }
                if (reason === 'abort') { failed(host + ': Запрос отменён.'); return; }
                if (status) { failed(host + ': HTTP ' + status + (status === 401 || status === 403 ? '. Сервер отклонил доступ.' : '. Ошибка ответа сервера.')); return; }
                var nativeAndroid = Lampa.Platform && Lampa.Platform.is && Lampa.Platform.is('android');
                var mixed = location.protocol === 'https:' && new URL(url).protocol === 'http:' && !nativeAndroid;
                failed(host + ': Нет HTTP-ответа за ' + elapsed + ' с (статус 0). ' + (mixed ?
                    'Lampa открыта по HTTPS, а API использует HTTP: возможна блокировка браузером. Нужен доступный HTTPS-адрес API.' :
                    'Проверьте доступ к серверу из сети устройства; возможны ограничения сети, TLS или CORS.'));
            }, false, {dataType: 'json', timeout: requestTimeout});
        }
        function loadOnline(url, push) {
            var ticket = ++generation;
            if (push) voices = [];
            resolving = false; network.clear(); items = []; season = '';
            if (push && currentOnlineURL) onlineStack.push(currentOnlineURL);
            currentOnlineURL = url;
            message('Загружаем видео из источника…');
            readOnline(url, function (data, resolvedURL) {
                if (!alive || ticket !== generation) return;
                if (!data.type && Object.keys(data).length === 0) { draw(); return; }
                if (['movie', 'episode', 'season', 'similar'].indexOf(data.type) < 0 || !Array.isArray(data.data)) {
                    message('Формат ответа не поддерживается. Нужен Lampac с JSON API rjson=true.', function () { loadOnline(url, false); }); return;
                }
                if (Array.isArray(data.voice)) voices = data.voice.filter(function (voice) { return voice && voice.url; });
                else if (data.type !== 'episode' && data.type !== 'movie') voices = [];
                items = data.data.filter(function (raw) { return raw && typeof raw === 'object'; }).map(function (raw) { return onlineItem(raw, data.type, resolvedURL); });
                if (data.type === 'season') {
                    seasonChoices = items.map(function (item) { return {title: item.title, season: seasonNumber(item), online_url: item.url}; });
                    if (mediaType(movie) === 'tv' && seasonChoices.length && !autoSeasonOpened) {
                        autoSeasonOpened = true;
                        var first = seasonChoices.filter(function (choice) { return choice.season === selectedSeason; })[0] || seasonChoices[0];
                        selectedSeason = first.season;
                        loadOnline(first.online_url, true); return;
                    }
                }
                if (data.type === 'episode' && items.length && items[0].season != null) selectedSeason = String(items[0].season);
                var wanted = savedChoice().voice;
                var voice = voices.filter(function (entry) { return entry.name === wanted; })[0];
                if (voice && !voice.active && voiceRestoreAttempts < 1 && (data.type === 'episode' || data.type === 'movie')) {
                    voiceRestoreAttempts++;
                    loadOnline(voice.url, false); return;
                }
                if (selectedSeason) saveChoice({season: selectedSeason});
                draw();
                enrichEpisodes();
            }, function (error) { if (alive && ticket === generation) message(error, function () { loadOnline(url, false); }); }, true);
        }
        function enter(item) {
            if (item.browse) {
                if (item.kind === 'similar') { seasonChoices = []; selectedSeason = String(savedChoice().season || ''); autoSeasonOpened = false; voiceRestoreAttempts = 0; }
                loadOnline(item.url, true); return;
            }
            if (item.method !== 'call') { play(item); return; }
            if (resolving) return;
            resolving = true;
            var ticket = generation;
            // Resolve silently; failures remain visible.
            readOnline(item.url, function (data, url) {
                if (!alive || ticket !== generation) return;
                resolving = false;
                var resolved = resolvedItem(data, url, item);
                if (!resolved.url && !Object.keys(resolved.quality).length) { Lampa.Noty.show('Источник не вернул ссылку на поток.'); return; }
                play(resolved);
            }, function (error) { if (alive && ticket === generation) { resolving = false; Lampa.Noty.show(error); } }, false);
        }
        function availableQualities(item) {
            var quality = item.quality || {};
            return Object.keys(quality).filter(function (key) { return httpURL(directURL(quality[key])); }).map(function (key, index) {
                return {key: key, height: qualityHeight(key), index: index};
            }).sort(function (a, b) { return b.height - a.height || a.index - b.index; }).map(function (entry) { return entry.key; });
        }
        function preferredQuality(item, preference) {
            var keys = availableQualities(item), target = preference && preference.key || '720p';
            if (keys.indexOf(target) >= 0) return target;
            var height = qualityHeight(target) || 720;
            return keys.filter(function (key) { return qualityHeight(key) <= height; })[0] || keys[keys.length - 1];
        }
        function resolvedItem(data, url, item) {
            var resolved = onlineItem(data, item.kind || 'movie', url);
            ['id', 'title', 'season', 'episode', 'demo'].forEach(function (key) { resolved[key] = item[key]; });
            resolved.voice = item.voice || activeVoice();
            resolved.headers = resolved.headers || item.headers;
            resolved.segments = resolved.segments || item.segments;
            resolved.hls_manifest_timeout = resolved.hls_manifest_timeout || item.hls_manifest_timeout;
            if (!resolved.subtitles.length) resolved.subtitles = item.subtitles || [];
            if (!resolved.audioTracks.length) resolved.audioTracks = audioTracks(item);
            resolved.ffprobe = resolved.ffprobe || item.ffprobe;
            return resolved;
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
        function playbackData(item, preference) {
            var quality = item.quality || {}, key = preferredQuality(item, preference);
            var raw = key ? quality[key] : item.url, url = directURL(raw);
            var reserve = key ? (item.qualityReserve || {})[key] || reserveURL(raw) : item.url_reserve || reserveURL(raw);
            if (!reserve && url === item.url) reserve = item.url_reserve;
            var data = {url: url, title: item.demo ? item.title : (movie.title || movie.name) + ' • ' + episodeTitle(item),
                subtitles: (Array.isArray(item.subtitles) ? item.subtitles : []).filter(function (sub) { return sub && httpURL(sub.url); })};
            if (httpURL(reserve)) data.url_reserve = reserve;
            data.mycinema_quality = key || '';
            if (item.headers) data.headers = item.headers;
            if (item.segments) data.segments = item.segments;
            if (item.hls_manifest_timeout) data.hls_manifest_timeout = item.hls_manifest_timeout;
            var tracks = audioTracks(item);
            if (tracks.length) data.translate = {tracks: tracks.map(function (track) {
                return {name: escapeText(track.name), language: escapeText(track.language || ''), label: escapeText(track.label || ''),
                    extra: {channels: track.extra && track.extra.channels, fourCC: escapeText(track.extra && track.extra.fourCC || '')}};
            })};
            if (item.ffprobe && typeof item.ffprobe === 'object') data.ffprobe = item.ffprobe;
            if (!item.demo) {
                data.card = movie;
                data.movie = movie;
                data.season = item.season; data.episode = item.episode;
                data.voice_name = item.voice || activeVoice();
                var timeline = timelineFor(item);
                if (timeline) data.timeline = timeline;
            }
            return data;
        }
        function resolveNext(item, context, done, failed) {
            function resolved(data, url) {
                var result = resolvedItem(data, url, item);
                if (!result.url && !Object.keys(result.quality).length) { failed('Источник не вернул ссылку на серию.'); return; }
                done(result);
            }
            function call(row) {
                readOnline(row.url, resolved, failed, false, context.connection, playbackNetwork);
            }
            if (item.method === 'call') { call(item); return; }
            // Direct episode links can expire during a long season: refresh the list on demand.
            readOnline(context.listURL, function (data, url) {
                if (!data || data.type !== 'episode' || !Array.isArray(data.data)) { failed('Не удалось обновить список серий.'); return; }
                var row = data.data.filter(function (raw) { return raw && String(raw.e) === String(item.episode) && (raw.s == null || String(raw.s) === String(item.season)); })[0];
                if (!row) { failed('Серия больше не доступна в выбранном переводе.'); return; }
                var fresh = onlineItem(row, 'episode', url);
                if (fresh.method === 'call') call(fresh);
                else resolved(row, url);
            }, failed, true, context.connection, playbackNetwork);
        }
        var qualityPicker = null, qualityPickerPrevious = null, qualityPickerMenu = null, qualityPickerSession = 0;
        function releaseQualityPicker() {
            if (qualityPicker && Lampa.Select.show === qualityPicker) Lampa.Select.show = qualityPickerPrevious;
            qualityPicker = null; qualityPickerPrevious = null; qualityPickerMenu = null; qualityPickerSession = 0;
        }
        function installQualityPicker(menu, session) {
            qualityPickerMenu = Object.assign({}, menu); qualityPickerSession = session;
            if (qualityPicker) return;
            qualityPickerPrevious = Lampa.Select.show;
            qualityPicker = function (params) {
                var work = Lampa.Player.playdata();
                if (alive && work && work.mycinema_session === playbackID && playbackID === qualityPickerSession &&
                    params && params.title === Lampa.Lang.translate('player_quality') && qualityPickerMenu) {
                    params = Object.assign({}, params, {items: Object.keys(qualityPickerMenu).map(function (key) {
                        var entry = qualityPickerMenu[key];
                        return {quality: key, title: key, url: entry.url, selected: key === escapeText(work.mycinema_quality),
                            call: entry.call, instance: entry};
                    })});
                }
                return qualityPickerPrevious.apply(this, [params]);
            };
            Lampa.Select.show = qualityPicker;
        }
        function playerClosed() { releaseQualityPicker(); audioRequest++; audioNetwork.clear(); cancelAudioSeek(); }
        function configureAudio(data, embedded) {
            if (!alive || !data || data.mycinema_session !== playbackID || !data.mycinema_voiceovers) return;
            embedded = embedded || data.mycinema_native_tracks;
            var nativeTracks = embedded && embedded.length > 1;
            if (Lampa.PlayerPanel.setTranslate) Lampa.PlayerPanel.setTranslate(nativeTracks ? data.translate || {} : {});
            if (Lampa.PlayerPanel.setTracks) Lampa.PlayerPanel.setTracks(nativeTracks ? embedded : data.mycinema_voiceovers);
        }
        function playerStart(data) {
            // Keep explicit URLs for every rendition; enforce our per-session default at launch.
            if (data && data.mycinema_session === playbackID) {
                delete data.voiceovers;
                var chosen = data.mycinema_quality_menu && data.mycinema_quality_menu[escapeText(data.mycinema_quality)];
                if (chosen && httpURL(chosen.url)) data.url = chosen.url;
            }
            configureAudio(data);
        }
        function playerReady(data) {
            if (data && data.mycinema_session === playbackID && data.mycinema_quality_menu) installQualityPicker(data.mycinema_quality_menu, playbackID);
            configureAudio(data);
            if (data && data.mycinema_session === playbackID && data.mycinema_quality_menu && Lampa.PlayerPanel.quality) Lampa.PlayerPanel.quality(data.mycinema_quality_menu, data.url);
        }
        function playerLoaded() { playerReady(Lampa.Player.playdata()); }
        function playerLevels() {
            // HLS discovery can arrive after loadeddata and replace the menu with one rendition.
            var data = Lampa.Player.playdata();
            if (data && data.mycinema_session === playbackID && data.mycinema_quality_menu && Object.keys(data.mycinema_quality_menu).length > 1 && Lampa.PlayerPanel.quality) {
                Lampa.PlayerPanel.quality(data.mycinema_quality_menu, data.url);
            }
        }
        function nativeAudio(event) {
            var data = Lampa.Player.playdata();
            if (data && data.mycinema_session === playbackID) data.mycinema_native_tracks = event && event.tracks;
            configureAudio(data, event && event.tracks);
        }
        Lampa.Player.listener.follow('destroy', playerClosed);
        Lampa.Player.listener.follow('start', playerStart);
        Lampa.Player.listener.follow('ready', playerReady);
        Lampa.PlayerVideo.listener.follow('tracks', nativeAudio);
        Lampa.PlayerVideo.listener.follow('loadeddata', playerLoaded);
        Lampa.PlayerVideo.listener.follow('levels', playerLevels);
        function attachQuality(data, item, context, session, inner) {
            if (!inner) return;
            var keys = availableQualities(item), menu = Object.create(null);
            if (keys.length === 1 && !qualityHeight(keys[0])) return;
            keys.forEach(function (key) {
                var url = directURL(item.quality[key]), name = escapeText(key);
                menu[name] = {url: url, call: function (instance, ready) {
                    var work = Lampa.Player.playdata();
                    if (!alive || session !== playbackID || !work || work.mycinema_session !== session || String(work.episode) !== String(item.episode)) return;
                    if (audioSeeking || episodeResolving) { Lampa.Noty.show('Дождитесь загрузки текущего переключения.'); return; }
                    context.quality.key = key;
                    var reserve = (item.qualityReserve || {})[key] || reserveURL(item.quality[key]);
                    work.url = url; work.mycinema_quality = key;
                    delete work.url_reserve; delete work.mycinema_native_tracks;
                    if (httpURL(reserve)) work.url_reserve = reserve;
                    (context.playlist || []).forEach(function (entry) {
                        if (String(entry.episode) !== String(work.episode) || String(entry.season) !== String(work.season)) return;
                        entry.url = url; entry.mycinema_quality = key; delete entry.url_reserve;
                        if (httpURL(reserve)) entry.url_reserve = reserve;
                    });
                    ready(url);
                }};
            });
            if (keys.length) { data.quality = menu; data.mycinema_quality_menu = menu; installQualityPicker(menu, session); }
        }
        function attachVoices(data, item, context, session, inner) {
            // Keep native track detection enabled; real multi-track streams take priority.
            if (!inner || item.demo) return;
            function singleTrack() {
                data.mycinema_voiceovers = [{name: escapeText(data.voice_name || 'Текущая аудиодорожка'), enabled: true, selected: true,
                    onSelect: function () { Lampa.Noty.show('Другие аудиодорожки в этом потоке недоступны.'); }}];
                data.voiceovers = data.mycinema_voiceovers;
            }
            if (!context.connection) { singleTrack(); return; }
            var options = context.voices.filter(function (voice) { return voice && voice.url && voice.name; }).map(function (voice) {
                return {name: voice.name, url: voice.url};
            });
            if (options.length < 2 && item.episode == null) options = context.rows.filter(function (row) {
                return !row.browse && row.voice;
            }).map(function (row) { return {name: row.voice, row: row}; });
            var names = [];
            options = options.filter(function (option) { if (names.indexOf(option.name) >= 0) return false; names.push(option.name); return true; });
            if (options.length < 2) { singleTrack(); return; }
            var selected = item.voice || context.voice;
            data.mycinema_voiceovers = options.map(function (option) {
                return {name: escapeText(option.name), enabled: option.name === selected, selected: option.name === selected, onSelect: function () {
                    var work = Lampa.Player.playdata();
                    if (!alive || session !== playbackID || !work || work.mycinema_session !== session || String(work.episode) !== String(item.episode)) return;
                    if (audioSeeking || episodeResolving) {
                        data.mycinema_voiceovers.forEach(function (voice) { voice.enabled = voice.selected = voice.name === escapeText(selected); });
                        Lampa.Noty.show('Дождитесь загрузки текущего переключения.'); return;
                    }
                    if (option.name === selected) return;
                    var ticket = ++audioRequest;
                    audioNetwork.clear();
                    function valid() { return alive && session === playbackID && ticket === audioRequest && Lampa.Player.playdata() === work; }
                    function failed(error) {
                        if (!valid()) return;
                        data.mycinema_voiceovers.forEach(function (voice) { voice.enabled = voice.selected = voice.name === escapeText(selected); });
                        Lampa.Noty.show(error);
                    }
                    function finish(resolved, rows, listURL, newVoices) {
                        if (!valid()) return;
                        if (!httpURL(playbackData(resolved, context.quality).url)) { failed('В выбранной озвучке нет ссылки на видео.'); return; }
                        var video = Lampa.PlayerVideo.video(), time = video ? Number(video.currentTime) || 0 : Number(work.timeline && work.timeline.time) || 0;
                        var paused = video && video.paused;
                        items = rows; voices = newVoices; currentOnlineURL = listURL;
                        draw(true);
                        play(Object.assign({}, resolved, {voice: option.name}), {work: work, time: time, paused: paused,
                            context: {connection: context.connection, listURL: listURL, rows: rows, voices: newVoices, voice: option.name, quality: context.quality}});
                    }
                    function resolve(row, rows, url, newVoices) {
                        row.voice = option.name;
                        if (row.method !== 'call') { finish(row, rows, url, newVoices); return; }
                        readOnline(row.url, function (result, resolvedURL) { finish(resolvedItem(result, resolvedURL, row), rows, url, newVoices); }, failed, false, context.connection, audioNetwork);
                    }
                    var url = option.url || context.listURL;
                    readOnline(url, function (result, listURL) {
                        if (!valid()) return;
                        if (!Array.isArray(result.data) || ['movie', 'episode'].indexOf(result.type) < 0) { failed('Не удалось получить выбранную озвучку.'); return; }
                        var rows = result.data.filter(function (raw) { return raw && typeof raw === 'object'; }).map(function (raw) { return onlineItem(raw, result.type, listURL); });
                        var row = rows.filter(function (entry) {
                            return !entry.browse && (item.episode != null ? String(entry.episode) === String(item.episode) && (entry.season == null || String(entry.season) === String(item.season)) :
                                !option.row || entry.voice === option.name);
                        })[0];
                        if (!row) { failed('Эта серия недоступна в выбранной озвучке.'); return; }
                        var newVoices = (Array.isArray(result.voice) ? result.voice : context.voices).filter(function (voice) { return voice && voice.url && typeof voice.name === 'string'; }).map(function (voice) { return Object.assign({}, voice, {active: voice.name === option.name}); });
                        resolve(row, rows, listURL, newVoices);
                    }, failed, true, context.connection, audioNetwork);
                }};
            });
            data.voiceovers = data.mycinema_voiceovers;
        }
        function play(item, change) {
            var player = Lampa.Storage.field('player'), inner = !player || player === 'inner' || player === 'lampa';
            var context = change ? change.context : {connection: currentBackend, listURL: currentOnlineURL, rows: items.slice(), voices: voices.slice(), voice: activeVoice(), quality: {key: '720p'}};
            var data = playbackData(item, context.quality);
            if (!httpURL(data.url)) { Lampa.Noty.show('Источник не вернул прямую ссылку на видео.'); return; }
            var session = ++playbackSequence;
            playbackID = session;
            episodeResolving = false;
            playbackNetwork.clear();
            playerClosed();
            function remember(row) {
                if (row.demo || !alive || session !== playbackID) return;
                var update = {};
                if (row.season != null) update.season = String(row.season);
                if (row.voice) update.voice = row.voice;
                saveChoice(update);
            }
            data.mycinema_session = session;
            attachQuality(data, item, context, session, inner);
            attachVoices(data, item, context, session, inner);
            var voice = item.voice || activeVoice(), seen = Object.create(null);
            var episodes = item.demo || item.episode == null ? [] : context.rows.filter(function (row) {
                var key = String(row.season) + ':' + String(row.episode);
                if (row.browse || row.episode == null || String(row.season) !== String(item.season) || seen[key]) return false;
                seen[key] = true; return true;
            }).sort(function (a, b) { return Number(a.episode) - Number(b.episode); });
            // External players receive concrete URLs; resolver callbacks belong to Lampa's inner player.
            if (!inner && episodes.some(function (row) { return row.method === 'call'; })) episodes = [];
            var playlist = episodes.map(function (row) {
                var selected = String(row.episode) === String(item.episode);
                var snapshot = Object.assign({}, row, {voice: row.voice || voice});
                var entry = selected ? Object.assign({}, data) : playbackData(snapshot, context.quality);
                entry.callback = function () { remember(snapshot); };
                if (!selected && inner && context.connection && context.listURL) {
                    entry.url = function (ready) {
                        if (!alive || session !== playbackID) return;
                        episodeResolving = true;
                        var finished = false;
                        function finish(resolved, error) {
                            if (finished || !alive || session !== playbackID) return;
                            finished = true;
                            episodeResolving = false;
                            if (error) { entry.url = ''; Lampa.Noty.show(error); }
                            else {
                                delete entry.url_reserve;
                                Object.assign(entry, playbackData(resolved, context.quality));
                                entry.mycinema_session = session;
                                attachQuality(entry, resolved, context, session, inner);
                                attachVoices(entry, resolved, context, session, inner);
                                if (!httpURL(entry.url)) { entry.url = ''; Lampa.Noty.show('Ссылка на серию недоступна.'); }
                            }
                            ready();
                        }
                        resolveNext(snapshot, context, function (resolved) { finish(resolved); }, function (error) { finish(null, error); });
                    };
                }
                return entry;
            });
            if (!playlist.length) playlist = [data];
            if (playlist.length > 1) data.playlist = playlist;
            context.playlist = playlist;
            remember(Object.assign({}, item, {voice: voice}));
            if (change) {
                var work = change.work, timeline = work.timeline;
                ['url_reserve', 'headers', 'segments', 'hls_manifest_timeout', 'translate', 'ffprobe', 'quality', 'mycinema_quality_menu', 'mycinema_native_tracks', 'mycinema_voiceovers', 'playlist'].forEach(function (key) { delete work[key]; });
                Object.assign(work, data);
                delete work.voiceovers;
                if (timeline) { work.timeline = timeline; timeline.time = change.time; timeline.continued = false; }
                configureAudio(work);
                if (work.quality && Lampa.PlayerPanel.quality) Lampa.PlayerPanel.quality(work.quality, work.url);
                var timer;
                function seek() {
                    cancelAudioSeek();
                    if (!alive || session !== playbackID || Lampa.Player.playdata() !== work) return;
                    if (change.time > 0) Lampa.PlayerVideo.to(change.time);
                    if (timeline) timeline.continued = true;
                    if (change.paused) Lampa.PlayerVideo.pause();
                    if (Lampa.Player.subtitles) Lampa.Player.subtitles(work.subtitles || []);
                }
                audioSeeking = true;
                cancelAudioSeek = function () { audioSeeking = false; clearTimeout(timer); Lampa.PlayerVideo.listener.remove('loadeddata', seek); cancelAudioSeek = function () {}; };
                Lampa.PlayerVideo.listener.follow('loadeddata', seek);
                timer = setTimeout(cancelAudioSeek, 30000);
                Lampa.PlayerPanel.listener.send('flow', {url: data.url});
            } else Lampa.Player.play(data);
            Lampa.Player.playlist(playlist);
        }
        function artworkFor(item) {
            var images = [];
            function add(url) { if (httpURL(url) && images.indexOf(url) < 0) images.push(url); }
            function tmdb(path) {
                if (httpURL(path)) { add(path); return; }
                if (typeof path === 'string' && /^\/(?!\/).+/.test(path) && Lampa.TMDB && typeof Lampa.TMDB.image === 'function') add(Lampa.TMDB.image('t/p/w300' + path));
            }
            add(item.poster);
            if (!item.demo && !item.browse) {
                tmdb(episodeMetadata(item).still_path);
                tmdb(movie.backdrop_path);
                tmdb(movie.poster_path);
                add(movie.img);
            }
            return images;
        }
        function decorateArtwork(row, item) {
            var images = artworkFor(item), thumb = row.find('.mycinema-thumb');
            var key = JSON.stringify(images);
            if (thumb.attr('data-artwork') === key) return;
            thumb.attr('data-artwork', key).removeAttr('data-image').removeClass('mycinema-thumb--loaded').find('img').off().remove();
            if (!images.length) return;
            var index = 0, image = $('<img alt="" />');
            function nextImage() {
                if (!alive) return;
                thumb.removeClass('mycinema-thumb--loaded');
                if (index >= images.length) { image.off().remove(); thumb.removeAttr('data-image'); return; }
                var url = images[index++];
                thumb.attr('data-image', url);
                image.attr('src', url);
            }
            image.on('load', function () { if (alive) thumb.addClass('mycinema-thumb--loaded'); }).on('error', nextImage);
            thumb.prepend(image);
            nextImage();
        }
        function decorateRow(row, item) {
            var episode = episodeMetadata(item), voice = item.voice || activeVoice();
            var title = episodeTitle(item);
            var rating = Number(item.rating || episode.vote_average), date = item.date || episode.air_date;
            var labels = [];
            if (rating > 0 && rating <= 10) labels.push('★ ' + rating.toFixed(1));
            if (date) labels.push(dateText(date));
            if (voice && voice !== title) labels.push(voice);
            if (item.info) labels.push(item.info);
            if (item.episode != null && !labels.length) labels.push('Сезон ' + item.season + ' • Серия ' + item.episode);
            row.find('.mycinema-title').text(title);
            row.find('.mycinema-info').text(labels.join(' • '));
            row.find('.mycinema-duration').text(durationText(item.duration || (episode.runtime ? episode.runtime * 60 : 0)));
            var quality = preferredQuality(item) || item.qualityLabel || '';
            if (!quality && currentBackend && currentBackend.kind === 'rutube' && !item.browse) quality = 'Авто';
            row.find('.mycinema-quality').text(quality);
            decorateArtwork(row, item);
            if (!item.demo && !item.browse && Lampa.Timeline && typeof Lampa.Timeline.render === 'function') {
                var timeline = timelineFor(item);
                if (timeline) row.find('.mycinema-progress').empty().append(Lampa.Timeline.render(timeline));
            }
        }
        function updateHistory() {
            if (!historyRow) return;
            var viewed = items.filter(function (item) { return !item.demo && !item.browse; }).map(function (item) {
                return {item: item, timeline: timelineFor(item)};
            }).filter(function (entry) { return entry.timeline && (Number(entry.timeline.time) > 0 || Number(entry.timeline.percent) > 0); });
            viewed.sort(function (a, b) { return (b.timeline.updated || 0) - (a.timeline.updated || 0); });
            var resume = viewed[0];
            historyRow.find('.mycinema-history-text').text(resume ? 'Продолжить: ' + (episodeMetadata(resume.item).name || resume.item.title || 'Видео') : 'Нет истории просмотра');
            historyRow.toggleClass('selector', !!resume).toggleClass('mycinema-history--empty', !resume).off('hover:enter');
            historyRow.find('.mycinema-history-time').text(resume && resume.timeline.time ? durationText(Number(resume.timeline.time)) : '');
            if (resume) historyRow.on('hover:enter', function () { enter(resume.item); });
        }
        function updateSourceMenu() {
            var selected = sources.filter(function (s) { return s.id === sourceID; })[0];
            filter.render().find('.filter--sort span').text('Источник');
            filter.render().find('.filter--search').toggleClass('hide', !currentBackend);
            filter.chosen('sort', selected ? [escapeText(selected.name)] : []);
            filter.set('sort', sources.map(function (s) { return {title: escapeText(s.name), source: s.id, selected: s.id === sourceID}; }));
        }
        function draw(quiet) {
            scroll.clear(); scroll.reset(); last = null;
            updateSourceMenu();
            var seasons = [];
            items.forEach(function (item) { if (item.season != null && seasons.indexOf(String(item.season)) < 0) seasons.push(String(item.season)); });
            seasons.sort(function (a, b) { return Number(a) - Number(b); });
            var options = [{title: 'Сбросить фильтр', reset: true, noselect: true}];
            if (voices.length) options.push({title: 'Перевод', subtitle: escapeText(activeVoice()), noselect: true, kind: 'voice', items: voices.map(function (voice) {
                return {title: escapeText(voice.name || 'Перевод'), online_url: voice.url, selected: !!voice.active};
            })});
            var seasonOptions = seasonChoices.length ? seasonChoices.map(function (choice) {
                return {title: escapeText(choice.title), season: choice.season, online_url: choice.online_url, selected: choice.season === selectedSeason};
            }) : (seasons.length ? [{title: 'Все сезоны', season: '', selected: !season}].concat(seasons.map(function (s) {
                return {title: 'Сезон ' + escapeText(s), season: s, selected: season === s};
            })) : []);
            if (seasonOptions.length) options.push({title: 'Сезон', subtitle: escapeText(selectedSeason || season || 'Все сезоны'), noselect: true, kind: 'season', items: seasonOptions});
            filter.set('filter', options.length > 1 ? options : []);
            filter.chosen('filter', [selectedSeason || season ? 'Сезон: ' + escapeText(selectedSeason || season) : '', escapeText(activeVoice())].filter(Boolean));
            if (currentBackend && currentBackend.kind === 'rutube') scroll.append($('<div class="mycinema-message"></div>').text('Фильмы Rutube: название совпадает, год отличается не более чем на один. Проверьте год и продолжительность перед просмотром. Качество — Авто.'));
            if (discoveryErrors.length) scroll.append($('<div class="mycinema-message"></div>').text('Недоступные подключения: ' + discoveryErrors.join(' • ') + '. Нажмите «Обновить» для повторной проверки.'));
            if (sourceID === 'demo') scroll.append($('<div class="mycinema-message"></div>').text('Демонстрация плеера: Big Buck Bunny. Это тестовое видео, а не фильм из открытой карточки.'));
            if (onlineStack.length) scroll.append($('<div class="simple-button selector">Назад к выбору</div>').on('hover:enter', back));
            historyRow = $('<div class="mycinema-history"><div class="mycinema-history-icon">' + ICON + '</div><div class="mycinema-history-text"></div><div class="mycinema-history-time"></div></div>');
            historyRow.on('hover:focus', function () { last = historyRow[0]; scroll.update(historyRow, true); });
            scroll.append(historyRow);
            updateHistory();
            var visible = items.filter(function (item) { return !season || String(item.season) === season; });
            if (currentBackend && currentBackend.kind === 'rutube' && !visible.some(function (item) { return !item.browse; })) {
                scroll.append($('<div class="mycinema-message"></div>').text('В этой выдаче Rutube фильм с подходящими названием и годом не найден. Можно проверить следующую страницу или другой источник.'));
            } else if (!visible.length) scroll.append($('<div class="mycinema-message"></div>').text('Для этой карточки видео не найдено. Выберите другой источник или добавьте фильм в каталог сервера.'));
            visible.forEach(function (item) {
                var row = $('<div class="mycinema-row selector"><div class="mycinema-thumb"><div class="mycinema-number"></div></div><div class="mycinema-body"><div class="mycinema-title"></div><div class="mycinema-info"></div><div class="mycinema-progress"></div></div><div class="mycinema-meta"><div class="mycinema-duration"></div><div class="mycinema-quality"></div></div></div>');
                row.data('mycinema-item', item);
                row.find('.mycinema-thumb').toggleClass('mycinema-thumb--episode', item.episode != null);
                row.find('.mycinema-number').text(item.browse ? '›' : item.episode != null ? ('0' + item.episode).slice(-Math.max(2, String(item.episode).length)) : '▶');
                decorateRow(row, item);
                row.on('hover:focus', function () { last = row[0]; scroll.update(row, true); });
                row.on('hover:enter', function () { enter(item); });
                scroll.append(row);
            });
            if (!quiet) refocus();
        }
        function load() {
            playbackID = 0; playbackNetwork.clear(); playerClosed();
            onlineStack = []; voices = []; seasonChoices = []; selectedSeason = String(savedChoice().season || ''); autoSeasonOpened = false; voiceRestoreAttempts = 0; resolving = false; currentOnlineURL = '';
            var selected = sources.filter(function (s) { return s.id === sourceID; })[0];
            currentBackend = selected && selected.connection;
            catalogSourceID = selected && selected.catalogID || sourceID;
            updateSourceMenu(); filter.set('filter', []); filter.chosen('filter', []);
            if (selected && selected.url) {
                var provider = new URL(selected.url).pathname;
                var needsIDs = currentBackend && /\/lite\/(?:alloha|hdvb|vibix|pidtor|cdnvideohub|collaps|kinotochka)(?:\/|$)/i.test(provider) &&
                    ['tmdb', 'cub'].indexOf(namespace(movie)) >= 0 && /^\d+$/.test(String(movie.id)) && (!movie.kinopoisk_id || !movie.imdb_id);
                if (needsIDs && !externalIDsTried[currentBackend.base]) {
                    externalIDsTried[currentBackend.base] = true;
                    var lookupTicket = ++generation;
                    network.clear(); message('Уточняем карточку фильма…');
                    function continueLoad() {
                        if (!alive || lookupTicket !== generation) return;
                        selected.url = onlineURL(selected.url, onlineParams(movie), currentBackend);
                        loadOnline(searchURL(selected.url, currentBackend), false);
                    }
                    readOnline(onlineURL(currentBackend.base + '/externalids', onlineParams(movie), currentBackend), function (ids) {
                        if (!alive || lookupTicket !== generation) return;
                        if (!movie.kinopoisk_id && /^\d+$/.test(String(ids.kinopoisk_id || ''))) movie.kinopoisk_id = String(ids.kinopoisk_id);
                        if (!movie.imdb_id && /^tt\d+$/.test(String(ids.imdb_id || ''))) movie.imdb_id = String(ids.imdb_id);
                        continueLoad();
                    }, continueLoad, false, currentBackend, network);
                    return;
                }
                selected.url = onlineURL(selected.url, onlineParams(movie), currentBackend);
                loadOnline(searchURL(selected.url, currentBackend), false); return;
            }
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
                var preferredFilmix = mode === 'all' && sources.filter(function (s) { return s.id === 'public-fxapi'; })[0];
                var reserveFilmix = mode === 'all' && sources.filter(function (s) { return s.id === 'cinema-filmix' && s.connection && s.connection.base === CINEMA_SERVER; })[0];
                if (reserveFilmix && Lampa.Storage.field('mycinema_public') === 'yes') reserveFilmix.name = 'Filmix (резерв)';
                if (preferredFilmix) {
                    preferredFilmix.name = 'Filmix';
                    sources.splice(sources.indexOf(preferredFilmix), 1); sources.splice(reserveFilmix ? sources.indexOf(reserveFilmix) : 0, 0, preferredFilmix);
                }
                sources.push({id: 'demo', name: 'Демо • Big Buck Bunny'});
                sourceID = Lampa.Storage.get(sourceStorageKey, '');
                if (preferredFilmix && backend('cinema').base === CINEMA_SERVER && !Lampa.Storage.get('mycinema_filmix_selection_087', false)) {
                    if (sourceID === 'cinema-filmix') { sourceID = preferredFilmix.id; Lampa.Storage.set(sourceStorageKey, sourceID); }
                    Lampa.Storage.set('mycinema_filmix_selection_087', true);
                }
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
                if (mode === 'all' && Lampa.Storage.field('mycinema_cinema') !== 'no') tasks.push('cinema');
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
                var label = {cinema: 'Cinema', device: 'На устройстве', direct: 'Свой адаптер', lampac: 'Свой Lampac', public: 'WTCH', catalog: 'Каталог'}[kind] || kind;
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
                        if (!s || s.show === false || typeof s.url !== 'string' || typeof s.name !== 'string') return;
                        try { available.push({id: kind + '-' + (s.balanser || index), name: s.name.replace(/<[^>]*>/g, '') + (mode === 'all' && kind !== 'cinema' ? ' • ' + label : ''),
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
            files.render().addClass('mycinema-screen');
            files.appendHead(filter.render()); files.appendFiles(scroll.render());
            scroll.minus(files.render().find('.explorer__files-head'));
            filter.render().find('.filter--search').insertAfter(filter.render().find('.filter--filter'));
            filter.onBack = refocus;
            filter.onSearch = function (query, flags) {
                query = String(query || '').trim();
                if (!query) { refocus(); return; }
                queryOverride = query; globalSearch = !!(flags && flags.global);
                searchParams.search = query;
                filter.render().find('.filter--search > div').text(query).removeClass('hide');
                Lampa.Select.close(); load();
            };
            filter.onSelect = function (type, choice, subchoice) {
                if (type === 'sort') { Lampa.Select.close(); sourceID = choice.source; Lampa.Storage.set(sourceStorageKey, sourceID); load(); }
                else if (choice.reset) { Lampa.Select.close(); forgetChoice(); load(); }
                else if (subchoice) {
                    choice.items.forEach(function (entry) { entry.selected = entry === subchoice; });
                    choice.subtitle = subchoice.title;
                    if (choice.kind === 'voice') {
                        voices.forEach(function (voice) { voice.active = voice.url === subchoice.online_url; });
                        var selectedVoice = voices.filter(function (voice) { return voice.active; })[0];
                        if (selectedVoice) saveChoice({voice: selectedVoice.name});
                        voiceRestoreAttempts = 1;
                        loadOnline(subchoice.online_url, false);
                    } else if (subchoice.online_url) {
                        selectedSeason = subchoice.season; saveChoice({season: selectedSeason});
                        voiceRestoreAttempts = 0; voices = []; loadOnline(subchoice.online_url, false);
                    } else { season = subchoice.season; saveChoice({season: season}); draw(); }
                }
            };
            if (filter.addButtonBack) filter.addButtonBack();
            var refresh = $('<div class="simple-button selector">Обновить</div>').on('hover:enter', discover);
            filter.render().find('.torrent-filter').append(refresh);
            return this.render();
        };
        this.start = function () {
            if (!isActive()) return;
            updateMetadata(); updateHistory();
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
        this.destroy = function () { alive = false; generation++; playbackID = 0; playerClosed(); Lampa.Player.listener.remove('destroy', playerClosed); Lampa.Player.listener.remove('start', playerStart); Lampa.Player.listener.remove('ready', playerReady); Lampa.PlayerVideo.listener.remove('tracks', nativeAudio); Lampa.PlayerVideo.listener.remove('loadeddata', playerLoaded); Lampa.PlayerVideo.listener.remove('levels', playerLevels); network.clear(); playbackNetwork.clear(); metadataNetwork.clear(); filter.destroy(); scroll.destroy(); files.destroy(); };
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
        if (!Lampa.Storage.get('mycinema_wtch_enabled_087', false)) {
            Lampa.Storage.set('mycinema_public', 'yes');
            Lampa.Storage.set('mycinema_wtch_enabled_087', true);
        }
        Lampa.Component.add(ID, Screen);
        Lampa.SettingsApi.addComponent({component: ID, name: NAME, icon: ICON});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_server', type: 'input', values: '', placeholder: 'Не задано', default: ''},
            field: {name: 'Адрес личного API', description: 'Необязательный сервер пользователя для адаптеров и каталога. Например https://cinema.example.org.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_mode', type: 'select', values: {all: 'Все подключения', cinema: 'Источники Cinema', device: 'Напрямую с устройства', rutube: 'Rutube на устройстве', direct: 'Адаптеры личного API', public: 'Готовый сервер WTCH', lampac: 'Свой Lampac', catalog: 'Свой каталог'}, default: 'all'},
            field: {name: 'Режим', description: 'После смены режима откройте источник заново.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_cinema', type: 'select', values: {yes: 'Да', no: 'Нет'}, default: 'yes'},
            field: {name: 'Cinema во всех подключениях', description: 'Добавлять источники стороннего сервера Cinema. Можно отключить независимо от остальных подключений.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_cinema_url', type: 'input', values: '', placeholder: 'Не задано', default: CINEMA_SERVER},
            field: {name: 'Адрес Cinema', description: 'Адрес JSON API Lampac. HTTP может блокироваться браузером; доступность зависит от владельца сервера.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_rutube', type: 'select', values: {yes: 'Да', no: 'Нет'}, default: 'yes'},
            field: {name: 'Rutube: прямой поиск', description: 'Для фильмов. Поиск и получение потока выполняются на устройстве, без общего сервера и токена.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_filmix_host', type: 'input', values: '', placeholder: 'Не задано', default: ''},
            field: {name: 'Filmix: HTTPS API', description: 'Экспериментальный прямой доступ с устройства, без общего сервера. Укажите доступный API host Filmix.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_filmix_token', type: 'input', values: '', placeholder: 'Не задано', default: ''},
            field: {name: 'Filmix: личный токен', description: 'Только токен пользователя этого устройства. Хранится локально, отправляется указанному API Filmix.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_public', type: 'select', values: {no: 'Нет', yes: 'Да'}, default: 'yes'},
            field: {name: 'Добавлять WTCH ко всем подключениям', description: 'Необязательный сторонний сервер. Использует HTTP; браузер может блокировать запросы.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_direct_access', type: 'input', values: '', placeholder: 'Не задано', default: ''},
            field: {name: 'Токен своего API', description: 'access_token из providers.local.json. Токены провайдеров остаются на сервере.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_lampac', type: 'input', values: '', placeholder: 'Не задано', default: ''},
            field: {name: 'Адрес Lampac', description: 'Ваш сервер, например https://lampac.example.org — без /online.js. Провайдеры загружаются из его API.'}});
        Lampa.SettingsApi.addParam({component: ID, param: {name: 'mycinema_access', type: 'input', values: '', placeholder: 'Не задано', default: ''},
            field: {name: 'Токен доступа Lampac', description: 'Если сервер требует авторизацию. Это токен вашего Lampac, а не Filmix или Kodik.'}});
        Lampa.Manifest.plugins = {type: 'video', name: NAME, version: '0.8.10', component: ID,
            description: 'Каталог видео, выбор озвучки и качества',
            onContextMenu: function () { return {name: NAME, title: NAME}; }, onContextLauch: open};
        Lampa.Listener.follow('full', onFull);
        $('<style>' +
            '.mycinema-screen .explorer__files{background:rgba(0,0,0,.2)}' +
            '.mycinema-screen .filter--search>div{max-width:15em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
            '.mycinema-row{display:flex;align-items:center;position:relative;margin:.65em 0 1.25em;padding:.3em;border:.15em solid transparent;border-radius:.2em;min-height:7.7em}' +
            '.mycinema-row.focus{border-color:#fff;background:rgba(255,255,255,.07)}' +
            '.mycinema-thumb{position:relative;width:12em;height:7.4em;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(130deg,#242733,#11131b);border-radius:.2em;overflow:hidden}' +
            '.mycinema-thumb img{position:absolute;width:100%;height:100%;object-fit:cover}.mycinema-number{z-index:1;position:relative;font-size:3em;font-weight:600;text-shadow:0 2px 6px #000}' +
            '.mycinema-thumb--loaded .mycinema-number{display:none}.mycinema-thumb--loaded.mycinema-thumb--episode .mycinema-number{display:block;position:absolute;top:.5em;left:.5em;padding:.2em .4em;border-radius:.2em;background:rgba(0,0,0,.55);font-size:1em}' +
            '.mycinema-body{flex:1;min-width:0;padding:0 1.25em}.mycinema-title{font-size:1.45em;line-height:1.25;margin-bottom:.8em;overflow-wrap:break-word}' +
            '.mycinema-info{opacity:.82;font-size:.9em;line-height:1.5}.mycinema-meta{align-self:stretch;flex-shrink:0;text-align:right;min-width:4em;max-width:8em;padding-top:.35em}' +
            '.mycinema-duration{font-size:1.05em}.mycinema-quality{opacity:.75;font-size:.9em;line-height:1.4;margin-top:1.2em;overflow-wrap:break-word}' +
            '.mycinema-message{padding:.8em .4em;line-height:1.5;opacity:.7;font-size:.9em}.mycinema-progress{margin-top:.65em}' +
            '.mycinema-history{display:flex;align-items:center;gap:.8em;margin:.8em 0 1.2em;padding:.85em 1em;border:.15em solid transparent;border-radius:.25em;background:rgba(255,255,255,.07)}' +
            '.mycinema-history.focus{border-color:#fff}.mycinema-history-icon{width:1.4em;height:1.4em;flex-shrink:0}.mycinema-history-icon svg{width:100%;height:100%}' +
            '.mycinema-history-text{flex:1}.mycinema-history-time{opacity:.7}.mycinema-history--empty{opacity:.75}' +
            '@media(max-width:580px){.mycinema-thumb{width:8em;height:5em}.mycinema-number{font-size:2.2em}.mycinema-title{font-size:1.15em;margin-bottom:.4em}.mycinema-body{padding:0 .7em}.mycinema-meta{min-width:3em;max-width:5em}.mycinema-quality{margin-top:.6em}}' +
            '</style>').appendTo('head');
    }
    if (window.appready) init();
    else Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') init(); });
}());
