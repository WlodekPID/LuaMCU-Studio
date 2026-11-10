'use strict';

const contract = window.LUAMCU_STUDIO_CONTRACT;
const palette = document.getElementById('componentPalette');
const canvas = document.getElementById('studioCanvas');
const canvasSizer = document.getElementById('canvasSizer');
const viewport = document.getElementById('canvasViewport');
const propertiesContent = document.getElementById('propertiesContent');
const projectName = document.getElementById('projectName');
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const duplicateButton = document.getElementById('duplicateButton');
const deleteButton = document.getElementById('deleteButton');
const simulationButton = document.getElementById('simulationButton');
const zoomSelect = document.getElementById('zoomSelect');
const projectFile = document.getElementById('projectFile');
const studioStatus = document.getElementById('studioStatus');
const validationStatus = document.getElementById('validationStatus');

const clone = value => JSON.parse(JSON.stringify(value));
const initialProject = {
  version: 1,
  name: 'Moja wizualizacja',
  canvas: {
    width: 1280,
    height: 720,
    grid: 10,
    background: '#f2f5f8'
  },
  components: [
    {
      id: 'temperature-main',
      type: 'measurement',
      x: 50,
      y: 70,
      width: 280,
      height: 170,
      z: 1,
      props: {
        label: 'Temperatura produktu',
        channel: 'CH1',
        unit: '°C',
        decimals: 1,
        low: 10,
        high: 80
      }
    },
    {
      id: 'process-chart',
      type: 'chart',
      x: 370,
      y: 70,
      width: 560,
      height: 320,
      z: 2,
      props: {
        label: 'Przebieg procesu',
        channels: ['CH1', 'CH2'],
        maxPoints: 60
      }
    },
    {
      id: 'relay-r1',
      type: 'relay',
      x: 50,
      y: 290,
      width: 290,
      height: 100,
      z: 3,
      props: {
        label: 'Grzałka R1',
        relay: 'R1'
      }
    }
  ]
};

let project = clone(initialProject);
let selectedId = null;
let zoom = Number(zoomSelect.value);
let interactionActive = false;
let simulationTimer = null;
let simulationTime = 0;
let history = [JSON.stringify(project)];
let historyIndex = 0;

const runtime = {
  channels: Object.fromEntries(contract.CHANNELS.map((channel, index) => [
    channel,
    22 + index * 4
  ])),
  histories: Object.fromEntries(contract.CHANNELS.map((channel, index) => [
    channel,
    Array.from({ length: 25 }, (_, sample) =>
      20 + index * 4 + Math.sin(sample / 4 + index) * (4 + index / 2)
    )
  ])),
  relays: Object.fromEntries(contract.RELAYS.map(relay => [relay, false]))
};

function setStatus(message) {
  studioStatus.textContent = message;
}

function definition(type) {
  return contract.componentDefinition(type);
}

function selectedComponent() {
  return project.components.find(component => component.id === selectedId) || null;
}

