/* Verification harness for solar-system.html
 * Extracts the pure ephemeris core from the page and checks it against
 * (a) an independently coded solar-position formula (Meeus ch.25)
 * (b) well-established astronomical reference events
 * Run: node verify-ephemeris.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'solar-system.html'), 'utf8');

/* ---------- 0. whole-script syntax check ---------- */
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
blocks.forEach((b, i) => new Function(b));   // throws on syntax error
console.log(`[syntax] ${blocks.length} script block(s) compile OK\n`);

/* ---------- 1. extract the ephemeris core ---------- */
const core = html.split('/* ===== EPHEMERIS CORE START ===== */')[1]
                 .split('/* ===== EPHEMERIS CORE END ===== */')[0];
const api = new Function(core + `
  return { ELEMENTS, BODY_META, PLANET_IDS, DEG, AU_KM, J2000,
           heliocentric, moonGeocentric, bodyPosition, bodyVelocity,
           orbitPoints, julianFromDate, dateFromJulian, eclipticLonLat, elementsAt };`)();

const { DEG, AU_KM, bodyPosition, moonGeocentric, ELEMENTS, PLANET_IDS, eclipticLonLat } = api;
const d2r = DEG, norm360 = x => ((x % 360) + 360) % 360, wrap180 = x => ((x + 180) % 360 + 360) % 360 - 180;
const JD = s => api.julianFromDate(Date.parse(s + 'Z'));   // UTC
const TT_OFF = 69.184 / 86400;                              // UTC -> TT (good enough 2000-2030)

