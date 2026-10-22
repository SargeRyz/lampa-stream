(function () {
    'use strict';

    const NAME = 'Lampa Stream';

    if (!window.Lampa) {
        console.error(NAME + ': Lampa не найдена');
        return;
    }

    if (window.LampaStream) {
        return;
    }

    window.LampaStream = {
        name: NAME,
        version: '0.2.0'
    };

    function openStream(movie) {
        console.log(NAME + ': выбран фильм', movie);

        const title =
            movie.title ||
            movie.name ||
            movie.original_title ||
            movie.original_name ||
            'Без названия';

        Lampa.Noty.show(
            NAME + ': ' + title
        );
    }

    if (Lampa.Manifest && Lampa.Manifest.plugins) {
        Lampa.Manifest.plugins = {
            type: 'video',
            name: NAME,
            subtitle: 'Смотреть через Lampa Stream',
            onContextMenu: true,
            onContextLauch: openStream
        };

        console.log(NAME + ': видеоплагин зарегистрирован');
        Lampa.Noty.show(NAME + ' 0.2.0 подключён!');
    } else {
        console.error(NAME + ': Manifest.plugins недоступен');
    }
})();