function snap(value) {
  const grid = Math.max(1, Number(project.canvas.grid) || 1);
  return Math.round(Number(value) / grid) * grid;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function nextId(type) {
  const prefix = type.replace(
    /[A-Z]/g,
    character => `-${character.toLowerCase()}`
  );
  let suffix = 1;
  while (project.components.some(
    component => component.id === `${prefix}-${suffix}`
  )) {
    suffix += 1;
  }
  return `${prefix}-${suffix}`;
}

function commit(message) {
  const serialized = JSON.stringify(project);
  if (history[historyIndex] === serialized) return;
  history = history.slice(0, historyIndex + 1);
  history.push(serialized);
  if (history.length > 50) history.shift();
  historyIndex = history.length - 1;
  updateToolbar();
  validate();
  if (message) setStatus(message);
}

function restoreHistory(index) {
  if (index < 0 || index >= history.length) return;
  historyIndex = index;
  project = JSON.parse(history[historyIndex]);
  projectName.value = project.name;
  if (!project.components.some(component => component.id === selectedId)) {
    selectedId = null;
  }
  render();
  setStatus(historyIndex === 0 ? 'Przywrócono początek projektu.' : 'Przywrócono zmianę.');
}

function validate() {
  const errors = contract.validateProject(project);
  validationStatus.textContent = errors.length === 0
    ? `Projekt poprawny • ${project.components.length} elementów`
    : `${errors.length} błędów • ${errors[0]}`;
  validationStatus.classList.toggle('is-error', errors.length > 0);
  return errors;
}

function updateToolbar() {
  undoButton.disabled = historyIndex <= 0;
  redoButton.disabled = historyIndex >= history.length - 1;
  const hasSelection = Boolean(selectedComponent());
  duplicateButton.disabled = !hasSelection;
  deleteButton.disabled = !hasSelection;
}

function updateCanvasGeometry() {
  const { width, height, grid, background } = project.canvas;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.transform = `scale(${zoom})`;
  canvas.style.backgroundColor = background;
  canvas.style.backgroundSize = `${grid}px ${grid}px`;
  canvasSizer.style.width = `${width * zoom}px`;
  canvasSizer.style.height = `${height * zoom}px`;
  document.getElementById('canvasSizeLabel').textContent = `${width} × ${height}`;
  document.getElementById('gridSizeLabel').textContent = `${grid} px`;
}

function stateForValue(value, low = 20, high = 80) {
  if (!Number.isFinite(value)) return 'OFF';
  if (value <= Number(low)) return 'LO';
  if (value >= Number(high)) return 'HI';
  return 'OK';
}

function renderComponentContent(component, target) {
  const props = component.props;
  if (component.type === 'measurement') {
    return LUAMCU.createMeasurement(target, {
      label: props.label,
      unit: props.unit,
      value: runtime.channels[props.channel],
      decimals: Number(props.decimals),
      low: Number(props.low),
      high: Number(props.high)
    });
  }
  if (component.type === 'alarmLamp') {
    const value = runtime.channels[props.channel];
    return LUAMCU.createAlarmLamp(target, {
      label: props.label,
      state: stateForValue(value, 20, 80)
    });
  }
  if (component.type === 'chart') {
    return LUAMCU.createChart(target, {
      title: props.label,
      maxPoints: Number(props.maxPoints),
      series: (props.channels || []).map((channel, index) => ({
        id: channel,
        label: channel,
        color: `var(--luamcu-series-${index + 1})`,
        values: runtime.histories[channel] || []
      }))
    });
  }
  if (component.type === 'relay') {
    return LUAMCU.createRelay(target, {
      label: props.label,
      on: runtime.relays[props.relay],
      onToggle: next => {
        runtime.relays[props.relay] = next;
        setStatus(`${props.relay}: ${next ? 'WŁ' : 'WYŁ'} (symulacja).`);
      }
    });
  }
  if (component.type === 'slider') {
    return LUAMCU.createSlider(target, {
      label: props.label,
      unit: props.unit,
      minimum: Number(props.minimum),
      maximum: Number(props.maximum),
      step: Number(props.step),
      value: Number(props.value),
      onChange: value => {
        props.value = value;
        const valueField = propertiesContent.querySelector('[data-property="value"]');
        if (valueField) valueField.value = String(value);
        setStatus(`${props.label}: ${value} ${props.unit || ''}`.trim());
      }
    });
  }
  if (component.type === 'text') {
    const text = document.createElement('div');
    text.className = 'studio-text';
    text.textContent = props.text;
    text.style.fontSize = `${Number(props.fontSize)}px`;
    text.style.justifyContent = {
      left: 'flex-start',
      center: 'center',
      right: 'flex-end'
    }[props.align] || 'flex-start';
    text.style.textAlign = props.align || 'left';
    target.appendChild(text);
    return null;
  }
  if (component.type === 'button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'studio-button';
    button.textContent = props.label;
    button.addEventListener('click', event => {
      event.stopPropagation();
      setStatus(`Przycisk „${props.label}” — akcja nie jest jeszcze przypisana.`);
    });
    target.appendChild(button);
  }
  return null;
}

function select(id) {
  selectedId = id;
  canvas.querySelectorAll('.studio-component').forEach(element => {
    element.classList.toggle('selected', element.dataset.id === id);
  });
  renderProperties();
  updateToolbar();
}

function beginMove(event, element, component) {
  if (event.button !== 0
      || event.target.closest('input, button, select, .studio-resize-handle')) {
    return;
  }
  event.preventDefault();
  select(component.id);
  interactionActive = true;
  const start = {
    clientX: event.clientX,
    clientY: event.clientY,
    x: component.x,
    y: component.y
  };
  const move = moveEvent => {
    const nextX = snap(start.x + (moveEvent.clientX - start.clientX) / zoom);
    const nextY = snap(start.y + (moveEvent.clientY - start.clientY) / zoom);
    component.x = clamp(nextX, 0, project.canvas.width - component.width);
    component.y = clamp(nextY, 0, project.canvas.height - component.height);
    element.style.left = `${component.x}px`;
    element.style.top = `${component.y}px`;
  };
  const finish = () => {
    interactionActive = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    commit(`Przesunięto ${component.id}.`);
    renderProperties();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish, { once: true });
}

function beginResize(event, element, component) {
  event.preventDefault();
  event.stopPropagation();
  select(component.id);
  interactionActive = true;
  const componentDefinition = definition(component.type);
  const start = {
    clientX: event.clientX,
    clientY: event.clientY,
    width: component.width,
    height: component.height
  };
  const move = moveEvent => {
    const proposedWidth = snap(
      start.width + (moveEvent.clientX - start.clientX) / zoom
    );
    const proposedHeight = snap(
      start.height + (moveEvent.clientY - start.clientY) / zoom
    );
    component.width = clamp(
      proposedWidth,
      componentDefinition.minimumSize.width,
      project.canvas.width - component.x
    );
    component.height = clamp(
      proposedHeight,
      componentDefinition.minimumSize.height,
      project.canvas.height - component.y
    );
    element.style.width = `${component.width}px`;
    element.style.height = `${component.height}px`;
  };
  const finish = () => {
    interactionActive = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    commit(`Zmieniono rozmiar ${component.id}.`);
    render();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish, { once: true });
}

function renderCanvas() {
  canvas.replaceChildren();
  project.components
    .slice()
    .sort((left, right) => left.z - right.z)
    .forEach(component => {
      const wrapper = document.createElement('div');
      wrapper.className = 'studio-component';
      wrapper.dataset.id = component.id;
      wrapper.style.left = `${component.x}px`;
      wrapper.style.top = `${component.y}px`;
      wrapper.style.width = `${component.width}px`;
      wrapper.style.height = `${component.height}px`;
      wrapper.style.zIndex = String(component.z);
      wrapper.classList.toggle('selected', component.id === selectedId);

      const content = document.createElement('div');
      content.className = 'studio-component__content';
      renderComponentContent(component, content);

      const tag = document.createElement('span');
      tag.className = 'studio-component__tag';
      tag.textContent = component.id;
      const resize = document.createElement('span');
      resize.className = 'studio-resize-handle';
      resize.setAttribute('aria-label', 'Zmień rozmiar');

      wrapper.append(content, tag, resize);
      wrapper.addEventListener('pointerdown', event => {
        select(component.id);
        beginMove(event, wrapper, component);
      });
      resize.addEventListener('pointerdown', event => {
        beginResize(event, wrapper, component);
      });
      canvas.appendChild(wrapper);
    });
}

function render() {
  updateCanvasGeometry();
  renderCanvas();
  renderProperties();
  updateToolbar();
  validate();
}

function addComponent(type, position = null) {
  const componentDefinition = definition(type);
  if (!componentDefinition) throw new Error(`Nieznany komponent: ${type}`);
  const width = componentDefinition.defaultSize.width;
  const height = componentDefinition.defaultSize.height;
  const x = snap(position?.x ?? (project.canvas.width - width) / 2);
  const y = snap(position?.y ?? (project.canvas.height - height) / 2);
  const component = {
    id: nextId(type),
    type,
    x: clamp(x, 0, project.canvas.width - width),
    y: clamp(y, 0, project.canvas.height - height),
    width,
    height,
    z: Math.max(0, ...project.components.map(item => item.z)) + 1,
    props: clone(componentDefinition.defaults)
  };
  project.components.push(component);
  selectedId = component.id;
  commit(`Dodano ${componentDefinition.label}.`);
  render();
  return component;
}

function deleteSelected() {
  const component = selectedComponent();
  if (!component) return;
  project.components = project.components.filter(item => item.id !== component.id);
  selectedId = null;
  commit(`Usunięto ${component.id}.`);
  render();
}

function duplicateSelected() {
  const source = selectedComponent();
  if (!source) return;
  const copy = clone(source);
  copy.id = nextId(source.type);
  copy.x = clamp(snap(source.x + 30), 0, project.canvas.width - source.width);
  copy.y = clamp(snap(source.y + 30), 0, project.canvas.height - source.height);
  copy.z = Math.max(0, ...project.components.map(item => item.z)) + 1;
  project.components.push(copy);
  selectedId = copy.id;
  commit(`Utworzono kopię ${source.id}.`);
  render();
}

function createSection(title) {
  const section = document.createElement('section');
  section.className = 'property-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'property-grid';
  section.append(heading, grid);
  propertiesContent.appendChild(section);
  return grid;
}

function createField(grid, options) {
  const label = document.createElement('label');
  label.className = `property-field${options.wide ? ' wide' : ''}`;
  const caption = document.createElement('span');
  caption.textContent = options.label;
  let control;
  if (options.options) {
    control = document.createElement('select');
    options.options.forEach(option => {
      const element = document.createElement('option');
      element.value = typeof option === 'string' ? option : option.value;
      element.textContent = typeof option === 'string' ? option : option.label;
      control.appendChild(element);
    });
  } else {
    control = document.createElement('input');
    control.type = options.type || 'text';
    if (options.min !== undefined) control.min = String(options.min);
    if (options.max !== undefined) control.max = String(options.max);
    if (options.step !== undefined) control.step = String(options.step);
  }
  control.value = String(options.value ?? '');
  if (options.property) control.dataset.property = options.property;
  control.disabled = Boolean(options.disabled);
  control.addEventListener('change', () => options.change(
    options.type === 'number' ? Number(control.value) : control.value
  ));
  label.append(caption, control);
  grid.appendChild(label);
  return control;
}

function updateCommon(component, key, value) {
  const componentDefinition = definition(component.type);
  if (key === 'x') {
    component.x = clamp(snap(value), 0, project.canvas.width - component.width);
  } else if (key === 'y') {
    component.y = clamp(snap(value), 0, project.canvas.height - component.height);
  } else if (key === 'width') {
    component.width = clamp(
      snap(value),
      componentDefinition.minimumSize.width,
      project.canvas.width - component.x
    );
  } else if (key === 'height') {
    component.height = clamp(
      snap(value),
      componentDefinition.minimumSize.height,
      project.canvas.height - component.y
    );
  }
  commit(`Zmieniono ${key} komponentu ${component.id}.`);
  render();
}

function updateProp(component, key, value) {
  component.props[key] = value;
  commit(`Zmieniono ${key} komponentu ${component.id}.`);
  render();
}

function renderProjectProperties() {
  const empty = document.createElement('p');
  empty.className = 'empty-properties';
  empty.textContent =
    'Nie wybrano elementu. Tutaj można ustawić rozmiar i siatkę całego projektu.';
  propertiesContent.appendChild(empty);
  const grid = createSection('Projekt');
  createField(grid, {
    label: 'Szerokość', type: 'number', value: project.canvas.width,
    min: 640, max: 3840,
    change: value => {
      project.canvas.width = Math.round(value);
      project.components.forEach(component => {
        component.x = clamp(component.x, 0, project.canvas.width - component.width);
      });
      commit('Zmieniono szerokość płótna.');
      render();
    }
  });
  createField(grid, {
    label: 'Wysokość', type: 'number', value: project.canvas.height,
    min: 360, max: 2160,
    change: value => {
      project.canvas.height = Math.round(value);
      project.components.forEach(component => {
        component.y = clamp(component.y, 0, project.canvas.height - component.height);
      });
      commit('Zmieniono wysokość płótna.');
      render();
    }
  });
  createField(grid, {
    label: 'Siatka', type: 'number', value: project.canvas.grid,
    min: 1, max: 100,
    change: value => {
      project.canvas.grid = Math.round(value);
      commit('Zmieniono siatkę.');
      render();
    }
  });
  createField(grid, {
    label: 'Kolor tła', type: 'color', value: project.canvas.background,
    change: value => {
      project.canvas.background = value;
      commit('Zmieniono tło.');
      render();
    }
  });
}

function renderChannelChecks(grid, component) {
  const field = document.createElement('div');
  field.className = 'property-field wide';
  const caption = document.createElement('span');
  caption.textContent = 'Kanały wykresu';
  const checks = document.createElement('div');
  checks.className = 'channel-checks';
  contract.CHANNELS.forEach(channel => {
    const label = document.createElement('label');
    label.className = 'channel-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = component.props.channels.includes(channel);
    input.addEventListener('change', () => {
      const selected = contract.CHANNELS.filter(item => {
        const checkbox = checks.querySelector(`[value="${item}"]`);
        return checkbox?.checked;
      });
      if (selected.length === 0) {
        input.checked = true;
        setStatus('Wykres musi zawierać co najmniej jeden kanał.');
        return;
      }
      updateProp(component, 'channels', selected);
    });
    input.value = channel;
    label.append(input, channel);
    checks.appendChild(label);
  });
  field.append(caption, checks);
  grid.appendChild(field);
}

function renderComponentProperties(component) {
  const componentDefinition = definition(component.type);
  const description = document.createElement('p');
  description.className = 'empty-properties';
  description.textContent = `${componentDefinition.label} • ${component.id}`;
  propertiesContent.appendChild(description);

  const layout = createSection('Położenie i rozmiar');
  for (const [key, label] of Object.entries({
    x: 'X', y: 'Y', width: 'Szerokość', height: 'Wysokość'
  })) {
    createField(layout, {
      label, type: 'number', value: component[key],
      change: value => updateCommon(component, key, value)
    });
  }

  const props = createSection('Ustawienia');
  const textField = (key, label, wide = true) => createField(props, {
    label, value: component.props[key], wide,
    property: key,
    change: value => updateProp(component, key, value)
  });
  const numberField = (key, label, options = {}) => createField(props, {
    label, type: 'number', value: component.props[key],
    min: options.min, max: options.max, step: options.step,
    property: key,
    change: value => updateProp(component, key, value)
  });
  const selectField = (key, label, options) => createField(props, {
    label, options, value: component.props[key],
    property: key,
    change: value => updateProp(component, key, value)
  });

  if (['measurement', 'alarmLamp', 'relay', 'slider', 'button', 'chart']
    .includes(component.type)) {
    textField('label', 'Nazwa');
  }
  if (['measurement', 'alarmLamp', 'slider'].includes(component.type)) {
    selectField('channel', 'Kanał', contract.CHANNELS);
  }
  if (component.type === 'measurement') {
    textField('unit', 'Jednostka', false);
    numberField('decimals', 'Miejsca', { min: 0, max: 6, step: 1 });
    numberField('low', 'Alarm Lo', { step: .1 });
    numberField('high', 'Alarm Hi', { step: .1 });
  } else if (component.type === 'chart') {
    renderChannelChecks(props, component);
    numberField('maxPoints', 'Liczba próbek', { min: 2, max: 1000, step: 1 });
  } else if (component.type === 'relay') {
    selectField('relay', 'Wyjście', contract.RELAYS);
  } else if (component.type === 'slider') {
    textField('unit', 'Jednostka', false);
    numberField('minimum', 'Minimum', { step: .1 });
    numberField('maximum', 'Maksimum', { step: .1 });
    numberField('step', 'Krok', { min: .001, step: .1 });
    numberField('value', 'Wartość', { step: Number(component.props.step) });
  } else if (component.type === 'text') {
    textField('text', 'Treść');
    numberField('fontSize', 'Rozmiar tekstu', { min: 8, max: 160, step: 1 });
    selectField('align', 'Wyrównanie', [
      { value: 'left', label: 'Do lewej' },
      { value: 'center', label: 'Środek' },
      { value: 'right', label: 'Do prawej' }
    ]);
  } else if (component.type === 'button') {
    selectField('action', 'Akcja', [
      { value: 'none', label: 'Brak — prototyp' }
    ]);
  }
}

function renderProperties() {
  propertiesContent.replaceChildren();
  const component = selectedComponent();
  if (component) renderComponentProperties(component);
  else renderProjectProperties();
}

function renderPalette() {
  palette.replaceChildren();
  contract.COMPONENTS.forEach(component => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.draggable = true;
    item.tabIndex = 0;
    item.dataset.type = component.type;
    const icon = document.createElement('span');
    icon.className = 'palette-icon';
    icon.textContent = component.icon;
    const label = document.createElement('span');
    label.className = 'palette-label';
    label.textContent = component.label;
    item.append(icon, label);
    item.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/luamcu-component', component.type);
      event.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('click', () => addComponent(component.type));
    item.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        addComponent(component.type);
      }
    });
    palette.appendChild(item);
  });
}

