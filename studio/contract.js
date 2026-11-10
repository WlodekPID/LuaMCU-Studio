(function (global) {
  'use strict';

  const CHANNELS = Object.freeze(
    Array.from({ length: 8 }, (_, index) => `CH${index + 1}`)
  );
  const RELAYS = Object.freeze(
    Array.from({ length: 5 }, (_, index) => `R${index + 1}`)
  );
  const TYPES = Object.freeze([
    'measurement',
    'alarmLamp',
    'chart',
    'relay',
    'slider',
    'text',
    'button'
  ]);

  const COMPONENTS = Object.freeze([
    {
      type: 'measurement',
      label: 'Kafelek pomiarowy',
      icon: '23.6 °C',
      binding: 'channel',
      defaultSize: { width: 280, height: 170 },
      minimumSize: { width: 220, height: 140 },
      defaults: {
        label: 'Temperatura', channel: 'CH1', unit: '°C',
        decimals: 1, low: 10, high: 80
      }
    },
    {
      type: 'alarmLamp',
      label: 'Lampka alarmowa',
      icon: '● OK',
      binding: 'channel',
      defaultSize: { width: 190, height: 70 },
      minimumSize: { width: 150, height: 58 },
      defaults: { label: 'Stan CH1', channel: 'CH1' }
    },
    {
      type: 'chart',
      label: 'Wykres',
      icon: '⌁',
      binding: 'channels',
      defaultSize: { width: 540, height: 300 },
      minimumSize: { width: 340, height: 220 },
      defaults: {
        label: 'Wykres procesu', channels: ['CH1', 'CH2'], maxPoints: 60
      }
    },
    {
      type: 'relay',
      label: 'Przekaźnik',
      icon: 'R1',
      binding: 'relay',
      defaultSize: { width: 290, height: 100 },
      minimumSize: { width: 240, height: 86 },
      defaults: { label: 'Przekaźnik R1', relay: 'R1' }
    },
    {
      type: 'slider',
      label: 'Suwak',
      icon: '━●━━',
      binding: 'channel',
      defaultSize: { width: 300, height: 116 },
      minimumSize: { width: 230, height: 96 },
      defaults: {
        label: 'Nastawa', channel: 'CH1', unit: '%',
        minimum: 0, maximum: 100, step: 1, value: 50
      }
    },
    {
      type: 'text',
      label: 'Tekst',
      icon: 'Aa',
      binding: 'none',
      defaultSize: { width: 320, height: 80 },
      minimumSize: { width: 120, height: 48 },
      defaults: { text: 'Nowy opis', fontSize: 28, align: 'left' }
    },
    {
      type: 'button',
      label: 'Przycisk',
      icon: 'OK',
      binding: 'none',
      defaultSize: { width: 220, height: 74 },
      minimumSize: { width: 140, height: 56 },
      defaults: { label: 'Przycisk', action: 'none' }
    }
  ].map(item => Object.freeze(item)));

  function componentDefinition(type) {
    return COMPONENTS.find(component => component.type === type) || null;
  }

  function validateProject(project) {
    const errors = [];
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      return ['Projekt musi być obiektem.'];
    }
    if (project.version !== 1) errors.push('Nieobsługiwana wersja projektu.');
    if (typeof project.name !== 'string' || !project.name.trim()) {
      errors.push('Projekt musi mieć nazwę.');
    }
    const canvas = project.canvas;
    if (!canvas || !Number.isInteger(canvas.width)
        || !Number.isInteger(canvas.height)
        || canvas.width < 640 || canvas.width > 3840
        || canvas.height < 360 || canvas.height > 2160) {
      errors.push('Nieprawidłowy rozmiar płótna.');
    }
    if (!Array.isArray(project.components)) {
      errors.push('Brak listy komponentów.');
      return errors;
    }
    if (project.components.length > 100) {
      errors.push('Projekt może zawierać najwyżej 100 komponentów.');
    }
    const ids = new Set();
    project.components.forEach((component, index) => {
      const path = `Komponent ${index + 1}`;
      const definition = componentDefinition(component?.type);
      if (!component || !definition) {
        errors.push(`${path}: nieznany typ.`);
        return;
      }
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(component.id || '')) {
        errors.push(`${path}: nieprawidłowy identyfikator.`);
      } else if (ids.has(component.id)) {
        errors.push(`${path}: powtórzony identyfikator ${component.id}.`);
      }
      ids.add(component.id);
      for (const key of ['x', 'y', 'width', 'height', 'z']) {
        if (!Number.isInteger(component[key])) {
          errors.push(`${path}: ${key} musi być liczbą całkowitą.`);
        }
      }
      if (component.width < definition.minimumSize.width
          || component.height < definition.minimumSize.height) {
        errors.push(`${path}: element jest za mały.`);
      }
      if (canvas && (component.x < 0 || component.y < 0
          || component.x + component.width > canvas.width
          || component.y + component.height > canvas.height)) {
        errors.push(`${path}: element wychodzi poza płótno.`);
      }
      if (!component.props || typeof component.props !== 'object') {
        errors.push(`${path}: brak właściwości.`);
        return;
      }
      if (definition.binding === 'channel'
          && !CHANNELS.includes(component.props.channel)) {
        errors.push(`${path}: nieznany kanał.`);
      }
      if (definition.binding === 'channels'
          && (!Array.isArray(component.props.channels)
            || component.props.channels.length === 0
            || component.props.channels.some(channel => !CHANNELS.includes(channel)))) {
        errors.push(`${path}: nieprawidłowa lista kanałów.`);
      }
      if (definition.binding === 'relay'
          && !RELAYS.includes(component.props.relay)) {
        errors.push(`${path}: nieznany przekaźnik.`);
      }
    });
    return errors;
  }

  global.LUAMCU_STUDIO_CONTRACT = Object.freeze({
    VERSION: 1,
    CHANNELS,
    RELAYS,
    TYPES,
    COMPONENTS,
    componentDefinition,
    validateProject
  });
}(typeof window === 'undefined' ? globalThis : window));
