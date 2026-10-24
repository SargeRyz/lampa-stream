const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM, VirtualConsole} = require('jsdom');
const runtime = path.resolve(process.argv[2] || '../lampa-runtime');
const dom = new JSDOM('<html><head></head><body><div id="app"></div><div class="welcome"></div></body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
});
const w = dom.window;
w.console = {...console, log() {}, warn() {}, error() {}};
w.scrollTo = () => {};
w.localStorage.setItem('language', 'ru');
for (const file of ['vender/jquery/jquery.js', 'vender/navigator/navigator.js', 'vender/keypad/keypad.js']) w.eval(fs.readFileSync(path.join(runtime, file), 'utf8'));
w.$.ajax = o => {setTimeout(() => o.error && o.error({status: 0}, 'abort'), 0); return {abort() {}};};
try {w.eval(fs.readFileSync(process.argv[3] || path.join(runtime, 'app.min.js'), 'utf8'));} catch (_) {}
setTimeout(() => {
    try {
        w.appready = true;
        w.eval(fs.readFileSync(path.join(__dirname, '../plugin.js'), 'utf8'));
        const L = w.Lampa, $ = w.$;
        const pending = [], played = [], playlists = [], notices = [];
        let client = 0;
        L.Reguest = function () {
            const id = ++client;
            this.clear = () => {};
            this.timeout = () => {};
            this.native = this.silent = (url, ok, fail, post, options) => pending.push({id, url, ok, fail, options});
        };
        L.Controller.toggle = () => {};
        L.Timeline.init(); L.Select.init();
        if (!L.Head.render()) L.Head.init();
        if (!L.Settings.render()) L.Settings.init();
        let settingsBody;
        L.Settings.listener.follow('open', event => { if (event.name === 'mycinema') settingsBody = event.body; });
        assert.doesNotThrow(() => L.Settings.create('mycinema'), 'plugin settings must open with empty input values');
        assert.ok(settingsBody && settingsBody.find('[data-name="mycinema_mode"]').length);
        assert.equal(settingsBody.find('[data-name="mycinema_server"] .settings-param__value').text(), 'Не задано');
        const enabled = L.Controller.enabled;
        L.Controller.enabled = () => ({name: 'settings_component'});
        settingsBody.find('[data-name="mycinema_mode"]').trigger('hover:enter'); select('Готовый сервер WTCH'); L.Select.close();
        assert.equal(L.Storage.field('mycinema_mode'), 'public');
        L.Storage.set('mycinema_server', 'https://my-api.example');
        assert.doesNotThrow(() => L.Settings.create('mycinema'), 'settings also open with saved input values');
        assert.equal(settingsBody.find('[data-name="mycinema_mode"] .settings-param__value').text(), 'Готовый сервер WTCH');
        assert.equal(settingsBody.find('[data-name="mycinema_server"] .settings-param__value').text(), 'https://my-api.example');
        L.Storage.set('mycinema_server', ''); L.Controller.enabled = enabled;
        console.log('PASS: native settings open with empty/saved inputs, WTCH mode selection and persistence after reopening');
        L.Player.play = data => played.push(data);
        L.Player.playlist = list => playlists.push(list);
        L.Noty.show = text => notices.push(text);
        L.Storage.set('mycinema_mode', 'cinema');
        L.Storage.set('mycinema_access', 'private-lampac-token');
        L.Storage.set('mycinema_direct_access', 'private-adapter-token');
        L.Storage.set('account_email', 'not-for-public-api@example.test');
        L.Storage.set('kit_aesgcmkey', 'not-for-public-api');
        L.Storage.set('player', 'inner');
        const Cls = L.Component.get('mycinema');
        const movie = {id: 100088, source: 'tmdb', media_type: 'tv', name: 'Одни из нас', original_name: 'The Last of Us', first_air_date: '2023-01-15', overview: 'Fixture', genres: [], production_countries: [], backdrop_path: '/card-backdrop.jpg', poster_path: '/card-poster.jpg'};
        function create(card = movie) {
            const screen = new Cls({movie: {...card}}); screen.activity = {loader() {}};
            L.Activity.active = () => ({activity: screen.activity});
            const html = screen.create(); $('body').append(html); screen.start();
            return {screen, html};
        }
        function next() {const req = pending.shift(); assert.ok(req, 'expected API request'); return req;}
        function select(label) {
            const row = $('.selectbox .selector').toArray().find(e => e.textContent.trim() === label || e.textContent.trim().startsWith(label + '\n'));
            assert.ok(row, 'missing menu item: ' + label + '\n' + $('.selectbox').text()); $(row).trigger('hover:enter');
        }
        function menu(view, name) {view.find(name).trigger('hover:enter');}
        const origin = 'http://88.218.62.180:9118';
        const provider = [{name: 'Filmix', balanser: 'filmix', url: '/lite/filmix', show: true}, {name: 'HDVB', balanser: 'hdvb', url: '/lite/hdvb', show: true}, {name: 'Hidden', balanser: 'hidden', url: '/lite/hidden', show: false}];
        function discover() {
            const req = next(), u = new URL(req.url);
            assert.equal(u.origin, origin); assert.equal(u.pathname, '/lite/events');
            for (const name of ['token', 'account_email', 'uid', 'nws_id']) assert.equal(u.searchParams.get(name), null, 'no private credential/identifier forwarding');
            assert.equal(req.options.headers, undefined);
            req.ok(provider);
            return next();
        }
        function seasons(req, providerName = 'filmix') {
            req.ok({type: 'season', maxquality: '1080p', data: [1, 2].map(s => ({name: s + ' сезон', id: s, method: 'link', url: '/lite/' + providerName + '?postid=10&s=' + s}))});
            return next();
        }
        function voices(s, active = 'A') {return ['A', 'B'].map(t => ({name: 'Студия ' + t, active: t === active, url: '/lite/filmix?postid=10&s=' + s + '&t=' + t}));}
        function episodes(s = 1, version = 'old') {return [3, 1, 2].map(e => ({name: e + ' серия', method: 'play', s, e,
            url: 'https://cdn.example/' + version + '/' + s + '-' + e + '-480.mp4',
            quality: {'480p': 'https://cdn.example/' + version + '/' + s + '-' + e + '-480.mp4', '720p': 'https://cdn.example/' + version + '/' + s + '-' + e + '-720.mp4 or https://backup.example/' + version + '/' + s + '-' + e + '-720.mp4'},
            hls_manifest_timeout: 30000}));}
        function episodeResponse(req, s = 1, active = 'A', data = episodes(s)) {req.ok({type: 'episode', voice: voices(s, active), data});}
        function metadata() {
            if (pending[0] && pending[0].url.includes('/tv/100088/season/')) next().ok({episodes: [1, 2, 3].map(e => ({episode_number: e, name: 'Название серии ' + e, runtime: 52, air_date: '2023-01-15', vote_average: 8.2, still_path: e === 1 ? '/episode-1.jpg' : null}))});
        }
        const tv = create();
        let req = seasons(discover()); assert.equal(new URL(req.url).searchParams.get('s'), '1');
        episodeResponse(req);
        assert.match(tv.html.find('.mycinema-row img').eq(1).attr('src'), /\/card-backdrop\.jpg$/, 'card artwork is available before optional metadata');
        metadata();
        assert.equal(tv.html.find('.mycinema-row').length, 3);
        assert.equal(tv.html.find('.mycinema-title').eq(1).text(), 'Название серии 1', 'real Lampac name format receives TMDB episode title');
        const episodeThumb = tv.html.find('.mycinema-thumb').eq(1);
        assert.match(episodeThumb.find('img').attr('src'), /\/episode-1\.jpg$/, 'episode still replaces card artwork');
        episodeThumb.find('img').trigger('error'); assert.match(episodeThumb.find('img').attr('src'), /\/card-backdrop\.jpg$/);
        episodeThumb.find('img').trigger('load'); assert.ok(episodeThumb.hasClass('mycinema-thumb--loaded'));
        menu(tv.html, '.filter--sort'); assert.doesNotMatch($('.selectbox').text(), /Hidden|• Cinema/); L.Select.close();
        assert.doesNotMatch(tv.html.find('.filter--sort').text(), /Cinema/);
        const playsBefore = played.length;
        tv.html.find('.mycinema-row').eq(1).trigger('hover:enter');
        assert.equal(played.length, playsBefore + 1, 'a row starts playback immediately without a quality dialog');
        assert.doesNotMatch($('.selectbox').text(), /Качество/);
        let data = played.at(-1), list = playlists.at(-1);
        assert.equal(data.url, 'https://cdn.example/old/1-1-720.mp4');
        assert.equal(data.url_reserve, 'https://backup.example/old/1-1-720.mp4');
        assert.equal(data.card.id, movie.id); assert.equal(data.episode, 1); assert.equal(data.hls_manifest_timeout, 30000);
        assert.equal(list.length, 3); assert.deepEqual(Array.from(list, x => x.episode), [1, 2, 3]);
        assert.equal(typeof list[1].url, 'function'); assert.notEqual(list[0], data);
        assert.doesNotThrow(() => JSON.stringify(data), 'native Player receives a non-circular playlist');
        assert.equal(pending.length, 0, 'no eager requests for the remaining episodes');
        let ready = 0;
        list[1].url(() => ready++); req = next();
        assert.equal(new URL(req.url).searchParams.get('s'), '1'); assert.equal(new URL(req.url).searchParams.get('rjson'), 'true');
        const callRows = episodes(1, 'refreshed'); callRows[2] = {name: '2 серия', s: 1, e: 2, method: 'call', url: '/lite/filmix/video?s=1&e=2'};
        episodeResponse(req, 1, 'A', callRows); req = next(); assert.match(req.url, /\/video\?/);
        req.ok({url: 'https://cdn.example/fresh-2.mp4', quality: {'480p': 'https://cdn.example/fresh-2.mp4 or https://backup.example/fresh-2.mp4'}, headers: {Referer: 'https://provider.example'}, subtitles: [{label: 'RU', url: 'https://cdn.example/ru.vtt'}], segments: [{start: 0, end: 10}], hls_manifest_timeout: 15000});
        assert.equal(ready, 1); assert.equal(list[1].url, 'https://cdn.example/fresh-2.mp4');
        assert.equal(list[1].url_reserve, 'https://backup.example/fresh-2.mp4');
        assert.equal(list[1].headers.Referer, 'https://provider.example'); assert.equal(list[1].subtitles.length, 1);
        assert.equal(list[1].segments.length, 1); assert.equal(list[1].hls_manifest_timeout, 15000); assert.equal(list[1].episode, 2);
        assert.notEqual(list[1].timeline.hash, data.timeline.hash);
        list[2].url(() => ready++); req = next(); req.ok({rch: true, script: 'window.untrustedExecuted = true'});
        assert.equal(ready, 2); assert.equal(list[2].url, ''); assert.match(notices.at(-1), /Remote Control Hub/); assert.equal(w.untrustedExecuted, undefined);
        console.log('PASS: Cinema JSON discovery, credential isolation, hidden sources, actual episode titles, sorted lazy playlist, fresh list/call resolution, reserves, metadata payload and RCH rejection');
        menu(tv.html, '.filter--filter'); select('Перевод'); select('Студия B'); req = next(); assert.equal(new URL(req.url).searchParams.get('t'), 'B'); episodeResponse(req, 1, 'B');
        menu(tv.html, '.filter--filter'); select('Сезон'); select('2 сезон'); req = next(); assert.equal(new URL(req.url).searchParams.get('s'), '2');
        episodeResponse(req, 2, 'A'); req = next(); assert.equal(new URL(req.url).searchParams.get('t'), 'B', 'voice preference restores after changing seasons');
        episodeResponse(req, 2, 'B'); metadata(); tv.screen.destroy();
        const restored = create(); req = seasons(discover()); assert.equal(new URL(req.url).searchParams.get('s'), '2');
        episodeResponse(req, 2, 'A'); req = next(); assert.equal(new URL(req.url).searchParams.get('t'), 'B'); episodeResponse(req, 2, 'B'); metadata();
        menu(restored.html, '.filter--filter'); select('Сбросить фильтр'); req = seasons(next()); assert.equal(new URL(req.url).searchParams.get('s'), '1'); episodeResponse(req); metadata();
        assert.equal(pending.length, 0, 'reset clears the voice preference');
        restored.html.find('.mycinema-row').eq(1).trigger('hover:enter'); list = playlists.at(-1);
        list[1].url(() => ready++); const stale = next(); restored.screen.destroy(); stale.ok({type: 'episode', data: episodes()}); assert.equal(ready, 2, 'destroyed screen cannot restart the Player');
        const other = create({...movie, source: 'other'}); req = seasons(discover()); assert.equal(new URL(req.url).searchParams.get('s'), '1'); episodeResponse(req); assert.equal(pending.length, 0, 'other namespaces do not request wrong TMDB metadata'); other.screen.destroy();
        console.log('PASS: saved season/voice, reopen restoration, explicit reset, namespace isolation and stale playback callback cleanup');
        L.Storage.set('player', 'android'); const external = create(); req = seasons(discover());
        const externalSeason = Number(new URL(req.url).searchParams.get('s'));
        episodeResponse(req, externalSeason, 'A', [1, 2].map(e => ({name: e + ' серия', s: externalSeason, e, method: 'call', url: '/lite/filmix/video?s=' + externalSeason + '&e=' + e})));
        metadata(); external.html.find('.mycinema-row').first().trigger('hover:enter'); req = next(); req.ok({url: 'https://cdn.example/external.mp4'});
        assert.equal(playlists.at(-1).length, 1, 'no JavaScript resolver functions sent to external players'); external.screen.destroy();
        L.Storage.set('player', 'inner'); L.Storage.set('mycinema_mode', 'all'); L.Storage.set('mycinema_server', ''); L.Storage.set('mycinema_lampac', ''); L.Storage.set('mycinema_filmix_host', ''); L.Storage.set('mycinema_public', 'no');
        const film = {...movie, id: 500, name: undefined, first_air_date: undefined, media_type: 'movie', title: 'Фильм', release_date: '2020-01-01'};
        const fallback = create(film); req = next(); assert.equal(new URL(req.url).origin, origin); req.fail();
        req = next(); assert.equal(new URL(req.url).origin, 'https://rutube.ru'); req.ok(JSON.stringify({results: []}));
        assert.match(fallback.html.text(), /Недоступные подключения.*Cinema/); menu(fallback.html, '.filter--sort'); assert.match($('.selectbox').text(), /Rutube/); L.Select.close(); fallback.screen.destroy();
        L.Storage.set('mycinema_cinema', 'no'); const disabled = create(film); req = next(); assert.equal(new URL(req.url).origin, 'https://rutube.ru'); req.ok(JSON.stringify({results: []})); disabled.screen.destroy();
        L.Storage.set('mycinema_mode', 'cinema'); L.Storage.set('mycinema_cinema_url', 'https://custom.example'); const custom = create(); req = next(); assert.equal(new URL(req.url).origin, 'https://custom.example'); assert.equal(new URL(req.url).searchParams.get('token'), null); custom.screen.destroy();
        assert.equal(pending.length, 0);
        console.log('PASS: external-player boundary, partial server failure, independent Rutube fallback, disabled Cinema and configurable Cinema URL');
        L.Storage.set('mycinema_mode', 'catalog'); L.Storage.set('mycinema_server', 'https://catalog.example');
        const catalog = create(film); req = next(); assert.match(req.url, /\/api\/sources$/); req.ok({sources: [{id: 'library', name: 'Library'}]});
        req = next(); assert.equal(new URL(req.url).searchParams.get('source'), 'library');
        req.ok({streams: [
            {id: 'local-film', title: 'Дубляж', voice: 'Студия', poster: 'https://art.example/source.jpg', quality: {'720p': 'https://cdn.example/local720.mp4', '1080p': 'https://cdn.example/local1080.mp4 or https://backup.example/local1080.mp4'}},
            {id: 'uhd-film', title: 'UHD', quality: {'1080p': 'https://cdn.example/fhd.mp4', '720p': 'https://cdn.example/hd.mp4', '4K': 'https://cdn.example/uhd.mp4'}},
            {id: 'invalid-quality', title: 'Safe URL', quality: {'1080p': 'javascript:alert(1)', '480p': 'https://cdn.example/sd.mp4', '720p': 'https://cdn.example/safe-hd.mp4'}}
        ]});
        const filmThumb = catalog.html.find('.mycinema-thumb').first();
        assert.equal(filmThumb.find('img').attr('src'), 'https://art.example/source.jpg');
        filmThumb.find('img').trigger('error'); assert.match(filmThumb.find('img').attr('src'), /\/card-backdrop\.jpg$/);
        filmThumb.find('img').trigger('error'); assert.match(filmThumb.find('img').attr('src'), /\/card-poster\.jpg$/);
        filmThumb.find('img').trigger('error'); assert.equal(filmThumb.find('img').length, 0, 'fallback stops after the last image');
        catalog.html.find('.mycinema-row').first().trigger('hover:enter'); data = played.at(-1);
        assert.equal(data.url, 'https://cdn.example/local1080.mp4'); assert.equal(data.card.id, film.id); assert.ok(data.timeline);
        assert.equal(data.url_reserve, 'https://backup.example/local1080.mp4');
        assert.equal(catalog.html.find('.mycinema-quality').first().text(), '1080p');
        catalog.html.find('.mycinema-row').eq(1).trigger('hover:enter'); assert.equal(played.at(-1).url, 'https://cdn.example/uhd.mp4');
        catalog.html.find('.mycinema-row').eq(2).trigger('hover:enter'); assert.equal(played.at(-1).url, 'https://cdn.example/safe-hd.mp4');
        menu(catalog.html, '.filter--sort'); select('Демо • Big Buck Bunny'); catalog.html.find('.mycinema-row').first().trigger('hover:enter'); data = played.at(-1);
        assert.equal(catalog.html.find('.mycinema-row img').length, 0, 'demo does not inherit the movie poster');
        assert.equal(data.card, undefined); assert.equal(data.timeline, undefined); assert.equal(playlists.at(-1).length, 1); assert.equal(pending.length, 0); catalog.screen.destroy();
        console.log('PASS: existing catalog, quality selection, movie Timeline and demo history isolation');
        L.Storage.set('mycinema_mode', 'cinema'); L.Storage.set('mycinema_cinema_url', origin);
        const rejected = create(); req = discover(); req.ok({rch: true});
        assert.match(rejected.html.text(), /Remote Control Hub/); menu(rejected.html, '.filter--sort'); select('HDVB');
        req = next(); assert.match(req.url, /\/lite\/hdvb/); req.ok({type: 'movie', data: [{name: 'Оригинал', url: 'https://cdn.example/hdvb.mp4'}]});
        assert.equal(rejected.html.find('.mycinema-row').length, 1); rejected.screen.destroy(); assert.equal(pending.length, 0);
        console.log('PASS: source selector remains usable after the first provider fails');
        const timeoutScreen = create(); req = next(); assert.equal(req.options.timeout, 30000, 'Cinema discovery must allow slow cold lookups');
        req.fail({status: 0, responseText: 'private-lampac-token'}, 'timeout');
        assert.match(timeoutScreen.html.text(), /Тайм-аут 30 с/); assert.doesNotMatch(timeoutScreen.html.text(), /private-lampac-token/); timeoutScreen.screen.destroy();
        for (const [error, reason, message] of [[{status: 403}, 'error', /HTTP 403/], [{status: 200}, 'parsererror', /не является JSON.*HTTP 200/], [{status: 0}, 'error', /статус 0/]]) {
            const failure = create(); req = next(); req.fail(error, reason); assert.match(failure.html.text(), message); failure.screen.destroy();
        }
        dom.reconfigure({url: 'https://app.example/'}); L.Storage.set('mycinema_mode', 'cinema');
        const secure = create(); req = next(); req.fail({status: 0}, 'error');
        assert.match(secure.html.text(), /HTTPS.*HTTP.*возможна блокировка/); secure.screen.destroy();
        L.Storage.set('mycinema_mode', 'lampac'); L.Storage.set('mycinema_lampac', 'https://private.example'); L.Storage.set('mycinema_access', 'private-lampac-token');
        const privateScreen = create(); req = next(); assert.equal(req.options.timeout, 8000);
        req.fail({status: 403, responseText: req.url}, 'error'); assert.match(privateScreen.html.text(), /HTTP 403/);
        assert.doesNotMatch(privateScreen.html.text(), /private-lampac-token/); privateScreen.screen.destroy(); assert.equal(pending.length, 0);
        console.log('PASS: Cinema 30-second discovery, private-server timeout, distinct timeout/HTTP/JSON/status-zero diagnostics, HTTPS/HTTP hint and secret redaction');
        L.Storage.set('mycinema_mode', 'public');
        const wtch = create(); req = next(); assert.equal(req.options.timeout, 30000); assert.equal(new URL(req.url).host, 'wtch.ch');
        assert.equal(new URL(req.url).searchParams.get('token'), null);
        req.ok([{name: 'Filmix', balanser: 'fxapi', url: 'http://wtch.ch/lite/fxapi'}]); req = next();
        req.ok({type: 'season', data: [{method: 'link', id: 1, name: '1 сезон', url: 'http://wtch.ch/lite/fxapi?postid=163529&s=1'}]}); req = next();
        const wtchRows = version => [1, 2].map(e => ({name: e + ' серия', s: 1, e, method: 'play', url: 'https://cdn.example/' + version + '-' + e + '-720.mp4', quality: {'480p': 'https://cdn.example/' + version + '-' + e + '-480.mp4', '720p': 'https://cdn.example/' + version + '-' + e + '-720.mp4'}}));
        req.ok({type: 'episode', data: wtchRows('wtch')}); metadata(); wtch.html.find('.mycinema-row').first().trigger('hover:enter');
        assert.equal(played.at(-1).url, 'https://cdn.example/wtch-1-720.mp4'); list = playlists.at(-1); let wtchReady = 0;
        list[1].url(() => wtchReady++); req = next(); const upgraded = wtchRows('wtch-fresh');
        upgraded[1].quality['1080p'] = 'https://cdn.example/wtch-fresh-2-1080.mp4'; req.ok({type: 'episode', data: upgraded});
        assert.equal(wtchReady, 1); assert.equal(list[1].url, 'https://cdn.example/wtch-fresh-2-1080.mp4'); wtch.screen.destroy(); assert.equal(pending.length, 0);
        console.log('PASS: WTCH 30-second discovery, anonymous fxapi contract, automatic 720p and highest quality on fresh next-episode links');
        L.Storage.set('mycinema_mode', 'all'); L.Storage.set('mycinema_cinema', 'yes'); L.Storage.set('mycinema_cinema_url', origin);
        L.Storage.set('mycinema_server', ''); L.Storage.set('mycinema_lampac', ''); L.Storage.set('mycinema_source_all', 'cinema-filmix');
        const clean = create(film); req = discover();
        req.ok({type: 'similar', data: [{name: 'Другая картина', method: 'link', url: '/lite/filmix?postid=20'}, {name: 'Свой постер', method: 'link', url: '/lite/filmix?postid=21', img: '/proxyimg/own.jpg'}]});
        assert.equal(clean.html.find('.mycinema-row').first().find('img').length, 0, 'other search results do not inherit the current card');
        assert.equal(clean.html.find('.mycinema-row').eq(1).find('img').attr('src'), origin + '/proxyimg/own.jpg');
        menu(clean.html, '.filter--sort'); assert.doesNotMatch($('.selectbox').text(), /• Cinema/); select('HDVB');
        req = next(); req.ok({type: 'movie', data: [{name: 'Оригинал', url: 'https://cdn.example/movie.mp4'}]});
        assert.match(clean.html.find('.mycinema-row img').attr('src'), /\/card-backdrop\.jpg$/, 'movie rows without source images use card artwork');
        assert.doesNotMatch(clean.html.find('.filter--sort').text(), /Cinema/);
        clean.screen.destroy(); assert.equal(pending.length, 0);
        console.log('PASS: movie/episode previews, broken-image fallback, demo/search artwork isolation and clean Cinema names in both modes');
        console.log('Native Lampa:', L.Manifest.app_version);
    } catch (error) {console.error(error.stack); process.exitCode = 1;} finally {dom.window.close();}
}, 200);
