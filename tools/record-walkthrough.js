/**
 * Records the training walkthrough for nurses: the real site, driven on a
 * phone-sized screen, with Arabic captions over the page and a ripple marking
 * every tap. No mock-ups — every screen is the running site.
 *
 * Re-run it whenever the pages change, so the video never teaches a screen
 * that no longer exists.
 *
 *   node server.js &                       # on port 3111, with an empty database
 *   npm i --no-save playwright-core        # if it is not already installed
 *   node tools/record-walkthrough.js       # writes video/walkthrough.webm
 *   ffmpeg -i video/walkthrough.webm -c:v libx264 -pix_fmt yuv420p \
 *          -preset slow -crf 23 -movflags +faststart video/nurse-guide-ar.mp4
 *
 * Point BASE at a local instance, never at production: it registers a nurse
 * and submits a competency, which would otherwise land in the real records.
 */
const { chromium, devices } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3111';
const OUT = path.join(process.cwd(), 'video');
const PHONE = devices['iPhone 12 Pro'];

/** Caption bar, step chip and tap ripple, injected into every page. */
const OVERLAY = () => {
  const style = document.createElement('style');
  style.textContent = `
    #vid-cap {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
      background: linear-gradient(transparent, rgba(8,26,36,.93) 22%);
      color: #fff; padding: 34px 18px 20px; pointer-events: none;
      font: 600 19px/1.5 "Segoe UI","Noto Naskh Arabic",Tahoma,sans-serif;
      direction: rtl; text-align: center; opacity: 0;
      transition: opacity .35s ease;
    }
    #vid-cap.on { opacity: 1; }
    #vid-step {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: #0b4459; color: #fff; pointer-events: none;
      font: 700 13px/1 "Segoe UI",Tahoma,sans-serif; direction: rtl;
      padding: 9px 16px; display: flex; justify-content: space-between;
      opacity: 0; transition: opacity .3s ease;
    }
    #vid-step.on { opacity: 1; }
    .vid-tap {
      position: fixed; z-index: 2147483646; width: 62px; height: 62px;
      margin: -31px 0 0 -31px; border-radius: 50%; pointer-events: none;
      background: rgba(15,92,122,.30); border: 3px solid rgba(15,92,122,.85);
      animation: vid-ripple .65s ease-out forwards;
    }
    @keyframes vid-ripple {
      from { transform: scale(.35); opacity: 1; }
      to   { transform: scale(1.25); opacity: 0; }
    }
    #vid-card {
      position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
      background: #0b4459; color: #fff; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 14px; padding: 40px;
      text-align: center; direction: rtl; opacity: 0;
      transition: opacity .5s ease;
      font-family: "Segoe UI","Noto Naskh Arabic",Tahoma,sans-serif;
    }
    #vid-card.on { opacity: 1; }
    #vid-card .t { font-size: 30px; font-weight: 800; line-height: 1.35; }
    #vid-card .s { font-size: 18px; opacity: .85; line-height: 1.6; white-space: pre-line; }
  `;
  const add = () => {
    if (document.getElementById('vid-cap')) return;
    document.head.appendChild(style);
    for (const [id, html] of [
      ['vid-step', '<span id="vid-step-l"></span><span id="vid-step-r"></span>'],
      ['vid-cap', ''],
      ['vid-card', '<div class="t">تقييم الكفاءة التمريضية</div>'
        + '<div class="s">مستشفى الحديثة العام — قسم الخدمات التمريضية\n'
        + 'طريقة أداء الكفاءة من الهاتف</div>'],
    ]) {
      const node = document.createElement('div');
      node.id = id;
      node.innerHTML = html;
      // The init script re-runs on every navigation, so the flag has to
      // outlive the page: sessionStorage keeps the intro to the first load.
      let introDone = false;
      try { introDone = sessionStorage.getItem('vidIntroDone') === '1'; }
      catch (e) { /* storage blocked */ }
      if (id === 'vid-card' && !introDone) node.classList.add('on');
      document.body.appendChild(node);
    }
  };
  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add);

  window.vidCaption = (text, step, total) => {
    const cap = document.getElementById('vid-cap');
    const bar = document.getElementById('vid-step');
    cap.textContent = text;
    cap.classList.toggle('on', !!text);
    if (step) {
      document.getElementById('vid-step-l').textContent = `خطوة ${step} من ${total}`;
      document.getElementById('vid-step-r').textContent = 'تقييم الكفاءة التمريضية';
      bar.classList.add('on');
    }
  };
  window.vidTap = (x, y) => {
    const dot = document.createElement('div');
    dot.className = 'vid-tap';
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 700);
  };
  window.vidCard = (title, sub) => {
    const card = document.getElementById('vid-card');
    card.querySelector('.t').textContent = title || '';
    card.querySelector('.s').textContent = sub || '';
    card.classList.toggle('on', !!title);
  };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const ctx = await browser.newContext({
    ...PHONE,
    locale: 'ar',
    recordVideo: { dir: OUT, size: { width: 540, height: 1170 } },
  });
  await ctx.addInitScript(OVERLAY);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('competency.lang', 'ar'); } catch (e) { /* */ }
  });

  const page = await ctx.newPage();
  // A repeat run would meet the "you already sat this" confirm; accept it so a
  // re-record never stalls.
  page.on('dialog', (d) => d.accept());
  let step = 0;
  const TOTAL = 8;

  const say = async (text, hold = 3000, advance = true) => {
    if (advance) step += 1;
    await page.evaluate(([t, s, n]) => window.vidCaption(t, s, n),
      [text, step, TOTAL]);
    await wait(hold);
  };
  const card = async (title, sub, hold = 3200) => {
    await page.evaluate(([t, s]) => window.vidCard(t, s), [title, sub]);
    await wait(hold);
    await page.evaluate(() => window.vidCard('', ''));
    await wait(400);
  };
  /** Tap an element with a visible ripple, the way a finger would. */
  const tap = async (selector, pause = 900) => {
    const box = await page.locator(selector).first().boundingBox();
    if (box) {
      await page.evaluate(([x, y]) => window.vidTap(x, y),
        [box.x + box.width / 2, box.y + box.height / 2]);
      await wait(320);
    }
    await page.locator(selector).first().click();
    await wait(pause);
  };
  const type = async (selector, value, delay = 90) => {
    const box = await page.locator(selector).boundingBox();
    if (box) {
      await page.evaluate(([x, y]) => window.vidTap(x, y),
        [box.x + box.width / 2, box.y + box.height / 2]);
      await wait(280);
    }
    await page.locator(selector).click();
    await page.locator(selector).pressSequentially(value, { delay });
    await wait(600);
  };

  // --- open ---------------------------------------------------------------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await wait(4200);                       // the opening card is already up
  await page.evaluate(() => {
    try { sessionStorage.setItem('vidIntroDone', '1'); } catch (e) { /* */ }
    window.vidCard('', '');
  });
  await wait(500);

  await say('افتح الموقع من متصفح هاتفك.', 2600);
  await wait(400);

  // --- register -----------------------------------------------------------
  await say('أدخل رقمك الوظيفي أولًا.', 2200);
  await type('#jobNumber', 'AGH-2045');

  await say('ثم اكتب اسمك.', 1800);
  await type('#name', 'نورة العتيبي');

  await say('أكمل المسمى الوظيفي والوحدة.', 2000, false);
  await type('#jobTitle', 'ممرض/ة', 70);
  await type('#unit', 'الطوارئ', 70);
  await wait(500);

  await say('اضغط "حفظ البيانات واختيار الكفاءة".', 2400);
  await tap('#register-form button[type=submit]', 1500);
  await page.waitForSelector('#picker-card:not([hidden])');
  await wait(900);

  // --- pick a competency --------------------------------------------------
  await say('اختر الكفاءة المطلوبة، أو ابحث عنها بالاسم.', 2800);
  await type('#search', 'triage', 110);
  await wait(1200);
  await say('اضغط على اسم الكفاءة لبدء الاختبار.', 2400, false);
  await tap('.form-item', 1800);
  await page.waitForSelector('#question-card:not([hidden])', { timeout: 15000 });
  await wait(1000);

  // --- answering ----------------------------------------------------------
  await say('يظهر بند واحد في كل شاشة، مع ترجمته العربية أسفله.', 3600);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await wait(800);

  await say('اختر التقدير بضغطة واحدة: مستوفى، غير مستوفى، أو لا ينطبق.', 3600);
  await tap('.rate-row .rate:first-child', 1200);
  await say('ينتقل تلقائيًا إلى البند التالي بعد كل إجابة.', 3000, false);
  await tap('.rate-row .rate:first-child', 1100);
  await tap('.rate-row .rate:nth-child(2)', 1100);
  await tap('.rate-row .rate:first-child', 900);

  // The rest at a natural tapping rhythm, to show the pace of a real sitting.
  await page.evaluate(() => window.vidCaption('تابع حتى نهاية البنود.'));
  const left = await page.evaluate(() => items.length - Object.keys(answers).length);
  for (let i = 0; i < left; i += 1) {
    const sel = '.rate-row .rate:first-child';
    const visible = await page.locator(sel).first().isVisible().catch(() => false);
    if (!visible) break;
    await tap(sel, 420);
  }
  await page.waitForSelector('#review-card:not([hidden])', { timeout: 15000 });
  await wait(1000);

  // --- review and submit --------------------------------------------------
  await say('راجع إجاباتك، ويمكنك تعديل أي بند بالضغط عليه.', 3400);
  await page.evaluate(() => window.scrollTo({ top: 260, behavior: 'smooth' }));
  await wait(1800);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await wait(1000);

  await say('ثم اضغط "إرسال الكفاءة".', 2600);
  await tap('#submit', 2200);
  await page.waitForSelector('#result-card:not([hidden])', { timeout: 15000 });
  await wait(800);

  // --- result -------------------------------------------------------------
  await say('تظهر نتيجتك مباشرة: الدرجة والنسبة المئوية.', 4000);
  await wait(1200);
  await page.evaluate(() => window.vidCaption(''));
  await wait(600);

  await card('تم الإرسال بنجاح',
    'يصل النموذج إلى قسم التمريض للمراجعة والتوقيع.\nيمكنك أداء كفاءة أخرى في أي وقت.', 4600);

  await ctx.close();
  await browser.close();

  const file = fs.readdirSync(OUT).find((f) => f.endsWith('.webm'));
  fs.renameSync(path.join(OUT, file), path.join(OUT, 'walkthrough.webm'));
  console.log('recorded:', path.join(OUT, 'walkthrough.webm'));
}

run().catch((error) => { console.error(error); process.exit(1); });
