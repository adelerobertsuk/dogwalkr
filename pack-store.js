/*
 * DogWalkr — shared pack store
 * ---------------------------------------------------------------------------
 * A tiny localStorage-backed store so the three tools (Activity Tracker,
 * Fuel & Nutrition, Conditioning Splits) all read and write the SAME set of
 * dogs and the SAME "active" dog. Each page is a standalone static file, so
 * there is no shared runtime — localStorage + the `storage` event is the
 * glue. Changes made on one page/tab show up on the others immediately.
 *
 * app.html keeps Supabase as its source of truth and just mirrors the
 * resulting roster into this store; fuel.html and condition.html use this
 * store directly.
 *
 * API (window.DogwalkrPack):
 *   getDogs()                -> Dog[]                (always ≥ 1, seeded)
 *   setDogs(dogs)            -> Dog[]                (persists + notifies)
 *   upsertDog(dog)           -> Dog[]
 *   removeDog(id)            -> Dog[]
 *   getActiveDogId()         -> string
 *   setActiveDogId(id)       -> string
 *   getActiveDog()           -> Dog
 *   subscribe(fn)            -> unsubscribe()        (fires on any change,
 *                                                     same page or other tab)
 *   ageMonths(dob[, ref])    -> number | null
 *   DEFAULT_AVATAR
 *
 * Dog shape: { id, name, breed, weight, dob, best_trait, worst_trait, avatar }
 *   - weight is kilograms
 *   - dob is 'YYYY-MM-DD' (may be '')
 */
(function (global) {
  'use strict';

  var DOGS_KEY = 'dogwalkr_pack_v1';
  var ACTIVE_KEY = 'dogwalkr_active_dog_v1';

  var DEFAULT_AVATAR =
    'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=200&q=80';

  // Default household pack. Audrey + Charlie are placeholder seeds the user
  // edits in-app; Joe matches the Italian Greyhound already used in app.html.
  var DEFAULT_PACK = [
    {
      id: 'dog_audrey',
      name: 'Audrey',
      breed: 'Mixed Breed',
      weight: 14,
      dob: '2019-06-01',
      best_trait: 'Champion napper',
      worst_trait: 'Barks at the postman',
      avatar: DEFAULT_AVATAR
    },
    {
      id: 'dog_joe',
      name: 'Joe',
      breed: 'Italian Greyhound',
      weight: 5.8,
      dob: '2024-03-09',
      best_trait: 'Loves sprint zooms',
      worst_trait: 'Nibbles shoes',
      avatar: DEFAULT_AVATAR
    },
    {
      id: 'dog_charlie',
      name: 'Charlie',
      breed: 'Puppy',
      weight: 2.5,
      dob: '2026-07-15',
      best_trait: 'Tiny zoomies',
      worst_trait: 'Chews absolutely everything',
      avatar: DEFAULT_AVATAR
    }
  ];

  var listeners = [];

  function safeParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function readStorage(key) {
    try {
      return global.localStorage ? global.localStorage.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, value);
    } catch (e) {
      /* private mode / quota — store just becomes in-memory for the session */
    }
  }

  function normaliseDog(d, i) {
    d = d || {};
    return {
      id: d.id || 'dog_' + Date.now() + '_' + i,
      name: d.name || 'Dog',
      breed: d.breed || '',
      weight: Number(d.weight != null ? d.weight : d.weight_kg) || 0,
      dob: d.dob || '',
      best_trait: d.best_trait || '',
      worst_trait: d.worst_trait || '',
      avatar: d.avatar || DEFAULT_AVATAR
    };
  }

  var memoryDogs = null;
  var memoryActive = null;

  function getDogs() {
    if (memoryDogs) return memoryDogs.map(function (d) { return Object.assign({}, d); });
    var parsed = safeParse(readStorage(DOGS_KEY));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      memoryDogs = DEFAULT_PACK.map(normaliseDog);
      writeStorage(DOGS_KEY, JSON.stringify(memoryDogs));
    } else {
      memoryDogs = parsed.map(normaliseDog);
    }
    return memoryDogs.map(function (d) { return Object.assign({}, d); });
  }

  function persistDogs(dogs, silent) {
    memoryDogs = dogs.map(normaliseDog);
    writeStorage(DOGS_KEY, JSON.stringify(memoryDogs));
    if (!silent) notify();
    return getDogs();
  }

  function setDogs(dogs) {
    if (!Array.isArray(dogs) || dogs.length === 0) return getDogs();
    var next = persistDogs(dogs, true);
    // Keep the active pointer valid.
    var active = getActiveDogId();
    if (!next.some(function (d) { return d.id === active; })) {
      setActiveDogId(next[0].id, true);
    }
    notify();
    return next;
  }

  function upsertDog(dog) {
    var dogs = getDogs();
    var idx = dogs.findIndex(function (d) { return d.id === dog.id; });
    if (idx >= 0) dogs[idx] = Object.assign({}, dogs[idx], dog);
    else dogs.push(normaliseDog(dog, dogs.length));
    return setDogs(dogs);
  }

  function removeDog(id) {
    var dogs = getDogs().filter(function (d) { return d.id !== id; });
    if (dogs.length === 0) return getDogs(); // never empty the pack
    return setDogs(dogs);
  }

  function getActiveDogId() {
    if (memoryActive) return memoryActive;
    var stored = readStorage(ACTIVE_KEY);
    var dogs = getDogs();
    if (stored && dogs.some(function (d) { return d.id === stored; })) {
      memoryActive = stored;
    } else {
      memoryActive = dogs[0].id;
      writeStorage(ACTIVE_KEY, memoryActive);
    }
    return memoryActive;
  }

  function setActiveDogId(id, silent) {
    if (!id) return getActiveDogId();
    memoryActive = id;
    writeStorage(ACTIVE_KEY, id);
    if (!silent) notify();
    return id;
  }

  function getActiveDog() {
    var dogs = getDogs();
    var id = getActiveDogId();
    return dogs.find(function (d) { return d.id === id; }) || dogs[0];
  }

  function ageMonths(dob, ref) {
    if (!dob) return null;
    var parts = String(dob).split('-').map(Number);
    var y = parts[0], m = parts[1], d = parts[2];
    if (!y || !m) return null;
    var birth = new Date(y, m - 1, d || 1);
    var now = ref || new Date();
    var months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
    if (now.getDate() < birth.getDate()) months -= 1;
    return Math.max(0, months);
  }

  function notify() {
    var snapshot = { dogs: getDogs(), activeDogId: getActiveDogId() };
    listeners.slice().forEach(function (fn) {
      try { fn(snapshot); } catch (e) { /* keep other listeners alive */ }
    });
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function unsubscribe() {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  // Cross-tab / cross-page sync: another page wrote to localStorage.
  global.addEventListener('storage', function (e) {
    if (e.key !== DOGS_KEY && e.key !== ACTIVE_KEY && e.key !== null) return;
    memoryDogs = null;
    memoryActive = null;
    notify();
  });

  global.DogwalkrPack = {
    DOGS_KEY: DOGS_KEY,
    ACTIVE_KEY: ACTIVE_KEY,
    DEFAULT_AVATAR: DEFAULT_AVATAR,
    DEFAULT_PACK: DEFAULT_PACK,
    getDogs: getDogs,
    setDogs: setDogs,
    upsertDog: upsertDog,
    removeDog: removeDog,
    getActiveDogId: getActiveDogId,
    setActiveDogId: setActiveDogId,
    getActiveDog: getActiveDog,
    subscribe: subscribe,
    ageMonths: ageMonths
  };
})(typeof window !== 'undefined' ? window : this);
