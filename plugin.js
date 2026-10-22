(function () {
    'use strict';

    const NAME = 'Lampa Stream';
    const VERSION = '0.3.1';

    // Проверяем доступность Lampa
    if (!window.Lampa || !Lampa.Listener) {
        console.error(NAME + ': API Lampa недоступен');
        return;
    }

    // Защита от повторной загрузки
    if (window.LampaStream) {
        console.log(NAME + ': плагин уже загружен');
        return;
    }

    window.LampaStream = {
        name: NAME,
        version: VERSION
    };

    // Добавляем источник просмотра
    function addStreamButton(event) {
        if (!event || event.type !== 'complete') {
            return;
        }

        const activity =
            event.object && event.object.activity;

        if (
            !activity ||
            typeof activity.render !== 'function'
        ) {
            console.log(
                NAME + ': экран фильма недоступен'
            );
            return;
        }

        // Приводим результат render() к jQuery
        const screen = $(activity.render());

        // Находим контейнер кнопок просмотра
        const container = screen
            .find('.buttons--container')
            .addBack('.buttons--container');

        if (!container.length) {
            console.log(
                NAME + ': контейнер кнопок не найден'
            );
            return;
        }

        // Не допускаем дублирования кнопки
        if (
            container.find('.lampa-stream-button').length
        ) {
            return;
        }

        // Создаём кнопку источника
        const button = $(
            '<div class="full-start__button selector lampa-stream-button">' +
                '<span>Lampa Stream</span>' +
            '</div>'
        );

        button.attr(
            'data-subtitle',
            'Смотреть через Lampa Stream'
        );

        // Обработчик выбора источника
        button.on('hover:enter', function () {
            console.log(
                NAME + ': источник выбран'
            );

            Lampa.Noty.show(
                'Lampa Stream: источник выбран'
            );
        });

        // Добавляем кнопку в контейнер
        container.append(button);

        console.log(
            NAME + ': кнопка источника добавлена'
        );
    }

    // Подписываемся на открытие карточки фильма
    Lampa.Listener.follow('full', addStreamButton);

    console.log(
        NAME + ' ' + VERSION + ' запущен'
    );

    Lampa.Noty.show(
        NAME + ' ' + VERSION + ' подключён!'
    );

})();