let pass = 0, fail = 0;
function check(name, actual, lo, hi, unit, note){
  const good = actual >= lo && actual <= hi;
  good ? pass++ : fail++;
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${good ? ' PASS' : '*FAIL'}  ${pad(name, 34)} ${pad(actual.toFixed ? actual.toFixed(4) : actual, 12)}${unit || ''}  期望 [${lo}, ${hi}]${note ? '  ' + note : ''}`);
}
function report(name, text){ console.log(`  ...   ${name}: ${text}`); }

/* ---------- 2. independent solar longitude (Meeus ch.25, mean equinox of date) ---------- */
function sunTrueLongitude(jdTT){
  const T = (jdTT - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M  = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C  = (1.914602 - 0.004817*T - 0.000014*T*T) * Math.sin(M*d2r)
           + (0.019993 - 0.000101*T) * Math.sin(2*M*d2r)
           + 0.000289 * Math.sin(3*M*d2r);
  return norm360(L0 + C);
}
// general precession in longitude (deg), J2000 -> equinox of date
function precession(T){ return (5028.796195 * T + 1.1054348 * T * T) / 3600; }

console.log('== 太阳几何黄经：本页模型 vs 独立 Meeus 公式 ==');
let worst = 0;
for (let y = 1800; y <= 2050; y += 10){
  for (const md of ['01-15', '07-15']){
    const jd = JD(`${y}-${md}T00:00:00`);
    const T  = (jd + TT_OFF - 2451545) / 36525;
    const [ex, ey] = bodyPosition('earth', jd);
    const mine = norm360(Math.atan2(-ey, -ex) / d2r + precession(T));   // J2000 -> of date
    const diff = Math.abs(wrap180(mine - sunTrueLongitude(jd + TT_OFF)));
    worst = Math.max(worst, diff);
  }
}
check('太阳黄经最大偏差(1800-2050)', worst, 0, 0.030, '°', 'vs Meeus ch.25');

/* ---------- 3. Earth perihelion / aphelion ---------- */
console.log('\n== 地球近日点 / 远日点 ==');
function refine(f, t0, half, dir){          // ternary search for min (dir=1) or max (dir=-1)
  let a = t0 - half, b = t0 + half;
  for (let i = 0; i < 60; i++){
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (dir * f(m1) < dir * f(m2)) b = m2; else a = m1;
  }
  return (a + b) / 2;
}
function scanExtreme(f, t0, days, dir){
  let best = t0, bv = dir * f(t0);
  for (let d = -days; d <= days; d += 0.25){
    const v = dir * f(t0 + d);
    if (v < bv){ bv = v; best = t0 + d; }
  }
  return refine(f, best, 0.3, dir);
}
const earthR = jd => Math.hypot(...bodyPosition('earth', jd));
const peri2024 = scanExtreme(earthR, JD('2024-01-04T00:00:00'), 12, 1);
report('2024 近日点', api.dateFromJulian(peri2024).toISOString().slice(0, 16) + ' UTC  (地球质心实际 2024-01-03 00:39)');
// NOTE: JPL's elements describe the Earth-Moon BARYCENTRE, while almanacs quote the
// geocentre. The Moon displaces the barycentre by up to 4700 km, which moves the
// instant of minimum distance by up to ~2 days because dr/dt = 0 at perihelion.
check('近日点时刻误差(质心定义)', Math.abs(peri2024 - JD('2024-01-03T00:38:00')) * 24, 0, 48, ' 小时', '月球引起的固有歧义');
check('近日点距离', earthR(peri2024), 0.98320, 0.98340, ' AU', '实际 0.98330');
const aph2024 = scanExtreme(earthR, JD('2024-07-05T00:00:00'), 12, -1);
report('2024 远日点', api.dateFromJulian(aph2024).toISOString().slice(0, 16) + ' UTC  (实际 2024-07-05 05:06)');
check('远日点距离', earthR(aph2024), 1.01660, 1.01680, ' AU', '实际 1.01669');

/* ---------- 4. Earth orbital speed ---------- */
console.log('\n== 地球公转速度 ==');
const speedKmS = (id, jd) => Math.hypot(...api.bodyVelocity(id, jd)) * AU_KM / 86400;
check('近日点速度', speedKmS('earth', peri2024), 30.20, 30.35, ' km/s', '实际 30.29');
check('远日点速度', speedKmS('earth', aph2024), 29.20, 29.35, ' km/s', '实际 29.29');
check('平均速度',     speedKmS('earth', JD('2024-04-04T00:00:00')), 29.6, 29.9, ' km/s', '实际 29.78');

/* ---------- 5. Mars / Jupiter / Saturn closest approach ----------
 * Reference = date of minimum geocentric distance (= closest approach, which is
 * NOT the same as the opposition date: for Mars 2025 they differ by 4 days). */
console.log('\n== 地心最近距（近地点式接近，非冲日当天）==');
const geoDist = id => jd => {
  const p = bodyPosition(id, jd), e = bodyPosition('earth', jd);
  return Math.hypot(p[0]-e[0], p[1]-e[1], p[2]-e[2]);
};
const oppo = [
  ['mars',    '2025-01-12', '2025-01-12', 0.642],   // 冲日 01-16，最近 01-12
  ['jupiter', '2024-12-06', '2024-12-06', 4.089],
  ['saturn',  '2024-09-08', '2024-09-08', null]
];
for (const [id, date, real, km] of oppo){
  const t = scanExtreme(geoDist(id), JD(date + 'T00:00:00'), 10, 1);
  const errDays = Math.abs(t - JD(real + 'T00:00:00'));
  report(`${id} 最近距`, api.dateFromJulian(t).toISOString().slice(0,16) + ` UTC (实际 ${real})  距离 ${geoDist(id)(t).toFixed(4)} AU`);
  check(`${id} 最近距时刻误差`, errDays, 0, 1.0, ' 天');
  if (km) check(`${id} 最近距数值`, geoDist(id)(t), km - 0.004, km + 0.004, ' AU', `实际 ${km}`);
}

/* ---------- 6. Lunar theory: new moons (solar eclipses) ---------- */
console.log('\n== 朔（日月黄经相合）与月距 ==');
function elong(jd){                       // Moon longitude - Sun longitude (deg, -180..180)
  const m = moonGeocentric(jd);
  const e = bodyPosition('earth', jd);
  const [ml] = eclipticLonLat([m[0], m[1], m[2]]);
  const [sl] = eclipticLonLat([-e[0], -e[1], -e[2]]);
  return wrap180(ml - sl);
}
function findNewMoon(t0){
  let a = t0 - 2, b = t0;
  while (elong(b) < 0) b += 0.1;
  while (elong(a) > 0) a -= 0.1;
  for (let i = 0; i < 80; i++){ const m = (a+b)/2; (elong(m) < 0 ? a = m : b = m); }
  return (a+b)/2;
}
const newMoons = [
  ['2024-04-08T18:21:00', '2024-04-08 日全食'],
  ['2024-06-06T12:38:00', '2024-06-06 朔'],
  ['2025-03-29T10:58:00', '2025-03-29 日偏食']
];
for (const [iso, label] of newMoons){
  const t = findNewMoon(JD(iso) + 1.5);
  const errMin = (t - JD(iso)) * 1440;
  report(label, api.dateFromJulian(t).toISOString().slice(0,16) + ' UTC');
  check(`${label} 时刻误差`, Math.abs(errMin), 0, 6, ' 分钟', '(实际值取自天文年历)');
}
// 2024-04-08 total eclipse: Moon must be near the ecliptic (small latitude)
{
  const t = findNewMoon(JD('2024-04-08T18:21:00') + 1.5);
  const m = moonGeocentric(t);
  const [, lat] = eclipticLonLat([m[0], m[1], m[2]]);
  report('2024-04-08 朔时月球黄纬', lat.toFixed(3) + '°  (日全食 gamma=0.343 → 应接近 0)');
  check('朔时月球黄纬', Math.abs(lat), 0, 0.55, '°');
}
// distance extremes over 2024
{
  let mn = 1e9, mx = 0, tmn = 0, tmx = 0;
  for (let d = 0; d < 366; d += 0.05){
    const jd = JD('2024-01-01T00:00:00') + d;
    const r = moonGeocentric(jd)[3];
    if (r < mn){ mn = r; tmn = jd; }
    if (r > mx){ mx = r; tmx = jd; }
  }
  report('2024 近地点', api.dateFromJulian(tmn).toISOString().slice(0,10) + '  ' + mn.toFixed(0) + ' km');
  report('2024 远地点', api.dateFromJulian(tmx).toISOString().slice(0,10) + '  ' + mx.toFixed(0) + ' km');
  check('月地距最小值', mn, 356000, 357500, ' km', '实际 2024 最小约 356,400');
  check('月地距最大值', mx, 405500, 407000, ' km', '实际约 406,200（截断级数精度 ~0.1%）');
  check('月地距极差', mx - mn, 49000, 51000, ' km', '实际约 49,800');
}

/* ---------- 7. Synodic periods from mean motions ---------- */
console.log('\n== 会合周期（由根数平均运动导出）==');
const synReal = { mercury:115.88, venus:583.92, mars:779.94, jupiter:398.88, saturn:378.09, uranus:369.66, neptune:367.49 };
for (const id of PLANET_IDS){
  if (!synReal[id]) continue;
  const P1 = Math.pow(ELEMENTS[id].a, 1.5) * 365.25;
  const P2 = Math.pow(ELEMENTS.earth.a, 1.5) * 365.25;
  const S  = 1 / Math.abs(1/P1 - 1/P2);
  check(`${id} 会合周期`, S, synReal[id] - 0.6, synReal[id] + 0.6, ' 天', `实际 ${synReal[id]}`);
}

/* ---------- 8. orbit shapes ---------- */
console.log('\n== 轨道极值 ==');
function distRange(id, days){
  let mn = 1e9, mx = 0;
  for (let d = 0; d < days; d += days/4000){
    const p = bodyPosition(id, JD('2000-01-01T12:00:00') + d);
    const r = Math.hypot(p[0], p[1], p[2]);
    mn = Math.min(mn, r); mx = Math.max(mx, r);
  }
  return [mn, mx];
}
for (const [id, lo, hi] of [['mercury',0.3075,0.4667],['venus',0.7184,0.7282],['pluto',29.658,49.305]]){
  const [mn, mx] = distRange(id, Math.pow(ELEMENTS[id].a, 1.5) * 365.25 * 1.001);
  const tol = id === 'pluto' ? 0.008 : 0.002;   // Pluto: 简化根数精度最低
  report(id, `近日 ${mn.toFixed(4)} AU / 远日 ${mx.toFixed(4)} AU`);
  check(`${id} 近日点`, mn, lo - tol, lo + tol, ' AU');
  check(`${id} 远日点`, mx, hi - tol, hi + tol, ' AU');
}

/* ---------- 9. sample positions for the record ---------- */
console.log('\n== 采样输出（日心黄道 J2000, AU）==');
for (const iso of ['2000-01-01T12:00:00', '2024-06-01T00:00:00', '2030-01-01T00:00:00']){
  const jd = JD(iso);
  const line = ['earth','mars','jupiter'].map(id => {
    const p = bodyPosition(id, jd);
    const [lon, lat, r] = eclipticLonLat(p);
    return `${id}: r=${r.toFixed(5)}AU λ=${lon.toFixed(3)}° β=${lat.toFixed(3)}°`;
  }).join('   ');
  console.log(`  ${iso}Z  ${line}`);
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
