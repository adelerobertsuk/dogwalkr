(function () {
  'use strict';

  var TABS = [
    { id: 'app', label: 'Activity Tracker', href: 'app.html' },
    { id: 'fuel', label: 'Fuel & Nutrition', href: 'fuel.html' },
    { id: 'condition', label: 'Conditioning Splits', href: 'condition.html' }
  ];

  var HELP_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="10"/>' +
    '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>' +
    '<line x1="12" y1="17" x2="12.01" y2="17"/>' +
    '</svg>';

  var CLOSE_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
    '</svg>';

  var INDEX_FAQ = [
    {
      title: 'The DogWalkr Suite',
      body: 'Three connected tools for active dogs: Activity Tracker syncs Strava walks and coaches recovery, Fuel & Nutrition builds clinical meal plans, and Conditioning Splits plans progressive stamina blocks.'
    },
    {
      title: 'Activity Tracker',
      body: 'Connect Strava to auto-sync walks, attribute them to your dogs, and get rolling 7-day recovery coaching based on real activity load.'
    },
    {
      title: 'Fuel & Nutrition',
      body: 'Enter your dog\'s profile to calculate daily energy requirements and generate framework-specific meal breakdowns with a printable grocery list.'
    },
    {
      title: 'Conditioning Splits',
      body: 'Build joint-safe, progressive weekly volume plans with thermal guardrails, terrain splits, and printable week-by-week schedules.'
    },
    {
      title: 'Beta Access',
      body: 'DogWalkr is in pioneer beta. Join the waitlist from the homepage to get early access to the Activity Tracker app.'
    }
  ];

  var APP_FAQ = [
    {
      title: 'Strava Auto-Sync',
      body: 'Connect Strava in Settings to pull walks automatically. Dogwalkr uses true elapsed time so your dog gets credit for the full outing, not just moving time.'
    },
    {
      title: 'Recovery Coaching',
      body: 'The status badge reads your dog\'s rolling 7-day activity to recommend Rest, Recovery, Active, or Ready. Tap it to see the full breakdown.'
    },
    {
      title: 'Pack Mode',
      body: 'Tag a walk with more than one dog and it counts for the whole pack at once. Use hashtags in the walk title or select dogs when logging manually.'
    },
    {
      title: 'Household Food Log',
      body: 'The Food tab keeps a shared feeding log synced across every phone in your household. Log what was fed, how much, and who fed it.'
    },
    {
      title: 'Suite Tools',
      body: 'Use the navigation bar to open Fuel & Nutrition for meal planning, or Conditioning Splits for progressive volume plans alongside your activity data.'
    }
  ];

  function resolveTheme(explicit, active) {
    if (explicit === 'dark' || explicit === 'light') return explicit;
    if (active === '' || active === 'home') return 'dark';
    return 'light';
  }

  function navClassName(theme) {
    return 'suite-nav no-print' + (theme === 'dark' ? ' suite-nav--dark' : '');
  }

  function buildTabsHtml(active) {
    return TABS.map(function (tab) {
      var isActive = tab.id === active;
      return (
        '<a href="' + tab.href + '" class="suite-nav__tab' + (isActive ? ' suite-nav__tab--active' : '') + '">' +
        tab.label +
        '</a>'
      );
    }).join('');
  }

  function buildNavHtml(active, theme) {
    return (
      '<nav class="' + navClassName(theme) + '" aria-label="DogWalkr suite navigation">' +
        '<div class="suite-nav__inner">' +
          '<a href="index.html" class="suite-nav__brand">' +
            '<img src="dogwalkr-icon.png" alt="" class="suite-nav__logo" />' +
            '<span class="suite-nav__wordmark">DogWalkr</span>' +
          '</a>' +
          '<div class="suite-nav__tabs" role="navigation">' + buildTabsHtml(active) + '</div>' +
          '<button type="button" class="suite-nav__help" id="suite-nav-help-btn" aria-label="Help and diagnostics">' +
            HELP_ICON +
          '</button>' +
        '</div>' +
      '</nav>'
    );
  }

  function buildDrawerHtml(sections) {
    var body = sections.map(function (s) {
      return (
        '<section class="suite-drawer__section">' +
          '<h3>' + s.title + '</h3>' +
          '<p>' + s.body + '</p>' +
        '</section>'
      );
    }).join('');

    return (
      '<div id="suite-drawer-root" hidden>' +
        '<div class="suite-drawer-overlay" id="suite-drawer-overlay"></div>' +
        '<aside class="suite-drawer" role="dialog" aria-labelledby="suite-drawer-title">' +
          '<div class="suite-drawer__header">' +
            '<span class="suite-drawer__title" id="suite-drawer-title">Help & Diagnostics</span>' +
            '<button type="button" class="suite-drawer__close" id="suite-drawer-close" aria-label="Close">' + CLOSE_ICON + '</button>' +
          '</div>' +
          '<div class="suite-drawer__body">' + body + '</div>' +
        '</aside>' +
      '</div>'
    );
  }

  function wireDrawer(onCustomHelp) {
    var helpBtn = document.getElementById('suite-nav-help-btn');
    if (!helpBtn) return;

    helpBtn.addEventListener('click', function () {
      if (typeof onCustomHelp === 'function') {
        onCustomHelp();
        return;
      }
      document.dispatchEvent(new CustomEvent('suite-nav:help'));
    });
  }

  function openStaticDrawer() {
    var root = document.getElementById('suite-drawer-root');
    if (!root) return;
    root.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeStaticDrawer() {
    var root = document.getElementById('suite-drawer-root');
    if (!root) return;
    root.hidden = true;
    document.body.style.overflow = '';
  }

  function wireStaticDrawer() {
    var overlay = document.getElementById('suite-drawer-overlay');
    var closeBtn = document.getElementById('suite-drawer-close');
    if (overlay) overlay.addEventListener('click', closeStaticDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeStaticDrawer);
    document.addEventListener('suite-nav:help', openStaticDrawer);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeStaticDrawer();
    });
  }

  function mountStatic(active, includeDrawer, theme) {
    var resolvedTheme = resolveTheme(theme, active);
    var mount = document.createElement('div');
    mount.innerHTML = buildNavHtml(active, resolvedTheme);
    document.body.insertBefore(mount.firstChild, document.body.firstChild);

    if (resolvedTheme === 'dark') {
      document.body.classList.add('suite-nav-page--dark');
    }

    if (includeDrawer) {
      var faq = active === 'app' ? APP_FAQ : INDEX_FAQ;
      var drawerMount = document.createElement('div');
      drawerMount.innerHTML = buildDrawerHtml(faq);
      document.body.appendChild(drawerMount.firstChild);
      wireStaticDrawer();
    }

    wireDrawer(includeDrawer ? null : undefined);
  }

  var HelpIcon = function () {
    return React.createElement(
      'svg',
      { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
      React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
      React.createElement('path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }),
      React.createElement('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 })
    );
  };

  /* React component for fuel.html & condition.html */
  if (window.React) {
    window.SuiteNav = function SuiteNav(props) {
      var active = props.active || '';
      var onHelp = props.onHelp;
      var theme = resolveTheme(props.theme, active);

      return React.createElement(
        'nav',
        { className: navClassName(theme), 'aria-label': 'DogWalkr suite navigation' },
        React.createElement(
          'div',
          { className: 'suite-nav__inner' },
          React.createElement(
            'a',
            { href: 'index.html', className: 'suite-nav__brand' },
            React.createElement('img', { src: 'dogwalkr-icon.png', alt: '', className: 'suite-nav__logo' }),
            React.createElement('span', { className: 'suite-nav__wordmark' }, 'DogWalkr')
          ),
          React.createElement(
            'div',
            { className: 'suite-nav__tabs', role: 'navigation' },
            TABS.map(function (tab) {
              return React.createElement(
                'a',
                {
                  key: tab.id,
                  href: tab.href,
                  className: 'suite-nav__tab' + (tab.id === active ? ' suite-nav__tab--active' : '')
                },
                tab.label
              );
            })
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'suite-nav__help',
              'aria-label': 'Help and diagnostics',
              onClick: function () {
                if (typeof onHelp === 'function') onHelp();
                else document.dispatchEvent(new CustomEvent('suite-nav:help'));
              }
            },
            React.createElement(HelpIcon)
          )
        )
      );
    };
  }

  /* Auto-mount for static pages (index.html) */
  var script = document.currentScript;
  if (script && script.dataset.autoMount !== 'false') {
    var activePage = script.dataset.active || '';
    var withDrawer = script.dataset.drawer === 'true';
    var navTheme = script.dataset.theme || '';
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        mountStatic(activePage, withDrawer, navTheme);
      });
    } else {
      mountStatic(activePage, withDrawer, navTheme);
    }
  }
})();