function simulationTick() {
  simulationTime += 1;
  contract.CHANNELS.forEach((channel, index) => {
    const value = 45
      + Math.sin(simulationTime / (5 + index) + index) * (20 + index)
      + index * 2;
    runtime.channels[channel] = value;
    runtime.histories[channel].push(value);
    if (runtime.histories[channel].length > 120) {
      runtime.histories[channel].shift();
    }
  });
  if (!interactionActive) renderCanvas();
}

function toggleSimulation() {
  if (simulationTimer !== null) {
    clearInterval(simulationTimer);
    simulationTimer = null;
    simulationButton.textContent = 'Uruchom symulację';
    simulationButton.classList.remove('is-active');
    setStatus('Symulacja zatrzymana.');
    return;
  }
  simulationTimer = setInterval(simulationTick, 1000);
  simulationButton.textContent = 'Zatrzymaj symulację';
  simulationButton.classList.add('is-active');
  simulationTick();
  setStatus('Symulacja działa.');
}

function exportProject() {
  const errors = validate();
  if (errors.length > 0) {
    setStatus(`Nie można zapisać: ${errors[0]}`);
    return;
  }
  const blob = new Blob(
    [JSON.stringify(project, null, 2)],
    { type: 'application/json' }
  );
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${project.name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'visual'}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  setStatus('Zapisano projekt JSON.');
}

