(function () {
    'use strict';

    const NAME = 'Lampa Stream';

    if (!window.Lampa || !Lampa.Listener) {
        console.error(NAME + ': API Lampa недоступен');
        return;
    }

    if (window.LampaStream && window.LampaStream.version === '0.3.0') {
        return;
    }

    window.LampaStream = {
        name: NAME,
        version: '0.3.0'
    };

    Lampa.Listener.follow('full', function (event) {
        if (event.type !== 'complete') return;

        const screen = event.object &&
            event.object.activity &&
            event.object.activity.render();

        if (!screen || !screen.length) return;

        const container = screen.find('.buttons--container');

        if (!container.length) return;
        if (container.find('.lampa-stream-button').length) return;

        const button = $(
            '<div class="full-start__button selector lampa-stream-button">' +
                '<span>Lampa Stream</span>' +
            '</div>'
        );

        button.attr('data-subtitle', 'Смотреть через Lampa Stream');

        button.on('hover:enter', function () {
            Lampa.Noty.show('Lampa Stream: источник выбран');
        });

        container.append(button);

        console.log(NAME + ': кнопка добавлена');
    });

    Lampa.Noty.show(NAME + ' 0.3.0 подключён!');
})();