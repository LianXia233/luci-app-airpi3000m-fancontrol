'use strict';
'require view';
'require fs';
'require ui';
'require poll';
'require form';
'require uci';
'require dom';

/*
 * luci-app-airpi-fancontrol - Pure Glacier Glass (v12.0.0 Merged Cockpit)
 * 7-Blade Ceramic Impeller: rotor speed & airflow ripples driven by real duty.
 */

var CTL = '/usr/bin/airpi-fanctl.sh';

function ctl(args) {
	return fs.exec(CTL, args);
}

function parseKV(s) {
	var o = {};
	String(s || '').split('\n').forEach(function(l) {
		var i = l.indexOf('=');
		if (i > 0)
			o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
	});
	return o;
}

var CSS = `
:root {
  --gf-blue: #0284c7;
  --gf-blue-light: #e0f2fe;
  --gf-blue-glow: rgba(2, 132, 199, 0.22);
  
  --gf-bg-glass: rgba(255, 255, 255, 0.76);
  --gf-bg-inner: rgba(248, 250, 252, 0.7);
  --gf-border: rgba(255, 255, 255, 0.95);
  --gf-border-subtle: rgba(226, 232, 240, 0.85);
  
  --gf-text-head: #0f172a;
  --gf-text-sub: #475569;
  --gf-text-dim: #94a3b8;
  --gf-shadow: 0 12px 32px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(15, 23, 42, 0.03);
  --gf-inner-light: inset 0 1px 2px rgba(255, 255, 255, 0.95);
  --gf-radius: 24px;
}

.gf-container {
  max-width: 960px;
  margin: 12px auto 40px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--gf-text-head);
  letter-spacing: -0.01em;
  user-select: none;
}

/* 顶部白毛玻璃导航 */
.gf-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--gf-bg-glass);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius);
  padding: 16px 24px;
  margin-bottom: 20px;
  box-shadow: var(--gf-shadow), var(--gf-inner-light);
}
.gf-brand {
  display: flex;
  align-items: center;
  gap: 15px;
}
.gf-logo-badge {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, #ffffff, #e0f2fe);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gf-blue);
  box-shadow: 0 4px 12px rgba(2, 132, 199, 0.12), inset 0 1px 1px #fff;
  border: 1px solid #ffffff;
}
.gf-logo-badge svg { width: 24px; height: 24px; }
.gf-title { font-size: 18px; font-weight: 800; color: var(--gf-text-head); }
.gf-subtitle { font-size: 12px; color: var(--gf-text-sub); margin-top: 2px; }

.gf-status-tag {
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 6px 14px;
  border-radius: 99px;
  font-size: 11.5px;
  font-weight: 700;
  color: #059669;
}
.gf-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: gf-breathe 2s infinite ease-in-out;
}

/* 主座舱双列排版 */
.gf-cockpit-grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 20px;
}

/* 左侧：风扇涡轮卡片 */
.gf-fan-card {
  background: var(--gf-bg-glass);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius);
  padding: 28px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: var(--gf-shadow), var(--gf-inner-light);
}

.gf-stage {
  width: 100%;
  max-width: 320px;
  aspect-ratio: 1 / 1;
  height: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.gf-svg-fan {
  width: 100%;
  height: 100%;
}

/* 核心无偏心旋转动画 */
.gf-rotor {
  transform-origin: 0 0;
  animation: gf-spin var(--rotor-dur, 0s) linear infinite;
  will-change: transform;
}
.gf-rotor.idle { animation-play-state: paused; }

@keyframes gf-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes gf-breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.85); }
}

/* 遥测读数群 */
.gf-telemetry-hud {
  width: 100%;
  text-align: center;
  margin-top: 18px;
}
.gf-hero-pct {
  font-size: 44px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -1.5px;
  color: var(--gf-text-head);
  font-feature-settings: "tnum";
}
.gf-hero-desc {
  font-size: 13px;
  font-weight: 700;
  color: var(--gf-blue);
  margin-top: 8px;
  letter-spacing: 0.3px;
}
.gf-chips-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 18px;
  width: 100%;
}
.gf-chip {
  background: var(--gf-bg-inner);
  border: 1px solid var(--gf-border-subtle);
  border-radius: 14px;
  padding: 8px 6px;
  text-align: center;
}
.gf-chip-lbl { font-size: 10px; font-weight: 600; color: var(--gf-text-dim); }
.gf-chip-val { font-size: 12.5px; font-weight: 800; color: var(--gf-text-head); margin-top: 2px; }

/* 右侧控制区 */
.gf-control-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.gf-panel {
  background: var(--gf-bg-glass);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius);
  padding: 24px;
  box-shadow: var(--gf-shadow), var(--gf-inner-light);
}
.gf-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.gf-panel-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--gf-text-sub);
  display: flex;
  align-items: center;
  gap: 8px;
}
.gf-panel-title svg { width: 16px; height: 16px; color: var(--gf-blue); }

/* 档位矩阵 */
.gf-modes-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.gf-btn-mode {
  background: var(--gf-bg-inner) !important;
  border: 1px solid var(--gf-border-subtle) !important;
  border-radius: 16px !important;
  padding: 14px 8px !important;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  outline: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  color: var(--gf-text-head) !important;
  box-shadow: 0 2px 4px rgba(15, 23, 42, 0.02);
}
.gf-btn-mode svg {
  width: 22px;
  height: 22px;
  color: var(--gf-text-sub);
  transition: transform 0.2s, color 0.2s;
}
.gf-btn-title { font-size: 13px; font-weight: 700; }
.gf-btn-meta { font-size: 10px; color: var(--gf-text-dim); }

.gf-btn-mode:hover {
  transform: translateY(-2px);
  background: #ffffff !important;
  border-color: rgba(2, 132, 199, 0.3) !important;
  box-shadow: 0 6px 16px rgba(2, 132, 199, 0.08);
}
.gf-btn-mode:hover svg { color: var(--gf-blue); transform: scale(1.1); }
.gf-btn-mode.active {
  background: linear-gradient(135deg, #0284c7, #0ea5e9) !important;
  border-color: transparent !important;
  color: #ffffff !important;
  box-shadow: 0 8px 20px var(--gf-blue-glow) !important;
}
.gf-btn-mode.active svg,
.gf-btn-mode.active .gf-btn-meta { color: rgba(255, 255, 255, 0.9); }

/* 无极滑块 */
.gf-slider-box {
  display: none;
  margin-top: 16px;
  padding: 16px 18px;
  background: var(--gf-bg-inner);
  border: 1px solid var(--gf-border-subtle);
  border-radius: 18px;
}
.gf-slider-box.active { display: block; animation: gf-fade 0.2s ease; }
.gf-slider-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: var(--gf-text-sub);
  margin-bottom: 12px;
}
.gf-slider {
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
  height: 7px;
  border-radius: 99px;
  background: #e2e8f0;
  outline: none;
  cursor: pointer;
}
.gf-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  border: 3px solid #0284c7;
  box-shadow: 0 2px 8px rgba(2, 132, 199, 0.3);
  cursor: pointer;
  transition: transform 0.15s;
}
.gf-slider::-webkit-slider-thumb:hover { transform: scale(1.18); }

/* 传感器矩阵 */
.gf-sensors-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.gf-sensor-card {
  background: var(--gf-bg-inner);
  border: 1px solid var(--gf-border-subtle);
  border-radius: 16px;
  padding: 12px 14px;
  position: relative;
  transition: border-color 0.25s, box-shadow 0.25s;
}
.gf-sensor-card.hotspot {
  border-color: rgba(2, 132, 199, 0.4);
  background: #ffffff;
  box-shadow: 0 4px 14px rgba(2, 132, 199, 0.08);
}
.gf-sc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--gf-text-sub);
}
.gf-sc-tag {
  font-size: 9px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 99px;
  background: var(--gf-blue-light);
  color: var(--gf-blue);
}
.gf-sc-val {
  font-size: 22px;
  font-weight: 900;
  margin-top: 6px;
  letter-spacing: -0.5px;
  font-feature-settings: "tnum";
}
.gf-sc-unit { font-size: 12px; font-weight: normal; color: var(--gf-text-dim); }
.gf-sc-bar {
  width: 100%;
  height: 4px;
  background: #e2e8f0;
  border-radius: 99px;
  margin-top: 8px;
  overflow: hidden;
}
.gf-sc-fill {
  height: 100%;
  width: 0%;
  border-radius: 99px;
  transition: width 0.5s ease, background 0.4s;
}

@keyframes gf-fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

@media (max-width: 860px) {
  .gf-cockpit-grid { grid-template-columns: 1fr; }
  .gf-fan-card { padding: 24px 16px; }
  .gf-sensors-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 520px) {
  .gf-modes-grid { grid-template-columns: repeat(2, 1fr); }
}
.gf-cfg-section {
  margin-top: 22px;
  background: var(--gf-bg-glass);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius);
  padding: 22px 18px 18px;
  box-shadow: var(--gf-shadow), var(--gf-inner-light);
}
.gf-cfg-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--gf-border);
}
.gf-cfg-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--gf-text-title);
  letter-spacing: 0.5px;
}
.gf-cfg-sub {
  font-size: 11px;
  color: var(--gf-text-dim);
}
.gf-cfg-error {
  padding: 14px;
  color: #ef4444;
  font-size: 12px;
}

`;