async function importProject(file) {
  const imported = JSON.parse(await file.text());
  const errors = contract.validateProject(imported);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }
  project = clone(imported);
  projectName.value = project.name;
  selectedId = null;
  history = [JSON.stringify(project)];
  historyIndex = 0;
  render();
  setStatus(`Otwarto projekt „${project.name}”.`);
}

canvas.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('text/luamcu-component')) return;
  event.preventDefault();
  canvas.classList.add('is-drop-target');
  event.dataTransfer.dropEffect = 'copy';
});
canvas.addEventListener('dragleave', () => {
  canvas.classList.remove('is-drop-target');
});
canvas.addEventListener('drop', event => {
  event.preventDefault();
  canvas.classList.remove('is-drop-target');
  const type = event.dataTransfer.getData('text/luamcu-component');
  const rectangle = canvas.getBoundingClientRect();
  const componentDefinition = definition(type);
  if (!componentDefinition) return;
  addComponent(type, {
    x: (event.clientX - rectangle.left) / zoom
      - componentDefinition.defaultSize.width / 2,
    y: (event.clientY - rectangle.top) / zoom
      - componentDefinition.defaultSize.height / 2
  });
});
canvas.addEventListener('pointerdown', event => {
  if (event.target === canvas) select(null);
});

undoButton.addEventListener('click', () => restoreHistory(historyIndex - 1));
redoButton.addEventListener('click', () => restoreHistory(historyIndex + 1));
duplicateButton.addEventListener('click', duplicateSelected);
deleteButton.addEventListener('click', deleteSelected);
simulationButton.addEventListener('click', toggleSimulation);
document.getElementById('saveButton').addEventListener('click', exportProject);
document.getElementById('openButton').addEventListener('click', () => projectFile.click());
projectFile.addEventListener('change', () => {
  const file = projectFile.files[0];
  if (!file) return;
  importProject(file).catch(error => {
    setStatus(`Błąd projektu: ${error.message}`);
  }).finally(() => {
    projectFile.value = '';
  });
});
projectName.addEventListener('change', () => {
  const name = projectName.value.trim();
  if (!name) {
    projectName.value = project.name;
    return;
  }
  project.name = name;
  commit('Zmieniono nazwę projektu.');
});
zoomSelect.addEventListener('change', () => {
  zoom = Number(zoomSelect.value);
  updateCanvasGeometry();
  setStatus(`Powiększenie ${Math.round(zoom * 100)}%.`);
});

window.addEventListener('keydown', event => {
  const editing = event.target.matches('input, select, textarea');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    restoreHistory(event.shiftKey ? historyIndex + 1 : historyIndex - 1);
  } else if ((event.ctrlKey || event.metaKey)
      && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    restoreHistory(historyIndex + 1);
  } else if (!editing && event.key === 'Delete') {
    event.preventDefault();
    deleteSelected();
  } else if (!editing && (event.ctrlKey || event.metaKey)
      && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSelected();
  }
});

window.LUAMCU_STUDIO = Object.freeze({
  getProject: () => clone(project),
  validate: () => contract.validateProject(project),
  addComponent,
  select,
  startSimulation: () => {
    if (simulationTimer === null) toggleSimulation();
  },
  stopSimulation: () => {
    if (simulationTimer !== null) toggleSimulation();
  }
});

renderPalette();
render();
