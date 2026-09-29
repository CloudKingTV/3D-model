/**
 * The park the board rolls along: a procedural, endless sequence of features,
 * and the collision queries the physics runs against it.
 *
 * Pure data and maths — no three.js, no DOM — so every rule here can be run in
 * a plain node test. `src/game/props.js` builds the meshes from the same
 * profile functions exported below, so what you see is exactly what you ride.
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

/** Square-edged obstacles: solid below their top, with a face you can hit. */
export const STEP_KINDS = new Set(['ledge', 'rail']);

/** The bar's radius. Its *top* is the feature's height, which is what you grind. */
export const RAIL_RADIUS = 0.42;

/* ------------------------------------------------------------- profiles */

const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** Kicker: eases up so the lip is the steepest part. */
export function kickerHeight(t, height) {
  return height * clamp01(t) ** 1.5;
}

// A quarter pipe is a circular arc stopped short of vertical, then scaled so
// it reaches exactly the feature's height at its lip. The mesh and the physics
// used to disagree here — the physics flattened out at two thirds of the height
// while the mesh carried on up — which buried the board in the top of the ramp.
const QUARTER_U = 0.94;
const QUARTER_TOP = 1 - Math.sqrt(1 - QUARTER_U * QUARTER_U);

export function quarterHeight(t, height) {
  const u = clamp01(t) * QUARTER_U;
  return (height * (1 - Math.sqrt(1 - u * u))) / QUARTER_TOP;
}

/** Funbox: ramp up, a flat grindable deck, ramp down. `local` is from its start. */
export function funboxHeight(local, feature) {
  const { length, height, rampLength } = feature;
  if (local < rampLength) return height * clamp01(local / rampLength) ** 1.4;
  if (local > length - rampLength) return height * clamp01((length - local) / rampLength) ** 1.4;
  return height;
}

function profileAt(feature, x) {
  const local = x - feature.start;
  const t = local / feature.length;
  switch (feature.kind) {
    case 'kicker': return kickerHeight(t, feature.height);
    case 'quarter': return quarterHeight(t, feature.height);
    case 'funbox': return funboxHeight(local, feature);
    default: return 0;
  }
}

/**
 * Surfaces a feature offers at a point, highest first. A surface is something
 * the wheels can be on: the table, a ramp, the top of a ledge, a rail.
 */
function surfacesFor(feature, x) {
  const ground = { y: 0, kind: 'ground', grindable: false, feature };

  switch (feature.kind) {
    case 'kicker':
    case 'quarter':
      return [{ y: profileAt(feature, x), kind: feature.kind, grindable: false, feature }];
    case 'funbox': {
      const y = profileAt(feature, x);
      // Only the flat deck is grindable, not the ramps either side of it.
      const local = x - feature.start;
      const onDeck = local >= feature.rampLength && local <= feature.length - feature.rampLength;
      return [{ y, kind: 'funbox', grindable: onDeck, feature }];
    }
    case 'ledge':
    case 'rail':
      return [
        { y: feature.height, kind: feature.kind, grindable: true, feature },
        ground,
      ];
    case 'gap':
      return []; // nothing to stand on
    default:
      return [ground];
  }
}

