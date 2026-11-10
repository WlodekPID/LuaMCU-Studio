(function (global) {
  'use strict';

  const VERSION = '1.1.0';
  const STATES = Object.freeze(['OK', 'LO', 'HI', 'OFF']);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function targetElement(target) {
    const element = typeof target === 'string'
      ? global.document.querySelector(target)
      : target;
    if (!element || typeof element.replaceChildren !== 'function') {
      throw new TypeError('LUAMCU: target must be an existing DOM element or selector.');
    }
    return element;
  }

  function element(tag, className, text) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function svgElement(tag, attributes = {}) {
    const node = global.document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => {
      node.setAttribute(name, String(value));
    });
    return node;
  }

  function normalizedState(state) {
    const value = String(state || 'OFF').toUpperCase();
    if (!STATES.includes(value)) {
      throw new RangeError(`LUAMCU: unsupported state "${state}".`);
    }
    return value;
  }

  function finiteNumber(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new TypeError(`LUAMCU: ${name} must be a finite number.`);
    }
    return number;
  }

  class Component {
    constructor(target, className) {
      this.target = targetElement(target);
      this.target.replaceChildren();
      this.root = element('div', className);
      this.target.appendChild(this.root);
    }

    destroy() {
      this.target.replaceChildren();
    }
  }

  class AlarmLamp extends Component {
    constructor(target, options = {}) {
      super(target, 'luamcu-alarm');
      this.dot = element('span', 'luamcu-alarm__dot');
      this.label = element('span', 'luamcu-alarm__label');
      this.root.append(this.dot, this.label);
      this.setState(options.state || 'OFF', options.label);
    }

    setState(state, label) {
      this.state = normalizedState(state);
      this.root.dataset.state = this.state;
      this.root.setAttribute('role', 'status');
      this.root.setAttribute('aria-label', label || `Stan ${this.state}`);
      this.label.textContent = label || this.state;
      return this;
    }
  }

  class MeasurementValue extends Component {
    constructor(target, options = {}) {
      super(target, 'luamcu-measurement');
      this.options = {
        label: options.label || 'Pomiar',
        unit: options.unit || '',
        decimals: options.decimals === undefined ? 1 : Number(options.decimals),
        low: options.low === undefined ? -Infinity : Number(options.low),
        high: options.high === undefined ? Infinity : Number(options.high)
      };
      if (!Number.isInteger(this.options.decimals)
          || this.options.decimals < 0
          || this.options.decimals > 6) {
        throw new RangeError('LUAMCU: decimals must be an integer from 0 to 6.');
      }
      this.heading = element('div', 'luamcu-measurement__heading');
      this.name = element('span', 'luamcu-measurement__label', this.options.label);
      const lampTarget = element('span', 'luamcu-measurement__lamp');
      this.heading.append(this.name, lampTarget);
      this.reading = element('div', 'luamcu-measurement__reading');
      this.valueNode = element('span', 'luamcu-measurement__value', '----');
      this.unitNode = element('span', 'luamcu-measurement__unit', this.options.unit);
      this.reading.append(this.valueNode, this.unitNode);
      this.root.append(this.heading, this.reading);
      this.lamp = new AlarmLamp(lampTarget);
      this.update({
        value: options.value,
        valid: options.valid,
        enabled: options.enabled,
        state: options.state
      });
    }

    update(update = {}) {
      const enabled = update.enabled !== false;
      const value = Number(update.value);
      const valid = update.valid !== false && Number.isFinite(value);
      let state = update.state;
      if (!state) {
        if (!enabled || !valid) state = 'OFF';
        else if (value <= this.options.low) state = 'LO';
        else if (value >= this.options.high) state = 'HI';
        else state = 'OK';
      }
      this.state = normalizedState(state);
      this.value = valid ? value : null;
      this.valueNode.textContent = valid
        ? value.toFixed(this.options.decimals)
        : '----';
      this.root.dataset.state = this.state;
      this.root.classList.toggle('is-disabled', !enabled);
      this.lamp.setState(this.state);
      return this;
    }

    setValue(value, state) {
      return this.update({ value, state });
    }
  }

  class MultiChannelChart extends Component {
    constructor(target, options = {}) {
      super(target, 'luamcu-chart');
      this.maxPoints = options.maxPoints === undefined
        ? 120
        : Math.max(2, Math.floor(finiteNumber(options.maxPoints, 'maxPoints')));
      this.title = element('div', 'luamcu-chart__title', options.title || 'Wykres');
      this.legend = element('div', 'luamcu-chart__legend');
      this.svg = svgElement('svg', {
        viewBox: '0 0 800 320',
        role: 'img',
        'aria-label': options.title || 'Wykres wielokanałowy'
      });
      this.root.append(this.title, this.svg, this.legend);
      this.series = [];
      this.setSeries(options.series || []);
    }

    setSeries(series) {
      if (!Array.isArray(series)) {
        throw new TypeError('LUAMCU: series must be an array.');
      }
      this.series = series.map((item, index) => {
        if (!item || !Array.isArray(item.values)) {
          throw new TypeError('LUAMCU: every chart series needs a values array.');
        }
        return {
          id: String(item.id ?? index),
          label: String(item.label || `CH${index + 1}`),
          color: String(item.color || `var(--luamcu-series-${index + 1})`),
          values: item.values.map(value => Number(value)).filter(Number.isFinite)
            .slice(-this.maxPoints)
        };
      });
      this.render();
      return this;
    }

    append(values) {
      const entries = Array.isArray(values)
        ? values
        : this.series.map(series => values?.[series.id]);
      this.series.forEach((series, index) => {
        const value = Number(entries[index]);
        if (!Number.isFinite(value)) return;
        series.values.push(value);
        if (series.values.length > this.maxPoints) series.values.shift();
      });
      this.render();
      return this;
    }

    render() {
      this.svg.replaceChildren();
      this.legend.replaceChildren();
      const plot = { x: 54, y: 20, width: 724, height: 254 };
      const allValues = this.series.flatMap(series => series.values);
      let minimum = allValues.length ? Math.min(...allValues) : 0;
      let maximum = allValues.length ? Math.max(...allValues) : 1;
      if (minimum === maximum) {
        minimum -= 1;
        maximum += 1;
      }
      const padding = (maximum - minimum) * 0.08;
      minimum -= padding;
      maximum += padding;

      for (let index = 0; index <= 5; index += 1) {
        const y = plot.y + index * plot.height / 5;
        this.svg.appendChild(svgElement('line', {
          x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y,
          class: 'luamcu-chart__grid'
        }));
        const label = svgElement('text', {
          x: plot.x - 8, y: y + 4, 'text-anchor': 'end',
          class: 'luamcu-chart__axis'
        });
        label.textContent = (maximum - index * (maximum - minimum) / 5)
          .toFixed(1);
        this.svg.appendChild(label);
      }

      this.series.forEach(series => {
        const count = Math.max(2, series.values.length);
        const points = series.values.map((value, index) => {
          const x = plot.x + index * plot.width / (count - 1);
          const y = plot.y + (maximum - value) * plot.height / (maximum - minimum);
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
        this.svg.appendChild(svgElement('polyline', {
          points,
          fill: 'none',
          stroke: series.color,
          class: 'luamcu-chart__line'
        }));
        const item = element('span', 'luamcu-chart__legend-item', series.label);
        item.style.setProperty('--luamcu-series-color', series.color);
        this.legend.appendChild(item);
      });
      return this;
    }
  }

  class Slider extends Component {
    constructor(target, options = {}) {
      super(target, 'luamcu-slider');
      this.minimum = finiteNumber(options.minimum ?? 0, 'minimum');
      this.maximum = finiteNumber(options.maximum ?? 100, 'maximum');
      this.step = finiteNumber(options.step ?? 1, 'step');
      if (this.maximum <= this.minimum || this.step <= 0) {
        throw new RangeError(
          'LUAMCU: slider maximum must exceed minimum and step must be positive.'
        );
      }
      this.unit = String(options.unit || '');
      this.onChange = typeof options.onChange === 'function'
        ? options.onChange
        : null;
      this.heading = element('div', 'luamcu-slider__heading');
      this.label = element(
        'label',
        'luamcu-slider__label',
        options.label || 'Nastawa'
      );
      this.output = element('output', 'luamcu-slider__output');
      this.input = element('input', 'luamcu-slider__input');
      this.input.type = 'range';
      this.input.min = String(this.minimum);
      this.input.max = String(this.maximum);
      this.input.step = String(this.step);
      this.label.htmlFor = `luamcu-slider-${Slider.nextId += 1}`;
      this.input.id = this.label.htmlFor;
      this.heading.append(this.label, this.output);
      this.root.append(this.heading, this.input);
      this.input.addEventListener('input', () => {
        this.setValue(this.input.value, { notify: true });
      });
      this.setValue(options.value ?? this.minimum);
    }

    setValue(value, options = {}) {
      const number = Math.max(
        this.minimum,
        Math.min(this.maximum, finiteNumber(value, 'value'))
      );
      this.value = number;
      this.input.value = String(number);
      this.output.value = `${number.toLocaleString('pl-PL')} ${this.unit}`.trim();
      this.output.textContent = this.output.value;
      if (options.notify && this.onChange) this.onChange(number, this);
      return this;
    }
  }

  Slider.nextId = 0;

  class Relay extends Component {
    constructor(target, options = {}) {
      super(target, 'luamcu-relay');
      this.onToggle = typeof options.onToggle === 'function'
        ? options.onToggle
        : null;
      this.title = element('span', 'luamcu-relay__label', options.label || 'Przekaźnik');
      this.symbol = element('span', 'luamcu-relay__symbol');
      this.arm = element('span', 'luamcu-relay__arm');
      this.symbol.appendChild(this.arm);
      this.stateNode = element('span', 'luamcu-relay__state');
      this.button = element('button', 'luamcu-relay__button');
      this.button.type = 'button';
      this.button.append(this.symbol, this.title, this.stateNode);
      this.root.appendChild(this.button);
      this.button.addEventListener('click', () => this.toggle());
      this.setState(Boolean(options.on), { disabled: options.disabled });
    }

    setState(on, options = {}) {
      this.on = Boolean(on);
      this.disabled = Boolean(options.disabled);
      this.pending = Boolean(options.pending);
      this.root.classList.toggle('is-on', this.on);
      this.root.classList.toggle('is-pending', this.pending);
      this.root.classList.toggle('is-error', Boolean(options.error));
      this.button.disabled = this.disabled || this.pending;
      this.button.setAttribute('aria-pressed', String(this.on));
      this.stateNode.textContent = options.error
        ? String(options.error)
        : this.pending ? '...' : this.on ? 'WŁ' : 'WYŁ';
      return this;
    }

    async toggle() {
      if (this.disabled || this.pending) return this.on;
      const next = !this.on;
      if (!this.onToggle) {
        this.setState(next);
        return this.on;
      }
      this.setState(this.on, { pending: true });
      try {
        await this.onToggle(next, this);
        this.setState(next);
      } catch (error) {
        this.setState(this.on, { error: error?.message || String(error) });
        throw error;
      }
      return this.on;
    }
  }

  class SerialTransport extends EventTarget {
    constructor(options = {}) {
      super();
      this.baudRate = Number(options.baudRate || 115200);
      this.filters = options.filters || [{
        usbVendorId: 0xCAFE,
        usbProductId: 0x4002
      }];
      this.port = null;
      this.reader = null;
      this._writeQueue = Promise.resolve();
    }

    get connected() {
      return Boolean(this.port);
    }

    async connect(options = {}) {
      if (!global.navigator?.serial) {
        throw new Error('Web Serial is not supported by this browser.');
      }
      const accepted = options.forcePicker
        ? []
        : await global.navigator.serial.getPorts();
      this.port = accepted.find(port => {
        const info = port.getInfo();
        return this.filters.some(filter =>
          info.usbVendorId === filter.usbVendorId
          && info.usbProductId === filter.usbProductId
        );
      }) || await global.navigator.serial.requestPort({ filters: this.filters });
      await this.port.open({ baudRate: this.baudRate });
      this.dispatchEvent(new CustomEvent('connect'));
      this._readLoop().catch(error => {
        this.dispatchEvent(new CustomEvent('error', { detail: error }));
      });
      return this;
    }

    async _readLoop() {
      this.reader = this.port.readable.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
              const data = JSON.parse(trimmed);
              this.dispatchEvent(new CustomEvent('message', { detail: data }));
            } catch (error) {
              this.dispatchEvent(new CustomEvent('parseerror', {
                detail: { error, line: trimmed }
              }));
            }
          });
        }
      } finally {
        this.reader.releaseLock();
        this.reader = null;
      }
    }

    send(payload) {
      const write = async () => {
        if (!this.port?.writable) {
          throw new Error('LuaMCU serial port is not open.');
        }
        const writer = this.port.writable.getWriter();
        try {
          await writer.write(new TextEncoder().encode(
            `${JSON.stringify(payload)}\n`
          ));
        } finally {
          writer.releaseLock();
        }
      };
      const result = this._writeQueue.then(write, write);
      this._writeQueue = result.catch(() => {});
      return result;
    }

    async disconnect() {
      if (this.reader) await this.reader.cancel();
      if (this.port) await this.port.close();
      this.reader = null;
      this.port = null;
      this.dispatchEvent(new CustomEvent('disconnect'));
    }
  }

  global.LUAMCU = Object.freeze({
    VERSION,
    STATES,
    AlarmLamp,
    MeasurementValue,
    MultiChannelChart,
    Slider,
    Relay,
    SerialTransport,
    createAlarmLamp: (target, options) => new AlarmLamp(target, options),
    createMeasurement: (target, options) => new MeasurementValue(target, options),
    createChart: (target, options) => new MultiChannelChart(target, options),
    createSlider: (target, options) => new Slider(target, options),
    createRelay: (target, options) => new Relay(target, options)
  });
}(typeof window === 'undefined' ? globalThis : window));
