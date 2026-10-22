(function () {
    'use strict';

    function init() {
        if (!window.Lampa) {
            console.error('Lampa не найдена');
            return;
        }

        console.log('Lampa Stream: запуск');

        Lampa.Noty.show(
            'Lampa Stream успешно загружен!'
        );

        window.LampaStream = {
            version: '0.1.0',
            name: 'Lampa Stream'
        };
    }

    if (window.Lampa) {
        init();
    } else {
        console.error('Ожидается среда Lampa');
    }
})();