/* ------------------------------------------------------------ the track */

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
      if (!feature) return [{ y: 0, kind: 'ground', grindable: false, feature: null }];
      return surfacesFor(feature, x);
    },

    /** The top of whatever is solid at `x`; -Infinity over a gap. */
    topAt(x) {
      const surfaces = this.surfacesAt(x);
      return surfaces.length ? surfaces[0].y : -Infinity;
    },

    /**
     * The surface a single point rests on at height `y`: the highest one not
     * above it, within `tolerance`.
     */
    supportAt(x, y, tolerance = 0.6) {
      for (const surface of this.surfacesAt(x)) {
        if (surface.y <= y + tolerance) return surface;
      }
      return null;
    },

    /**
     * Where a rigid deck comes to rest, from three contact points — both
     * wheels and the middle — each queried at its own height along the
     * board's current pitch.
     *
     * The deck settles on the lowest line that is on or above all three
     * points, which means it touches two of them. Concave ground gives the
     * wheel-to-wheel chord; a crest or a step gives a line through the middle
     * and one wheel. When two lines tie (a crest), the one nearest the board's
     * current pitch wins, so it keeps its line over a lip and launches instead
     * of tipping onto its nose.
     *
     * Returns null when the middle is over nothing and no pair of wheels
     * bridges it: the board's centre of mass has gone over an edge.
     */
    boardSupport(x, y, pitch, halfBase, tolerance = 0.6, tips = null) {
      const tan = Math.tan(pitch);
      const query = (offset, lift) => {
        const surface = this.supportAt(x + offset, y + offset * tan + lift, tolerance);
        // A tip's point is expressed on the wheel line: the surface minus how
        // far the tip's underside sits above that line.
        return { offset, lift, surface, y: surface ? surface.y - lift : -Infinity };
      };
      const back = query(-halfBase, 0);
      const mid = query(0, 0);
      const front = query(halfBase, 0);
      const wheels = [back, mid, front];
      // The nose and tail tips reach past the wheels. Near the end of a rail
      // or ledge the tail can still be over it after the back wheel has left,
      // and the board has to rest on that tail rather than drop through it.
      const points = tips
        ? [query(-tips.halfLength, tips.lift), ...wheels, query(tips.halfLength, tips.lift)]
        : wheels;

      if (!mid.surface && !(back.surface && front.surface)) return null;

      let best = null;
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const a = points[i];
          const b = points[j];
          if (!a.surface || !b.surface) continue;
          const slope = (b.y - a.y) / (b.offset - a.offset);
          const lineAt = (offset) => a.y + (offset - a.offset) * slope;
          if (!points.every((p) => p.y <= lineAt(p.offset) + 1e-6)) continue;

          const centre = lineAt(0);
          const drift = Math.abs(slope - tan);
          const lower = !best || centre < best.y - 0.02;
          const tie = best && Math.abs(centre - best.y) <= 0.02;
          if (lower || (tie && drift < best.drift)) best = { y: centre, slope, a, b, drift };
        }
      }
      if (!best) return null;

      // Report the surface actually bearing the weight — the middle if it is a
      // contact, otherwise the higher of the pair.
      const pair = [best.a, best.b];
      const bearing = pair.includes(mid) ? mid : (best.a.y >= best.b.y ? best.a : best.b);

      // How far the lowest point still is above its surface, so a board coming
      // down nose-first counts as landed when its front wheel touches rather
      // than when its middle does.
      let clearance = Infinity;
      for (const p of points) {
        if (p.surface) clearance = Math.min(clearance, y + p.offset * tan + p.lift - p.surface.y);
      }
      return {
        y: best.y,
        slope: best.slope,
        surface: bearing.surface,
        clearance,
        // What is under each contact point, for the rules that care which end
        // of the board is on what (grinds, hang-ups).
        back: back.surface,
        mid: mid.surface,
        front: front.surface,
      };
    },

    /**
     * A ledge or rail face in the board's way, checked at the front wheel and
     * at the nose. The nose sits `noseLift` above the wheel line — the real
     * height of the underside of the tip — so it is blocked the moment it
     * would actually touch. The wheel gets `clearance` of slack, which is what
     * lets a board that only just makes the height catch the top and ride on.
     *
     * Only the leading end is tested: the board moves forward, so the only
     * face it can run into is the one ahead of it.
     */
    blockedBy(x, y, pitch, halfBase, halfLength, { noseLift = 1.8, clearance = 0.4 } = {}) {
      const tan = Math.tan(pitch);
      for (const [offset, lift, slack] of [[halfBase, 0, clearance], [halfLength, noseLift, 0]]) {
        const feature = this.featureAt(x + offset);
        if (feature && STEP_KINDS.has(feature.kind)
          && y + offset * tan + lift < feature.height - slack) {
          return feature;
        }
      }
      return null;
    },

    /**
     * Any contact point well inside the table or a ramp — the usual way in is
     * dropping into a gap and carrying on into the far edge. Kept apart from
     * step faces, and checked only after a landing has had its chance, so a
     * board touching down nose-first is a landing, not a crash.
     *
     * Every point is tested, not only the front wheel: a board low in a gap
     * whose middle crosses onto the far table is inside it, even though its
     * middle is no longer "in the gap".
     */
    hitsTableEdge(x, y, pitch, halfBase, clearance = 0.8) {
      const tan = Math.tan(pitch);
      for (const offset of [halfBase, 0, -halfBase]) {
        const feature = this.featureAt(x + offset);
        if (!feature || feature.kind === 'gap' || STEP_KINDS.has(feature.kind)) continue;
        if (y + offset * tan < this.topAt(x + offset) - clearance) return { feature, offset };
      }
      return null;
    },

    /**
     * The first place at or after `from` where a whole board can sit with a
     * clear run-up. Used to put the board back after a bail.
     */
    safeSpotAhead(from, halfLength, runUp = 14) {
      let x = from;
      for (let guard = 0; guard < 200; guard += 1) {
        // The whole deck, tail to nose, has to be on flat table: put down
        // straddling the back of a ramp, its tail is left up in the air.
        const under = features.find((f) => f.kind !== 'flat'
          && f.end > x - halfLength && f.start < x + halfLength);
        // And the stretch ahead has to be rideable without an ollie.
        const ahead = features.find((f) => (f.kind === 'gap' || STEP_KINDS.has(f.kind))
          && f.end > x && f.start < x + halfLength + runUp);
        const blocker = under ?? ahead;
        if (!blocker) return x;
        x = blocker.end + halfLength + 1;
      }
      return x;
    },
  };
}

export { surfacesFor };
