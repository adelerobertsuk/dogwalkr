/*
 * DogWalkr — "Help & Strava Tips" bottom sheet
 * ---------------------------------------------------------------------------
 * Shared, self-contained help sheet used by app.html and dogwalkr_feed.html.
 * Include the script, then add a trigger anywhere:
 *
 *   <button data-strava-tips aria-label="Help & Strava tips">?</button>
 *
 * or call window.openStravaTips() directly. Styling is fully self-contained
 * (injected <style>) so it looks identical on both pages regardless of their
 * own palette.
 */
(function () {
  'use strict';
  if (window.__stravaTipsLoaded) return;
  window.__stravaTipsLoaded = true;

  var CSS = [
    '.st-overlay{position:fixed;inset:0;background:rgba(9,9,11,.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);opacity:0;transition:opacity .25s ease;z-index:2147483000}',
    '.st-overlay.st-open{opacity:1}',
    '.st-sheet{position:fixed;left:0;right:0;bottom:0;z-index:2147483001;background:#fff;color:#18181b;',
      'font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif;',
      'border-radius:24px 24px 0 0;max-width:430px;margin:0 auto;box-shadow:0 -14px 50px rgba(0,0,0,.28);',
      'transform:translateY(101%);transition:transform .34s cubic-bezier(.16,1,.3,1);',
      'max-height:90vh;display:flex;flex-direction:column;overflow:hidden}',
    '.st-sheet.st-open{transform:translateY(0)}',
    '.st-grabber{width:36px;height:4px;border-radius:999px;background:#e4e4e7;margin:10px auto 2px}',
    '.st-head{display:flex;align-items:center;justify-content:space-between;padding:8px 20px 14px;border-bottom:1px solid #f4f4f5}',
    '.st-title{font-size:15px;font-weight:800;letter-spacing:-.01em}',
    '.st-x{border:0;background:#f4f4f5;color:#71717a;width:30px;height:30px;border-radius:999px;font-size:15px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center}',
    '.st-x:hover{background:#e4e4e7;color:#18181b}',
    '.st-body{padding:18px 20px 8px;overflow-y:auto;display:flex;flex-direction:column;gap:18px}',
    '.st-block h4{margin:0 0 6px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#f97316}',
    '.st-block p{margin:0;font-size:13px;line-height:1.55;color:#52525b}',
    '.st-strava{margin:8px 0 2px;display:flex;align-items:center;gap:8px;background:#fafafa;border:1px solid #ececec;border-radius:12px;padding:9px 11px;font-size:13px;font-weight:600;color:#3f3f46}',
    '.st-strava .st-orange{color:#fc4c02;font-weight:800}',
    '.st-strava .st-tag{color:#fc4c02;font-weight:800;background:rgba(252,76,2,.1);border-radius:6px;padding:1px 5px}',
    '.st-steps{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px;counter-reset:st}',
    '.st-steps li{position:relative;padding-left:30px;font-size:13px;line-height:1.5;color:#52525b}',
    '.st-steps li::before{counter-increment:st;content:counter(st);position:absolute;left:0;top:0;width:20px;height:20px;border-radius:999px;background:#18181b;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}',
    '.st-steps li b{color:#18181b;font-weight:700}',
    '.st-foot{padding:14px 20px max(env(safe-area-inset-bottom),16px)}',
    '.st-cta{width:100%;border:0;border-radius:14px;background:#18181b;color:#fff;font-size:14px;font-weight:800;padding:14px;cursor:pointer}',
    '.st-cta:hover{background:#000}'
  ].join('');

  var HTML =
    '<div class="st-grabber"></div>' +
    '<div class="st-head">' +
      '<span class="st-title">Help &amp; Strava Tips</span>' +
      '<button type="button" class="st-x" data-st-close aria-label="Close">&#10005;</button>' +
    '</div>' +
    '<div class="st-body">' +
      '<div class="st-block">' +
        '<h4>How to tag walks</h4>' +
        '<div class="st-strava"><span class="st-orange">Strava</span><span>Morning Park Loop <span class="st-tag">#Audrey</span></span></div>' +
        '<p>Add your dog&rsquo;s name as a hashtag in the Strava activity title or description. DogWalkr detects the tag and logs that walk straight to their profile &mdash; no second tracker needed.</p>' +
      '</div>' +
      '<div class="st-block">' +
        '<h4>Multi-dog packs</h4>' +
        '<div class="st-strava"><span class="st-orange">Strava</span><span>Whole crew out <span class="st-tag">#Audrey</span> <span class="st-tag">#Joe</span></span></div>' +
        '<p>Tag every dog you walked. DogWalkr splits the walk, elapsed time and paw steps to each tagged dog in your pack automatically.</p>' +
      '</div>' +
      '<div class="st-block">' +
        '<h4>Sync troubleshooting</h4>' +
        '<ul class="st-steps">' +
          '<li><b>Make the activity public.</b> Strava activities set to &ldquo;Only You&rdquo; or &ldquo;Followers&rdquo; can&rsquo;t be read &mdash; set visibility to Everyone.</li>' +
          '<li><b>Check the hashtag spelling.</b> It must match the dog&rsquo;s name exactly (e.g. <span class="st-tag">#Audrey</span>, not #Audery).</li>' +
          '<li><b>Elapsed vs moving time.</b> DogWalkr counts total elapsed time, so sniff stops and greetings still get credited &mdash; your dog&rsquo;s distance will read higher than your moving time.</li>' +
        '</ul>' +
      '</div>' +
    '</div>' +
    '<div class="st-foot"><button type="button" class="st-cta" data-st-close>Got it!</button></div>';

  var overlay, sheet, lastFocus;

  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.className = 'st-overlay';
    overlay.setAttribute('hidden', '');

    sheet = document.createElement('div');
    sheet.className = 'st-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Help and Strava tips');
    sheet.setAttribute('hidden', '');
    sheet.innerHTML = HTML;

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    overlay.addEventListener('click', close);
    sheet.addEventListener('click', function (e) {
      if (e.target.closest('[data-st-close]')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hasAttribute('hidden')) close();
    });
  }

  function open() {
    if (!sheet) build();
    lastFocus = document.activeElement;
    overlay.removeAttribute('hidden');
    sheet.removeAttribute('hidden');
    // next frame so the transition runs
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add('st-open');
        sheet.classList.add('st-open');
      });
    });
    document.body.style.overflow = 'hidden';
    var cta = sheet.querySelector('.st-cta');
    if (cta) cta.focus();
  }

  function close() {
    if (!sheet) return;
    overlay.classList.remove('st-open');
    sheet.classList.remove('st-open');
    document.body.style.overflow = '';
    setTimeout(function () {
      overlay.setAttribute('hidden', '');
      sheet.setAttribute('hidden', '');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }, 340);
  }

  window.openStravaTips = open;
  window.closeStravaTips = close;

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-strava-tips]');
    if (trigger) { e.preventDefault(); open(); }
  });
})();