var SVG_WRAP = function(inner) {
	return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
};

var ICONS = {
	fan: SVG_WRAP('<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="3"/>'),
	silent: SVG_WRAP('<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M7 12h3l2-5 2 10 2-5h3"/>'),
	cruise: SVG_WRAP('<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>'),
	turbo: SVG_WRAP('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
	max: SVG_WRAP('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
	smart: SVG_WRAP('<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3"/><path d="M12 20v3"/><path d="M20 12h3"/><path d="M1 12h3"/>'),
	slider: SVG_WRAP('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
	temp: SVG_WRAP('<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>'),
	gear: SVG_WRAP('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>')
};

// v11: AirPi Pure Ceramic 7 叶陶瓷扇叶 SVG（用户提供，(300,300) 精确圆心几何）
function renderSolidGlacierSVG() {
	return `<svg id="pureAirPiFanSvg" viewBox="0 0 600 600" class="gf-svg-fan" xmlns="http://www.w3.org/2000/svg">
              <defs><style>
        @keyframes airpiRotorSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes windWavePulse {
          0% { transform: scale(0.96); opacity: 0.2; }
          50% { opacity: 0.65; }
          100% { transform: scale(1.04); opacity: 0.05; }
        }
        #fanRotorGroup {
          transform-origin: 300px 300px;
          animation: airpiRotorSpin 0.75s linear infinite reverse;
          will-change: transform;
        }
        .wind-wave {
          transform-origin: 300px 300px;
          animation: windWavePulse 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      </style>
                <!-- Outer Beveled Duct Rim Gradient -->
                <linearGradient id="ductRimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff"/>
                  <stop offset="45%" stop-color="#e2e8f0"/>
                  <stop offset="70%" stop-color="#cbd5e1"/>
                  <stop offset="100%" stop-color="#ffffff"/>
                </linearGradient>

                <!-- Recessed Frosted Glass Air Well Gradient -->
                <radialGradient id="airWellFrosted" cx="50%" cy="50%" r="50%">
                  <stop offset="60%" stop-color="#ffffff" stop-opacity="0.95"/>
                  <stop offset="82%" stop-color="#f8fafc" stop-opacity="0.9"/>
                  <stop offset="94%" stop-color="#e2e8f0" stop-opacity="0.75"/>
                  <stop offset="100%" stop-color="#cbd5e1" stop-opacity="0.6"/>
                </radialGradient>

                <!-- 1. Ceramic Matte White Blade Surface Multi-Stop Gradient -->
                <linearGradient id="bladeMatteWhite" x1="20%" y1="0%" x2="80%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff"/>
                  <stop offset="25%" stop-color="#f8fafc"/>
                  <stop offset="60%" stop-color="#eef3f9"/>
                  <stop offset="85%" stop-color="#e2e8f0"/>
                  <stop offset="100%" stop-color="#cbd5e1"/>
                </linearGradient>

                <!-- 2. Aerodynamic Leading-Edge Crisp White Reflection Bevel -->
                <linearGradient id="bladeHighlight" x1="0%" y1="0%" x2="100%" y2="35%">
                  <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
                  <stop offset="45%" stop-color="#ffffff" stop-opacity="0.9"/>
                  <stop offset="100%" stop-color="#e2e8f0" stop-opacity="0.3"/>
                </linearGradient>

                <!-- 3. Integrated Vector Under-Blade Ambient Occlusion Gradient (Replaces heavy feGaussianBlur) -->
                <linearGradient id="bladeUnderShadowGrad" x1="15%" y1="0%" x2="85%" y2="100%">
                  <stop offset="0%" stop-color="#94a3b8" stop-opacity="0.38"/>
                  <stop offset="60%" stop-color="#64748b" stop-opacity="0.22"/>
                  <stop offset="100%" stop-color="#475569" stop-opacity="0"/>
                </linearGradient>

                <!-- Central Spindle Ceramic White Lathe Brushed Hub Gradient -->
                <radialGradient id="ceramicHubGrad" cx="36%" cy="36%" r="64%">
                  <stop offset="0%" stop-color="#ffffff"/>
                  <stop offset="38%" stop-color="#f8fafc"/>
                  <stop offset="78%" stop-color="#e2e8f0"/>
                  <stop offset="100%" stop-color="#cbd5e1"/>
                </radialGradient>

                <!-- Outer Collar Shadow for Spindle Hub -->
                <linearGradient id="hubCollarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#e2e8f0"/>
                  <stop offset="100%" stop-color="#94a3b8"/>
                </linearGradient>

                <!-- Single High-Contrast 7-Blade Master Model (Rigorous (300, 300) Center Geometry) -->
                <g id="airpiBlade">
                  <!-- Under-Blade Integrated Vector Shadow: Rotates seamlessly with zero performance loss -->
                  <path class="blade-shadow-path" d="M 284 246 C 248 195, 178 148, 144 116 C 172 88, 234 76, 298 84 C 314 126, 320 186, 314 248 Z" fill="url(#bladeUnderShadowGrad)"/>

                  <!-- Main Ceramic Blade Sculpted Airfoil Body -->
                  <path d="M 286 244 C 250 196, 182 150, 148 118 C 174 92, 232 78, 294 86 C 310 128, 316 186, 310 246 Z" fill="url(#bladeMatteWhite)" stroke="#cbd5e1" stroke-width="0.85"/>

                  <!-- Aerodynamic Leading-Edge Specular Bevel Stripe -->
                  <path d="M 148 118 C 174 92, 232 78, 294 86 C 264 94, 202 104, 148 118 Z" fill="url(#bladeHighlight)"/>

                  <!-- Camber Airfoil Trailing Edge Contrast Edge -->
                  <path d="M 286 244 C 250 196, 182 150, 148 118" fill="none" stroke="#94a3b8" stroke-width="0.75" stroke-opacity="0.8"/>

                  <!-- Inner Surface Aerodynamic Flow Ridge Highlight -->
                  <path d="M 276 220 C 246 172, 196 138, 160 122" fill="none" stroke="#ffffff" stroke-width="0.85" stroke-opacity="0.9"/>
                </g>
              </defs>

              <!-- 1. Outer Square Base Chassis Frame -->
              <rect x="25" y="25" width="550" height="550" rx="52" fill="none" stroke="url(#ductRimGrad)" stroke-width="2.5"/>

              <!-- 4 Corner Soft Silicone Anti-Vibration Pads with AirPi Tech Cyan Rivets -->
              <g id="cornerMounts">
                <!-- Top-Left -->
                <rect x="46" y="46" width="52" height="52" rx="16" fill="#ffffff" fill-opacity="0.9" stroke="#e2e8f0" stroke-width="1.5"/>
                <circle cx="72" cy="72" r="6" fill="#38bdf8" fill-opacity="0.9"/>

                <!-- Top-Right -->
                <rect x="502" y="46" width="52" height="52" rx="16" fill="#ffffff" fill-opacity="0.9" stroke="#e2e8f0" stroke-width="1.5"/>
                <circle cx="528" cy="72" r="6" fill="#38bdf8" fill-opacity="0.9"/>

                <!-- Bottom-Left -->
                <rect x="46" y="502" width="52" height="52" rx="16" fill="#ffffff" fill-opacity="0.9" stroke="#e2e8f0" stroke-width="1.5"/>
                <circle cx="72" cy="528" r="6" fill="#38bdf8" fill-opacity="0.9"/>

                <!-- Bottom-Right -->
                <rect x="502" y="502" width="52" height="52" rx="16" fill="#ffffff" fill-opacity="0.9" stroke="#e2e8f0" stroke-width="1.5"/>
                <circle cx="528" cy="528" r="6" fill="#38bdf8" fill-opacity="0.9"/>
              </g>

              <!-- 2. Circular Frosted Glass Air Duct Bore (Centered precisely at 300, 300) -->
              <circle cx="300" cy="300" r="236" fill="url(#airWellFrosted)" stroke="#ffffff" stroke-width="2.5"/>
              <circle cx="300" cy="300" r="228" fill="none" stroke="#e2e8f0" stroke-width="1.5"/>
              <circle cx="300" cy="300" r="220" fill="none" stroke="#38bdf8" stroke-opacity="0.15" stroke-width="2"/>

              <!-- 3. Rear Stator Airflow Straightening Guide Vanes (Static struts behind blades provide contrast) -->
              <g id="statorVanesGroup" stroke="#cbd5e1" stroke-linecap="round" opacity="0.85">
                <line x1="300" y1="300" x2="135" y2="135" stroke-width="7"/>
                <line x1="300" y1="300" x2="465" y2="135" stroke-width="7"/>
                <line x1="300" y1="300" x2="135" y2="465" stroke-width="7"/>
                <line x1="300" y1="300" x2="465" y2="465" stroke-width="7"/>

                <line x1="300" y1="300" x2="135" y2="135" stroke="#ffffff" stroke-width="3"/>
                <line x1="300" y1="300" x2="465" y2="135" stroke="#ffffff" stroke-width="3"/>
                <line x1="300" y1="300" x2="135" y2="465" stroke="#ffffff" stroke-width="3"/>
                <line x1="300" y1="300" x2="465" y2="465" stroke="#ffffff" stroke-width="3"/>
              </g>

              <!-- Dynamic Airflow Ripple Rings (Soft Ice Cyan) -->
              <g id="airflowRipples" class="wind-wave" pointer-events="none" style="opacity: 0.95;">
                <circle cx="300" cy="300" r="195" fill="none" stroke="#0ea5e9" stroke-width="1.5" stroke-dasharray="28 56" opacity="0.45"/>
                <circle cx="300" cy="300" r="150" fill="none" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="20 40" opacity="0.35"/>
              </g>

              <!-- ============================================================== -->
              <!-- 4. ROTATING ROTOR ASSEMBLY (7 BLADES AT EXACT 51.42857° INTERVALS) -->
              <!-- ============================================================== -->
              <g id="fanRotorGroup" class="fan-rotor-animated reverse" style="--fan-duration: 0.75s;">

                <!-- 7 Aerodynamic Sickle Blades (Formula: 360° / 7 = 51.42857°) -->
                <!-- Blade 0 (0°) -->
                <use href="#airpiBlade" transform="rotate(0, 300, 300)"/>
                <!-- Blade 1 (51.43°) -->
                <use href="#airpiBlade" transform="rotate(51.42857, 300, 300)"/>
                <!-- Blade 2 (102.86°) -->
                <use href="#airpiBlade" transform="rotate(102.85714, 300, 300)"/>
                <!-- Blade 3 (154.29°) -->
                <use href="#airpiBlade" transform="rotate(154.28571, 300, 300)"/>
                <!-- Blade 4 (205.71°) -->
                <use href="#airpiBlade" transform="rotate(205.71428, 300, 300)"/>
                <!-- Blade 5 (257.14°) -->
                <use href="#airpiBlade" transform="rotate(257.14285, 300, 300)"/>
                <!-- Blade 6 (308.57°) -->
                <use href="#airpiBlade" transform="rotate(308.57142, 300, 300)"/>

                <!-- Central Spindle Hub Base Collar -->
                <circle cx="300" cy="300" r="64" fill="url(#hubCollarGrad)" stroke="#cbd5e1" stroke-width="1.2"/>

                <!-- Ceramic White Brushed Spindle Hub Body -->
                <circle cx="300" cy="300" r="58" fill="url(#ceramicHubGrad)" stroke="#cbd5e1" stroke-width="1.5"/>

                <!-- Concentric Precision Lathe Machine Micro-Rings -->
                <circle cx="300" cy="300" r="48" fill="none" stroke="#94a3b8" stroke-opacity="0.3" stroke-width="0.8"/>
                <circle cx="300" cy="300" r="36" fill="none" stroke="#94a3b8" stroke-opacity="0.35" stroke-width="0.8"/>
                <circle cx="300" cy="300" r="26" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="1"/>

                <!-- AirPi Signature Minimalist Tech Light Ring (Cyan) -->
                <circle cx="300" cy="300" r="19" fill="none" stroke="#0ea5e9" stroke-width="2.2" stroke-opacity="0.95"/>
                <circle cx="300" cy="300" r="19" fill="none" stroke="#38bdf8" stroke-width="0.9" stroke-opacity="0.6"/>

                <!-- Central Spindle Ceramic Pivot Jewel -->
                <circle cx="300" cy="300" r="6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.2"/>
                <circle cx="298.2" cy="298.2" r="1.8" fill="#38bdf8" opacity="0.95"/>
              </g>
            </svg>`;
}

/* ================= 内联硬件总线设置视图（原独立子页） ================= */
/*
 * luci-app-airpi-fancontrol - Hardware Bus & Kernel Config Cockpit (v5.3.3 Live Wave)
 * Layout: hero deck full-width, form card-ified, unified 1080px column.
 * Live: rAF-driven scrolling PWM wave + randomized duty drift + sweeping scanline.
 */

function parseCfgKV(s) {
	var o = {};
	String(s || '').split('\n').forEach(function(l) {
		var i = l.indexOf('=');
		if (i > 0)
			o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
	});
	return o;
}

var HWCfgCSS = `
:root {
  --hw-pri: #0284c7;
  --hw-pri-glow: rgba(2, 132, 199, 0.28);
  --hw-suc: #10b981;
  --hw-suc-bg: rgba(16, 185, 129, 0.12);
  --hw-warn: #f59e0b;
  --hw-warn-bg: rgba(245, 158, 11, 0.12);
  --hw-err: #ef4444;
  --hw-err-bg: rgba(239, 68, 68, 0.1);
  
  --hw-card-bg: rgba(255, 255, 255, 0.82);
  --hw-inner-bg: rgba(248, 250, 252, 0.75);
  --hw-border: rgba(226, 232, 240, 0.85);
  --hw-border-focus: rgba(2, 132, 199, 0.4);
  --hw-shadow: 0 14px 34px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(15, 23, 42, 0.02);
  --hw-inner-light: inset 0 1px 2px rgba(255, 255, 255, 0.95);
  
  --hw-text-title: #0f172a;
  --hw-text-body: #334155;
  --hw-text-muted: #64748b;
  --hw-text-dim: #94a3b8;
  --hw-radius: 22px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --hw-card-bg: rgba(17, 24, 39, 0.85);
    --hw-inner-bg: rgba(30, 41, 59, 0.65);
    --hw-border: rgba(255, 255, 255, 0.08);
    --hw-border-focus: rgba(56, 189, 248, 0.45);
    --hw-shadow: 0 16px 36px rgba(0, 0, 0, 0.35);
    --hw-inner-light: inset 0 1px 1px rgba(255, 255, 255, 0.1);
    --hw-text-title: #f8fafc;
    --hw-text-body: #cbd5e1;
    --hw-text-muted: #94a3b8;
    --hw-text-dim: #64748b;
  }
}

.hw-cockpit {
  margin: 8px 0 26px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--hw-text-body);
}

.hw-master-card {
  background: var(--hw-card-bg);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--hw-border);
  border-radius: var(--hw-radius);
  padding: 24px;
  box-shadow: var(--hw-shadow), var(--hw-inner-light);
  margin-bottom: 24px;
}

.hw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.hw-title-box {
  display: flex;
  align-items: center;
  gap: 14px;
}
.hw-icon-badge {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, #0284c7, #6366f1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 6px 18px var(--hw-pri-glow);
}
.hw-icon-badge svg { width: 22px; height: 22px; }
.hw-h1 { font-size: 17.5px; font-weight: 800; color: var(--hw-text-title); letter-spacing: -0.2px; }
.hw-h2 { font-size: 12px; color: var(--hw-text-muted); margin-top: 3px; }

.hw-topo-container {
  width: 100%;
  border-radius: 16px;
  background: var(--hw-inner-bg);
  border: 1px solid var(--hw-border);
  padding: 14px;
  margin-bottom: 20px;
  box-sizing: border-box;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.02);
}
.hw-topo-svg {
  width: 100%;
  height: auto;
  display: block;
}

/* 信号流光动画 */
@keyframes hw-dash-flow {
  from { stroke-dashoffset: 32; }
  to { stroke-dashoffset: 0; }
}
@keyframes hw-wave-roll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-48px); }
}
@keyframes hw-rotor-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.hw-active-pulse {
  stroke-dasharray: 6 6;
  animation: hw-dash-flow 1.1s linear infinite;
}
.hw-wave-travel {
  will-change: transform;
}
/* 扫描亮线：在示波器裁剪区内循环横扫 */
@keyframes hw-scan-x {
  from { transform: translateX(-12px); opacity: 0; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  to { transform: translateX(155px); opacity: 0; }
}
.hw-scan {
  animation: hw-scan-x 2.4s linear infinite;
}
.hw-fan-rotor {
  transform-origin: 715px 70px;
  animation: hw-rotor-spin var(--rotor-dur, 1.5s) linear infinite;
}
.hw-fan-rotor.stopped {
  animation-play-state: paused;
}

/* 状态芯片卡片 */
.hw-deck-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.hw-cell-card {
  background: var(--hw-inner-bg);
  border: 1px solid var(--hw-border);
  border-radius: 16px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: all 0.25s ease;
}
.hw-cell-card:hover {
  transform: translateY(-2px);
  background: #ffffff;
  border-color: var(--hw-border-focus);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
}
.hw-cell-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--hw-text-muted);
}
.hw-pill {
  font-size: 10.5px;
  padding: 3px 9px;
  border-radius: 99px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.hw-cell-main {
  font-size: 20px;
  font-weight: 900;
  color: var(--hw-text-title);
  letter-spacing: -0.5px;
  margin: 10px 0 4px;
}
.hw-cell-sub {
  font-size: 11.5px;
  color: var(--hw-text-muted);
  line-height: 1.45;
}

/* LuCI 控件与整页布局统一 */
.hw-page {
  max-width: 1080px;
  margin: 0 auto;
}
.hw-deck-host { margin-bottom: 22px; }

/* 单 tab 无意义，隐藏 LuCI tab 条 */
.cbi-map .cbi-tabs,
.cbi-map .cbi-tab-descr {
  display: none !important;
}

/* 表单区卡片化，与顶部看板同款毛玻璃 */
.cbi-map .cbi-section {
  background: var(--hw-card-bg) !important;
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--hw-border) !important;
  border-radius: var(--hw-radius) !important;
  box-shadow: var(--hw-shadow), var(--hw-inner-light) !important;
  padding: 24px 28px !important;
  margin-bottom: 24px !important;
}
.cbi-map .cbi-section > .cbi-section-descr {
  color: var(--hw-text-muted) !important;
  font-size: 12.5px !important;
  margin-bottom: 16px !important;
}

/* 表单行：label 收敛宽度，行距统一 */
.cbi-map .cbi-value {
  padding: 10px 0 !important;
  border-bottom: none !important;
  vertical-align: middle !important;
}
.cbi-map .cbi-value-title {
  width: 200px !important;
  min-width: 200px !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  color: var(--hw-text-body) !important;
  padding-top: 8px !important;
}
.cbi-map .cbi-value-field { flex: 1 !important; }
.cbi-map .cbi-value .cbi-value-field .cbi-input-select,
.cbi-map .cbi-value .cbi-value-field input[type="text"] {
  border-radius: 12px !important;
  padding: 9px 14px !important;
  border: 1px solid var(--hw-border) !important;
  background: var(--hw-inner-bg) !important;
  color: var(--hw-text-title) !important;
  outline: none !important;
  min-width: 260px !important;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.cbi-map .cbi-value .cbi-value-field .cbi-input-select:focus,
.cbi-map .cbi-value .cbi-value-field input[type="text"]:focus {
  border-color: var(--hw-pri) !important;
  box-shadow: 0 0 0 3px var(--hw-pri-glow) !important;
}
.cbi-value-description {
  font-size: 12px !important;
  color: var(--hw-text-muted) !important;
  margin-top: 6px !important;
}

/* 按钮：Reload 与 Save & Apply 行统一风格 */
.cbi-button-apply, .cbi-button-save, .cbi-button-reset {
  border: none !important;
  border-radius: 12px !important;
  padding: 9px 22px !important;
  font-weight: 700 !important;
  transition: transform 0.15s, opacity 0.15s !important;
}
.cbi-button-apply, .cbi-button-save {
  background: linear-gradient(135deg, #0284c7, #0ea5e9) !important;
  color: #fff !important;
  box-shadow: 0 4px 14px var(--hw-pri-glow) !important;
}
.cbi-button-reset {
  background: var(--hw-inner-bg) !important;
  color: var(--hw-text-body) !important;
  border: 1px solid var(--hw-border) !important;
}
.cbi-button-apply:hover, .cbi-button-save:hover { transform: translateY(-1px); opacity: 0.95; }
.cbi-page-actions {
  padding: 4px 0 0 !important;
  text-align: right !important;
}
.cbi-page-actions .cbi-button { margin-left: 10px !important; }

@media (max-width: 860px) {
  .cbi-map .cbi-value:not(.hidden) { display: block !important; }
  /* depends 隐藏的行必须保持隐藏（LuCI 用 .hidden 标记），否则互斥字段会在窄屏同时显示 */
  .cbi-map .cbi-value.hidden { display: none !important; }
  .cbi-map .cbi-value-title { width: 100% !important; min-width: 0 !important; padding-bottom: 6px !important; }
  .cbi-map .cbi-value .cbi-value-field .cbi-input-select,
  .cbi-map .cbi-value .cbi-value-field input[type="text"] { min-width: 0 !important; width: 100% !important; }
}

@media (max-width: 768px) {
  .hw-deck-grid { grid-template-columns: 1fr; }
  .hw-master-card { padding: 18px 14px; }
}
`;

var SVG_ICONS = {
	chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>'
};

// 动态高精方波生成算法 (根据真实 duty / 255 计算脉宽)
function calculatePWMPath(ratio) {
	var period = 48; // 一个周期像素跨度
	var highY = 32;  // 高电平 (3.3V)
	var lowY = 60;   // 低电平 (0V)
	var cycles = 6;  // 绘制 6 个周期以保证滚动无缝拼接 (6 * 48 = 288px)

	if (ratio <= 0.02) {
		return 'M 0 ' + lowY + ' L 288 ' + lowY;
	}
	if (ratio >= 0.98) {
		return 'M 0 ' + highY + ' L 288 ' + highY;
	}

	var highW = Math.max(2, Math.min(period - 2, period * ratio));
	var path = 'M 0 ' + lowY;

	for (var i = 0; i < cycles; i++) {
		var x = i * period;
		path += ' L ' + x + ' ' + highY;
		path += ' L ' + (x + highW).toFixed(1) + ' ' + highY;
		path += ' L ' + (x + highW).toFixed(1) + ' ' + lowY;
		path += ' L ' + (x + period) + ' ' + lowY;
	}
	return path;
}

// 构建拓扑 SVG，参数真实驱动
function buildLiveTopologySVG(hw, is16G) {
	var isHwPwmValid = hw.hw_pwm && hw.hw_pwm !== 'none';
	var isSwPwmLoaded = hw.softpwm_loaded === '1';

	var rawDuty = parseInt(hw.duty, 10);
	if (isNaN(rawDuty)) rawDuty = parseInt(hw.fanspd, 10);
	if (isNaN(rawDuty)) rawDuty = isSwPwmLoaded ? 128 : 0;

	var ratio = Math.min(Math.max(rawDuty / 255, 0), 1);
	var pctText = (ratio * 100).toFixed(1) + '%';
	var wavePath = calculatePWMPath(ratio);

	var hwColor = isHwPwmValid ? '#10b981' : 'rgba(239, 68, 68, 0.45)';
	var swColor = isSwPwmLoaded ? '#0284c7' : (is16G ? '#f59e0b' : 'rgba(148, 163, 184, 0.35)');

	var hwDashClass = isHwPwmValid ? 'hw-active-pulse' : '';
	var swDashClass = isSwPwmLoaded ? 'hw-active-pulse' : '';

	var convergenceLine = isSwPwmLoaded ? '#0284c7' : (isHwPwmValid ? '#10b981' : 'rgba(148,163,184,0.3)');
	var convergenceClass = (isSwPwmLoaded || isHwPwmValid) ? 'hw-active-pulse' : '';

	// 转子速度：依据真实占空比反比计算动画旋转周期
	var rotorDur = ratio <= 0 ? '0s' : (Math.max(0.18, (1 - ratio) * 1.5 + 0.2)).toFixed(2) + 's';
	var rotorStopped = ratio <= 0 ? 'stopped' : '';

	return `
	<svg class="hw-topo-svg" viewBox="0 0 760 140">
		<defs>
			<linearGradient id="soc-foil" x1="0%" y1="0%" x2="100%" y2="100%">
				<stop offset="0%" stop-color="#0284c7"/>
				<stop offset="100%" stop-color="#4f46e5"/>
			</linearGradient>

			<linearGradient id="screen-grad" x1="0%" y1="0%" x2="0%" y2="100%">
				<stop offset="0%" stop-color="#0b1329"/>
				<stop offset="100%" stop-color="#111c38"/>
			</linearGradient>

			<clipPath id="scope-viewport">
				<rect x="0" y="0" width="155" height="96" rx="12"/>
			</clipPath>
		</defs>

		<!-- 节点 1: AirPi SoC 核心 -->
		<g transform="translate(16, 24)">
			<rect width="144" height="92" rx="14" fill="url(#soc-foil)" filter="drop-shadow(0 4px 10px rgba(2, 132, 199, 0.2))"/>
			<text x="72" y="36" fill="#ffffff" font-size="12.5" font-weight="800" text-anchor="middle">AirPi SoC Core</text>
			<text x="72" y="55" fill="#bae6fd" font-size="11" font-weight="600" text-anchor="middle">eMMC ${hw.emmc_gb || '?'}GB 架构</text>
			<rect x="24" y="66" width="96" height="18" rx="6" fill="rgba(255,255,255,0.2)"/>
			<text x="72" y="79" fill="#ffffff" font-size="9.5" font-weight="700" text-anchor="middle">${is16G ? 'v2.0 软件总线模式' : 'v1.0 硬件总线模式'}</text>
		</g>

		<!-- 拓扑总线 A（硬件 PWM 上轨） -->
		<path d="M 160 50 L 226 50" fill="none" stroke="${hwColor}" stroke-width="2.2" class="${hwDashClass}"/>
		
		<!-- 节点 2: 硬件 PWM 控制器 -->
		<g transform="translate(226, 26)">
			<rect width="146" height="42" rx="10" fill="var(--hw-card-bg)" stroke="${hwColor}" stroke-width="1.4"/>
			<circle cx="16" cy="21" r="5" fill="${isHwPwmValid ? '#10b981' : '#ef4444'}"/>
			<text x="30" y="19" fill="var(--hw-text-title)" font-size="11" font-weight="800">内核硬件 PWM</text>
			<text x="30" y="32" fill="var(--hw-text-muted)" font-size="9.5">pwm-fan / hwmon0</text>
		</g>

		<!-- 拓扑总线 B（GPIO 软中断下轨） -->
		<path d="M 160 90 L 226 90" fill="none" stroke="${swColor}" stroke-width="2.2" class="${swDashClass}"/>

		<!-- 节点 3: GPIO 软中断模块 -->
		<g transform="translate(226, 72)">
			<rect width="146" height="42" rx="10" fill="var(--hw-card-bg)" stroke="${swColor}" stroke-width="1.4"/>
			<circle cx="16" cy="21" r="5" fill="${isSwPwmLoaded ? '#0284c7' : (is16G ? '#f59e0b' : '#94a3b8')}"/>
			<text x="30" y="19" fill="var(--hw-text-title)" font-size="11" font-weight="800">内核模块 airpi_gpio</text>
			<text id="svg-duty-label" x="30" y="32" fill="var(--hw-text-muted)" font-size="9.5">GPIO 540 · 占空比: ${rawDuty}</text>
		</g>

		<!-- 汇聚通道至示波器 -->
		<path d="M 372 47 C 430 47, 440 70, 500 70" fill="none" stroke="${isHwPwmValid ? '#10b981' : 'rgba(148,163,184,0.2)'}" stroke-width="1.6" stroke-dasharray="3 3"/>
		<path d="M 372 93 C 430 93, 440 70, 500 70" fill="none" stroke="${convergenceLine}" stroke-width="2.2" class="${convergenceClass}"/>

		<!-- 节点 4: 真实 PWM 示波器 (Live Oscilloscope HUD) -->
		<g transform="translate(500, 22)">
			<rect width="155" height="96" rx="12" fill="url(#screen-grad)" stroke="rgba(255,255,255,0.18)" stroke-width="1.2"
				filter="drop-shadow(0 4px 14px rgba(0, 0, 0, 0.25))"/>
			
			<!-- 标尺刻度网格 -->
			<line x1="0" y1="32" x2="155" y2="32" stroke="rgba(56, 189, 248, 0.15)" stroke-width="1" stroke-dasharray="2 3"/>
			<line x1="0" y1="60" x2="155" y2="60" stroke="rgba(56, 189, 248, 0.15)" stroke-width="1" stroke-dasharray="2 3"/>
			<line x1="77" y1="0" x2="77" y2="96" stroke="rgba(56, 189, 248, 0.15)" stroke-width="1" stroke-dasharray="2 3"/>

			<!-- 示波器数字面板头部 -->
			<rect x="0" y="0" width="155" height="19" rx="12" fill="rgba(0, 0, 0, 0.35)"/>
			<text x="8" y="13" fill="#38bdf8" font-size="9" font-weight="900" font-family="monospace">PWM DUTY: <tspan id="scope-pct-badge">${pctText}</tspan></text>
			<text x="147" y="13" fill="#94a3b8" font-size="8.5" font-family="monospace" text-anchor="end"><tspan id="scope-raw-badge">${rawDuty}</tspan>/255</text>

			<!-- 垂直电压标尺 -->
			<text x="8" y="30" fill="#64748b" font-size="7" font-family="monospace">3.3V</text>
			<text x="8" y="68" fill="#64748b" font-size="7" font-family="monospace">GND</text>

			<!-- 动态方波 (实际脉宽计算，JS 引擎驱动连续滚动与占空比模拟漂移) -->
			<g clip-path="url(#scope-viewport)">
				<path id="scope-dynamic-wave" class="hw-wave-travel" d="${wavePath}"
					fill="none" stroke="#00f5ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
					filter="drop-shadow(0 0 5px rgba(0, 245, 255, 0.7))"/>
				<line class="hw-scan" x1="0" y1="0" x2="0" y2="96" stroke="rgba(0, 245, 255, 0.3)" stroke-width="12"/>
			</g>
			
			<text x="77" y="85" fill="#38bdf8" font-size="8" font-weight="700" text-anchor="middle" letter-spacing="0.5">实测调制波形</text>
		</g>

		<!-- 示波器至负载连接线 -->
		<line x1="655" y1="70" x2="690" y2="70" stroke="#00f5ff" stroke-width="2" class="hw-active-pulse"/>

		<!-- 节点 5: 真实联动风扇负载终端 -->
		<g transform="translate(0, 0)">
			<circle cx="715" cy="70" r="24" fill="rgba(2, 132, 199, 0.08)" stroke="#0284c7" stroke-width="1.8"/>
			<circle cx="715" cy="70" r="21" fill="none" stroke="rgba(2, 132, 199, 0.25)" stroke-width="1" stroke-dasharray="2 3"/>
			<!-- 4叶根据占空比变频的风扇转子 -->
			<g id="hw-live-rotor" class="hw-fan-rotor ${rotorStopped}" style="--rotor-dur: ${rotorDur};">
				<path d="M 715 70 C 713 62 717 52 724 49 C 725 54 722 62 715 70 Z" fill="#0284c7"/>
				<path d="M 715 70 C 723 68 733 72 736 79 C 731 80 723 77 715 70 Z" fill="#0284c7"/>
				<path d="M 715 70 C 717 78 713 88 706 91 C 705 86 708 78 715 70 Z" fill="#0284c7"/>
				<path d="M 715 70 C 707 72 697 68 694 61 C 699 60 707 63 715 70 Z" fill="#0284c7"/>
				<circle cx="715" cy="70" r="4.5" fill="#ffffff" stroke="#0284c7" stroke-width="1.5"/>
			</g>
		</g>
	</svg>`;
}

var HWCfg = {
	load: function() {
		return Promise.all([
			fs.exec(CTL, ['hwdetect']).then(function(r) { return r.stdout || ''; }).catch(function() { return ''; }),
			uci.load('airpi-fan')
		]);
	},

	buildHardwareDeck: function(hw) {
		var emmcIs16g = (parseInt(hw.emmc_sectors, 10) || 0) > 25000000;
		var emmcGb = hw.emmc_gb || (emmcIs16g ? '16' : '8');

		var emmcBadgeBg = emmcIs16g ? 'rgba(2, 132, 199, 0.12)' : 'rgba(99, 102, 241, 0.12)';
		var emmcBadgeColor = emmcIs16g ? '#0284c7' : '#6366f1';

		var hwPwmOk = hw.hw_pwm && hw.hw_pwm !== 'none';
		var hwBadgeBg = hwPwmOk ? 'var(--hw-suc-bg)' : 'var(--hw-err-bg)';
		var hwBadgeColor = hwPwmOk ? 'var(--hw-suc)' : 'var(--hw-err)';

		var swLoaded = hw.softpwm_loaded === '1';
		var swBadgeBg = swLoaded ? 'var(--hw-suc-bg)' : 'var(--hw-warn-bg)';
		var swBadgeColor = swLoaded ? 'var(--hw-suc)' : 'var(--hw-warn)';

		var svgMarkup = buildLiveTopologySVG(hw, emmcIs16g);

		return `
		<div class="hw-cockpit">
			<style>${HWCfgCSS}</style>
			<div class="hw-master-card">
				<div class="hw-header">
					<div class="hw-title-box">
						<div class="hw-icon-badge">${SVG_ICONS.chip}</div>
						<div>
							<div class="hw-h1">${_('硬件拓扑与调制总线感知')}</div>
							<div class="hw-h2">${_('实时探测 AP3000M 硬件层引脚、内核定时器及 PWM 信号流向')}</div>
						</div>
					</div>
				</div>

				<div class="hw-topo-container">
					${svgMarkup}
				</div>

				<div class="hw-deck-grid">
					<!-- eMMC 卡片 -->
					<div class="hw-cell-card">
						<div class="hw-cell-top">
							<span>${_('eMMC 宿主闪存')}</span>
							<span class="hw-pill" style="background:${emmcBadgeBg};color:${emmcBadgeColor}">
								${emmcIs16g ? _('16GB 增强版') : _('8GB 标准版')}
							</span>
						</div>
						<div class="hw-cell-main">${emmcGb} GB</div>
						<div class="hw-cell-sub">
							${emmcIs16g ? _('架构限制：仅支持软件 PWM 驱动') : _('原生支持硬件 PWM 定时器')}
						</div>
					</div>

					<!-- 硬件 PWM 卡片 -->
					<div class="hw-cell-card">
						<div class="hw-cell-top">
							<span>${_('内核硬件 PWM')}</span>
							<span class="hw-pill" style="background:${hwBadgeBg};color:${hwBadgeColor}">
								${hwPwmOk ? _('就绪可用') : _('未挂载')}
							</span>
						</div>
						<div class="hw-cell-main" style="font-size:17px;">
							${hwPwmOk ? 'pwm-fan' : _('无可用节点')}
						</div>
						<div class="hw-cell-sub">
							${hwPwmOk ? hw.hw_pwm : (emmcIs16g ? _('16GB 版本未引出硬件通道') : _('设备树未配置定时器'))}
						</div>
					</div>

					<!-- 软件 PWM 卡片 -->
					<div class="hw-cell-card">
						<div class="hw-cell-top">
							<span>${_('GPIO 软中断模块')}</span>
							<span class="hw-pill" style="background:${swBadgeBg};color:${swBadgeColor}">
								${swLoaded ? _('已加载运行') : _('未激活')}
							</span>
						</div>
						<div class="hw-cell-main" style="font-size:17px;">
							${swLoaded ? 'airpi_gpio_fan' : _('模块挂起')}
						</div>
						<div class="hw-cell-sub" id="deck-duty-desc">
							${swLoaded ? _('当前输出占空比: ') + (hw.duty || 'na') : _('保存配置后轻触下方重载按钮')}
						</div>
					</div>
				</div>
			</div>
		</div>`;
	},

	render: function(data) {
		var hw = parseCfgKV(data[0]);
		var self = this;
		var m, s, o;

		// 模拟引擎基准占空比（真实值；波形围绕真实值做正弦漂移仅为视觉效果）
		var rd0 = parseInt(hw.duty, 10);
		if (isNaN(rd0)) rd0 = parseInt(hw.fanspd, 10);
		self.simBaseRatio = isNaN(rd0) ? (hw.softpwm_loaded === '1' ? 0.5 : 0) : rd0 / 255;

		m = new form.Map('airpi-fan', _('风扇驱动与硬件配置'),
			_('针对 AirPi AP3000M 路由器的内核级温控参数与 PWM 信号发生器管理。'));

		s = m.section(form.TypedSection, 'fan', '');
		s.anonymous = true;
		s.addremove = false;

		/* ---- 顶部动态视觉看板已移出表单（见 render 末尾），避免被表单列宽挤压 ---- */

		/* ---- 驱动模式选择 ---- */
		o = s.option(form.ListValue, 'fan_driver', _('风扇驱动调度策略'),
			_('自动模式可根据 eMMC 硬件规格自动适配最优驱动方案，亦可手动指定内核驱动模式。'));
		o.value('auto', _('自动感知与适配 (推荐)'));
		o.value('pwm', _('硬件 PWM (内核定时器 pwm-fan)'));
		o.value('softpwm', _('软件 PWM (GPIO 软中断高精模块)'));
		o.default = 'auto';
		o = s.option(form.Value, 'fan_gpio', _('风扇引脚 GPIO 编号'),
			_('用于软 PWM 调制的输出引脚。AP3000M 默认为 540 (gpiochip512 offset 28)。'));
		o.datatype = 'uinteger';
		o.default = '540';
		o.placeholder = '540';
		o.depends('fan_driver', 'softpwm');

		o = s.option(form.Value, 'fan_freq', _('调制脉冲信号周期 (μs)'),
			_('PWM 脉冲周期，单位微秒。默认 15000μs (约 66.7Hz)。'));
		o.datatype = 'uinteger';
		o.default = '15000';
		o.placeholder = '15000';
		o.depends('fan_driver', 'softpwm');

		/* ---- 重新加载驱动动作 ---- */
		o = s.option(form.Button, '_apply_driver', _('驱动热重载'),
			_('下发配置并触发 airpi-fanctl 重新探测内核驱动环境。'));
		o.inputtitle = _('立即重新加载驱动');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return uci.save().then(function() {
				return fs.exec(CTL, ['reload']);
			}).then(function(res) {
				var kv = parseCfgKV(res.stdout || '');
				ui.addNotification(null,
					E('p', {}, kv.msg || _('内核驱动热重载成功')), 'info');
				window.setTimeout(function() { window.location.reload(); }, 1200);
			}).catch(function(e) {
				ui.addNotification(null,
					E('p', {}, _('重载驱动失败: ') + (e && e.message ? e.message : e)), 'error');
			});
		};

		// 实时轮询：挂钩示波器与风扇动画，实现真正“有实际效果”的实时刷新
		poll.add(function() {
			return fs.exec(CTL, ['hwdetect']).then(function(r) {
				var curHw = parseCfgKV(r.stdout || '');
				var d = parseInt(curHw.duty, 10);
				if (isNaN(d)) d = parseInt(curHw.fanspd, 10);
				if (isNaN(d)) return;

				var rRatio = Math.min(Math.max(d / 255, 0), 1);
				self.simBaseRatio = rRatio;
				if (self.simNext !== undefined)
					self.simNext = 0;   // 基线变化后立即重抽随机漂移目标
				var waveDom = document.getElementById('scope-dynamic-wave');
				var pctBadge = document.getElementById('scope-pct-badge');
				var rawBadge = document.getElementById('scope-raw-badge');
				var rotorDom = document.getElementById('hw-live-rotor');
				var dutyLbl = document.getElementById('svg-duty-label');
				var descDom = document.getElementById('deck-duty-desc');

				if (waveDom) waveDom.setAttribute('d', calculatePWMPath(rRatio));
				if (pctBadge) pctBadge.textContent = (rRatio * 100).toFixed(1) + '%';
				if (rawBadge) rawBadge.textContent = String(d);
				if (dutyLbl) dutyLbl.textContent = 'GPIO 540 · 占空比: ' + d;
				if (descDom) descDom.textContent = _('当前输出占空比: ') + d;

				if (rotorDom) {
					if (rRatio <= 0) {
						rotorDom.classList.add('stopped');
					} else {
						rotorDom.classList.remove('stopped');
						var dur = Math.max(0.18, (1 - rRatio) * 1.5 + 0.2).toFixed(2) + 's';
						rotorDom.style.setProperty('--rotor-dur', dur);
					}
				}
			}).catch(function() {});
		}, 4);

		// 顶部看板作为表单的兄弟节点渲染，占满统一版心（不再受表单单元格宽度挤压）。
		// 注意：E() 不接受 Promise 子节点，必须先等 m.render() 完成再组合。
		var deckHost = E('div', { 'class': 'hw-deck-host' });
		deckHost.innerHTML = self.buildHardwareDeck(hw);

		// 模拟波形动画引擎：requestAnimationFrame 连续滚动 + 占空比随机漂移。
		// 随机策略：每 0.7~1.6s 抽取一个随机目标偏移，再以约 400ms 时间常数缓动逼近，
		// 视觉上随机且平滑不抖动。真实占空比仍由 4s 轮询写入 self.simBaseRatio，
		// 漂移只是视觉层，不改设备。
		(function() {
			var waveEl = deckHost.querySelector('#scope-dynamic-wave');
			if (!waveEl)
				return;
			var phase = 0, last = null;
			self.simCur = null;
			self.simTarget = self.simBaseRatio || 0;
			self.simNext = 0;
			function frame(ts) {
				if (last === null)
					last = ts;
				var dt = Math.min(ts - last, 100);
				last = ts;
				phase = (phase + dt * 0.036) % 48;   // 约 36px/s 无缝滚动（一个周期 48px）
				waveEl.style.transform = 'translateX(' + (-phase).toFixed(2) + 'px)';
				if (ts >= self.simNext) {
					self.simNext = ts + 700 + Math.random() * 900;
					var amp = 0.05 + Math.random() * 0.05;   // 偏移幅度 0.05~0.10
					self.simTarget = (self.simBaseRatio || 0) + (Math.random() < 0.5 ? -amp : amp);
				}
				var sim = (self.simCur === null) ? (self.simBaseRatio || 0) : self.simCur;
				sim += (self.simTarget - sim) * Math.min(1, dt / 400);
				self.simCur = Math.min(Math.max(sim, 0.02), 0.98);
				waveEl.setAttribute('d', calculatePWMPath(self.simCur));
				window.requestAnimationFrame(frame);
			}
			window.requestAnimationFrame(frame);
		})();

		return m.render().then(function(formEl) {
			return E('div', { 'class': 'hw-page' }, [deckHost, formEl]);
		});
	}
};

return view.extend({
	currentSpeed: 0,
	currentTemp: 0,
	refs: {},

	load: function() {
		return Promise.all([
			ctl(['status']).catch(function() { return { stdout: '' }; }),
			ctl(['temp']).catch(function() { return { stdout: '' }; }),
			ctl(['temps']).catch(function() { return { stdout: '' }; })
		]);
	},

	makeModeButton: function(icon, title, meta, handler) {
		var btn = E('button', { 'class': 'gf-btn-mode', 'type': 'button' }, [
			E('span', { 'style': 'display:flex' }),
			E('span', { 'class': 'gf-btn-title' }, title),
			E('span', { 'class': 'gf-btn-meta' }, meta)
		]);
		btn.firstChild.innerHTML = icon;
		btn.addEventListener('click', handler);
		btn.dataset.mode = title;
		return btn;
	},

	render: function(data) {
		var self = this;

		// 1. 顶部白毛玻璃导航条
		var nav = E('div', { 'class': 'gf-nav' }, [
			E('div', { 'class': 'gf-brand' }, [
				E('div', { 'class': 'gf-logo-badge' }),
				E('div', {}, [
					E('div', { 'class': 'gf-title' }, _('AirPi 智能温控工作台')),
					E('div', { 'class': 'gf-subtitle' }, _('PWM 线性调速 · 闭环感知调度'))
				])
			]),
			E('div', { 'class': 'gf-status-tag' }, [
				E('div', { 'class': 'gf-status-dot' }),
				E('span', { 'id': 'gf-status-text' }, _('自适应巡航'))
			])
		]);
		nav.querySelector('.gf-logo-badge').innerHTML = ICONS.fan;

		// 2. 左侧：风扇涡轮座舱
		var stage = E('div', { 'class': 'gf-stage' });
		stage.innerHTML = renderSolidGlacierSVG();

		var heroPct = E('div', { 'class': 'gf-hero-pct' }, '0%');
		var heroDesc = E('div', { 'class': 'gf-hero-desc' }, _('已停机待命'));

		var chipRpm = E('div', { 'class': 'gf-chip' }, [
			E('div', { 'class': 'gf-chip-lbl' }, _('估算转速')),
			E('div', { 'class': 'gf-chip-val' }, '0 RPM')
		]);
		var chipDba = E('div', { 'class': 'gf-chip' }, [
			E('div', { 'class': 'gf-chip-lbl' }, _('声学噪声')),
			E('div', { 'class': 'gf-chip-val' }, '< 10 dBA')
		]);
		var chipFlow = E('div', { 'class': 'gf-chip' }, [
			E('div', { 'class': 'gf-chip-lbl' }, _('有效风压')),
			E('div', { 'class': 'gf-chip-val' }, '0.0 CFM')
		]);

		var chipsRow = E('div', { 'class': 'gf-chips-row' }, [ chipRpm, chipDba, chipFlow ]);

		var fanCard = E('div', { 'class': 'gf-fan-card' }, [
			stage,
			E('div', { 'class': 'gf-telemetry-hud' }, [
				heroPct,
				heroDesc,
				chipsRow
			])
		]);

		// 3. 右侧：控制矩阵（标定合理转速）
		var modesGrid = E('div', { 'class': 'gf-modes-grid' }, [
			this.makeModeButton(ICONS.silent, _('静音'), '25% · ~1080 RPM', function() { self.setManual(64, 0); }),
			this.makeModeButton(ICONS.cruise, _('巡航'), '50% · ~1650 RPM', function() { self.setManual(128, 1); }),
			this.makeModeButton(ICONS.turbo, _('强冷'), '75% · ~2230 RPM', function() { self.setManual(192, 2); }),
			this.makeModeButton(ICONS.max, _('全速'), '100% · 2800 RPM', function() { self.setManual(255, 3); }),
			this.makeModeButton(ICONS.smart, _('智能'), 'AI · 动态巡航', function() { self.setAuto(); }),
			this.makeModeButton(ICONS.slider, _('无极'), '自定义线性推力', function() { self.toggleStepless(); })
		]);

		var sliderCtrl = E('input', {
			'type': 'range', 'class': 'gf-slider',
			'min': '0', 'max': '255', 'value': '255'
		});
		var sliderBadge = E('span', { 'style': 'color:var(--gf-blue);font-weight:700;' }, 'PWM 255 (100%)');
		var sliderBox = E('div', { 'class': 'gf-slider-box' }, [
			E('div', { 'class': 'gf-slider-head' }, [
				E('span', {}, _('线性阻尼推杆')),
				sliderBadge
			]),
			sliderCtrl
		]);

		var tacticalPanel = E('div', { 'class': 'gf-panel' }, [
			E('div', { 'class': 'gf-panel-head' }, [
				E('div', { 'class': 'gf-panel-title' }, [
					E('span', { 'style': 'display:flex' }),
					_('动力调度模式')
				]),
				E('span', { 'style': 'font-size:11px;color:var(--gf-text-dim);' }, _('即时切换'))
			]),
			modesGrid,
			sliderBox
		]);
		tacticalPanel.querySelector('.gf-panel-title span').innerHTML = ICONS.gear;

		// 4. 右侧：多温区矩阵
		var sensorsGrid = E('div', { 'class': 'gf-sensors-grid' });
		var thermalPanel = E('div', { 'class': 'gf-panel' }, [
			E('div', { 'class': 'gf-panel-head' }, [
				E('div', { 'class': 'gf-panel-title' }, [
					E('span', { 'style': 'display:flex' }),
					_('板载传感器温控阵列')
				]),
				E('span', { 'id': 'gf-thermal-badge', 'style': 'font-size:11px;color:var(--gf-text-dim);' }, _('动态巡检'))
			]),
			sensorsGrid
		]);
		thermalPanel.querySelector('.gf-panel-title span').innerHTML = ICONS.temp;

		var controlStack = E('div', { 'class': 'gf-control-stack' }, [
			tacticalPanel,
			thermalPanel
		]);

		// 5. 组合主布局
		var cockpitGrid = E('div', { 'class': 'gf-cockpit-grid' }, [
			fanCard,
			controlStack
		]);

		this.refs = {
			rotor: stage.querySelector('#fanRotorGroup'),
			arc: stage.querySelector('#gf-speed-arc'),
			ripples: stage.querySelectorAll('#airflowRipples.wind-wave'),
			heroPct: heroPct,
			heroDesc: heroDesc,
			chipRpm: chipRpm.querySelector('.gf-chip-val'),
			chipDba: chipDba.querySelector('.gf-chip-val'),
			chipFlow: chipFlow.querySelector('.gf-chip-val'),
			modesGrid: modesGrid,
			sliderBox: sliderBox,
			sliderCtrl: sliderCtrl,
			sliderBadge: sliderBadge,
			sensorsGrid: sensorsGrid,
			thermalBadge: thermalPanel.querySelector('#gf-thermal-badge'),
			statusText: nav.querySelector('#gf-status-text')
		};

		var debounceTimer = null;
		sliderCtrl.addEventListener('input', function() {
			var v = parseInt(sliderCtrl.value, 10) || 0;
			var pct = Math.round((v / 255) * 100);
			sliderBadge.textContent = 'PWM ' + v + ' (' + pct + '%)';
			self.updateTelemetry(v);
			if (debounceTimer)
				window.clearTimeout(debounceTimer);
			debounceTimer = window.setTimeout(function() {
				ctl(['stepless', String(v)]).catch(function() {});
			}, 150);
		});

		// 初始数据载入
		if (data && data[0]) this.applyStatus(parseKV(data[0].stdout));
		if (data && data[1]) this.applyTemp(parseKV(data[1].stdout));
		if (data && data[2]) this.applyTemps(parseKV(data[2].stdout));

		// 轮询服务
		poll.add(L.bind(function() {
			return Promise.all([
				ctl(['status']).catch(function() { return { stdout: '' }; }),
				ctl(['temp']).catch(function() { return { stdout: '' }; }),
				ctl(['temps']).catch(function() { return { stdout: '' }; })
			]).then(function(res) {
				self.applyStatus(parseKV(res[0].stdout));
				self.applyTemp(parseKV(res[1].stdout));
				self.applyTemps(parseKV(res[2].stdout));
			});
		}, this), 4);

		// 合并后的硬件总线配置面板（原独立设置子页，现已并入同一页面）
		var cfgHost = E('div', { 'class': 'gf-cfg-host' });
		var cfgWrap = E('div', { 'class': 'gf-cfg-section' }, [
			E('div', { 'class': 'gf-cfg-head' }, [
				E('span', { 'class': 'gf-cfg-title' }, _('硬件总线与内核配置')),
				E('span', { 'class': 'gf-cfg-sub' }, _('驱动 / GPIO / 调制周期 · 实时 PWM 示波器'))
			]),
			cfgHost
		]);

		// 配置面板数据装载复刻原设置视图的 load()，再用纯对象调用其 render。
		// 全流程放进 Promise 链：任何异常只影响配置区，不会拖垮主座舱渲染。
		Promise.resolve().then(function() {
			return HWCfg.load();
		}).then(function(d) {
			return HWCfg.render.call(HWCfg, d);
		}).then(function(el) {
			if (el) cfgHost.appendChild(el);
		}).catch(function(e) {
			dom.content(cfgHost, E('div', { 'class': 'gf-cfg-error' },
				_('配置面板加载失败: ') + (e && e.message ? e.message : e)));
		});

		return E('div', { 'class': 'gf-container' }, [
			E('style', { 'type': 'text/css' }, CSS),
			nav,
			cockpitGrid,
			cfgWrap
		]);
	},

	/* ---------- 控制调度 ---------- */

	setManual: function(speed, code) {
		var self = this;
		this.hideStepless();
		this.updateTelemetry(speed);
		return ctl(['set', String(speed), String(code)]).then(function() {
			self.applyStatus({ fanspd: String(speed), mode: _('手动') });
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, _('风扇设定失败: ') + e.message), 'error');
		});
	},

	setAuto: function() {
		var self = this;
		this.hideStepless();
		return ctl(['auto']).then(function() {
			self.applyStatus({ mode: _('智能') });
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, _('自适应巡航切换失败: ') + e.message), 'error');
		});
	},

	toggleStepless: function() {
		var box = this.refs.sliderBox;
		if (box.classList.contains('active')) {
			this.hideStepless();
			return;
		}
		box.classList.add('active');
		this.highlightButton(_('无极'));
		var v = parseInt(this.refs.sliderCtrl.value, 10) || 255;
		ctl(['stepless', String(v)]).catch(function() {});
	},

	hideStepless: function() {
		if (this.refs.sliderBox)
			this.refs.sliderBox.classList.remove('active');
	},

	highlightButton: function(label) {
		var btns = this.refs.modesGrid.querySelectorAll('.gf-btn-mode');
		btns.forEach(function(b) {
			b.classList.toggle('active', label !== null && b.dataset.mode === label);
		});
	},

	/* ---------- 状态应用 ---------- */

	applyStatus: function(st) {
		var spd = parseInt(st.fanspd, 10);
		if (isNaN(spd)) spd = 0;

		var label = null;
		if (st.mode === '智能' || st.mode === _('智能')) {
			label = _('智能');
			this.refs.statusText.textContent = _('AI 智能动态调谐');
			this.hideStepless();
		} else if (st.mode === '无极' || st.mode === _('无极')) {
			label = _('无极');
			this.refs.statusText.textContent = _('线性自定义调度');
			this.refs.sliderBox.classList.add('active');
			this.refs.sliderCtrl.value = String(spd);
			this.refs.sliderBadge.textContent = 'PWM ' + spd + ' (' + Math.round((spd / 255) * 100) + '%)';
		} else {
			var map = { 64: _('静音'), 128: _('巡航'), 192: _('强冷'), 255: _('全速') };
			label = map[spd] || null;
			this.refs.statusText.textContent = _('固定风道: ') + (label || 'PWM ' + spd);
			this.hideStepless();
		}

		this.highlightButton(label);
		this.updateTelemetry(spd);
	},

	applyTemp: function(tp) {
		var t = tp.temp;
		if (t && t !== 'null' && t !== '') {
			this.currentTemp = parseFloat(t);
			this.refs.thermalBadge.textContent =
				(tp.source && tp.source !== _('智能')) ? _('热源: ') + tp.source : _('动态热源感知');
		} else {
			this.refs.thermalBadge.textContent = _('传感器自检中…');
		}
	},

	applyTemps: function(temps) {
		var labels = { cpu: 'CPU 核心', wifi: 'Wi-Fi 射频', phy: '网络交换', modem: _('5G/基带') };
		var grid = this.refs.sensorsGrid;
		var maxTemp = -1, maxKey = '';

		Object.keys(labels).forEach(function(k) {
			if (temps[k] !== undefined) {
				var tv = parseInt(temps[k], 10);
				if (!isNaN(tv) && tv > maxTemp) { maxTemp = tv; maxKey = k; }
			}
		});

		dom.content(grid, '');
		Object.keys(labels).forEach(function(k) {
			if (temps[k] === undefined) return;
			var tv = parseInt(temps[k], 10);
			if (isNaN(tv)) return;

			var color = tv > 75 ? '#ef4444' : (tv > 55 ? '#f59e0b' : '#10b981');
			var pct = Math.min(Math.max((tv / 100) * 100, 6), 100);

			var card = E('div', { 'class': 'gf-sensor-card' + (k === maxKey ? ' hotspot' : '') }, [
				E('div', { 'class': 'gf-sc-top' }, [
					E('span', {}, labels[k]),
					k === maxKey ? E('span', { 'class': 'gf-sc-tag' }, 'PEAK') : ''
				]),
				E('div', { 'class': 'gf-sc-val', 'style': 'color:' + color }, [
					String(tv),
					E('span', { 'class': 'gf-sc-unit' }, '°C')
				]),
				E('div', { 'class': 'gf-sc-bar' }, [
					E('div', {
						'class': 'gf-sc-fill',
						'style': 'width:' + pct + '%; background:' + color
					})
				])
			]);
			grid.appendChild(card);
		});
	},

	/* ---------- 物理遥测演算 & 渲染更新 ---------- */

	updateTelemetry: function(speed) {
		this.currentSpeed = speed;
		var pct = Math.round((speed / 255) * 100);
		this.refs.heroPct.textContent = pct + '%';

		// 校准真实的转速区间 (0 ~ 2800 RPM，适合静音风扇)
		var rpm = speed === 0 ? 0 : Math.round(550 + (speed / 255) * 2250);
		var dba = speed === 0 ? 0 : (12.0 + (speed / 255) * 16.5).toFixed(1);
		var cfm = (speed === 0 ? 0 : (0.3 + (speed / 255) * 1.5)).toFixed(1);

		var desc = _('已停机待命');
		if (speed > 220) desc = _('全速除热 · 满载强冷');
		else if (speed > 160) desc = _('增压散热 · 快速降温');
		else if (speed > 90) desc = _('恒温巡航 · 均衡风道');
		else if (speed > 0) desc = _('静音微风 · 超低功耗');

		this.refs.heroDesc.textContent = desc;
		this.refs.chipRpm.textContent = rpm.toLocaleString() + ' RPM';
		this.refs.chipDba.textContent = speed === 0 ? '< 10 dBA' : '~' + dba + ' dBA';
		this.refs.chipFlow.textContent = cfm + ' CFM';

		// 动态进度弧 (周长约为 603.2)
		if (this.refs.arc) {
			var offset = 603.2 - ((speed / 255) * 603.2);
			this.refs.arc.style.strokeDashoffset = String(offset);
		}

		// v11: 陶瓷扇叶转速 + 气流涟漪联动（真实占空比驱动，停机冻结）
		var running = speed > 0;
		var ratio = speed / 255;

		var rotor = this.refs.rotor;
		if (rotor) {
			rotor.style.animationDuration = running ?
				Math.max(0.24, (1 - ratio) * 1.16 + 0.24).toFixed(2) + 's' : '0.75s';
			rotor.style.animationPlayState = running ? 'running' : 'paused';
		}

		if (this.refs.ripples && this.refs.ripples.length) {
			var speedFactor = 1.4 - 0.8 * ratio;   // 占空比越高，涟漪脉动越快
			for (var ri = 0; ri < this.refs.ripples.length; ri++) {
				var ripple = this.refs.ripples[ri];
				ripple.style.animationDuration = (2.2 * speedFactor).toFixed(2) + 's';
				ripple.style.animationPlayState = running ? 'running' : 'paused';
			}
		}
	}
});
