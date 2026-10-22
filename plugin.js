(function () {
    'use strict';

    const NAME = 'Lampa Stream';
    const VERSION = '0.3.2';

    if (!window.Lampa || !Lampa.Listener) {
        console.error(NAME + ': API Lampa недоступен');
        return;
    }

    // Защита от повторной загрузки
    if (window.LampaStream) {
        console.log(NAME + ': уже загружен');
        return;
    }

    window.LampaStream = {
        name: NAME,
        version: VERSION
    };

    function addStreamButton(event) {
        // В исходниках Lampa используется именно "complite"
        if (!event || event.type !== 'complite') {
            return;
        }

        // Готовый экран фильма передаётся через event.body
        const screen = $(event.body);

        const container = screen
            .find('.buttons--container')
            .addBack('.buttons--container');

        if (!container.length) {
            console.log(NAME + ': контейнер не найден');
            return;
        }

        // Защита от дублирования
        if (container.find('.lampa-stream-button').length) {
            return;
        }

        // Создаём источник просмотра
        const button = $(
            '<div class="full-start__button selector lampa-stream-button">' +
                '<span>Lampa Stream</span>' +
            '</div>'
        );

        button.attr(
            'data-subtitle',
            'Смотреть через Lampa Stream'
        );

        button.on('hover:enter', function () {
            console.log(NAME + ': источник выбран');

            Lampa.Noty.show(
                'Lampa Stream: источник выбран'
            );
        });

        container.append(button);

        console.log(NAME + ': источник добавлен');
    }

    Lampa.Listener.follow('full', addStreamButton);

    console.log(NAME + ' ' + VERSION + ' запущен');

    Lampa.Noty.show(
        NAME + ' ' + VERSION + ' подключён!'
    );

})();