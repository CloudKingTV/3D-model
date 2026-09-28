/**
 * The park the board rolls along: a procedural, endless sequence of features.
 *
 * This module is pure data and maths — no three.js, no DOM — so the whole of
 * it can be exercised in a plain node test. `src/game/props.js` turns the same
 * feature list into meshes.
 *
 * Units match the model: 1 = 10mm, so the 96mm deck is 9.6 long and a 40mm
 * ramp is 4 tall.
 */

/**
 * Deterministic PRNG, so a seed always lays out the same park. Mulberry32:
 * a plain xorshift correlates badly enough here to starve whole feature types
 * out of the mix.
 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FEATURE_KINDS = ['flat', 'kicker', 'quarter', 'funbox', 'ledge', 'rail', 'gap'];

/**
 * Surfaces a feature offers at a point, highest first. A surface is something
 * the wheels can be on: the table, a ramp, the top of a box, a rail.
 */
function surfacesFor(feature, x) {
  const t = (x - feature.start) / feature.length;
  const ground = { y: 0, slope: 0, kind: 'ground', grindable: false, feature };

  switch (feature.kind) {
    case 'kicker': {
      // Rises with an easing curve so the lip is the steepest part.
      const y = feature.height * t ** 1.5;
      const slope = (feature.height * 1.5 * Math.max(t, 0.001) ** 0.5) / feature.length;
      return [{ y, slope, kind: 'kicker', grindable: false, feature }];
    }
    case 'quarter': {
      // A concave transition; stops short of vertical so the slope stays sane.
      const u = Math.min(t, 0.94);
      const y = feature.height * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
      const slope = (feature.height * u) / (Math.sqrt(Math.max(1e-4, 1 - u * u)) * feature.length);
      return [{ y, slope, kind: 'quarter', grindable: false, feature }];
    }
    case 'funbox': {
      // Ramp up, flat grindable deck, ramp down — rollable without an ollie.
      const ramp = feature.rampLength / feature.length;
      if (t < ramp) {
        const k = t / ramp;
        return [{
          y: feature.height * k ** 1.4,
          slope: (feature.height * 1.4 * Math.max(k, 0.001) ** 0.4) / feature.rampLength,
          kind: 'funbox',
          grindable: false,
          feature,
        }];
      }
      if (t > 1 - ramp) {
        const k = (1 - t) / ramp;
        return [{
          y: feature.height * k ** 1.4,
          slope: -(feature.height * 1.4 * Math.max(k, 0.001) ** 0.4) / feature.rampLength,
          kind: 'funbox',
          grindable: false,
          feature,
        }];
      }
      return [{ y: feature.height, slope: 0, kind: 'funbox', grindable: true, feature }];
    }
    case 'ledge':
      // Square-edged: you have to ollie onto it, and its face will stop you.
      return [
        { y: feature.height, slope: 0, kind: 'ledge', grindable: true, feature },
        ground,
      ];
    case 'rail':
      // The table runs on underneath, so missing a rail costs nothing.
      return [
        { y: feature.height, slope: 0, kind: 'rail', grindable: true, feature },
        ground,
      ];
    case 'gap':
      return []; // nothing to stand on
    default:
      return [ground];
  }
}

/**
 * An endless park. Features are generated ahead of the skater and dropped once
 * they are well behind, so a long run costs no more than a short one.
 */
export function createTrack({ seed = 7, runInLength = 58 } = {}) {
  const random = rng(seed);
  const features = [];
  let cursor = 0;
  let index = 0;

  function push(kind, length, extra = {}) {
    const feature = { id: index++, kind, start: cursor, length, height: 0, ...extra };
    feature.end = cursor + length;
    features.push(feature);
    cursor += length;
    return feature;
  }

  // A calm run-in so the first obstacle is never a surprise.
  push('flat', runInLength);

  /** Pick the next obstacle, getting gradually bolder further down the table. */
  function addObstacle() {
    const difficulty = Math.min(1, cursor / 2600);
    const roll = random();

    // Weighted toward rails and transitions — grinds and launches are the fun
    // part; ledges and gaps are the punishing ones, so they stay rarer.
    if (roll < 0.28) {
      push('rail', 24 + random() * 18, { height: 2.8 + difficulty * 1.2 });
    } else if (roll < 0.46) {
      push('kicker', 14 + random() * 6, { height: 3.2 + difficulty * 1.8 });
    } else if (roll < 0.62) {
      push('quarter', 16 + random() * 6, { height: 4.5 + difficulty * 2.5 });
    } else if (roll < 0.8) {
      const rampLength = 9 + random() * 4;
      push('funbox', rampLength * 2 + 16 + random() * 14, {
        height: 3 + difficulty * 1.4,
        rampLength,
      });
    } else if (roll < 0.93) {
      push('ledge', 20 + random() * 14, { height: 2.6 + difficulty * 1.2 });
    } else {
      push('gap', 9 + difficulty * 8 + random() * 5);
    }
  }

  return {
    features,

    /** Make sure the park is built out past `x`. */
    ensureAhead(x, margin = 400) {
      let guard = 0;
      while (cursor < x + margin && guard++ < 500) {
        push('flat', 26 + random() * 30);
        addObstacle();
      }
    },

    /** Forget features far enough behind that they cannot be seen again. */
    prune(x, behind = 220) {
      while (features.length > 1 && features[0].end < x - behind) features.shift();
    },

    featureAt(x) {
      for (const feature of features) {
        if (x >= feature.start && x < feature.end) return feature;
      }
      return null;
    },

    /** Every surface under `x`, highest first. */
    surfacesAt(x) {
      const feature = this.featureAt(x);
      if (!feature) return [{ y: 0, slope: 0, kind: 'ground', grindable: false, feature: null }];
      return surfacesFor(feature, x).sort((a, b) => b.y - a.y);
    },

    /**
     * The surface the wheels should rest on at height `y`: the highest one that
     * is not above them, within a small tolerance for landing.
     */
    /** The first x at or after `from` that has solid ground — used after a bail. */
    solidGroundAhead(from) {
      let x = from;
      for (let i = 0; i < 400; i += 1) {
        const feature = this.featureAt(x);
        if (!feature) return x;
        if (feature.kind !== 'gap') return Math.max(x, feature.start + 1);
        x = feature.end + 2;
      }
      return x;
    },

    supportAt(x, y, tolerance = 0.6) {
      const surfaces = this.surfacesAt(x);
      for (const surface of surfaces) {
        if (surface.y <= y + tolerance) return surface;
      }
      return null;
    },
  };
}

export { surfacesFor };
