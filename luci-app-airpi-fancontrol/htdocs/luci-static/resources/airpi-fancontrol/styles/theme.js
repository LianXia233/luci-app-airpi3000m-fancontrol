'use strict';

/*
 * airpi-fancontrol / styles.theme
 * 全局主题样式：现代 LuCI + Dashboard 风格。
 * 优先使用 LuCI 主题 CSS 变量，浅色/深色自适应；无变量环境使用兜底值。
 */

var CSS = `
/* ============ AirPi Fan Control · Theme ============ */
.afc-page {
  --afc-bg: var(--main-background, #f5f7fa);
  --afc-fg: var(--main-foreground, #1f2937);
  --afc-fg-sub: var(--text-muted, #6b7280);
  --afc-card-bg: var(--panel-background, #ffffff);
  --afc-border: var(--border-color, #e5e7eb);
  --afc-accent: #0284c7;
  --afc-accent-soft: rgba(2, 132, 199, 0.12);
  --afc-ok: #10b981;
  --afc-ok-soft: rgba(16, 185, 129, 0.12);
  --afc-warn: #f59e0b;
  --afc-warn-soft: rgba(245, 158, 11, 0.14);
  --afc-err: #ef4444;
  --afc-err-soft: rgba(239, 68, 68, 0.12);
  --afc-info: #6366f1;
  --afc-info-soft: rgba(99, 102, 241, 0.12);
  --afc-radius: 14px;
  --afc-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.04);
  margin: 0;
  padding: 4px 0 24px;
  font-family: var(--font-family-sans, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif);
  color: var(--afc-fg);
  box-sizing: border-box;
}
.afc-page *, .afc-page *:before, .afc-page *:after { box-sizing: border-box; }

/* ---- Header ---- */
.afc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.afc-header-title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.afc-header-logo {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--afc-accent), #4f46e5);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.afc-header-logo svg { width: 24px; height: 24px; }
.afc-header-h1 { font-size: 18px; font-weight: 700; line-height: 1.25; }
.afc-header-sub { font-size: 12px; color: var(--afc-fg-sub); margin-top: 2px; }

/* ---- Badge ---- */
.afc-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.afc-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.afc-badge-ok { background: var(--afc-ok-soft); color: var(--afc-ok); border-color: rgba(16,185,129,0.25); }
.afc-badge-warn { background: var(--afc-warn-soft); color: var(--afc-warn); border-color: rgba(245,158,11,0.3); }
.afc-badge-err { background: var(--afc-err-soft); color: var(--afc-err); border-color: rgba(239,68,68,0.25); }
.afc-badge-info { background: var(--afc-info-soft); color: var(--afc-info); border-color: rgba(99,102,241,0.25); }
.afc-badge-muted { background: rgba(107,114,128,0.1); color: var(--afc-fg-sub); }

/* ---- Cards & grid ---- */
.afc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 14px;
}
.afc-grid .afc-card--wide { grid-column: 1 / -1; }
.afc-card {
  background: var(--afc-card-bg);
  border: 1px solid var(--afc-border);
  border-radius: var(--afc-radius);
  box-shadow: var(--afc-shadow);
  padding: 16px 18px;
}
.afc-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.afc-card-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--afc-fg);
  display: flex;
  align-items: center;
  gap: 8px;
}
.afc-card-title svg { width: 16px; height: 16px; color: var(--afc-accent); }
.afc-card-sub { font-size: 11.5px; color: var(--afc-fg-sub); }

/* ---- KPI status row ---- */
.afc-kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}
.afc-kpi {
  background: var(--afc-card-bg);
  border: 1px solid var(--afc-border);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.afc-kpi-label { font-size: 11px; font-weight: 600; color: var(--afc-fg-sub); text-transform: uppercase; letter-spacing: 0.4px; }
.afc-kpi-value { font-size: 24px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
.afc-kpi-value small { font-size: 12px; font-weight: 600; color: var(--afc-fg-sub); }
.afc-kpi-unit { font-size: 12px; color: var(--afc-fg-sub); }

/* ---- Segmented control ---- */
.afc-segmented {
  display: inline-flex;
  background: rgba(107, 114, 128, 0.12);
  border-radius: 10px;
  padding: 3px;
  gap: 3px;
}
.afc-segmented button {
  border: none;
  background: transparent;
  color: var(--afc-fg-sub);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.afc-segmented button.active {
  background: var(--afc-card-bg);
  color: var(--afc-accent);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

/* ---- Buttons ---- */
.afc-btn {
  border: 1px solid var(--afc-border);
  background: var(--afc-card-bg);
  color: var(--afc-fg);
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
}
.afc-btn:hover { border-color: var(--afc-accent); color: var(--afc-accent); }
.afc-btn:active { transform: translateY(1px); }
.afc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.afc-btn--primary {
  background: var(--afc-accent);
  border-color: var(--afc-accent);
  color: #fff;
}
.afc-btn--primary:hover { background: #0369a1; color: #fff; }
.afc-btn--ghost { background: transparent; }
.afc-btn--danger { color: var(--afc-err); }
.afc-btn--danger:hover { border-color: var(--afc-err); color: var(--afc-err); }

/* ---- Speed modes ---- */
.afc-modes {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.afc-mode {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 6px;
  border: 1px solid var(--afc-border);
  border-radius: 10px;
  background: var(--afc-card-bg);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.afc-mode:hover { border-color: var(--afc-accent); }
.afc-mode.active {
  border-color: var(--afc-accent);
  background: var(--afc-accent-soft);
}
.afc-mode svg { width: 20px; height: 20px; color: var(--afc-fg-sub); }
.afc-mode.active svg { color: var(--afc-accent); }
.afc-mode-name { font-size: 12px; font-weight: 700; }
.afc-mode-meta { font-size: 10.5px; color: var(--afc-fg-sub); }

/* ---- Slider ---- */
.afc-slider-wrap { padding: 4px 2px 2px; }
.afc-slider-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--afc-fg-sub);
  margin-bottom: 8px;
}
.afc-slider {
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 99px;
  background: rgba(107, 114, 128, 0.25);
  outline: none;
  cursor: pointer;
}
.afc-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--afc-accent);
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}
.afc-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--afc-accent);
}

/* ---- Sensor grid ---- */
.afc-sensors {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.afc-sensor {
  border: 1px solid var(--afc-border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--afc-card-bg);
}
.afc-sensor.hot { border-color: var(--afc-err); }
.afc-sensor.warm { border-color: var(--afc-warn); }
.afc-sensor-name {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--afc-fg-sub);
}
.afc-sensor-val { font-size: 20px; font-weight: 800; margin-top: 4px; font-variant-numeric: tabular-nums; }
.afc-sensor-val small { font-size: 11px; font-weight: 600; color: var(--afc-fg-sub); }
.afc-sensor-bar {
  height: 4px;
  border-radius: 99px;
  background: rgba(107, 114, 128, 0.15);
  margin-top: 8px;
  overflow: hidden;
}
.afc-sensor-fill { height: 100%; border-radius: 99px; transition: width 0.5s ease; }

/* ---- Curve chart ---- */
.afc-curve svg { width: 100%; height: auto; display: block; }

/* ---- Config form ---- */
.afc-form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--afc-border);
  flex-wrap: wrap;
}
.afc-form-row:last-child { border-bottom: none; }
.afc-form-label { font-size: 13px; font-weight: 600; }
.afc-form-desc { font-size: 11.5px; color: var(--afc-fg-sub); margin-top: 2px; }
.afc-form-control { min-width: 180px; }
.afc-input, .afc-select {
  width: 100%;
  border: 1px solid var(--afc-border);
  background: var(--afc-card-bg);
  color: var(--afc-fg);
  border-radius: 9px;
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}
.afc-input:focus, .afc-select:focus { border-color: var(--afc-accent); }

/* ---- Status / notice ---- */
.afc-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  padding: 9px 12px;
  border-radius: 10px;
  margin-bottom: 10px;
}
.afc-notice--loading { background: var(--afc-info-soft); color: var(--afc-info); }
.afc-notice--error { background: var(--afc-err-soft); color: var(--afc-err); }
.afc-notice--warn { background: var(--afc-warn-soft); color: var(--afc-warn); }
.afc-notice--ok { background: var(--afc-ok-soft); color: var(--afc-ok); }
.afc-spinner {
  width: 14px; height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: afc-spin 0.8s linear infinite;
}
@keyframes afc-spin { to { transform: rotate(360deg); } }

/* ---- Service actions ---- */
.afc-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* ---- Fan visual ---- */
.afc-fan {
  display: flex;
  align-items: center;
  gap: 14px;
}
.afc-fan-icon {
  width: 64px; height: 64px;
  border-radius: 50%;
  background: var(--afc-accent-soft);
  color: var(--afc-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.afc-fan-icon svg { width: 38px; height: 38px; }
.afc-fan-icon.running { animation: afc-fan-spin 1.2s linear infinite; }
@keyframes afc-fan-spin { to { transform: rotate(360deg); } }

/* ---- Responsive ---- */
@media (max-width: 720px) {
  .afc-kpi-row { grid-template-columns: repeat(2, 1fr); }
  .afc-modes { grid-template-columns: repeat(2, 1fr); }
  .afc-form-row { flex-direction: column; align-items: stretch; }
  .afc-form-control { min-width: 0; }
}
@media (max-width: 480px) {
  .afc-header-h1 { font-size: 16px; }
  .afc-kpi-value { font-size: 20px; }
}
`;

return { CSS: CSS };
