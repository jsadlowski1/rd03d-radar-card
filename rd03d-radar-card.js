const RD03D_RADAR_CARD_VERSION = "1.0.1";

class RD03DRadarCard extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error("Configuration is required.");

    this.config = {
      title: "RD-03D Radar",
      max_range: 30,
      update_interval: 250,
      show_sweep: true,
      show_trails: true,
      trail_length: 18,
      center_deadband: 0.15,
      targets: [],
      ...config,
    };

    if (!Array.isArray(this.config.targets) || this.config.targets.length === 0) {
      throw new Error("Define at least one target under targets:.");
    }

    this._trails = this._trails || {};
    this._lastTrailUpdate = 0;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
          }

          ha-card {
            overflow: hidden;
            background:
              radial-gradient(circle at 50% 100%, rgba(0, 255, 100, 0.10), transparent 52%),
              linear-gradient(180deg, rgba(2, 20, 13, 0.98), rgba(0, 8, 5, 0.98));
            color: #b8ffd1;
          }

          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px 8px;
            gap: 12px;
          }

          .title {
            font-size: 18px;
            font-weight: 600;
            letter-spacing: 0.03em;
          }

          .count {
            font-size: 14px;
            color: #70ffa4;
            white-space: nowrap;
          }

          .radar-wrap {
            position: relative;
            aspect-ratio: 1 / 0.72;
            min-height: 320px;
            max-height: 620px;
          }

          canvas {
            width: 100%;
            height: 100%;
            display: block;
          }

          .legend {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
            gap: 8px;
            padding: 8px 12px 14px;
          }

          .target-card {
            border: 1px solid rgba(100, 255, 155, 0.20);
            border-radius: 10px;
            padding: 9px 10px;
            background: rgba(0, 28, 16, 0.50);
            min-width: 0;
          }

          .target-card.inactive {
            opacity: 0.48;
          }

          .target-title {
            display: flex;
            align-items: center;
            gap: 7px;
            font-weight: 600;
            margin-bottom: 5px;
          }

          .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            flex: 0 0 auto;
          }

          .detail {
            font-size: 12px;
            line-height: 1.45;
            color: #a9d9ba;
            overflow-wrap: anywhere;
          }

          .error {
            color: var(--error-color, #ff5252);
            padding: 16px;
          }

          @media (max-width: 600px) {
            .radar-wrap {
              min-height: 285px;
              aspect-ratio: 1 / 0.88;
            }

            .legend {
              grid-template-columns: 1fr;
            }
          }
        </style>

        <ha-card>
          <div class="header">
            <div class="title"></div>
            <div class="count"></div>
          </div>
          <div class="radar-wrap">
            <canvas></canvas>
          </div>
          <div class="legend"></div>
        </ha-card>
      `;

      this._canvas = this.shadowRoot.querySelector("canvas");
      this._ctx = this._canvas.getContext("2d");
      this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
      this._resizeObserver.observe(this.shadowRoot.querySelector(".radar-wrap"));
      this._animationStart = performance.now();
      requestAnimationFrame(() => {
        this._resizeCanvas();
        this._animate();
      });
    }

    this.shadowRoot.querySelector(".title").textContent = this.config.title;
  }

  set hass(hass) {
    this._hass = hass;
    this._renderLegend();
    this._updateTrails();
  }

  getCardSize() {
    return 7;
  }

  connectedCallback() {
    // Home Assistant may detach and reattach cards when leaving the editor,
    // changing views, or rebuilding a dashboard. Restart everything here.
    if (this.shadowRoot) {
      const radarWrap = this.shadowRoot.querySelector(".radar-wrap");

      if (!this._resizeObserver && radarWrap) {
        this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
      }

      if (this._resizeObserver && radarWrap) {
        this._resizeObserver.observe(radarWrap);
      }

      requestAnimationFrame(() => {
        this._resizeCanvas();

        if (!this._animationFrame) {
          this._animationStart = performance.now();
          this._animate();
        }
      });
    }
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }

    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }
  }

  _num(entityId) {
    if (!entityId || !this._hass?.states?.[entityId]) return NaN;
    const value = Number(this._hass.states[entityId].state);
    return Number.isFinite(value) ? value : NaN;
  }

  _text(entityId) {
    if (!entityId || !this._hass?.states?.[entityId]) return "";
    return this._hass.states[entityId].state;
  }

  _bool(entityId) {
    if (!entityId) return null;
    const state = this._hass?.states?.[entityId]?.state;
    if (state === undefined) return null;
    return state === "on" || state === "true" || state === "home";
  }

  _targetState(target, index) {
    const x = this._num(target.x);
    const y = this._num(target.y);
    const distance = this._num(target.distance);
    const angle = this._num(target.angle);
    const speed = this._num(target.speed);
    const presence = this._bool(target.presence);

    const validCoordinates = Number.isFinite(x) && Number.isFinite(y);
    const active = presence === null ? validCoordinates : presence && validCoordinates;

    return {
      index,
      name: target.name || `Person ${index + 1}`,
      color: target.color || ["#00ff66", "#00d9ff", "#ffcf33"][index % 3],
      x,
      y,
      distance,
      angle,
      speed,
      movement: this._text(target.movement),
      direction: this._text(target.direction),
      active,
    };
  }

  _allTargets() {
    return this.config.targets.map((target, index) => this._targetState(target, index));
  }

  _updateTrails() {
    if (!this.config.show_trails || !this._hass) return;

    const now = Date.now();
    if (now - this._lastTrailUpdate < Number(this.config.update_interval || 250)) return;
    this._lastTrailUpdate = now;

    for (const target of this._allTargets()) {
      const key = String(target.index);
      if (!this._trails[key]) this._trails[key] = [];

      if (target.active) {
        const previous = this._trails[key][this._trails[key].length - 1];
        const moved =
          !previous ||
          Math.abs(previous.x - target.x) > 0.03 ||
          Math.abs(previous.y - target.y) > 0.03;

        if (moved) {
          this._trails[key].push({ x: target.x, y: target.y, time: now });
          const maxLength = Math.max(2, Number(this.config.trail_length || 18));
          if (this._trails[key].length > maxLength) {
            this._trails[key].splice(0, this._trails[key].length - maxLength);
          }
        }
      } else {
        this._trails[key] = [];
      }
    }
  }

  _renderLegend() {
    if (!this.shadowRoot || !this._hass) return;

    const targets = this._allTargets();
    const activeCount = targets.filter((target) => target.active).length;
    const configuredCount = this.config.people_count
      ? this._num(this.config.people_count)
      : activeCount;

    this.shadowRoot.querySelector(".count").textContent =
      `${Number.isFinite(configuredCount) ? Math.round(configuredCount) : activeCount} detected`;

    const legend = this.shadowRoot.querySelector(".legend");
    legend.innerHTML = "";

    for (const target of targets) {
      const box = document.createElement("div");
      box.className = `target-card${target.active ? "" : " inactive"}`;

      const distance = Number.isFinite(target.distance) ? `${target.distance.toFixed(2)} ft` : "—";
      const angle = Number.isFinite(target.angle) ? `${target.angle.toFixed(1)}°` : "—";
      const speed = Number.isFinite(target.speed) ? `${target.speed.toFixed(2)} ft/s` : "—";
      const xy =
        Number.isFinite(target.x) && Number.isFinite(target.y)
          ? `X ${target.x.toFixed(2)} ft · Y ${target.y.toFixed(2)} ft`
          : "Position unavailable";

      box.innerHTML = `
        <div class="target-title">
          <span class="dot" style="background:${target.color}; box-shadow:0 0 10px ${target.color};"></span>
          <span>${target.name}</span>
        </div>
        <div class="detail">
          ${target.active ? "Detected" : "Not detected"}<br>
          ${distance} · ${angle} · ${speed}<br>
          ${xy}
          ${target.direction ? `<br>${target.direction}` : ""}
          ${target.movement ? ` · ${target.movement}` : ""}
        </div>
      `;

      legend.appendChild(box);
    }
  }

  _resizeCanvas() {
    if (!this._canvas) return;
    const rect = this._canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
    }
  }

  _animate() {
    this._animationFrame = null;

    if (!this.isConnected) {
      return;
    }

    this._draw();
    this._animationFrame = requestAnimationFrame(() => this._animate());
  }

  _draw() {
    if (!this._ctx || !this._canvas) return;

    const ctx = this._ctx;
    const dpr = window.devicePixelRatio || 1;
    const width = this._canvas.width / dpr;
    const height = this._canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const margin = Math.max(26, Math.min(width, height) * 0.075);
    const originX = width / 2;
    const originY = height - margin;
    const maxRange = Math.max(1, Number(this.config.max_range || 30));
    const radius = Math.min(width / 2 - margin, height - margin * 1.3);
    const scale = radius / maxRange;

    this._drawGrid(ctx, originX, originY, radius, maxRange, scale);

    if (this.config.show_sweep) {
      this._drawSweep(ctx, originX, originY, radius);
    }

    const targets = this._hass ? this._allTargets() : [];
    this._drawTrails(ctx, originX, originY, scale, targets);
    this._drawTargets(ctx, originX, originY, scale, targets);
    this._drawRadarUnit(ctx, originX, originY);
  }

  _drawGrid(ctx, originX, originY, radius, maxRange, scale) {
    ctx.save();
    ctx.strokeStyle = "rgba(84,255,139,0.26)";
    ctx.fillStyle = "rgba(154,255,188,0.78)";
    ctx.lineWidth = 1;
    ctx.font = "11px sans-serif";

    const ringStep =
      maxRange <= 10 ? 2 :
      maxRange <= 25 ? 5 :
      maxRange <= 60 ? 10 : 20;

    for (let feet = ringStep; feet <= maxRange + 0.001; feet += ringStep) {
      const r = feet * scale;
      ctx.beginPath();
      ctx.arc(originX, originY, r, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${feet} ft`, originX + 6, originY - r + 13);
    }

    for (const degree of [-60, -45, -30, -15, 0, 15, 30, 45, 60]) {
      const rad = (degree - 90) * Math.PI / 180;
      const x = originX + Math.cos(rad) * radius;
      const y = originY + Math.sin(rad) * radius;

      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(x, y);
      ctx.stroke();

      const labelR = radius + 13;
      const lx = originX + Math.cos(rad) * labelR;
      const ly = originY + Math.sin(rad) * labelR;
      ctx.textAlign = "center";
      ctx.fillText(`${degree}°`, lx, ly);
    }

    ctx.beginPath();
    ctx.moveTo(originX - radius, originY);
    ctx.lineTo(originX + radius, originY);
    ctx.stroke();

    ctx.restore();
  }

  _drawSweep(ctx, originX, originY, radius) {
    const duration = Math.max(1500, Number(this.config.sweep_duration || 4200));
    const progress = ((performance.now() - this._animationStart) % duration) / duration;
    const angle = Math.PI + progress * Math.PI;

    ctx.save();

    const gradient = ctx.createRadialGradient(originX, originY, 0, originX, originY, radius);
    gradient.addColorStop(0, "rgba(0,255,100,0.24)");
    gradient.addColorStop(1, "rgba(0,255,100,0)");

    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.arc(originX, originY, radius, angle - 0.28, angle);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(originX + Math.cos(angle) * radius, originY + Math.sin(angle) * radius);
    ctx.strokeStyle = "rgba(80,255,130,0.88)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#00ff66";
    ctx.shadowBlur = 9;
    ctx.stroke();

    ctx.restore();
  }

  _drawTrails(ctx, originX, originY, scale, targets) {
    if (!this.config.show_trails) return;

    for (const target of targets) {
      const points = this._trails[String(target.index)] || [];
      if (points.length < 2) continue;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (let i = 1; i < points.length; i++) {
        const alpha = i / points.length;
        ctx.beginPath();
        ctx.moveTo(originX + points[i - 1].x * scale, originY - points[i - 1].y * scale);
        ctx.lineTo(originX + points[i].x * scale, originY - points[i].y * scale);
        ctx.strokeStyle = this._hexToRgba(target.color, alpha * 0.62);
        ctx.lineWidth = 1 + alpha * 2;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  _drawTargets(ctx, originX, originY, scale, targets) {
    for (const target of targets) {
      if (!target.active) continue;

      const px = originX + target.x * scale;
      const py = originY - target.y * scale;

      ctx.save();

      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fillStyle = this._hexToRgba(target.color, 0.13);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = target.color;
      ctx.shadowColor = target.color;
      ctx.shadowBlur = 16;
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#e4ffed";
      ctx.font = "600 12px sans-serif";
      ctx.textAlign = px > originX ? "right" : "left";
      const labelX = px > originX ? px - 11 : px + 11;
      ctx.fillText(target.name, labelX, py - 10);

      const distance = Number.isFinite(target.distance)
        ? `${target.distance.toFixed(1)} ft`
        : `${Math.hypot(target.x, target.y).toFixed(1)} ft`;
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#a9d9ba";
      ctx.fillText(distance, labelX, py + 5);

      ctx.restore();
    }
  }

  _drawRadarUnit(ctx, originX, originY) {
    ctx.save();
    ctx.fillStyle = "#7dffad";
    ctx.strokeStyle = "#c4ffda";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#00ff66";
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(originX, originY - 10);
    ctx.lineTo(originX - 9, originY + 7);
    ctx.lineTo(originX + 9, originY + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  _hexToRgba(color, alpha) {
    if (!color || !color.startsWith("#")) return color;
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split("").map((char) => char + char).join("");
    const value = parseInt(hex, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  static getStubConfig() {
    return {
      title: "RD-03D Radar",
      max_range: 30,
      show_sweep: true,
      show_trails: true,
      people_count: "sensor.radar2_people_detected",
      targets: [
        {
          name: "Person 1",
          presence: "binary_sensor.radar2_person_1_presence",
          x: "sensor.radar2_person_1_x_position",
          y: "sensor.radar2_person_1_y_position",
          distance: "sensor.radar2_person_1_distance",
          angle: "sensor.radar2_person_1_angle",
          speed: "sensor.radar2_person_1_speed",
          direction: "sensor.radar2_person_1_direction",
          movement: "sensor.radar2_person_1_movement",
        },
      ],
    };
  }
}

if (!customElements.get("rd03d-radar-card")) {
  customElements.define("rd03d-radar-card", RD03DRadarCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "rd03d-radar-card",
  name: "RD-03D Radar Card",
  description: "Live multi-target radar display for the Ai-Thinker RD-03D.",
  preview: true,
  documentationURL: "https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/",
});

console.info(
  "%c RD-03D RADAR CARD %c loaded",
  "color:#001b0e;background:#00ff66;font-weight:bold;padding:3px 6px;border-radius:3px 0 0 3px;",
  "color:#00ff66;background:#001b0e;padding:3px 6px;border-radius:0 3px 3px 0;"
);